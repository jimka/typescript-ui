# Test Coverage for the Container Component Subsystem — Implementation Plan

## Overview

Add Vitest unit tests for the container component subsystem under
[`src/typescript/lib/component/container/`](../src/typescript/lib/component/container/)
(~19 files). These are DOM-heavy stateful components, unlike the pure-logic
data/primitive/layout work already covered. The goal is **realistic triage**:
spend the test budget on the cheap, high-value state and geometry logic that can
be asserted offline, and explicitly scope out the parts that only pay off under a
real browser (drag interactions, momentum, hover/repeat timers, native legend
measurement).

Tests follow the existing offline pattern: the `// @vitest-environment jsdom`
pragma, `installTestDOM(CONFIG)` from
[`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts), `afterEach(() => DOM.reset())`,
and the `~/...` import alias — exactly as
[`tests/component/layout/VBox.test.ts`](../tests/component/layout/VBox.test.ts)
and the merged layout suite do. New files live under a new
`tests/component/container/` directory, one file per target component.

This plan is **test-authoring only**. It does not modify any `src/` file. Where a
target's contract and its current output diverge, the plan's methodology
(below) is to surface the divergence with `it.fails` plus a comment — never to
silently encode whatever the code happens to emit.

---

## Methodology — Assert the Contract, Not the Output

This is the load-bearing rule for the whole suite. Apply it per assertion:

1. **Derive the expectation from the documented contract** — the JSDoc on the
   method, the class doc, the named constant, the relational invariant — *before*
   looking at runtime output. Write the assertion against that expectation.
2. **On divergence, STOP.** Do not edit the assertion to match the code. Investigate
   whether the bug is in the *expectation* (you misread the contract) or in the
   *code* (the implementation violates its own doc).
   - If the expectation was wrong, fix the expectation and note why in a comment.
   - If the code looks wrong, keep the contract-derived assertion but mark the test
     `it.fails(...)` with a comment naming the suspected bug and the file/line. This
     records the divergence as a standing signal without breaking the suite or
     silently conforming. (`it.fails` is currently unused in the repo — these will
     be the first occurrences; that is intended.)
3. **Never golden-snapshot DOM geometry.** Do not assert "thumb is at 137px"
   against a recorded number. Assert **structural and relational invariants**:
   visible index ranges, monotonicity, clamping bounds, expanded/collapsed flags,
   child ordering, "thumb never exceeds track length", "max scroll matches the
   effective viewport". These survive refactors; pixel snapshots do not.

Each per-target section below lists the *expected* behaviours in contract terms.
When authoring, if any expectation fails, apply step 2 rather than rewriting it.

---

## Architecture Decisions

### Test offline through the modelled DOM seam, never a real browser

Every target is exercised through `installTestDOM(CONFIG)` — the recording sink +
modelled source pair. Geometry is answered from committed component state (the
validated geometry oracle), so `getWidth`/`getHeight`/`getX`/`getY` reflect what
the test set, with no `getBoundingClientRect`. This matches the entire existing
`tests/component/layout/` suite. Tests that need committed sizes set them
explicitly (`setWidth`/`setHeight`) before asserting, exactly as the layout tests
size their hosts.

### Construct via the barrel callable exports

The container barrel
([`index.ts`](../src/typescript/lib/component/container/index.ts)) re-exports the
`callable()`-wrapped classes (e.g. `Scrollbar`, `TabBar`, `CollapseButton`), so
tests import from `~/component/container/<Name>` and use `new <Name>(...)`
normally. The internal `_<Name>` exports are not needed. `VirtualScroller` is a
plain class (not `callable`, not a `Component`) and is imported the same way.

### Triage tiers — spend budget where it pays

- **Tier 1 (near-pure state/geometry math — primary budget):** `VirtualScroller`,
  `Scrollbar`, `AccordionPanel` (via the untested `Accordion` manager state),
  `FieldSet`, `TabBar` (entry-tracking only).
- **Tier 2 (small but real state):** `CollapseButton`, `AccordionIndicator`,
  `Spacer`, `StatusBar`, `FormFieldSet`, `TabPanel` (thin-wrapper wiring).
- **Tier 3 (honestly scoped out / minimal):** `FieldSet` legend measurement under
  a real browser, full drag interactions (`SplitGutter`, `WindowBorder`,
  `Scrollbar` thumb drag, `VirtualScroller` momentum/wheel), hover/hold-repeat
  timers, and pure presentational leaves (`MenuSeparator`, `Legend`,
  `DialogBackdrop`, `WindowHeader`, `AccordionHeader`, `MenuItem` rendering). These
  get a one-line construction smoke test at most, or are skipped with a reason.

### `Accordion` manager state is reached through `AccordionPanel`

The section open/close state lives in the `Accordion` *layout manager*
([`Accordion.ts:740`](../src/typescript/lib/layout/Accordion.ts#L740)), which has
**no** existing test (`grep -rln Accordion tests/` is empty). `AccordionPanel`
([`AccordionPanel.ts`](../src/typescript/lib/component/container/AccordionPanel.ts))
is the public convenience surface that owns one, exposed via `getAccordion()`.
Testing section state through `AccordionPanel` covers both the wrapper's
construction wiring (`sections`, `singleOpen`, `initiallyOpen`, `onSectionToggle`)
and the manager's core state logic in one suite. This is the highest-value gap in
the subsystem.

---

## Per-Target Test Specifications

### Tier 1

#### `VirtualScroller` — `tests/component/container/VirtualScroller.test.ts`

The strongest, nearest-to-pure target. A plain helper owning scroll position with
explicit clamp math. Construct with a `Container` owner whose width/height are set,
plus a no-op `onScroll`. Source:
[`VirtualScroller.ts`](../src/typescript/lib/component/container/VirtualScroller.ts).

Expected behaviours (contract-derived):

- **`setScrollY` / `setScrollX` clamp to `[0, max]`** where
  `max = contentSize - effectiveViewport`. After `clampToContent(w, h)` /
  `layoutScrollbars(w, h)` establishes content size, a `setScrollY(huge)` lands at
  exactly `max(0, contentHeight - effectiveViewportH)`; `setScrollY(-50)` lands at
  `0`. ([`setScrollY` doc, L179](../src/typescript/lib/component/container/VirtualScroller.ts#L179)).
- **No-op when unchanged.** `setScrollY` to the current value fires no `onScroll`
  (spy the callback; assert call count). The "Triggers ... if the position changed"
  clause is the contract.
- **`getScrollY`/`getScrollX` start at 0** on a fresh scroller.
- **`computeScrollbarVisibility` two-pass mutual dependency** (assert via observable
  effects of `layoutScrollbars`, since the method is private): with content taller
  than the owner but narrower than the owner's width *minus* the vertical track
  width, the horizontal bar still becomes visible because the vertical bar's
  reservation shrinks the effective width past the content width. Assert the
  *effective* max-scroll consequence: after `layoutScrollbars`, `setScrollX(huge)`
  tops out at `contentWidth - (ownerWidth - trackWidth)`, proving the cross-axis
  reservation was subtracted. Use `getTrackWidth()` (12) from a `Scrollbar` for the
  expected number rather than hard-coding.
- **`clampToContent` pulls an out-of-range position back in** without firing
  `onScroll` (its doc states "Does not fire `onScroll`"). Set a large scroll, then
  `clampToContent` with smaller content; assert position dropped to the new max and
  the callback was not invoked.
- **Content fits → max scroll is 0.** When `contentHeight <= ownerHeight`,
  `setScrollY(100)` stays at 0.

Scope out (Tier 3): wheel easing (`onWheel`/`SmoothScroller`), touch drag, and
fling momentum — all driven by RAF/`performance.now()` and real pointer events.

#### `Scrollbar` — `tests/component/container/Scrollbar.test.ts`

Rich pure thumb math plus visibility. Construct `new Scrollbar("vertical")`, set a
height, call `setMetrics(viewport, content, scroll)`. Source:
[`Scrollbar.ts`](../src/typescript/lib/component/container/Scrollbar.ts).

Expected behaviours:

- **Visibility tracks overflow.** `setMetrics` with `content <= viewport` calls
  `setDisplayed(false)`; with `content > viewport`, `setDisplayed(true)`. Assert via
  `isDisplayed()` (or whatever the public displayed-state getter is — verify on
  Component; if none, assert the early-return contract another way, e.g. thumb size
  stays at its `-1` sentinel-derived initial when not overflowing).
- **Thumb size = `max(THUMB_MIN_SIZE, floor(trackLength * viewport/content))`.**
  With arrows **disabled** (`new Scrollbar("vertical", { arrowsEnabled: false })`),
  `trackLength === height`. Pick numbers where the proportional size clearly exceeds
  the 30px floor, assert the floored proportional value; then a second case where it
  would fall below 30, assert it clamps to 30. Read the expected `THUMB_MIN_SIZE`
  relation from the contract, not a magic literal in the test name.
- **Thumb position is proportional and never overflows the track.** At
  `scroll === 0`, thumb pos is the track origin (0 with arrows off); at
  `scroll === maxScroll`, thumb pos `=== trackLength - thumbSize` (thumb bottom flush
  with track end). Assert `thumbPos + thumbSize <= trackLength` as an invariant
  across a sweep of scroll values — a relational check, not a golden number.
- **Arrows shift the track origin.** With `arrowsEnabled: true`, `getTrackLength()`
  shrinks by `2 * TRACK_WIDTH` and the thumb's start offset is `TRACK_WIDTH`. Assert
  the thumb position at `scroll === 0` differs from the arrows-off case by exactly
  `TRACK_WIDTH` (via the thumb component's `getY`). These are private (`getTrackLength`,
  `getTrackOrigin`) — assert through the thumb child's committed `getY`/`getHeight`.
- **`onArrowTick` clamps and only emits on change** (reach it via the public
  `scroll` listener + a simulated tick — or, if the tick path needs a real DOM event,
  scope to Tier 3 and instead unit-test the equivalent step math by driving
  `setMetrics` at the boundary). Prefer asserting the `scroll` emit through `on`.
- **Horizontal orientation mirrors vertical** on the cross axis (width vs height,
  `setX` vs `setY`): one parallel case to lock the axis-swap.

Scope out (Tier 3): thumb **drag** (`_onDragStart`/`_onDragMove`, viewport
listeners, `document.body` pointer-events), track-click paging (needs `offsetY` /
`getViewportRect`), and the hold-repeat arrow timer cadence.

#### `AccordionPanel` (+ `Accordion` state) — `tests/component/container/AccordionPanel.test.ts`

Covers the untested `Accordion` section-state engine through the public panel.
Sources:
[`AccordionPanel.ts`](../src/typescript/lib/component/container/AccordionPanel.ts),
[`Accordion.ts:740`](../src/typescript/lib/layout/Accordion.ts#L740).

Expected behaviours:

- **`sections` config maps 1:1 to sections, `initiallyOpen` honoured.** Build a panel
  with three sections, the second `initiallyOpen: true`. Assert
  `getAccordion().isSectionOpen(0) === false`, `isSectionOpen(1) === true`,
  `isSectionOpen(2) === false`.
- **`openSection` / `closeSection` flip the flag** and are idempotent-safe; an
  out-of-range index is a no-op (the guard at
  [`Accordion.ts:741`](../src/typescript/lib/layout/Accordion.ts#L741)). Assert
  `isSectionOpen` before/after and that `openSection(99)` does not throw or change
  state.
- **`singleOpen` enforces mutual exclusion.** With `singleOpen: true`, opening
  section 2 while section 0 is open closes section 0 — assert `isSectionOpen(0)`
  becomes false and `isSectionOpen(2)` true after `openSection(2)`.
- **`expandAll` under `singleOpen` opens only section 0** (the documented
  deterministic choice, [`Accordion.ts:792`](../src/typescript/lib/layout/Accordion.ts#L792)):
  assert exactly one open section and it is index 0. Without `singleOpen`,
  `expandAll` opens every section.
- **`collapseAll` closes every section.**
- **`sectiontoggle` event fires with `(index, open)`.** Register via
  `onSectionToggle` (constructor) and via `getAccordion().on(...)`; assert the
  payload on an open and a close, and that single-open mode emits a *close* for the
  previously-open section *and* an *open* for the new one.

#### `FieldSet` — `tests/component/container/FieldSet.test.ts`

Source:
[`FieldSet.ts`](../src/typescript/lib/component/container/FieldSet.ts).

Expected behaviours:

- **`getTitle` round-trips the constructor title and `setTitle`.**
- **`getPerimiterSize().top` includes the legend clearance.** Under the modelled
  source, `legendClearance()` returns the `LEGEND_CLEARANCE_FALLBACK` constant (16),
  because `DOM.source.isModelled()` short-circuits the native measurement
  ([`FieldSet.ts:203`](../src/typescript/lib/component/container/FieldSet.ts#L203)).
  Assert `getPerimiterSize().top === superTop + 16`, where `superTop` is the base
  perimeter top derived from the default insets (top inset 5). Compute the expected
  base from the contract, not from a captured number.
- **`getMinSize` augments width by the legend's min width plus left/right chrome.**
  With a legend whose min width is known, assert the returned width is
  `max(baseMin.width, legendMin.width + perim.left + perim.right)` and height is
  `baseMin.height`. If the legend's min is null offline, assert the documented
  fallback branch (returns base min unchanged).
- **Default subclass options applied:** `tag === "fieldset"` is consumed by render;
  assert the rendered element's tag via the recording sink's handle stub, or assert
  the default `minSize`/`preferredSize` (100×100 / 200×200) surface through the
  getters.

Scope out (Tier 3): the real-browser legend `offsetHeight` measurement path and
`clampLegendWidth` ellipsis (needs a committed width + native legend box).

#### `TabBar` — `tests/component/container/TabBar.test.ts`

Large DOM component; test **only the entry-tracking state machine**, which is pure
list logic over `_entries` / `_activeId`. Entries are created with
`createBarEntry(id, name, constraints?)`
([`TabBar.ts:1422`](../src/typescript/lib/component/container/TabBar.ts#L1422)).
Construction builds `ToggleButton`s, so `installTestDOM` is required.

Expected behaviours:

- **First entry becomes active; subsequent entries join inactive.**
  ([`TabBar.ts:1544`](../src/typescript/lib/component/container/TabBar.ts#L1544)).
  After three `createBarEntry` calls, `getActiveEntryId()` is the first id.
- **`getEntryIds` returns ids in strip order** (a copy — mutating the returned array
  must not affect the strip).
- **`setActiveEntry(id)` updates `getActiveEntryId`**; unknown id is a no-op.
- **`moveBarEntry` reorders with clamping.** Move the first entry to a huge index →
  it lands last (`dest` clamped to `length - 1`,
  [`TabBar.ts:1621`](../src/typescript/lib/component/container/TabBar.ts#L1621));
  `dest === from` is a no-op; assert `getEntryIds` order after each.
- **`removeBarEntry` drops the entry and resets active to `null` when the removed
  entry was active** ([`TabBar.ts:1597`](../src/typescript/lib/component/container/TabBar.ts#L1597)).
  Removing a non-active entry leaves `getActiveEntryId` unchanged. Removing an
  unknown id is a no-op.
- **`isEntryCloseable` / `getEntryName`** reflect the constraints / name, and return
  the documented defaults (`false` / `""`) for an unknown id.

Scope out (Tier 3): all strip geometry/layout (placement, width modes, scrolling,
overflow), reorder *drag*, context menu, and every setter that only mutates style
(`setSide`, `setWidthMode`, `setCompact`, …) beyond a single round-trip smoke test
for one representative getter/setter pair.

### Tier 2

#### `CollapseButton` — `tests/component/container/CollapseButton.test.ts`

Source:
[`CollapseButton.ts`](../src/typescript/lib/component/container/CollapseButton.ts).

- **`getDirection` defaults to `"east"`** and round-trips `setDirection` and the
  `direction` option.
- **`collapse` event fires on double-click** — drive `onDoubleClick` via the public
  `dblclick` listener path if reachable offline; otherwise assert via the `on`
  registration + a direct dispatch through `Event`. The contract is "double-click,
  never single click", so a single `click` must **not** emit.
- **`setStripMode(true/false)`** does not throw and is chainable; the width write is
  a CSS-rule side effect (assert no-throw + `this` return, not the pixel value).

#### `AccordionIndicator` — `tests/component/container/AccordionIndicator.test.ts`

Source:
[`AccordionIndicator.ts`](../src/typescript/lib/component/container/AccordionIndicator.ts).

- **`getExpanded` defaults false; `setExpanded`/`clearExpanded` round-trip.**
- **`getCharacter` defaults to the module `DEFAULT_CHEVRON`** and round-trips
  `setCharacter`.
- **`render` writes the chevron text and applies `.expanded` when expanded at first
  paint** ([`AccordionIndicator.ts:201`](../src/typescript/lib/component/container/AccordionIndicator.ts#L201)) —
  assert via the recording sink (text content / class list on the minted handle) if
  the harness exposes it; otherwise assert the `getExpanded` state pre-render and a
  no-throw render.

#### `Spacer` — `tests/component/container/Spacer.test.ts`

Source: [`Spacer.ts`](../src/typescript/lib/component/container/Spacer.ts).

- **`isFlex` / `setFlex` and `getFlexWeight` / `setFlexWeight` round-trip** with their
  documented defaults. Verify the default-weight value against the source constant,
  not a guessed number.

#### `StatusBar` — `tests/component/container/StatusBar.test.ts`

Source: [`StatusBar.ts`](../src/typescript/lib/component/container/StatusBar.ts).

- **`getMessage` / `setMessage` round-trip;** `getDefaultMessage` / `setDefaultMessage`
  round-trip.
- **`setMessage(text)` with no timeout shows `text`; the default message is the
  fallback** — assert `getMessage` reflects the set text, and that clearing
  (whatever the documented reset is) restores the default. If `setMessage` uses a
  `timeoutMs` via `setTimeout` to revert, test the revert with Vitest fake timers
  (`vi.useFakeTimers()` / `vi.advanceTimersByTime`) and assert the message returns to
  the default after the timeout — a deterministic timer test, not a real wait.

#### `FormFieldSet` — `tests/component/container/FormFieldSet.test.ts`

Source:
[`FormFieldSet.ts`](../src/typescript/lib/component/container/FormFieldSet.ts).

- **`getColumns` reflects the configured/default column count.**
- **`addField` / `addRow` / `addFullWidthRow` are chainable and add the expected
  child structure** — assert child count / ordering via the container's component
  list, not pixel geometry. (`FormFieldSet` extends `FieldSet`, so its legend
  behaviour is already covered there; do not duplicate.)

#### `TabPanel` — `tests/component/container/TabPanel.test.ts`

Source: [`TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts).

