#!/usr/bin/env python3
"""VICE remote monitor client for Habitat C64 automation.

Connects to VICE's text-mode remote monitor over TCP and provides
methods for memory inspection, keystroke injection, screen reading,
and Habitat boot sequence automation.

Usage:
    from vice_tool import VICESession

    v = VICESession()
    v.launch()
    v.boot_to_game("steve")
    print(v.screen())
    print(v.bridge_logs())
"""

import os
import re
import select
import socket
import subprocess
import sys
import time

PROJECT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 6510

# C64 screen code → ASCII. Covers both charsets:
# Default (uppercase/graphics): $01-$1A = A-Z
# Shifted (upper+lowercase): $41-$5A = A-Z, $01-$1A = a-z
# We map both to ASCII for text matching.
SCREEN_TO_ASCII = {0x00: "@", 0x20: " "}
for _i in range(26):
    SCREEN_TO_ASCII[_i + 1] = chr(0x41 + _i)      # $01-$1A → A-Z
    SCREEN_TO_ASCII[0x41 + _i] = chr(0x41 + _i)    # $41-$5A → A-Z
    SCREEN_TO_ASCII[0x61 + _i] = chr(0x61 + _i)    # $61-$7A → a-z
for _i in range(10):
    SCREEN_TO_ASCII[0x30 + _i] = chr(0x30 + _i)    # $30-$39 → 0-9
for _c in "!\"#$%&'()*+,-./:;<=>?":
    SCREEN_TO_ASCII[ord(_c)] = _c


