# Phase 2 status pass — the correctness register re-verified

`00-post-campaign-agenda.md`'s Phase 2 opens by requiring a status pass
against `master` before anything is planned, because waves 1 and 2 edited
several of the files the register names. This is that pass, run 2026-09-20
against `master` at `82f012b1` as four independent read-only reviews. Every
line number in `99-synthesis.md`'s bug tables is from 2026-09-15 and has
drifted; the locations below are current.

Nothing here re-derives a bug's cost. It answers three questions per entry:
is it still real, where is it now, and what shape is the fix.

## Headline

Of the 27 entries the agenda carried as open, **25 are open** and 2 are
closed. Agenda item 3 is closed as well.

| Closed since the record | By |
|---|---|
| C12 — `Button.clearDescription` strands the description `Text` | wave 1's `8d8adb29`, with a regression test at `tests/component/button/Button.test.ts:641` |
| C13 — `CellEditorPool.register` drops a cached editor undisposed | C1's fix `6b8e0d5a`, with a regression test at `tests/component/table/cell/CellEditorPool.test.ts:175` |
| Item 3 — the latent `CellEditorPool` ownership guard | C1's fix, as the synthesis predicted it would be |

Both landed fixes are the precedent C10 needs, and item 3's closure is worth
stating precisely: `acquire` (`CellEditorPool.ts:101`) now calls
`commitActiveCell(cell)` before taking the slot, and `release(cell)`
(`:129`) takes the releasing cell and returns early unless it owns the
slot, so a late release can no longer unhook the current owner.

For the six stuck-state bugs, `git log --since=2026-09-14` over their files
returns nothing: waves 1, 2 and the QA app never touched them.

## The register as it stands

Paths are relative to `packages/lib/src/typescript/lib/`.

### Leaks that grow without bound

| # | Verdict | Current location | Fix shape |
|---|---|---|---|
| C6 | open | `component/input/Text.ts:1185`, `:1212`; `core/ClassStyleRules.ts:1067` | reject non-finite numerics at the `setLineHeight` entry; see the NaN family below |
| C7 | open | `component/editor/theme.ts:68`, `:69`, `:224` | memoise the two built extensions at module scope keyed on `dark` — the theme reads CSS vars and is invariant per flag |
| C8 | open | `overlay/Dock.ts:448` (destructor `:2371`); `overlay/Window.ts:165` (no destructor) | run the teardown `makeDropTarget`/`makeDragSource` already return |
| C9 | open | `component/table/TreeBody.ts:113`, `:132`, `:135` | **create** a destructor; run `_rowDnDTeardowns` and `_emptyAreaDropTeardown` |
| C10 | open | `component/table/cell/renderer/TreeCell.ts:222-224` | dispose the outgoing toggle — one line; the current toggle is a registered child, so no destructor is needed (measured) |
| C11 | open | `component/input/AbstractCalendarDropdown.ts:1007-1012`, field `:546` | **create** a destructor that disposes whichever half is detached — `openYearScroller` detaches the *day grid* as it attaches the year column, so the leak has two faces (measured: 185 components / 172 rules opened-then-closed, 43 / 30 left open) |
| C14 | open | `component/table/TablePanel.ts:132-140`; `component/table/TreeTablePanel.ts:138-146` | one line in each existing destructor; the two files are near-verbatim copies |
| C15 | open | `core/Animation.ts:211-212`, `:133`, `:153` | remove both listeners in `finish()` and `cancel()`; precedent at `:314` |
| C16 | open | `overlay/ButtonGroup.ts:232-234`, `:252-265`, `:276-298` | store the per-button handler and `off()` it; tear down a prior `RovingTabIndex` before installing a new one |

### Wrong render