Thin wrapper over the `Tab` manager (already tested at
`tests/component/layout/Tab.test.ts`). Test the **wiring**, not the manager:

- **`getTab()` returns a `Tab` instance** and the constructor `tabs` config maps 1:1
  to `addTab` calls (assert child count / the manager sees the tabs).
- **`onTabClose` is registered** on the wrapped manager's `tabclose` event.
- **`addTab` / `addLazyTab` are chainable** and forward `closeable` / `glyph`
  constraints. Do not re-test tab activation geometry — that's the layout suite's job.

### Tier 3 — Honestly scoped out (construction smoke only or skipped)

For each, a single `it('constructs without throwing', ...)` under `installTestDOM`
is the entire coverage, with a comment naming why deeper testing needs a real
browser. Do **not** invent behavioural assertions for these:

- **`MenuSeparator`, `Legend`, `DialogBackdrop`** — presentational leaves; no state
  worth asserting beyond construction.
- **`WindowHeader`, `AccordionHeader`, `MenuItem`** — composite chrome whose logic is
  drag/menu/baseline-measurement bound; construction smoke only. (`MenuItem` has
  `isSeparator` / `isEnabled` / `getBaseline` — include cheap round-trips for the two
  boolean getters if they are pure; skip `getBaseline` which needs native metrics.)
