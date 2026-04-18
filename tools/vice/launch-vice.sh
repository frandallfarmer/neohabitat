#!/usr/bin/env bash
# launch-vice.sh — start an x64sc session that connects to the local
# NeoHabitat stack via bridge_v2.
#
# By default it points the C64's user-port modem at bridge_v2 in qlink mode
# on 127.0.0.1:2026 and autostarts pushserver/public/disks/Habitat-Boot.d64.
#
# Usage:
#   tools/vice/launch-vice.sh                       # qlink-mode bridge_v2 on :2026
#   tools/vice/launch-vice.sh 1986                  # qlink container on :1986
#   tools/vice/launch-vice.sh beefheart:1337        # remote host
#   tools/vice/launch-vice.sh --legacy              # legacy Node bridge on :1337
#   tools/vice/launch-vice.sh --bridge HOST:PORT    # arbitrary host:port
#   tools/vice/launch-vice.sh --disks /path/to/dir  # different disks dir
#   tools/vice/launch-vice.sh --vice /path/to/x64sc # different VICE binary
#   tools/vice/launch-vice.sh --keep-config         # don't delete temp vicerc
#   tools/vice/launch-vice.sh --print-config        # show effective vicerc and exit
#   tools/vice/launch-vice.sh --                    # everything after -- is passed
#                                                   # straight through to x64sc

set -euo pipefail

# Resolve the script's own directory so paths work no matter where the user
# invokes the script from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Defaults.
BRIDGE_ADDR="127.0.0.1:2026"
DISKS_DIR="${REPO_ROOT}/pushserver/public/disks"
VICE_BIN=""
KEEP_CONFIG=0
PRINT_ONLY=0
PASSTHROUGH=()

usage() {
    cat <<'EOF'
launch-vice.sh — start an x64sc session that connects to the local
NeoHabitat stack via bridge_v2.

By default it points the C64's user-port modem at bridge_v2 in qlink mode
on 127.0.0.1:2026 and autostarts pushserver/public/disks/Habitat-Boot.d64.

Usage:
  tools/vice/launch-vice.sh                       # qlink-mode bridge_v2 on :2026
  tools/vice/launch-vice.sh 1986                  # qlink container on :1986
  tools/vice/launch-vice.sh beefheart:1337        # remote host
  tools/vice/launch-vice.sh --legacy              # legacy Node bridge on :1337
  tools/vice/launch-vice.sh --bridge HOST:PORT    # arbitrary host:port
  tools/vice/launch-vice.sh --disks /path/to/dir  # different disks dir
  tools/vice/launch-vice.sh --vice /path/to/x64sc # different VICE binary
  tools/vice/launch-vice.sh --keep-config         # don't delete temp vicerc
  tools/vice/launch-vice.sh --print-config        # show effective vicerc and exit
  tools/vice/launch-vice.sh --                    # everything after -- is passed
                                                  # straight through to x64sc
EOF
    exit "${1:-0}"
}

die() {
    echo "launch-vice.sh: $*" >&2
    exit 1
}

# --- Parse arguments ----------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --bridge)
            [[ $# -ge 2 ]] || die "--bridge needs a HOST:PORT argument"
            BRIDGE_ADDR="$2"
            shift 2
            ;;
        --bridge=*)
            BRIDGE_ADDR="${1#*=}"
            shift
            ;;
        --legacy)
            BRIDGE_ADDR="127.0.0.1:1337"
            shift
            ;;
        --disks)
            [[ $# -ge 2 ]] || die "--disks needs a directory argument"
            DISKS_DIR="$2"
            shift 2
            ;;
        --disks=*)
            DISKS_DIR="${1#*=}"
            shift
            ;;
        --vice)
            [[ $# -ge 2 ]] || die "--vice needs a path argument"
            VICE_BIN="$2"
            shift 2
            ;;
        --vice=*)
            VICE_BIN="${1#*=}"
            shift
            ;;
        --keep-config)
            KEEP_CONFIG=1
            shift
            ;;
        --print-config)
            PRINT_ONLY=1
            shift
            ;;
        -h|--help)
            usage 0
            ;;
        --)
            shift
            PASSTHROUGH+=("$@")
            break
            ;;
        *)
            # Bare argument: either a port number (→ 127.0.0.1:PORT) or
            # a host:port tuple (used as-is).
            if [[ "$1" =~ ^[0-9]+$ ]]; then
                BRIDGE_ADDR="127.0.0.1:$1"
                shift
            elif [[ "$1" =~ ^.+:[0-9]+$ ]]; then
                BRIDGE_ADDR="$1"
                shift
            else
                die "unknown argument: $1 (try --help)"
            fi
            ;;
    esac
done

# --- Validate paths -----------------------------------------------------------
[[ -d "$DISKS_DIR" ]] || die "disks dir not found: $DISKS_DIR"
DISKS_DIR="$(cd "$DISKS_DIR" && pwd)"

BOOT_DISK="${DISKS_DIR}/Habitat-Boot.d64"
B_DISK="${DISKS_DIR}/Habitat-B.d64"
[[ -f "$BOOT_DISK" ]] || die "boot disk missing: $BOOT_DISK"

# Find x64sc unless the user pointed us at a specific binary.
if [[ -z "$VICE_BIN" ]]; then
    if command -v x64sc >/dev/null 2>&1; then
        VICE_BIN="$(command -v x64sc)"
    elif [[ -x "/Applications/vice-arm64-gtk3-3.9/bin/x64sc" ]]; then
        VICE_BIN="/Applications/vice-arm64-gtk3-3.9/bin/x64sc"
    else
        die "x64sc not found on PATH; pass --vice /path/to/x64sc"
    fi
