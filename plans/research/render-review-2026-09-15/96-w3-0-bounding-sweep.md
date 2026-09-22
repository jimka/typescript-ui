# W3.0 bounding sweep — results

Run 2026-09-22 by the orchestrator, per
[`plans/implemented/w3-0-bounding-sweep.md`](../../implemented/w3-0-bounding-sweep.md),
which also holds the method, the decision rule and every ablation's design.
This file is the record wave 3 is planned from.

| | |
|---|---|
| Library measured (`main`) | `packages/lib` built from `83cfb0d7` — `master`'s library source; the branch changes only `packages/qa` |
| Before-arm (`wt`, batch `b19` only) | `3e36ca60`, the commit before `checkbox-action-activation` |
| Host | MiniBrowser (WebKitGTK `webkit2gtk-4.1`), full screen |
| Instruments | `work=1&seam=1&geom=1` on every run |
| Session tag | `s1`; sessions A (`b00`–`b08`), B (`b09`–`b13`), C (`b14`–`b19`) run back to back |
| Runs | 394 of 394, no error, no `NO RESULT`, no batch re-run |
| Analysis | `packages/qa/bin/qa-ab.py`, once per cell and arm with the arm's counter from the plan's *The Matrix* |

Cross-session absolutes are not comparable (`00-baseline.md`); every verdict
below is read inside one cell, against that cell's own three plain arms.

## Verdicts

The rule is the plan's *The decision rule*: a cell is `void` on a geometry
`DIFF` or plain arms that disagree (`unstable`), `unreached` when the arm never
engaged, `regress` when it is slower by more than the plain bracket, `win`
when it avoids at least 10% (and 1.0 per unit) of its counter or is faster by
more than the bracket. A candidate is **needs a different surface** when any
cell is `void` or `regress`, or every cell is `unreached`; otherwise **plan
it** when any cell is `win`, else **drop it**.