- **`SplitGutter`, `WindowBorder`** — entirely drag-resize interaction; skip with a
  comment (a construction smoke test at most). Their `Direction` enum and any pure
  direction-mapping helper may get a trivial value assertion if one exists.

---

## Ordered Implementation Steps

1. Create `tests/component/container/` and add a shared `CONFIG` literal (copy the
   one from `VBox.test.ts`: `rootMountOffset`, `viewport`, `scrollBarWidth: 15`,
   `fontMetrics`, `themeVars: {}`). Each file imports `fontMetrics` from
   `../../dom/font-metrics.test-font.json` and `installTestDOM` from `../../dom/TestDOM`.
2. **Tier 1 first** (highest value): `VirtualScroller.test.ts`, `Scrollbar.test.ts`,
   `AccordionPanel.test.ts`, `FieldSet.test.ts`, `TabBar.test.ts`. Author each against
   the contract; apply the Methodology step 2 on any divergence.
3. **Tier 2:** `CollapseButton.test.ts`, `AccordionIndicator.test.ts`, `Spacer.test.ts`,
   `StatusBar.test.ts`, `FormFieldSet.test.ts`, `TabPanel.test.ts`.
4. **Tier 3:** one construction-smoke file (or per-component files) for the scoped-out
   leaves, each with a why-skipped comment.
