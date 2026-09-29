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
| Phase 1 | `qa-app`, `qa-app-tauri`, `qa-app-panels`, `qa-app-panels-editors-overlays` | `packages/qa` is the measurement surface; merged `aca769ab` |
| Phase 2 | eleven plans against the C-register, plus `test-suite-health` | C6-C36 closed 2026-09-21; three residues survived, two since fixed |
| Wave 3 | thirteen plans, W3.0-bounded before planning | all implemented and measured in-engine 2026-09-23 — 446 runs, none failed |
| The ten-plan batch | the nine plans tabled under *The remaining work, planned*, plus `split-noop-drag-frame-gate` | one measured render win (the formatter memo); four arms could not ship as written |
| The four-plan batch | `split-gutter-zero-thickness-gap`, `split-drag-unclamped-geometry`, `panel-resize-metrics-staleness`, `table-row-layout-pass-contract` | shipped 2026-09-28; see that section below |
| Released | **v0.10.0, 2026-09-29** | every campaign branch merged to `master`; none exists any more |

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
  **Decided 2026-09-29: it gets an `include`** scoping the program to the
  library sources, which should drop `build/`, the Vite configs and the test
  files in one change and clear all 30. Planned as
  `docs-api-warning-clearance`. **Cleared 2026-09-29** by that plan's
  `include`, scoping the program to the library sources exactly as decided —
  by then the count had grown from 30 to 37.
- ~~`npm run docs:api` emits 14 warnings on `master`, so plans must stop
  writing a zero-warning bar into their verification, or the 14 get fixed.~~ —
  ~~**decided 2026-09-29: the 14 get fixed**, so zero becomes the real bar and
  the "no new warnings" language retires with them. No CI gate was wanted.
  Planned as `docs-api-warning-clearance`, together with the `tsconfig` item
  above.~~ — **answered 2026-09-29: all 14 cleared** by
  `docs-api-warning-clearance`. Zero is now the standing bar, recorded in
  `CODE_CONVENTIONS.md`.
