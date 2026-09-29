#!/bin/bash
# The v0.10.0 release sweep: packages/qa/sweeps/release-v0-10-0.sh [--dry-run | --list] [<batch> ...]
#
# Every run opens a full-screen window on the desktop and holds it until the
# run ends. Never start this script, or leave an agent to start it, without
# the user's go-ahead. --dry-run and --list open nothing.
#
# With no batch named, runs every batch in order. Each run goes through
# runqa.sh, and the sweep stops on the first failure. The cells and the
# reading rule are in plans/research/render-review-2026-09-15/
# 00-post-campaign-agenda.md, section "Owed manual verification, consolidated
# (2026-09-29)"; the arm choice below departs from what that section
# specified, and says why.
#
# This is a LIBRARY A/B, not an ablation sweep: unlike w3-0.sh and plat.sh,
# which drive `abl=` arms against one build, every cell here runs the *same*
# parameters against two library builds through runqa.sh's `wt` and `main` arm
# arguments. No run carries `abl=`.
#
# TWO `wt` ARMS, AND WHY.
#
# The agenda specified v0.9.0 against v0.10.0. v0.9.0 is 2026-09-07, eight
# days before the render-review campaign's first review: 852 commits and 115
# merged branches separate the tags, including every wave of the campaign. On
# that pair three of the four plans' "flat clock expected" gates are
# unreadable, because the same panels carry large wins from unrelated wave-3
# plans. So the four plans' cells run against the *tight* arm instead —
# `5a2f4960`, the commit immediately below the earliest of the four merges on
# v0.10.0's first-parent chain. Its delta to v0.10.0 is ten merges, four of
# them the plans that owe these cells, one of them QA-app-only (it touches no
# library source at all), and five others.
#
# The `canvas-idle-loops` visibility-walk cell cannot use that arm: that
# branch merged on 2026-09-21, well below `5a2f4960`, so the tight arm already
# contains the walk and a tight pair would measure nothing. Batch r5 therefore
# keeps the v0.9.0 arm, and its reading is a cost direction rather than an
# attribution — see the batch's own comment.
#
#   REL_SESSION         run-name session tag (default s1): names are rel<session>-<batch>-<cell>-<arm>-<rep>
#   REL_RUNQA           the runner to call (default runqa.sh beside this directory); tests point it at a stub
#   QA_WT_LIB           the tight arm's built packages/lib      (default .worktrees/_arm-tight/packages/lib, 5a2f4960)
#   QA_MAIN_LIB         the v0.10.0 arm's built packages/lib    (default .worktrees/_arm-v100/packages/lib)
#   REL_WALK_WT_LIB     batch r5's `wt` arm                     (default .worktrees/_arm-v090/packages/lib, v0.9.0)
#   REL_WALK_MAIN_LIB   batch r5's `main` arm                   (default: QA_MAIN_LIB)
#
# runqa.sh reads QA_WT_LIB and QA_MAIN_LIB from its own environment on each
# invocation, and every run here is a separate child process, so a batch can
# swap either arm for its own runs alone. Batch r5 does exactly that and puts
# both back afterwards, because later batches follow it in the same shell.
#
# REL_WALK_MAIN_LIB exists so the walk can be measured properly without
# editing this file: the pair that actually isolates it is `33e33af7^1`
# against `33e33af7` (the branch's own merge), which needs two more builds and
# is no longer a release A/B. Point REL_WALK_WT_LIB and REL_WALK_MAIN_LIB at
# those two and batch r5 becomes an attributable reading.
#
# Both library defaults are spelt out rather than inherited, because
# runqa.sh's own QA_MAIN_LIB default is *this checkout's* packages/lib — which
# is master, not the v0.10.0 tag. Preflight therefore prints each arm's path,
# its package version and its commit before the first window opens. The commit
# matters: the tight arm's package.json still reads 0.9.0, because the version
# bump is in v0.10.0's release-prep commit above it, so the version string
# alone cannot tell the tight arm from the v0.9.0 arm.
#
#   exit 0   every selected run passed (or --dry-run / --list finished)
#   exit 1   a run failed; the sweep stopped there
#   exit 2   bad arguments or a missing build; nothing was started
set -u
QA=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(cd "$QA/../.." && pwd)
RUNQA=${REL_RUNQA:-$QA/runqa.sh}
SESSION=${REL_SESSION:-s1}

export QA_WT_LIB=${QA_WT_LIB:-$ROOT/.worktrees/_arm-tight/packages/lib}
export QA_MAIN_LIB=${QA_MAIN_LIB:-$ROOT/.worktrees/_arm-v100/packages/lib}

