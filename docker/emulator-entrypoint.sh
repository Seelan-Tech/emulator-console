#!/bin/sh
# Records which emulator build is running, next to the credentials it writes, so the console (which only sees that
# folder) can show it. The version is not available over the network. Then starts the emulator unchanged.
port="${EMULATOR_DATA_PORT:-9297}"
prev=""
for arg in "$@"; do
  case "$arg" in
    --port=*) port="${arg#--port=}" ;;
    *) case "$prev" in -p | --port) port="$arg" ;; esac ;;
  esac
  prev="$arg"
done
case "$port" in
  '' | *[!0-9]* | 0) ;; # port 0 picks a random one: nowhere stable to write to
  *)
    dir="$HOME/.aws/emulator/$port"
    if mkdir -p "$dir" 2>/dev/null; then
      aws-emulator --version >"$dir/version.tmp" 2>/dev/null && mv "$dir/version.tmp" "$dir/version" || rm -f "$dir/version.tmp"
    fi
    ;;
esac
exec aws-emulator "$@"