5. Run `npm test` (`vitest run`). All `it(...)` pass; any genuine contract violations
   are recorded as `it.fails(...)` with comments — verify each `it.fails` actually
   fails (Vitest errors if an `it.fails` unexpectedly passes, which would mean the bug
   was a misread expectation — fix it back to `it`).
6. Regression check: `grep -rn "it.skip\|it.fails" tests/component/container/` — every
   match has an adjacent explanatory comment.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Create | `tests/component/container/VirtualScroller.test.ts` |
| Create | `tests/component/container/Scrollbar.test.ts` |
| Create | `tests/component/container/AccordionPanel.test.ts` |
| Create | `tests/component/container/FieldSet.test.ts` |
| Create | `tests/component/container/TabBar.test.ts` |
| Create | `tests/component/container/CollapseButton.test.ts` |
| Create | `tests/component/container/AccordionIndicator.test.ts` |
| Create | `tests/component/container/Spacer.test.ts` |
| Create | `tests/component/container/StatusBar.test.ts` |
| Create | `tests/component/container/FormFieldSet.test.ts` |
| Create | `tests/component/container/TabPanel.test.ts` |
| Create | `tests/component/container/leaves.smoke.test.ts` (MenuSeparator, Legend, DialogBackdrop, WindowHeader, AccordionHeader, MenuItem, SplitGutter, WindowBorder construction smoke) |