| Candidate | Verdict | Strongest evidence |
|---|---|---|
| G18 `text-measurement-without-reflow` | **plan it** | canvas widths: every keystroke frame −34.9 to −36.9 ms (`code-document`, both shells: 53.6→18.7, 57.7→20.8, 56.5→19.8); measurement memo: `tree-nodes` key −11.2 ms, `chart-dashboard` pass −12.0 ms |
| G28 `continuous-motion-pattern` | **plan it** | `diagram-graph` pan 53.5→17.2 ms per frame; `form-flat` toggle click 34.7→17.4 ms — one stylesheet-rule write per event, now inline |
| F26.1 `AbstractChart` per-pass rebuild | **plan it** | 50-chart dashboard pass 23.2→9.1 ms, sink writes −96%; the data-update check cells never engage, so the gate spares real repaints |
| F26.2 chart margin measurement | **plan it** | dashboard pass −12.0 ms, dashboard drag 90.7→76.0 ms |
| G09 more opt-ins | **plan it** | work −27% (S1's dock-h drag) to −97% (shell passes); form passes 7.09→0.69 and 5.35→0.59 ms; shell resize −3.65 / −2.16 ms |
| `resizeMode: "live" \| "outline"` | **plan it** (counter-only) | every drag frame sits 25–60 ms above idle; the outline bound per frame is that whole excess |
| G26 `markdown-viewer-resize-and-lexer` | **plan it** | the lexer: `update` 182 ms at n=60, 4,219 ms at n=480 — r = 23.2, superlinear; the viewer-resize half is weak (2 reads per pass) |
| G17 `glyph-name-setter` | **plan it** (counter-only) | swap churn 12.0 per `tree-nodes` key, 282.0 per `treetable-rows` toggle |
| G24 `list-and-tree-row-economy` | **plan it** | list key sink −98.7% / −99.9%; tree passes work −99.3%; the no-op focus move dispatches 1.0 per clamped key |
| G12 F06.9 collapse animation | **plan it** | pane collapse work −56% / −64%; frame time flat |
| G08 `environment-read-caching` | **plan it** | environment reads −93% to −97% per viewport event; `menus` toggle −1.52 ms |
| G11 `box-layout-per-pass-gather` | **plan it** | its gather residue −96% to −100% everywhere; `form-nested` pass −0.36 ms |
| G20 `event-dispatch-and-registrants` | **plan it** (dose, work) | the ancestor walk is 75–79% of all seam source calls per chart hover; a second walk costs no visible time |
| G05 `resolve-bounds-lazy-size-reads` | **plan it** | form passes −0.45 / −0.29 ms; size-hint misses −9% |
| G19 `tooltip-hover-path` | **plan it** | `form-flat` typing sink −63%; frame time flat; the chart cells never reach it |
| G22 `table-resize-settle-relay` | **needs a different surface** | `table-rows` resize 153.7→103.0 ms, work −93% — but `treetable-rows` geometry `DIFF(focused)` in both phases |
| G23 `table-header-and-cell-write-economy` | **needs a different surface** (rule) | three clean cells: update −27.0 ms, filter −25.0 ms, sort −25.7 ms, all from a cached `Intl.DateTimeFormat` (2.14 hits per unit); the fourth cell (`trw`) is `void` because its **plain** arms disagree |
| G21 `table-render-pass-economy` | **needs a different surface** (rule) | work −27% on key, −14% on update, frame time flat; `ttk` and `trw` `void` from unstable plain geometry. The single-record narrowing (counter-only) reads **drop** |
| G16 `panel-settled-pass-and-scroll-reads` | **needs a different surface** (rule) | scroll reads: `shell-deep` editor wheel −3.29 ms, reads −50%; the settled-pass arm `regress`es +0.33 ms on a 0.02 ms bracket (`fnq`); the form wheel cells never reach the scroll arm |
| G27 `markdown-heading-scroll-cache` | **needs a different surface** | reads −62% / −82%, but the cache changes which heading is active (`--same work.heading@*` fails) |
| G25 `codemirror-theme-singleton` | **needs a different surface** | `unreached` in both cells: a tab never shown has no editor view, so no hidden editor is re-themed in these panels |
| G12 F06.3 no-op drag frame | **needs a different surface** | park work −94%, yet the arm is 3.3–4.3 ms *slower* than plain on both shells |
| G12 F06.4 `recalculateSizes` gate | **needs a different surface** (rule) | no cell avoids work (−0.6% to +0.9%); its one `regress` is in the same park cell as F06.3's |
| G14 `accordion-closed-section-render-tree` | **drop it** | work −2.7% / −3.1%, frame time flat |
| G29 `dead-surface-and-docs-sweep` | excluded | no runtime work |

## Results by candidate

Each table is `qa-ab.py`'s output for one arm: the cell, the scored phase, the
plain mean with its bracket, the arm mean, Δms and its `ms` verdict, the arm's
counter per unit from plain mean to arm mean, Δ and its `work` verdict, the
geometry gate, engagement, and the cell verdict.

### G18 — text measurement

`g18.canvas-width` measures a width on a canvas instead of a hidden DOM probe
that forces a document layout per call. On a keystroke that forced layout
lands after CodeMirror has invalidated the editor, so it re-lays out the whole
editor: 0.75 measurements per keystroke (the status bar) cost about 35 ms.
Geometry is identical in all three cells, but the fix must still prove canvas
widths match the probe's for every font, weight and letter-spacing the library
measures.

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cdt` (b08) | type×150 | 53.59 (2.30) | 18.66 | -34.93 | win | 0.75 → 0.00 | -100.0% | flat | = | yes | **win** |
| `sdy` (b08) | type×150 | 57.72 (0.48) | 20.84 | -36.88 | win | 0.75 → 0.00 | -100.0% | flat | = | yes | **win** |
| `ssy` (b08) | type×150 | 56.51 (0.80) | 19.80 | -36.72 | win | 0.75 → 0.00 | -100.0% | flat | = | yes | **win** |

`g18.measure-memo` answers a repeated `(text, font)` measurement from a memo.

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `clq` (b09) | passes×150 | 4.67 (0.13) | 2.65 | -2.02 | win | 12.00 → 0.07 | -99.4% | win | = | yes | **win** |
| `cdq` (b09) | passes×150 | 23.20 (0.50) | 11.25 | -11.95 | win | 48.00 → 0.07 | -99.9% | win | = | yes | **win** |
| `ffc` (b12) | click×150 | 64.73 (1.78) | 63.95 | -0.78 | flat | 10.00 → 0.13 | -98.7% | win | = | yes | **win** |
| `mt` (b13) | toggle×150 | 35.13 (0.44) | 34.67 | -0.46 | win | 0.50 → 0.01 | -98.0% | flat | = | yes | **win** |
| `tnk` (b16) | key×150 | 93.03 (0.36) | 81.85 | -11.18 | win | 6.00 → 0.07 | -98.8% | win | = | yes | **win** |

### G28 — continuous motion

`g28.transform-inline` moves a per-event transform from a stylesheet rule to
the element's inline style. A rule mutation forces a full-document restyle in
WebKitGTK even when nothing else changed — the cost the style-write filter
removed from S1 (`97-wave2-measurement.md`).

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `ffk` (b12) | click×150 | 34.66 (0.64) | 17.40 | -17.26 | win | 0.50 → 0.00 | -100.0% | flat | = | yes | **win** |
| `dgp` (b18) | pan×150 | 53.54 (1.37) | 17.23 | -36.32 | win | 1.00 → 0.00 | -100.0% | win | = | yes | **win** |

### F26.1 / F26.2 — `AbstractChart`

`chart.repaint-gate` skips a repaint whose size and data signature is
unchanged; `chart.margin-memo` keeps the per-pass margin measurement. The
update cells (`clu`, `cdu`) are check cells with `--same
seam.sink.createElementNS`: the gate never engaged there and the element count
matched, so it spares every data repaint. F26.2's saving overlaps G18's memo,
which removes the same `measureText` calls in `clq` and `cdq`.

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `clq` (b09) | passes×150 | 4.67 (0.13) | 2.40 | -2.27 | win | 1081.00 → 38.00 | -96.5% | win | = | yes | **win** |
| `cdq` (b09) | passes×150 | 23.20 (0.50) | 9.12 | -14.08 | win | 4329.00 → 157.00 | -96.4% | win | = | yes | **win** |
| `clu` (b09) | update×150 | 65.16 (0.88) | 65.24 | +0.08 | flat | 1074.79 → 1074.79 | +0.0% | flat | = | no | **unreached** |
| `cdu` (b09) | update×150 | 66.66 (1.17) | 65.74 | -0.92 | flat | 1074.79 → 1074.79 | +0.0% | flat | = | no | **unreached** |

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `clq` (b09) | passes×150 | 4.67 (0.13) | 2.60 | -2.07 | win | 12.00 → 0.08 | -99.3% | win | = | yes | **win** |
| `cdq` (b09) | passes×150 | 23.20 (0.50) | 11.22 | -11.98 | win | 48.00 → 0.32 | -99.3% | win | = | yes | **win** |
| `clu` (b09) | update×150 | 65.16 (0.88) | 66.59 | +1.43 | regress | 11.92 → 11.92 | +0.0% | flat | = | no | **unreached** |
| `cdu` (b09) | update×150 | 66.66 (1.17) | 70.12 | +3.46 | regress | 11.92 → 11.92 | +0.0% | flat | = | no | **unreached** |
| `cdd` (b09) | drag×150 | 90.70 (1.75) | 76.00 | -14.70 | win | 64.00 → 0.43 | -99.3% | win | = | yes | **win** |

### G09 — more unchanged-commit opt-ins

`g09.all` opts every class into `canSkipUnchangedLayout()` — the ceiling;
`g09.chrome` only the window and menu chrome. Geometry held in every cell,
which is the soundness evidence the staged opt-in audit needs; the ceiling is
not itself a plan.

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sdh` (b01) | drag×150 | 60.26 (7.80) | 57.62 | -2.64 | flat | 872.02 → 632.02 | -27.5% | win | = | yes | **win** |
| `sdr` (b04) | resize×150 | 69.30 (0.90) | 65.66 | -3.65 | win | 6656.04 → 1800.06 | -73.0% | win | = | yes | **win** |
| `ssr` (b04) | resize×150 | 61.81 (0.73) | 59.64 | -2.16 | win | 5832.58 → 1132.06 | -80.6% | win | = | yes | **win** |
| `sdq` (b05) | passes×150 | 2.78 (0.04) | 0.15 | -2.63 | win | 4938.00 → 157.00 | -96.8% | win | = | yes | **win** |
| `ssq` (b05) | passes×150 | 2.16 (0.12) | 0.13 | -2.03 | win | 4120.00 → 157.00 | -96.2% | win | = | yes | **win** |
| `fnq` (b11) | passes×150 | 7.09 (0.02) | 0.69 | -6.40 | win | 13550.15 → 2098.00 | -84.5% | win | = | yes | **win** |
| `ffq` (b11) | passes×150 | 5.35 (0.27) | 0.59 | -4.76 | win | 11747.00 → 1887.00 | -83.9% | win | = | yes | **win** |
| `wq` (b13) | passes×150 | 0.26 (0.03) | 0.08 | -0.18 | win | 521.00 → 89.00 | -82.9% | win | = | yes | **win** |

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sdh` (b01) | drag×150 | 60.26 (7.80) | 60.35 | +0.09 | flat | 872.02 → 824.02 | -5.5% | flat | = | yes | **flat** |
| `sdr` (b04) | resize×150 | 69.30 (0.90) | 68.37 | -0.94 | win | 6656.04 → 6655.43 | -0.0% | flat | = | yes | **win** |
| `ssr` (b04) | resize×150 | 61.81 (0.73) | 62.08 | +0.27 | flat | 5832.58 → 5832.21 | -0.0% | flat | = | yes | **flat** |
| `wq` (b13) | passes×150 | 0.26 (0.03) | 0.08 | -0.18 | win | 521.00 → 89.00 | -82.9% | win | = | yes | **win** |

### G26 — Markdown viewer

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `m60d` (b17) | drag×150 | 56.96 (3.71) | 56.58 | -0.38 | flat | 8.01 → 7.03 | -12.3% | flat | = | yes | **flat** |
| `m240d` (b17) | drag×150 | 57.05 (2.05) | 56.80 | -0.25 | flat | 8.01 → 7.01 | -12.4% | flat | = | yes | **flat** |
| `mdq` (b17) | passes×150 | 0.50 (0.03) | 0.47 | -0.03 | win | 4.00 → 2.01 | -49.8% | win | = | yes | **win** |

### G24 — list and tree rows

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `li3` (b16) | key×150 | 17.16 (0.70) | 17.33 | +0.17 | flat | 604.00 → 8.00 | -98.7% | win | = | yes | **win** |
| `li30` (b16) | key×150 | 17.14 (0.51) | 17.52 | +0.37 | flat | 6004.00 → 8.00 | -99.9% | win | = | yes | **win** |

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tnq` (b16) | passes×150 | 0.10 (0.04) | 0.01 | -0.10 | win | 288.00 → 2.00 | -99.3% | win | = | yes | **win** |

### G12 — `Split`

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sdt` (b06) | toggle×120 | 23.36 (0.73) | 22.95 | -0.41 | flat | 1115.66 → 488.13 | -56.2% | win | = | yes | **win** |
| `sst` (b06) | toggle×120 | 20.81 (2.08) | 20.67 | -0.14 | flat | 1027.99 → 369.56 | -64.1% | win | = | yes | **win** |

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sdp` (b02) | park×150 | 9.76 (0.33) | 13.04 | +3.28 | regress | 4712.31 → 293.00 | -93.8% | win | = | yes | **regress** |
| `ssp` (b02) | park×150 | 8.90 (0.12) | 13.18 | +4.27 | regress | 3953.42 → 260.22 | -93.4% | win | = | yes | **regress** |

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sdh` (b01) | drag×150 | 60.26 (7.80) | 59.28 | -0.98 | flat | 872.02 → 880.02 | +0.9% | flat | = | no | **unreached** |
| `sdp` (b02) | park×150 | 9.76 (0.33) | 13.28 | +3.52 | regress | 4712.31 → 4688.47 | -0.5% | flat | = | yes | **regress** |
| `sdq` (b05) | passes×150 | 2.78 (0.04) | 2.79 | +0.01 | flat | 4938.00 → 4906.32 | -0.6% | flat | = | yes | **flat** |
| `ssq` (b05) | passes×150 | 2.16 (0.12) | 2.23 | +0.07 | flat | 4120.00 → 4112.08 | -0.2% | flat | = | yes | **flat** |

Both arms of `sdp` are about 3.4 ms slower than its plain arms, although
`split.recalc-gate` avoids no work there. Something about ablating inside the
park cell slows its frames, independent of the work removed; F06.3's timing
therefore needs a prototype library arm (`wt`), not a runtime patch.

### G08 — environment reads

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `w8v` (b13) | viewport×150 | 17.39 (0.45) | 17.38 | -0.01 | flat | 41.00 → 1.01 | -97.5% | win | = | yes | **win** |
| `w4v` (b13) | viewport×150 | 17.32 (0.07) | 17.37 | +0.05 | flat | 15.00 → 1.01 | -93.3% | win | = | yes | **win** |
| `wdlg` (b13) | toggle×120 | 28.96 (0.73) | 28.96 | +0.01 | flat | 1.25 → 0.04 | -96.8% | win | = | yes | **win** |
| `mt` (b13) | toggle×150 | 35.13 (0.44) | 33.61 | -1.52 | win | 1.00 → 0.50 | -50.0% | flat | = | yes | **win** |

### G11 — the per-pass gather

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sdr` (b04) | resize×150 | 69.30 (0.90) | 68.62 | -0.69 | flat | 711.01 → 14.10 | -98.0% | win | = | yes | **win** |
| `ssr` (b04) | resize×150 | 61.81 (0.73) | 61.87 | +0.06 | flat | 569.07 → 11.08 | -98.1% | win | = | yes | **win** |
| `cdq` (b09) | passes×150 | 23.20 (0.50) | 23.27 | +0.07 | flat | 231.00 → 0.00 | -100.0% | win | = | yes | **win** |
| `fnq` (b11) | passes×150 | 7.09 (0.02) | 6.73 | -0.36 | win | 1587.10 → 60.99 | -96.2% | win | = | yes | **win** |
| `ffq` (b11) | passes×150 | 5.35 (0.27) | 5.11 | -0.24 | flat | 1364.00 → 9.00 | -99.3% | win | = | yes | **win** |

Context line (plan's *Counter-only reads*, not scored): on `sdr`'s plain arms
a resize unit makes 4,017.7 size-hint calls of which 1,677.0 miss the memo —
2,340.7 memo hits a per-phase gather could still remove, of the kind W2.0
measured as free.

### G20 — the event ancestor walk (dose arm)

`g20.walk-dose` runs the walk a second time. Its `ms` never leaves the
bracket, so a walk costs no visible time; its `work` reads from the plain
arms: 11.98 of 15.92 seam source calls per `chart-line` hover unit (75.3%),
17.37 of 22.01 per `chart-dashboard` unit (78.9%). Work `win`, so **plan it**
on work avoided.

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `clh` (b10) | hover×150 | 21.94 (0.57) | 22.12 | +0.18 | flat | 11.98 → 11.98 | +0.0% | flat | = | yes | **dose** |
| `cdh` (b10) | hover×150 | 27.22 (0.75) | 27.63 | +0.41 | flat | 17.37 → 17.37 | +0.0% | flat | = | yes | **dose** |

### G05 — lazy size reads

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sdr` (b04) | resize×150 | 69.30 (0.90) | 68.70 | -0.60 | flat | 1677.05 → 1582.66 | -5.6% | flat | = | yes | **flat** |
| `ssr` (b04) | resize×150 | 61.81 (0.73) | 61.55 | -0.26 | flat | 1488.80 → 1441.73 | -3.2% | flat | = | yes | **flat** |
| `fnq` (b11) | passes×150 | 7.09 (0.02) | 6.64 | -0.45 | win | 2911.52 → 2653.14 | -8.9% | flat | = | yes | **win** |
| `ffq` (b11) | passes×150 | 5.35 (0.27) | 5.06 | -0.29 | win | 2778.00 → 2524.00 | -9.1% | flat | = | yes | **win** |
| `ffh` (b11) | passes×150 | 0.11 (0.00) | 0.11 | +0.00 | flat | 78.00 → 63.00 | -19.2% | win | = | yes | **win** |

### G19 — the tooltip hover path

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `clh` (b10) | hover×150 | 21.94 (0.57) | 22.16 | +0.22 | flat | 9.41 → 9.42 | +0.2% | flat | = | no | **unreached** |
| `cdh` (b10) | hover×150 | 27.22 (0.75) | 27.16 | -0.06 | flat | 10.22 → 10.22 | +0.0% | flat | = | no | **unreached** |
| `fny` (b12) | type×150 | 17.56 (0.53) | 17.51 | -0.05 | flat | 1.01 → 1.01 | +0.0% | flat | = | yes | **flat** |
| `ffy` (b12) | type×150 | 17.76 (0.69) | 17.27 | -0.49 | flat | 2.74 → 1.02 | -62.8% | win | = | yes | **win** |

The chart cells are `unreached`, as the implementation notes predicted: an
idle `hide` already does no fade, so only the attach half engages, and only in
`form-flat`'s typing cell.

### G22 — table resize settle

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `trr` (b15) | resize×150 | 153.74 (0.67) | 103.03 | -50.71 | win | 44237.47 → 2998.18 | -93.2% | win | = | yes | **win** |
| `trr` (b15) | idle×4 | 14.56 (3.33) | 59.00 | +44.44 | regress | 0.00 → 10489.50 | - | more | = | no | **unreached** |
| `ttr` (b15) | resize×150 | 102.55 (1.94) | 80.03 | -22.52 | win | 16378.50 → 1016.60 | -93.8% | win | DIFF(focused) | yes | **void** |
| `ttr` (b15) | idle×4 | 15.56 (1.66) | 43.50 | +27.94 | regress | 0.00 → 3977.25 | - | more | DIFF(focused) | no | **void** |

Phase 1 (`idle:4`) is where the relay does the deferred work, so its `regress`
is by design; the plan scores phase 0 and gates phase 1 on geometry only.
`trr` passes both. `ttr` does not: the tree table's `focused` geometry label
differs in both phases, so deferring the settle changes which cell holds
focus. That is a correctness question the relay's design has to answer first.

### G23 — table header and cell writes

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tru` (b14) | update×150 | 45.31 (7.96) | 18.29 | -27.02 | win | 1288.01 → 1288.01 | +0.0% | flat | = | yes | **win** |
| `t9f` (b15) | update×150 | 151.19 (2.22) | 126.20 | -24.99 | win | 2782.71 → 2771.71 | -0.4% | flat | = | yes | **win** |
| `t9s` (b15) | click×150 | 150.50 (1.65) | 124.81 | -25.69 | win | 2572.36 → 2572.36 | +0.0% | flat | = | yes | **win** |
| `trw` (b15) | wheel×150 | 91.53 (0.69) | 89.13 | -2.40 | win | 1307.96 → 1307.68 | -0.0% | flat | unstable | yes | **void** |

The saving comes from `memo.g23.write-economy.intlHit` (2.14 per unit in every
engaged cell): `toLocale*String` builds a fresh `Intl.DateTimeFormat` per
call, which is expensive in JavaScriptCore. The DOM-write counter is flat,
as expected. `trw` is `void` because its three **plain** arms disagree on
geometry — the `table-rows` wheel phase is not deterministic — so it says
nothing about the arm. By the rule G23 needs a different surface; on the
three sound cells it is one of the largest levers measured.

### G21 — the table render pass

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `trk` (b14) | key×150 | 16.98 (0.20) | 17.10 | +0.12 | flat | 22.00 → 16.00 | -27.3% | win | = | yes | **win** |
| `t9k` (b14) | key×150 | 17.10 (0.34) | 17.18 | +0.08 | flat | 22.00 → 16.00 | -27.3% | win | = | yes | **win** |
| `tru` (b14) | update×150 | 45.31 (7.96) | 43.64 | -1.67 | flat | 14.00 → 12.01 | -14.2% | win | = | yes | **win** |
| `trq` (b14) | passes×150 | 1.63 (0.14) | 1.52 | -0.11 | flat | 133.00 → 131.01 | -1.5% | flat | = | yes | **flat** |
| `ttk` (b14) | key×150 | 17.17 (0.32) | 17.08 | -0.09 | flat | 16.00 → 16.00 | +0.0% | flat | unstable | yes | **void** |
| `ttu` (b14) | update×150 | 17.96 (0.20) | 17.90 | -0.06 | flat | 13.00 → 13.00 | +0.0% | flat | = | yes | **flat** |
| `trw` (b15) | wheel×150 | 91.53 (0.69) | 90.53 | -1.00 | win | 21.82 → 19.84 | -9.1% | flat | unstable | yes | **void** |

`ttk` and `trw` are `void` from unstable plain geometry, as for G23's `trw`.
The single-record narrowing (F19.5, F22.2) reads **drop**: a one-record
`update` makes 1,287.99 sink calls per unit against 1,320.00 for a bare
`passes` unit — no rebind excess.

### G16 — settled passes and scroll reads

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `fnq` (b11) | passes×150 | 7.09 (0.02) | 7.42 | +0.33 | regress | 2.00 → 0.01 | -99.5% | win | = | yes | **regress** |
| `ffq` (b11) | passes×150 | 5.35 (0.27) | 5.46 | +0.11 | flat | 2.00 → 0.01 | -99.5% | win | = | yes | **win** |

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `fnw` (b12) | wheel×150 | 17.39 (0.34) | 17.44 | +0.05 | flat | 1.00 → 1.00 | +0.0% | flat | = | no | **unreached** |
| `ffw` (b12) | wheel×150 | 17.37 (0.19) | 17.45 | +0.08 | flat | 1.00 → 1.00 | +0.0% | flat | = | no | **unreached** |
| `cdw` (b18) | wheel×150 | 55.14 (11.95) | 50.34 | -4.80 | flat | 4.00 → 2.00 | -50.0% | win | = | yes | **win** |
| `sdw` (b18) | wheel×150 | 25.16 (1.09) | 21.87 | -3.29 | win | 4.00 → 2.00 | -50.0% | win | = | yes | **win** |
| `ssw` (b18) | wheel×150 | 53.97 (10.75) | 50.56 | -3.41 | flat | 4.00 → 2.00 | -50.0% | win | = | yes | **win** |

### G27 — heading lookup

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `m60w` (b17) | wheel×150 | 61.67 (4.00) | 63.21 | +1.54 | flat | 20.19 → 3.71 | -81.6% | win | DIFF (`work.heading@section-8`, `@section-9`) | yes | **void** |
| `m240w` (b17) | wheel×300 | 63.22 (1.53) | 63.84 | +0.62 | flat | 32.60 → 12.53 | -61.6% | win | DIFF (`work.heading@section-4`, `-15`, `-24`) | yes | **void** |

### G25 — CodeMirror theme

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sd4m` (b07) | theme×10 | 197.81 (0.67) | 198.78 | +0.97 | regress | 16.00 → 16.00 | +0.0% | flat | = | no | **unreached** |
| `ss4m` (b07) | theme×10 | 150.44 (4.00) | 151.00 | +0.56 | flat | 4.00 → 4.00 | +0.0% | flat | = | no | **unreached** |

### G14 — the closed Accordion section

| Cell | Phase | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | work | geom | engaged | Cell verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sds` (b03) | drag×150 | 69.92 (1.84) | 69.75 | -0.17 | flat | 6460.90 → 6286.12 | -2.7% | flat | = | yes | **flat** |
| `sss` (b03) | drag×150 | 63.86 (1.81) | 65.16 | +1.30 | flat | 5696.90 → 5522.12 | -3.1% | flat | = | yes | **flat** |

## Counter-only reads

Read from `b00` with `qa-table.py --seam --work`; counts are deterministic.

| Candidate | Read | Value | Verdict |
|---|---|---|---|
| G17 | `ensureStyleRule` + `createElementNS` + `querySelector` per unit | `tn` key: 1.50 + 7.03 + 3.50 = 12.03; `tt` toggle: 70.50 + 141.00 + 70.50 = 282.00 | **plan it** |
| `resizeMode` | drag `avg` − run `idle` | `sdh` 46.7, `sd4h` 51.2, `sdv` 28.7, `sds` 60.4, `sss` 52.4, `we` 25.3 ms | **plan it** |
| G26 lexer | `avg(update, n=480) ÷ avg(update, n=60)` | 4,219.2 ÷ 182.1 = 23.2 | **plan it** |
| G21 narrowing | `sink/u(update) − sink/u(passes)` on `tr` | 1,287.99 − 1,320.00 = −32.0 | **drop it** |
| G24 no-op move | `dispatchCustomEvent` per `li1` key | 1.00 | **plan it** |

## The fresh baseline (`b00`)

One plain run per shape, on `83cfb0d7`. The README's *Validated* figures were
measured at `608544c9` in an earlier session, so the two columns are not a
comparison; the new figures replace the old as the record.

| Cell | Panel | Params | Phase | Units | Elements | Idle ms | Avg ms | p90 ms | work/u | sink/u |
|---|---|---|---|---|---|---|---|---|---|---|
| `sdh` | shell-deep | — | drag | 150 | 2484 | 8.8 | 55.6 | 73 | 872.0 | 139.1 |
| `sdh` | shell-deep | — | wheel | 120 | 2484 | 8.8 | 80.8 | 98 | 116.8 | 37.9 |
| `sd4h` | shell-deep | n=4 | drag | 150 | 2604 | 8.9 | 60.2 | 83 | 2588.0 | 187.1 |
| `sd4h` | shell-deep | n=4 | wheel | 120 | 2604 | 8.9 | 78.3 | 100 | 116.9 | 37.8 |
| `sd4h` | shell-deep | n=4 | theme | 4 | 2604 | 8.9 | 194.3 | 200 | 9149.0 | 1079.0 |
| `sds` | shell-deep | grip=sidebar | park | 150 | 2484 | 9.0 | 9.0 | 14 | 4712.3 | 347.7 |
| `sds` | shell-deep | grip=sidebar | drag | 150 | 2484 | 9.0 | 69.3 | 84 | 6460.9 | 562.1 |
| `sds` | shell-deep | grip=sidebar | theme | 4 | 2484 | 9.0 | 172.0 | 180 | 7730.5 | 1053.8 |
| `sdv` | shell-deep | grip=dock-v | drag | 150 | 2484 | 10.9 | 39.6 | 80 | 374.0 | 80.1 |
| `sss` | shell-shallow | grip=sidebar | park | 150 | 1618 | 9.1 | 9.8 | 17 | 3953.4 | 246.3 |
| `sss` | shell-shallow | grip=sidebar | drag | 150 | 1618 | 9.1 | 61.5 | 71 | 5696.9 | 436.1 |
| `sss` | shell-shallow | grip=sidebar | theme | 4 | 1618 | 9.1 | 134.3 | 139 | 7018.8 | 945.8 |
| `cl` | chart-line | — | passes | 150 | 236 | 17.2 | 4.6 | 6 | 450.0 | 1081.0 |
| `cl` | chart-line | — | resize | 150 | 236 | 17.2 | 70.8 | 81 | 453.0 | 1092.2 |
| `cd50` | chart-dashboard | n=50 | passes | 150 | 1112 | 17.7 | 23.0 | 25 | 1808.0 | 4329.0 |
| `cd` | chart-dashboard | — | resize | 150 | 2912 | 17.4 | 160.7 | 172 | 2834.8 | 14340.9 |
| `cd` | chart-dashboard | — | drag | 150 | 2912 | 17.4 | 161.0 | 172 | 2762.0 | 14245.1 |
| `tr` | table-rows | — | key | 150 | 4766 | 17.6 | 17.2 | 18 | 22.0 | 1292.0 |
| `tr` | table-rows | — | update | 150 | 4766 | 17.6 | 38.1 | 53 | 14.0 | 1288.0 |
| `tr` | table-rows | — | passes | 150 | 4766 | 17.6 | 1.6 | 2 | 133.0 | 1320.0 |
| `tr` | table-rows | — | wheel | 150 | 4766 | 17.6 | 109.1 | 113 | 21.8 | 1307.7 |
| `tt` | treetable-rows | — | key | 150 | 1699 | 17.3 | 17.2 | 18 | 16.0 | 440.0 |
| `tt` | treetable-rows | — | toggle | 20 | 1699 | 17.3 | 199.1 | 221 | 12089.0 | 4019.5 |
| `tn` | tree-nodes | — | passes | 150 | 632 | 17.4 | 0.1 | 1 | 288.0 | 1.0 |
| `tn` | tree-nodes | — | key | 150 | 632 | 17.4 | 93.2 | 98 | 1799.5 | 476.6 |
| `li` | list-items | — | passes | 150 | 932 | 17.4 | 3.0 | 4 | 11737.0 | 908.0 |
| `li` | list-items | — | key | 150 | 932 | 17.4 | 17.3 | 18 | 0.0 | 604.0 |
| `li1` | list-items | n=1 | key | 150 | 35 | 17.4 | 17.4 | 18 | 0.0 | 3.0 |
| `md` | markdown-doc | — | passes | 150 | 1181 | 17.6 | 0.5 | 1 | 760.0 | 36.0 |
| `md` | markdown-doc | — | drag | 150 | 1181 | 17.6 | 55.1 | 72 | 781.1 | 53.2 |
| `md` | markdown-doc | — | theme | 4 | 1181 | 17.6 | 99.3 | 104 | 1045.5 | 170.5 |
| `mdu` | markdown-doc | — | update | 20 | 1181 | 17.4 | 182.1 | 188 | 384.1 | 4285.0 |
| `mdu480` | markdown-doc | n=480 | update | 20 | 6312 | 17.5 | 4219.2 | 4446 | 384.0 | 31955.9 |
| `cv` | canvas-idle | — | idle | 150 | 22 | 17.5 | 17.3 | 18 | 0.0 | 0.0 |
| `dg` | diagram-graph | — | click | 150 | 633 | 17.4 | 54.9 | 71 | 0.0 | 2.0 |
| `dg` | diagram-graph | — | pan | 150 | 633 | 17.4 | 50.0 | 52 | 0.0 | 1.0 |
| `dg` | diagram-graph | — | wheel | 10 | 633 | 17.4 | 57.1 | 62 | 3218.7 | 797.0 |
| `cdoc` | code-document | — | passes | 150 | 644 | 11.8 | 0.0 | 0 | 2.0 | 0.0 |
| `cdoc` | code-document | — | wheel | 150 | 644 | 11.8 | 52.9 | 83 | 0.0 | 3.0 |
| `cdoc` | code-document | — | resize | 150 | 644 | 11.8 | 51.7 | 55 | 1588.8 | 69.3 |
| `cdoc` | code-document | — | key | 150 | 644 | 11.8 | 54.5 | 69 | 425.9 | 30.7 |
| `cdoc` | code-document | — | drag | 150 | 644 | 11.8 | 51.1 | 53 | 1407.7 | 70.5 |
| `cdoc` | code-document | — | type | 150 | 644 | 11.8 | 53.6 | 78 | 275.3 | 20.3 |
| `me` | markdown-editor | — | call | 40 | 1617 | 9.6 | 13.7 | 18 | 1.0 | 0.1 |
| `me` | markdown-editor | — | type | 150 | 1617 | 9.6 | 66.1 | 111 | 1.4 | 2402.8 |
| `wh` | windows | grip=header | drag | 40 | 634 | 17.3 | 28.2 | 33 | 0.0 | 1.7 |
| `wh` | windows | grip=header | drag | 80 | 634 | 17.3 | 27.6 | 32 | 0.0 | 1.1 |
| `we` | windows | grip=edge | drag | 150 | 634 | 17.4 | 42.8 | 51 | 667.0 | 52.5 |
| `we` | windows | grip=edge | passes | 150 | 634 | 17.4 | 0.2 | 1 | 521.0 | 38.0 |
| `we` | windows | grip=edge | viewport | 150 | 634 | 17.4 | 17.3 | 18 | 15887.5 | 1157.3 |
| `we` | windows | grip=edge | toggle | 60 | 634 | 17.4 | 29.5 | 124 | 18.1 | 16.0 |
| `ffh` | form-flat | passes=header&type=date | passes | 150 | 556 | 17.2 | 0.1 | 1 | 274.0 | 16.0 |
| `ffh` | form-flat | passes=header&type=date | type | 10 | 556 | 17.2 | 19.6 | 50 | 0.0 | 1.3 |
| `ffd` | form-flat | passes=date | passes | 150 | 556 | 17.3 | 0.1 | 1 | 196.0 | 12.0 |
| `ffc` | form-flat | passes=combo | passes | 150 | 556 | 17.3 | 0.1 | 0 | 62.0 | 7.0 |
| `fnh` | form-nested | passes=header | passes | 150 | 744 | 17.2 | 0.1 | 1 | 274.0 | 16.0 |
| `mn` | menus | — | toggle | 150 | 133 | 17.5 | 35.2 | 62 | 886.8 | 456.7 |
| `tw` | table-wide | — | hwheel | 150 | 13768 | 17.2 | 17.4 | 18 | 0.0 | 1.0 |
| `tw` | table-wide | — | passes | 150 | 13768 | 17.2 | 2.5 | 4 | 129.0 | 4481.0 |
| `tw` | table-wide | — | wheel | 150 | 13768 | 17.2 | 117.2 | 121 | 17.9 | 4511.3 |
| `tw` | table-wide | — | resize | 150 | 13768 | 17.2 | 163.7 | 167 | 780.1 | 4684.6 |
| `tw` | table-wide | — | key | 150 | 13768 | 17.2 | 328.9 | 339 | 10.0 | 4437.0 |

`markdown-doc` at n=480 takes 4.2 s per `update`, and `table-wide` 329 ms per
arrow key — the two slowest interactions any panel drives.

## The witnesses (`b19`)

C40 (`checkbox-action-activation`), per unit, before (`3e36ca60`) → after:

| Case | Cell | `checkbox.action` | `slider.action` | `dispatchCustomEvent` | As specified |
|---|---|---|---|---|---|
| 24 | `c40u` update | 1 → 0 | 1 → 0 | 2 → 0 | yes |
| 25 | `c40r` click on the root | 1 → 0 | 0 → 0 | 0 → 0 | yes |
| 26 | `c40t` click on the toggle surfaces | 0.5 → 0.5 | 0 → 0 | 0.5 → 0.5 | yes |
| 27 | `c40p` pan | 0 → 0 | 0.12 → 0.12 | 0.12 → 0.12 | yes |

C21 (`doc-and-qa-record-drift`, case 6): the check prints `28 True` — the
tooltip rectangle is `null` until unit 28, when the hover delay runs out, then
the same rectangle in every later unit, through the second field's keystroke.
**C21 is confirmed in a real engine.** So is C40.

## What survives

**Plan it**, ordered by milliseconds saved where the frame moved, then by
work avoided:

1. G18 — about 35 ms per keystroke frame; 11–12 ms on tree keys and chart passes.
2. G28 — 36 ms per diagram-pan frame, 17 ms per toggle click.
3. F26.1 + F26.2 — 14 ms per 50-chart pass, 15 ms per dashboard drag frame (F26.2 overlaps G18's memo).
4. `resizeMode` — up to 25–60 ms per drag frame, the whole live-layout excess.
5. G26 — the lexer's superlinear `update` (4.2 s at n=480).
6. G09 — 2–6 ms per settled pass, 2–4 ms per resize frame, work −27% to −97%.
7. G08 — 1.5 ms on a menu toggle; environment reads −93% to −97%.
8. G12 F06.9 — collapse work −56% / −64%.
9. G24 — list key writes −99%, tree passes work −99%, the clamped-key dispatch.
10. G17 — 12 to 282 swap operations per tree key / tree-table toggle.
11. G11 — its gather residue −96% to −100%; 0.36 ms on a nested-form pass.
12. G20 — the walk is three quarters of all seam reads per hover.
13. G05 — 0.3–0.45 ms per form pass.
14. G19 — typing writes −63% in a decorated form.

**Needs a different surface**, with the surface each needs:

- G22 — a design that keeps tree-table focus across a deferred settle, then a `wt` prototype arm; `table-rows` alone shows 51 ms per resize frame.
- G23 — a deterministic `table-rows` wheel phase, or the verdict taken on the three sound cells (25–27 ms per update, filter and sort frame).
- G21 — the same deterministic wheel and tree-table key phases; its sound cells show work only.
- G16 — split: the scroll-read memo reads `win` on its own (3.3 ms on the deep shell's editor wheel); the settled-pass arm needs a surface with more than 2 reads per pass.
- G27 — a cache that preserves which heading is active; the arm changed it.
- G25 — a panel that has shown every tab once before switching theme.
- G12 F06.3 — a `wt` prototype arm; the runtime patch slows the park cell by itself.
- G12 F06.4 — no work avoided in any cell; recommended **drop** despite the rule's reading.

**Drop it:** G14 (work −3%, frame time flat), G21's single-record narrowing
(no excess).

**Found while planning the sweep** (from the plan, not the runs):
`IconText.setGlyph` and the display `IconLabel.setGlyph` leak the glyph they
replace, as C10 did — a correctness item missing from the register.
