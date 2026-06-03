#!/usr/bin/env bash
# Launch the Gas City TUI inside tmux so the live-peek split (enter) works.
#
#   ./tui/start-tmux.sh [--split] [--pct N] [<city>]            # or set GC_CITY_NAME
#   ./tui/start-tmux.sh --target mayor [--pct N] [<city>]       # pin beside a session
#   npm --workspace tui run start:tmux -- [flags] [<city>]
#
# Default: if you are already inside tmux, the TUI takes over the current pane
# (enter-peek then splits that window); otherwise it creates a dedicated
# `gc-tui` session so the TUI has a tmux to split into.
#
# --split: pin the dashboard BESIDE the current pane instead of taking it over.
# Run it from inside the tmux window you want split; it adds a right-hand pane
# running the TUI and leaves your original pane in place. Outside tmux there is
# no window to split, so --split falls back to the dedicated `gc-tui` session.
#
# --target <session>: pin the dashboard beside a NAMED gc session FROM ANYWHERE
# (no need to attach first). gc runs each city's tmux on a socket named after
# the city, so this splits `tmux -L <city> -t <session>`. e.g. --target mayor
# adds the dashboard to the right of the mayor's window; then
# `gc session attach mayor` shows both. Override the socket with --socket.
#
# Mouse: pinned companion panels (--split / --target) default to --no-mouse, so
# tmux keeps the mouse and you can DRAG the pane border to resize it (scroll the
# lists with the keyboard). A standalone launch keeps wheel-scroll. Force either
# with --mouse / --no-mouse.
set -euo pipefail

usage() {
  sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

split=0
pct=40
city=""
target=""
socket=""
mouse_pref="" # "", "on", or "off" — empty means auto (companion → off)
while [ $# -gt 0 ]; do
  case "$1" in
    --split) split=1; shift ;;
    -l | --pct) pct="${2:-40}"; shift 2 ;;
    --target) target="${2:-}"; shift 2 ;;
    --socket) socket="${2:-}"; shift 2 ;;
    --mouse) mouse_pref="on"; shift ;;
    --no-mouse) mouse_pref="off"; shift ;;
    --city) city="${2:-}"; shift 2 ;;
    --city=*) city="${1#--city=}"; shift ;;
    --help) usage; exit 0 ;;
    *) city="$1"; shift ;;
  esac
done
city="${city:-${GC_CITY_NAME:-}}"
socket="${socket:-$city}" # gc's per-city tmux socket is named after the city
pct="${pct%\%}"           # accept "40" or "40%"

# Companion modes (--split / --target) open the truncated overview via --compact;
# a plain launch keeps the full dashboard default.
compact=0
{ [ -n "$target" ] || [ "$split" = "1" ]; } && compact=1

# Pinned companion panels default to tmux-owned mouse so the pane is
# drag-resizable (the TUI releases the wheel; keyboard nav still scrolls). A
# standalone launch keeps wheel-scroll. --mouse / --no-mouse force either way.
no_mouse=0
if [ "$mouse_pref" = "off" ]; then
  no_mouse=1
elif [ "$mouse_pref" = "on" ]; then
  no_mouse=0
elif [ "$compact" = "1" ]; then
  no_mouse=1
fi

app_args=""
[ -n "$city" ] && app_args="--city=$city"
[ "$no_mouse" = "1" ] && app_args="$app_args --no-mouse"
[ "$compact" = "1" ] && app_args="$app_args --compact"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
run="cd '$root' && npm --workspace tui run start -- $app_args"

# Split horizontally, running $run in the new pane. `-d` keeps focus on the
# ORIGINAL pane (e.g. the mayor) — the dashboard is a glance panel beside your
# work, not where you type, so stealing focus to it breaks typing in the pane you
# were in. `-L <socket>` is a server flag (before the subcommand); `-t <target>`
# is a split-window flag (after it), so they go in separate argv slots. `-l N%`
# is tmux >= 3.1; `-p N` is the pre-3.1 fallback.
split_h() { # split_h <socket-or-empty> <target-or-empty>
  local srv=() cmd=()
  [ -n "$1" ] && srv=(-L "$1")
  [ -n "$2" ] && cmd=(-t "$2")
  tmux "${srv[@]}" split-window -d -h "${cmd[@]}" -l "${pct}%" "$run" 2>/dev/null ||
    tmux "${srv[@]}" split-window -d -h "${cmd[@]}" -p "$pct" "$run"
}

start_dedicated_session() {
  # Start a CLEAN dedicated session: kill any stale `gc-tui` (orphan peek panes
  # from a previous run) first, then create fresh.
  tmux kill-session -t gc-tui 2>/dev/null || true
  exec tmux new-session -s gc-tui "$run"
}

# --target: split a named session on the city socket, from anywhere.
if [ -n "$target" ]; then
  if [ -z "$socket" ]; then
    echo "start-tmux.sh: --target needs a socket; pass a <city> or --socket <name>." >&2
    exit 2
  fi
  if ! tmux -L "$socket" has-session -t "$target" 2>/dev/null; then
    echo "start-tmux.sh: no tmux session '$target' on socket '$socket'." >&2
    echo "  sessions on '$socket':" >&2
    tmux -L "$socket" list-sessions -F '    #{session_name}' 2>/dev/null >&2 ||
      echo "    (socket '$socket' not found — is the city running?)" >&2
    exit 1
  fi
  split_h "$socket" "$target"
  echo "Dashboard pinned beside '$target' (socket '$socket'). Attach with: gc session attach $target"
  exit 0
fi

# --split: pin beside the current pane (must already be in a tmux window).
if [ "$split" = "1" ]; then
  if [ -n "${TMUX:-}" ]; then
    split_h "" ""
  else
    echo "start-tmux.sh: --split needs an existing tmux window to split into;" >&2
    echo "  not inside tmux, so launching the dedicated 'gc-tui' session instead." >&2
    start_dedicated_session
  fi
  exit 0
fi

# default
if [ -n "${TMUX:-}" ]; then
  # Already in tmux — run directly; enter-peek splits the current window.
  eval "$run"
else
  start_dedicated_session
fi