No `src/` files are modified. (If Methodology step 2 finds a genuine code bug, it is
recorded as an `it.fails` in the test, **not** fixed here — a fix is a separate plan.)

---

## Verification

- `npm test` — the full Vitest run is green; new `it.fails` entries fail as intended
  (Vitest reports an error if any `it.fails` passes).
- `grep -rn "describe(" tests/component/container/` — one suite per target file.
- Spot-check that no test hard-codes a pixel geometry golden: grep the new files for
  numeric `toBe(` against geometry and confirm each traces to a contract constant
  (e.g. `THUMB_MIN_SIZE`, `TRACK_WIDTH`, `LEGEND_CLEARANCE_FALLBACK`) or a relational
  invariant, not a captured runtime number.
- No `src/` diff: `git status --short src/` is empty.

---

## Potential Challenges

- **Private geometry methods** (`Scrollbar.getTrackLength`/`getTrackOrigin`,
  `VirtualScroller.computeScrollbarVisibility`): assert through observable effects
  (committed thumb child `getX`/`getY`/`getWidth`/`getHeight`, effective max-scroll
  via `setScroll*` boundary behaviour) rather than calling the private method or
  reaching into private fields.
- **`setDisplayed` getter**: confirm the public read-back name on `Component`
  (`isDisplayed()` or similar) before asserting Scrollbar visibility; if there is no
  public getter, assert the early-return contract another way (thumb metrics unchanged
  when content fits).