REL_WALK_WT_LIB=${REL_WALK_WT_LIB:-$ROOT/.worktrees/_arm-v090/packages/lib}
REL_WALK_MAIN_LIB=${REL_WALK_MAIN_LIB:-$QA_MAIN_LIB}

# Every run of the sweep carries exactly these instruments, so every arm of a
# cell pays the same instrument cost and every phase is geometry-gated. The
# recorded protocol names this set; no cell here deviates from it.
FLAGS='work=1&seam=1&geom=1'

# r1-r4 are the four plans that owe cells, on the tight arm. r5 is the
# canvas-idle-loops visibility walk, on the v0.9.0 arm. r6 and r7 are the rest
# of field-internals-unchanged-commit-opt-in's own E14 gate, which the agenda
# narrowed to r1's two counter cells; they are selectable so the plan's full
# gate can be read without being forced on every sitting.
BATCHES="r1 r2 r3 r4 r5 r6 r7"

# The warm-up's parameters, fixed rather than borrowed from the first selected
# batch, so which batches are chosen never changes what the discarded run
# measured. The campaign has a recorded cold-start outlier of 97.69 ms against
# 31 to 36 for the rest of its cell, and the split-noop cell's own recipe
# discards a first run for the same reason.
WARMUP_PARAMS='panel=form-flat&passes=form&drive=passes'

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

# The run name of one run of a cell: rel<session>-<batch>-<cell>-<arm>-<rep>.
# The batch is part of the name so that r4's `tw` and r5's `twv` — the same
# panel against different arms — cannot be read by one prefix glob.
name() {
    printf 'rel%s-%s-%s-%s-%s' "$SESSION" "$BATCH" "$1" "$2" "$3"
}

# One run of one cell on one arm: <cell> <params> <main|wt> <rep>.
one() {
    run "$(name "$1" "$3" "$4")" "$3" "$2&$FLAGS"
}

# One cell: five runs, interleaved wt-a, main-1, wt-b, main-2, wt-c.
#
# The interleave is the whole reason the reading is trustworthy, and it is not
# a formality. A sitting drifts — the engine warms, the compositor's own load
# moves, the machine heats — so three runs of one arm followed by two of the
# other charges the whole session's drift to the arm that ran second. Taking
# the arms in turn makes a drift that is linear over the cell cancel: the two
# `main` runs sit either side of `wt-b`, and the three `wt` runs bracket both
# of them. That also makes the cell state its own noise floor, because the
# bracket a delta is judged against is the spread of the three `wt` runs
# themselves, measured in the same sitting as the runs it judges. Absolutes
# are never compared across sittings, only the within-cell delta.
ab() {
    one "$1" "$2" wt   a
    one "$1" "$2" main 1
    one "$1" "$2" wt   b
    one "$1" "$2" main 2
    one "$1" "$2" wt   c
}

# One discarded run before the first selected batch, on the arm every cell
# opens with. No cell prefix matches this name and no analyser reads it.
warmup() {
    run "rel$SESSION-warm" wt "$WARMUP_PARAMS&$FLAGS"
}

# E14's counter cells, as the agenda scopes them: the four residual doLayout
# counters stage 3 named must reach 0 on the v0.10.0 arm, @DateField and
# @TimeField may stay non-zero, and the clock is expected flat. The @DateField
# reading is a read on the new arm rather than a comparison — the plan records
# what makes a settled picker field lay out at all as unidentified.
#
# The counter gate is clean on the tight arm: field-internals is the only
# merge in the delta that touches component/input/. The *clock* is not — both
# panels' `passes=form` target is a Panel (builders/form.ts formRoot returns
# the scroller, or a Split-managed Panel for the nested form), so the same
# unit also pays or skips panel-scroll-read-economy's settled remeasure. Read
# the counters, not the milliseconds.
batch_r1() {
    BATCH=r1
    ab ffq 'panel=form-flat&passes=form&drive=passes'
    ab fnq 'panel=form-nested&passes=form&drive=passes'
}