| # | Verdict | Current location | Fix shape |
|---|---|---|---|
| C18 | open | `component/display/Markdown.ts:1043-1047` | guard on `isEffectivelyVisible()` **and** re-measure from `onEffectiveVisibilityChange` — the guard alone leaves the stale height cached |
| C19 | open, wider | `component/display/Markdown.ts:1617-1619`, `:2215`; `component/display/HeadingScrollTracker.ts:109` | scope heading ids per instance, or resolve through the scoped `DOM.source.querySelector` |
| C21 | open | `overlay/Tooltip.ts:462-477` | hide only when this component owns the visible tooltip; `Tooltip.activeElement` already tracks it, and `detachElement:618-620` is the precedent |
| C22 | open, moved | `layout/Absolute.ts:57-58`; `layout/LayoutManager.ts:587-597`; `core/Component.ts:5069-5072` | see the NaN family below |
| C23 | open | `component/input/DateField.ts:128-130` | shape-check before `new Date(raw + "T00:00:00")`; `TimeField.parseRaw:123` is the in-family precedent |
| C24 | open | `component/menubar/MenuBar.ts:88-91`; `component/container/MenuSeparator.ts:53-56` | keep the rule write, add a matching `cacheBorderSpec`; three verified precedents |
| C25 | open | `overlay/AbstractWindow.ts:2466` | `insets.getRight()` → `insets.getBottom()`; eleven sibling writes use the matching side |
| C26 | open, latent | `component/container/WindowBorder.ts:154-158`, `:113-115` | `=== undefined`, because `Direction.NORTH === 0` |
| C27 | open | `component/display/Markdown.ts:1069`, `:1080` | see the NaN family below |
| C29 | open | `layout/LayoutSerialization.ts:216` vs `:232` | route the `Split` branch through the existing `serializableChildren()` helper, keeping `ratios`/`collapsed` index-aligned |

### Stuck state, a11y, battery

