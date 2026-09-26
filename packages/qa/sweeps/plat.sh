#!/bin/bash
# The platform-call cost sweep: packages/qa/sweeps/plat.sh [--dry-run | --list] [<batch> ...]
#
# Every run opens a full-screen window on the desktop and holds it until the
# run ends. Never start this script, or leave an agent to start it, without
# the user's go-ahead. --dry-run and --list open nothing.
#
# With no batch named, runs every batch in order. Each run goes through
# runqa.sh, and the sweep stops on the first failure. The matrix, the cell
# shape and the three gates a reading passes are in
# plans/implemented/platform-call-cost-sweep.md.
#
#   PLAT_SESSION   run-name session tag (default s1): names are plat<session>-<batch>-<cell>-<arm>-<rep>
#   PLAT_RUNQA     the runner to call (default runqa.sh beside this directory); tests point it at a stub
#   QA_MAIN_LIB    as for runqa.sh (default: this checkout's packages/lib)
#
#   exit 0   every selected run passed (or --dry-run / --list finished)
#   exit 1   a run failed; the sweep stopped there
#   exit 2   bad arguments or a missing build; nothing was started
set -u
QA=$(cd "$(dirname "$0")/.." && pwd)
RUNQA=${PLAT_RUNQA:-$QA/runqa.sh}
SESSION=${PLAT_SESSION:-s1}

# Every run of the sweep carries exactly these instruments, so every arm of a
# cell pays the same instrument cost and every phase is geometry-gated.
FLAGS='work=1&seam=1&geom=1&plat=1'

# The one declared exception: batch p01's ohn cell runs without the platform
# counters, because its whole purpose is to price them.
FLAGS_NOPLAT='work=1&seam=1&geom=1'

BATCHES="p00 p01 p02 p03 p04 p05"

# The census: one cell per panel, <tag>:<panel id>, driven at the panel's own
# defaultDrive. Alphabetical by panel id, so p00's first cell — and with it the
# warm-up's parameters — never depends on the order the panels were added in.
CENSUS="cv:canvas-idle cd:chart-dashboard cl:chart-line cdoc:code-document dg:diagram-graph et:editor-tabs \
ff:form-flat fn:form-nested li:list-items md:markdown-doc me:markdown-editor mn:menus sp:scroll-panes \
sd:shell-deep ss:shell-shallow tr:table-rows tw:table-wide tm:text-metrics tn:tree-nodes tt:treetable-rows \
wh:windows"

# The three table-rows cells at the scale the sweep prices. n=900 sorts and
# filters on the main thread — AbstractStore hands a view rebuild to its worker
# only at 1,000 records, and a page-installed shim never sees a worker's calls
# — so 900 is both the measurable scale and the one that matters. t9c is G23's
# own click cell and the busiest surface here, t9u its filter cell and the
# calibration control, t9k the arrow-key cell that reaches isRenderedVisible.
T9C='panel=table-rows&n=900&drive=click'
T9U='panel=table-rows&n=900&drive=update&update=filter'
T9K='panel=table-rows&n=900&drive=key'

MODE=run
BATCH=
RUNS=0

# One run: prints it under --dry-run, counts it under --list, and otherwise
# runs it and stops the sweep on its first failure.
run() {
    RUNS=$((RUNS + 1))

    case "$MODE" in
        dry) printf 'runqa %s %s %s\n' "$1" "$2" "$3" ;;
        list) ;;
        *) "$RUNQA" "$1" "$2" "$3" || exit 1 ;;
    esac
}

# The run name of one run of a cell: plat<session>-<batch>-<cell>-<arm>-<rep>.
name() {
    printf 'plat%s-%s-%s-%s-%s' "$SESSION" "$BATCH" "$1" "$2" "$3"
}

# One run of an ablated arm on the main build.
arm() {
    run "$(name "$1" "$3" "$4")" main "$2&$FLAGS&abl=$3"
}

# One plain run on the main build.
plain() {
    run "$(name "$1" plain "$3")" main "$2&$FLAGS"
}

# One plain run without the platform counters, for p01's ohn cell alone.
plain_noplat() {
    run "$(name "$1" plain "$3")" main "$2&$FLAGS_NOPLAT"
}

