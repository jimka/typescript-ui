# Test coverage for the display, button, and menubar leaf widgets — Implementation Plan

## Overview

This plan adds **Vitest unit tests** for the DOM-bearing leaf widgets under three
sibling directories: `src/typescript/lib/component/display/`,
`.../button/`, and `.../menubar/`. Unlike the pure-logic layout/binding suites
already merged, these components build inner DOM, wire child components, and
maintain visual/interaction state. The job here is **triage, not exhaustive
coverage**: assert the state and computation logic that is checkable without a
real browser, and explicitly skip what is only meaningful under live layout or
paint.

Tests live alongside the existing component suites at
[tests/component/](../tests/component/) in three new files mirroring the source
layout: `tests/component/display/`, `tests/component/button/`,
`tests/component/menubar/`. Every file uses the `// @vitest-environment jsdom`
pragma (matching [Component.test.ts:1](../tests/component/Component.test.ts#L1))
and the `~/...` import alias. Tests that exercise a setter touching the DOM seam
install the offline harness via `installTestDOM(...)` from
[tests/dom/TestDOM.ts:620](../tests/dom/TestDOM.ts#L620) and tear it down with
`DOM.reset()` in `afterEach` (see
[tests/dom/geometry.test.ts:8](../tests/dom/geometry.test.ts#L8)).

This plan creates **only test files**. No source code changes.

---

## Architecture Decisions

### Methodology — assert the contract, surface divergence with `it.fails`

**This is the load-bearing rule of the whole plan.** Each test asserts the
*expected* behaviour derived from the component's documented contract (JSDoc,
method names, option semantics) — **not** whatever the current code happens to
emit. When an assertion fails:

1. **STOP.** Do not edit the assertion to match the output.
2. Investigate whether the bug is in the **expectation** (misread the contract)
   or the **code** (a real defect).
3. If it is a real code defect, keep the contract-correct assertion but mark it
   `it.fails(...)` with a comment naming the divergence and the file/line. This
   records the bug as a failing-as-expected test without silently conforming to
   broken output and without changing source in a test-only plan.

Never golden-snapshot DOM geometry, pixel sizes, or full recorded write logs.
Assert **structural and relational invariants**: clamped fractions, page-button
enabled/disabled flags, pressed/selected booleans, resolved glyph registry
names, child counts, registration order, event-fired side effects.

### Two test tiers — JS-only vs. harness-installed

Most assertions are **JS-only**: construct the component, call setters/getters,
assert public state. These need only `// @vitest-environment jsdom` because the
`callable()` export wrappers and `Component` base touch `document` lightly at
construction. They do **not** call `installTestDOM`.

A second tier needs the **offline DOM seam** because the assertion reaches a
`DOM.sink`/`DOM.source` call: anything resolving an element handle
(`getElement(true)`), Glyph SVG-sprite mounting, or `setSelected` writing a
`toggleClass`. These install `installTestDOM(CONFIG)` and reset in `afterEach`.
Use the shared `CONFIG` shape from
[geometry.test.ts:8](../tests/dom/geometry.test.ts#L8) with the baked
`font-metrics.test-font.json` fixture.

### Glyph registration is global, mutable, and order-sensitive

`registerGlyph` writes a **module-level** `Map`
([Glyphs.ts:34](../src/typescript/lib/component/display/Glyphs.ts#L34)). Several
source modules `Glyph.register(...)` eagerly at import
(`TabCloseButton` → `xmark`, `SplitButton` → `caret-down`, `PaginationBar` →
the four `angle(s)` glyphs). The four `unicode-arrow-*` char glyphs are seeded
unconditionally
([Glyphs.ts:43-46](../src/typescript/lib/component/display/Glyphs.ts#L43)).
Glyph tests must therefore:

- Use the always-present `unicode-arrow-up` (a `char`-kind entry) as the default
  fixture rather than assuming any SVG glyph is registered.
- For SVG-kind assertions, **register a known glyph inside the test** (import a
  real def such as `xmark` from `~/glyphs/solid/xmark.js` and call
  `Glyph.register(xmark)`); `unregister` it in cleanup if the test asserts the
  unregistered/throwing path, to avoid cross-test pollution.

### Robust to minified `constructor.name`

The prod-build mangling that empties `constructor.name`
(`classList.add("")` crash — see project memory) means tests must **never**
assert on `constructor.name` or class-name-derived CSS classes. Assert behaviour
through public getters and recorded sink writes, which are stable under
minification.

### `callable()` export shape — construct with `new`

Every target is exported as a `callable()` wrapper (e.g.
`export { Button as _Button, ButtonCallable as Button }`). The public `Button`
is callable both as `Button(...)` and `new Button(...)`; tests use `new` for
clarity. Import the public name from the per-subpath barrel or the module path
via `~/...`.

---

## Per-target triage and behaviour lists

Priorities: **H** (high value-per-test, near-pure state/computation),
**M** (moderate — needs harness or wires children), **L** (low — visual/animation,
honestly scoped to construction smoke only).

### display/

#### PaginationBar — **H** (strongest near-pure candidate)
Source: [PaginationBar.ts](../src/typescript/lib/component/display/PaginationBar.ts).
The bar's `refresh()` derives button-enabled state and the page label purely
from store state ([PaginationBar.ts:173](../src/typescript/lib/component/display/PaginationBar.ts#L173)).
Drive a real `Store` (or the lightest concrete `AbstractStore`) and assert the
*store-side* math the bar depends on, plus the bar's observable label/button
states. Note `refresh()` flips `Button.setEnabled`, readable via
`Button.isEnabled()` ([Button.ts:2189](../src/typescript/lib/component/button/Button.ts#L2189)).
The four nav buttons are private; expose them by asserting through the public
behaviours instead (label text, and store transitions the buttons trigger).

Contract-derived assertions:
- Page-count math: `getTotalPages()` = `max(1, ceil(totalCount / pageSize))`
  ([AbstractStore.ts:469](../src/typescript/lib/data/AbstractStore.ts#L469)).
  E.g. 95 records / 25 page-size → 4 pages; 0 records → 1; exact multiple
  (100/25) → 4.
- `goToPage(n)` clamps to `[1, totalPages]`
  ([AbstractStore.ts:538](../src/typescript/lib/data/AbstractStore.ts#L538)):
  `goToPage(0)` → 1, `goToPage(999)` → totalPages.
- `nextPage`/`prevPage` no-op at the last/first page
  ([AbstractStore.ts:487](../src/typescript/lib/data/AbstractStore.ts#L487)).
- When the store has pending changes, `refresh()` disables **all four** nav
  buttons ([PaginationBar.ts:182-185](../src/typescript/lib/component/display/PaginationBar.ts#L182)).
  (Assert via the documented "all disabled while dirty" contract.)
- Label is `"Page X of Y"` when totalPages known, `"Page X"` when not
  ([PaginationBar.ts:177](../src/typescript/lib/component/display/PaginationBar.ts#L177)).
- `dispose()` detaches store listeners — after dispose, a `pagechanged` emit
  does not refresh the label.
- Options wiring: `new PaginationBar(store, { pageSize, pageIndex })` forwards
  to `store.setPageSize` / `store.goToPage`
  ([PaginationBar.ts:132](../src/typescript/lib/component/display/PaginationBar.ts#L132)).

Harness: needs `installTestDOM` only if asserting label text via the inner
`Text` element; prefer asserting store state and `Button.isEnabled()` which are
JS-only. Confirm during authoring whether `setEnabled` reads an element — if it
defers to a cached field, keep JS-only; if it touches the sink, install the
harness. **Investigate, don't assume.**

#### ProgressBar — **H** (value→fraction clamping)
Source: [ProgressBar.ts](../src/typescript/lib/component/display/ProgressBar.ts).
- Constructor clamps initial value to `[0,100]`
  ([ProgressBar.ts:51](../src/typescript/lib/component/display/ProgressBar.ts#L51)):
  `new ProgressBar(150).getValue()` → 100; `new ProgressBar(-5).getValue()` → 0.
- `setValue` clamps and is idempotent on unchanged value
  ([ProgressBar.ts:132](../src/typescript/lib/component/display/ProgressBar.ts#L132)).
- `getValue()` returns 0 while indeterminate regardless of stored value
  ([ProgressBar.ts:122](../src/typescript/lib/component/display/ProgressBar.ts#L122)).
- `isIndeterminate()` reflects constructor flag and `setIndeterminate` toggle.
- The fill-width relation in `doLayout`: `round(inner.width * value/100)`
  ([ProgressBar.ts:196](../src/typescript/lib/component/display/ProgressBar.ts#L196)) —
  assert the **relation** (value 50 of inner-width 200 → fill 100; value 0 → 0;
  value 100 → full) by setting a size and reading the fill child's width after
  `doLayout()`. This needs the harness (geometry oracle). Do **not** snapshot;
  assert the proportional invariant only.
- `getBaseline()` = preferredHeight − 2, or null before sizing
  ([ProgressBar.ts:111](../src/typescript/lib/component/display/ProgressBar.ts#L111)).
- Options: `{ value, indeterminate }` wiring
  ([ProgressBar.ts:87](../src/typescript/lib/component/display/ProgressBar.ts#L87)).

#### Glyph + Glyphs — **H** (class/name resolution; both constructor forms)
Source: [Glyph.ts](../src/typescript/lib/component/display/Glyph.ts),
[Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts).
Enumerate **both** name-supply forms the task calls out:
1. Positional constructor: `new Glyph("unicode-arrow-up")`.
2. Component carrying a `glyph: "..."` option that resolves a Glyph child
   (Button/IconText/IconLabel path) — covered in those targets, but assert the
   Glyph-name resolution itself here.

Contract-derived assertions:
- `lookupGlyph("unicode-arrow-up")` returns a `char`-kind def
  ([Glyphs.ts:43](../src/typescript/lib/component/display/Glyphs.ts#L43)).
- Unknown name throws `"Unknown glyph: <name>"`
  ([Glyph.ts:241](../src/typescript/lib/component/display/Glyph.ts#L241)):
  `() => new Glyph("definitely-not-registered")` throws.
- `getGlyphName()` returns the constructed name (not shadowing `getName`)
  ([Glyph.ts:316](../src/typescript/lib/component/display/Glyph.ts#L316)).
- Root tag is chosen from `def.kind`: `char` → `span`, `svg` → `svg`
  ([Glyph.ts:252](../src/typescript/lib/component/display/Glyph.ts#L252)).
  Assert via the option that reaches the sink `createElement(NS)` recorded write
  (install harness, render, inspect recorded `createElement`/`createElementNS`
  tag), **not** by snapshotting the whole write list.
- `char`-kind glyphs default `lineHeight` to `"1"` and `textAlign` to `"center"`
  ([Glyph.ts:261](../src/typescript/lib/component/display/Glyph.ts#L261)); SVG-kind
  leave them unset. Assert through the documented getters (`getLineHeight`).
- `register`/`unregister` round-trip: register a real `xmark`, `lookupGlyph`
  finds it; `unregister`, `lookupGlyph` returns `undefined` and `new Glyph(...)`
  throws.
- `setPreferredSize` locks min == pref == max
  ([Glyph.ts:284](../src/typescript/lib/component/display/Glyph.ts#L284)).
- `setFontSize` caches and `getFontSize` reflects it; null before any set
  ([Glyph.ts:327](../src/typescript/lib/component/display/Glyph.ts#L327)).
- `getBaseline()` = preferredHeight − 3, or null pre-size
  ([Glyph.ts:302](../src/typescript/lib/component/display/Glyph.ts#L302)).

The sprite-mount path (`ensureGlyphSprite`, `_addSymbolToSprite`) requires the
harness; one smoke test that a registered SVG glyph constructs and renders
without throwing under `installTestDOM` is sufficient — do not assert sprite DOM
structure (low value, brittle).

#### Header — **M**
Source: [Header.ts](../src/typescript/lib/component/display/Header.ts).
- Constructs with positional `text`; `getText()` returns the inner `Text` child.
- `updatePreferredSize()` derives height = textHeight + insets.top + bottom
  ([Header.ts:169](../src/typescript/lib/component/display/Header.ts#L169)) —
  needs harness for `getPreferredSize()` text measurement. Assert the
  **relation** (height grows with inset, default insets `(4,4,4,4)`), not a pixel.
- Default font weight is bold when no override; `getText().setFontWeight` path
  is the contract ([Header.ts:62](../src/typescript/lib/component/display/Header.ts#L62)).
- `getBaseline()` wraps the inner text baseline; null when text has none.
- Options: `{ text, fontWeight }` route to the inner Text
  ([Header.ts:139](../src/typescript/lib/component/display/Header.ts#L139)).

#### IconText / IconLabel — **M** (composite child wiring; near-identical)
Source: [IconText.ts](../src/typescript/lib/component/display/IconText.ts),
[IconLabel.ts](../src/typescript/lib/component/display/IconLabel.ts).
- Constructor builds a leading `Glyph` + trailing text/`Label`;
  `getGlyphComponent()` is a `Glyph` whose `getGlyphName()` matches the
  constructor arg.
- `setGlyph(name)` replaces the child with a fresh Glyph for the new name; old
  child removed, new one at index 0 ([IconText.ts:119](../src/typescript/lib/component/display/IconText.ts#L119)).
- `setText` updates the trailing text component;
  `getTextComponent()`/`getLabelComponent()` reflect it.
- `setGap`/`gap` option drives the HBox `componentSpacing`; default 2
  ([IconText.ts:29](../src/typescript/lib/component/display/IconText.ts#L29)).
- IconLabel additionally: `setForId` updates the `<label for>` association via
  the inner `Label`; constructor `forId` is non-empty (mirrors Label's contract —
  assert the documented requirement, surface if violated).
- Options precedence: bag-written `glyph`/`text` win over positional args
  ([IconText.ts:84](../src/typescript/lib/component/display/IconText.ts#L84)) —
  `new IconText('a', 'x', { glyph: 'unicode-arrow-down', text: 'y' })` resolves
  the bag values. Use `unicode-arrow-*` names so no extra registration is needed.

#### Image — **L** (load events / natural size are browser-only)
Source: [Image.ts](../src/typescript/lib/component/display/Image.ts).
- `getPreferredSize` / `getMinSize` read `DOM.source.getNaturalSize`, which the
  modelled source returns as `{0,0}`
  ([TestDOM.ts:551](../tests/dom/TestDOM.ts#L551)). So under the harness,
  `getMinSize()` returns the documented `20×20` pre-load fallback
  ([Image.ts:94](../src/typescript/lib/component/display/Image.ts#L94)) — assert
  exactly that branch.
- An explicit `setMinSize` wins over the auto-derived min
  ([Image.ts:88](../src/typescript/lib/component/display/Image.ts#L88)).
- `render()` sets the `src` attribute (assert the recorded `setAttr.src` write).
- **Skip**: actual natural-dimension auto-fit and `load` events — no browser.
  Note this explicitly in `## Non-Goals`.

#### ProgressSpinner — **L** (animation only; smoke only)
Source: [ProgressSpinner.ts](../src/typescript/lib/component/display/ProgressSpinner.ts).
No value/progress API (it is a pure spinner). Honest scope:
- `new ProgressSpinner(24)` sets preferredSize 24×24
  ([ProgressSpinner.ts:91](../src/typescript/lib/component/display/ProgressSpinner.ts#L91)).
- `new ProgressSpinner()` (no size) defaults to the 14 theme fallback
  ([ProgressSpinner.ts:74](../src/typescript/lib/component/display/ProgressSpinner.ts#L74)).
- Constructs without throwing. **Skip** the animation/keyframe and theme-change
  re-derivation (timing/visual).

### button/

#### Button — **H/M** (text/glyph/options wiring + enabled/flat state)
Source: [Button.ts](../src/typescript/lib/component/button/Button.ts).
- `getText()`/`setText()` round-trip via the inner Text
  ([Button.ts:628](../src/typescript/lib/component/button/Button.ts#L628)).
- `getGlyph()` is null until `setGlyph(name)` (or the `glyph` option) wires one
  ([Button.ts:1130](../src/typescript/lib/component/button/Button.ts#L1130),
  [Button.ts:1171](../src/typescript/lib/component/button/Button.ts#L1171)).
  Use `unicode-arrow-up` to avoid registration.
- `isEnabled()`/`setEnabled()` round-trip
  ([Button.ts:2163](../src/typescript/lib/component/button/Button.ts#L2163)).
- `isFlat()`/`setFlat()` round-trip; `setFlat(true)` **no-ops with a warning**
  when `chromeless` is set (chromeless wins)
  ([Button.ts:1433](../src/typescript/lib/component/button/Button.ts#L1433)) —
  assert `isFlat()` stays false after `setFlat(true)` on a chromeless button.
- `on("action", fn)` registers; clicking (DOM `"click"`) fires `"action"`
  ([Button.ts:1217](../src/typescript/lib/component/button/Button.ts#L1217)).
  Drive via `Event.fireEvent(button, "click")` and assert the handler ran;
  `off` removes it.
- Options wiring: `new Button("Save", { glyph, flat, enabled, description })`
  applies each ([Button.ts:392](../src/typescript/lib/component/button/Button.ts#L392)).
- `setDescription` lazily builds the subtitle; `getDescription()` null until set
  ([Button.ts:789](../src/typescript/lib/component/button/Button.ts#L789)).
- The `listeners: { action }` option wires as if `on("action")` was called
  ([Button.ts:140](../src/typescript/lib/component/button/Button.ts#L140)).

Most are JS-only; `setGlyph` and click-fire may touch the seam — install the
harness where a setter resolves an element, JS-only otherwise. **Verify per
assertion during authoring.**

#### ToggleButton — **H** (pressed/selected state + toggle)
Source: [ToggleButton.ts](../src/typescript/lib/component/button/ToggleButton.ts).
- `isSelected()` defaults false; `setSelected(true/false)` round-trips
  ([ToggleButton.ts:128](../src/typescript/lib/component/button/ToggleButton.ts#L128)).
- A `"click"` (via the constructor-wired listener → `onAction`) flips selection
  and fires `"change"` ([ToggleButton.ts:242](../src/typescript/lib/component/button/ToggleButton.ts#L242)):
  drive `Event.fireEvent(btn, "click")`, assert `isSelected()` toggled and a
  registered `on("action", fn)` handler ran exactly once per click.
- `on("action")`/`off("action")` route to the DOM `"change"` event
  ([ToggleButton.ts:100](../src/typescript/lib/component/button/ToggleButton.ts#L100)).
- `setSelected` writes `toggleClass: { selected }` to the element — needs harness;
  assert the recorded write **only if** asserting the class, else assert
  `isSelected()` (JS-only).
- Options: `{ selected: true }` constructs selected
  ([ToggleButton.ts:72](../src/typescript/lib/component/button/ToggleButton.ts#L72)).
- `setFlat` re-points the `.selected` rule (visual) — **skip** the rule contents,
  assert only `isFlat()` round-trips.

#### SplitButton — **H** (main vs. menu action separation)
Source: [SplitButton.ts](../src/typescript/lib/component/button/SplitButton.ts).
- `getMenuItems()` defaults to `[]`; `setMenuItems([...])` round-trips and also
  writes `_options.menuItems`
  ([SplitButton.ts:158](../src/typescript/lib/component/button/SplitButton.ts#L158)).
- Options `{ menuItems }` wiring
  ([SplitButton.ts:182](../src/typescript/lib/component/button/SplitButton.ts#L182)).
- The **main face** still fires the inherited `"action"` exactly like Button
  (drive `"click"` on the button, assert handler ran) — distinct from the chevron
  gesture.
- The chevron click path opens a menu via `_toggleMenu`, which `getElement()`-
  guards and reads `DOM.source.getViewportRect` — needs the harness and a
  rendered element. Honest scope: assert `_toggleMenu` is a **no-op when
  unattached** (`getElement()` returns nothing → returns early,
  [SplitButton.ts:217](../src/typescript/lib/component/button/SplitButton.ts#L217))
  by confirming no throw and no menu side effect. **Skip** the live dropdown
  open/anchor geometry (overlay + viewport-rect, browser-shaped).
- The chevron is registered eagerly (`caret-down`) so a `new SplitButton()`
  constructs without the consumer registering a glyph
  ([SplitButton.ts:10](../src/typescript/lib/component/button/SplitButton.ts#L10)).

#### TabCloseButton — **M** (seeded glyph + sizing defaults)
Source: [TabCloseButton.ts](../src/typescript/lib/component/button/TabCloseButton.ts).
- Constructs seeded with the `xmark` glyph: `getGlyph()` is non-null and its
  `getGlyphName()` is `"xmark"`
  ([TabCloseButton.ts:45](../src/typescript/lib/component/button/TabCloseButton.ts#L45)).
- Default preferredSize 16×16 and zero insets
  ([TabCloseButton.ts:25](../src/typescript/lib/component/button/TabCloseButton.ts#L25)).
- A caller-supplied `glyph` option **wins** over the seed (merge order):
  `new TabCloseButton({ glyph: "unicode-arrow-up" })` → `getGlyph().getGlyphName()`
  is `"unicode-arrow-up"`. (Surface if it does not — this is the documented
  `{...defaults, ...options}` contract.)

### menubar/

#### MenuBar — **H** (item registration, open-index tracking)
Source: [MenuBar.ts](../src/typescript/lib/component/menubar/MenuBar.ts).
- `getOpenIndex()` is `-1` on a fresh bar
  ([MenuBar.ts:235](../src/typescript/lib/component/menubar/MenuBar.ts#L235)).
- `setMenus([...])` registers one `MenuBarButton` child per descriptor; a second
  `setMenus` disposes the old buttons/panels and rebuilds
  ([MenuBar.ts:125](../src/typescript/lib/component/menubar/MenuBar.ts#L125)) —
  assert child count tracks descriptor count across two calls.
- `openMenu(i)` sets `getOpenIndex()` to `i`; `openMenu` out of range is a no-op
  ([MenuBar.ts:179](../src/typescript/lib/component/menubar/MenuBar.ts#L179)).
- `openMenu` then `closeMenu()` resets index to `-1`
  ([MenuBar.ts:211](../src/typescript/lib/component/menubar/MenuBar.ts#L211)).
- `openMenu` reads `getElement(true)` and opens a `Menu` overlay — needs the
  harness. If overlay open proves browser-shaped, scope MenuBar's open/close
  tests to **index-tracking state** and assert the index transitions only,
  noting the overlay paint is out of scope. **Investigate during authoring**
  whether `openMenu` runs offline under `installTestDOM`; if it throws, fall back
  to asserting `setMenus` registration + `getOpenIndex` default, and mark the
  open-path test `it.fails`/skip with a comment.
- ARIA role `menubar` is set at construction (assert via the recorded attr write
  under the harness, or skip if low value).

#### MenuBarButton — **M** (active state + ARIA)
Source: [MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts).
- Constructs `chromeless` (extends Button) — `isFlat()` stays false /
  `setFlat(true)` is suppressed (chromeless contract, shared with Button).
- `setActive(true/false)` toggles the background token and `aria-expanded`
  ([MenuBarButton.ts:146](../src/typescript/lib/component/menubar/MenuBarButton.ts#L146)) —
  assert via the `aria` setter side effect or recorded write; keep it relational
  (active ≠ inactive), not a token-string snapshot.
- `computePreferredSize` pins height to `MENU_BAR_BUTTON_HEIGHT` (28)
  ([MenuBarButton.ts:133](../src/typescript/lib/component/menubar/MenuBarButton.ts#L133)) —
  needs harness for width measurement; assert **height === 28** only.
- Constructor `onClick`/`onHover` callbacks fire on `"click"`/`"mouseover"`
  ([MenuBarButton.ts:125](../src/typescript/lib/component/menubar/MenuBarButton.ts#L125)):
  drive the events, assert the callbacks ran. `dispose()` removes them.

#### ToolBar — **M** (orientation, compact, child registration)
Source: [ToolBar.ts](../src/typescript/lib/component/menubar/ToolBar.ts).
- Default orientation `"horizontal"`; `getOrientation()` reflects it
  ([ToolBar.ts:251](../src/typescript/lib/component/menubar/ToolBar.ts#L251)).
- `setOrientation("vertical")` swaps the layout manager (HBox → VBox) preserving
  spacing, and is a no-op on the same value
  ([ToolBar.ts:213](../src/typescript/lib/component/menubar/ToolBar.ts#L213)).
- `setCompact(true)` toggles compact mode, no-op on unchanged
  ([ToolBar.ts:267](../src/typescript/lib/component/menubar/ToolBar.ts#L267)).
- `addComponent` registers children (assert child count after adding a couple of
  Buttons and a `ToolBarSeparator`).
- Options `{ orientation, compact }` wiring
  ([ToolBar.ts:183](../src/typescript/lib/component/menubar/ToolBar.ts#L183)).
- **Skip** the overflow ("menu"/"clip") reserve arithmetic — it depends on live
  child widths and the geometry pass; note in `## Non-Goals`.

#### ToolBarSeparator — **M** (orientation → size constraints)
Source: [ToolBarSeparator.ts](../src/typescript/lib/component/menubar/ToolBarSeparator.ts).
Pure-ish: orientation drives preferred/max size.
- Default orientation `"vertical"`; `getOrientation()` reflects it
  ([ToolBarSeparator.ts:62](../src/typescript/lib/component/menubar/ToolBarSeparator.ts#L62)).
- Vertical: `preferredSize` = `(THICKNESS, 0)`, `maxSize.height` = `MAX_VALUE`
  ([ToolBarSeparator.ts:70](../src/typescript/lib/component/menubar/ToolBarSeparator.ts#L70)).
- Horizontal (`{ orientation: "horizontal" }`): `preferredSize` = `(0, THICKNESS)`,
  `maxSize.width` = `MAX_VALUE` ([ToolBarSeparator.ts:73](../src/typescript/lib/component/menubar/ToolBarSeparator.ts#L73)).
- `THICKNESS === 1` ([ToolBarSeparator.ts:49](../src/typescript/lib/component/menubar/ToolBarSeparator.ts#L49)).
- ARIA `role="separator"`, matching `aria-orientation`, tabIndex −1 (assert via
  recorded writes under harness, or skip if low value).

---

## Ordered Implementation Steps

1. **`tests/component/display/ProgressBar.test.ts`** — value clamping,
   indeterminate, baseline, fill-width relation (harness). Highest-confidence,
   smallest surface; establishes the harness + `afterEach(DOM.reset)` pattern
   for the rest. → verify: `npx vitest run tests/component/display/ProgressBar.test.ts`.
2. **`tests/component/display/PaginationBar.test.ts`** — store page math,
   clamping, label, dirty-disable, dispose, options. Construct the lightest
   concrete store; confirm its constructor surface first
   (`grep -n "class Store\|constructor" src/typescript/lib/data/Store.ts`).
3. **`tests/component/display/Glyph.test.ts`** — name resolution, unknown-throws,
   `char` vs `svg` tag, register/unregister round-trip, size-lock, baseline.
   Use `unicode-arrow-*` for char; import + register `xmark` for SVG.
4. **`tests/component/display/IconText.test.ts`** and
   **`.../IconLabel.test.ts`** (one file each or a shared file) — child wiring,
   `setGlyph` replace, gap, options precedence.
5. **`tests/component/display/Header.test.ts`**, **`.../Image.test.ts`**,
   **`.../ProgressSpinner.test.ts`** — moderate/low scope per triage above.
6. **`tests/component/button/Button.test.ts`** — text/glyph/enabled/flat/action,
   options, description, listeners option.
7. **`tests/component/button/ToggleButton.test.ts`** — selected default, toggle
   on click, action↔change routing, options.
8. **`tests/component/button/SplitButton.test.ts`** — menuItems round-trip,
   main-face action, unattached `_toggleMenu` no-op, eager-chevron construct.
9. **`tests/component/button/TabCloseButton.test.ts`** — seeded `xmark`,
   size/inset defaults, caller-glyph-wins.
10. **`tests/component/menubar/ToolBarSeparator.test.ts`** — orientation → size
    constraints (most pure menubar target; do first in this group).
11. **`tests/component/menubar/MenuBarButton.test.ts`** — active toggle, pinned
    height, callback firing, dispose.
12. **`tests/component/menubar/MenuBar.test.ts`** — open-index default,
    setMenus registration/rebuild, open/close transitions (or `it.fails`/skip
    the overlay-open path per the MenuBar triage note).
13. **`tests/component/menubar/ToolBar.test.ts`** — orientation default + swap,
    compact toggle, child registration, options.
14. **Run the full new suite** and review every `it.fails`/skip comment to
    confirm each names a real divergence, not a misread contract.
    → verify: `npx vitest run tests/component/`.

For each file: where a setter's offline behaviour is ambiguous (touches the seam
vs. caches a field), **author the JS-only assertion first; add `installTestDOM`
only when a run shows the assertion needs a resolved handle.** Do not pre-install
the harness speculatively.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Create | `tests/component/display/ProgressBar.test.ts` |
| Create | `tests/component/display/PaginationBar.test.ts` |
| Create | `tests/component/display/Glyph.test.ts` |
| Create | `tests/component/display/IconText.test.ts` |
| Create | `tests/component/display/IconLabel.test.ts` |
| Create | `tests/component/display/Header.test.ts` |
| Create | `tests/component/display/Image.test.ts` |
| Create | `tests/component/display/ProgressSpinner.test.ts` |
| Create | `tests/component/button/Button.test.ts` |
| Create | `tests/component/button/ToggleButton.test.ts` |
| Create | `tests/component/button/SplitButton.test.ts` |
| Create | `tests/component/button/TabCloseButton.test.ts` |
| Create | `tests/component/menubar/MenuBar.test.ts` |
| Create | `tests/component/menubar/MenuBarButton.test.ts` |
| Create | `tests/component/menubar/ToolBar.test.ts` |
| Create | `tests/component/menubar/ToolBarSeparator.test.ts` |
| Modify | `tests/setup/jsdom-setup.ts` (add a `CSS.escape` polyfill the Glyphs sprite needs offline) |

(Authors may consolidate the IconText/IconLabel pair into one file if it reads
cleaner; the table lists them split for one-component-per-file symmetry with the
source.)

---

## Verification

- `npx vitest run tests/component/` — all new files pass (failing assertions
  appear only as intentional `it.fails`).
- `npx tsc --noEmit` (or the project's typecheck script) — no type errors in the
  new test files; the `~/...` alias resolves.
- Every `it.fails`/`it.skip` carries a comment naming the divergence and the
  source file/line — grep the new files for `it.fails` and read each comment.
- No test asserts on `constructor.name`, class-name CSS, or a full recorded
  write-log snapshot — grep the new files for `constructor.name` (expect zero)
  and for `.writes).toEqual`/`toMatchSnapshot` (expect zero).
- No source files under `src/` changed — `git status` shows only `tests/`
  additions.

---

## Potential Challenges

- **Setter offline ambiguity (seam vs. cache).** Some setters (`setEnabled`,
  `setText`) may resolve an element when one already exists. Mitigation: author
  JS-only first, escalate to `installTestDOM` only when a run demands a handle;
  never guess.
- **Overlay-dependent paths (MenuBar open, SplitButton dropdown).** These reach
  `Menu`/viewport-rect machinery that may not run cleanly offline. Mitigation:
  scope those targets to the state they own (open-index, menuItems) and
  explicitly `skip`/`it.fails` the live-open path with a comment, rather than
  forcing a brittle harness setup.
- **Glyph registry global pollution.** Registering/unregistering glyphs mutates
  module state shared across tests. Mitigation: prefer the always-seeded
  `unicode-arrow-*` names; for SVG-kind tests register inside the test and
  unregister in cleanup.
- **Store constructor surface for PaginationBar.** `AbstractStore` is abstract.
  Mitigation: confirm the concrete `Store` constructor/model requirements before
  writing (grep `src/typescript/lib/data/Store.ts`); a `setPageSize` +
  `totalCount` seed may need a minimal model/proxy or a direct private-field
  primer — investigate the lightest legitimate path.
- **`flushLayout`/`scheduleLayout` in setters.** `ProgressBar.setIndeterminate`
  calls `flushLayout()`; under the harness this should be inert, but confirm it
  does not throw without an attached element.

---

## Critical Files

- [tests/dom/TestDOM.ts](../tests/dom/TestDOM.ts) — `installTestDOM`,
  `RecordingDOMSink.writes`, `ModelledDOMSource` (note `getNaturalSize` → 0,
  `getViewportRect` oracle).
- [tests/dom/geometry.test.ts](../tests/dom/geometry.test.ts) — the canonical
  `CONFIG` + `afterEach(DOM.reset)` install/teardown pattern.
- [tests/component/Component.test.ts](../tests/component/Component.test.ts) and
  [tests/component/layout/HBox.test.ts](../tests/component/layout/HBox.test.ts) —
  JS-only state-assertion style and the `// @vitest-environment jsdom` pragma.
- [src/typescript/lib/data/AbstractStore.ts](../src/typescript/lib/data/AbstractStore.ts)
  (lines 427–561) — the pagination math PaginationBar depends on.
- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts)
  — the base class for every button target; `getText`/`setGlyph`/`isEnabled`/
  `isFlat`/`on("action")` are the shared surface.
- [src/typescript/lib/component/display/Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts)
  — the registry semantics and the four eagerly-seeded `unicode-arrow-*` glyphs.

---

## Non-Goals

- **Live layout geometry / pixel sizes.** No golden snapshots of measured
  widths, heights, or recorded write logs; assert relations and flags only.
- **Image `load` events and natural-size auto-fit.** The offline source reports
  `0×0` natural size; the real decode path is browser-only.
- **ProgressSpinner / Glyph animation, keyframes, and `prefers-reduced-motion`.**
  Timing- and paint-driven; out of scope beyond construct-without-throw.
- **Overlay rendering** for MenuBar dropdowns and SplitButton menus — the menu
  panel's anchored open/close paint is browser-shaped; only the owning state
  (open-index, menuItems) is tested.
- **ToolBar overflow ("menu"/"clip") arithmetic** — depends on live child widths
  and the geometry pass.
- **Source changes.** This plan adds test files only; any bug discovered is
  recorded via `it.fails`, not fixed here.