| # | Verdict | Current location | Fix shape |
|---|---|---|---|
| C30 | open | `core/LayerManager.ts:175`, `:227`, `:398-406`, `:452-467` | bound the counter per band, plus an already-topmost early return in `bringToFront` |
| C31 | open | `overlay/Notification.ts:117`, consumed `:174` | a real band constant between Dropdown and Dialog, registered so it draws a counter stamp |
| C33 | open | `overlay/Notification.ts:605-619` | add a viewport `resize` listener calling the static `restack()`, torn down with the last toast |
| C34 | settled | `component/input/RadioButton.ts:365-376` vs `component/input/Checkbox.ts:450-454` | done by `plans/implemented/boolean-input-action-fanout.md`: `Checkbox.setSelected(value, fireAction = true)`, the cell editor passing `false` at both programmatic sites, `RadioButton` untouched. Residue recorded as C40 below |
| C35 | open, severity down | `component/display/AbstractCanvasSurface.ts:386-389` | `&& this.hasRenderingContext()`; `syncBackingStore:285-288` is the identical guard one method away |
| C36 | open | `component/display/AbstractCanvasSurface.ts:452-455`; `core/Component.ts:2575-2578` (`scheduleEffectiveVisibilityReconcile`; the register's `:2429-2438` and `:2563-2566` have both drifted) | have `wireChild` schedule an effective-visibility reconcile on the attached subtree, guarded on `getElement()` so only genuine reparents pay the edge |

### Agenda items

| Item | Verdict | Current location |
|---|---|---|
| 2a — closeable tab strip keeps an extra Tab stop per close button | open; **C32 could not have closed it** | `component/container/TabBar.ts:1802`; `component/button/Button.ts:779`; `core/Aria.ts:140-144` |
| 2b — `Dialog`'s Tab trap takes Tab from an editing surface at either end | open | `overlay/Dialog.ts:940`, `:1143-1166`; contrast `onEnter` at `:1198` |
| 2c — `CellEditorPool.register`'s `@remarks` reads narrower than the code | open, trivial | `component/table/cell/editor/CellEditorPool.ts:68-72` |
| 2d — the cell-editor fix's consumer-facing consequence is undocumented | open, trivial | missing from `packages/lib/docs/components/Table.md:72`; present only in `changelog/next.md:535-537` |
| 3 — latent `CellEditorPool` ownership guard | **closed** | `component/table/cell/editor/CellEditorPool.ts:101`, `:129`, `:170-179` |
| 4 — `core` touches the DOM on import | open, needs a decision | `core/Body.ts:47`, `:183-191`; exception pinned at `tests/unit/import-without-dom.test.ts:15-20` |
| 5 — a 1,000+ record store silently never builds its view | open | `data/StoreWorkerClient.ts`; `data/AbstractStore.ts:1905`, `:2012-2047` |

## Corrections the pass made to the record

Six places where `99-synthesis.md` is wrong or narrower than the code. Each
is amended in place; they are collected here because they change what the
plans must say.

1. **C34's justification is false.** The register says a removal is
   impossible because `CheckboxMenuRow`/`RadioMenuRow` depend on
   `Checkbox.setSelected`'s synthetic click. They do not:
   `AbstractBooleanMenuRow.installControl:256-270` sets
   `setPointerEvents("none")` on the control and listens on the *row*, and
   the synthetic click targets the checkbox element, so it is never
   delivered there. The real reason is stronger. `Checkbox.on("action")` is
   `Event.addListener(this, "click", …)` on the checkbox root
   (`Checkbox.ts:543`), a real user click lands on the inner `_box`
   (`:335`), and `Event`'s base dispatcher matches direct listeners by
   exact target id (`core/Event.ts:274-290`). So **`on("action")` never
   fires from a real click**, and the synthetic click is its sole delivery
   path for user and programmatic toggles alike. The opt-out is required by
   the `on("action")` contract itself, not by the menu rows.

2. **C35's impact claim does not hold in the target environment.** F26.7
   argued a context-less `WebGLCanvas` is "the normal case in
   software-rendered WebKitGTK". The QA app's `canvas-idle` panel measured
   `webglContexts` 4 of 4 under WSLg MiniBrowser — that engine has WebGL2.
   The mechanism is real and the panel forces the precondition
   artificially, but the severity should be read as latent, not routine.

3. **C19 is wider than recorded.** `HeadingScrollTracker.scrollToHeading:109`
   carries the same document-wide `getElementById` plus `contains` pair, so
   in a second viewer the minimap's *clicks* silently no-op too, not only
   its highlight. Both call sites need the fix.

4. **C23 has a sibling hole.** `DateTimeField.parseRaw` leaves its
   `datePart` unchecked, so `"2026 10:00"` commits 1 Jan 2026 10:00 despite
   a comment claiming to mirror `DateField`/`TimeField` strictness.

5. **C9, C11 and C16 need a `destructor` created, not a line changed.**
   Those classes declare none at all. ~~And C10.~~ **Corrected 2026-09-20 by
   `plans/destructor-teardown-coverage.md`, measured in jsdom: C10 needs only
   the one-line `dispose()`.** `TreeCellRenderer` adds the toggle with
   `addComponent`, so the *current* toggle is a registered child the base
   recursion already reaches — three swaps strand exactly two glyphs (N−1),
   and one toggle with no swap strands none.

6. **Item 2a was never within C32's reach.** C32's fix removes elements
   someone wrote `tabindex="-1"` onto; nothing writes `-1` onto a close
   button, and `Button`'s constructor writes an explicit `tabIndex(0)`
   (`Button.ts:779`, for `ToolBar`'s membership check). `RovingTabIndex.add`
   is the only writer of `-1`, and `TabBar.ts:1802` adds only the tab
   button.

## Two cross-cutting findings

### C6, C22 and C27 are one bug family

Each is an uninitialised or unguarded `NaN` sentinel escaping through a
`===` guard that cannot reject `NaN`, into a DOM write:

| | sentinel | getter | guard that fails | write |
|---|---|---|---|---|
| C22 | `_left`/`_top` (`Component.ts:601`) | `getX()` (`:4673`) | `positionUnchanged` (`LayoutManager.ts:587`) | `translate3d(NaNpx,NaNpx,0)`, every pass, forever |
| C27 | `_height` | `getHeight()` | — | `height: NaNpx` on first commit |
| C6 | caller-supplied `NaN` | — | `setLineHeight`'s `===` (`Text.ts:1185`) | a permanent `.Text.lhNaNpx` shared rule |

C22 is the worst of the three: once the size settles, `canFastPath` is true
on every pass, so every `ComboBox` caret takes a `setTranslate(NaN, NaN)`
and keeps `will-change: transform` pinned permanently. Wave 1's setter
guards did not cover it — the four `Number.isNaN` checks in `Component.ts`
suppress `left`/`top`/`width`/`height`, not `transform`.

They share one decision: whether the fix belongs in the accessors, in the
setters (refuse non-finite values), or at the layout seam (`canFastPath`
rejects a non-finite position). C6 is fixable narrowly at its call site
regardless.

**Settled by `plans/nan-sentinel-dom-writes.md` (2026-09-20): the seam and
the setters; not the accessors.** Two corrections it made to this section
while deciding. Only `getWidth()`/`getHeight()` carry a documented `0`
fallback — `getX()`/`getY()` say nothing about the unset case, so the
"documented fallback" reading applies to C27 alone. And the accessor route
is not merely wide but wrong: `getWidth()`/`getHeight()` feed
`sizeUnchanged`, so a `0` fallback would make a first `0×0` commit read as
unchanged and withhold the first `doLayout()` from every class that opts
into `canSkipUnchangedLayout`. The plan also found C6 has two doors
(`ComboBoxLabel` carries its own parallel `setLineHeight`) and a second
`NaN`-`transform` write site at `Component.replayGeometryStyles`.

### The dispose gates are blind to the bugs that hid from them

`tests/component/dispose-full-teardown.test.ts` and
`dispose-listener-teardown.test.ts` are shrink-only registries that derive
their expected class lists by scanning source at run time, precisely so they
cannot go stale. `tests/helpers/libraryClassScan.mjs` scans for two
patterns:

```
/^\s*protected destructor\(/                                  → teardown registry
/Event\.add(Listener|SubtreeListener|ViewportListener)\(\s*this\s*,/  → listener registry
```

**A class that owns disposable state but declares no destructor matches
neither**, so no coverage is ever expected of it. That is exactly how C9
(`TreeBody`), C10 (`TreeCell`), C11 (`AbstractCalendarDropdown`) and C16
(`ButtonGroup`) escaped. Meanwhile `Dock`, `TablePanel`, `TreeTablePanel`,
`Notification` and `Tooltip` sit in `UNCLAIMED_DESTRUCTOR_CLASSES` as
acknowledged debt — visible, but unfixed.

So the leak work has a shape beyond its instances: add a third scan pattern
for classes that hold a teardown closure or a non-child `Component` and
declare no destructor, and the next one fails the build instead of waiting
for a review campaign.

**Settled by `plans/destructor-teardown-coverage.md` (2026-09-20): the
pattern is `DragManager.make{DragSource,DropTarget}(`**, which matches five
classes and leaves a one-entry baseline. The candidates it rejected are
instructive — `.showOverlay(` matches three classes that **all already
declare a destructor**, so a gate built on it would have stayed green while
`TablePanel` leaked its spinner; `.removeComponent(this._…)` matches
sixteen, misses C8 and C14 entirely, and would seed a nine-entry baseline of
unrelated classes. The plan also draws the line the scan cannot cross: a
line can establish only whether a destructor *exists*, never whether it
*reaches* a member, so the scan picks the classes and the existing
construct/destroy balance assertion decides whether they are torn down.

## Tests that pin the current, wrong behaviour

Several fixes cannot land without changing a test that asserts today's
behaviour. These are deliberate contract changes and each plan must say so.
**Two rows below were wrong as first written and are corrected here** — the
plans checked them rather than inheriting them.

| Fix | Test | What it pins |
|---|---|---|
| C30's already-topmost early return | ~~`LayerManager.test.ts:177-194`~~ → `tests/overlay/LayerManager.test.ts:259-267`, `:297-334`, `:336-362`, `:364-392` | **Corrected**: the `:176-232` block keeps passing, because every test in it raises a layer that already has a peer above. What breaks is the same-band `setBand` no-op and three parentage tests that use "was `onZIndexChanged` called?" as a proxy assertion |
| C35's context guard | ~~`WebGLCanvas.test.ts:136-145`~~ → **23 tests**: 11 in `Canvas.test.ts`, 10 in `WebGLCanvas.test.ts`, 2 in `EffectiveVisibility.test.ts`, plus `packages/qa/tests/mount.test.ts` | **Corrected**: `shouldAnimate` is the shared base predicate, so `Canvas` is gated too — the slice report's "`WebGLCanvas` only" is wrong. The modelled sink returns a null context by design, so every animation test asserts the old contract. A `withStubContext` helper already exists in both files |
| C34's opt-out | `tests/component/input/Checkbox.test.ts:162-195` | the synthetic click on a programmatic `setSelected` — this one is the contract the default must keep |
| C23's strict parsing | `tests/component/input/DateField.test.ts:86` | the `2025-02-30` rollover, pinned as *documented* behaviour |

Everything else in the register is uncovered on its defective path, though
most have a neighbouring test file to extend.

## The typecheck question, resolved

`00-post-campaign-agenda.md` parked "30 errors from
`tsc -p packages/lib/tsconfig.json`, 0 from the gate" as possible rot. It is
stale config, verified both ways:

- **21 are `TS6133` unused locals in test files.** `tsconfig.test.json`
  sets `noUnusedLocals: false` and `noUnusedParameters: false`; forcing them
  back on reproduces exactly those 21 and nothing else. The gate was told
  not to look.
- **9 are timer-type mismatches.** `tsconfig.json` declares no `include`,
  so it compiles `build/` and the Vite configs too, pulling `@types/node`
  into the program; Node's `setTimeout` then returns `Timeout` where the DOM
  returns `number`. Confirmed by diffing `--listFilesOnly` between the two
  programs. `npm run typecheck` (`tsconfig.lib.json`) reports 0.

So the bare `tsc -p packages/lib/tsconfig.json` measures the wrong program.
It wants an `include` or `"types": []`, or removal from the agenda — not a
rot hunt.

## Found while planning and implementing, not in the register

Drafting and implementing the first four plans, and reviewing the result,
turned up seven things the campaign never recorded. All were measured, not
inferred.

**C39 — a pointer drag whose owner is disposed mid-gesture locks the whole
page, permanently.** `beginPointerDrag` (`core/PointerDrag.ts:59`) stamps
`ts-ui-dragging` and an inline drag cursor onto `<html>`, arming the
module-singleton rule `html.ts-ui-dragging > * { pointer-events: none }`
(`:47`) — which takes `<body>` and every `documentElement`-hosted overlay
out of hit testing for the gesture's duration. Only `endPointerDrag`
(`:73`) clears it, and it is reached solely from the drag-stop viewport
listener each site registers **against its own component**:
`WindowBorder.onDragStop`, `SplitGutter.onDragStop`, `Scrollbar:1125`,
`HeaderCell:657`. None of the four ends the drag from teardown, so when the
owning component is disposed mid-gesture, `Component.destructor`'s
`Event.purgeComponent` (`core/Component.ts:1170`) removes that listener and
the release never reaches `endPointerDrag`. `<html>` keeps the class and the
cursor for the life of the page: the application is unclickable behind a
frozen resize glyph, with no recovery short of a reload — and no way to
click anything that might clear it. The trigger found by the user is
`AbstractWindow`'s 150 ms close fade (`overlay/AbstractWindow.ts:1091`),
during which the window stays hit-testable: press a border strip mid-fade,
release after `finalize` runs, and it reproduces every time — which is why
it surfaces when several windows are closed in quick succession.
**Pre-existing**, verified offline with identical probe results on `master`
(`c83c5896`) and on the four-branch stack tip (`d982101e`). **Fixed by
`plans/pointer-drag-ends-on-dispose.md`, and the fix is confirmed in a real
engine: the user could no longer reproduce the lock (2026-09-20).** The fix is the
one the library already uses for this exact hazard in transitions: an
owner-keyed framework-internal registry in the style of
`core/PendingTransitions.ts`, ended from `Component.destructor` beside its
existing `cancelTransitions` call (`core/Component.ts:1296`), covering all
four drag sites at once. Neither dispose registry would ever have caught
this — `dispose-listener-teardown` asserts that dispose *purges* Event
registrations, which is the very step that strands the drag — so the fix
needs its own assertion: dispose with a drag armed must leave `<html>` free
of `ts-ui-dragging` and of an inline cursor.

**C38 — a store worker that dies *after* answering at least once still hangs
forever.** `store-worker-fail-safe` closes the dead-on-arrival case, not the
dies-later one. `StoreWorkerClient` arms its probe timer only while
`!workerProven`, and the first reply of any kind sets `workerProven`, so
nothing times any later request. A worker that boots, answers once, then
stops answering leaves its `sortFilter` promise unsettled, so
`applyViewOnWorker`'s `catch` never fires and `applyView()` never resolves —
the original symptom exactly: the table stays empty and `load` never fires.
~~Reachable because `filterBy` serialises custom filter predicates.~~
**That premise was wrong, and it was mine** — corrected 2026-09-20 while
planning the fix. No consumer function ever reaches the worker:
`filterBy(descriptor: FilterDescriptor)` takes a closed union of thirteen
data-only shapes with no function member, `filter(property, value)` is data
too, and a `sorterFn` is forced in-process by `hasCustomSorter()`. What
stays reachable is the engine killing or suspending the worker, and a
request the worker cannot deserialise — `StoreWorker.ts` sets no
`self.onmessageerror`. **A documentation defect falls out of this:**
`docs/concepts/performance.md`'s "Filter functions are serialised" warning
box and `docs/reference/troubleshooting.md`'s "Custom filter functions are
not transferable" bullet both describe passing predicates to `filterBy`,
which the signature does not permit. Both are corrected by the fix's plan. The one-shot probe was a
deliberate choice (the plan's Architecture Decisions: a genuinely long sort
must not be mistaken for a dead script), so the fix is a per-request
deadline generous enough not to punish a slow sort, not a change of design.
Found by the consolidating review, 2026-09-20.

**A blob object URL leaks on every blocked construction under a strict
CSP.** Vite's inline-worker shim does `createObjectURL(blob)` → `new
Worker(objURL)` → on failure `new Worker("data:…")`, and revokes the object
URL only from the worker's own `error` listener. Under a policy allowing
neither `blob:` nor `data:`, the URL is never revoked and both attempts emit
a violation — once per `applyView()` on every store over the threshold,
because `isAvailable()` calls `ensureWorker()`. The view is still built and
every event still fires, so this is noise and a bounded leak, not
incorrectness. The reviewer's suggested remedy — retiring the client when
construction throws — contradicts the shipped plan's Architecture Decisions,
which state the opposite as the design, so it needs its own small plan that
revisits that decision rather than an in-flight fix.

**C40 — `Checkbox.on("action")` both misses real clicks and invents fake
ones.** Found while planning C34, and verified by probe. `on("action")` is
`Event.addListener(this, "click", …)` — a *direct-target* listener on the
checkbox root — while a real user click lands on the inner `_box`, and
`Event`'s base dispatcher matches direct listeners by exact target id. So a
genuine click never delivers `"action"` at all; the synthetic click from
`setSelected` is its only delivery path. The same binding has a second face:
a click in the root's *dead area*, the gap between box and label, does reach
the direct listener and fires `"action"` with no state change. `RadioButton`
is the correct sibling here — its `"action"` is `Event.addListener(this,
"change", …)`, fired from `activate()`, delivering 1 per user activation, 0
on a programmatic write and 0 on a dead-area click. Fixing this changes a
documented event contract on a public component far more than C34's opt-out
does, so `plans/implemented/boolean-input-action-fanout.md` deliberately
scopes it out and records it here instead. Still open after that plan
shipped: its `fireAction` opt-out changes nothing about how `"action"` is
delivered.

**C25 is not hypothetical.** Planning it found the QA app's own `windows`
panel already builds an asymmetric window whose east strip is pushed outside
the frame, and that the same wrong-side assumption appears in two further
locals placing the east and south bands — three corrections, not the one the
register named.

**C37 — `afterTransition`'s own `cancel()` leaks the listener it armed.**
Exactly C15's shape, in the same file, in the method the C15 fix was going
to cite as its precedent: `Animation.ts:314`'s `afterTransition` removes its
`transitionend` on the *fired* path but not on the cancelled one, so a
fast-re-toggled `Accordion` accumulates listeners on its section wrapper.
`tests/core/Animation.test.ts:344` currently pins the leak as intended
behaviour. It was left out of
`plans/listener-and-rule-removal-paths.md` on the grounds that C15's fix is
safe only through a guarantee `afterTransition` does not share.
~~It has no such bound.~~ **That was wrong, and it was mine** — corrected
2026-09-20 while planning the fix. `afterTransition`'s wait element is
`config.component.getElement()`, which `render()` tracks in `_ownedHandles`,
the very array `Component.destructor` iterates to cancel before releasing.
So the guarantee *does* transfer and the same mechanism works, provided the
`PendingTransitions` registration lands with the listener removal — a bare
removal without it would indeed be unsound. Registering also fixes a latent
hazard already present: `Border.detach`/`Split.detach` call
`transition.cancel()` on the dispose path *after* the pane's handle is
released, and the registration makes the pane's own destructor cancel first,
so that late call becomes a no-op. Measured: twenty interrupted `Accordion`
toggles add twenty `transitionend` listeners to one handle and remove none —
one dead listener per toggle interrupted within 240 ms.

**Fixed by `plans/after-transition-cancel-teardown.md` (2026-09-20): the
registry guarantee does transfer — the wait's element is the component's own
handle, so `Component.destructor` cancels before releasing it.**

**A documentation error:** `docs/components/ButtonGroup.md` documents a
`getSelected()` method the class does not have. Pre-existing and unrelated
to any plan, so left alone under the surgical-changes rule — recorded here
so it is not lost.

## Follow-ups the phase 2 implementation surfaced

Recorded 2026-09-21, from implementing the eleven plans. None blocked its
branch; each was left deliberately rather than missed.

**Adjacent to fixes that landed:**

- **The table's `Date`/`DateTime` cell editors keep the old lenient parse.** A
  `DateField` now rejects `2025-02-30` while the equivalent table cell still
  commits 2 March. `tooltip-picker-and-serialization-fixes` called them "not
  affected", true about code sharing but not about the defect.
- **`Tab`'s `activeIndex` is not remapped across the transient filter** — the
  same index-shift class C29 cured one branch over.
- **`DateField.formatValue` does not zero-pad the year**, so a year below 1000
  formats to a spelling the new strict parser rejects.
- **`Slider.setValue` fans out unconditionally with no opt-out**, the same
  shape C34 gave `Checkbox` an opt-out for. Belongs beside C40.
- **`MiscPanel.ts:781`'s demo comment** still carries the stale "never touches
  a pending edit" claim the doc-gaps branch corrected everywhere else.

**Test-suite health, all pre-existing and confirmed on `master`:**

- `textRange(...).getClientRects is not a function` prints on **every** master
  run as stderr noise without failing the suite.
- `DOM handle N is not registered (released or never minted)` surfaces
  intermittently as an unhandled rejection. Together these made one full-suite
  run of the phase 3 tip report a single failure that does not reproduce.
- **`packages/docs` has no Vite alias to the local `packages/lib`**, so from a
  worktree its suite resolves the *main* checkout's `dist` — docs tests in a
  worktree do not exercise the worktree's library at all. Found while
  verifying `body-lazy-singleton`, which bridged it by hand and removed the
  bridge afterwards.

**Unmeasured cost:** `canvas-idle-loops` leaves one `isEffectivelyVisible()`
ancestor walk per child re-attach, on a path that runs per frame during a
column-window slide. The plan's original one-term guard would have queued a
full reconcile there; the two-term guard reduces it to the walk. The
campaign's own measurement that 1,929 size-hint calls per frame cost nothing
suggests this is immaterial, but it is not measured. `table-wide` with
`hwheel` is the witness.

**A consumer-visible consequence of `body-lazy-singleton`:** the library's own
`<style>` element is created at its first stylesheet write, which importing
`core` used to perform. A `core` importer's own CSS can now precede the
library's, flipping which side wins ties at equal specificity. Recorded in the
changelog, and the neighbouring `no-dom-access-at-import` entry's exemption
for `core` importers was corrected because this makes it false.

## Proposed plan grouping

Four tiers, ten plans. Tiers A and B need no decisions and are the first
batch.

| Tier | Plan | Covers | Shown by |
|---|---|---|---|
| A | store worker fails safe | item 5 | `table-rows` |
| A | NaN escapes into the DOM | C6, C22, C27 | `form-flat`, `form-nested`, `markdown-doc` |
| B | destructors that never run or never reach | C8, C9, C10, C11, C14, plus the scan-pattern gate | `treetable-rows`, `windows` |
| B | listeners and rules with no removal path | C7, C15, C16 | `code-document` |
| C | Markdown instance scoping and hidden measurement | C18, C19 | `markdown-doc` |
| C | chrome measured wrong | C24, C25, C26 | `menus`, `windows` |
| C | tooltip ownership, picker strictness, Split transients | C21, C23, C29 | `menus`, `form-flat` |
| D | LayerManager z-allocation and toast restack | C30, C31, C33 | `windows` |
| D | canvas idle loops | C35, C36 | `canvas-idle` |
| D | Checkbox/Radio action fan-out opt-out | C34 | `form-flat` |

C36 is the one entry whose blast radius exceeds its bug: making `wireChild`
reconcile effective visibility gives every `onEffectiveVisibilityChange`
override an extra edge — `Glyph`, `Markdown`, `CodeEditor`, `Panel` and
`AbstractCanvasSurface` — each of which must be re-checked for idempotence.
Split it out if the wave wants a narrow diff.

## Decisions taken 2026-09-20

The three items that needed the user's judgement rather than an
investigation. All three are now settled, so all three are plannable; a plan
for any of them cites this section rather than re-opening the question.

- **2a — Delete closes the focused tab.** The close buttons join the roving
  group, which removes one stray Tab stop per button, and
  `TabBar.onToolbarKeyDown` gains Delete alongside ArrowLeft/ArrowRight.
  That is what WAI-ARIA's tabs-with-delete pattern expects, and it keeps the
  keyboard route direct rather than leaving it to the overflow menu (which
  already emits `tabclose` and stays as it is).
- **2b — the Tab trap becomes owner-aware.** `Dialog`'s trap stands down
  whenever focus sits inside a descendant carrying `TAB_KEY_OWNER_ATTR`,
  rather than carving out a hard-coded list of element kinds the way
  `onEnter` does. This honours the flag `CodeEditor`, `MarkdownEditor` and
  `Table` already set for themselves, and covers any component that sets it
  later. The trap must still wrap at a genuine boundary when the focused
  surface does not claim Tab.
- **4 — `Body` may go lazy, and both consequences are accepted.** The font
  download starts at the first `Body.init()`/`getInstance()` instead of at
  module import, and the constructor applies `ModernTheme` only when no
  theme has been set, so an app that chooses a theme before touching `Body`
  keeps it. `Tooltip.getInstance` is the precedent to follow. Two records
  change with it: `'./core'` comes out of `KNOWN_IMPORT_TIME_DOM` in
  `packages/lib/tests/unit/import-without-dom.test.ts`, and
  `packages/lib/docs/components/Body.md:81` stops documenting the eagerness
  as a guarantee. The `fonts-ready` test that pins "starts the download when
  the rules are installed, not at first paint" is pinning the behaviour this
  decision changes, so it is rewritten rather than kept.
