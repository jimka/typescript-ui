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
  `setSelectedIndex`** — open. `checkbox-action-activation` makes `"action"`
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
