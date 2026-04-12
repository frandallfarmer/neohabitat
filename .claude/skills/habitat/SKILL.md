# Habitat VICE Automation

Drive the Habitat C64 client in VICE, automate boot/login, inspect game state, and read bridge/Elko logs for debugging.

## Quick Start

```python
from vice_tool import VICESession

v = VICESession()
v.launch()                    # Start VICE with remote monitor
v.boot_to_game("steve")      # Splash → login → game

print(v.screen())             # Show C64 screen
print(v.bridge_logs())        # Show bridge_v2 logs
print(v.elko_logs())          # Show Elko server logs
print(f"PC=${v.registers()['PC']:04X}")
```

## Prerequisites

- VICE (x64sc) installed: `brew install vice`
- Docker stack running: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
- launch-vice.sh enables remote monitor on port 6510

## API Reference

### Lifecycle
| Method | Description |
|--------|-------------|
| `launch(extra_args)` | Start VICE via launch-vice.sh, connect to monitor |
| `connect(retries, delay)` | Connect to existing VICE monitor on port 6510 |
| `close()` | Close socket + terminate VICE |

### Monitor Commands
| Method | Description |
|--------|-------------|
| `cmd(command, timeout)` | Send raw command, return response |
| `go(addr)` | Resume execution (optionally at addr) |
| `stop()` | Break into monitor |
| `step(count)` | Single-step N instructions |
| `go_and_wait(addr, timeout)` | Resume, wait for breakpoint hit |

### Memory
| Method | Description |
|--------|-------------|
| `read_byte(addr)` | Read single byte |
| `read_word(addr)` | Read 16-bit LE word |
| `read_block(addr, length)` | Read memory block → bytearray |
| `write_byte(addr, val)` | Write single byte |
| `write_bytes(addr, data)` | Write multiple bytes |

### Registers & Breakpoints
| Method | Description |
|--------|-------------|
| `registers()` | Get PC, A, X, Y, SP → dict |
| `set_breakpoint(addr)` | Set execution breakpoint |
| `delete_breakpoints()` | Delete all breakpoints |

### Input
| Method | Description |
|--------|-------------|
| `keybuf(text)` | Inject raw keybuf string (supports \\xNN) |
| `type_text(text)` | Type ASCII text (auto PETSCII conversion) |
| `press_return()` | Press RETURN |
| `press_f3()` / `press_f5()` / `press_f7()` | Press function keys |

### Screen
| Method | Description |
|--------|-------------|
| `screen()` | Get screen via monitor `sc` command |
| `read_screen_ram()` | Read $0400-$07E7, convert to ASCII |
| `wait_for_text(text, timeout)` | Poll screen until text appears |

### Habitat Boot
| Method | Description |
|--------|-------------|
| `boot_to_splash(wait)` | Launch VICE, wait for splash screen |
| `dismiss_splash()` | Press RETURN past splash |
| `login(name, wait_for_connect)` | Type name, accept host, wait for server |
| `wait_for_game(timeout)` | Poll until game entry at $0816 |
| `boot_to_game(name)` | Full sequence: splash → login → game |

### Docker Logs
| Method | Description |
|--------|-------------|
| `bridge_logs(lines)` | Recent bridge_v2 container logs |
| `elko_logs(lines)` | Recent neohabitat/Elko container logs |

## Boot Sequence Stages

1. **Splash** (0-8s) — Habitat logo, any key continues
2. **Launcher** (8-12s) — "Habitat Launcher", name prompt
3. **Host** (12-14s) — Edit host or RETURN to accept
4. **Connecting** (14-60s) — "Dialing NeoHabitat..." → "Connected!"
5. **Login JSON** (60-65s) — Sends `{"to":"bridge","op":"LOGIN","name":"..."}`
6. **Decompression** (65-120s) — Border flashes, screen blanked
7. **Game** (120s+) — $0816 contains $AD (LDA), screen visible

## Debugging Workflow

```python
v = VICESession()
v.connect()  # Connect to already-running VICE

# Check game state
v.stop()
regs = v.registers()
print(f"PC=${regs['PC']:04X} A=${regs['A']:02X}")
print(v.screen())

# Read protocol state
print(f"INITST = ${v.read_byte(0x8CA4):02X}")
print(f"SEQOUT = ${v.read_byte(0x8CA1):02X}")

# Check bridge
print(v.bridge_logs())

# Resume
v.go()
```

## CLI Usage

```bash
python3 vice_tool.py --launch --regs          # Launch + show registers
python3 vice_tool.py --boot steve             # Full boot
python3 vice_tool.py --screen                 # Show screen (connect to existing)
python3 vice_tool.py --read 0816              # Read byte
python3 vice_tool.py --bridge-logs            # Show bridge logs
python3 vice_tool.py --cmd "m 0400 0427"      # Raw monitor command
```
