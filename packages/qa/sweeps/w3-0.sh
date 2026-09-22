#!/bin/bash
# The W3.0 bounding sweep: packages/qa/sweeps/w3-0.sh [--dry-run | --list] [<batch> ...]
#
# Every run opens a full-screen window on the desktop and holds it until the
# run ends. Never start this script, or leave an agent to start it, without
# the user's go-ahead. --dry-run and --list open nothing.
#
# With no batch named, runs every batch in order. Each run goes through
# runqa.sh, and the sweep stops on the first failure. The matrix, the cell
# shape and the reading rule are in plans/implemented/w3-0-bounding-sweep.md.
#
#   W3_SESSION          run-name session tag (default s1): names are w3<session>-<batch>-<cell>-<arm>-<rep>
#   W3_C40_BEFORE_LIB   a built packages/lib at 3e36ca60: the wt arm of batch b19
#   W3_RUNQA            the runner to call (default runqa.sh beside this directory); tests point it at a stub
#   QA_MAIN_LIB         as for runqa.sh (default: this checkout's packages/lib)
#
#   exit 0   every selected run passed (or --dry-run / --list finished)
#   exit 1   a run failed; the sweep stopped there
#   exit 2   bad arguments or a missing build; nothing was started
set -u
QA=$(cd "$(dirname "$0")/.." && pwd)
RUNQA=${W3_RUNQA:-$QA/runqa.sh}
SESSION=${W3_SESSION:-s1}

# Every run of the sweep carries exactly these instruments, so every arm of a
# cell pays the same instrument cost and every phase is geometry-gated.
FLAGS='work=1&seam=1&geom=1'

BATCHES="b00 b01 b02 b03 b04 b05 b06 b07 b08 b09 b10 b11 b12 b13 b14 b15 b16 b17 b18 b19"

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

# The run name of one run of a cell: w3<session>-<batch>-<cell>-<arm>-<rep>.
name() {
    printf 'w3%s-%s-%s-%s-%s' "$SESSION" "$BATCH" "$1" "$2" "$3"
}

# One run of an ablated arm on the main build.
arm() {
    run "$(name "$1" "$3" "$4")" main "$2&$FLAGS&abl=$3"
}

# One plain run on the main build.
plain() {
    run "$(name "$1" plain "$3")" main "$2&$FLAGS"
}

# A baseline cell: one plain run.
base() {
    plain "$1" "$2" a
}

# A scored cell: plain-a, each arm once, plain-b, each arm again in reverse
# order, plain-c.
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

# A check cell, for counts that do not drift: plain-a, each arm once, plain-b.
check() {
    local cell=$1 params=$2 a
    shift 2

    plain "$cell" "$params" a

    for a in "$@"; do
        arm "$cell" "$params" "$a" 1
    done

    plain "$cell" "$params" b
}

# A witness pair: the pre-fix build (wt), then this build (main).
pair() {
    run "$(name "$1" before 1)" wt "$2&$FLAGS"
    run "$(name "$1" after 1)" main "$2&$FLAGS"
}

batch_b00() {
    BATCH=b00
    base sdh 'panel=shell-deep&drive=drag,wheel:120'
    base sd4h 'panel=shell-deep&n=4&drive=drag,wheel:120,theme:4'
    base sds 'panel=shell-deep&grip=sidebar&drive=park,drag,theme:4'
    base sdv 'panel=shell-deep&grip=dock-v&drive=drag'
    base sss 'panel=shell-shallow&grip=sidebar&drive=park,drag,theme:4'
    base cl 'panel=chart-line&drive=passes,resize'
    base cd50 'panel=chart-dashboard&n=50&drive=passes'
    base cd 'panel=chart-dashboard&drive=resize,drag'
    base tr 'panel=table-rows&drive=key,update,passes,wheel'
    base tt 'panel=treetable-rows&drive=key,toggle:20'
    base tn 'panel=tree-nodes&drive=passes,key'
    base li 'panel=list-items&drive=passes,key'
    base li1 'panel=list-items&n=1&drive=key'
    base md 'panel=markdown-doc&drive=passes,drag,theme:4'
    base mdu 'panel=markdown-doc&drive=update:20'
    base mdu480 'panel=markdown-doc&n=480&drive=update:20'
    base cv 'panel=canvas-idle&drive=idle'
    base dg 'panel=diagram-graph&drive=click,pan,wheel:10'
    base cdoc 'panel=code-document&drive=passes,wheel,resize,key,drag,type'
    base me 'panel=markdown-editor&drive=call:40,type'
    base wh 'panel=windows&grip=header&drive=drag:40,drag:80'
    base we 'panel=windows&grip=edge&drive=drag,passes,viewport,toggle:60'
    base ffh 'panel=form-flat&passes=header&type=date&drive=passes,type:10'
    base ffd 'panel=form-flat&passes=date&drive=passes'
    base ffc 'panel=form-flat&passes=combo&drive=passes'
    base fnh 'panel=form-nested&passes=header&drive=passes'
    base mn 'panel=menus&drive=toggle'
    base tw 'panel=table-wide&drive=hwheel,passes,wheel,resize,key'
}

