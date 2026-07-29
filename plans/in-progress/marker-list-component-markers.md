---
depends-on: [marker-list-layout-manager]
touches-shared:
  - packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts
  - packages/lib/src/typescript/lib/component/list/ListItem.ts
---

# Marker List Component Markers — Implementation Plan

## Overview

`BulletedList` and `NumberedList` currently rely on the browser's own `::marker` box to paint each item's bullet or number. Keeping that box alive takes a `display: list-item` write, a `list-style-position: inside` write, and a `setDisplayed` override, all in [`ListItem`](packages/lib/src/typescript/lib/component/list/ListItem.ts) — and one hole is still open: [`Component.applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4504) writes `display: none` into the very `#id` rule that carries `display: list-item`, so an item hidden and shown again loses its marker permanently. The browser also never reports the marker's width, so [`ListItem.getPreferredSize`](packages/lib/src/typescript/lib/component/list/ListItem.ts#L141) guesses it at 1.6x the font size, and that guess breaks min/max clamping.

This plan replaces the native marker with a **real child component**. `ListItem` becomes a small composite — a marker [`Text`](packages/lib/src/typescript/lib/component/input/Text.ts#L94) beside a label `Text`, arranged by an [`HBox`](packages/lib/src/typescript/lib/layout/HBox.ts) — mirroring [`IconText`](packages/lib/src/typescript/lib/component/display/IconText.ts#L52). The owning list writes each item's marker string and rewrites all of them whenever the children change, mirroring how [`AbstractSelectableList.syncRows`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1537) pushes a fresh index into every row.

Because the marker is a measured component, the framework sizes and positions it like any other content: no `display: list-item`, no `list-style-position`, no `setDisplayed` override, no width estimate. It is also assertable offline, which none of the native-marker behaviour was.

Four source files change — [component/list/ListItem.ts](packages/lib/src/typescript/lib/component/list/ListItem.ts), [component/list/AbstractMarkerList.ts](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts), [component/list/BulletedList.ts](packages/lib/src/typescript/lib/component/list/BulletedList.ts), [component/list/NumberedList.ts](packages/lib/src/typescript/lib/component/list/NumberedList.ts) — plus two new ARIA role names in [core/Aria.ts](packages/lib/src/typescript/lib/core/Aria.ts#L10).

This plan assumes `feature/marker-list-layout-manager` has already merged.[^assume-merged] It does not re-specify that branch's `VBox` default or its removal of the fixed 200x200 preferred size; both stay exactly as they are.

---

## Architecture Decisions

### `ListItem` becomes a two-slot composite laid out by an `HBox`

`ListItem` stops extending `Text` and extends `Component` again, owning two `Text` children: `_marker` (the bullet or number) and `_text` (the label). Its class-default layout manager is a fresh `new HBox({ spacing: MARKER_GAP_PX })` per instance, and the label is added with `{ weight: 1 }` so it absorbs the width the marker leaves. `MARKER_GAP_PX` is a module constant of `4`.[^gap]

This is the [`IconText`](packages/lib/src/typescript/lib/component/display/IconText.ts#L52) shape verbatim: a plain `Component` whose default bag carries a per-instance `HBox`, two children built in the constructor body, and option fields written pure to `_options` by `applyOptions` and dispatched once the children exist.[^why-not-text]

### The marker slot is a `Text`, not a `Glyph`

`IconText`'s leading slot is a [`Glyph`](packages/lib/src/typescript/lib/component/display/Glyph.ts). This plan deviates on that one point: the marker slot is a `Text` carrying a string.[^why-text-marker]

### The list owns the marker string; the item only stores it

`AbstractMarkerList` gains a protected `renumber()` that walks its children and calls `item.setMarker(text)` on each. `BulletedList` and `NumberedList` supply the string through a new protected abstract `markerText(index)`. `renumber()` runs from `setStyle` and from the three structural mutators.

This mirrors [`AbstractSelectableList.syncRows`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1537), which loops its rows and pushes each one's position through a public setter (`row.setIndex(i)`, [:423](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L423)) every time the item list changes.

`setMarker` is public on `ListItem` because the list — a different class — drives it. That is the framework's documented shape for cross-class control: the inner component exposes a public domain verb rather than the outer one reaching into its internals (ARCHITECTURE.md, *Event handling*). It stays off `ListItemOptions`, because the consumer never sets it (ARCHITECTURE.md, *Three non-negotiable rules*, rule 3).

### Renumbering hooks `insertComponent`, `removeComponent`, and `sortComponents`

Those three are the only base methods that change child order or membership without going through another of them.[^mutator-coverage] `renumber()` returns immediately when the list has no children, so the `setStyle` call that fires during the construction cascade is a no-op.

### The list suppresses the browser's own marker with `listStyleType: "none"`

`AbstractMarkerList`'s constructor writes `listStyleType: "none"` once. `setStyle` no longer writes any CSS — it stores the style and calls `renumber()`.[^camel-key]

### An unsupported numbered style warns and renders `DECIMAL`

Only `NONE` and `DECIMAL` are implemented. `NumberedList.setStyle` logs one `console.warn` naming the class, the id, and the requested style, then stores the style unchanged; `markerText` renders decimal numbering. `getStyle()` keeps returning exactly what the caller passed. Nothing throws, and no enum member is removed.[^warn-fallback]

The rule, with the cases it decides:

| List | Style set | `getMarker()` at index 0 / 1 / 2 | Warns? |
|---|---|---|---|
| `BulletedList` | `DISC` (default) | `•` / `•` / `•` | no |
| `BulletedList` | `CIRCLE` | `◦` / `◦` / `◦` | no |
| `BulletedList` | `SQUARE` | `▪` / `▪` / `▪` | no |
| `BulletedList` | `NONE` | `""` / `""` / `""` | no |
| `NumberedList` | `DECIMAL` (default) | `1.` / `2.` / `3.` | no |
| `NumberedList` | `NONE` | `""` / `""` / `""` | no |
| `NumberedList` | `UPPER_ROMAN` | `1.` / `2.` / `3.` | yes, once per `setStyle` |

An empty marker string hides the marker child (`setMarker("")` calls `this._marker.setDisplayed(false)`), so the `HBox` skips it entirely — no reserved width and no gap, because box layouts iterate [`getLaidOutComponents`](packages/lib/src/typescript/lib/core/Component.ts#L5041).

### The list and its items carry explicit ARIA list roles

`AbstractMarkerList` sets `role="list"`, `ListItem` sets `role="listitem"`, and the marker `Text` sets `aria-hidden="true"`. `AriaRole` gains `'list'` and `'listitem'`.[^aria]

---

## Public API

```typescript
// component/list/ListItem.ts
export interface ListItemOptions extends ComponentOptions {
    text?: string;
}

class ListItem extends Component<ListItemOptions> {
    constructor(key: string, value: string, options?: ListItemOptions);

    getKey(): string;

    getText(): string;
    setText(text: string): this;

    /** The marker string the owning list wrote. `""` when there is no marker. */
    getMarker(): string;
    /** Called by the owning list. `""` hides the marker slot. */
    setMarker(text: string): this;
}
```

`text` is the only `ListItemOptions` field; it is written pure to `_options` by `applyOptions` and dispatched from the constructor body. The marker has no options field and no backing field of its own — `_marker.getText()` is its cache.

```typescript
// component/list/AbstractMarkerList.ts
abstract class AbstractMarkerList<U extends BulletedListItemStyle | NumberedListItemStyle>
    extends Component<AbstractMarkerListOptions<U>> {

    getStyle(): U | undefined;
    setStyle(style: U): this;

    addComponent(component: ListItem, constraints?: LayoutConstraints): this;
    insertComponent(component: ListItem, index: number, constraints?: LayoutConstraints): this;
    removeComponent(component: ListItem): LayoutConstraints | undefined;
    sortComponents(comparator: Comparator<Component, Component> | undefined): this;

    /** The marker string for the child at `index`, under the current style. */
    protected abstract markerText(index: number): string;

    /** Rewrites every child's marker. No-op when the list has no children. */
    protected renumber(): void;
}
```

```typescript
// component/list/BulletedList.ts
protected markerText(_index: number): string;

// component/list/NumberedList.ts
setStyle(style: NumberedListItemStyle): this;   // warns on an unsupported member
protected markerText(index: number): string;
```

```typescript
// core/Aria.ts — two members added to the existing union
export type AriaRole = /* … */ | 'list' | 'listitem';
```

---

## Internal Structure

Marker strings live in module-level tables beside the class that owns them.

```typescript
// component/list/BulletedList.ts
const BULLET_MARKERS: Record<BulletedListItemStyle, string> = {
    [BulletedListItemStyle.NONE]:   "",
    [BulletedListItemStyle.DISC]:   "•",   // • BULLET
    [BulletedListItemStyle.CIRCLE]: "◦",   // ◦ WHITE BULLET
    [BulletedListItemStyle.SQUARE]: "▪",   // ▪ BLACK SMALL SQUARE
};
```

```typescript
// component/list/NumberedList.ts
/** The only numbering style this component renders. Every other member falls back to it. */
const SUPPORTED_STYLES: ReadonlySet<NumberedListItemStyle> = new Set([
    NumberedListItemStyle.NONE,
    NumberedListItemStyle.DECIMAL,
]);
```

```typescript
// component/list/AbstractMarkerList.ts
protected renumber(): void {
    const items = this.getComponents() as ListItem[];

    for (let i = 0; i < items.length; i++) {
        items[i].setMarker(this.markerText(i));
    }
}
```

`renumber()` walks `getComponents()`, not `getLaidOutComponents()`, so a hidden item still consumes its number.[^count-all]

---

## Ordered Implementation Steps

1. **`core/Aria.ts`** — add `'list'` and `'listitem'` to the `AriaRole` union ([:10](packages/lib/src/typescript/lib/core/Aria.ts#L10)). Check: `npm run typecheck` in `packages/lib`.

2. **`component/list/ListItem.ts` — strip the native-marker code.** Delete `LIST_ITEM_DISPLAY`, `LIST_ITEM_MARKER_POSITION`, `MARKER_COLUMN_EM`, `FALLBACK_FONT_SIZE`, the `setElementCSSRules({ display, listStylePosition })` call in the constructor, and the `setDisplayed`, `getPreferredSize`, `setPreferredSize`, and `markerColumnWidth` members. Drop the `_consumerPreferredSize` field and the `Size` import.

3. **`component/list/ListItem.ts` — rebuild as a composite.**
   - Change `ListItemOptions extends TextOptions` to `extends ComponentOptions`, with one field: `text?: string`.
   - Change `class ListItem extends Text<ListItemOptions>` to `extends Component<ListItemOptions>`.
   - Replace the `Text` / `TextOptions` / `Size` imports with `Component`, `ComponentOptions` (from `~/core/Component.js`), `Text` (from `~/component/input/Text.js`), and `HBox` (from `~/layout/HBox.js`). Keep the `DOM` and `callable` imports.
   - Add `const MARKER_GAP_PX = 4;` — one space width at the 14px default font, so the marker and label read as two runs rather than one word.
   - Keep `_defaultListItemOptions = { tag: "li" }`.
   - Constructor: `super(options, { ..._defaultListItemOptions, layoutManager: new HBox({ spacing: MARKER_GAP_PX }) })`, then set `this._key = key`, build `this._marker = new Text()` and `this._text = new Text()`, `this.addComponent(this._marker)` and `this.addComponent(this._text, { weight: 1 })`, call `this._marker.getAria().setHidden(true)` and `this.getAria().setRole("listitem")`, then `this.setText(this._options.text ?? value)` and `this.setMarker("")`.
   - `applyOptions`: `super.applyOptions(options)` then `if (options.text !== undefined) this._options.text = options.text;` — pure write, no dispatch (mirrors [IconText:105](packages/lib/src/typescript/lib/component/display/IconText.ts#L105)).
   - Add `getText()` / `setText()` forwarding to `_text`, and `getMarker()` / `setMarker()` forwarding to `_marker`. `setMarker(text)` also calls `this._marker.setDisplayed(text.length > 0)`.
   - Keep `getKey()` and the `protected render()` that writes `dataset: { key: this._key }`; `render()` no longer writes `text`.
   - Check: `grep -nE 'list-item|listStylePosition|MARKER_COLUMN_EM' packages/lib/src/typescript/lib/component/list/ListItem.ts` — expect zero matches.

4. **`component/list/AbstractMarkerList.ts` — suppress the native marker and add the ARIA role.** In the constructor body after `super(...)`, call `this.setElementCSSRule("listStyleType", "none")` and `this.getAria().setRole("list")`. Remove the `setElementCSSRule("list-style-type", style)` line from `setStyle` ([:88](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts#L88)); `setStyle` now stores `_style` and calls `this.renumber()`. Four comments in the file still describe the CSS write and must be rewritten to say the list owns each item's marker string instead: the class JSDoc ([:23](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts#L23)), the `applyOptions` comment ([:66](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts#L66)), `getStyle`'s JSDoc ([:73](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts#L73)), and `setStyle`'s JSDoc ([:82](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts#L82)). Leave `BulletedListItemStyle.ts` / `NumberedListItemStyle.ts` alone — their doc comments describe the enum *values*, which are still CSS keywords.

5. **`component/list/AbstractMarkerList.ts` — add the renumbering surface.** Add `protected abstract markerText(index: number): string;` and the `protected renumber()` body from `## Internal Structure`. Add overrides for `insertComponent(component: ListItem, index: number, constraints?: LayoutConstraints)`, `removeComponent(component: ListItem)`, and `sortComponents(comparator: Comparator<Component, Component> | undefined)`; each calls `super`, then `this.renumber()`, then returns the value `super` produced. Import `Comparator` from `~/core/Component.js`. Leave the existing `addComponent` override untouched — it reaches `insertComponent` through `super.addComponent`.

6. **`component/list/BulletedList.ts`** — add the `BULLET_MARKERS` table and `protected markerText(_index: number): string { return BULLET_MARKERS[this.getStyle()!]; }`.

7. **`component/list/NumberedList.ts`** — add `SUPPORTED_STYLES`, a `setStyle` override that `console.warn`s when the style is not in the set (message format: `"NumberedList #" + this.getId() + ": numbering style \"" + style + "\" is not supported yet; rendering DECIMAL instead."`) and then calls `super.setStyle(style)`, and `protected markerText(index: number): string` returning `""` for `NONE` and `` `${index + 1}.` `` otherwise.

8. **`tests/component/list/MarkerListLayout.test.ts`** — delete the `ListItem — display: list-item` describe block whole, plus four cases: `reserves marker width on top of the measured text width`, `scales the marker allowance with the font size`, `leaves a consumer-pinned preferred size alone`, and `honours a preferred size passed through the options bag`. Delete the file's `MARKER_COLUMN_EM` constant and the now-unused `inlineDisplayWrites` helper. Keep every other case, including `sizes each item from its measured text, not the 100px VBox fallback` (an `HBox` reports the taller child's height, so the assertion still holds). Reword the comment `Each item's own preferred width already includes its marker column` in `reports the summed item height and widest item width` — the width now includes the marker child and the gap; the assertion is unchanged because it reads the items' own reported widths.

9. **`tests/component/list/MarkerListLayout.test.ts`** — add the new cases from `## Expected Behaviour` (marker text per style and index, renumbering, unsupported-style warning, `NONE`, marker/label geometry, `listStyleType: none`, ARIA roles).

10. **`tests/component/list/MarkedList.test.ts`** — rename the describe block `List-style enums map to their exact CSS list-style-type tokens` to `List-style enums keep their CSS keyword values` and rewrite its leading comment: the enum values are no longer written to `list-style-type`, but the members must not drift because a follow-up plan renders the rest of them. The eleven-plus-four assertions themselves stay unchanged. Also update the stale comment in the `ListItem — key / value contract` block that says `render() writes text: this._value` — the label `Text` writes it now; both of that block's assertions still hold.

11. **`tests/component/default-options-fallback.test.ts`** — add a row `{ label: 'ListItem marker gap', resolve: () => (new ListItem('k', 'v').getLayoutManager() as HBox).getComponentSpacing(), expected: 4 }`, beside the existing `IconText gap` row.

12. **Docs** — rewrite the marker paragraphs in `packages/lib/docs/components/ListItem.md`, `BulletedList.md`, and `NumberedList.md` per `## Documentation Impact`, and add two rows to the roles table in `packages/lib/docs/concepts/accessibility.md`.

13. **Run the full check set** from `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Aria.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/ListItem.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/BulletedList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/NumberedList.ts` |
| Modify | `packages/lib/tests/component/list/MarkerListLayout.test.ts` |
| Modify | `packages/lib/tests/component/list/MarkedList.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/components/ListItem.md` |
| Modify | `packages/lib/docs/components/BulletedList.md` |
| Modify | `packages/lib/docs/components/NumberedList.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |

---

## Expected Behaviour

All cases below are **unit-testable offline** through `installTestDOM` plus the font-metrics fixture, unless marked otherwise. Build lists the way `MarkerListLayout.test.ts`'s `hostList` helper does — add the items, *then* set the size.

### Marker text

1. `new BulletedList()` with three items → every item's `getMarker()` is `"•"`.
2. `setStyle(BulletedListItemStyle.CIRCLE)` on that list → every marker becomes `"◦"`; `SQUARE` → `"▪"`.
3. `new NumberedList()` with three items → markers are `"1."`, `"2."`, `"3."` in order.
4. `new BulletedList({ itemStyle: BulletedListItemStyle.SQUARE })` → markers are `"▪"` from construction, without a later `setStyle` call.

### Renumbering

5. Removing the middle item of a three-item `NumberedList` leaves markers `"1."`, `"2."` on the survivors, in order.
6. `insertComponent(item, 0)` into a three-item `NumberedList` gives `"1."` to the new item and shifts the rest to `"2."`, `"3."`, `"4."`.
7. `list.moveComponent(lastItem, 0)` renumbers: the moved item reads `"1."` and the others shift down.
8. `sortComponents(cmp)` renumbers in the sorted order.
9. `removeAllComponents()` then `doLayout()` does not throw, and the list reports a preferred height of `0`.

Worked case for 5 — a three-item `NumberedList`, removing `B`:

| | before | after |
|---|---|---|
| A | `1.` | `1.` |
| B | `2.` | *(removed)* |
| C | `3.` | `2.` |

### `NONE` and hidden markers

10. `setStyle(BulletedListItemStyle.NONE)` → every `getMarker()` is `""`, and each item's marker child reports `isDisplayed() === false`.
11. Under `NONE`, an item's preferred width equals a bare `Text` of the same label — no marker width and no gap, because `HBox` skips the undisplayed child.
12. A `ListItem` built standalone (never added to a list) has `getMarker() === ""` and a hidden marker child.

### Unsupported numbered styles

13. `numberedList.setStyle(NumberedListItemStyle.UPPER_ROMAN)` calls `console.warn` exactly once (spy on it), and the message contains `"NumberedList"`, the list's id, and `"upper-roman"`.
14. After that call, `getStyle()` still returns `UPPER_ROMAN` — the stored value is not coerced — while the markers read `"1."`, `"2."`, `"3."`.
15. `new NumberedList({ itemStyle: NumberedListItemStyle.LOWER_ALPHA })` warns once during construction and renders decimal markers.
16. `setStyle(NumberedListItemStyle.NONE)` does **not** warn, and every marker is `""`.

### Item geometry and numbering scope

17. An item's preferred width equals `markerWidth + 4 + labelWidth`, where the two widths come from bare `Text` components carrying the same strings. Derive the reference from `Text`, not from the item's own arithmetic.
18. An item's preferred height equals a bare `Text`'s preferred height for the same label, and is under `100` (the `VBox` fallback height for a child that reports nothing).
19. After `list.doLayout()`, within an item the marker sits at `x === 0` and the label at `x === markerWidth + 4`; both stay inside the item's width.
20. A hidden item still consumes its number: with items `A` (`setDisplayed(false)`), `B`, `C`, the markers are `"1."`, `"2."`, `"3."` and `B` reads `"2."`.

### CSS and semantics

21. Both list types write `listStyleType: "none"` into their own `#id` rule (assert via `ruleStyleWrites`, filtering `selector.startsWith('#')`).
22. No rule write ever carries a `listStyleType` value equal to an enum token — `setStyle(SQUARE)` must not produce `listStyleType: "square"`.
23. The list element carries `role="list"`, the item `role="listitem"`, and the marker span `aria-hidden="true"`.

### Regressions that must stay green

24. Items still stack at strictly increasing `y` with no gap and no overlap, and sit at `x === 25` (the list's left padding).
25. `getKey()`, `getText()`, `getTag() === 'li'`, and "an explicit `text` option beats the positional value" all behave as before.

### Manual verification

26. In the **demo** app's "Border" tab, east region ([BorderPanel.ts:46](packages/lib/src/typescript/BorderPanel.ts#L46)): the `BulletedList` paints one `•` per row and the `NumberedList` paints `1.`–`5.`, each marker left of its label, none clipped, none overlapping the text, and no second browser-drawn marker beside ours.
27. The browser console shows no `NumberedList` warning on that screen (both demo lists use supported styles).

---

## Verification

Run in `packages/lib`:

- `npm run typecheck`
- `npx vitest run` — the whole suite, not just the list files; `default-options-fallback.test.ts` and `MarkedList.test.ts` both move.
- `npm run lint` — one **pre-existing, unrelated** error at `component/table/cell/renderer/Link.ts:57` is expected. Confirm the count and the file are unchanged from before your edits; do not attempt a clean run.
- `npm run docs:api` — finishes with one **pre-existing** warning about `DiagramEdgeLayer.setEdges`. No new warning may appear.
- `npm run docs:llms`

Run in `packages/docs`: `npx vitest run`.

Grep checks:

- `grep -rn 'list-item' packages/lib/src/typescript/lib/component/list/` — expect zero matches.
- `grep -rn 'setElementCSSRule("list-style-type"' packages/lib/src/typescript/lib/` — expect zero matches; the only remaining `list-style-type` mentions under `component/list/` are the two enum doc comments, which stay.
- `grep -rn 'MARKER_COLUMN_EM' packages/lib/` — expect zero matches.

Manual smoke test (cases 26–27): `npm run dev` in `packages/lib`, open `http://localhost:8015`, select the **Border** tab and look at the east region. The demo app aliases `@jimka/typescript-ui/*` straight at `src/`, so no build step is needed. If you check in the **docs** app instead (`http://localhost:5173`), run `npm run build:lib` first — the docs app resolves through the package `exports` map to `dist/`, which a source edit alone does not refresh.

---

## Documentation Impact

`ListItem`, `BulletedList`, and `NumberedList` are already exported from `component/list/index.ts`; no barrel change. `ListItemOptions` loses its `TextOptions` inheritance, so the font and text fields it used to accept disappear from the generated API page — that is the intended surface.

- **`docs/components/ListItem.md`** — the intro sentence still says the item "sizes itself from that text like any other `Text`"; replace with the composite description (a marker slot beside a label, arranged by an `HBox`). Add `getMarker()` to the methods table with a note that the owning list writes it. Delete the "Notes" bullet about the browser's own marker and the width reserve — both are gone. Add a bullet saying the marker is a real child component, so it is measured and positioned like any other content.
- **`docs/components/BulletedList.md`** — state that all four `BulletedListItemStyle` members render, and that `NONE` collapses the marker slot.
- **`docs/components/NumberedList.md`** — state plainly that only `DECIMAL` and `NONE` render today, that any other member logs a warning and renders decimal, and that the enum is unchanged so existing code keeps compiling.
- **`docs/concepts/accessibility.md`** — add `BulletedList` / `NumberedList` → `list` (with `listitem` on its items) to the "Roles used by built-in components" table.
- **`llms.txt`** — regenerated by `npm run docs:llms`; do not hand-edit.

`AbstractMarkerList` is exported and now declares a protected abstract `markerText`. Any consumer subclassing it directly must implement that method — note this in the `NumberedList.md` / `BulletedList.md` prose only if the docs mention subclassing; they currently do not, so no extra page is needed.

Per CODE_CONVENTIONS.md, public JSDoc must not `{@link}` protected or internal members: describe `renumber` and `markerText` in prose from any public doc comment rather than linking them.

---

## Potential Challenges

- **The construction cascade calls `setStyle` before children exist.** `applyOptions` dispatches `setStyle`, which calls `renumber()`, during `super()` — before the subclass body runs. `renumber()`'s empty-list early return covers it, and `markerText` reads only `getStyle()`, which resolves from the base's `_style` / `_defaultOptions`. Do not have `markerText` read a subclass field.
- **`Text.setText` schedules a layout on its parent.** `renumber()` therefore schedules one layout per item; they collapse into a single `requestAnimationFrame` flush, so no extra batching is needed. Do not add a `pauseLayout` wrapper.
- **Do not measure inside `renumber()`.** Reading `getPreferredSize()` on a marker forces the off-screen text probe, and `renumber()` runs from `insertComponent` — i.e. at construction, which ARCHITECTURE.md requires to stay JS-only. Setting the string is enough; measurement happens later at layout time.
- **`_key` is assigned in the constructor body, but `render()` reads it.** `render()` only runs at first materialisation, well after the constructor, so a plain `private _key: string` assignment is safe. Do not convert it to `declare` — no cascade-dispatched setter writes it.
- **Narrowed override parameters.** `insertComponent(component: ListItem, …)` narrows the base signature; TypeScript accepts this through method bivariance, exactly as the existing `addComponent` / `removeComponent` overrides already do.

---

## Critical Files

Read before implementing:

- [component/display/IconText.ts](packages/lib/src/typescript/lib/component/display/IconText.ts) — the composite precedent this plan follows: per-instance `HBox` in the defaults bag, children built in the constructor body, option fields written pure by `applyOptions` and dispatched afterwards.
- [component/list/AbstractSelectableList.ts:1524-1545](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1524) — the renumbering precedent (`syncRows` pushing `row.setIndex(i)`), and [:423](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L423) for the setter it calls.
- [component/list/ListItem.ts](packages/lib/src/typescript/lib/component/list/ListItem.ts) and [component/list/AbstractMarkerList.ts](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts) — the current state, most of which this plan deletes.
- [core/Component.ts:4874](packages/lib/src/typescript/lib/core/Component.ts#L4874), [:4947](packages/lib/src/typescript/lib/core/Component.ts#L4947), [:4977](packages/lib/src/typescript/lib/core/Component.ts#L4977), [:5016](packages/lib/src/typescript/lib/core/Component.ts#L5016) — `insertComponent`, `moveComponent`, `removeComponent`, `sortComponents`; the mutator set the renumber hooks must cover.
- [core/Component.ts:5041](packages/lib/src/typescript/lib/core/Component.ts#L5041) — `getLaidOutComponents`, which is why hiding the marker child removes both its width and its gap.
- [layout/HBox.ts:420](packages/lib/src/typescript/lib/layout/HBox.ts#L420) — `layoutPreferredMode`, where the `weight` constraint hands the label the leftover width.
- [component/input/Text.ts:636](packages/lib/src/typescript/lib/component/input/Text.ts#L636) — `getText` / `setText`, the two calls both forwarders wrap.
- [core/Aria.ts:10](packages/lib/src/typescript/lib/core/Aria.ts#L10) — the `AriaRole` union, and [:245](packages/lib/src/typescript/lib/core/Aria.ts#L245) for `setHidden`.
- [core/StyleTarget.ts:32](packages/lib/src/typescript/lib/core/StyleTarget.ts#L32) — the camelCase key contract for every rule write.
- [tests/component/list/MarkerListLayout.test.ts](packages/lib/tests/component/list/MarkerListLayout.test.ts) — the offline harness and the `hostList` helper the new cases reuse.

---

## Non-Goals

- **The nine remaining `NumberedListItemStyle` members** (`DECIMAL_LEADING_ZERO`, `LOWER_ALPHA`, `UPPER_ALPHA`, `LOWER_GREEK`, `UPPER_GREEK`, `LOWER_LATIN`, `UPPER_LATIN`, `LOWER_ROMAN`, `UPPER_ROMAN`). Each needs its own number-to-string conversion and its own test matrix; they belong to a follow-up plan, **`marker-list-numbering-styles`**. The enum keeps all eleven members — nothing is narrowed or deleted.
- **A shared marker column that right-aligns markers.** With a plain `HBox` the label's x follows its own marker's width, so `9.` and `10.` start their labels at different offsets. Equalising the column means measuring every marker and pinning a width, which cannot happen inside `renumber()` without forcing text measurement at construction. It goes to the same follow-up plan, which has to solve marker width anyway for roman and greek numbering.
- **Reacting to a child's `setDisplayed`.** Nothing notifies a parent when a child's displayed flag flips, so markers are not recomputed on a visibility change. Numbering counts all children (case 20), which keeps every item's number stable regardless.
- **The list's 25px left indent.** Unchanged from `marker-list-layout-manager`.
- **The `VBox` default and the content-derived list size.** Delivered by `marker-list-layout-manager`; this plan neither restates nor alters them.
- **Selection state on `AbstractMarkerList`.** Still not offline-testable, still out of scope.
- **Consumer-configurable marker gap or marker component.** Not requested; the gap is a module constant.

---

## Notes

[^assume-merged]: `feature/marker-list-layout-manager` is green and independently verified for the half this plan keeps — the per-instance `VBox({ spacing: 0, stretching: true })` default, the removal of the fixed 200x200 preferred size, and the offline suite that pins item stacking. Rebuilding that work here would duplicate it and risk diverging from the version that was actually tested in a browser. The frontmatter therefore declares `depends-on: [marker-list-layout-manager]`, which makes `/implement` require that plan to be in `plans/implemented/` first. What this plan *does* undo from that branch is only its marker half: the `display: list-item` and `list-style-position: inside` rule writes, the `setDisplayed` override, and the `getPreferredSize` / `setPreferredSize` / `markerColumnWidth` marker-width estimate.

[^why-not-text]: The branch made `ListItem` a `Text` subclass so it would report a measured size. A composite reports one too — the `HBox` sums its two children — so nothing is lost on that axis. Keeping `extends Text` was investigated and does not work: `Text.setText` writes through `DOM.sink.apply(element, { text })` ([Text.ts:658](packages/lib/src/typescript/lib/component/input/Text.ts#L658)), which replaces the element's entire content, wiping any child element appended into the same `<li>`. A marker child and an owning `Text` cannot share one element. The cost of the change is that `ListItemOptions` no longer extends `TextOptions`, so per-item font options are gone; that matches `master`'s surface (where `ListItemOptions` carried only `text`) and matches `IconText`, whose options bag is likewise `glyph` / `text` / `gap` over `ComponentOptions`.

[^why-text-marker]: Two reasons. The glyph registry starts **empty** — `_glyphs` is populated by consumers via `Glyph.register`, with only four built-in `unicode-arrow-*` char entries ([Glyphs.ts:34-46](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L34)) — so a framework component cannot assume a `disc` or `square` glyph exists, and adding built-ins for them would grow the always-on registry. And a `Glyph` cannot express `"1."` at all, so numbers would need a second slot type; one `Text` slot covers bullets and numbers with a single code path. Bullet characters are ordinary Unicode (`•`, `◦`, `▪`) and render in the inherited font.

[^mutator-coverage]: `addComponent` delegates to `insertComponent` ([Component.ts:4858](packages/lib/src/typescript/lib/core/Component.ts#L4858)), and `moveComponent` is documented as expressing itself entirely through `removeComponent` + `insertComponent` so subclass overrides are honoured ([Component.ts:4947](packages/lib/src/typescript/lib/core/Component.ts#L4947)) — both are covered without their own hook. `removeAllComponents` needs no hook because there is nothing left to renumber afterwards. `sortComponents` ([Component.ts:5016](packages/lib/src/typescript/lib/core/Component.ts#L5016)) mutates the children array directly and is the only reorder path that bypasses the other two, so it gets its own override.

[^camel-key]: `StyleTarget.set` documents its key as camelCase ([StyleTarget.ts:32](packages/lib/src/typescript/lib/core/StyleTarget.ts#L32)), but a kebab-case key still reaches the stylesheet correctly: the terminal write branches on the key shape and routes anything containing `-` through `CSSStyleDeclaration.setProperty` ([DOM.ts:304-316](packages/lib/src/typescript/lib/core/DOM.ts#L304)). The existing `setElementCSSRule("list-style-type", style)` in `setStyle` therefore **does** work today. Use the camelCase `listStyleType` in the new write purely for consistency with every other `setElementCSSRule` call in the codebase — not as a bug fix, and expect no behaviour change from the spelling itself. What does change behaviour is the *value*: writing `none` suppresses the browser's own marker, which matters now that the item paints its own — without it, any future change that restored `display: list-item` on the `<li>` would produce two markers side by side.

[^warn-fallback]: Three responses were weighed. Throwing would break code that compiles today against a public enum member. Silently falling back hides a real behaviour change from anyone upgrading. Warning plus falling back is what the framework already does for an unsatisfiable request — `Popover` warns and flips to the opposite placement when an explicit one overflows ([Popover.ts:781](packages/lib/src/typescript/lib/overlay/Popover.ts#L781)) — and the `"ClassName #" + getId() + ": …"` message shape comes from [Button.ts:1674](packages/lib/src/typescript/lib/component/button/Button.ts#L1674). `getId()` is safe to call during the construction cascade because `BaseObject`'s constructor assigns the id before `Component`'s `applyOptions` runs. Storing the requested style unchanged keeps the existing `MarkedList.test.ts` round-trip assertions valid and lets the follow-up plan light up the remaining members with no further API motion. The warning fires per `setStyle` call rather than per item, so a list of 500 items still logs once.

[^count-all]: `getLaidOutComponents` (displayed children only) would match the native `<ol>` counter, which skips `display: none` items. It is rejected because nothing tells the list when a child's displayed flag changes — `Component.setDisplayed` ([:1789](packages/lib/src/typescript/lib/core/Component.ts#L1789)) notifies no parent — so the markers would go stale the moment a consumer hid an item, which is worse than counting consistently. Counting all children also keeps every item's number stable across a hide/show cycle.

[^aria]: The `<li>` no longer renders as `display: list-item`, and the list carries `list-style-type: none`. Safari drops list semantics from a `<ul>` styled that way, so a screen reader would stop announcing "list, 3 items". Explicit `role="list"` / `role="listitem"` restores it and is inert where semantics already survive. Separately, the marker is now real text inside the item, so an unguarded screen reader would read "2. Main argument" on a list whose position it already announces — `aria-hidden="true"` on the marker slot suppresses that duplicate. `AriaRole` currently lists 32 roles without `list` or `listitem` ([Aria.ts:10](packages/lib/src/typescript/lib/core/Aria.ts#L10)); ARCHITECTURE.md's typed-setter table directs exactly this case to "extend `Aria.ts` if missing".

[^gap]: `MARKER_GAP_PX = 4` is roughly one space width at the framework's 14px default font, which is what makes the marker and the label read as two runs rather than one word. It is structural separation between two content slots — the same role `IconText`'s `gap` plays ([IconText.ts:30](packages/lib/src/typescript/lib/component/display/IconText.ts#L30)) — not a cosmetic nudge, so it does not fall under ARCHITECTURE.md's *No cosmetic insets* rule.
