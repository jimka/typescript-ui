# Render-review post-campaign agenda

The running order for what the campaign left open, decided 2026-09-19 once
wave 2 was merged. `00-agenda.md` holds the decisions taken during the
campaign and `99-synthesis.md` stays the evidence; this file is what comes
next, in the order the user set: a QA app as the measurement surface, then
the correctness bugs, then wave 3.

## Where the campaign stands

| Step | Plans | Measured |
|---|---|---|
| Wave 0 | `cell-editor-record-binding`, `autocomplete-store-query`, `layout-flush-degenerate-inputs`, `focusable-selector-and-roving` | C1–C5, C17, C20, C28, C32 fixed; no performance cost |
| Wave 1 | `pending-plan-amendments` (G01), `progress-indicator-resize-relay` (G06), `component-setter-guards` (G07) | S3 −17.4% |
| Style-write filter | `same-value-style-write-filter` (G04's surviving half) | S1 −44% |
| Wave 2 | `border-region-size-memo` (G12's F06.5), `accordion-seed-pass-economy` (G13), `size-hint-per-pass-memo` (X4), `unchanged-commit-skip-staged` (G09, staged) | work −56.7% S1, −43.3% S3; geometry identical |
| Outside the waves | `no-dom-access-at-import`, found through a Loom test that crashed on import | every entry point but `core` imports with no DOM |

## Phase 1 — a QA app as the measurement surface

**Why first.** Every number the campaign has is from Loom, and Loom renders
only its own slice of the library: its scenes have no chart, diagram, table,
form or virtualised list. A null result there is not a library-wide null (the
user's correction, 2026-09-17). Most of wave 3 sits on exactly the components
Loom never mounts, so without a surface that reaches them wave 3 cannot be
bounded before it is planned — which is the step that stopped wave 2
repeating wave 1's mis-ranking.

**Decided 2026-09-19.** The first idea was to make the docs site
(`packages/docs`) the surface by injecting a harness into it, and to share the
harness core with Loom's by import. The user replaced that with a
self-contained QA app:

- **`packages/qa` holds everything a run needs** — its own page, Vite config,
  harness, runner, analysers and **panels** (the scenes it measures). Nothing
  is injected into the docs site, Loom or any other app. Panels import the
  library only, never the docs demos, so a demo edit cannot shift a baseline.
- **Behaviour found in another app becomes a panel.** Finding stays in the
  real app (a WebKit Timeline recording); a panel counts as reproducing the
  behaviour only once it shows the same symptom.
- **Every panel runs in a browser and in Tauri.** The runner takes a host:
  MiniBrowser, or a minimal Tauri shell that loads the same page. Tauri on
  Linux is the same WebKitGTK engine inside the host Loom ships in; on
  Windows and macOS it is a different engine. Frame times are compared within
  a host, never across.
- ~~**Loom's `qa/` stays as it is** until the QA app's Loom-like panels (the
  deep and shallow app layouts standing in for S1 and S3) have their own
  baselines; a small Loom plan then removes it.~~ — **settled 2026-09-21:
  Loom's harness is retired.** `shell-deep` and `shell-shallow` recorded
  their S1 and S3 stand-in baselines on 2026-09-20 under both hosts, and a
  separate Loom plan removes Loom's `qa/`. The campaign's recorded numbers
  were measured in Loom's real shell and do not carry over to a panel.

Plans, in order: `qa-app` (the app, the runner's host switch, one chart
validation panel reproducing 26 F26.1), then `qa-app-tauri` and
`qa-app-panels` side by side, then `qa-app-panels-editors-overlays`. Every
run opens a full-screen window, so no agent runs one without the user's
go-ahead.

## Phase 2 — correctness bugs

1. **The synthesis's open register.** 27 of C1–C36 were open by the record:
   C6–C16, C18, C19, C21–C27, C29–C31 and C33–C36. No plan since wave 0 claims
   any of them, but waves 1 and 2 edited several of the same files (`Text`,
   `Button`, the layout base), so planning started with a status pass against
   `master`. **That pass ran 2026-09-20 at `82f012b1` —
   `01-phase2-status-pass.md`.** 25 are open; C12 and C13 are closed (wave 1's
   `8d8adb29` and C1's `6b8e0d5a`, both with regression tests). The pass also
   corrected the register in six places, grouped the work into ten plans, and
   found that C6, C22 and C27 are one bug family rather than three.
   `00-agenda.md` Decision 1 wanted C6, C7 and C8 not to wait
   (growing leaks on paths the target app runs); C6 was meant to ride in G07
   and did not, and C7 was meant to ride in G25, which is wave 3 — both come
   here instead.
2. **Found during wave 0** (`00-progress.md`): a closeable tab strip keeps one
   extra Tab stop per close button; `Dialog`'s Tab trap takes Tab from an
   editing surface placed first or last; and two documentation gaps around
   `CellEditorPool` and the cell-editor fix's consumer-facing consequence.
3. ~~**The latent `CellEditorPool` ownership guard**~~ — **closed.** The
   2026-09-20 status pass confirmed C1's fix closed it: `acquire` commits the
   outgoing cell before taking the slot, and `release(cell)` takes the
   releasing cell and returns early unless it owns the slot.
4. ~~**`core` still touches the DOM on import.**~~ — **closed.**
   `plans/body-lazy-singleton.md` made the singleton construct on the first
   `Body.init()` / `Body.getInstance()` call, so `./core` imports with no DOM
   and `KNOWN_IMPORT_TIME_DOM` in
   `packages/lib/tests/unit/import-without-dom.test.ts` is now empty.

5. **A store of 1,000+ records silently never builds its view** (found
   2026-09-20, by the QA app's first authorised sweep). Two defects, one
   symptom — a table bound to such a store stays empty for the life of the
   page, with no error anywhere:
   - The built library asks the *consuming app* for the worker by a
     root-absolute, build-hashed URL: `packages/lib/dist/lib/MemoryStore-*.js`
     calls `new Worker("/assets/StoreWorker-<hash>.js")`, from
     `~/data/StoreWorker.js?worker` in `data/StoreWorkerClient.ts`. The file
     ships inside the package at `dist/lib/assets/`, and no document asks an
     app to copy it to its own root, which a changing hash makes impractical
     anyway.
   - `AbstractStore` never recovers. `applyView` offloads above
     `WORKER_THRESHOLD` (`:1905`) whenever `StoreWorkerClient.isAvailable()` —
     which only checks that `Worker` exists, not that its script loaded — and
     `loadData` then waits for the worker before emitting `load` (`:446-458`).
     `_records` then stays empty forever: no fallback to the in-process path,
     no error, no event. The request need not even 404 to do this: measured
     against the QA app's dev server, the SPA fallback answered `200
     text/html`, so the worker was handed the page's own HTML, and
     `StoreWorkerClient` sets only `onmessage` — no `onerror`, no
     `onmessageerror` — so nothing ever settles.

   Loom is unaffected (it uses no store), but a data-heavy consumer such as
   SQLAdmin is exactly the case. Reproduce with any panel over the threshold
   (`table-rows` at 10,000) and a QA app that does not serve the asset.

6. **C10, the tree-table glyph leak, is measured and ready to plan.** It sits
   inside item 1's range, but the QA app now pins its runtime signature, so it
   is called out here. `TreeCell.refreshToggle`
   (`component/table/cell/renderer/TreeCell.ts:221-224`) detaches the outgoing
   caret with `removeComponent` and never disposes it, so each toggle mints a
   fresh `Glyph` with its own `#id` rule. Measured on the `treetable-rows`
   panel at 200 roots (2026-09-20, lib `608544c9`, run `c10-probe`): per
   `toggle` unit the swap is flat — `ensureStyleRule`, `setRuleStyles`,
   `createElement` and `removeElement` all 70.5 — and deletes no rule in that
   path. `deleteStyleRule` is absent over 2 units and 55.7 over 20, tracking
   elapsed time rather than work: `Component`'s `FinalizationRegistry`
   reclaiming the orphaned carets' rules at GC. So the leak is real, and
   GC-bounded rather than unbounded — the cost is the per-toggle churn and
   whatever the collector has not yet reached. The panel will show the fix.

## Phase 3 — wave 3

**Before planning, a W3.0 bounding sweep**, as W2.0 did for wave 2: a fresh
baseline, then a same-session interleaved A/B per candidate, scored on work
avoided as well as milliseconds, gated on geometry equality in a deep and a
shallow scene — in the QA app's panels.
Every ceiling in the synthesis was measured
before three waves landed, and G15 showed a group can be absorbed by an
earlier one without anyone noticing.

Candidates:

- **Groups never started:** G05 `resolve-bounds-lazy-size-reads`, G08
  `environment-read-caching`, G11 `box-layout-per-pass-gather`, G14
  `accordion-closed-section-render-tree`, G16
  `panel-settled-pass-and-scroll-reads`, G17 `glyph-name-setter`, G18
  `text-measurement-without-reflow`, G19 `tooltip-hover-path`, G20
  `event-dispatch-and-registrants`, G21 `table-render-pass-economy`, G22
  `table-resize-settle-relay`, G23 `table-header-and-cell-write-economy`, G24
  `list-and-tree-row-economy`, G25 `codemirror-theme-singleton`, G26
  `markdown-viewer-resize-and-lexer`, G27 `markdown-heading-scroll-cache`,
  G28 `continuous-motion-pattern`, G29 `dead-surface-and-docs-sweep`.
- **What wave 2 left of G12:** F06.3, the no-op drag-frame gate on
  `Split.onDrag`, was never measured because Loom's drag never parks against
  a clamp; F06.4, the `recalculateSizes` signature gate, laid the page out
  differently as ablated and must earn its correctness first; and F06.9, the
  collapse animation re-laying-out participants that do not move, which no
  wave-2 plan took up.
- **More G09 opt-ins.** The skip ships with only `MenuBar` and `ToolBar`
  opted in; forced on everywhere it avoided 68–78% of work in-process, so the
  headroom is in auditing further classes.
- **`AbstractChart` rebuilds its whole SVG on every layout pass** (26 F26.1).
  `doLayout()` calls `repaint()` unconditionally, which clears and rebuilds
  every mark — axes, gridlines, ticks, labels, series, selection ring — with
  no unchanged-size guard; an *empty* chart still rebuilds 57 axis marks.
  `DiagramView.doLayout` guards the same path, so this is a defect, not house
  style. The fix needs a size-and-data signature, since a bare size guard
  would suppress legitimate data repaints. None of G01–G29 covers it. Plan it
  with F26.2's per-pass margin measurement (the batching half of which is in
  G18) and the chart's repeated attribute writes in `sizeSurface`.
- **The `resizeMode: "live" | "outline"` flag** — `00-agenda.md` Decision 2,
  adopted and never planned. `98-wave2-rejustification.md` places it after
  G12's shared drag-flush seam.

G10 and G15 stay dropped (`98-wave2-rejustification.md`,
`97-wave2-measurement.md`).

## Open, not yet placed

- ~~`tsc -p packages/lib/tsconfig.json` reports 30 errors~~ — **answered
  2026-09-20: stale config, not rot.** 21 are unused locals that
  `tsconfig.test.json` deliberately switches off (forcing the flags back on
  reproduces exactly those 21); 9 are timer-type mismatches from
  `tsconfig.json` having no `include`, so it compiles `build/` and the Vite
  configs and pulls `@types/node` into the program. The bare command measures
  the wrong program: it wants an `include` or `"types": []`, or removal from
  this list. Still a user call, but no longer an open question.
- `npm run docs:api` emits 14 warnings on `master`, so plans must stop
  writing a zero-warning bar into their verification, or the 14 get fixed.
- **A blob object URL leaks on every blocked store-worker construction
  under a strict CSP** (found 2026-09-20 by the review that consolidated
  phase 2's first batch; moved here from `01-phase2-status-pass.md`
  2026-09-21). Vite's inline-worker shim does `createObjectURL(blob)` →
  `new Worker(objURL)` → on failure `new Worker("data:…")`, and revokes the
  object URL only from the worker's own `error` listener. Under a policy
  allowing neither `blob:` nor `data:`, the URL is never revoked and both
  attempts emit a violation — once per `applyView()` on every store over the
  threshold, because `isAvailable()` calls `ensureWorker()`. The view is
  still built and every event still fires, so this is noise and a bounded
  leak, not incorrectness. The reviewer's suggested remedy — retiring the
  client when construction throws — contradicts
  `plans/implemented/store-worker-fail-safe.md`'s Architecture Decisions,
  which state the opposite as the design, so it needs its own small plan
  that revisits that decision rather than an in-flight fix.
- The library's own demo app (`packages/lib/index.html`, entry
  `src/typescript/main.ts`) puts 32 demo panels in one `Tab` layout, so the
  tab bar is squashed. The user wants it restructured; it is its own piece of
  work, separate from the measurement surface.

## Found while planning phase 2's follow-ups (2026-09-21)

Six plans were drafted on 2026-09-21 for what phase 2 left behind:
`test-suite-health`, `date-roundtrip-and-tab-active-index`,
`checkbox-action-activation`, `field-decorator-pointer-tooltip` and
`doc-and-qa-record-drift` in the library, and `retire-qa-harness` in Loom.
Drafting them turned up the following. Items that one of those plans fixes
say so; the rest are open.

- **The QA click driver never toggled a boolean control** — fixed by
  `checkbox-action-activation`. The driver dispatches each click onto the
  control's root element, but `Checkbox` toggles only from its inner box and
  `Toggle` only from its track, so `form-flat`'s C34 witness read 0 on both
  arms for that reason, not mainly because of C40. The plan's reworked
  witness clicks the surfaces each control toggles from.
- **`List` and `ComboBox` still announce `"action"` on a programmatic
  `setSelectedIndex`** — fixed by
  `plans/implemented/programmatic-selection-action.md`.
  `checkbox-action-activation` makes `"action"`
  mean user activation for `Checkbox` and `Slider` and names these two as
  the one known exception. They do not share C40's delivery bug, and
  aligning them changes `ComboBox`'s listener argument.
- **A drag-reordered `Tab` strip does not survive save and restore** — open,
  a non-goal of `date-roundtrip-and-tab-active-index`. Layout serialization
  saves the container's order, which is the order the tabs were added, while
  the docs promise the user's tab order.
- **One `Header` debounce caused two of the suite's intermittent failures**
  — fixed by `test-suite-health`. "DOM handle N is not registered" and the
  `ColumnFilterRow` unhandled rejection are the same defect: `Header.ts`
  arms its 200 ms filter debounce on the global `setTimeout` rather than the
  DOM seam's timer, so `DOM.reset()` cannot cancel it and it fires after its
  test ends. The same plan also fixes a fifth flaky test, the
  `collectSyntaxErrors` cap, which fails when CodeMirror's 20 ms initial
  parse budget runs out.
- **A pointer can never show `FieldDecorator`'s error tooltip** — fixed by
  `field-decorator-pointer-tooltip`. The field covers the decorator's whole
  box, and the tooltip listens only for events aimed at the decorator's own
  element, so resting the pointer on an invalid field never says why it is
  invalid.
- **Retiring Loom's harness keeps its browser shell and gives up measuring
  Loom's real shell** — `retire-qa-harness`. The Tauri stubs and the
  `/__fsops` endpoint, which run Loom in a plain browser tab for
  chrome-devtools checks, move to `browser-shell/` behind `npm run
  dev:browser`. Loom's own shell can no longer be measured by any harness,
  and the campaign's Loom-shell numbers can no longer be re-run. The run
  records move to `~/.claude/projects/-home-jika-typescript-loom/qa-harness/`,
  where the research docs' citations of them resolve again.
- **The stand-ins do not cover every Loom scenario** — open, and a W3.0
  requirement. `shell-deep` has a driver for S1's own gesture, the
  horizontal dock gutter (`grip=dock-h`), but no recorded baseline: the
  README records `park`, the sidebar drag and `theme:4` only. S2, S4 and
  the search scenarios have no stand-in at all. W3.0's fresh baseline must
  include `grip=dock-h`.
- **`FieldDecorator`'s error is invisible to assistive technology** — open,
  a non-goal of `field-decorator-pointer-tooltip`. There is no
  `aria-invalid`, no `aria-describedby`/`aria-errormessage`, and no tooltip
  `role`, and keyboard focus does not reveal the error. The fix needs a
  persistent message element per decorator and `Aria` setters the library
  does not have.
- **`Tooltip.attach` never arms over a composite field's parts** — open, a
  non-goal of `field-decorator-pointer-tooltip`. A tooltip on `DateField`,
  `TimeField`, `NumberSpinner` or `Toggle` does not show over their inputs,
  buttons or track, nor one on `Checkbox` over its box, because the parts
  cover the host and `attach` listens on the host's own element only.
  `LabeledGrid`'s field descriptions hit this. The fix needs a
  nearest-tooltip-wins subtree mode, not the covering mode the decorator
  fix adds for its error.

## Found by the post-merge audit of phase 2's follow-ups (2026-09-21)

Six fresh reviewers audited the merged batch (`4952f384..09a99c2a`) and
Loom's harness retirement. Only `field-decorator-pointer-tooltip` drew
blocking findings, all of them untested contracts rather than code defects;
`feature/tooltip-ownership-test-gaps` adds the tests (the audit loop hit its
three-round cap, and its last fix was verified by hand). The advisories
worth a plan of their own are all open:

- **A user activation can throw after its own listener disposes the
  control.** `Checkbox.activate` and `Slider`'s user path (`Checkbox.ts:407`,
  `Slider.ts:636`) fire `"action"` without re-checking the element, so a
  `"change"` or `"binding"` listener that disposes the control (a form rebuilt
  on a record change) makes `Event.fireEvent` throw and abort the rest of the
  dispatch. The old `setSelected` path guarded this. `RadioButton.ts:334` and
  `ToggleButton.ts:284` have the same exposure; `AbstractSelectableList.
  fireChange` is the guarded precedent. Fix all four together.
- **`parseClockTime` is looser than the docs now claim.** It accepts
  `9:30:00:99`, `1e1:30`, `0x9:30`, `9.5:30` and `09:30:` (`dateMath.ts:241`),
  which `TimeField`, `DateTimeField` and the table's time editors all share,
  while the new editor docs and the changelog say a typed value the text never
  named is no longer committed. One tightening fixes all five.
- **The decorator's error arms only when the pointer enters from outside.**
  `showError` called while the pointer already rests on the field — validation
  on change after a click into it, the common case — shows nothing until the
  pointer leaves and comes back, because moves between the field's own parts
  are ignored (`Tooltip.ts:620-626`). `FieldDecorator.showError`'s JSDoc
  promises the error "when the pointer rests anywhere on the decorated field".
- **A tooltip shown through `Tooltip.show` is no longer hidden when the
  pointer leaves an `attach` host.** The leave rule now hides only a tooltip
  the host owns, and `show` records no owner. No caller in the library, Loom
  or SQLAdmin relies on the old behaviour (`AbstractChart` hides its own), but
  the changelog says "No consumer action is needed" and `Tooltip.md`'s manual
  control section does not mention it.
- **ARCHITECTURE.md does not name `Tooltip`'s attach family as an exception**
  to its rule against listening on another component's events, though
  `attach` always did so and `attachCovering` now does it on a subtree.

## Wave 3: measured and planned (2026-09-22)

W3.0 ran in full: 394 of 394 runs on `83cfb0d7`, recorded in
`96-w3-0-bounding-sweep.md` on `feature/w3-0-results` (stacked on
`feature/w3-0-bounding-sweep`, which builds the sweep). Fifteen candidates
read **plan it**; they are drafted as thirteen plans in `plans/`:
`text-measurement-without-reflow` (G18), `motion-transform-inline` (G28),
`chart-repaint-gate` (F26.1; F26.2 folded into G18's memo),
`markdown-lexer-linear-time` (G26), `unchanged-commit-opt-ins` (G09),
`layout-size-read-economy` (G05 + G11), `glyph-name-setter` (G17, with the
F14.11 leak and three more like it), `list-and-tree-row-economy` (G24),
`split-collapse-static-participants` (G12 F06.9), `drag-resize-outline-mode`
(`resizeMode`), `environment-read-caching` (G08), `event-dispatch-walk` (G20)
and `tooltip-idle-reattach` (G19). Eight candidates **need a different
surface** (G21, G22, G23, G16, G25, G27, G12 F06.3 and F06.4 — the record
names the surface each needs); G14 is dropped.

Found while planning, not in any plan:

- **A rail-minimized window still takes a slot in the bottom dock and is moved
  into it** (found by `environment-read-caching`). The minimized-window stack
  counts windows the rail already holds.

## Wave 3: implemented and measured in-engine (2026-09-23)

All thirteen plans are implemented as one linear stack off master `37606021`,
and measured: 456 MiniBrowser runs, none failed — 359 per-plan (each plan
against the branch below it), 67 for the whole stack against master, 20
confirmation re-runs and a 10-run probe. The full record, with every cell and
each plan's acceptance criteria, is `97-w3-implementation-measurement.md`; the
QA app's README now carries the readings in its Validated cells. The user ran
the manual by-eye checks on 2026-09-23 and all pass.

Found by the measurement, not by any plan:

- **The QA app's `text-metrics` panel is not deterministic in its first
  `update` phase.** Six of its 117 probed rectangles — all on row 9, widths
  only, in unit 0 — vary by 1–2 px between runs, and the variation ignores
  which library is loaded. It is the signature of measuring before the web font
  swaps in. The consequence is that the cell's first phase cannot gate
  anything. The fix is most likely to wait for the font-settled signal
  `Body.init` already uses before driving the first phase. A QA-app defect, not
  a library one.
- **`FieldDecorator`'s error not arming under a resting pointer is now
  confirmed user-visible**, in the tooltip plan's M3 check: the message changes
  and the old tooltip fades, but the new message appears only after the pointer
  leaves the field and returns. The bug is already recorded above under *Found
  by the post-merge audit*; this raises its priority, because validation on
  change after a click into the field is the common case.
- **The layout-skip opt-ins have a second stage waiting on the form panels.**
  `unchanged-commit-opt-ins` reaches −3.5% and −7.4% of the work on a form
  layout pass where its plan predicted −84%: that figure came from W3.0's
  ceiling ablation rather than the four classes that shipped. The form panels
  are the obvious surface for the next staged opt-in, and `g09.all` now
  measures headroom over the shipped opt-ins rather than an absolute ceiling.

Costs accepted by the user (2026-09-23), all recorded in the measurement:
a deep-shell resize is 1–2 ms slower under `layout-size-read-economy`, with
every work counter and seam read falling — the cost is engine-side and
invisible to the harness's instruments; the chart repaint gate costs 0.2–0.4 ms
on a pass that repaints anyway; the dispatch walk costs under half a
millisecond on a dashboard hover.

## G22 unblocked: the tree table's focused cell (2026-09-24)

W3.0 read `ttr`'s `DIFF(focused)` as "deferring the settle changes which cell
holds focus" and sent G22 for a different surface. That reading is wrong, and
two measurements retire it.

**Offline** (throwaway probe, a `TreeTable` with a selected record, the
ablation's deferral applied to `Cell.applyBounds`): the focused cell keeps its
identity — same pool slot, same column, same record — mid-burst and after the
settle. Its rectangle is stale mid-burst (526 px wide against the live arm's
426) and identical once the settle runs.

**In engine** (five runs, prefix `g22r-ttr-`, `panel=treetable-rows&drive=resize,idle:4`):
every probed rectangle is `[1, 22, W, 20]` — only `W` moves. The plain arm's
width tracks the drag continuously (2434 → 2323 → 2431); the ablated arm holds
2434 for all 150 units, then reads 2434, 2434, 2431, 2431 across the four idle
units. It converges within two frames and lands on the plain arm's exact width.
The resize phase is 103.02 → 81.58 ms per frame, work −92.4%.

So the geometry gate, not the change, is what failed the focus question: it
compares every unit, including the mid-burst ones the deferral is meant to skip.
A G22 plan needs a gate on the settled state — the last unit of the settle
phase, or a probe taken after it — and the same treatment applies to any later
candidate that defers work within a burst.
`VirtualRowView.deferRowLayoutWhileResizing` already ships this contract for
tree rows, so G22 extends a shipped pattern to table cells rather than inventing
one.

**But the deferral is visible, and that is the real decision.** Watching the
ablated runs, the user saw the body cells stay put while the header moved: for
the length of the drag the columns' contents no longer track their headers, and
they snap into line only when the burst ends. The probes could not show this —
they measure a converged rectangle, not whether the table looks right in the
hand. So G22 is not a free win to be gated and landed; it is the same choice
`drag-resize-outline-mode` put to the user one layer up, live against outline.
A plan has to say whether a column resize may leave the body behind, and if so
whether that is the default or an opt-in, or else find a way to keep header and
body in step while still skipping the per-cell layout — moving the cells with a
transform during the burst, for instance, and reconciling on the settle.

## Found while implementing the ten-plan batch (2026-09-25)

The ten plans that close out this agenda's open items are implemented as one
56-commit stack. Three defects surfaced during that work, none of them in any
plan's scope, each verified against the source. The first two are why two
branches had to reach for a production DOM seam they would otherwise not have
needed.

- **`Glyphs.ts` never resets its sprite handle, and this campaign's own report
  says it does.** The module-level `_spriteElement` and `_spriteMounted`
  (`Glyphs.ts:58`) are assigned once at `Glyphs.ts:132-133` and nothing ever
  clears them: the module has no reset hook and `core/DOM.ts` never mentions
  `Glyphs`. So a jsdom suite that mounts a new SVG glyph after a `DOM.reset()`
  appends into a sprite element belonging to the torn-down document.
  `activation-after-dispose`'s new regression suite hit exactly this and works
  around it with a `beforeAll` priming step. `13-button-glyph-image.md:387-388`
  asserts the opposite as fact — "which already resets
  `_spriteMounted`/`_spriteElement`" — which is likely why the hole went
  unnoticed. A fix needs a reset signal the module subscribes to; correcting
  that sentence costs nothing and should happen either way.

- **The modelled DOM's teardown records but never evicts.** `_byId` and
  `_stubs` (`tests/dom/TestDOM.ts:141-143`) carry no `delete` and no `clear`
  anywhere in the file. `removeElement` (`TestDOM.ts:603`) detaches the parent
  and leaves the id index intact, so `getElementById` still answers for a
  removed element, and `release` (`TestDOM.ts:559`) only records, so a released
  handle still resolves. That makes a whole class of bug invisible offline:
  disposal, and use-after-free. Both bit this batch —
  `activation-after-dispose` needed a production-DOM regression file to see a
  control disposed mid-activation, and `validation-error-arming` could not
  stage a dead handle offline at all, so its new `isRegistered` query is pinned
  against the real registry with spies standing in for its two consumers.
  Making `release` drop its stub and `removeElement` clear the id would retire
  both workarounds. The blast radius is every test that releases a handle and
  then reads it, which is why neither branch attempted it.

- **`component/table/Row.doLayout` never records its pass.** `Row.ts:1003`
  returns `this` without calling `super.doLayout()`, documented as "No-op; cell
  layout is driven by the Body's renderWindow" — but the base call is what
  records that a pass ran, so every `Row` is permanently dirty and can never
  skip an unchanged commit. This is the same defect
  `unchanged-commit-opt-ins-forms` fixed in `Slider.doLayout`, and that
  branch's AST scan of all 33 `doLayout(): this` overrides found exactly two
  bodies missing the base call: `Component`'s own and this one. Nothing is
  wrong today, because `Row` is not opted in; the cost is that it cannot be
  until this is fixed.

## First measurements of G16, G25 and G27 (2026-09-25)

The three candidates W3.0 sent away for want of a surface now have numbers. All
readings are from the ten-branch batch's tip (the new panels ship on it), one
session per cell, the sweep's scored-cell shape, `work=1&seam=1&geom=1`, runs
`w31s1-*`, `w31b-*`, `w31c-*` and `w31d-*`. Geometry is `=` on every run of
every cell.

- **G16 `panel-settled` is a work win, and only measurable because the panes are
  subclassed.** `seam.source.getScrollMetrics` falls from 48.00 to 0.32 per unit
  on the settled `passes` phase — **−99.3%**, engaged, geometry identical. The
  ms
  delta (−0.60) sits inside a 1.40 bracket that `plain-a`'s 4.47 warm-up outlier
  opened, so the time verdict is flat and the work verdict is decisive. Worth
  remembering why the cell reads at all: with plain `Panel` panes it emitted no
  counter whatsoever and scored `unreached`, because stage 1's opt-in already
  withholds the whole pass from an exactly-`Panel` pane. **G16's remaining cost
  therefore exists only for panels that are not opted in** — which in practice
  means subclasses, i.e. most application panes. `g16.scroll-reads` never
  engaged on this surface and is still unmeasured.

- **G25 is unsound as ablated, and the new panel caught it on its first run.**
  `g25.theme-withhold` shows a large win — **−25.84 ms per unit, −19%**, engaged
  — and the cell is nonetheless **void**, because `editor-tabs`' own
  shown-tab check fires. Over the 14-unit phase at `n = 8`: 14 shown, 98
  withheld,
  7 checks; the plain arm matches 7 of 7, the ablated arm matches **1 and
  mismatches 6**, deterministically in both runs. So bringing a hidden tab back
  after a theme switch shows a stale-themed editor six times in seven — the
  common path, not a corner. The one match is the tab that was visible when the
  switch went out. This is *not* the instrumentation artifact the plan's
  `[^counter-order]` predicts: that loses a count, it does not turn a match into
  a mismatch. A G25 plan may not simply bank the 19%, and the bullets below
  show why the obvious remedy is not one.

- **G27 inverts with document length; it is not a loss outright.** On the `call`
  ladder — a triangle of absolute offsets, the worst case for a cache, since
  every
  tick jumps — `g27.heading-cache` reads, by section count: `n = 60` **+3.76
  ms**
  (bracket 2.39, regress); `n = 90` −2.18 (3.10, flat); `n = 120` −2.45 (3.02,
  flat); `n = 200` **−1.27** (0.24, win). Sixty is the only size where the
  sign is
  positive, and the crossover lies between 60 and 90: below it the cache's
  bookkeeping exceeds the scan it replaces, above it saves one to two and a half
  milliseconds a tick. The `wheel` phase is flat at every size. So a G27 plan
  looked to be choosing between gating on heading count and accepting a cost on
  short documents, until the bullets below found what sits underneath that
  choice — and the 90 and 120 cells want a quieter session before their sign is
  relied on.

- **G27's residual cost is a cache-miss rate, not a document length.** The arm's
  own counters put the rebuild rate at a fifth to a third of the ticks it serves
  on the `call` ladder: `trackHit` 0.75 against `rebuildMiss` 0.21 per unit at
  `n = 60`, and 0.65 against 0.31 at `n = 200`, identically in both reps. Every
  miss re-measures every heading, and the arithmetic closes: 0.21 × 60 and
  0.31 × 200 are 12.6 and 62, against a measured `querySelector` of 14.42 and
  68.23 per unit, the small remainder being the `_pendingClickScrollTop`
  passthrough a programmatic scroll takes by design. So the arm's entire
  remaining scan is its own misses. `g27HeadingCache` (`ablations.ts:2309`) keys
  invalidation on `_headings` identity, `scrollHeight` and `clientWidth`, and
  `scrollHeight` grows while a lazily-rendered document scrolls, which throws
  the cache away on the very ticks it exists to serve. Section count is a proxy
  for that rate, not its cause.

- **The `wheel` phase already shows a perfect cache buying nothing.** There
  `trackHit` is 0.99 with no misses at all and `querySelector` falls from 24.79
  to 0.03 per unit at `n = 200` — the scan eliminated, −99.9% — while the time
  goes 60.70 to 61.32, flat, and 62.37 to 61.77 at `n = 60`. Since `call` units
  average 70 to 92 ms, every G27 ms reading is 1.5% to 5% of a unit. The signs
  are still real: both arm reps sit outside the plain spread on `call` (75.4
  against 70.7–73.1 at `n = 60`, 90.9 against 92.0–92.3 at `n = 200`). But the
  phase where the mechanism demonstrably works is the phase where the clock
  does not notice, which points at the rebuild burst — N heading measurements in
  one tick — as the thing being timed, not the steady-state scan.

- **G27 is closed: at `n = 1000` the scan is still free.** Five runs at five
  times the largest size measured before, same cell shape, runs `w31d-*`. On
  `wheel` the cache reaches a 0.97 hit rate and strips `querySelector` from
  91.07 to 26.83 and `getElementRect` from 108.03 to 42.81 per unit — about 129
  source reads a tick removed — for Δ −0.67 ms against a 1.57 bracket. On
  `call` it removes about 367 reads a tick, 501.44 to 318.19 and 603.88 to
  419.98, for Δ −1.22 against a 3.82 bracket. Both flat, both reps agreeing,
  and `heading.agree` identical at 0.960 and 0.990, so the cache's answers are
  right: the candidate is sound and worthless. Read as upper bounds, those two
  deltas put a source read at three to five microseconds on WebKitGTK, so a
  pane would need some thousands of headings above the fold before the scan
  cost a frame. The `n = 60` regression does not scale either — by `n = 1000`
  the rebuild burst is repaid. **No G27 plan, no length gate, no tightened
  invalidation key.** `findActiveHeading` is a pure read batch, one layout
  flush and N cheap rects, and the seam counter's three-figure tallies were
  counting something that does not cost.

- **G25's catch-up on show already exists, fires, and does not help.**
  `g25ThemeWithhold` has always re-applied the withheld `onThemeChange` from
  `onEffectiveVisibilityChange` (`ablations.ts:2095-2104`), so the reading above
  that a plan must *add* a catch-up was wrong. Probed by counting that branch
  (runs `g25p-*`, instrumentation since reverted): over the 14-unit lap the
  flush fires 6 times out of 6 rising visibility changes, and the check still
  reads 1 match against 6 mismatches, exactly as before. Deferring the flush by
  a task instead (`g25q-*`) is strictly worse — 7 mismatches, 0 matches — so it
  is not a timing problem in that direction. It also looked as though the
  editor that received no flush was the one that matched, and so as though
  replaying the method that applies a theme does not reproduce it. The next
  section corrects both: the unflushed editor is tab 7, which mismatched, and
  the replay is correct but one frame late. `theme.indistinct` never
  fires, and `codeEditorTheme` memoises per mode (`theme.ts:83-88`) so the
  style-module class is stable across calls — the oracle is canonical and this
  is not a false alarm. The ms win is meanwhile steady at about −27 and −21%
  across all four arm runs, plain reading 127.15 in the same sitting.

- **One show in seven delivers no `onEffectiveVisibilityChange`.** The lap shows
  seven tabs and the hook fires six times. Four library sites hang deferred work
  off that hook — `Markdown.ts:1508`, `AbstractCanvasSurface.ts:472`,
  `CodeEditor.ts:1943` and the catch-up layout at `Panel.ts:1159` — so a show
  that skips it skips those flushes too, including the re-show re-measure
  `CodeEditor`'s own doc says exists because CodeMirror's observer misses that
  case. `Tab.lifecycle.test.ts` and `code-editor-reshow-measure.test.ts` both
  pass, so whatever the gap is, neither covers it. That looked worth its own
  look independently of G25; the next section places the seventh edge one frame
  past the phase window instead, so it is most likely not a library gap.

- **What G25 needs next is a debug pass, not another cell.** The question is
  narrow enough to answer offline against the library's own tests: what leaves a
  withheld-then-replayed `onThemeChange` with a different `.cm-editor` class
  list from the reference editor's? Two cheap hypotheses are already dead — a
  mistimed flush and a vacuous oracle — and each further guess costs a desktop
  cell. Until that is answered the 19% cannot be banked, and even once it is,
  the candidate defers rather than removes: the `theme` phase measures the
  switch and never the show, so a cell that drives tab activation inside the
  measured window has to price the relocated work before any of this is a
  saving.

## G25 debugged offline: the catch-up is one frame late (2026-09-25)

The debug pass the previous section asked for, run offline only. A throwaway
test mounted a `Tab` of eight `CodeEditor`s beside a reference, stubbed each
`_view` to record the last theme dispatched into it, reinstated
`g25ThemeWithhold` verbatim, and replaced the recording sink's
`requestAnimationFrame` with a FIFO queue that runs a callback requested inside
a frame on the next one — the browser's order, and the order `runFrames` relies
on. It reproduces the desktop reading exactly: 98 withheld, tab 1 matches, tabs
2–7 mismatch as `light vs dark`. The test was not committed.

- **The withhold and the catch-up read two different visibility clocks.** The
  withhold asks the live `isEffectivelyVisible()` walk, which turns true the
  moment `Tab.doLayout` calls `setDisplayed(true)` on the page. The catch-up
  waits for `onEffectiveVisibilityChange`, which only the coalesced reconcile
  delivers — and `setDisplayed` queues that reconcile from inside the layout
  flush, so it lands one frame later. A show therefore spans three frames:
  unit `2k` switches the theme and selects the tab (layout queued); the next
  frame's layout flush displays it and queues the reconcile, then the
  harness's unit `2k+1` checks it — still on the mount theme, a **mismatch** —
  and switches back, which the now live-visible editor applies directly; the
  frame after that, the rising edge replays `onThemeChange`, which reads the
  current theme and changes nothing. The replay is correct; it is late. The
  mismatch is a real one-frame stale paint of a re-shown tab, not an oracle
  artifact.

- **Every earlier reading follows from that.** Tab 1 matches only because a
  reconcile frame was already pending from the lap's first theme switch, so its
  edge coalesced into the frame before the check. Deferring the replay by a
  task (`g25q-*`) pushes tab 1 past its check too, hence 0 of 7. The previous
  section's pairing of "the editor that received no flush" with "the one that
  matched" misread the counts: the unflushed editor is tab 7, which mismatched,
  and tab 1, which matched, was flushed.

- **The "one show in seven with no `onEffectiveVisibilityChange`" is most
  likely the phase window, not a library gap.** Tab 7 is shown on unit 12 and
  checked on unit 13; its rising edge arrives the frame after unit 13, outside
  the measured phase, so an in-phase counter sees six. The offline model
  delivers it (with and without the trailing `restore()`), so the separate look
  at `Markdown.ts:1508`, `AbstractCanvasSurface.ts:472`, `CodeEditor.ts:1943`
  and `Panel.ts:1159` the previous section proposed is not owed on this
  evidence. Not confirmed in-engine.

- **The remedy is to catch up in the pass that displays the editor.** With the
  ablation additionally replaying from `doLayout` when the editor is owed and
  `isEffectivelyVisible()` — the same layout flush `Tab.doLayout` displays the
  page in, before paint — all seven checks match and the withheld count is
  unchanged, so the skip survives. A G25 plan should hang its catch-up on the
  layout pass (or the display flip), never on `onEffectiveVisibilityChange`.
  The previous section's caveat stands unchanged: the `theme` phase never
  measures the show, so the relocated work is still unpriced.

- **The surface's theme-to-show ratio flatters the candidate.** Over the lap
  the arm withholds 98 applications and replays seven, because the driver
  switches the theme 14 times while showing seven tabs: most withheld work is
  discarded by the next switch before its editor is ever visited. A user does
  the reverse — one switch, then a walk through the tabs — and when every
  hidden editor is eventually shown the replays equal the withholds and the
  saving is the bookkeeping alone. So the −21% is a property of a two-to-one
  switch-to-show ratio rather than of the candidate, and G25's real value is
  about one minus the revisit rate: largest exactly where it matters least,
  many open editors the user never returns to. The cell that settles it drives
  one switch and then a sweep of shows, and it belongs before a plan rather
  than inside one.

## G25 closed: nothing is saved at a realistic ratio (2026-09-25)

Measured on `master` at `73ab5253` (the ten-branch stack merged), runs `g25s-*`,
with two throwaway edits neither of which was committed: a lap target on
`editor-tabs` driving one theme switch then a walk through all seven hidden
tabs, and the layout-pass catch-up the debug pass proposed, added to
`g25.theme-withhold`. Eight laps over `update:64`, `idle:4`.

- **The debug pass's remedy works in-engine.** Replaying the withheld
  `onThemeChange` from `doLayout` when the editor is owed and effectively
  visible gives **48 checks and no mismatch at all**, against the six
  mismatches the `onEffectiveVisibilityChange` catch-up produced. Half the
  checks (24 of 48) trip `theme.indistinct` at this lap length, so 24 of them
  genuinely discriminated and none failed. `Tab.doLayout` is why the hook
  choice matters: it flips `setDisplayed(true)`, lays the re-shown subtree out
  synchronously through `placeComponent` → `commitBounds`, and only then fades
  the page in from `opacity: 0` (`layout/Tab.ts:2227-2276`). A layout-pass
  catch-up therefore lands before the fade's first painted frame; the
  visibility hook lands one frame into it.

- **And the counters close the candidate anyway.** Over the eight laps the arm
  withholds 56 reconfigures — seven hidden editors per switch — and replays 49
  of them, seven per lap. The 12% shortfall is only the last lap's shows
  falling outside the measured window: in steady state at one switch per seven
  shows, **replays equal withholds and no work is saved at all**. The original
  −25.84 ms and −19% came from the opposite ratio — the `theme` driver switches
  twice for every tab it shows, so 98 withholds met just 7 replays and 93% of
  the withheld work was discarded before its editor was ever visited. G25's
  value is the share of hidden editors the user never returns to, and a user
  who walks their tabs after a theme switch returns to all of them.

- **The clock agrees, weakly, and cannot do better here.** The arm reads 76.78
  and 78.62 against plain's 72.95 and 75.37 — `+3.54` on a 2.42 bracket, which
  by the cell's own rule is a regression, though on two plain reps that bracket
  is thin. It cannot be sharpened on this surface: every unit after a show
  carries the tab fade's opacity animation, which is what opened a 16.86
  bracket on the first cell shape tried (`g25r-*`, a one-unit `theme` phase
  that recorded no timing at all). The counters, not the timing, are what
  decide this.

- **No G25 plan, and no library defect either.** The stale paint exists only
  inside the ablation: every plain run matches 7 of 7, because unmodified code
  applies the theme to hidden editors immediately. The lap target and the
  layout-pass catch-up were discarded with the worktree; both are about
  twenty-five lines and the record above is enough to rebuild them, should a
  later candidate of the same defer-while-hidden shape want the surface.

## G22 decided: the deferral ships as an outline mode (2026-09-25)

The answer to the previous section's question: the table's column-resize drag
gains the same choice the gutters already have. Under `"outline"` it shows a
resize bar and lays the body out once, when the button is released — the
deferral G22 measured, now a mode's stated behaviour rather than a surprise.
Under `"live"` the body tracks the header every frame, and **`"live"` stays the
default**, so nothing changes for an app that sets nothing.

- **The contract already exists, so a plan extends it rather than inventing a
  flag.** `ResizeMode` is `"live" | "outline"` (`core/ResizeDrag.ts:25`), the
  app-wide default is `"live"` through `Body.setResizeMode` (`Body.ts:237`,
  `ResizeDrag.ts:102`), and an owner overrides it with its own
  `setResizeMode(mode | null)` — `Split` (`Split.ts:817`), `Accordion` and the
  window edges are the three owners today, and `gutterOutline` already draws
  the bar. The column drag becomes the fourth. That is the same move the
  previous section noted for `VirtualRowView.deferRowLayoutWhileResizing`:
  extend a shipped pattern rather than run a parallel one beside it.

- **The measured figures become the opt-in path's payoff, not the default's.**
  103.02 → 81.58 ms per frame and work −92.4% are what `"outline"` buys on a
  column drag; `"live"` keeps today's behaviour and today's cost. This also
  settles the verification question the previous section raised: a cell of the
  outline mode gates geometry on the settled state, because there the mid-burst
  units differ from the live arm **by design** rather than by accident.

## Deferred during the ten-plan batch, now indexed (2026-09-25)

Each of these was recorded in an implemented plan's own notes and nowhere else,
so this file — the index a later session actually reads — did not carry them.
Cited to where the detail already lives. `text-metrics`' non-repeatable first
update and `table-rows`' settle-phase flake are above already.

- **A rail follow-up plan, six pre-existing observations**, all in
  `plans/implemented/rail-minimized-dock-slot.md` and none touched by it: a
  window handed back to the dock lands at the right slot but at its own minimum
  size instead of the row's strip height, so it stands taller than its
  neighbours until restored; `Rail.showWindowHandle` creates its handle with
  `setDisplayed(!isCollapsed())` (`Rail.ts:1054`), so attaching a *collapsed*
  rail to a docked window leaves that window with no on-screen representation at
  all until the rail expands; `Rail.unmount` (`:824`) detaches the strip while
  keeping its registrations, stranding minimized windows hidden with no
  `setRail` to hand them back; `setRail` cancels the two rail animations but not
  `_stateAnimHandle`, so a rail attached during a *docked* minimize tween lets
  that tween keep writing dock geometry (programmatic-only — no gesture reaches
  it); `endRailCollapse` never undoes the `transformOrigin` it set and clears
  transform, opacity and transition outright rather than restoring what a
  consumer had; and `onExitAction` cancels no rail animation handle, so closing
  a window mid-collapse leaves one running.

- **A stage 4 opting in the field internals.** `PickerButton` 0.2,
  `ButtonIconGlyph` 0.2, `ButtonLabelText` 0.2 and `PickerInput` 0.1 are the
  `doLayout` counters `unchanged-commit-opt-ins-forms` stopped short of, and
  they are why `DateField` and `TimeField` are the two of its ten opt-ins that
  never reach zero. Its notes call this the measured next increment, with a
  ceiling now known rather than modelled.

- **`validation-error-arming`'s manual check was never run**, as its own notes
  state (`:406`). Run the demo, open the **Binding** tab, click into **Name**
  and type past its limit without moving the mouse: the outline and the error
  tooltip should appear together after the hover delay, re-appear with new text
  as the message changes, and go when the pointer leaves. The offline harness
  models neither real pointer input nor painting, which is why this is a manual
  step and not a test.

## G21 and G23 measured: the prize is a formatter memo (2026-09-26)

Twenty runs in one sitting on `master` at `fd3f5e29`, runs `w4a-*` to `w4d-*`,
the sweep's scored-cell shape, `work=1&seam=1&geom=1`. No code was written:
`table-rows` and `treetable-rows` already carry every target the sweep asked
for, and both ablations were already registered.

- **G23 is a large win, and not for the reason it is named.** On
  `table-rows` n=900, `update=filter` falls from 156.69 to 127.66 ms per unit —
  **−29.04, −18.5%** on a 2.61 bracket — and a header-sort `click` from 151.90
  to 114.93, **−24.3%**. The click cell's plain bracket is a wide 20.31, but
  every arm rep beats every plain rep by at least 22.7 ms, which is a stronger
  statement than the bracket rule makes. Geometry is `=` on both. The arm's own
  counters name the cause: `memo.intlHit` is 4,494 per phase — about **321
  `Intl.DateTimeFormat` constructions per unit** — while `skipped.operators`
  and `skipped.operatorFace` do not appear in the `click` phase at all. So the
  whole click win, and most of the update win, is `cacheDateFormatters`, not the
  filter-cell write economy the group is named for. This is also why G23 read as
  stalled: the sweep scores it on `sink`, where `apply` moves −0.4% on update
  and is identical on click, because what is left of G23 after the button and
  text guards (`8d8adb29`) took its rule and DOM halves is **CPU, which no
  DOM-write counter can see**.

- **The fix is six formatters.** `data/temporalText.ts:25-36` calls
  `toLocaleDateString()`, `toLocaleTimeString(undefined, …)` and
  `toLocaleString(undefined, …)`, building a formatter *and* a fresh options
  object on every call. The locale is `undefined` and no time zone is passed, so
  the entire cache key is the type (`date`, `time`, `datetime`) crossed with
  `showSeconds` — six module-level `Intl.DateTimeFormat` instances, with no
  invalidation question to answer. A plan should be scoped to that and should
  say the operator guards are unattributed rather than bundling them in.

- **G21 moves counters, and mostly not the clock.** Work falls −27.3% on `key`
  (22 → 16 per unit) and −14.3% on `update` (14 → 12), **identically at n=900
  and n=10,000** — as are the sink totals, 1288.86 and 1320.00 in both cells,
  because the table is virtualised and the window is fixed, so row count never
  drove this. `key` is flat in time at both scales (−0.01, −0.07). `passes`
  reads −0.32 at one scale and +0.32 at the other, which is noise. The `update`
  phase is the only time effect, about −2.2 ms or 6%, and it survives at n=900
  only: there the plain reps show no trend (35.15, 36.54, 35.00) and both arm
  reps sit below all three, while at n=10,000 the plain reps decline
  monotonically (41.85, 39.46, 37.23) and `plain-c` lands *below* `arm-2`, so
  that cell measures warm-up drift rather than the arm.

- **And G21's dominant skip is provably cheap.** Its sub-item counters give
  `skipped.requiredEmpty` about 107 per unit on `key`, `update` and `passes`
  alike, with `memo.visibleHit` at 2 to 6. The same 107 skips buy −2.2 ms on
  `update` (35 ms units) and **nothing at all** on `key` (16 ms units) or
  `passes` (2.3 ms units, which have no room to give). So the volume is not
  where the value is, and nothing yet attributes the one real effect to any of
  the group's six patches. `skipped.focusSweep` engages only under `wheel`,
  whose verdict is unobtainable (below).

- **G21's narrowing sub-item is dropped by its own pre-registered rule.** W3.0
  asked for `sink/u(update) − sink/u(passes)` to be at least 10% of
  `sink/u(update)` and at least 1.0 per unit (`w3-0-bounding-sweep.md:1149`).
  Measured: **−31.14, or −2.4%** — a one-record update costs slightly *less*
  sink than a settled pass, so there is no rebind excess to narrow. Identical at
  both scales. F19.5 and F22.2 are closed.

- **G21 does nothing on the tree table.** `treetable-rows` reads work 16 → 16,
  0.0%, with `geom DIFF(focused)` — void. Its `update` phase also produced three
  identical plain readings (bracket 0.00), the coincidence that manufactured a
  false regression earlier in this campaign; the verdict is `void` on geometry
  regardless, so no extra rep was spent on it.

- **A surface defect: `table-rows` cannot answer a `wheel` question.** Every
  `wheel` phase in the sitting voided on `geom unstable(cell,focused)` — in the
  **plain** arm, so it is the panel's own nondeterminism, not the ablation's.
  Any candidate whose value lives in `wheel` on this panel is unmeasurable until
  those two probes settle. This sits beside the known `table-rows` settle-phase
  flake, one run in six starting from a different column layout.

## G21 closed: the counters move, the clock never does (2026-09-26)

Eighteen runs, one sitting, runs `w5a-*` and `w5b-*`, on a throwaway split of
`g21.render-pass` into its three parts — one ablation each, so a cell could
attribute the group's time rather than read the bundle. `wheel` was dropped from
the drive, its verdict being unobtainable on this panel. Neither the split nor
the worktree was kept.

- **The attribution cell says no part carries any time.** On `table-rows` n=900
  with three interleaved plain reps and every arm run in both orders, the
  `update` phase reads a 2.77 bracket against plain's 38.54, 35.77, 36.08 — and
  every arm is inside it: `g21.visible-memo` −0.38, `g21.required-empty` −0.87,
  `g21.focus-sweep` +0.05, and the **bundle itself −0.30**. `key` and `passes`
  are flat for every arm too, the largest reading being −0.05 on a 0.05 bracket.
  So the group's whole measurable effect on this surface is under a millisecond
  on a 36 ms unit, under 2.5%, and the cell cannot resolve it.

- **The earlier −2.2 ms does not reproduce, and it was never real.** Yesterday's
  n=900 cell had all three plain reps land above both arm reps, which read as
  a −2.22 win on a 1.54 bracket. Run again with the arms spread through the
  sitting rather than clustered in it, the same bundle reads −0.30. The counters
  were unchanged between the two cells, so nothing about the arm differed — only
  where in the session its reps fell.

- **And n=10,000 cannot be measured in this shape at all.** The alternating
  drift cell was meant to settle that scale; instead its first plain rep came in
  at **97.69 ms** against the next three at 31.69, 35.00 and 36.54, a cold-start
  outlier that opens a 66.00 bracket. Every phase of that cell also voided on
  `geom DIFF(focused)`, where the same arms at n=900 read `=` — and
  `treetable-rows` showed `DIFF(focused)` earlier too, so the `focused` probe is
  flaky rather than the arm being wrong. A scale that needs a discarded warm-up
  run per rep is a surface problem, not a candidate problem.

- **One part of G21 is never reached on this panel.** `g21.focus-sweep` reads
  `unreached` in all three phases — `_updateFocusStyle`'s pool-wide sweep never
  runs here, so a third of the group has no surface even now that the other two
  have one.

- **So G21 is closed on the same finding as G25 and G27: work counters are not
  time.** Its `getVisibleRecords` memo genuinely removes work — −27.3% on `key`
  (22 → 16 per unit) and −14.3% on `update` (14 → 12), reproducibly, at both
  scales — and removing it buys nothing a user could perceive. Judged on work
  alone the candidate would have been planned; judged on the clock it should
  not be. Set against G23's 18–24% for six formatters, G21 is not worth a plan,
  and F19.5 and F22.2 were already dropped at their own threshold yesterday.
  **Three of the four candidates that finally got a surface closed on
  measurement**, which is what the surfaces were built to do.

## Judged again: render time first, work second, complexity last (2026-09-26)

The user's standing rule, set after the five surfaced candidates were measured:
render performance is the primary priority and reduced work is secondary, but
**a work reduction with a flat clock is still worth shipping unless it costs
considerable code complexity**. The closures above were written against
"counters moved, the clock did not", which is not a sufficient reason on its
own. Every verdict is re-stated here against the three factors — does render
time improve; is the work reduction real; what does it cost in code — and each
entry says which factor decided it.

- **What the counters watch, and why they diverged from the clock.** Of the
  five candidates, the four with the largest counter deltas moved no time at
  all — G16's `getScrollMetrics` −99.3%, G27's `querySelector` −37% to −99.9%,
  G21's work counter −27.3%, G25's 98 withholds — and the one that moved time
  most, G23 at −18.5% and −24.3%, barely moved its counter (`apply` −0.4% on
  update, identical on click). The mechanism is not a coincidence:
  `work=1&seam=1` counts framework bookkeeping — method entries, DOM reads,
  style writes — which G27 priced at three to five microseconds a call on this
  engine. G23's win was `Intl.DateTimeFormat` construction, about 321 a unit, a
  **platform** call no counter in the harness watches. Counters remain the
  right instrument for proving an arm engaged and, with the geometry probes,
  that it stayed correct. They are not a proxy for time, and their magnitude
  should never stand in for one.

- **A sweep worth running: per-call platform-constructor cost.** G23 suggests
  the milliseconds live where the harness is blind. `Intl.NumberFormat`,
  `Intl.Collator`, `RegExp` compilation, `getComputedStyle` and `measureText`
  are the same shape as `Intl.DateTimeFormat` — constructed or invoked per
  cell, per row or per frame, invisible to every counter a panel installs. A
  counting shim over each, run against the existing panels, would say whether
  any other candidate-sized cost is hiding in plain sight. Speculative, but
  cheap to scope and the only lead this campaign has on where its remaining
  time went.

- **G16 ships under the rule.** Its work reduction is real DOM reads removed
  (`getScrollMetrics` 48.00 → 0.32 per unit), the clock is flat, and the cost
  is extending an opt-in whose pattern already ships from stage 1. Factors two
  and three both pass; the flat clock does not retire it.

- **G27 stays closed — on complexity, not on the clock.** Its seam reduction is
  genuine, but the cache as ablated discards itself on 22 to 32% of the ticks
  it serves, because the key includes a `scrollHeight` that grows while a
  lazily rendered document scrolls. A version that worked would need a tuned
  invalidation key and incremental offset extension, with two live paths
  through `trackScroll`. That is considerable complexity for a saving of three
  to five microseconds a heading, so factor three decides it.

- **G21's `applyRequiredEmptyState` guard is reopened.** It skips about 107
  calls a unit of a per-cell loop over every rendered row (`Body.ts:1464`,
  `:2498`) and reads flat in time. Under the old rule that closed it; under
  this one the question is only what the guard costs, and a guard on "not
  required and already empty" is the cheap end of the scale. Worth pricing
  properly rather than dropping.

- **Correction, and it reopens G21's `getVisibleRecords` memo.** Two sentences
  first written here were wrong, both raised by the `table-row-filter-panel`
  planner and verified since. `getRecords()` is `return this._records.slice()`
  (`AbstractStore.ts:653`), so the unfiltered branch of `Body.ts:502-506` does
  **not** hand back the store's own array — it allocates an n-element copy on
  every call. And the “22 calls a unit” was the phase's whole work counter: the
  real split is `getVisibleRecords@TableBody` 6 per unit on `key` and 2 on
  `update`, `getRecords@MemoryStore` the same, and ten scrollbar
  `getMinSize`/`getMaxSize` entries with nothing to do with G21. The arm
  removes every `getRecords` call and leaves `getVisibleRecords` untouched,
  which is the whole of the 22 → 16.

- **So the memo removes real work already, and that changes its verdict.** At
  n=10,000 it drops six n-element slices per unit on `key`, about 60,000
  element copies, and the clock stays flat — which prices a 10,000-element
  `slice` rather than excusing it: six of them cost well under a millisecond
  against a 16 ms unit. Under the standing rule that is a real work reduction
  with a flat clock, and its cost is a `WeakMap` keyed on two array identities,
  the shape `size-hint-per-pass-memo` and `border-region-size-memo` already
  ship. It passes on complexity, so it is worth doing on the work criterion
  alone.

- **And the filtered case is still the larger unmeasured question.** With
  `_rowVisible` set each call adds n predicate invocations on top of the slice
  — at n=10,000 and six calls a unit, about 60,000 predicate calls per unit on
  `key`, every result discarded. **No QA panel sets a body row filter**;
  `table-rows`' own filter mode calls `store.setFilter`, which is store-level.
  `Table.setRowVisible` (`Table.ts:552`) is public API, so the feature is
  reachable by applications and the candidate is real. That cell decides
  whether the memo is a render win as well as a work win.

- **`g21.focus-sweep` has nothing to reopen.** It reads `unreached` in every
  phase; `_updateFocusStyle`'s pool-wide sweep never runs on this panel.