- **Event-driven paths** (`CollapseButton` dblclick, `Scrollbar` arrow tick,
  `TabBar` close): verify offline event dispatch through `Event` works under the
  modelled DOM before relying on it; if a path needs a real pointer event, downgrade
  that assertion to Tier 3 rather than faking it unconvincingly.
- **Timer-based `StatusBar` revert**: use Vitest fake timers; never a real delay.
- **`it.fails` is new to the repo**: confirm the installed Vitest version supports it
  (it does in v4) and that an unexpectedly-passing `it.fails` is treated as a failure
  so a misread expectation can't hide.

---

## Critical Files

- [`tests/component/layout/VBox.test.ts`](../tests/component/layout/VBox.test.ts) —
  canonical `installTestDOM` + `afterEach(DOM.reset)` + host-Container pattern to copy.
- [`tests/component/Component.test.ts`](../tests/component/Component.test.ts) —
  simplest setter/getter assertion style.
- [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) — `installTestDOM`,
  `ModelledDOMConfig`, the handle-stub seam (what a recorded write exposes to a read).
- [`src/typescript/lib/component/container/VirtualScroller.ts`](../src/typescript/lib/component/container/VirtualScroller.ts),
  [`Scrollbar.ts`](../src/typescript/lib/component/container/Scrollbar.ts),
  [`FieldSet.ts`](../src/typescript/lib/component/container/FieldSet.ts),
  [`TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) — the Tier 1
  contracts.
- [`src/typescript/lib/layout/Accordion.ts`](../src/typescript/lib/layout/Accordion.ts) —
  the untested section-state engine reached through `AccordionPanel`.
- [`src/typescript/lib/component/container/index.ts`](../src/typescript/lib/component/container/index.ts) —
  the callable export names tests import.

---

## Non-Goals

- **No `src/` changes.** Bugs surfaced by the contract-first method are recorded as
  `it.fails`, not fixed here (a fix is a separate plan).
- **No drag / pointer-interaction coverage** (`SplitGutter`, `WindowBorder`,
  `Scrollbar` thumb drag, track-click paging, `TabBar` reorder drag). These need real
  pointer geometry and a browser; offline tests would be theatre.
- **No momentum / RAF / wheel-easing coverage** for `VirtualScroller` — timing- and
  `performance.now()`-bound.
- **No golden DOM-geometry snapshots.** Structural/relational invariants only.
- **No re-testing of the `Tab` manager through `TabPanel`** — already covered by
  `tests/component/layout/Tab.test.ts`; `TabPanel` tests assert wiring only.
- **No CSS/theme-token value assertions** — style writes are side effects, asserted as
  no-throw/chainable at most.
