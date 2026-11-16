#!/usr/bin/env bash
# A throwaway compose stack for the Playwright suite, so e2e never touches your own emulator or database.
#
#   scripts/e2e-stack.sh up   <local|restart>   start it (own ports, state dir, database volume)
#   scripts/e2e-stack.sh down <local|restart>   remove it, with its volumes
#   scripts/e2e-stack.sh env  <mode>                  print the variables the Playwright run needs
#   scripts/e2e-stack.sh run  <mode> [playwright args]  up, run the suite, always down
#
# local: the default suite.
# restart: local mode, and the spec is allowed to restart this stack's emulator.
set -euo pipefail
cd "$(dirname "$0")/.."

cmd="${1:?usage: e2e-stack.sh up|down|env|run <local|restart>}"
mode="${2:?mode required: local|restart}"
shift 2 || true

case "$mode" in
  local) offset=1 ;;
  restart) offset=3 ;;
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac

project="ec-e2e-$mode"
export EMU_PORT=$((9300 + offset)) CONSOLE_PORT=$((3100 + offset))
export EMU_STATE_DIR="${E2E_STATE_ROOT:-$PWD/.e2e}/$mode"
compose=(docker compose -p "$project")

case "$cmd" in
  up)
    mkdir -p "$EMU_STATE_DIR"
    chmod 777 "$EMU_STATE_DIR" # the emulator runs as uid 1000
    printf '[telemetry]\nenabled = false\n' > "$EMU_STATE_DIR/config.toml" || true
    "${compose[@]}" up -d --build --wait --wait-timeout 240
    # the console answers once migrations are done; the emulator writes its credentials a moment after start
    for _ in $(seq 1 60); do
      curl -fsS "http://localhost:$CONSOLE_PORT/api/health" >/dev/null 2>&1 && break
      sleep 2
    done
    ;;
  down)
    "${compose[@]}" down -v --remove-orphans
    rm -rf "$EMU_STATE_DIR"
    ;;
  env)
    echo "E2E_MODE=$mode E2E_BASE_URL=http://localhost:$CONSOLE_PORT E2E_COMPOSE_PROJECT=$project"
    ;;
  run)
    trap '"$0" down "$mode" || true' EXIT
    "$0" up "$mode"
    export E2E_MODE="$mode" E2E_BASE_URL="http://localhost:$CONSOLE_PORT" E2E_COMPOSE_PROJECT="$project"
    npx playwright test "$@"
    ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