batch_b01() {
    BATCH=b01
    ab sdh 'panel=shell-deep&drive=drag' g09.all g09.chrome split.recalc-gate
}

batch_b02() {
    BATCH=b02
    ab sdp 'panel=shell-deep&drive=park' split.noop-drag split.recalc-gate
    ab ssp 'panel=shell-shallow&drive=park' split.noop-drag
}

batch_b03() {
    BATCH=b03
    ab sds 'panel=shell-deep&grip=sidebar&drive=drag' g14.closed-section
    ab sss 'panel=shell-shallow&grip=sidebar&drive=drag' g14.closed-section
}

batch_b04() {
    BATCH=b04
    ab sdr 'panel=shell-deep&drive=resize' g05.lazy-reads g11.gather-residue g09.all g09.chrome
    ab ssr 'panel=shell-shallow&drive=resize' g05.lazy-reads g11.gather-residue g09.all g09.chrome
}

batch_b05() {
    BATCH=b05
    ab sdq 'panel=shell-deep&drive=passes' split.recalc-gate g09.all
    ab ssq 'panel=shell-shallow&drive=passes' split.recalc-gate g09.all
}

batch_b06() {
    BATCH=b06
    ab sdt 'panel=shell-deep&toggle=pane&drive=toggle:120' g12.collapse-static
    ab sst 'panel=shell-shallow&toggle=pane&drive=toggle:120' g12.collapse-static
}

batch_b07() {
    BATCH=b07
    ab sd4m 'panel=shell-deep&n=4&drive=theme:10' g25.theme-withhold
    ab ss4m 'panel=shell-shallow&n=4&drive=theme:10' g25.theme-withhold
}

batch_b08() {
    BATCH=b08
    ab cdt 'panel=code-document&drive=type' g18.canvas-width
    ab sdy 'panel=shell-deep&drive=type' g18.canvas-width
    ab ssy 'panel=shell-shallow&drive=type' g18.canvas-width
}

batch_b09() {
    BATCH=b09
    ab clq 'panel=chart-line&drive=passes' chart.repaint-gate chart.margin-memo g18.measure-memo
    ab cdq 'panel=chart-dashboard&n=50&drive=passes' chart.repaint-gate chart.margin-memo g18.measure-memo g11.gather-residue
    check clu 'panel=chart-line&drive=update' chart.repaint-gate chart.margin-memo
    check cdu 'panel=chart-dashboard&n=50&drive=update' chart.repaint-gate chart.margin-memo
    ab cdd 'panel=chart-dashboard&n=50&drive=drag' chart.margin-memo
}

batch_b10() {
    BATCH=b10
    ab clh 'panel=chart-line&drive=hover' g19.tooltip-idle g20.walk-dose
    ab cdh 'panel=chart-dashboard&n=50&drive=hover' g19.tooltip-idle g20.walk-dose
}

batch_b11() {
    BATCH=b11
    ab fnq 'panel=form-nested&passes=form&drive=passes' g05.lazy-reads g11.gather-residue g16.panel-settled g09.all
    ab ffq 'panel=form-flat&passes=form&drive=passes' g05.lazy-reads g11.gather-residue g16.panel-settled g09.all
    check ffh 'panel=form-flat&passes=header&drive=passes' g05.lazy-reads
}