fi
[[ -x "$VICE_BIN" ]] || die "VICE binary not executable: $VICE_BIN"

# --- Materialize a temporary vicerc ------------------------------------------
TEMPLATE="${SCRIPT_DIR}/neohabitat.vicerc"
[[ -f "$TEMPLATE" ]] || die "vicerc template missing: $TEMPLATE"

TMP_HOME="$(mktemp -d -t neohabitat-vice.XXXXXX)"
mkdir -p "${TMP_HOME}/vice"
VICERC="${TMP_HOME}/vice/vicerc"
FLIPLIST="${TMP_HOME}/vice/neohabitat.vfl"

# Substitute the bridge address and disks directory into the template.
# We use ',' as the sed delimiter so paths containing '/' don't need
# escaping.
# Split BRIDGE_ADDR into host and port for the nc pipe.
BRIDGE_HOST="${BRIDGE_ADDR%%:*}"
BRIDGE_PORT="${BRIDGE_ADDR##*:}"
sed \
    -e "s,__DISKS_DIR__,${DISKS_DIR},g" \
    -e "s,__BRIDGE_ADDR__,${BRIDGE_HOST} ${BRIDGE_PORT},g" \
    "$TEMPLATE" > "$VICERC"

# Generate a VICE fliplist (.vfl) so the user can hot-swap the boot disk
# and the B disk on drive 8 with the GUI fliplist controls (Media menu →
# Flip list, or the F8 default hotkey). Both disks live on drive 8; the
# fliplist replaces the previous "drive 8 = boot, drive 9 = B" split.
#
# Format reverse-engineered by handing this exact file to x64sc and
# observing it print "recognized as fliplist file created by VICE":
#
#   # Vice fliplist file
#   UNIT 8
#   <absolute path #1>
#   <absolute path #2>
#
# The list is circular: pressing "next disk in list" cycles through
# every entry and wraps back to the first.
{
    echo "# Vice fliplist file"
    echo "UNIT 8"
    echo "${BOOT_DISK}"
    echo "${B_DISK}"
} > "$FLIPLIST"

if [[ "$PRINT_ONLY" -eq 1 ]]; then
    echo "# Effective vicerc (would be written to ${VICERC}):"
    echo "# x64sc binary: ${VICE_BIN}"
    echo "# bridge addr:  ${BRIDGE_ADDR}"
    echo "# disks dir:    ${DISKS_DIR}"
    echo "# fliplist:     ${FLIPLIST}"
    echo "# ----------------------------------------------------"
    cat "$VICERC"
    echo
    echo "# Fliplist contents:"
    echo "# ----------------------------------------------------"
    cat "$FLIPLIST"
    rm -rf "$TMP_HOME"
    exit 0
fi

# Make sure the temp dir is cleaned up unless the user asked us to keep it.
# We DON'T use `exec` to launch x64sc below, because that would replace the
# shell process before the trap can run. Instead we run x64sc as a child,
# wait for it, and then let the trap fire on EXIT.
if [[ "$KEEP_CONFIG" -eq 0 ]]; then
    trap 'rm -rf "$TMP_HOME"' EXIT
else
    echo "launch-vice.sh: keeping temp config at $TMP_HOME"
fi

# Forward Ctrl-C / SIGTERM to the child so the user can shut x64sc down with
# the usual signals and still get the temp dir cleaned up.
forward_signal() {
    if [[ -n "${VICE_PID:-}" ]]; then
        kill -"$1" "$VICE_PID" 2>/dev/null || true
    fi
}
trap 'forward_signal INT'  INT
trap 'forward_signal TERM' TERM

# --- Launch x64sc -------------------------------------------------------------
# Pointing XDG_CONFIG_HOME at our temp dir means VICE picks up vicerc from
# ${TMP_HOME}/vice/vicerc and ignores the user's normal config — so this
# script can never accidentally clobber a user's existing settings.
echo "launch-vice.sh: bridge=${BRIDGE_ADDR}  disks=${DISKS_DIR}"
echo "launch-vice.sh: x64sc=${VICE_BIN}"
echo "launch-vice.sh: vicerc=${VICERC}"

# We pass:
#   -ntsc                — Habitat is an NTSC product (Q-Link was North
#                          America only). The CLI flag is the unambiguous
#                          way to set the sync factor.
#   -chdir DISKS_DIR     — so any relative paths inside the vicerc resolve.
#   -autostart BOOT_DISK — start the C64, attach Habitat-Boot.d64, and run.
#   -flipname FLIPLIST   — preload drive 8's fliplist with both disks so
#                          the user can hot-swap (Media menu → Flip list).
env HOME="${TMP_HOME}" XDG_CONFIG_HOME="${TMP_HOME}" "$VICE_BIN" \
    -config "${VICERC}" \
    -ntsc \
    -remotemonitor -remotemonitoraddress 127.0.0.1:6510 \
    -sound -sounddev dummy \
    -userportdevice 2 -rsuserbaud 1200 -rsuserdev 0 \
    -rsdev1 "|nc ${BRIDGE_HOST} ${BRIDGE_PORT}" \
    +rsdev1ip232 \
    -chdir "${DISKS_DIR}" \
    -autostart "${BOOT_DISK}" \
    -flipname "${FLIPLIST}" \
    ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"} &
VICE_PID=$!

# `wait` returns the child's exit status. The `|| VICE_RC=$?` dance keeps
# `set -e` from short-circuiting on a non-zero VICE exit code.
VICE_RC=0
wait "$VICE_PID" || VICE_RC=$?
exit "$VICE_RC"