# F06.3's gate on the shipped opt-in predicate. Expect work.sidebar.doLayout
# and work.main.doLayout to fall from about 0.99 to about 0 per unit on
# `main`; those two counters are the noop-drag gate's own engagement and
# nothing else in the delta can move them.
#
# This cell's GEOMETRY GATE IS VOID on any pairing whose `main` is v0.10.0,
# and a `geom` diff here is expected rather than a failure. The delta contains
# split-drag-unclamped-geometry, which is stacked directly on this branch
# (its own front-matter declares depends-on: split-noop-drag-frame-gate) and
# whose entire subject is the geometry of a drag held past a pane's clamp —
# it closes a 46 px gap between the gutter and the pane edge. `park` holds a
# drag until the rectangle stops moving, which is precisely that case. Two
# further Split-path merges sit in the delta as well
# (split-gutter-zero-thickness-gap, touching SplitGutter/ResizeDrag/Border/
# Accordion/Split), so the clock is confounded three ways and is read as a
# direction at most. A park cell also charges roughly 3.4 ms of instrument tax
# to any runtime patch, and the -93.8% work figure on record is an adjacent
# ablation arm's upper bound.
batch_r2() {
    BATCH=r2
    ab sdp 'panel=shell-deep&drive=park'
}

# panel-scroll-read-economy's settled-pass cell and its three wheel-read
# cells: seam.source.getScrollMetrics down by half or more, geometry `=`,
# clock flat by design.
#
# Both of this plan's counter instruments exist at the tight arm —
# Panel.remeasureScrollMetrics and Component.beginSizeHintRecord are both
# present at 5a2f4960 and absent only from v0.9.0 — so work.pane.remeasure@
# ScrollPane and work.sizeHintMiss@ are comparable here, unlike on the arm
# the agenda specified.
#
# One reading of `spp` needs saying out loud. Its `wheel` phase moves pane 0's
# content, and a wheel's landing offsets follow elapsed time, so the `row0`
# label legitimately differs in the wheel phase and in the trailing idle phase
# that inherits it. The geometry gate is therefore read with
# `--allow-diff row0@1,row0@2` on qa-ab.py, reading `pane1` and `row1`
# instead; phase 0, the settled pass, keeps its `row0` gate.
#
# And note that a later merge in the delta, panel-resize-metrics-staleness,
# deleted this plan's resize-burst deferral outright (the _scrollMetricsOwed /
# _panelSizeMoved / _scrollMetricsSettleHandle trio and
# deferScrollMetricsWhileResizing) and made the remeasure run on every pass
# whose box moved. None of these four cells resizes, so the settled gate
# (Panel.canSkipSettledRemeasure, present at v0.10.0 and absent at the tight
# arm) is what they measure — but the plan's own resize-half expectations do
# not survive into v0.10.0 and must not be read off r6's `ffr`/`fnr`.
batch_r3() {
    BATCH=r3
    ab spp 'panel=scroll-panes&drive=passes,wheel,idle:4'
    ab cdw 'panel=code-document&drive=wheel'
    ab sdw 'panel=shell-deep&wheel=editor&drive=wheel'
    ab ssw 'panel=shell-shallow&wheel=editor&drive=wheel'
}

# table-row-layout-pass-contract, on the tight arm. Phase 0 (`hwheel`) is a
# window-changing horizontal scroll, where the plan's probe counted 1,122
# re-committed cells; phase 1 (`resize`) is its other re-commit path, at
# 1,020. A flat clock ships; a REGRESSED CLOCK IS A STOP-AND-REPORT, not a
# new skip.
#
# The asymmetry of that rule is why the confound below matters. The delta also
# contains panel-scroll-read-economy, whose edits are in core/Panel.ts and
# core/Component.ts — the scroller `hwheel` drives and the commit path a row
# re-commit walks. Its saving pushes this phase the *other* way, so a win
# there can mask the re-commit's cost and a flat reading is weaker evidence
# than it looks. absolute-sizing-followups also touches Row.ts and
# Absolute.ts, but that is this plan's own follow-up to the `sizing` option it
# introduced, so it is part of what the cell should measure rather than a
# confound.
batch_r4() {
    BATCH=r4
    ab tw 'panel=table-wide&drive=hwheel,resize'
}