batch_b12() {
    BATCH=b12
    ab fnw 'panel=form-nested&drive=wheel' g16.scroll-reads
    ab ffw 'panel=form-flat&drive=wheel' g16.scroll-reads
    ab fny 'panel=form-nested&type=text&drive=type' g19.tooltip-idle
    ab ffy 'panel=form-flat&type=text&drive=type' g19.tooltip-idle
    ab ffc 'panel=form-flat&click=combo&drive=click' g18.measure-memo
    ab ffk 'panel=form-flat&click=toggle&drive=click' g28.transform-inline
}

batch_b13() {
    BATCH=b13
    ab w8v 'panel=windows&drive=viewport' g08.env-reads
    ab w4v 'panel=windows&n=4&drive=viewport' g08.env-reads
    ab wdlg 'panel=windows&drive=toggle:120' g08.env-reads
    ab wq 'panel=windows&drive=passes' g09.all g09.chrome
    ab mt 'panel=menus&drive=toggle' g08.env-reads g18.measure-memo
}

batch_b14() {
    BATCH=b14
    ab trk 'panel=table-rows&drive=key' g21.render-pass
    ab t9k 'panel=table-rows&n=900&drive=key' g21.render-pass
    ab tru 'panel=table-rows&drive=update' g21.render-pass g23.write-economy
    ab trq 'panel=table-rows&drive=passes' g21.render-pass
    ab ttk 'panel=treetable-rows&drive=key' g21.render-pass
    ab ttu 'panel=treetable-rows&drive=update' g21.render-pass
}

batch_b15() {
    BATCH=b15
    ab trr 'panel=table-rows&drive=resize,idle:4' g22.settle-relay
    ab ttr 'panel=treetable-rows&drive=resize,idle:4' g22.settle-relay
    ab t9f 'panel=table-rows&n=900&update=filter&drive=update' g23.write-economy
    ab t9s 'panel=table-rows&n=900&drive=click' g23.write-economy
    ab trw 'panel=table-rows&drive=wheel' g21.render-pass g23.write-economy
}

batch_b16() {
    BATCH=b16
    ab li3 'panel=list-items&drive=key' g24.list-rows
    ab li30 'panel=list-items&n=3000&drive=key' g24.list-rows
    ab tnq 'panel=tree-nodes&drive=passes' g24.tree-window
    ab tnk 'panel=tree-nodes&drive=key' g18.measure-memo
}

batch_b17() {
    BATCH=b17
    ab m60d 'panel=markdown-doc&drive=drag' g26.viewer-resize
    ab m240d 'panel=markdown-doc&n=240&drive=drag' g26.viewer-resize
    ab mdq 'panel=markdown-doc&drive=passes' g26.viewer-resize
    ab m60w 'panel=markdown-doc&drive=wheel' g27.heading-cache
    ab m240w 'panel=markdown-doc&n=240&drive=wheel:300' g27.heading-cache
}

batch_b18() {
    BATCH=b18
    ab cdw 'panel=code-document&drive=wheel' g16.scroll-reads
    ab sdw 'panel=shell-deep&wheel=editor&drive=wheel' g16.scroll-reads
    ab ssw 'panel=shell-shallow&wheel=editor&drive=wheel' g16.scroll-reads
    ab dgp 'panel=diagram-graph&drive=pan' g28.transform-inline
}

batch_b19() {
    BATCH=b19
    export QA_WT_LIB="${W3_C40_BEFORE_LIB:-}"
    pair c40u 'panel=form-flat&drive=update'
    pair c40r 'panel=form-flat&click=root&drive=click'
    pair c40t 'panel=form-flat&click=toggle&drive=click'
    pair c40p 'panel=form-flat&drive=pan'
    run "$(name c21 main 1)" main "panel=form-flat&drive=call:120&$FLAGS"
}

# Stops with exit 2, before any run, when a build the selected batches need is missing.
preflight() {
    local main_lib=${QA_MAIN_LIB:-$QA/../lib} b

    if [ ! -f "$main_lib/dist/lib/core.es.js" ]; then
        echo "no build at $main_lib/dist/lib — run npm run build:lib first" >&2
        exit 2
    fi

    for b in "$@"; do
        if [ "$b" = b19 ] && [ ! -f "${W3_C40_BEFORE_LIB:-/nonexistent}/dist/lib/core.es.js" ]; then
            echo "batch b19 needs W3_C40_BEFORE_LIB set to a built packages/lib at 3e36ca60" >&2
            exit 2
        fi
    done
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
    preflight "${selected[@]}"
fi

total=0

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