class VICESession:
    """VICE remote monitor TCP client."""

    def __init__(self, host=DEFAULT_HOST, port=DEFAULT_PORT, verbose=True):
        self.host = host
        self.port = port
        self.verbose = verbose
        self.sock = None
        self.vice_proc = None
        self._buf = b""

    # ── Lifecycle ────────────────────────────────────────────────────

    def connect(self, retries=20, delay=1.0):
        """Connect to VICE remote monitor."""
        for attempt in range(retries):
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(5)
                s.connect((self.host, self.port))
                s.setblocking(False)
                self.sock = s
                self._buf = b""
                # VICE sends nothing on connect — CPU just pauses.
                # Send a dummy command to get the first prompt.
                time.sleep(0.3)
                self.sock.sendall(b"\n")
                self._read_until_prompt(timeout=5)
                self._log(f"Connected to VICE monitor at {self.host}:{self.port}")
                return
            except (ConnectionRefusedError, socket.timeout, OSError):
                if attempt < retries - 1:
                    time.sleep(delay)
        raise RuntimeError(f"Cannot connect to VICE monitor at {self.host}:{self.port}")

    def launch(self, extra_args=None):
        """Launch VICE via launch-vice.sh and connect to remote monitor."""
        launcher = os.path.join(PROJECT, "tools", "vice", "launch-vice.sh")
        if not os.path.exists(launcher):
            raise FileNotFoundError(f"Launch script not found: {launcher}")

        cmd = [launcher]
        if extra_args:
            cmd.extend(extra_args)

        self._log("Launching VICE...")
        self.vice_proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            cwd=PROJECT)

        # Wait for VICE to start and open monitor port
        time.sleep(3)
        self.connect()

    def close(self):
        """Close monitor connection and optionally kill VICE."""
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None
        if self.vice_proc:
            try:
                self.vice_proc.terminate()
                self.vice_proc.wait(timeout=5)
            except Exception:
                pass
            self.vice_proc = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    # ── Raw monitor protocol ────────────────────────────────────────

    def _read_until_prompt(self, timeout=5):
        """Read from socket until we see the (C:$xxxx) prompt."""
        deadline = time.time() + timeout
        lines = []
        while time.time() < deadline:
            remaining = max(0.1, deadline - time.time())
            ready, _, _ = select.select([self.sock], [], [], remaining)
            if ready:
                chunk = self.sock.recv(4096)
                if not chunk:
                    raise ConnectionError("VICE monitor closed connection")
                self._buf += chunk
                # Check for prompt pattern: (C:$xxxx)
                while b"\n" in self._buf:
                    line, self._buf = self._buf.split(b"\n", 1)
                    line = line.rstrip(b"\r")
                    lines.append(line.decode("latin-1", errors="replace"))
                # Check if buffer ends with prompt
                if re.search(rb"\(C:\$[0-9a-fA-F]{4}\)\s*$", self._buf):
                    prompt = self._buf.decode("latin-1", errors="replace")
                    self._buf = b""
                    lines.append(prompt)
                    return "\n".join(lines)
        return "\n".join(lines)

    def cmd(self, command, timeout=5):
        """Send a monitor command and return the response text.
        If the first response is just the prompt (VICE swallowed the
        command because the CPU wasn't cleanly paused), retry once."""
        if not self.sock:
            raise RuntimeError("Not connected to VICE monitor")
        self.sock.sendall((command + "\n").encode("latin-1"))
        resp = self._read_until_prompt(timeout=timeout)
        # If the response is just a bare prompt, VICE may have been
        # serving an IRQ and dropped our command. Retry once.
        stripped = resp.strip()
        if stripped and all(
            line.strip() == "" or line.strip().startswith("(C:$")
            for line in stripped.split("\n")
        ):
            self.sock.sendall((command + "\n").encode("latin-1"))
            resp = self._read_until_prompt(timeout=timeout)
        return resp

    # ── Execution control ───────────────────────────────────────────

    def go(self, addr=None):
        """Resume execution. Keep connection open.
        After go(), the monitor won't respond until stop() is called."""
        if addr is not None:
            self.sock.sendall(f"g ${addr:04x}\n".encode())
        else:
            self.sock.sendall(b"g\n")
        # CPU is now running. Socket stays open but VICE won't send
        # anything until the CPU breaks (breakpoint, or we send data).

    def stop(self):
        """Break into monitor by sending an empty line on the persistent
        connection. VICE pauses the CPU and sends a prompt.
        Retries a few times because VICE occasionally drops the first
        newline when the CPU is busy serving an IRQ."""
        last = ""
        for _ in range(5):
            self.sock.sendall(b"\n")
            last = self._read_until_prompt(timeout=2)
            if "(C:$" in last:
                return last
            time.sleep(0.1)
        return last

    def step(self, count=1):
        """Single-step N instructions."""
        return self.cmd(f"z {count}" if count > 1 else "z")

    def go_and_wait(self, addr=None, timeout=120):
        """Resume execution, wait for breakpoint hit (prompt returns)."""
        if addr is not None:
            self.sock.sendall(f"g ${addr:04x}\n".encode())
        else:
            self.sock.sendall(b"g\n")
        return self._read_until_prompt(timeout=timeout)

    # ── Memory ──────────────────────────────────────────────────────

    def read_byte(self, addr):
        """Read a single byte from C64 memory.
        VICE's `m addr addr` single-byte form is flaky; read a 2-byte
        range and take the first byte."""
        resp = self.cmd(f"m ${addr:04x} ${addr+1:04x}")
        # Response format: >C:addr  xx xx ...  <ascii>
        for line in resp.split("\n"):
            m = re.search(
                rf">C:({addr:04x})\s+([0-9a-fA-F]{{2}})",
                line, re.IGNORECASE)
            if m:
                return int(m.group(2), 16)
        # Fallback: any >C: line with a hex byte
        for line in resp.split("\n"):
            m = re.search(r">C:[0-9a-fA-F]{4}\s+([0-9a-fA-F]{2})", line)
            if m:
                return int(m.group(1), 16)
        raise ValueError(f"Cannot parse byte at ${addr:04X}: {resp!r}")

    def read_word(self, addr):
        """Read a 16-bit little-endian word."""
        lo = self.read_byte(addr)
        hi = self.read_byte(addr + 1)
        return (hi << 8) | lo

    def read_block(self, addr, length):
        """Read a block of memory, return bytearray."""
        # Read in chunks of 16 bytes to avoid parsing issues with the
        # ASCII display section in VICE's hex dump format.
        data = bytearray()
        pos = addr
        while len(data) < length:
            chunk_end = min(pos + 15, addr + length - 1)
            resp = self.cmd(f"m ${pos:04x} ${chunk_end:04x}")
            for line in resp.split("\n"):
                if not line.startswith(">C:"):
                    continue
                # Each line: >C:addr  XX XX XX XX  XX XX XX XX ...  <ascii>
                # Take exactly the first 16 hex pairs after the address
                m = re.findall(r"[0-9a-fA-F]{2}", line[7:55])
                data.extend(int(b, 16) for b in m)
            pos = chunk_end + 1
        return data[:length]

    def write_byte(self, addr, val):
        """Write a single byte."""
        self.cmd(f"> C:{addr:04x} {val:02x}")

    def write_bytes(self, addr, data):
        """Write multiple bytes."""
        hex_str = " ".join(f"{b:02x}" for b in data)
        self.cmd(f"> C:{addr:04x} {hex_str}")

    # ── Registers ───────────────────────────────────────────────────

    def registers(self):
        """Read CPU registers, return dict."""
        resp = self.cmd("r")
        regs = {}
        # VICE 3.10 format: .;PC A  X  Y  SP 00 01 NV-BDIZC LIN CYC
        # Example:           .;ee5a 87 00 00 f5 2f 37 10100101 012 000
        for line in resp.split("\n"):
            m = re.match(
                r"\.\;([0-9a-fA-F]{4})\s+"
                r"([0-9a-fA-F]{2})\s+"
                r"([0-9a-fA-F]{2})\s+"
                r"([0-9a-fA-F]{2})\s+"
                r"([0-9a-fA-F]{2})",
                line.strip())
            if m:
                regs["PC"] = int(m.group(1), 16)
                regs["A"] = int(m.group(2), 16)
                regs["X"] = int(m.group(3), 16)
                regs["Y"] = int(m.group(4), 16)
                regs["SP"] = int(m.group(5), 16)
                break
        return regs

    # ── Breakpoints ─────────────────────────────────────────────────

    def set_breakpoint(self, addr):
        """Set an execution breakpoint."""
        return self.cmd(f"break ${addr:04x}")

    def delete_breakpoints(self):
        """Delete all breakpoints."""
        return self.cmd("delete")

    # ── Input ───────────────────────────────────────────────────────

    def keybuf(self, text):
        """Inject text into VICE keyboard buffer.
        Supports \\xNN hex escapes for special keys."""
        return self.cmd(f'keybuf "{text}"')

    def type_text(self, text):
        """Type text into the C64. VICE keybuf handles PETSCII mapping."""
        return self.keybuf(text)

    # Habitat game's own keyboard ring buffer (separate from KERNAL's).
    # The game scans the CIA1 keyboard matrix directly in vblank_keys and
    # stuffs keys into this buffer — it does NOT use KERNAL GETIN. So
    # $0277/$00C6 injection only works in launcher.c; once the Lucasfilm
    # splash is up, you have to push into the game's ring.
    #
    # IMPORTANT: all.sym lists these labels at $9A37/$9A38/$9A39 but that
    # is STALE. Disassembling init_keyboard ($6F84..) in the running binary
    # shows the real addresses:
    #   kb_buffer_pointer = $9A46  (insert index)
    #   kb_buffer_end     = $9A47  (consume index)
    #   kb_buffer         = $9A48  (32-byte ring, $9A48-$9A67)
    GAME_KB_POINTER = 0x9A46
    GAME_KB_END = 0x9A47
    GAME_KB_BUFFER = 0x9A48
    GAME_KB_LENGTH = 0x20

    def inject_game_key(self, petscii):
        """Push a key into the Habitat game's ring buffer.
        read_keyboard consumes from (end+1), so we advance the pointer
        the same way vblank_keys_insert does. Returns False silently if
        the game isn't running yet (e.g. still in launcher.c)."""
        try:
            ptr = self.read_byte(self.GAME_KB_POINTER)
            end = self.read_byte(self.GAME_KB_END)
        except (ValueError, ConnectionError):
            return False
        # Mirror vblank_keys_insert: INY then CPY #$20 / BCC skip
        new_ptr = (ptr + 1) & 0xFF
        if new_ptr >= self.GAME_KB_LENGTH:
            new_ptr = 0
        if new_ptr == end:
            return False  # buffer full
        self.write_byte(self.GAME_KB_BUFFER + new_ptr, petscii)
        self.write_byte(self.GAME_KB_POINTER, new_ptr)
        return True

    def press_return(self):
        """Inject RETURN into BOTH keyboard paths so it works whether the
        CPU is in launcher.c (KERNAL GETIN at $0277) or in the Habitat game
        (vblank_keys ring buffer at $9A37+)."""
        # KERNAL path (launcher.c cbm_k_getin)
        self.write_byte(0x0277, 0x0D)
        self.write_byte(0x00C6, 0x01)
        # Game path (display_and_wait_for_key → read_keyboard)
        self.inject_game_key(0x0D)

    def press_f3(self):
        """Press F3 key."""
        return self.keybuf("\\x86")

    def press_f5(self):
        """Press F5 key."""
        return self.keybuf("\\x87")

    def press_f7(self):
        """Press F7 key."""
        return self.keybuf("\\x88")

    # ── Screen ──────────────────────────────────────────────────────

    def screen(self):
        """Read screen contents via monitor 'sc' command."""
        return self.cmd("sc", timeout=5)

    def read_screen_ram(self):
        """Read screen RAM ($0400-$07E7) and convert to ASCII text."""
        data = self.read_block(0x0400, 1000)
        lines = []
        for row in range(25):
            line = ""
            for col in range(40):
                code = data[row * 40 + col]
                line += SCREEN_TO_ASCII.get(code, "?")
            lines.append(line.rstrip())
        return "\n".join(lines)

    def screenshot(self, path=None):
        """Capture VICE screen to a PNG and return the absolute path.
        Uses VICE monitor's `screenshot "path" 2` command (format 2 = PNG).
        Note that VICE silently appends the format's extension if the
        filename doesn't already have it, so we strip/normalize the .png
        suffix before passing to VICE."""
        if path is None:
            ts = int(time.time() * 1000)
            path = f"/tmp/vice-{ts}.png"
        abs_path = os.path.abspath(path)
        # VICE appends .png when format=2 regardless, so pass the bare
        # stem and then look for <stem>.png on disk.
        stem = abs_path[:-4] if abs_path.endswith(".png") else abs_path
        self.cmd(f'screenshot "{stem}" 2')
        expected = stem + ".png"
        for _ in range(20):
            if os.path.exists(expected) and os.path.getsize(expected) > 0:
                return expected
            time.sleep(0.1)
        raise RuntimeError(f"VICE screenshot didn't materialize at {expected}")

    def wait_for_text(self, text, timeout=60, interval=3):
        """Poll screen until text appears. Returns True/False."""
        deadline = time.time() + timeout
        text_upper = text.upper()
        while time.time() < deadline:
            try:
                sc = self.screen()
                if text_upper in sc.upper():
                    return True
            except Exception:
                pass
            # Resume execution briefly, then break back in
            try:
                self.go()
                time.sleep(interval)
                self.stop()
            except Exception:
                pass
        return False

    # ── Habitat Boot Sequence ───────────────────────────────────────

    def boot_to_splash(self, wait=8):
        """Launch VICE and wait for Habitat splash screen."""
        self.launch()
        self._log("Waiting for splash screen...")
        # Resume execution and wait for boot
        self.go()
        time.sleep(wait)
        self.stop()
        self._log("At splash screen.")

    def dismiss_splash(self):
        """Press RETURN to dismiss splash screen."""
        self._log("Dismissing splash...")
        self.press_return()
        self.go()
        time.sleep(3)
        self.stop()

    def login(self, name, wait_for_connect=60):
        """Type name, press RETURN, accept host, wait for connection."""
        self._log(f"Logging in as '{name}'...")
        self.type_text(name)
        self.go()
        time.sleep(1)
        self.stop()
        self.press_return()
        self.go()
        time.sleep(2)
        self.stop()
        # Accept host prompt (second RETURN)
        self.press_return()
        self._log("Waiting for server connection...")
        self.go()
        time.sleep(wait_for_connect)
        self.stop()

    def wait_for_game(self, timeout=180):
        """Wait for game to fully load (poll $0816 for game entry code)."""
        self._log("Waiting for game to load...")
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                val = self.read_byte(0x0816)
                if val == 0xAD:  # LDA $0210 (start_of_program)
                    self._log("Game loaded!")
                    return True
            except Exception:
                pass
            self.go()
            time.sleep(5)
            self.stop()
        self._log("Timeout waiting for game.")
        return False

    def boot_to_game(self, name="a"):
        """Full boot sequence: launch → splash → login → game."""
        self.boot_to_splash()
        self.dismiss_splash()
        self.login(name)
        return self.wait_for_game()

    # ── Docker Log Helpers ──────────────────────────────────────────

    def bridge_logs(self, lines=30):
        """Get recent bridge_v2 docker-compose logs."""
        return self._docker_logs("bridge_v2", lines)

    def elko_logs(self, lines=30):
        """Get recent neohabitat (Elko) docker-compose logs."""
        return self._docker_logs("neohabitat", lines)

    def _docker_logs(self, service, lines):
        try:
            result = subprocess.run(
                ["docker", "compose",
                 "-f", "docker-compose.yml",
                 "-f", "docker-compose.dev.yml",
                 "logs", "--tail", str(lines), "--no-color", service],
                capture_output=True, text=True, cwd=PROJECT, timeout=10)
            return result.stdout
        except Exception as e:
            return f"Error reading {service} logs: {e}"

    # ── Internal ────────────────────────────────────────────────────

    def _log(self, msg):
        if self.verbose:
            print(f"[VICE] {msg}", flush=True)


# ── CLI ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="VICE remote monitor tool")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--launch", action="store_true", help="Launch VICE first")
    parser.add_argument("--boot", metavar="NAME", help="Full boot with name")
    parser.add_argument("--screen", action="store_true", help="Show screen")
    parser.add_argument("--regs", action="store_true", help="Show registers")
    parser.add_argument("--read", metavar="ADDR", help="Read byte at hex addr")
    parser.add_argument("--bridge-logs", action="store_true", help="Show bridge logs")
    parser.add_argument("--cmd", metavar="CMD", help="Send raw monitor command")
    args = parser.parse_args()

    v = VICESession(host=args.host, port=args.port)

    try:
        if args.launch:
            v.launch()
        elif args.boot:
            v.boot_to_game(args.boot)
        else:
            v.connect()

        if args.regs:
            print(v.registers())
        if args.screen:
            print(v.screen())
        if args.read:
            addr = int(args.read, 16)
            val = v.read_byte(addr)
            print(f"${addr:04X} = ${val:02X}")
        if args.bridge_logs:
            print(v.bridge_logs())
        if args.cmd:
            print(v.cmd(args.cmd))
    except KeyboardInterrupt:
        pass
    finally:
        if not args.boot:
            v.close()