# canvas-idle-loops' per-re-attach isEffectivelyVisible() walk — the
# campaign's last unmeasured cost. Same panel as r4 and the same `hwheel`
# phase, because a column-window slide is what re-attaches cells per frame,
# but a DIFFERENT ARM PAIR, which is why it is its own batch with its own cell
# id: the walk was added by a branch that merged on 2026-09-21, below the
# tight arm, so only the v0.9.0 arm predates it.
#
# The `resize` phase is left off: this cell exists for the slide alone, and
# the panel's default drive is `hwheel`, which keeps the recorded `tw`
# baseline comparable.
#
# BE HONEST ABOUT WHAT THIS CAN SAY. Against v0.9.0 the delta is the whole
# campaign, so a delta on this phase cannot be attributed to the walk, and the
# walk is a per-attach ancestor walk guarded by getElement() in
# Component.addComponent — a few nanoseconds against a phase whose recorded
# cost is 17.4 ms per unit over 13,768 elements. This reading is a cost
# direction on the release, not a price for the walk. Pricing the walk needs
# either the isolated pair named in the header (REL_WALK_*_LIB) or a new
# ablation; ablations.ts has none for it today.
batch_r5() {
    BATCH=r5

    local saved_wt=$QA_WT_LIB saved_main=$QA_MAIN_LIB

    export QA_WT_LIB=$REL_WALK_WT_LIB
    export QA_MAIN_LIB=$REL_WALK_MAIN_LIB

    ab twv 'panel=table-wide&drive=hwheel'

    # Put both arms back: r6 and r7 follow this batch in the same shell.
    export QA_WT_LIB=$saved_wt
    export QA_MAIN_LIB=$saved_main
}

# The rest of E14's scored cells — the plan's own acceptance gate, wider than
# the agenda's scoping of it. `ffd` and `ffc` are where the stage actually
# lands: a field's own pass is the unit. `ffr` and `fnr` are the exception
# flagged in r3's comment — their unit is a resize, so they also carry
# panel-resize-metrics-staleness' rewrite of the remeasure condition, and
# their ratio is not field-internals' alone.
batch_r6() {
    BATCH=r6
    ab ffd 'panel=form-flat&passes=date&drive=passes'
    ab ffc 'panel=form-flat&passes=combo&drive=passes'
    ab ffr 'panel=form-flat&drive=resize'
    ab fnr 'panel=form-nested&drive=resize'
    ab tr 'panel=table-rows&drive=passes'
}

# E14's gate-only cells: no work or time expectation, read for geometry and
# for the counters each one pins. `ffb`'s combo driver opens and closes on
# alternate units and wants an even count, which the default 150 gives. `wq`
# is the one cell here whose geometry the delta can legitimately move:
# rail-handover-follow-ups touches AbstractWindow.ts and Rail.ts.
batch_r7() {
    BATCH=r7
    ab ffh 'panel=form-flat&passes=header&drive=passes'
    ab ffy 'panel=form-flat&type=text&drive=type'
    ab ffz 'panel=form-flat&type=date&drive=type'
    ab ffu 'panel=form-flat&drive=update'
    ab ffk 'panel=form-flat&click=toggle&drive=click'
    ab ffb 'panel=form-flat&click=combo&drive=click'
    ab ffp 'panel=form-flat&drive=pan'
    ab trc 'panel=table-rows&update=filter&drive=update'
    ab tn 'panel=tree-nodes&drive=passes'
    ab sdq 'panel=shell-deep&drive=passes'
    ab ssq 'panel=shell-shallow&drive=passes'
    ab cdq 'panel=chart-dashboard&drive=passes'
    ab wq 'panel=windows&drive=passes'
}

# Prints one arm's path, package version and commit, or its absence. Returns 1
# when the build is missing. The commit is what tells the tight arm from the
# v0.9.0 arm, since both package.json files read 0.9.0.
report_arm() {
    local label=$1 lib=$2 version commit

    if [ ! -f "$lib/dist/lib/core.es.js" ]; then
        echo "no build at $lib/dist/lib — the $label arm needs npm install && npm run build:lib there" >&2

        return 1
    fi

    version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$lib/package.json" | head -1)
    commit=$(git -C "$lib" rev-parse --short HEAD 2>/dev/null)
    printf '%-12s %s (version %s, commit %s)\n' "$label:" "$lib" "${version:-unknown}" "${commit:-unknown}"
}

# Stops with exit 2, before any run, when a build the selected batches need is
# missing. The walk arms are checked only when batch r5 is selected, as
# w3-0.sh checks its own extra build only for b19.
preflight() {
    local b missing=0 walk=0

    report_arm wt "$QA_WT_LIB" || missing=1
    report_arm main "$QA_MAIN_LIB" || missing=1

    for b in "$@"; do
        [ "$b" = r5 ] && walk=1
    done

    if [ "$walk" = 1 ]; then
        report_arm 'r5 wt' "$REL_WALK_WT_LIB" || missing=1
        report_arm 'r5 main' "$REL_WALK_MAIN_LIB" || missing=1
    fi

    [ "$missing" = 0 ] || exit 2
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
