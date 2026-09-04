---
touches-shared:
  - packages/lib/src/typescript/lib/component/container/index.ts
  - packages/lib/tests/component/default-options-fallback.test.ts
  - packages/lib/docs/components/index.md
  - packages/docs/src/content/pages.ts
---

# Separator — Implementation Plan

## Overview

Add `Separator`: a general-purpose divider rule — the framework's `<hr>` — usable in any container, in either direction. It is a leaf [`Component`](packages/lib/src/typescript/lib/core/Component.ts#L480) with no children whose own element *is* the line: a one-pixel band filled with a theme colour.

The framework already has this component twice, both times welded to one host: [`ToolBarSeparator`](packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts#L41) (a rule for [`ToolBar`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts)) and [`MenuSeparator`](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts#L30) (a rule for `Menu` rows). `Separator` is `ToolBarSeparator`'s geometry lifted out of the tool bar, with one addition that makes it work in a container nobody configured for it.[^precedent]

New file `packages/lib/src/typescript/lib/component/container/Separator.ts`, next to [`Spacer`](packages/lib/src/typescript/lib/component/container/Spacer.ts#L60) and `MenuSeparator`. The change also touches the container barrel, the shared default-resolution test registry, one docs page plus its two catalog entries, and one docs demo. No layout manager changes.

---

## Architecture Decisions

### Mirror `ToolBarSeparator`'s class shape

`Separator` copies `ToolBarSeparator` structurally: a direct `Component` subclass, an `orientation` option typed [`AxisOrientation`](packages/lib/src/typescript/lib/primitive/Axis.ts#L13), a `static readonly THICKNESS`, per-orientation size constraints set in the constructor body, `role="separator"` / `aria-orientation` / `tabindex="-1"` through `getAria()`, and the `callable()` export pair.[^precedent]

### `orientation` names the direction the rule runs; it defaults to `"horizontal"`

`orientation: "horizontal"` draws a horizontal line — the same meaning `ToolBarSeparator` and ARIA's `aria-orientation` already give the word. The default is `"horizontal"`, matching `<hr>`.[^orientation-default]

A separator's orientation must be the *opposite* of the direction its container stacks children, because the rule runs across the stack. Call the pairing below the **orientation-pairing table**:

| Container | Children stack | Use | Rule spans |
|---|---|---|---|
| `VBox` | top-to-bottom | `Separator()` (horizontal) | the column's width |
| `HBox` | left-to-right | `Separator({ orientation: "vertical" })` | the row's height |

`Separator` does not read its parent and does not auto-flip — the same rule `ToolBar.setOrientation` follows for its own separators.

### The rule spans its container through a cross-axis `fill` constraint

The separator records a [`LayoutConstraints.fill`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L39) on its parent's layout manager: `FillType.HORIZONTAL` for a horizontal rule, `FillType.VERTICAL` for a vertical one. `HBox` and `VBox` read exactly that field as per-child align-self ([`BoxLayout.crossPlacement`](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L525)), and the field overrides the box's global `itemAlign` / `stretching`. The write happens in an `init()` override — the first point at which the parent's layout manager is reachable — copying [`Spacer.syncFlexConstraints`](packages/lib/src/typescript/lib/component/container/Spacer.ts#L180), which writes its own `weight` constraint the same way.[^fill-constraint]

### The `fill` write defers to a caller-supplied `fill`

The separator writes `fill` only when the child's stored constraints do not already carry one. A caller who wants the rule at some other length sets `fill` themselves and the separator leaves it alone.[^fill-deference]

| Constraints already stored for the separator | `syncFillConstraint` does | Result for a horizontal rule in a `VBox` |
|---|---|---|
| none | creates `LayoutConstraints`, sets `fill = HORIZONTAL` | spans the column width |
| `{ weight: 1 }` | sets `fill = HORIZONTAL`, keeps `weight` | spans the column width, weight untouched |
| `{ fill: FillType.NONE }` | nothing | stays at its preferred length of `0` — the caller opted out |
| `{ fill: FillType.BOTH }` | nothing | the caller's own fill applies |

### Colour comes from the existing `--ts-ui-border-color` token

The class default is `backgroundColor: "var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))"`, seeded through the `_defaultSeparatorOptions` bag so a caller-supplied `backgroundColor` wins. `--ts-ui-border-color` is the framework's existing dividing-line colour, fed by [`Theme.border.color`](packages/lib/src/typescript/lib/core/Theme.ts#L992). No new `Theme` field and no new CSS variable.[^border-token]

### Thickness is a constant, not an option

`static readonly THICKNESS: number = 1` — a hairline, exactly as `ToolBarSeparator` declares it. There is no `thickness` option and no setter.[^thickness-constant]

### The off axis is pinned by min, preferred *and* max

The axis across the rule (height for a horizontal rule, width for a vertical one) gets the same value in all three size hints, so that extent is genuinely fixed rather than merely preferred. The minimum is the third hint, one more than `ToolBarSeparator` sets.[^min-size] Call the values below the **size-hint table**:

| `orientation` | `preferredSize` | `minSize` | `maxSize` | `fill` written |
|---|---|---|---|---|
| `"horizontal"` (default) | `{ width: 0, height: 1 }` | `{ width: 0, height: 1 }` | `{ width: UNBOUNDED, height: 1 }` | `FillType.HORIZONTAL` |
| `"vertical"` | `{ width: 1, height: 0 }` | `{ width: 1, height: 0 }` | `{ width: 1, height: UNBOUNDED }` | `FillType.VERTICAL` |

The zero along the rule's own axis keeps the separator out of its container's content-size sum: a horizontal rule adds nothing to a `VBox`'s preferred width, a vertical rule adds nothing to an `HBox`'s preferred height. `UNBOUNDED` is the sentinel from [`primitive/Size.ts`](packages/lib/src/typescript/lib/primitive/Size.ts#L18); use it directly rather than `Number.MAX_VALUE`.

### `ToolBarSeparator` and `MenuSeparator` are left untouched

Neither `ToolBarSeparator` nor `MenuSeparator` is re-based on `Separator`.[^siblings-untouched]

---

## Public API

`packages/lib/src/typescript/lib/component/container/Separator.ts`

```typescript
/**
 * Construction-time options for {@link Separator}.
 *
 * @category Components
 */
export interface SeparatorOptions extends ComponentOptions {
    /** Direction the rule runs. Defaults to `"horizontal"`. */
    orientation?: AxisOrientation;
}

class Separator extends Component<SeparatorOptions> {

    /** Pixel thickness of the rendered rule — a 1-pixel hairline. */
    static readonly THICKNESS: number;

    constructor(options?: SeparatorOptions, subclassDefaults?: Partial<SeparatorOptions>);

    /** Returns the orientation passed at construction time. */
    getOrientation(): AxisOrientation;

    /** Writes the cross-axis fill constraint once the parent is reachable. */
    protected init(element?: Handle): this;
}

const SeparatorCallable = callable(Separator);
type SeparatorCallable = Separator;
export {
    Separator         as _Separator,
    SeparatorCallable as Separator
};
```

`orientation` is read once, in the constructor, into a `private readonly _orientation` field. There is no `setOrientation`: like `ToolBarSeparator`, the orientation is fixed for the component's life. Colour is the inherited `backgroundColor` option and `setBackgroundColor` setter; the class contributes only a default value.

---

## Internal Structure

Class-level default, sitting above the class exactly as `ToolBarSeparator`'s does:

```typescript
/**
 * User-overridable default fill; a caller-supplied `backgroundColor` wins.
 */
const _defaultSeparatorOptions: Partial<SeparatorOptions> = {
    backgroundColor: "var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
};
```

The constraint write, modelled on `Spacer.syncFlexConstraints`:

```typescript
private syncFillConstraint(): void {
    const parent = this.getParentComponent();
    if (!parent) {
        return;
    }

    const lm = parent.getLayoutManager();
    if (!lm) {
        return;
    }

    const existing = lm.getLayoutConstraints(this);

    // An explicit caller fill wins; only an unset one is filled in.
    if (existing && existing.fill != null) {
        return;
    }

    const constraints = existing ?? new LayoutConstraints();
    constraints.fill = this._orientation === "horizontal" ? FillType.HORIZONTAL : FillType.VERTICAL;
    lm.setLayoutConstraints(this, constraints);
}
```

`init()` calls `syncFillConstraint()` after `super.init(element)`. The `init()` override is the first moment the parent is reachable: [`Component.insertComponent`](packages/lib/src/typescript/lib/core/Component.ts#L6542) stores the caller's constraints (line 6554) and sets `_parent` (line 6556) *before* realising the child's element, so the caller's constraints are always visible to the check above.

---

## Ordered Implementation Steps

Steps 1–3 are the test-first red phase; step 4 makes them pass.

1. **Create** `packages/lib/tests/component/container/Separator.test.ts`, modelled on [`ToolBarSeparator.test.ts`](packages/lib/tests/component/menubar/ToolBarSeparator.test.ts) (same `installTestDOM(CONFIG)` / `DOM.reset()` scaffold and the same `fontMetrics` import, with the relative import depth of `packages/lib/tests/component/container/Spacer.test.ts`). Cover `## Expected Behaviour` rows 1–6.
2. **Create** `packages/lib/tests/component/container/Separator.layout.test.ts` covering `## Expected Behaviour` rows 7–11: a `Panel` with an `HBox` / `VBox` layout manager, children added via `addComponent`, then the panel rendered and laid out; assert the separator's `getWidth()` / `getHeight()`.
3. **Add** `## Expected Behaviour` rows 12–13 to [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts): a registry entry next to the `MenuSeparator` row (line 337) —
   ```typescript
   { label: 'Separator backgroundColor', resolve: () => new Separator().getBackgroundColor(), expected: 'var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))' },
   ```
   — and, inside the `it(...)` at line 601, `expect(new Separator({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');`, adding `Separator` to that test's title. Import `Separator` alongside the existing `MenuSeparator` import (line 44).
4. **Create** `packages/lib/src/typescript/lib/component/container/Separator.ts` with the SPDX header, `SeparatorOptions`, `_defaultSeparatorOptions`, the class, `syncFillConstraint`, the `init` override, and the `callable()` export block. The constructor signature must be `(options?: SeparatorOptions, subclassDefaults?: Partial<SeparatorOptions>)` forwarding `super(options, { ..._defaultSeparatorOptions, ...(subclassDefaults ?? {}) })` — `local/forward-super-options` and `local/require-subclass-defaults` are both errors in [`packages/lib/eslint.config.js`](packages/lib/eslint.config.js#L31). Set the three size hints per the size-hint table in `## Architecture Decisions`, then call `this.getAria().setRole("separator")`, `this.getAria().setOrientation(this._orientation)` and `this.getAria().setTabIndex(-1)`. Imports: `AxisOrientation` from `~/primitive/Axis.js`, `UNBOUNDED` from `~/primitive/Size.js`, `FillType` from `~/layout/FillType.js`, `LayoutConstraints` from `~/layout/LayoutConstraints.js`, and the `Handle` type from `~/core/DOM.js` for the `init` signature.
5. **Export** from [`packages/lib/src/typescript/lib/component/container/index.ts`](packages/lib/src/typescript/lib/component/container/index.ts#L30), immediately before the `Spacer` pair:
   ```typescript
   export { Separator } from '~/component/container/Separator.js';
   export type { SeparatorOptions } from '~/component/container/Separator.js';
   ```
6. **Run** `npm run typecheck && npm test` — steps 1–3 now pass.
7. **Checkpoint:** `grep -rn 'Separator' packages/lib/src/typescript/lib/layout/` — expect zero matches. No layout manager is edited.
8. **Create** the docs demo `packages/docs/src/demos/separator-basic.ts`. It must export exactly two symbols, `height` (documented, value `120` — one of the five allowed by [`demo-catalogue.test.ts`](packages/docs/tests/demo-catalogue.test.ts#L14)) and `create()`, declare every child in a named `const` rather than inline inside `components:`, use no colour literal, and keep lines under 100 characters. Model it on [`spacer-basic.ts`](packages/docs/src/demos/spacer-basic.ts): a `VBox` panel of `Text` / `Separator()` / `Text`.
9. **Create** the docs page `packages/lib/docs/components/Separator.md` on the [`ToolBarSeparator.md`](packages/lib/docs/components/ToolBarSeparator.md) template — intro paragraph, a `<!-- demo: separator-basic -->` block, `## Usage`, `## Notes`, `## Theming`, `## See also`. Content per `## Documentation Impact`.
10. **Register** the sidebar entry in [`packages/docs/src/content/pages.ts`](packages/docs/src/content/pages.ts#L208): add `{ path: '/components/Separator', label: 'Separator' }` to `componentsDisplay`. Position does not matter — the array is sorted by `compareLabels` at build time (line 450) — but the entry is mandatory: `pages.test.ts` asserts a bijection between doc files and nav entries.
11. **Add** the catalog row to [`packages/lib/docs/components/index.md`](packages/lib/docs/components/index.md#L71), at the end of the `## Display` table (after the `StatusBar` row, line 97):
    ```markdown
    | [`Separator`](/components/Separator) | Thin divider rule — horizontal or vertical, spans its container |
    ```
12. **Run** `npm run docs:api` (regenerates the gitignored TypeDoc output the docs link check reads), then `npm -w packages/docs run test`.
13. **Checkpoint:** `npm run lint` — zero new findings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/container/Separator.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/index.ts` |
| Create | `packages/lib/tests/component/container/Separator.test.ts` |
| Create | `packages/lib/tests/component/container/Separator.layout.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Create | `packages/lib/docs/components/Separator.md` |
| Modify | `packages/lib/docs/components/index.md` |
| Create | `packages/docs/src/demos/separator-basic.ts` |
| Modify | `packages/docs/src/content/pages.ts` |

---

## Expected Behaviour

Rows 1–6 belong to step 1's test file, rows 7–11 to step 2's, and rows 12–13 to step 3's additions in the shared default-resolution registry. Rows 7–11 are offline-testable like the rest — the box layouts compute geometry from size hints and constraints, not from browser measurement — and are split into their own file only because they need a rendered parent. Row 14 is manual.

| # | Case | Expected |
|---|---|---|
| 1 | `new Separator().getOrientation()` | `"horizontal"` |
| 2 | `new Separator({ orientation: "vertical" }).getOrientation()` | `"vertical"` |
| 3 | `_Separator.THICKNESS` | `1` |
| 4 | `new Separator().getPreferredSize()` / `getMinSize()` / `getMaxSize()` | `{0,1}` / `{0,1}` / `{UNBOUNDED,1}` |
| 5 | `new Separator({ orientation: "vertical" })`, same three | `{1,0}` / `{1,0}` / `{1,UNBOUNDED}` |
| 6 | `getAria()` of a vertical separator | `getRole()` `"separator"`, `getOrientation()` `"vertical"`, `getTabIndex()` `-1` |
| 7 | Horizontal separator between two children of a 300-wide rendered `VBox` panel | `getHeight()` is `1`; `getWidth()` is the column's inner width |
| 8 | Vertical separator between two children of a 200-tall rendered `HBox` panel | `getWidth()` is `1`; `getHeight()` is the row's inner height |
| 9 | Row 8 with the `HBox` left at its default `itemAlign` (`"baseline"`) | Same as row 8 — the `fill` constraint overrides `itemAlign` |
| 10 | Separator added with `new LayoutConstraints()` carrying `fill: FillType.NONE` | No fill is written; the rule takes its preferred extent of `0` along its own axis |
| 11 | Separator added with `new LayoutConstraints()` carrying `weight: 1` | `fill` is added, `weight` still reads `1` |
| 12 | `new Separator().getBackgroundColor()` | `"var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))"` — the class default resolves through the getter |
| 13 | `new Separator({ backgroundColor: "red" }).getBackgroundColor()` | `"red"` — the caller beats the class default |
| 14 | Manual: the `/components/Separator` docs demo in light and dark themes | A one-pixel rule spanning the panel, visible against both backgrounds |

A horizontal separator inside an `HBox` (or a vertical one inside a `VBox`) is the mismatched pairing from the orientation-pairing table: its length is its own preferred `0`, so it renders as nothing. A zero-length rule is the intended outcome for that pairing, not a defect — the fix is to pass the other orientation.

---

## Verification

1. `npm run typecheck`
2. `npm test` — the two new test files plus the amended default-resolution registry pass.
3. `npm run lint` — zero new findings.
4. `grep -rn 'Separator' packages/lib/src/typescript/lib/layout/` — zero matches.
5. `npm run docs:api` — finishes with zero warnings (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), public JSDoc must not `{@link}` excluded symbols; cross-package references use Markdown links such as `[`HBox`](/api/layout/classes/HBox)`).
6. `npm -w packages/docs run test` — the page bijection, demo hygiene and link checks pass.
7. `npm run build:lib`
8. Manual: `npm run docs:dev`, open `http://localhost:5173` → **Components → Display → Separator**. Confirm the demo shows a full-width hairline between the two labels, that it survives a browser-window resize, and that it is visible in both the light and dark theme.

---

## Documentation Impact

- **Export surface.** `Separator` and `SeparatorOptions` ship from `packages/lib/src/typescript/lib/component/container/index.ts`, so the consumer import is `@jimka/typescript-ui/component/container`. There is no root barrel.
- **New page** `packages/lib/docs/components/Separator.md`, following `ToolBarSeparator.md`:
  - Intro naming the API link `[`Separator`](/api/component/container/classes/Separator)`.
  - `<!-- demo: separator-basic -->` block wrapping a one-line description and an `[Open the Separator page](https://jimka.github.io/typescript-ui/components/Separator)` link, matching `Spacer.md`.
  - `## Usage` with the `VBox` + horizontal rule case and the `HBox` + vertical rule case.
  - `## Notes`: the orientation-pairing table; thickness is fixed at 1 px (`Separator.THICKNESS`); `role="separator"` with a matching `aria-orientation` and `tabindex="-1"`; the rule spans its container by writing a cross-axis `fill` constraint, which a caller-supplied `fill` overrides.
  - `## Theming`: `--ts-ui-border-color`, set from the [`Theme`](/api/core/interfaces/Theme) `border.color` field; override per instance with the `backgroundColor` option.
  - `## See also`: the API link, `[`ToolBarSeparator`](/components/ToolBarSeparator)`, `[`MenuSeparator`](/components/MenuSeparator)`, `[`Spacer`](/components/Spacer)`, `[`HBox`](/api/layout/classes/HBox)`, `[`VBox`](/api/layout/classes/VBox)`.
- **Catalog and sidebar.** One row in `packages/lib/docs/components/index.md` under `## Display`, and one `NavEntry` in `componentsDisplay` in `packages/docs/src/content/pages.ts`. The nav entry is required, not cosmetic — `packages/docs/tests/pages.test.ts` fails on a doc file with no entry.
- **JSDoc link forms.** `HBox`, `VBox`, `LayoutConstraints` and `FillType` live in `layout/`, outside this symbol's bucket, so the class and option JSDoc reference them as Markdown links, not `{@link}`. `{@link Separator}` / `{@link SeparatorOptions}` are fine.

---

## Potential Challenges

- **A separator rendered before it is added to a parent never writes its constraint.** `init()` runs once; if a caller forces the element with `getElement(true)` and only then adds the separator to a container, the write is skipped and the rule stays at zero length. `Spacer` has the same shape. Mitigation: the docs page's usage examples always construct-then-add, which is the framework's normal order.
- **A container whose layout manager ignores `fill`.** `Absolute` positions children from explicit bounds and never consults the constraint, so a separator there renders at its preferred size — zero along its own axis. Mitigation: the docs `## Notes` scope the spanning behaviour to `HBox` / `VBox`.
- **Wrong orientation reads as "nothing rendered".** A zero-length rule is invisible and gives no clue why. Mitigation: the orientation-pairing table leads the docs `## Notes`, and `## Expected Behaviour` pins the case so it is a documented outcome rather than a surprise.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts) — the class shape being generalised: option bag, `THICKNESS`, per-orientation size hints, ARIA wiring, `callable()` export pair.
- [`packages/lib/src/typescript/lib/component/container/Spacer.ts`](packages/lib/src/typescript/lib/component/container/Spacer.ts#L180) — the precedent for a leaf writing its own `LayoutConstraints` on the parent's manager, and for doing it from an `init()` override (line 244).
- [`packages/lib/src/typescript/lib/layout/BoxLayout.ts`](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L525) — `crossPlacement`, which turns a cross-axis `fill` into a full-band placement in both boxes.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L383) — `resolveBounds`; line 392 is where a stored `fill` outranks the one the caller passed in.
- [`packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L39) — the `fill` field and its documented HBox/VBox align-self meaning.
- [`packages/lib/src/typescript/lib/primitive/Axis.ts`](packages/lib/src/typescript/lib/primitive/Axis.ts#L13) — `AxisOrientation`.
- [`packages/lib/src/typescript/lib/primitive/Size.ts`](packages/lib/src/typescript/lib/primitive/Size.ts#L18) — the `UNBOUNDED` sentinel.
- [`packages/lib/src/typescript/lib/core/Theme.ts`](packages/lib/src/typescript/lib/core/Theme.ts#L992) — `--ts-ui-border-color`.
- [`packages/lib/tests/component/menubar/ToolBarSeparator.test.ts`](packages/lib/tests/component/menubar/ToolBarSeparator.test.ts) — the test scaffold and assertion style to copy.
- [`packages/docs/tests/demo-catalogue.test.ts`](packages/docs/tests/demo-catalogue.test.ts) — the hygiene rules every demo module must satisfy.

---

## Non-Goals

- **No `thickness` option and no `setThickness`.** See the constant decision above; a caller needing a heavier rule uses a `Component` with an explicit border.
- **No `setOrientation`.** Orientation is construction-time, matching `ToolBarSeparator`. Nothing in the framework flips a separator after the fact.
- **No auto-orientation from the parent.** `ToolBar` already declines to auto-flip its separators; a component that reads its parent's layout manager to choose its own geometry would be a new pattern.
- **No changes to `ToolBarSeparator` or `MenuSeparator`.** Neither is re-based on `Separator`.
- **No new `Theme` field or CSS variable.** `--ts-ui-border-color` already exists for dividing lines.
- **No `pointer-events: none`.** A one-pixel band intercepts nothing worth carving out, and `ToolBarSeparator` does not set it either.
- **No `llms.txt` catalog row.** The manifest is a curated, token-capped subset; `Spacer`, `MenuSeparator` and `ToolBarSeparator` are all absent from it.

---

## Notes

[^precedent]: `ToolBarSeparator` is the nearest existing solution and the one this component copies. It already solves every part of the problem — orientation as an `AxisOrientation` option, a `THICKNESS` constant, per-orientation `preferredSize` / `maxSize`, a themed `backgroundColor` class default, `role="separator"` — except one: it relies on its host. Its own source comment says the rendered height "comes from the parent's `stretching=true` branch", which `ToolBar` supplies. Dropped into a plain `HBox` at its default `itemAlign` of `"baseline"`, `layoutPreferredMode` gives a child `Math.min(preferredSize.height, containerSize.height)` ([`HBox.ts:475`](packages/lib/src/typescript/lib/layout/HBox.ts#L475)), and `ToolBarSeparator`'s preferred height is `0` — so the rule renders at zero height and is invisible. The `fill` constraint is the one thing `Separator` adds. Three other candidates were checked and rejected as the base: `MenuSeparator` is a `MenuRow` whose width `Menu.doLayout` assigns and whose fixed 9 px height includes menu-row margin; `SplitGutter` is a drag-and-collapse coordinator, not a rule; `Spacer` is deliberately invisible and contributes only the constraint-writing mechanic reused here.

[^orientation-default]: The two candidate defaults are `"horizontal"` (what `<hr>` is, and what the brief's first example asks for) and `"vertical"` (what `ToolBarSeparator` defaults to). `ToolBarSeparator`'s default is derived from its host — tool bars are horizontal by default, so their separators are vertical. `Separator` has no host to derive from, so it takes the `<hr>` reading instead.

[^fill-constraint]: Three ways to make the rule span its container were compared. **Rejected: require the container to stretch.** `HBox`/`VBox` fill a child's cross axis only when `itemAlign` is `"stretch"`, so every consumer would have to reconfigure the container before a separator worked — and a container shared with baseline-aligned text cannot be switched to `"stretch"` without moving everything else. **Rejected: advertise an unbounded cross-axis `preferredSize`.** The boxes take `Math.min(preferred, container)` on the cross axis, so an unbounded preferred does span the band — but it also lands in `HBox.getPreferredSize`'s row-height and `VBox`'s column-width aggregation, inflating the container's own reported preferred size to the sentinel. **Chosen: the `fill` constraint**, which `LayoutConstraints.fill` documents as exactly this (per-child align-self, overriding the box's global stretching), which both boxes consult before their `itemAlign` fallback, and which `LayoutManager.resolveBounds` honours ahead of whatever fill the manager passes in.

[^fill-deference]: `Spacer.syncFlexConstraints` writes its `weight` unconditionally. `Separator` deviates and skips the write when a `fill` is already stored, because the two cases differ in kind: a flex `Spacer`'s weight *is* the component — a spacer that lost its weight is a zero-sized nothing — whereas a separator's span is a sensible default over a decision the caller may legitimately want to make. Deferring also costs nothing: `LayoutConstraints.fill` initialises to `null`, so "already set" is an unambiguous `!= null` test rather than a guess.

[^border-token]: Three separator-specific tokens already exist — `--ts-ui-context-menu-separator-color`, `--ts-ui-menu-bar-separator-color`, `--ts-ui-toolbar-separator-color` — but each belongs to one host and inherits that host's palette. A general separator has no host, so it takes the framework's general dividing-line colour, `--ts-ui-border-color`, which already paints `Markdown`'s blockquote bar and code-block borders, the table border and the table footer's top rule. The fallback `rgba(127, 127, 127, 0.4)` is the one `Markdown` and the editor theme use with the same token; it is theme-neutral, unlike the `black` fallback the table uses.

[^thickness-constant]: A `thickness` option was considered and dropped. Both existing separators fix their thickness as a class constant (`ToolBarSeparator.THICKNESS`, `MenuSeparator.HEIGHT`) and neither exposes it, so a knob here would be a new pattern; it would also need its own setter, backing field, options key and default-registry row to satisfy the typed-setter rules in `ARCHITECTURE.md`. A caller who genuinely needs a heavier rule already has one framework-idiomatic route: a `Component` with an explicit `border`.

[^min-size]: `ToolBarSeparator` sets only `preferredSize` and `maxSize`, leaving its minimum at the inherited `{0, 0}`. That is survivable inside a tool bar, but not in general: when an `HBox` row overflows, `resolveChildWidth` shrinks each non-weighted child from its preferred extent toward its *minimum* ([`HBox.ts:646`](packages/lib/src/typescript/lib/layout/HBox.ts#L646)), so a vertical separator with a zero minimum is the first thing to vanish from a cramped row. Pinning the minimum to `THICKNESS` on the off axis makes the hairline incompressible while leaving the rule's own axis at `0`, so it still contributes nothing to the container's content size. The `min ≤ preferred ≤ max` invariant holds on both axes in both orientations.

[^siblings-untouched]: Re-basing `ToolBarSeparator` on `Separator` would change its default colour token (`--ts-ui-toolbar-separator-color` → `--ts-ui-border-color`), which is a visible change to every tool bar and a `Theme`-field question of its own; it would also add a `fill` constraint write inside `ToolBar`, whose `HBox` already stretches. `MenuSeparator` is further away still — it extends `MenuRow`, draws with `borderTop` rather than a background fill, carries menu-row margin inside its 9 px height, and has its width assigned by `Menu.doLayout`. Neither change is needed for this component to work, and both would put unrelated visual risk into the same commit.