- **Three `externalSymbolLinkMappings` entries in `typedoc.json` suppress
  three type-reference warnings**, left in place by `docs-api-warning-clearance`
  because fixing them is a different, wider change. `CellTextResolver`
  (referenced from `buildColumnFilter`'s `display` parameter),
  `ColumnWindowSlidePlan` (`Row.setColumnWindow`'s `plan` parameter) and
  `RetargetedCell` (`Row.getRetargetedCells`'s return type) are each exported
  from their own module inside `component/table` but not re-exported from
  `component/table/index.ts`, so a public signature names a type the docs
  never describe. Deleting the three mappings takes `docs:api` from 0 to 3
  warnings. Exporting `CellTextResolver` from the barrel to fix it would make
  it a concrete public class, which `scripts/llms/check-coverage.mjs` then
  requires be catalogued in or excluded from `manifest.data.mjs` — so this
  needs its own plan, not an in-flight fix.
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

  **Fixed by `plans/implemented/store-worker-blob-url-leak.md`** (`74082206`),
  which did exactly that: `ensureWorker`'s `catch` now calls `retireWorker`, so
  a refused construction is the last one and `isAvailable()` is false for the
  rest of the page — one leaked object URL and two violation reports per page
  instead of one and two per `applyView()`. `store-worker-fail-safe`'s "the next
  call tries to construct it again" is overturned for a throwing constructor
  only; a missing `Worker` global still retires nothing, because rediscovering
  that answer is free. `applyView` also asks the pure `hasCustomSorter()` before
  the side-effecting `isAvailable()`.
- The library's own demo app (`packages/lib/index.html`, entry
  `src/typescript/main.ts`) puts 32 demo panels in one `Tab` layout, so the
  tab bar is squashed. The user wants it restructured; it is its own piece of
  work, separate from the measurement surface. **Decided 2026-09-29: a category
  tree in a `Split`** — a tree or list of grouped demos on the left, the selected
  demo on the right, the SQLAdmin and Loom shape — rather than nested tabs, an
  activity rail, or a scrolling tab strip. Planned as
  `demo-app-category-navigation`.

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

  **Fixed 2026-09-27 by `plans/implemented/validation-error-arming.md`**: one
  viewport `mousemove` is enough, and `_attachWith` starts the hover delay when
  the pointer already rests on the component. Only the by-eye Binding-tab check
  is outstanding — see the consolidated list below.
- **The layout-skip opt-ins have a second stage waiting on the form panels.**
  `unchanged-commit-opt-ins` reaches −3.5% and −7.4% of the work on a form
  layout pass where its plan predicted −84%: that figure came from W3.0's
  ceiling ablation rather than the four classes that shipped. The form panels
  are the obvious surface for the next staged opt-in, and `g09.all` now
  measures headroom over the shipped opt-ins rather than an absolute ceiling.

  **Served, and the ladder is finished.** `unchanged-commit-opt-ins-forms` took
  the form panels (stage 3) and `field-internals-unchanged-commit-opt-in` took
  the field internals (stage 4), whose notes state that no stage 5 is implied:
  a settled picker field's own pass costs exactly one `doLayout` call, so all
  four of stage 3's residual counters reach zero without opting either `Button`
  internal in. What stays open is not a stage but a question — what makes a
  settled picker field lay out at all — and it is answered in-engine, not by
  another plan.

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

**Resolved by `plans/implemented/table-column-resize-outline-mode.md`.** The
answer the user gave is the opt-in, and it dissolves the question rather than
answering it: `Table` becomes the fourth owner of `core/ResizeDrag.ts`'s
`ResizeMode` seam, and under `"outline"` the *header* is held back too, so header
and body never disagree — what the user saw in the ablated runs was a header that
moved over a body that did not, and here neither moves until the release. Nothing
is deferred, because no layout pass runs during the drag at all; a 4 px bar on the
dragged edge, spanning the header band and the body together, is what tracks the
pointer. `"live"` stays the default, unchanged down to the frame a layout lands
on.

Two corrections to the above. `VirtualRowView.deferRowLayoutWhileResizing` is
*not* the pattern to extend: its trigger is a width change observed inside a
render pass, with a two-frame settle relay to catch the rows up, and an outline
drag produces no pass for it to withhold while knowing exactly when the drag
ended — extending it would keep a settle relay armed for a burst with nothing in
it. And the settled-state gate this entry asks for is still needed here, though
not because the focus question was ever real: the mid-burst units differ from the
live arm by design under `"outline"` too, so the measurement cell recorded in the
plan gates geometry on the last unit of its trailing `idle` phase rather than
across the burst. No
measurement was run — every harness that could take one opens a full-screen
window — and the `103.02 → 81.58 ms` figure above is not a prediction for this
mode: it was driven by `drive=resize`, the window-resize stand-in, not a
column-edge drag.

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

  **Resolved by `plans/implemented/glyph-sprite-reset-hook.md`.** The module now
  remembers the `DOMSink` its handles were minted against and drops the sprite
  when a different one is installed, so the reset signal called for above turned
  out not to be needed: no registration, and nothing new on `core/DOM.ts`.
  `activation-after-dispose`'s `beforeAll` priming step is gone, and
  `13-button-glyph-image.md` carries a dated correction where the false sentence
  was. One correction to the above: the hole was wider than the two variables
  named here — the mounted-symbol record at `Glyphs.ts:65` shipped with the same
  lifetime bug, and clearing it is what a rebuilt sprite actually depends on.

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

  **Resolved by `plans/implemented/test-dom-handle-eviction.md`.** Two
  corrections to the above: the workaround inventory was nine files, not
  two, and two behaviours — `Component.ts:305`'s same-flush disposal guard
  and `Image`'s decode-settlement recheck — had no offline coverage at all,
  rather than merely a workaround.

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

  **Closed 2026-09-28 by `plans/implemented/table-row-layout-pass-contract.md`.**
  The analysis below stands as the record of why it took three attempts; the
  fix is described at the end of this entry.
  `field-internals-unchanged-commit-opt-in` set out to fix this and **reverted the
  fix**, because restoring the base call is not geometry-neutral. Two corrections
  to the entry above, both established offline on a rendered 40-record table:

  - The defect is worse than a blocked optimisation. The missing base call also
    holds every `onFirstLayout` callback registered on a row for ever, which is a
    live consumer-visible defect — the same half `unchanged-commit-opt-ins-forms`
    found in `Slider.doLayout`.
  - But `return super.doLayout()` **corrupts cell geometry**. A `Row` runs the
    default `Absolute` manager, and `Absolute.doLayout` (`layout/Absolute.ts:52`)
    places each child at `preferredSize ?? size` — it does not re-commit the
    rectangle the child already holds. For a cell whose `getPreferredSize()` is
    `null` that fallback is a no-op, which is why string and number columns show
    nothing; a `BooleanCell` reports `{20,16}`, so the base pass shrinks it from
    the 33×20 the body's render window gave it to 20×16. Stage 1's `Cell` opt-in
    cannot withhold that, because the commit genuinely changes the rectangle.
    It is reachable rather than theoretical: a row is parentless, so any
    `scheduleLayout()` on one — which `Row.addComponent` does on a column-window
    change or pool growth — gets a top-level pass from the batched flush, and the
    narrow cell then renders until the body next re-places the window.

  The library design decision this entry asked for was taken by
  `table-row-layout-pass-contract`: `Absolute` gained a
  `sizing: "preferred" | "committed"` option, and `Row` is built with
  `sizing: "committed"` and loses its `doLayout` override entirely. The base
  pass therefore runs — recording the pass, draining `onFirstLayout`, and
  laying out any cell that owes a pass — while committing each child at the
  rectangle it already holds rather than at its preferred size. `Cell` keeps
  its preferred size and no other class changes its manager. That plan also
  found a second instance the analysis above missed, in the opposite
  direction: a narrow header `FilterCell` *grows* from 25x22 to 236x22 under
  the preferred-size commit, so both directions are now pinned as rectangles.

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

  **Resolved by `plans/implemented/field-internals-unchanged-commit-opt-in.md`**,
  with one correction to the causality above. The four counters are not why
  `DateField` and `TimeField` never reach zero; they are live *because* the field
  lays out, since every one of those calls is inside `AbstractPickerField.doLayout`.
  Eleven inner classes now opt in and the two hand-placement sites commit through
  `applyBounds` instead of forcing the child's pass, which takes a settled picker
  field's own pass from ten `doLayout` calls to one — `ButtonIconGlyph` and
  `ButtonLabelText` included, because the button above them is withheld whole. So
  the field's own counter is the only one left, and what makes a settled field lay
  out at all stays unidentified. See the entry below for what that leaves open.

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

  **Resolved by `plans/implemented/table-cell-date-formatter-memo.md`.** Six
  module-level formatters in `data/temporalText.ts`, keyed on the type crossed
  with `showSeconds`, with the operator guards named unattributed and left
  undecided. Two corrections to the above: the key is complete but the memo is
  not total — `Intl.DateTimeFormat.prototype.format` throws a `RangeError` on a
  non-finite time value where each `toLocale*String` returns text, so an invalid
  `Date` still takes the engine's own calls in a private function holding the
  old `switch` verbatim. And the "no invalidation question to answer" holds only
  because no locale is ever passed; that premise is now a test assertion rather
  than an argument, since the plan's own call-site grep cannot see what the
  constructor is handed.

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

  **Resolved by `plans/implemented/panel-scroll-read-economy.md`**, both halves.
  One correction to the framing above: the cost is *not* extending the opt-in.
  The settled pass earns its skip from the layout system's own dirty-flag and
  text-metrics state — factored out of `Component.canSkipUnchangedCommit` as a
  protected `isLayoutSettled` — rather than from the per-class gate, so it
  reaches every `Panel` subclass with no audit and no override, which is where
  the measured cost actually is (the wave-2 note above: "G16's remaining cost
  therefore exists only for panels that are not opted in"). `canSkipUnchangedLayout`
  still answers exactly what it answered before. The scroll half merges the two
  subtree `scroll` listeners into one that reads once and hands the result to
  both consumers, and moves `resizeScrollShadowOverlay` off the scroll path to
  install time; the wheel half derives both maxima from one read and lends the
  pair to the clamp `SmoothScroller.scrollBy` performs inside the same call. Both
  ship as work reductions with no render-time claim, per the standing rule.

  One thing is left open, and it is this file's own question rather than the
  plan's: both arms' `packages/qa` self-tests and the `scroll-panes`
  `pane.remeasure@ScrollPane` witness assert the counts the library no longer
  produces, so five of that package's 453 tests go red on the branch (453/453
  against its start point). The plan's *Non-Goals* forbid touching `packages/qa`,
  so they are left standing for a decision here: retire both arms with their
  witnesses, or keep them as inverted regression detectors, where an arm that
  engages again would mean the library had stopped withholding. Four of the five
  are an absent counter; the fifth, `g16.scroll-reads`' own self-test, instead
  throws, because it invokes `Panel.syncOverlayScrollbars` through untyped
  reflection with no argument and that method now takes the already-read metrics.
  That one needs its call site updated whichever way the decision goes.

  **Decided, and done on `feature/qa-scroll-ablation-record`: they are inverted
  regression detectors.** Both arms stay registered and both keep their
  self-tests, but the five cases now assert the library's new behaviour, so a
  counter appearing where the library should have withheld is a failure rather
  than a reading. A11's three cases and P16's witness count
  `Panel.remeasureScrollMetrics` calls rather than the arm's skips, and each
  pairs the absence on a settled pass with the *same key's* non-zero count on a
  pass whose size moved or whose layout is owed — so none of them is satisfiable
  by a counter that was never wired, which is the failure mode the seven vacuous
  verifications above share. A12's throwing case hands the metrics in and asserts
  that the bar sync now measures nothing of its own, with `updateScrollShadows` —
  which still reads when handed none — as that key's non-zero baseline. Every one
  of the five was proved red by reverting in the working tree the library hunk it
  guards, and green again with it restored. Two stale `scroll-panes` comments went
  with it: `resizeScrollShadowOverlay` is no longer on the scroll path at all, so
  the arm's shadow-resize sub-patch is now reachable only from an overlay install
  or refresh, which no phase drives. `packages/qa` is back to 453/453.

  A second correction, to this file's *counters are not time* bullet by way of
  example: the plan's own prescribed offline verifications were mutation-tested
  during implementation and **seven of them could not have caught a regression**
  — chiefly a set of read-count comparisons calibrated against a figure that a
  total regression collapses to zero, satisfying every one of them. The plan file
  records each. A prescribed counter assertion is not self-validating either.

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

  **Resolved by `plans/implemented/table-body-visible-records-memo.md`.** The
  guard is one boolean recomputed at each of `Body`'s two `_columnConfigs`
  writes, and it costs slightly more than this entry priced: the recompute also
  has to clear every pooled cell's required-empty state whenever the new flag is
  false, because `syncPoolCells` does not rebuild a cell that keeps its column,
  so a configuration change dropping the last required column would otherwise
  strand an outline the skipped loop could never clear. Two corrections to the
  above: the guard is not "not required and already empty" — emptiness is a
  property of the record and cannot be hoisted out of the loop, so only the
  configuration half is — and the skip cannot be asserted through the config
  map's own `get`, since `isRecordFieldReadOnly` calls it once per cell as well.
  `Cell.setRequiredEmpty` is the witness for the loop running, counted across a
  plain re-render rather than a config write — the clearing sweep is its second
  caller.

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

## Corrections: two candidates were already measured (2026-09-26)

- **`g16.scroll-reads` is not unmeasured, and the note above saying so is
  wrong.** It engaged and won on three of W3.0's wheel cells: `cdw` work 4.00 →
  2.00 per unit, −50%, with Δ −4.80 ms inside an 11.95 bracket; `ssw` the same
  −50% with −3.41 inside 10.75; and `shell-deep`'s editor wheel −3.29 ms with
  reads −50% (`96-w3-0-bounding-sweep.md:51`, `:316`, `:318`). Every one of
  those ms deltas is *flat* — the verdicts are work wins — so it belongs in the
  same class as G16's settled pass rather than being a time win. It scored
  `unreached` on `scroll-panes` only because every method it patches is
  reachable from a scroll event alone, so no `passes` phase can engage it.
  Under the standing rule it is plannable now: a real halving of the
  scroll-path reads with a flat clock, pending only its complexity.

- **F06.3 is measured too, and a `park` target has existed all along.**
  `builders/shell.ts:316` already parks a `Split` gutter against the sidebar's
  clamp, with a `leadPx` that overshoots deliberately, and W3.0 drove it: `sdp`
  gives `split.noop-drag` work 4712.31 → 293.00 per unit, **−93.8%**, geometry
  `=`, against Δ **+3.28 ms** (`96-w3-0-bounding-sweep.md:181`). The wave-2
  line above saying it was never measured for want of a clamp is stale, and it
  is what sent this agenda looking for a surface that was already there.

- **That +3.28 is very likely the instrument, not the candidate.** The same
  cell's co-run `split.recalc-gate` arm reads **+3.52 ms while avoiding no work
  at all** (4712.31 → 4688.47, −0.5%, flat) (`:187`), and the sweep already
  observed that “both arms of `sdp` are about 3.4 ms slower than its plain
  arms” (`:191`). A park cell therefore charges roughly 3.4 ms to any runtime
  patch, which puts F06.3's real clock effect at about zero and its work
  verdict at −93.8%. Subtracting that tax needs a control arm patched from the
  same code but removing nothing, which is what
  `plans/unreached-ablation-surfaces.md` adds; no new panel or target is owed.

- **So the campaign's remaining measurement scope is one surface, not three.**
  Only G21's `getVisibleRecords` memo under a body row filter needs a surface
  that does not exist, and `plans/table-row-filter-panel.md` covers it. The
  platform sweep is discovery rather than a gap, F06.3 needs a control arm, and
  a `scroll-panes` ladder for `g16.scroll-reads` would be a second surface for
  a candidate already measured on three cells — useful, not owed.

## The remaining work, planned (2026-09-26)

The measurement surface is complete and merged (`aca769ab`): `table-rows` has a
body row filter and a `g21.visible-memo` arm, `scroll-panes` has a `call` ladder
  and two witnesses so `g16.scroll-reads` can engage, `split.noop-control`
  shares a `splitDragGate` with `split.noop-drag` so the park cell's instrument
  tax can be
subtracted, and the `plat=1` family ships with eight two-rung dose arms,
`bin/qa-price.py` and an 84-run matrix. Everything else the campaign still owed
is now drafted as eight plans, listed here so the index carries them.

| Plan | What it lands |
|---|---|
| `table-cell-date-formatter-memo` | six module-level formatters; the only measured render win |
| `table-column-resize-outline-mode` | the table as the fourth `ResizeMode` owner, live path untouched |
| `table-body-visible-records-memo` | a view-generation key, plus the `_anyColumnRequired` flag |
| `panel-scroll-read-economy` | both G16 halves; 3→1 and 4→1 reads per event |
| `field-internals-unchanged-commit-opt-in` | eleven classes, two forced child passes converted |
| `test-dom-handle-eviction` | the modelled DOM honours the production contract |
| `glyph-sprite-reset-hook` | a sink-identity reset for the sprite handles |
| `rail-handover-follow-ups` | three of six rail observations, plus a seventh |
| `split-noop-drag-frame-gate` | F06.3's gate, on the opt-in predicate (added later) |

- **A second systematic caveat on every figure in this file: an ablation bounds
  a mechanism adjacent to the one that ships.** Four of the nine plans found the
  arm that produced their measurement could not ship as written. G21's memo
  caches the **post-filter** result, which the library cannot, because an
  in-cell edit changes a record's contents without rebuilding the view and both
  `Table.setRowVisible`'s contract and `renderWindowPass`'s post-commit re-read
  depend on the filter re-running. G21's empty-state guard needs a one-time
  outline-clearing sweep the ablation lacks. G16's settled pass used an unsound
  content-extent signature, where the plan instead earns the skip from the
  layout system's own dirty/metrics state — which reaches every subclassed pane
  with no per-class audit, a better outcome than the arm's. None of that is a
  failure of the ablations: W3.0 built them to bound, and they bounded. It
  means a recorded delta is an upper bound on something **next to** the fix, so
  each plan carries its own verification cell rather than inheriting the arm's
  number. This sits beside the counters-are-not-time finding above.

- **The shippable G21 figure comes from a library A/B, not another arm.** The
  `g21.visible-memo` arm now on `master` removes the filter work too, so under
  `rowfilter=title` it reads as an upper bound. The figure to trust comes from
  building the branch's `packages/lib` and comparing it against the fork-point
  build, the way `unchanged-commit-opt-ins-forms` was measured. No third arm is
  wanted; an ablation that duplicates a plan would only drift from it.

- **`Favicon` carries the same defect as `Glyphs` and no plan covers it.** The
  `glyph-sprite-reset-hook` plan names `Favicon` as the only other module with
  an unreset cache keyed to a torn-down document — which is its reason for not
  building a general registry — but its scope stops at `Glyphs`. So the same
  class of bug ships on in `Favicon` unless someone takes it.

  **Still open, and the defect is sharper than this entry says.** It is not that
  nothing resets `Favicon`: `Favicon._reset()` exists (`core/Favicon.ts:123`),
  it predates the campaign (`321d9532`), and it is `@internal Test-only`. The
  defect is that it is *manual* — four suites must remember to call it
  (`tests/core/Body.test.ts:26`, `BodyContextMenu.test.ts:57`,
  `ResizeDrag.test.ts:107`, `Favicon.test.ts:71`), two of them carrying comments
  apologising for a call that is not part of the feature under test — where
  `Glyphs` resets *automatically* on sink identity. **Decided 2026-09-29: build
  the registry `glyph-sprite-reset-hook` declined** and move both modules onto
  it, so a later sink-keyed cache joins by construction. Planned as
  `document-cache-reset-registry`.

- **Stage 4 may not close stage 3's residual.** That residual named four
  classes: `PickerButton` 0.2, `PickerInput` 0.1, `ButtonIconGlyph` 0.2 and
  `ButtonLabelText` 0.2. `field-internals-unchanged-commit-opt-in` opts in
  eleven classes including the two picker ones, but the two Button internals
  are out of its scope, being button rather than field internals. Since the
  residual attributed `DateField` and `TimeField` never reaching zero to all
  four, that plan's verification has to say whether they reach zero or whether
  a stage 5 for the button internals is implied.

  **Answered, half of it, by that plan's `## Implementation Notes`: no stage 5 is
  implied, and `@DateField` / `@TimeField` are not made to reach zero.** Measured
  offline and now pinned by `tests/core/UnchangedCommitFieldInternals.test.ts`, a
  settled picker field's own pass costs exactly one `doLayout` call — the field's
  — so all four residual counters go to zero on that drive, the two `Button`
  internals among them, without opting either in: the picker button is withheld
  whole, and nothing reaches its content row. The field's own call was never in
  scope and is untouched. Whether it still runs on a settled `ffq` unit depends on
  what makes a settled picker field lay out in-engine, which that plan records as
  unidentified and which its offline model does not reproduce — so the `ffq` and
  `fnq` reading of those two counters is still owed, from the user's in-engine A/B
  rather than from another plan.

- **Two production bugs were found by making the test instrument honest**, both
  inside `test-dom-handle-eviction`'s scope and fixed there: `Dialog.hide`
  animates a backdrop its own synchronous reduced-motion completion has already
  destroyed, and `Component.release()` leaves both element buffers bound to the
  handle it just released. The blast radius that had deterred this work turned
  out to be five failing cases in four files out of 8,572 — far smaller than
  feared — while the workaround inventory it retires is nine files rather than
  the two recorded above, including two behaviours with no offline coverage at
  all. One claim above is wrong as a result: eviction retires *one* workaround,
  not both. `validation-error-arming`'s `isRegistered` spies stay, because the
  migrated cases survive the mutation that deletes the guard they pin — a
  disposed anchor also stops being a hit-test result, so the outcome is reached
  by a second route.

- **The rail's item 6 is a hard lock, not a loose end.** `onExitAction`
  cancelling no rail animation handle was recorded above as minor. It leaves a
  window **hidden while its state reads `"normal"`**, unrecoverable by the
  user, and emits a spurious `"minimize"` after `"close"`. It is reachable by
  ordinary gesture, and it is the strongest reason to land that branch.

## The sitting: one verdict, two blocked cells, one new price (2026-09-26)

Run on `master` at `bf654e64` with the merged measurement surface — 25 runs for
the three candidate cells (`w6a-*`, `w6b-*`), then the platform sweep's 24-run
census and the 31 dose runs the census nominated (`plats1-p00/p01/p02/p05`).
Batches p03 and p04, 28 runs pricing `getComputedStyle` and `measureText`, were
never run: the census closed both on count, which is the gate working as
designed.

- **G21's memo under a real body row filter is a work win and nothing more.**
  At n=900 with `rowfilter=title`: `key` work 22 → 16 per unit, **−27.3%**,
  against Δ −0.11 ms on a 0.38 bracket — flat, geometry `=`. That is the same
  verdict the unfiltered cell gave, so the filter does not turn the memo into a
  time win at this scale, exactly as the arithmetic predicted: six calls over
  900 predicates is too little to see. Plannable on work and complexity, as it
  already was.

- **And n=10,000, the scale where the filter's cost would show, is void again —
  though not for the reason first written here.** Both phases failed on `geom
  DIFF(focused)`, and the rects say why: the focused cell's width is **78 in
  four runs of the cell and 42 in the fifth**, constant within each run, while
  all five runs at n=900 agreed on 42. So it is neither a flaky probe nor the
  arm changing behaviour — it is the **column layout coming up differently in
  one run out of five**, which is the `table-rows` settle-phase flake already
  recorded above, one run in six starting from a different column layout. It
  bites at n=10,000 because that is the scale where `AbstractStore` hands the
  view rebuild to a worker, so the initial column sizing races the view's
  arrival. The mechanism is exact: `Table` takes a `number` column's width from
  `col.getMaxContentLength() ?? sampledDigits(col) ?? DEFAULT_NUMBER_DIGITS`
  (`Table.ts:2700`) and samples the store whatever `autoSizeColumns` says, so
  `id` is 78 px — eight digits — when the first layout wins the race and 42 px —
  the four-digit floor — when the worker's view does. `qa-cell-determinism`
  declares an 8-digit budget on the panel's three `number` columns, which takes
  the store out of the derivation and pins the majority layout, and
  `describe()`'s new `idColumnWidth` says which layout a run measured. Both
  symptoms close at once, since the flake and this void are one defect, and with
  that G21's filtered case is measurable.

- **The library's own re-sample is gated on `autoSizeColumns` while its digit
  sample is not, which is a production question no plan owns.**
  `maybeResampleColumnWidths` returns at once unless the flag is set
  (`Table.ts:2811`), but `samplesRecordText` answers `true` for a `number`
  column whatever the flag says (`Table.ts:2637`), so any consumer over a
  worker-backed store gets a `number` column whose width depends on whether the
  view arrived before the first layout — and no event ever corrects it. Found
  while planning `qa-cell-determinism`, which pins the QA panel's own widths and
  deliberately leaves the library alone: moving that gate would move the
  geometry baseline of every table cell measured so far. Needs its own plan and
  its own measurement.

- **The `scroll-panes` ladder does not reach the scroll-shadow path, so part
  one of `unreached-ablation-surfaces` did not achieve its goal.**
  `g16.scroll-reads` reads `unreached` on all three phases, and the `call`
  phase fired **no witness at all** — neither `pane.scrollTick` nor
  `Panel.updateScrollShadows`, though the run's notes confirm both counters
  were installed. A programmatic `setScrollTop` does not drive the path; only a
  real scroll event does. G16's scroll half therefore still rests on W3.0's
  three wheel cells (work −50%, clock flat), which is enough to plan it under
  the standing rule, and the ladder should be treated as spent effort rather
  than a surface to build on.

- **The park cell lost three runs to the mouse on the desk, so F06.3 is still
  unsettled — though not for the reason first written here.** The 160 px lead is
  right for this panel: seven of the nine `sdp` runs parked the sidebar at
  `165,42,10,1998` and held that one rectangle for all 150 units, every one of
  them at a 5120 × 2075 viewport. What spoiled the other three was a trusted
  `mousemove` at the physical cursor reaching the driver's live drag.
  `w6b-warm-sdp-0` and the first `w6b-sdp-split.noop-drag-2` both returned an
  error result, with lead rectangles out at x 4404 and x 3802; the re-run that
  replaced the second passed the driver's end-of-phase check yet carries six
  distinct `sidebar` rectangles, its width sweeping 4520 → 4675 px across units
  26–30 before unit 31 re-parks it, at a `maxMs` of 88 against plain means of
  8.56–8.91. `Split.onDrag` resolves the left pane as `originLhs + (position −
  originPointer)`, so with this panel's origin those widths name a pointer at
  about x 3,807, x 4,409 and x 4,530–4,685 — and no driver sends one there, the
  lead-in running from x 290 down to 130. So that rep's 13.13 ms is real drag
  frames, not an instrument tax, and the +1.35 read from it is not a reading.
  The repair is two things, both landed by `qa-cell-determinism`: a page-level
  input guard that drops every trusted device event for the length of a run, and
  a `park` driver that proves the element has parked *before* the measured units
  rather than only after them.

- **The sweep priced the date formatters, and they are worth much more than G23
  measured.** Two rungs agreeing to 6.4% on the click cell and 14.0% on the
  filter cell put a `toLocale*String` call at **74 to 193 microseconds** — the
  90 µs prior was the right order. The ceiling is **62.09 ms per unit, 39.0% of
  a header-sort unit**, and 23.76 ms, 14.7%, on the filter update. Both read
  `plan it`. G23's measured −36.97 ms on click is therefore about three fifths
  of what is there, the remainder being the `format()` call a memo still pays.
  The census also found the same cost on a **third** surface the plan does not
  mention, `treetable-rows` · `toggle` at 108 calls a unit.

- **And `string.localeCompare` is not a candidate, which is the sweep's real
  vindication.** The census counted **2,807.67 calls per unit** on a 900-row
  header sort — nearly nine times G23's call volume — which at the 5 µs prior
  nominated it at 14.04 ms a unit. Priced, it collapses: the ×4 rung adds
  11,230 calls for **+0.66 ms**, inside the bracket, implying about 0.06 µs a
  call, while the ×1 rung's +5.67 ms sits outside it. The two disagree, so the
  ladder cannot price it and the verdict is a 5.67 ms ceiling, 3.6%, `needs a
  removal arm` — and there is no reason to build one. The engine evidently
  reuses its collator, so the calls are near-free repeats. A count-only sweep
  would have made this the campaign's headline finding. On the tree table's key
  cell `localeCompare` is not called at all, so that cell reads `drop it`.

- **The instrument costs 1.4%.** The `plat=1` counters add **+2.22 ms per
  unit** on the busiest cell (161.17/162.58/160.98 with, against
  159.50/159.95/158.61 without), and since every arm of a dose cell carries
  them, the cost cancels within a cell. `getComputedStyle` peaks at 74.24 calls
  a unit for 0.37 ms, 0.7%, and `canvas.measureText` at 27.00 for 0.14 ms, so
  both are closed on count without a run spent on them.

## The two repaired cells answer, and both change a verdict (2026-09-26)

Fourteen runs on `master` at `423b3a7c`, prefixes `w7a-*` and `w7b-*`, the same
cell shapes as the sitting above. Both instrument repairs are confirmed on real
data rather than only in unit tests: the input guard reports 22 device-input
types dropped on every run, and names live interference it absorbed during two
**scored** runs — `pointermove×9`/`mousemove×9`/`pointerover×5` and the rest on
`w7a-trv-plain-a`, four events on `w7b-sdp-plain-c`, and 29 pointermoves on the
discarded warm-up. That is the corruption which produced the phantom park
reading above, now caught and recorded. The focused cell's width reads **78 in
all five reps** of the table cell, against four at 78 and one at 42 before the
digit budget.

- **G21's memo is a render-time win after all, in the case that had never been
  measurable.** At n=10,000 with `rowfilter=title`, `key` gives plain 17.91,
  18.03, 17.80 for a 0.23 bracket against the arm's 17.16 — **−0.75 ms, −4.2%,
  more than three times the bracket** — with work 22 → 16, −27.3%, and geometry
  `=`. The settled `passes` phase reads −0.40 ms on a 0.35 bracket, **−21.5%**.
  Every earlier reading of this candidate was a work win with a flat clock, at
  n=900 filtered and at both scales unfiltered; the one configuration that
  could show the filter's O(n) cost was the one the column race kept voiding.
  So `table-body-visible-records-memo` is no longer a work-only argument, and
  its plan understates itself — though note the shippable memo keeps the filter
  re-running, so the figure it can bank is the slice half of this, not the
  whole.

  **Resolved by `plans/implemented/table-body-visible-records-memo.md`.** The
  key shipped is not the `WeakMap` on two array identities the entry above
  predicted: `_records` is private, so the library cannot reach the identity the
  ablation keyed on without exposing a mutable array the store owns. It is an
  `@internal` `AbstractStore.getViewGeneration()` counter instead, bumped from
  one new private `setRecordView` that both `_records` assignments now route
  through, with `Body` stashing the number beside its copy and resetting the
  stash on a store swap. One correction to the above, and it sharpens the
  caveat: the banked figure is not merely "the slice half" of −4.2%/−21.5% but
  an unquantified fraction of it, because the −4.2% cell's arm removed n
  predicate invocations per call as well as the slice, and at n=10,000 with a
  row filter those dominate what the slice costs. The plan does not claim the
  figure, and nothing in this branch re-measures it.

- **And F06.3's recorded regression was the instrument, as suspected — now with
  a control arm to prove it.** Against a plain mean of 8.84 (7.26, 8.97, 10.30;
  bracket 3.04), `split.noop-drag` reads **+2.90 ms, inside the bracket**,
  while removing **85.5%** of the work (2018.46 → 293.00 per unit). The control
  arm, patched from the same `splitDragGate` code but removing nothing, reads
  **+4.27 ms** — *more* than the arm that removes the work. Net of the tax the
  candidate is about −1.4 ms, so W3.0's `+3.28` regress verdict is retired:
  F06.3 is a large work win whose clock cost is the cell's own bookkeeping. Two
  caveats on the magnitude: the plain bracket is a wide 3.04, and subtracting
  one arm's delta from another's compounds both arms' noise. The direction is
  solid; the −1.4 is not a figure to quote.

- **So F06.3 becomes plannable, and nothing plans it.** It is the only
  candidate in the campaign with a measured verdict and no plan — a −85.5% work
  reduction on `Split.onDrag`'s no-op drag frames, clock not a regression,
  which under the standing rule turns on what the gate costs in code. The other
  four measured candidates all have plans.

## F06.3 planned, and its ablation was unsound too (2026-09-26)

`plans/split-noop-drag-frame-gate.md` closes the last measured candidate without
a plan. It ships on the work criterion with the clock recorded as flat: three
sampled reads, two comparisons, and one private `Split.layoutDraggedPane` helper
that asks `Component.canSkipUnchangedCommit()` before withholding a pane's pass
— the same predicate `Split.commitPanes` → `LayoutManager.commitBounds` already
applies to those panes. Verified by a `wt`/`main` library A/B on
`panel=shell-deep&drive=park`, compared against the control arm rather than
plain, since a runtime patch costs about 4 ms there.

- **The ablated gate would have shipped a visible artefact.** `split.noop-drag`
  skips an unmoved pane's layout **unconditionally**. But `commitBounds`'
  size-stable-move fast path calls `markPassOwedAbove`, so a pane can be left
  owing a fold-back pass — and skipping unconditionally means that pass never
  runs, stranding a descendant's `will-change: transform` promotion and a live
  translate **for the whole duration of the park**. Gating the skip on the
  opt-in predicate fixes it, and it makes the measured −85.5% an upper bound
  that holds only where the panes' class has opted in. It does on the measured
  cell, whose two panes are plain `Panel`s, so the figure stands there and
  should not be generalised to a subclassed pane.

- **That is four of nine, and the pattern is now the campaign's most reliable
  finding about itself.** A memo caching a post-filter result the library must
  recompute; a guard missing a one-time sweep; an unsound content-extent
  signature; and now an ungated skip that strands a compositor promotion. In
  every case the plan's mechanism differs from the arm that measured it, and in
  every case the difference was found by reading the library rather than by any
  cell. An ablation bounds the opportunity; it does not prototype the fix, and a
  plan that inherits its mechanism inherits a defect.

## F06.3 implemented, and its read-back rule was only half right (2026-09-27)

**Closed by `plans/implemented/split-noop-drag-frame-gate.md`.** `Split.onDrag`
now samples the leading pane's main-axis extent and the trailing pane's position
and extent before its four setter writes, compares all three back after them, and
routes both layout calls through a private `layoutDraggedPane(pane, moved)` that
lays the pane out when this frame moved its committed box or when
`Component.canSkipUnchangedCommit()` refuses to let the pass be withheld. The
collapsed-neighbour early return moved into the helper unchanged. Fourteen offline
cases in `Split.dragFrameGate.test.ts` pin it, and all fourteen mutations of the
gate that were tried kill at least one of them — including the four that collapse
its orientation ternaries onto the x axis, which nothing in the plan's own D1-D8
would have caught, since every prescribed case is horizontal.

- **The stranded promotion is now a test, not an argument.** The entry above
  reasons about a descendant left with `will-change: transform` and a live
  translate for the length of a park. That is executable offline: an opted-in
  pane whose manager commits one child against its trailing edge takes
  `commitBounds`' size-stable-move fast path on the first moving frame, and case
  D6b then asserts on the *next, parked* frame that the translate is back to 0,
  that `getWillChange()` is `null`, and that the child's committed box carries
  the real position — and that the frame after that skips. Mutating the gate away
  turns it red. So the plan's central soundness claim is pinned by consequence
  rather than by a call count, which is what the campaign's vacuous-verification
  record asked for.

- **The read-back earns its place twice over, and `resolveLhsSize` can return a
  size past a pane's own maximum.** Both halves of the three-sample comparison are
  load-bearing, for two independent reasons the plan does not name. For the
  *trailing* pane it is the drag's **captured pair total**: `total` is sampled once
  at the press, so a container resize under a live drag leaves it larger than the
  two panes now hold and the trailing pane's requested size stops following from
  the leading pane's travel — cases D2b and D2c drive that and are the only two
  that distinguish its extent term from its position term. For the *leading* pane
  it is an **inverted clamp bracket**: `resolveLhsSize` clamps as
  `Math.max(loLhs, Math.min(hiLhs, …))` (`layout/Split.ts:1561`), so once `loLhs`
  (`total − maxRhs`) passes `hiLhs` (`min(maxLhs, total − minRhs)`) the low bound
  wins and the returned size sits *above* `maxLhs`. Dropping the trailing pane's
  ceiling mid-drag does it: the leading pane is handed 296, its own `setWidth`
  clamps back to 250, and `dragAmount` reads 46 for a pane that moved nowhere.
  Case D2d drives that. So `[^read-back]`'s rationale holds and only its example
  is wrong — the trigger is the inverted bracket, not a grown `minSize`.

- **Two things this file asserted on 2026-09-27 and had to take back.** The first
  version of this entry claimed the leading pane's read-back was provably
  equivalent to `dragAmount !== 0`; an audit disproved it with the scene above.
  It also claimed `pairBounds` reads the panes' live merged sizes and that those
  are what `Component.clampWidth` applies. Neither is true: `pairBounds` goes
  through `paneMinSize` / `paneMaxSize`, which substitute the collapse snapshot
  for an undisplayed pane (`layout/Split.ts:753-772`), and a `Container` or
  `Panel` clamps only to its *explicit* constraints, not the merged ones
  (`core/Component.ts:4734-4750`). The pair therefore has two independent reasons
  to disagree with the pane's own clamp. Recorded because the campaign's habit of
  arguing a mechanism from a partial read is exactly what the four-of-nine finding
  above is about, and this entry did it once more.

- **Two pre-existing `Split.onDrag` defects surfaced while proving that, both from
  the same once-captured drag state.** On the inverted-bracket frame `onDrag` moves
  the gutter and the trailing pane by the **unclamped** `dragAmount` while the
  leading pane's clamp holds it back, leaving the gutter detached from the pane
  edge it divides (gutter x 293 against a leading pane ending at 250). And because
  the trailing pane's size is `total − newLhs` against a `total` sampled at the
  press, a container resize under a live drag makes the next frame commit that pane
  **wider than its host** (296 px inside a 300 px host whose leading pane holds
  100). Both predate this branch and this gate neither causes nor fixes either, so
  D2b, D2c and D2d assert only the leading pane's box and the pass counts, rather
  than locking the wrong geometry in. **Both fixed by
  [`plans/implemented/split-drag-unclamped-geometry.md`](../../implemented/split-drag-unclamped-geometry.md)**:
  the gutter and the trailing pane are now placed from the extent the leading pane
  committed, re-read after the write, and the pair's combined extent is read live
  each frame instead of at the press.

- **Still owed: the engine cell.** `panel=shell-deep&drive=park` as a `wt`/`main`
  library A/B has not been run; it opens a full-screen window and needs the
  user's go-ahead. The offline work stands on its own for correctness, and the
  −85.5% remains the arm's upper bound, unconfirmed for the shipped gate.

## The rail follow-ups: three fixed, four stand, and item 6 was mis-scoped (2026-09-27)

**Closed by `plans/implemented/rail-handover-follow-ups.md`**, the last plan of
the nine-phase batch. Of the six observations indexed above plus the seventh
recorded only in `rail-minimized-dock-slot`'s notes, three are fixed and four
stand with a stated reason. `setRail`'s detach branch now runs the preparation
`setWindowState`'s docked branch runs — capture the normal-resize minimum,
relax it, hide the body host — so a window handed back to the dock arrives at
the row's strip height instead of its own 200 px floor. And every path that
supersedes or ends the rail collapse/expand pair now cancels **both** handles:
`animateRailExpand`, `animateRailCollapse` and `onExitAction`, joining
`destructor` and `setRail`, which already did. The four that stand — the
collapsed rail's hidden handle, `Rail.unmount`'s kept registrations,
`setRail` not cancelling `_stateAnimHandle`, and `endRailCollapse`'s
`transform-origin` — are argued in that plan's `## Architecture Decisions`; two
gain a doc sentence and one a corrected source comment, none a mechanism.

- **Item 6 is a hard lock, but not the one recorded above.** The note at the end
  of the ten-plan section puts "hidden while its state reads `"normal"`,
  unrecoverable by the user" on `onExitAction`. It belongs to the *seventh*
  observation — `animateRailExpand` cancelling only its own handle — where a
  restore arriving inside the 150 ms collapse lets that collapse complete and
  call `setDisplayed(false)` on a window whose state already reads `"normal"`,
  which no gesture undoes: `restore()` early-returns on a window that is not
  minimized, `setWindowState` early-returns on the state it is already in, and
  the rail's handle calls `restore()`. `onExitAction`'s own two defects are a
  `"minimize"` emitted after the window's `"close"` and a close fade cut short
  by the superseded animation's deadline. The agenda's verdict — that this is a
  lock rather than a loose end, and the strongest reason to land the branch —
  was right; only its attribution was off, and the seventh observation was the
  one carrying it.

- **Two of the plan's own prescribed verifications were vacuous, and two of its
  additions were unpinned.** This is the batch's recurring finding, and it held
  here too. W29's `b.getY()` equality cannot fail from the fix it is listed
  under, because the dock writes `y = viewportHeight - headerHeight` for both
  windows regardless of the height clamp; and its `b.getHeight()` equality
  passes with *both* routes broken, since A and B then agree at 200, so the row
  needed a non-zero baseline bound rather than a bare comparison. Worse, two
  shipped lines were pinned by nothing: deleting `onExitAction`'s expand cancel
  left the prescribed R1-R13 green, and replacing the detach's
  `if (this._normalMinSize === null)` guard with an unconditional capture left
  **all 518 files green, 8707 passed and 2 todo — the whole suite as it stood
  before W32 was written** — a guard whose contract the plan
  states in prose and prescribes no row for is exactly what a later reader
  deletes as dead. R14 and W32 close both; nine cases ship where seven were
  prescribed, and every mutation of every added line now kills at least one.

- **Open candidate: the unpaired `"restore"` a voided collapse debt leaves.**
  Raised by this plan's audit and left unchanged, because it is not this
  branch's behaviour and its fix reverses a decision the previous plan made on
  the record. A rail minimize defers its `"minimize"` to the end of the 150 ms
  shrink; `animateRailExpand` voids that debt when a restore interrupts the
  shrink, on the ground that a window leaving `"minimized"` has nothing left to
  announce. A consumer pairing the two events therefore sees a `"restore"` with
  no `"minimize"` before it. The rule and its rationale predate this branch and
  are pinned by name by R9, "a restore
  voids the collapse's debt". **Corrected 2026-09-29: R9 came with
`rail-minimized-dock-slot` (`1dfde904`), which names it at `:598`, not with
`split-noop-drag-frame-gate`, whose plan does not mention R9 at all.** This
entry originally named the branch R9 was observed on rather than the plan that
wrote it, and the misattribution propagated into
`rail-minimize-restore-event-pairing`'s own footnote before an audit caught it —
which is what a wrong pointer in this file costs. The alternative — fire the owed `"minimize"`
  first, as `setRail` does for a window that *stays* minimized, giving
  `['minimize', 'restore']` — is a public event-contract change and wants its
  own plan. Note the asymmetry is deliberate rather than accidental: `setRail`
  pays the debt because its window is still minimized, `animateRailExpand`
  voids it because its window is not.

- **Open candidate: `Animation.finish`'s transition clear can cut short a live
  sibling animation, in eight pairs beyond the rail's.** Half of this plan's
  cancel-both argument is specific to the rail — the collapse's `onComplete` is
  destructive, calling `setDisplayed(false)` and emitting `"minimize"`, which no
  other pair does. The other half is not: `finish` writes
  `buf.set("transition", null)` (`core/Animation.ts:201`), so whenever one
  animation supersedes another on the same element, the superseded one's
  deadline clears the `transition` the live one is running through and truncates
  it. An independent search for the precedent found every other animation pair
  in the library cancels only its *own* handle at the play site and both only at
  teardown: `AnimatedDropdown.ts:224/268/379`, `Tooltip.ts:436/470/1158`,
  `Popover.ts:511/538/647`, `Menu.ts:739/753/763`,
  `Notification.ts:335/582/713`, `Dialog.ts:989/1302/1340`,
  `Drawer.ts:535/570/753` and `Rail.ts:676/848/1374`. The rail's fix is pinned
  by R13 and R14; whether the same truncation is reachable by gesture in the
  other eight is unmeasured, and wants one plan across them rather than eight
  one-line patches.

- **Open candidate: `onExitAction` cancels the rail collapse but never undoes
  it.** The natural next follow-up after this plan, and named in its manual-
  verification caveat. `setRail`'s detach calls `endRailCollapse()` because
  `Animation.cancel` writes no styles, so the genie's `transform` and `opacity`
  stay declared on the element; `onExitAction` does not, and its
  `[^exit-no-emit]` justifies leaving `_railCollapseActive` set on the ground
  that "nothing reads either again". That holds for the flag but not for the
  element, which is still on screen for the close fade's 150 ms — so a close
  arriving mid-collapse fades out from the shrunken, faded state rather than
  from the window's resting one. Strictly better than before this plan, where
  the collapse also ran to completion and called `setDisplayed(false)` in the
  middle of the fade, so it is an improvement that stops short rather than a
  regression. One `endRailCollapse()` call, plus a row pinning the fade's start
  state, is the whole fix.

## The four-plan batch shipped, and v0.10.0 released (2026-09-29)

The 2026-09-28 batch is merged and released. Four plans, run sequentially with
each phase branching from the previous chain tip —
`split-gutter-zero-thickness-gap`, `split-drag-unclamped-geometry`,
`panel-resize-metrics-staleness`, `table-row-layout-pass-contract`, in that
order, because the gutter plan changes the box the drag plan's literals were
pinned against. Three of the four fix defects the user reported by eye rather
than candidates this file bounded, which is worth noting: the campaign's own
sweep did not find them.

- **The gutter is zero-thickness and the reserve is an option.**
  `GUTTER_SIZE` is gone, `GUTTER_HIT_OVERHANG` went 3 to 5, and the inter-pane
  reserve is a `Split.spacing` option defaulting to 0 — so a gutter is pure
  overhang, 5px into each pane, and reachability is the acceptance criterion
  rather than a side effect of its width. `Border` keeps its own default of 5
  and `Accordion` was left out, both user-confirmed. The `isMovable()` box gate
  is deleted, because with no reserve it would yield a 0px element and clip the
  chevron; `setMovable(false)` drops the gutter's pointer events instead. The
  overlay scrollbar's `setZIndex(2)` is why the gutter takes 1 and never more.
- **A held drag past a clamp keeps the gutter on the pane edge.** The stale
  total was the only thing decoupling the trailing pane's extent from its
  position, which is why D2b deliberately moved from `[0,1]` to `[0,0]` and no
  case can isolate `rhsMoved`'s position term afterwards; D2d stays the
  extent-only witness. The `setX`/stale-translate issue is a third, separate
  defect, held out of scope with U7 pinning that it rides through correctly.
- **The resize-burst deferral is reverted, not extended.** A `Split` gutter
  dragged over a scrolling, overflowing `Panel` now re-flows content, tracks
  the overlay bar and moves the shadow edge *during* the drag. Two traps found
  while prototyping are in the plan: the new test file's `afterEach` must drain
  captured frames or seven of eight scene cases fail spuriously, and
  `doLayout`'s public comment must stay prose-only or `docs:api` warnings
  multiply across eight subclasses. Its stated non-goal is that
  `showsScrollAffordance()` is false on the frame a bar must *appear*, so that
  direction still lands at the catch-up.
- **A table `Row` records its pass** — see the closure on the `Row.doLayout`
  entry above.

The user's verdict on the chain tip, before release: *"I just tested Loom with
the chain tip. I can almost not believe the difference from how pre-campaign
behaved."* Both gutter and scrollbars easy to drag. That is the campaign's
outcome in the application it was run for.

## Owed manual verification, consolidated (2026-09-29)

Nine implemented plans each left a step their offline harness could not reach,
recorded only in the plan that owed it. They are collected here because a list
spread across nine files is a list nobody runs, and because the campaign stays
open until they are discharged.

**Only the user can run any of these** — each needs real pointer input, real
painting, or a window on their desktop. No agent runs them.

1. **The gutter's context-menu lock** (`split-gutter-zero-thickness-gap`, item
   16). A right-click over a locked gutter should reach the pane beneath it,
   now that `setMovable(false)` drops pointer events rather than gating a hit
   box.
2. **Collapse and restore** (same plan, item 17). A gutter that paints nothing
   must become an opaque 18px strip on collapse, and return with no visible
   jump.
3. **A drag held past both clamps** (`split-drag-unclamped-geometry` — its own
   notes call this the only unverified item on the branch). Drag past a pane's
   minimum and past its maximum, both orientations, holding at each: the gutter
   stays glued to the pane edge. Then, with the drag still held, resize the
   window — the trailing pane stays inside it.
4. **The live re-flow sweep** (`panel-resize-metrics-staleness`). One fast, far
   sweep of a `Split` gutter over a scrolling, overflowing `Panel`, watching the
   bar's *far end* rather than the thumb: a slow drag self-corrects every ~3
   still frames, so a gentle pass cannot fail.
5. **Validation arming under a resting pointer** (`validation-error-arming`,
   never run). Binding tab, click into **Name**, type past the limit *without
   moving the mouse*: outline and error tooltip appear together after the hover
   delay, re-appear with new text as the message changes, and go when the
   pointer leaves.
6. **Four rail window items** (`rail-handover-follow-ups`): a window handed back
   sits flush with its neighbours; a double-minimize leaves the window usable; a
   close after a minimize fades once; a restore then minimize plays the full
   genie.
7. **The scroll and shadow pass** (`panel-scroll-read-economy`): the Markdown,
   Grid and Complex UI tabs, by eye.

The `absolute-sizing` demo's "funky" appearance, deferred 2026-09-28, is off
this list: it was traced 2026-09-29 to the docs site's demo embedding and is
not specific to that demo or to the `sizing` option. See the decisions below.

**In-engine, as one combined sweep.** Every campaign branch is merged, so the
`main`/`wt` arm pair no longer exists and isolating one plan would need a
revert build per plan. Decided 2026-09-29: one **v0.9.0-against-v0.10.0** A/B
over every cell the release touched. It cannot attribute a result to a single
plan and a surprise would need follow-up isolation — accepted, because three of
the four predict a flat clock and their work reductions are already pinned
offline.

| Cell | What it answers |
|---|---|
| `field-internals`' E14, with the `ffq`/`fnq` counters | the acceptance gate that plan declared, and what makes a *settled* picker field lay out at all — which it records as unidentified. The counter reading is a read on the new arm rather than a comparison, so the combined sweep still answers it. |
| `panel=shell-deep&drive=park` | F06.3's gate on the shipped opt-in predicate. The −93.8% work figure is an adjacent arm's upper bound, and a park cell charges roughly 3.4 ms of instrument tax to any runtime patch. |
| `spp`, plus `cdw`/`sdw`/`ssw` | `panel-scroll-read-economy`'s settled-pass and wheel-read cells: reads down by half or more, geometry `=`, clock flat by design. |
| the table-scroll cell | `table-row-layout-pass-contract`: roughly 1,100 cells re-committed per window-changing horizontal scroll and per table resize. A flat clock ships; a regressed clock is a stop-and-report. |
| `table-wide` with `hwheel` | `canvas-idle-loops`' per-re-attach `isEffectivelyVisible()` walk — the campaign's last unmeasured cost, folded in here rather than given a sitting of its own. |

Read with `python3 packages/qa/bin/qa-table.py packages/qa/results <prefix>
--work`, five runs per cell as `wt-a, main-1, wt-b, main-2, wt-c`, under
`work=1&seam=1&geom=1`. Never compare harness absolutes across sessions.

## Decisions taken 2026-09-29

Taken one at a time with the user after v0.10.0 shipped, against an inventory
of what the campaign had left. The inventory itself is the reason this pass
happened: **four of its items turned out to be already fixed**, because this
file had gone stale in six places since 2026-09-27.

**Already fixed, corrected in place above:** the table's `Date`/`DateTime` cell
editors — the strict parse landed in the shared `dateMath` helper
(`parseIsoDate:227`), so the table inherited it, pinned by
`tests/component/table/cell/editor.test.ts:756`, `:824`, `:989` and
`DynamicCell.test.ts:357`; the CSP blob-URL leak
(`store-worker-blob-url-leak`); `DateField.formatValue`'s year padding
(`formatIsoDate:188` pads to `ISO_YEAR_DIGITS` and carries the sign for
negative years); and `Tab`'s `activeIndex` across the transient filter
(`layout/LayoutSerialization.ts:617-636` decrements it per filtered child
below it, then calls `setActiveTabIndex`). `Favicon` stands, with a sharper
defect than was recorded.

| Decision | Plan |
|---|---|
| `Animation.finish`'s transition clear gets a **central** fix — `finish` stops clearing `transition` when it has been superseded — with a pinning row per pair, rather than eight per-site cancel-both edits, because the per-site version leaves the underlying behaviour in place and a ninth pair added later reintroduces the bug. `onExitAction`'s missing `endRailCollapse()` rides along as its own commit on that branch. | `animation-finish-transition-clear` |
| The unpaired `"restore"` **pays the debt**: the owed `"minimize"` fires first, giving `['minimize','restore']`, as `setRail` already does for a window that stays minimized. This reverses R9 and is a public event-contract change, so it carries changelog and migration entries. The deciding argument: a window's state reads `"minimized"` during the shrink, so a consumer polling state sees a transition no event ever announced. | `rail-minimize-restore-event-pairing` |
| `Favicon` and `Glyphs` both move onto **the general registry** `glyph-sprite-reset-hook` declined, so a later sink-keyed cache joins by construction; `Favicon._reset()` and its four call sites go with it. Chosen over a second one-off hook. | `document-cache-reset-registry` |
| **All 14 `docs:api` warnings get fixed**, making zero the real bar; no CI gate. `packages/lib/tsconfig.json` gets an **`include`** scoping it to the library sources. | `docs-api-warning-clearance` |
| `Notification`'s dismiss timer routes through the **`DOMSink` seam** — the last of the phase-2 residue, and the third instance of this defect after `TableHeader`'s debounce and `Animation`'s fallbacks. | `notification-dismiss-timer-seam` |
| The docs site's injected demos **match the prose column**: the left inset prose blocks already get, plus top and bottom insets so a demo's rhythm stops depending on what precedes it. This is what the `absolute-sizing` demo's odd appearance actually was — `DocsContent.ts:440` passes `proseMargin` to the missing-demo fallback but not to the real `DocsDemo`, and `:140`'s `spacing: 0` leaves vertical rhythm to CSS margins that a component tree does not have, which is why the missing gap was intermittent. | `docs-demo-prose-alignment` |
| The demo app's 32 panels get **a category tree in a `Split`**, rather than nested tabs, an activity rail, or a scrolling tab strip. | `demo-app-category-navigation` |
| The library gap that work uncovered is **closed first, upstream**, rather than worked around in the demo app: `Card` gains a caller-supplied key so a deferred child can be selected unbuilt, which only `Tab` could express before. Chosen over shipping the demo rebuild with an app-level lazy record, on the ground that the demo app exists to exercise the library rather than to route around it. | `card-deferred-child-keys` |
| The two public events v0.10.0 shipped without notes — `TableHeaderEvent`'s `"columnresizeend"` and `HeaderCellEvent`'s `"resizeend"`, confirmed by diffing both aliases against the `v0.9.0` tag — are recorded in `changelog/next.md`, treating 0.10.0's published notes as immutable. Done 2026-09-29. | — |
| The in-engine debt is discharged by **one combined sweep**, not four isolated revert builds. | — |
| **The campaign stays open** until the manual checks and that sweep are done, then closes in one pass with the results recorded here. Closing now and demoting the residue to an ordinary backlog was rejected, so that evidence and outcome stay in one place. | — |

Four rail observations stand by decision rather than omission, each argued in
`rail-handover-follow-ups`' own Architecture Decisions: the collapsed rail's
hidden handle, `Rail.unmount`'s kept registrations, `setRail` not cancelling
`_stateAnimHandle`, and `endRailCollapse`'s `transform-origin`.

## What the seven plans found while drafting (2026-09-29)

Every decision above became a plan the same day, each drafted in its own
worktree off `master` by a fresh-context agent. Four of the seven corrected a
premise **this file** supplied, which is worth recording as one pattern rather
than four separate surprises: an agenda entry's numbers and scopes age faster
than the code they describe.

**Premise corrections.**

- `docs:api` emits **17** warnings, not 14. `typedoc.json`'s three
  `externalSymbolLinkMappings` `"#"` entries silently swallow three
  type-reference warnings.
- `tsc -p packages/lib/tsconfig.json` reports **37** errors, not 30: 25 unused
  locals and 10 timer casts in tests, plus two `TS2322` in *library* sources.
  The `include` clears all 37, verified by patching the config rather than
  predicting — 0 errors, all 3,241 library files still in the program,
  `@types/node` down from 82 files to 0, both child configs still green, and a
  mutation probe proving the program really compiles the sources.
- The transition-clear defect's "eight pairs" is **eleven same-element families
  across nine classes**: `Dialog` and `Drawer` each animate a backdrop as well
  as a panel, and `AbstractWindow` holds four handles against its own element.
- "One `endRailCollapse()` call, plus a row pinning the fade's start state, is
  the whole fix" is **wrong**. The call writes the resting state in the same
  task as the fade's own `to`, and a CSS transition starts from the element's
  state at the *previous* style recalculation, so the fade still animates out of
  the mid-genie value. The close fade also needs a `from`, conditional on
  `_railCollapseActive`, because `play`'s two-frame yield is what commits a
  start state. An unconditional `from` was rejected: two frames on every close,
  and it would snap a window closed mid-drag back.

**Reachability, now established** for the transition truncation, and worse than
this file assumed. Gesture-reachable in `AnimatedDropdown`/`PopupPanel`,
`Menu`, `Popover`, both `Dialog` families, both `Drawer` families and
`AbstractWindow`'s show-vs-close/minimize. Reachable in `Notification` only
through the unclamped public `duration` parameter. Programmatic-only in
`Tooltip` (the 500 ms hover delay) and `Rail` (the single-handle chevron
toggle). So it is a live defect across most of the overlay surface rather than
a latent one.

**A fourth vacuity shape, found by drafting rather than by audit: a fix can
render an *existing* row vacuous.** The central animation fix alone satisfies
R13/R14's "exactly one clear" assertion, so afterwards deleting
`animateRailCollapse`'s and `onExitAction`'s expand cancels would leave the
suite green — a still-needed line pinned by nothing. That plan keeps the lines,
adds a listener-release assertion to each row, and prescribes an explicit
delete-and-revert mutation step; it also records that deleting the two cancels
instead would make R13/R14 sharp pins needing no new assertions, if that trade
is preferred. `rail-minimize-restore-event-pairing` checked for the same shape
under its own change and found R9 does **not** go vacuous, nor does any other
existing row. This shape belongs beside the three in the batch's methodological
finding: it is the only one an audit of the *new* rows cannot catch.

**New open items, none planned.**

1. **Three types appear in public signatures and are never barrel-exported** —
   `CellTextResolver`, `ColumnWindowSlidePlan`, `RetargetedCell`. A consumer
   cannot name a type the API hands them. Hidden until now by the typedoc
   mappings above; it needs an API change, so `docs-api-warning-clearance`
   holds them out of scope and forbids a new mapping as a "fix".
2. **Eleven bare timer arm sites remain across nine files**, eight of which
   qualify for the `DOMSink` seam (the two `Tooltip` sites most strongly).
   Three one-at-a-time conversions in — `TableHeader`'s debounce,
   `Animation`'s fallbacks, and now `Notification`'s dismiss — the proposal is
   a `local/no-raw-timer` ESLint rule on the existing baseline machinery rather
   than a fourth conversion. The convention has failed; enforcement is the fix.
3. **`Notification`'s static stack and counters survive `DOM.reset()`** — real,
   and a stated Non-Goal of `notification-dismiss-timer-seam`.
4. **`Tab` is the only layout manager that defers a factory.** `Card` selects by
   a built child's component id, which an unbuilt child does not have, so the
   demo app's lazy panel construction cannot move to `Card` without giving it a
   caller-supplied key — a public API change `demo-app-category-navigation`
   records in its Non-Goals rather than bundling. Whether that lands first is
   open.

**Two defects found in passing**, each now in the scope of the plan that found
it: `Notification.destructor()` never clears `_dismissTimer`, so disposing a
live toast leaves the timer armed and it fires; and the modelled DOM now throws
on a dead handle, which makes `tests/core/Favicon.test.ts:44-46`'s comment
false.

**Suggested phase schedule**, from the plans' own `depends-on` and shared
files. `docs-api-warning-clearance` goes first so that every plan after it is
held to a zero-warning bar rather than a baseline, and because its diff is
doc comments spread across many library sources and wants a quiet tree.

| Phase | Plans |
|---|---|
| 1 | `docs-api-warning-clearance` |
| 2 | `animation-finish-transition-clear` |
| 3 | `rail-minimize-restore-event-pairing` (depends on phase 2; shares `Rail.ts`, `AbstractWindow.ts`, `changelog/next.md`) |
| 4 | `document-cache-reset-registry`, `docs-demo-prose-alignment`, `card-deferred-child-keys` — no file overlap between the three |
| 5 | `demo-app-category-navigation` (depends on phase 4's `Card` change), `notification-dismiss-timer-seam` (after the registry's `core/DOM.ts` edits land) |

Phases 4 and 5 must stay adjacent in that order for a second reason:
`card-deferred-child-keys`' only manual verification is "start the demo app,
click three sections, return to the first", which cannot run until the demo-app
plan is on top of it. Its sixteen offline cases carry the fix on their own, so
this is a sequencing constraint rather than a gap, and the demo-app plan's own
manual step 5 exercises that path — the two are deliberately not run twice.

Note that `changelog/next.md` is shared by four of the seven, so it is the file
the chain rebase will conflict on; keep each plan's diff to it minimal and edit
it late.

## The by-eye pass: seven for seven, and two observations (2026-09-29)

The user ran all seven owed by-eye checks against `master` at `df533b75`.
**Every one passes.** In the list's order, as reported: right-click reaches the
correct pane and the gutter does not block it; collapse and expand work without
issue; the held drag past both clamps works as expected; the live re-flow sweep
shows nothing wrong; validation arming under a resting pointer works; the four
rail items show nothing wrong; and scrollbar and shadow placement are correct.

**So the campaign's by-eye debt is discharged.** What stands between it and
closure is the combined v0.9.0/v0.10.0 in-engine sweep above, and nothing else.

Two observations came out of the pass, neither of them a failure of the check
that surfaced it.

**A rail-docked window maximizes and restores with no animation — cause still
open, and not the truncation it first looked like.** The asymmetry is real: the
minimize direction runs `animateRailCollapse` alone, while every transition out
of `"minimized"` while railed runs both `animateRailExpand()` and the state
branch's `animateRect()`. The first attribution — that the genie's deadline
clears a `transition` the rect animation is running through — was **wrong**, and
was corrected by tracing rather than by argument:

- `tweenRect` (`:3338`), the small-change path a **restore** takes, is
  `Animation.tween`: a JS `requestAnimationFrame` loop whose `onStep` is
  `commitRect`. It takes no `Handle`, declares no `transition` and never calls
  `registerTransition`, so there is nothing for a superseded `finish` to clear.
- `fadeRectSwap` (`:3193`), the large-change path a **maximize** takes, does run
  two `Animation.play` calls — but on `resolveBodyHost()?.getElement()`
  (`:3194-3195`), and `findBodyHost` (`:2737`) returns a non-chrome *child*,
  never `this`. A different element, so no supersession arises.

So `animation-finish-transition-clear` does **not** fix what the user saw, and
it scopes this out in its Non-Goals rather than claiming it. Three candidates
stand, and separating them needs the engine:

1. A restore's `animateRect` target is the rect the window never left — the rail
   branch leaves geometry untouched (`:1266-1267`) — so `isLargeRectChange` is
   false and `tweenRect` tweens from a rect to an identical one. No rect motion,
   **by design**: the genie is the intended motion, and the by-eye pass confirms
   the genie itself plays.
2. `fadeRectSwap` with no body host commits the target and returns synchronously
   (`:3199-3204`) — its own comment calls this "just the jump" for "a
   chrome-only window, or one not rendered yet".
3. Following from 2: the rail path calls `setDisplayed(true)` in the *same task*
   as the restore, so the body host may not be rendered when `fadeRectSwap`
   reads it — which would take a railed window down the jump path where a
   non-railed one animates. Untested.

That plan now carries the observation, the traced disproof, a by-eye control
step expecting the missing motion to persist, and case R16 guarding that the
central fix does not suppress the reverse genie's own clear on this path.

**The lesson is the day's own, applied to itself.** A mechanism asserted from
reading a call path, and written into this file as confirmed, was wrong within
the hour — the same shape as the four already-fixed items and the over-claimed
scrollbar fix above. What made it wrong was cheap to find: two file reads,
by someone who then said so.

**The Grid panel's scrollbar and shadow flicker on a sub-pixel float error, and
`feature/scrollbar-overflow-epsilon` does not reach it.** That branch put
`OVERFLOW_EPSILON_PX = 0.5` into `component/container/Scrollbar.ts` and
`component/container/VirtualScroller.ts`. The Grid demo panel's overlay
scrollbar and its shadow are decided in `core/Panel.ts`, which the branch does
not touch and which still compares bare: `:895` and `:896` derive `vVisible` and
`hVisible` from `scrollHeight > clientHeight` and `scrollWidth > clientWidth`,
and `:952`/`:953` reserve the gutters the same way. The shadow is conclusive —
`_shadowEdges` exists only in `core/Panel.ts`, so nothing on that branch can
affect it.

**Deferred deliberately, and test-first.** The obvious move is to extend the
epsilon to those four sites on that branch now. The user chose instead to wait
until everything is merged, so the gap can be **proved** rather than argued: run
the Grid panel against the merged fix, show the flicker survives, and only then
extend the epsilon. That ordering is right on this file's own evidence — four
items on the 2026-09-29 inventory turned out to be already fixed, and this very
case is a fix assumed to cover something it does not. A patch justified by
reading is how that happens; a patch justified by a failing case is not. When it
comes, it wants a test on Panel's own path: the branch's two tests cover
`VirtualScroller` and the Table resize case only.

## The release sweep: two confirmations, one partial, three empty cells (2026-09-29)

Run as `packages/qa/sweeps/release-v0-10-0.sh r1 r2 r3 r4 r5`, MiniBrowser host,
session prefix `rels1`, `work=1&seam=1&geom=1`, five runs per cell interleaved
`wt-a, main-1, wt-b, main-2, wt-c`. 41 runs completed; the 42nd failed and
stopped the sweep, for a reason recorded at the end of this section. The `wt`
arm is the tight arm `5a2f4960`, not v0.9.0 — see the sweep script's own header
for why, and the previous section for the analysis that forced the change.

**F06.3's gate delivers the whole of its ablation's bound.** `rels1-r2-sdp`:
work per unit **2018.5 → 292.0, −85.5%**, sink ops **96.4 → 1.0, −99%**. This
file carried −85.5% as the arm's figure and flagged it as *unconfirmed for the
shipped gate*; the shipped gate reaches it exactly. `sidebar.doLayout` and
`main.doLayout` go 0.99 → absent, so the gate engaged. Clock flat — wt
9.6/6.7/7.6 ms against main 7.3/9.0, p90 17/15/15 against 14/17 — consistent
with the ≈3.4 ms park-cell instrument tax, and with a real work win that the
clock does not show.

`geom` reads **DIFF** on both `main` runs, **and that is the expected result,
not a fault.** The park line records the parked element at `165,42,10,1998` on
the tight arm and `163,42,10,1998` on v0.10.0: `split-drag-unclamped-geometry`
deliberately moving a parked drag's rectangle. A later reader must not take
this cell's DIFF for a regression.

**The settled-pass gate is confirmed outright.** `rels1-r3-spp`:
`pane.remeasure@ScrollPane` **24 → 0** and `pane.remeasure@Panel` **1 → 0**,
identically across all five runs. Geometry `=` on every row *including* `row0`,
so the `--allow-diff row0@1,row0@2` allowance recorded above was not needed.
Clock flat (3.1 → 2.9 ms); work 18,693 → 18,476; sink 1,249 → 1,153.

**E14's residual counters: one of four, and the plan's claim does not reproduce
in-engine.** `rels1-r1-ffq` and `-fnq`. `doLayout@PickerInput` falls **16 → 0**
on both panels, every run. `doLayout@PickerButton` stays at **32**, and
`@ButtonIconGlyph` and `@ButtonLabelText` at **32** (flat form) and **33**
(nested), unchanged. `@DateField` and `@TimeField` hold at 8 on both arms, which
is what that plan says should happen.

So `field-internals-unchanged-commit-opt-in`'s claim — that a settled picker
field's own pass costs exactly one `doLayout` call, taking all four residual
counters to zero with the two `Button` internals withheld whole — is **not**
what the engine shows on this drive. That plan's own notes record that its
offline model does not reproduce what makes a settled field lay out in-engine,
and this is that gap showing. One caveat before anyone calls the plan wrong: 32
counts over 150 units is 0.21 per unit, so those three may be mount-time rather
than steady-state. A per-phase reading would separate the two; this cell cannot.

**Three cells measured nothing.** `rels1-r3-cdw`, `-sdw` and `-ssw` emit no
scroll-read counter on *either* arm, `work/u` 0.0 on both sides — the wheel half
of `panel-scroll-read-economy` is unwitnessed by them. `rels1-r4-tw` reports
`work/u` and `sink/u` **identical to the decimal on both arms and both phases**
(`hwheel` 0.0 / 1.0; `resize` 772.8 / 4624.9), so the ≈1,100 re-committed cells
never appear and the cell does not reach `table-row-layout-pass-contract`'s
mechanism at all. That is neither a pass nor a regression but an empty cell — the
failure this file has warned about in the other direction, and the reason a
figure is only as good as the cell that produced it.

**The walk cell cannot run against v0.9.0, and the reason is worth keeping.**
`rels1-r5-twv-wt-a` failed with `ERROR table-wide: the store's view is still
empty 10000ms after loadData; the store never fired load` — the
pre-`store-worker-fail-safe` defect. v0.9.0 cannot mount any panel over
`WORKER_THRESHOLD`. So **no v0.9.0-armed cell on a large-store panel was ever
runnable**, which independently vindicates moving the four plans' cells to the
tight arm: the sweep as originally specified would have died in the same place,
after burning a sitting. The visibility walk stays unpriced, and pricing it needs
the isolated `33e33af7^1` pair or a new ablation.

**Nothing regressed.** No clock worsened beyond run-to-run noise on any cell, and
every geometry DIFF is attributable to a deliberate change inside the delta.
`table-row-layout-pass-contract`'s stop-and-report condition did not trigger.

**What this leaves, and one question for the user.** Two of the four owed
confirmations are now confirmed in-engine: F06.3's gate and the settled pass.
E14 is answered, and the answer is negative-to-inconclusive. Three cells need
replacements that actually reach their mechanisms before they can say anything,
and the walk needs an isolated pair. The campaign was held open until "the
manual checks and that sweep are done"; the manual checks passed seven for seven
and the sweep has run, but it discharged two of four cells rather than four. So
the closing decision is now a real one rather than a formality: close on the two
confirmations plus a recorded list of what the empty cells could not show, or
hold open for replacement cells. Not decided here.

## The three plans audited: 34 findings, and a fourth vacuity shape confirmed (2026-09-29)

The three highest-risk of the eight residue plans were audited before
implementation rather than after — `animation-finish-transition-clear` (a central
change to a mechanism shared by eleven animation families),
`rail-minimize-restore-event-pairing` (a public event-contract reversal of a
decision pinned by name) and `card-deferred-child-keys` (a public API addition a
second plan depends on). Three rounds each, a fresh reviewer every round, then
one consolidated fix pass with no audit behind it.

**34 BLOCKING findings**: 12, 13 and 9 respectively, across nine reviews. The
counts did not converge — 5/3/4, 5/4/4, 4/1/4 — and the reason matters. Fixes
did not fail; each fresh reviewer dug where the last had not. The mechanism in
all three was verified by measurement, twice by reviewers who applied the
prescribed change to a local copy and ran it. What kept surfacing was **check
quality**, which is this campaign's signature defect and now has a fourth shape
on the record beside the three from the nine-plan batch:

| Shape | Example found here |
|---|---|
| Satisfiable when both sides are zero | (the batch's original three) |
| A case list covering one of two symmetric arms | — |
| A call count where the contract is a consequence | — |
| **A fix renders an *existing* row vacuous** | the central animation fix alone satisfies R13/R14's "exactly one clear" |
| **A row red on correct code** | A6 asserted `getElement() === null`, but `removeElement` keeps `_element`; R16's spy installed after the write it asserts on |
| **A mutation no case can kill** | A3's `return false` branch is unreachable from `finish`, which the plan's own footnote said outright |

Three process findings worth keeping, all of them about how the loop was run
rather than what it found:

- **An ADVISORY is not a stable category.** Twice, an item filed advisory in one
  round was called BLOCKING by the next round's reviewer — R15's wrong predicted
  values and `Rail.md`'s missing `touches-shared` entry — and both persisted only
  because the audit skill's rule not to fix advisories was followed. For a
  factual error (a wrong line, a misattributed quote, a mutation table predicting
  the wrong value) deferring costs a round.
- **Naming an instance produces a partial fix.** A brief that cited
  `[^one-helper]`'s line got that footnote corrected while the body kept the same
  false claim, leaving the two contradicting each other. Name the claim, not the
  line.
- **Parallel fix rounds on plans that share a file collide.** Two plans append
  rows to `AbstractWindow.railHandoverAnimated.test.ts`; one renumbered to R17-R20
  while the other was adding R17 and R18, recreating the collision it was fixing.
  The durable fix is not a number but a step: `rail-minimize-restore-event-pairing`
  now counts the existing `it('R` rows and reconciles before adding any.

**The plans also corrected their reviewers, and me, three times on evidence.**
The transition-clear mechanism was disproved as the cause of the rail
maximize/restore defect by tracing `tweenRect` and `fadeRectSwap` rather than
accepting the attribution this file had recorded. The twelfth animation family
was declined with a trace showing `Tab`'s content fade and `materialize`'s fade
are strictly sequential on their element. And "move the `doLayout` catch-up below
the `getInnerSize()` guard" was shown unimplementable, because `Card.doLayout`
returns on `!_currentVisible` above that guard, so the catch-up would be
unreachable for the case it exists to serve. A fix round that only complies
produces plans that agree with their reviewer and still do not work.

Final state: eight plans drafted, three audited to the cap and closed by a final
pass, all untracked in `plans/` for `/implement` to commit. The suggested phase
schedule above is unchanged.