# A baseline cell: one plain run.
base() {
    plain "$1" "$2" a
}

# A scored cell: plain-a, each arm once, plain-b, each arm again in reverse
# order, plain-c, so a drift that is linear over the cell cancels in every arm.
ab() {
    local cell=$1 params=$2 i
    shift 2
    local arms=("$@")

    plain "$cell" "$params" a

    for ((i = 0; i < ${#arms[@]}; i++)); do
        arm "$cell" "$params" "${arms[$i]}" 1
    done

    plain "$cell" "$params" b

    for ((i = ${#arms[@]} - 1; i >= 0; i--)); do
        arm "$cell" "$params" "${arms[$i]}" 2
    done

    plain "$cell" "$params" c
}

# The parameters of the census's first cell, which the warm-up borrows.
first_census_params() {
    local first=${CENSUS%% *}

    printf 'panel=%s' "${first#*:}"
}

# One discarded run before the first selected batch. The campaign has a
# recorded cold-start outlier of 97.69 ms against 31 to 36 for the rest of its
# cell, so the first run of an invocation is never read: no cell prefix matches
# this name and no analyser reads it.
warmup() {
    run "plat$SESSION-warm" main "$(first_census_params)&$FLAGS"
}

batch_p00() {
    BATCH=p00
    local entry

    for entry in $CENSUS; do
        base "${entry%%:*}" "panel=${entry#*:}"
    done

    base t9c "$T9C"
    base t9u "$T9U"
    base t9k "$T9K"
}

# The overhead witness: three plain runs with the platform counters and three
# without, on the busiest surface in the sweep. The two groups' avg ranges must
# overlap, or the shim costs measurable time and no price is valid.
batch_p01() {
    BATCH=p01
    local rep

    for rep in a b c; do
        plain ohw "$T9C" "$rep"
    done

    for rep in a b c; do
        plain_noplat ohn "$T9C" "$rep"
    done
}

batch_p02() {
    BATCH=p02
    ab t9c "$T9C" plat.intl-d1 plat.intl-d4 plat.collate-d1 plat.collate-d4
    ab t9u "$T9U" plat.intl-d1 plat.intl-d4
}

batch_p03() {
    BATCH=p03
    ab t9k "$T9K" plat.computed-d1 plat.computed-d4
    ab twh 'panel=table-wide&drive=hwheel' plat.computed-d1 plat.computed-d4
}

batch_p04() {
    BATCH=p04
    ab tm 'panel=text-metrics&drive=passes,update:24' plat.measure-d1 plat.measure-d4
    ab cd 'panel=chart-dashboard&drive=resize' plat.measure-d1 plat.measure-d4
}

batch_p05() {
    BATCH=p05
    ab ttk 'panel=treetable-rows&drive=key' plat.collate-d1 plat.collate-d4
}

# Stops with exit 2, before any run, when the build every batch needs is missing.
preflight() {
    local main_lib=${QA_MAIN_LIB:-$QA/../lib}

    if [ ! -f "$main_lib/dist/lib/core.es.js" ]; then
        echo "no build at $main_lib/dist/lib — run npm run build:lib first" >&2
        exit 2
    fi
}

case "${1:-}" in
    --dry-run) MODE=dry; shift ;;
    --list) MODE=list; shift ;;
esac

selected=("$@")

if [ ${#selected[@]} -eq 0 ]; then
    read -r -a selected <<< "$BATCHES"
fi

for b in "${selected[@]}"; do
    case " $BATCHES " in
        *" $b "*) ;;
        *) echo "unknown batch \"$b\" (batches: $BATCHES)" >&2; exit 2 ;;
    esac
done

if [ "$MODE" = run ]; then
    preflight
fi

RUNS=0
warmup
total=$RUNS

for b in "${selected[@]}"; do
    RUNS=0
    "batch_$b"
    total=$((total + RUNS))

    if [ "$MODE" = list ]; then
        printf '%s %d\n' "$b" "$RUNS"
    fi
done

if [ "$MODE" = list ]; then
    printf 'total %d\n' "$total"
fi
