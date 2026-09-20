#!/bin/bash
# One QA measurement run: packages/qa/runqa.sh [--host <host>] <name> <main|wt> [query-params]
#
# Every run opens a full-screen window on the desktop and holds it until the
# run ends. Never start one, or leave an agent to start one, without the
# user's go-ahead.
#
# Starts the QA app's Vite server on the arm's library build, opens the page in
# the host, waits for the result, stops both, and hands the result to
# bin/qa-verdict.py. See README.md.
#
#   --host   minibrowser (default)
#   main     QA_MAIN_LIB, default this checkout's packages/lib
#   wt       QA_WT_LIB, required
#
#   exit 0   result written, no error        (prints the result path)
#   exit 1   error result, or NO RESULT       (prints the error, or NO RESULT and the Vite log path)
#   exit 2   bad arguments, no build, or a host that cannot start   (before anything starts)
#
# Kills Vite by port, never with pkill -f — that matched the calling shell once.
set -u
QA=$(cd "$(dirname "$0")" && pwd)

# Hosts this runner can start. Adding one adds its name here and one branch to
# each of check_host, start_host and stop_host.
HOSTS="minibrowser"

# Must match QA_PORT in vite.config.ts.
PORT=5190

# Seconds between checks for the result: short beside any run, long enough
# that the polling costs nothing.
POLL_S=0.5

# How long to wait for Vite to answer, as tries of VITE_POLL_S each (40 s):
# Loom's allowance for a cold start.
VITE_TRIES=80
VITE_POLL_S=0.5

# Seconds to wait for a result: about twice the longest Loom-shaped run on
# record, so a cold start fits and a hang still ends within two minutes.
TIMEOUT_S=${QA_TIMEOUT:-120}

MINIBROWSER=${QA_MINIBROWSER:-/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser}
HOST_PID=

# Prints the usage line and exits 2.
usage() {
    echo "usage: packages/qa/runqa.sh [--host <host>] <name> <main|wt> [query-params]" >&2
    exit 2
}

# Checks that the host can start, before anything else is started.
check_host() {
    case "$1" in
        minibrowser)
            if [ ! -x "$MINIBROWSER" ]; then
                echo "[$name] no MiniBrowser at $MINIBROWSER — set QA_MINIBROWSER" >&2
                exit 2
            fi
            ;;
    esac
}

# Opens the page in the host and records its process in HOST_PID.
start_host() {
    case "$1" in
        minibrowser)
            "$MINIBROWSER" --full-screen "$2" > "$QA/logs/host-$name.log" 2>&1 &
            HOST_PID=$!
            ;;
    esac
}

# Stops the host; safe to call when none started.
stop_host() {
    case "$1" in
        minibrowser)
            if [ -n "$HOST_PID" ]; then
                kill "$HOST_PID" 2>/dev/null
            fi
            HOST_PID=
            ;;
    esac
}

# Stops whatever listens on the QA port: a stale QA server, or this run's.
kill_vite() {
    for pid in $(ss -ltnp 2>/dev/null | awk "/:$PORT /" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
        kill "$pid" 2>/dev/null
    done
    sleep 1
}

# Leaves nothing running however the run ends.
cleanup() {
    stop_host "$host"
    kill_vite
    rm -f "$marker"
}

host=minibrowser
if [ "${1:-}" = --host ]; then
    [ $# -ge 2 ] || usage
    host=$2
    shift 2
fi

[ $# -ge 2 ] || usage
name=$1; which=$2; extra=${3:-}

case " $HOSTS " in
    *" $host "*) ;;
    *)
        echo "unknown host \"$host\" (supported: ${HOSTS// /, })" >&2
        exit 2
        ;;
esac

case "$which" in
    main)
        lib=$(realpath "${QA_MAIN_LIB:-$QA/../lib}")
        ;;
    wt)
        if [ -z "${QA_WT_LIB:-}" ]; then
            echo "[$name] the wt arm needs QA_WT_LIB set to a built packages/lib" >&2
            exit 2
        fi
        lib=$(realpath "$QA_WT_LIB")
        ;;
    *)
        usage
        ;;
esac

if [ ! -f "$lib/dist/lib/core.es.js" ]; then
    echo "[$name] no build at $lib/dist/lib — build the library first" >&2
    exit 2
fi

check_host "$host"

# Nothing has started before this point.
marker=$(mktemp)
trap cleanup EXIT
mkdir -p "$QA/logs" "$QA/results"

kill_vite
(cd "$QA" && QA_LIB="$lib" npx vite > "$QA/logs/vite-$name.log" 2>&1 &)
for _ in $(seq 1 "$VITE_TRIES"); do
    curl -sf -o /dev/null "http://localhost:$PORT/" && break
    sleep "$VITE_POLL_S"
done

url="http://localhost:$PORT/?qa=$name&host=$host${extra:+&$extra}"
echo "[$name] $which -> $url"
start_host "$host" "$url"

# Wait for the result, not for a timeout: stop as soon as one appears or the
# host exits.
result=
deadline=$((SECONDS + TIMEOUT_S))
while [ "$SECONDS" -lt "$deadline" ]; do
    result=$(find "$QA/results" -name "$name-*.json" -newer "$marker" | sort | tail -1)
    [ -n "$result" ] && break
    kill -0 "$HOST_PID" 2>/dev/null || break
    sleep "$POLL_S"
done
stop_host "$host"

# The host may have exited just after writing.
[ -n "$result" ] || result=$(find "$QA/results" -name "$name-*.json" -newer "$marker" | sort | tail -1)

if [ -z "$result" ]; then
    echo "[$name] NO RESULT — see $QA/logs/vite-$name.log" >&2
    exit 1
fi

verdict=$(python3 "$QA/bin/qa-verdict.py" "$result")
code=$?
printf '%s\n' "$verdict" | sed "s/^/[$name] /"
exit "$code"
