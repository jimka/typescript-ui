# Marker List Layout Manager — Implementation Plan

## Overview

`BulletedList` and `NumberedList` draw every one of their `ListItem` children on top of one another at (0, 0), with no bullet or number visible. Two independent causes:

1. **Nothing stacks the items.** `AbstractMarkerList` supplies no layout manager, so [`Component.getLayoutManager`](packages/lib/src/typescript/lib/core/Component.ts#L5099) falls back to `Absolute`, which places each child at its own `getX()` / `getY()` — both `0` for a child no one ever positioned ([layout/Absolute.ts:40](packages/lib/src/typescript/lib/layout/Absolute.ts#L40)).
2. **The `<li>` is no longer a list item in CSS terms.** The framework-wide `:where(.ts-ui-component)` rule sets `display: block` on every component element ([core/ClassStyleRules.ts:38](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L38)), which removes the `::marker` box entirely. `ListItem.applyStyle()` is a no-op that used to keep the element out of the framework's per-instance positioning, but a class-wide rule cannot be opted out of that way.[^why-broken]

This plan gives `AbstractMarkerList` a real layout manager, gives `ListItem` a real measured size so that manager has something to stack, and puts `display: list-item` back on the `<li>` so the browser paints the marker.

Two source files carry the change — [component/list/AbstractMarkerList.ts](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts) and [component/list/ListItem.ts](packages/lib/src/typescript/lib/component/list/ListItem.ts) — plus the tests and doc pages that describe them. No framework file is modified.

---

## Architecture Decisions

### `AbstractMarkerList` gets a stretching, zero-spacing `VBox` as its class-default layout manager

The constructor's default bag gains `layoutManager: new VBox({ spacing: 0, stretching: true })`. This mirrors the two in-repo lists that already own their children's placement: [`AbstractSelectableList:810`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L810) (`ListRowColumn({ spacing: 0, stretching: true })`, a `VBox` subclass) and [`PickerCellList:95`](packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L95) (`new VBox({ spacing: 0, stretching: true })`).[^vbox-config]

A layout manager written into a subclass default bag stays per-instance: `resolveClassDefaults` filters `layoutManager` out of the shared frozen defaults, and `Component` keeps it in the per-instance `_defaultLayoutManager` slot instead ([core/ComponentDefaults.ts:83](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L83), [core/Component.ts:537](packages/lib/src/typescript/lib/core/Component.ts#L537)). `AbstractMarkerList` builds its default bag as a fresh object literal per construction, so each list gets its own `VBox`.

### `ListItem` becomes a `Text` subclass so it reports a measured size

`ListItem` currently reports no preferred size and no minimum size. `VBox.preferredChildHeight` falls back to `_defaultComponentHeight` (100) when both are null ([layout/VBox.ts:562](packages/lib/src/typescript/lib/layout/VBox.ts#L562)), so every item would be 100px tall. `ListItem` therefore changes its base class from `Component` to `Text`, gaining `Text`'s text measurement, one-line height floor, baseline, and font options.[^extends-text]

This is the codebase's established shape for "a leaf component that renders text into a specific HTML element": [`Legend`](packages/lib/src/typescript/lib/component/container/Legend.ts#L23) (`extends Text<LegendOptions>`, `tag: "legend"`) and [`Link`](packages/lib/src/typescript/lib/component/input/Link.ts#L142) (`extends Text<LinkOptions>`, `tag: "a"`) are the same construction.

### The `<li>` carries `display: list-item` on its own `#id` rule

`ListItem`'s constructor writes the declaration once as a static constant:

```typescript
this.setElementCSSRule("display", LIST_ITEM_DISPLAY);
```

`setElementCSSRule` queues into the component's own `#id` rule buffer and needs no element, so the write is legal from a constructor and reaches the stylesheet at first render.[^display-route]

The reason a `#id` rule is enough — and the reason `applyStyle` does not stomp it back to `block` — is the three-tier cascade the framework already runs. Worked through for `display`:

| Tier | Selector | Specificity | Value written for a `ListItem` | Result |
|---|---|---|---|---|
| Framework rule | `:where(.ts-ui-component)` | 0 (`:where` zeroes it) | `block` | loses |
| Class rule | `.ListItem` | (0,1,0) | *nothing* — `ListItem`'s defaults produce no deviation | absent |
| Component rule | `#<id>` | (1,0,0) | `list-item`, from the constructor | **wins** |
| `applyStyle` phase 1 | would write to `#<id>` | — | skipped: the inherited bag already says `block` | no write |

The last row is the load-bearing one. `applyStyle` routes its `display` write through `writeRuleDeclaration`, which drops any value the framework or class tier already delivers ([core/Component.ts:4427](packages/lib/src/typescript/lib/core/Component.ts#L4427)). `isDisplayed()` is `true`, so the value it would write is `block`, which the framework rule already carries — so it writes nothing and the constructor's `list-item` survives every re-style.

### `ListItem.setDisplayed` re-asserts `list-item` when it shows the item

`Component.setDisplayed(true)` writes an **inline** `display: block` ([core/Component.ts:1802](packages/lib/src/typescript/lib/core/Component.ts#L1802)), and inline styles outrank every rule. `ListItem` overrides the setter to write `list-item` inline instead, so hiding and re-showing an item does not silently lose its marker.[^setdisplayed]

### `ListItem`'s no-op `applyStyle` override is deleted

`Text.applyStyle` is where every font declaration reaches the element ([component/input/Text.ts:1235](packages/lib/src/typescript/lib/component/input/Text.ts#L1235)). Keeping a no-op override would suppress all of it. Deleting the override is also correct on its own terms: framework positioning is now exactly what the item wants.[^noop-removal]

### `AbstractMarkerList` drops its `preferredSize: { width: 200, height: 200 }` class default

An explicit preferred-size constraint short-circuits the layout manager entirely — `Component.getPreferredSize` returns the constraint and never asks the manager ([core/Component.ts:2666](packages/lib/src/typescript/lib/core/Component.ts#L2666)). Leaving it would pin every list at 200×200 no matter how many items it holds. With the default removed, a list reports the `VBox`'s sum-of-items height and widest-item width.[^preferred-size]

---

## Public API

`ListItem`'s options interface widens to `Text`'s, and `ListItem` inherits `Text`'s public surface (`getText` / `setText`, the font setters, `getBaseline`, `getPreferredSize`, `getMinSize`).

```typescript
// packages/lib/src/typescript/lib/component/list/ListItem.ts
export interface ListItemOptions extends TextOptions {}

class ListItem extends Text<ListItemOptions> {
    constructor(key: string, value: string, options?: ListItemOptions);

    getKey(): string;
    setDisplayed(value: boolean): this;
}
```

`AbstractMarkerList`'s signature is unchanged; only its class-default bag changes.

```typescript
// packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts
// default bag, per construction:
{
    tag,                                                  // "ul" | "ol"
    padding:       new Insets(0, 0, 0, 25),               // unchanged — the marker gutter
    layoutManager: new VBox({ spacing: 0, stretching: true }),
    itemStyle:     style,
    ...(subclassDefaults ?? {}),
}
// `preferredSize` is removed from this bag.
```

The `callable()` export block at the bottom of `ListItem.ts` (`_ListItem` / `ListItem`) is unchanged — `callable` preserves the prototype chain, so the new `extends Text` clause needs no adjustment there.

Removed: `ListItem`'s `applyStyle()` override, its private `_value` field, and its `applyOptions` override (`Text.applyOptions` dispatches `text`).

---

## Internal Structure

`ListItem` after the change — the whole class, since it is short:

```typescript
/** CSS `display` value that keeps the browser's native `::marker` box. */
const LIST_ITEM_DISPLAY = "list-item";

const _defaultListItemOptions: Partial<ListItemOptions> = {
    tag: "li",
};

class ListItem extends Text<ListItemOptions> {

    private _key: string;

    constructor(key: string, value: string, options?: ListItemOptions) {
        super(value, options, _defaultListItemOptions);

        this._key = key;

        // Static constant, written from the constructor per ARCHITECTURE.md's
        // `setElement*` caller list. Queued into this component's #id rule and
        // flushed at first render; applyStyle never overwrites it (see the
        // cascade table in the plan).
        this.setElementCSSRule("display", LIST_ITEM_DISPLAY);
    }

    setDisplayed(value: boolean): this {
        super.setDisplayed(value);

        if (value) {
            this.setElementStyle("display", LIST_ITEM_DISPLAY);
        }

        return this;
    }

    getKey() {
        return this._key;
    }

    protected render() {
        const element = super.render();

        DOM.sink.apply(element, { dataset: { key: this._key } });

        return element;
    }
}
```

`super.render()` (from `Text`) writes the text content, so `ListItem.render` only adds the `data-key` attribute.

### Geometry, worked through

A `BulletedList` 200px wide with three items, under the default `padding: Insets(0, 0, 0, 25)` and zero insets/border. `getInnerSize()` subtracts the perimeter (insets + border + padding), and `getContentInsets()` is insets + padding; CSS `left` on an absolutely-positioned child is measured from the containing block's **padding box**, so `left: 25` lands the item exactly at the content-box edge and leaves 0–25px free for the marker.

| Item | text | measured height | `x` | `y` | `width` |
|---|---|---|---|---|---|
| 0 | `"A"` | `h` | 25 | 0 | 175 |
| 1 | `"B"` | `h` | 25 | `h` | 175 |
| 2 | `"C"` | `h` | 25 | `2h` | 175 |

The list's own preferred size becomes `{ width: widestItemWidth + 25, height: 3h }`.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/list/ListItem.ts` — re-base on `Text`.**
   - Change the imports: drop `Component, ComponentOptions` from `~/core/Component.js`, add `Text, TextOptions` from `~/component/input/Text.js`. Keep `DOM` and `callable`.
   - Change `ListItemOptions` to `export interface ListItemOptions extends TextOptions {}`.
   - Change the class declaration to `class ListItem extends Text<ListItemOptions>`.
   - Change the constructor body to `super(value, options, _defaultListItemOptions);` then `this._key = key;`.
   - Delete the `declare private _value: string;` field, the `applyOptions` override, and the `applyStyle` override.
   - Add the `LIST_ITEM_DISPLAY` module constant and the constructor's `setElementCSSRule("display", LIST_ITEM_DISPLAY)` call.
   - Add the `setDisplayed` override.
   - Change `render()` to `protected render()` — matching `Text` and `Component`, whose `render` is protected; the current public visibility is accidental and nothing in the repo calls `item.render()`. Reduce its body to `super.render()` plus the `dataset: { key: this._key }` write.
   - Update the class JSDoc: it currently claims the item "suppresses framework positioning styles so the browser can render the item natively inside a list", which is no longer true. Replace with a description of the measured-text item that keeps `display: list-item`. Cross-bucket reference to `Text` must be a markdown link, not `{@link}` — `[\`Text\`](/api/component/input/classes/Text)`.
   - Check: `cd packages/lib && npm run typecheck`.

2. **`packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts` — add the layout manager, drop the fixed preferred size.**
   - Add `import { VBox } from "~/layout/VBox.js";`.
   - In the `super(...)` default bag: delete the `preferredSize` line, add `layoutManager: new VBox({ spacing: 0, stretching: true })`. Keep `tag`, `padding`, `itemStyle`, and the `...(subclassDefaults ?? {})` spread last.
   - Update the class JSDoc: drop the stale "selection state" claim (this class has no selection code) and describe the vertical stacking. Cross-bucket reference to `VBox` must be `[\`VBox\`](/api/layout/classes/VBox)`, not `{@link VBox}`.
   - Check: `grep -n 'preferredSize' packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts` — expect zero matches.

3. **`packages/lib/tests/component/list/MarkedList.test.ts` — retire the no-op assertion.**
   - Delete the `it('applyStyle is a no-op returning this', …)` case (lines 103–107); the behaviour it pins is gone.
   - Leave the remaining cases untouched — the two text-rendering cases still pass, because `Text.render` writes the text and `Text`'s positional-vs-`options.text` precedence matches the old one.
   - Check: `cd packages/lib && npx vitest run tests/component/list/MarkedList.test.ts`.

4. **`packages/lib/tests/component/list/MarkerListLayout.test.ts` — new suite.** Write the offline cases from `## Expected Behaviour` (cases 1–10) before the code is considered done. Model the host setup on [`tests/component/layout/VBox.test.ts`](packages/lib/tests/component/layout/VBox.test.ts): `installTestDOM(CONFIG)` with the `font-metrics.test-font.json` fixture, `list.getElement(true)` so `getInnerSize()` resolves, then `setWidth` / `setHeight` / `doLayout()`. Import the raw classes (`_BulletedList`, `_NumberedList`, `_ListItem`, `_Text`) as the sibling list tests do. `DOM.reset()` in `afterEach`.

5. **`packages/lib/tests/component/default-options-fallback.test.ts` — register the new class defaults.** Add two rows to the `DEFAULT_RESOLUTION` array, following the existing `IconText gap` and `Link tag` rows:
   - `{ label: 'BulletedList layout spacing', resolve: () => (new BulletedList().getLayoutManager() as VBox).getComponentSpacing(), expected: 0 }`
   - `{ label: 'ListItem tag', resolve: () => new ListItem('k', 'v').getTag(), expected: 'li' }`

   Add the `VBox` and `ListItem` imports the rows need.

6. **Docs.** Update the three affected pages (see `## Documentation Impact`).

7. **Verify.** Run everything in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/list/ListItem.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts` |
| Create | `packages/lib/tests/component/list/MarkerListLayout.test.ts` |
| Modify | `packages/lib/tests/component/list/MarkedList.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/components/ListItem.md` |
| Modify | `packages/lib/docs/components/BulletedList.md` |
| Modify | `packages/lib/docs/components/NumberedList.md` |

---

## Expected Behaviour

### Offline-testable (unit tests)

1. **The list's default manager is a zero-spacing, stretching `VBox`.** `new BulletedList().getLayoutManager()` is a `VBox` whose `getComponentSpacing()` is `0` and whose `isStretching()` is `true`. Same for `NumberedList`.
2. **Each list gets its own manager.** `new BulletedList().getLayoutManager() !== new BulletedList().getLayoutManager()`.
3. **Items stack at strictly increasing `y` with no overlap.** With three items in a list sized 200×300, `items[0].getY() === 0`, and for each later item `item.getY() === previous.getY() + previous.getHeight()` — no gaps (spacing is 0) and no overlap.
4. **Item height comes from measured text, not the 100px fallback.** `new ListItem('k', 'A').getPreferredSize()!.height` equals `new Text('A').getPreferredSize()!.height` (both derive from the font-metrics fixture), and is less than `100`.
5. **Items sit in the content column, leaving the marker gutter free.** Every laid-out item has `getX() === 25` — the list's `getContentInsets().getLeft()`, i.e. its 25px left padding.
6. **Stretching fills the content width.** In a list sized 200 wide, every item has `getWidth() === 175` (200 minus the 25px padding).
7. **The list's preferred size is content-derived, not 200×200.** A three-item list reports `getPreferredSize()!.height === 3 * itemHeight` and `getPreferredSize()!.width === widestItemPreferredWidth + 25`. Explicitly assert the height is **not** `200`.
8. **A single-item list is sane.** One item lands at `(25, 0)`; the list's preferred height equals that item's height.
9. **An empty list is sane.** `doLayout()` does not throw; `getPreferredSize()!.height === 0`; `isUnbounded(getPreferredSize()!.width)` is `true` — the `VBox` unbounded-width sentinel that every childless `VBox` container reports ([layout/VBox.ts:107](packages/lib/src/typescript/lib/layout/VBox.ts#L107)). Assert the sentinel via `isUnbounded`, never a literal.
10. **`display: list-item` reaches the item's own rule, and re-showing keeps it.**
    - After `item.getElement(true)`, `ruleStyleWrites(sink)` (exported from `tests/dom/TestDOM.ts`) contains a row whose `key` is `display` and `value` is `list-item`, for a selector starting with `#`.
    - After `item.setDisplayed(false)` then `item.setDisplayed(true)`, the **last** recorded inline `display` write is `list-item`, not `block`. Read it off the sink's `apply` ops that carry a `style.display` key, the same way `MarkedList.test.ts` reads text writes off `apply` ops.
11. **The key/text contract is unchanged.** `new ListItem('k', 'v').getKey() === 'k'`; `getText() === 'v'`; `getTag() === 'li'`; `new ListItem('k', 'positional', { text: 'override' }).getText() === 'override'`. (Cases already covered by `MarkedList.test.ts` for the rendered text; the getter assertions are new.)

### Manual verification only (the recording sink does no painting)

12. **Bullets and numbers actually render.** `npm run dev` in `packages/lib`, open `http://localhost:8015`, select the **Border** tab. The east region holds a `BulletedList` (NORTH) and a `NumberedList` (SOUTH) built in [`BorderPanel.ts:46`](packages/lib/src/typescript/BorderPanel.ts#L46).
    - The five bulleted items A–E each show a `•` and sit on separate lines.
    - The five numbered items show `1.` through `5.` in order — the counter must increment, not repeat `1.`.
    - Markers sit left of the text, inside the list's 25px gutter, not clipped.
13. **The lists no longer reserve dead space.** Each list's box hugs its five rows instead of occupying a fixed 200px band in its Border region.
14. **`setStyle` still changes the marker.** Not wired into the demo; check in the console by calling `setStyle(BulletedListItemStyle.SQUARE)` on the list and confirming the glyph changes.

---

## Verification

```bash
cd packages/lib
npm run typecheck
npx vitest run
npm run lint

cd ../docs
npx vitest run
```

Also:

- `cd packages/lib && npm run docs:api` — must finish with zero warnings; both `ListItem` and `AbstractMarkerList` JSDoc changes are on exported symbols, and a cross-bucket `{@link}` would surface here.
- `cd packages/lib && npm run docs:llms` — regenerate the capability manifest and confirm `git diff --stat packages/lib/llms.txt` is empty. The manifest quotes the `BulletedList` / `NumberedList` class summaries, so a change there would need to be committed with the regenerated file.
- `grep -rn 'applyStyle' packages/lib/src/typescript/lib/component/list/ListItem.ts` — expect zero matches.
- Manual browser check: run `npm run build:lib` from the repo root **first** if you want to check through the docs app — `packages/lib/dist` is gitignored and the docs app resolves `@jimka/typescript-ui` through the package `exports` map to `dist/`. `npm run build` is not enough; it only builds the demo-app bundle. The **demo** app needs no build step: its vite config aliases `@jimka/typescript-ui/*` straight at `src/typescript/lib/**`, so `npm run dev` in `packages/lib` (port 8015) picks up source edits directly. The demo's **Border** tab is the direct repro; use it for cases 12–14.

---

## Documentation Impact

No new exported symbol, no rename, no removal — the export barrel [`component/list/index.ts`](packages/lib/src/typescript/lib/component/list/index.ts) and the docs-app sidebar ([`packages/docs/src/content/pages.ts:224`](packages/docs/src/content/pages.ts#L224)) are unchanged. Three curated pages describe behaviour that this change makes false:

- **`packages/lib/docs/components/ListItem.md`** — the opening sentence says `ListItem` "suppresses framework positioning styles so the browser can render the item natively inside a list". Replace: the item is laid out by its list's `VBox`, sizes itself from its text, and keeps `display: list-item` so the native marker paints. Add `getText()` to the "Common methods" table alongside `getKey()`.
- **`packages/lib/docs/components/BulletedList.md`** and **`packages/lib/docs/components/NumberedList.md`** — add a sentence to each stating that items are stacked vertically by a `VBox` and that the list sizes itself to its items.
- **Pre-existing errors in the same three fences, fix while you are there:** all three pages call `list.addItem(...)` and `list.setItemStyle(...)`. Neither method exists — the real API is `addComponent(...)` and `setStyle(...)`. Docs code fences are not typechecked by the build, so nothing else will catch these.

---

## Potential Challenges

- **The `::marker` could be clipped by the framework's `overflow: hidden`.** Every component element inherits `overflow: hidden` from the framework rule, and outside markers are painted outside the item's box. Chrome does paint them; if a marker is invisible in manual check 12 while the item text is correct, that is the cause. Do not "fix" it by relaxing `overflow` on `ListItem` — report it, because the framework's `overflow: hidden` is a deliberate diagnostic for layout bugs and any change there is a framework-level decision.
- **Each `ListItem` now gets a per-instance `#id` CSS rule.** Previously the no-op `applyStyle` meant an item queued no declarations and so got no rule at all. Now each item carries font declarations plus `display`. Lists are small, so this is fine, but a list that adds and removes many items relies on `Component.dispose()` to delete the rule.
- **Border regions shrink.** With the 200×200 preferred size gone, the demo's NORTH and SOUTH regions size to their five rows. That is the intended fix, not a regression — but it changes the Border tab's appearance, so do not treat the smaller lists as a bug.
- **`ListItemOptions` widening is source-compatible but visible.** Consumers can now pass every `TextOptions` field to a `ListItem`. Nothing needs to change at existing call sites — [`BorderPanel.ts`](packages/lib/src/typescript/BorderPanel.ts) is the only application call site in the repo and passes no options.

---

## Critical Files

Read before implementing:

- [`component/list/ListItem.ts`](packages/lib/src/typescript/lib/component/list/ListItem.ts) — the file being re-based.
- [`component/list/AbstractMarkerList.ts`](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts) — the file gaining the manager.
- [`component/input/Text.ts`](packages/lib/src/typescript/lib/component/input/Text.ts) — the new base class. In particular `calculateSize` (line 324), `needsMeasure` (line 388), `getPreferredSize` (line 546), `getMinSize` (line 595), `applyStyle` (line 1235), `render` (line 1263).
- [`component/container/Legend.ts`](packages/lib/src/typescript/lib/component/container/Legend.ts) — the precedent for `extends Text` with a semantic `tag`, in 66 lines.
- [`component/input/PickerColumn.ts:87`](packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L87) — the precedent for `VBox({ spacing: 0, stretching: true })` as a list column.
- [`component/list/AbstractSelectableList.ts:550`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L550) and `:810` — the nearest sibling: a list that owns its rows' placement with a `VBox` subclass, and documents its dependence on the framework's `position: absolute`.[^selectable-relation]
- [`layout/VBox.ts`](packages/lib/src/typescript/lib/layout/VBox.ts) — `layoutPreferredMode` (line 406) for the placement arithmetic, `preferredChildHeight` (line 562) for the 100px fallback being avoided.
- [`core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) and [`core/Component.ts:4427`](packages/lib/src/typescript/lib/core/Component.ts#L4427) (`writeRuleDeclaration`) — the three-tier cascade the `display` decision rests on.
- [`tests/component/layout/VBox.test.ts`](packages/lib/tests/component/layout/VBox.test.ts) — the offline host-and-measure test recipe to copy.

---

## Non-Goals

- **Selection.** `AbstractMarkerList`'s JSDoc mentions selection state; no such code exists. This plan removes the stale sentence but adds no selection behaviour.
- **Row virtualisation, scrolling, or pooling.** `AbstractSelectableList` has all three; a marker list is a small static list and gets a plain `VBox`.
- **Item interaction** — hover, click, keyboard focus. `ListItem` stays a display-only leaf.
- **Changing the 25px gutter.** `padding: Insets(0, 0, 0, 25)` is structural (it reserves the marker column) and is kept as-is.
- **Restoring native `<ul>` / `<li>` document flow.** Rejected: the framework's absolute-positioning rule is architectural, and carving `ListItem` out of it would put one component outside the layout system.
- **Touching `core/ClassStyleRules.ts` or `core/Component.ts`.** The `display` deviation is expressible with the existing per-component rule; no framework seam is added.[^rejected-seam]

---

## Notes

[^why-broken]: `ListItem.applyStyle()` was written when `position: absolute` was emitted per instance, so skipping `applyStyle` genuinely kept the `<li>` in native document flow. Commit `c7f749d3` ("Hoist class-uniform CSS declarations onto framework and class-wide rules") moved `position: absolute` and `display: block` onto the shared `:where(.ts-ui-component)` rule. A per-instance opt-out cannot escape a class-wide rule, so from that commit on every `ListItem` has been an absolutely-positioned block: `display: block` deletes the `::marker` box, and `position: absolute` with no `top` collapses every item to the top of the list.

[^vbox-config]: `BoxLayout`'s defaults are `spacing: 5`, `stretching: false`, `mode: "preferred"`, `justify: "start"` ([layout/BoxLayout.ts:110](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L110)). Only the first two need overriding. `spacing: 0` because native list items have no inter-item gap. `stretching: true` so each item fills the list's content width rather than shrinking to its glyph box — matching what both sibling lists do, and what a future hover or selection affordance would need. `mode` stays `"preferred"` so each item takes its own measured height; `"equal"` would force every row to the tallest item's height and ignore per-item measurement. `justify` stays `"start"` so a short list packs at the top instead of centring in its allocation.

[^extends-text]: The alternative was to reimplement measurement inside `ListItem` — a `DOM.source.measureText` call plus a `_measuredGeneration` / `Util.textMetricsGeneration()` dirty check, mirroring `Text.calculateSize` / `Text.needsMeasure`. That is roughly 80 lines duplicating `Text` verbatim, including the theme-generation staleness check that exists precisely so a font-metric change re-measures lazily. `Text` is already tag-agnostic (its `tag` default is `"span"`, overridden by `Legend` to `"legend"` and by `Link` to `"a"`), so subclassing costs nothing structurally. The one behavioural import worth knowing: `Text`'s `truncate` defaults to `true`, so a `ListItem` whose text is wider than its column ellipsises rather than wrapping, and its reported minimum width caps at 100px so the parent can still shrink the list. Both are the framework-wide norm for labels.

[^display-route]: Three routes were compared. (1) The `ensureClassStyleRule` deviation machinery derives `display` from the boolean `displayed` default and can only produce `block` or `none` ([core/ClassStyleRules.ts:87](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L87)); teaching it a third value means adding a `display` field to `ComponentOptions`, a framework-wide change for one component. (2) A module-level shared `.ListItem` rule works — `StyleRule` de-duplicates by selector — but hard-codes the class name as a string while `ensureClassStyleRule` derives the same selector from `ctor.name`, so the two would silently diverge under a minifier (see the open `plans/minification-safe-class-names.md`). (3) The chosen route is what `Text.setLineClamp` already does for the same property: it writes `display: -webkit-box` straight to the component's own `#id` rule via `setElementCSSRule` ([component/input/Text.ts:1197](packages/lib/src/typescript/lib/component/input/Text.ts#L1197)), and survives re-styling for exactly the reason set out in the cascade table. An inline write in `render()` was rejected outright: `applyStyle` wipes the whole inline `style` attribute and replays only width/top/left/height/transform, so an inline `display` would be dropped on the first re-style.

[^setdisplayed]: `Component.setDisplayed` returns early when the value is unchanged and an element exists, so the override's extra write is a no-op in the common case. When no element exists yet, `setElementStyle` queues into the inline buffer, which flushes at `init()` and is then wiped by the first `applyStyle` — at which point the `#id` rule's `list-item` takes over. Every path ends at `list-item`. The alternative was to add a `protected displayValue()` hook to `Component` that both `setDisplayed` and `applyStyle` consult; it is tidier but changes a framework file for a single subclass, and `clampsToContentSize()` aside, the framework has no other such per-class display hook to follow.

[^noop-removal]: The removal is safe against the "`applyStyle` replays cached state" trap. `applyStyle` clears the inline `style` attribute and then replays `width` / `top` / `left` / `height` / `transform` from private fields ([core/Component.ts:4534](packages/lib/src/typescript/lib/core/Component.ts#L4534)) — which is exactly the geometry the new layout manager writes. Everything else `ListItem` owns lives outside the inline channel: the text is written by `render()`, `data-key` by `render()`, the fonts by `Text.applyStyle` into the `#id` rule, and `display` by the constructor into the same `#id` rule. There is no `ListItem` setter whose value would be lost. Separately, `setX` / `setY` / `setWidth` / `setHeight` ([core/Component.ts:3376](packages/lib/src/typescript/lib/core/Component.ts#L3376), `:3409`, `:3230`, `:3318`) commit through `setElementStyle`, which is independent of `applyStyle` — so the no-op override was never what stopped a layout manager from positioning the item. It only ever stopped the item from being styled.

[^preferred-size]: This is the "content-sized subclass must clear an inherited fixed 200×200 preferred size" trap: an explicit constraint wins over the layout manager's derived size, so short content leaves dead space. `getPreferredSizeConstraint()` reads `"preferredSize" in this._options ? … : this._defaultOptions.preferredSize ?? null` ([core/Component.ts:2655](packages/lib/src/typescript/lib/core/Component.ts#L2655)); with the key absent from the defaults bag it returns `null` and `getPreferredSize` falls through to `layoutManager.getPreferredSize()`. A caller who genuinely wants a fixed-size list can still pass `preferredSize` in the options bag. The visible consequence is that the demo's Border NORTH/SOUTH regions shrink from a 200px band to the height of their five rows.

[^selectable-relation]: `AbstractSelectableList` is the nearest in-repo relative: a list component that owns its children's placement rather than delegating to the browser. Its rows are stacked by `ListRowColumn` — a `VBox` subclass configured `{ spacing: 0, stretching: true }` — and it documents, at `applyRowClass`, that a full `class`-attribute rewrite must re-state `COMPONENT_CLASS` or the rows lose the framework rule's `position: absolute` and pile up at `top: auto`. That is the same failure mode this plan fixes, arrived at from the other direction. The difference in scope is deliberate: `AbstractSelectableList` also owns a scroll `Panel`, a renderer pool, row virtualisation, and selection state, and subclasses `VBox` purely to separate the horizontal-overflow inflation target from the reported minimum width. A marker list has none of those needs, so it takes a plain `VBox` and no subclass.

[^rejected-seam]: Two framework changes were considered and rejected. Adding a `display` field to `ComponentOptions` would give `ensureClassStyleRule` a third value to hoist, but it collides conceptually with the existing boolean `displayed` and would need a typed setter, a getter fold, an options-bag entry, and a default-resolution registry row — a large surface for one component. Adding a `protected displayValue(): string` hook to `Component` (overridden to `"list-item"` in `ListItem`) is much smaller and would make both the `applyStyle` path and the `setDisplayed` path correct in one place; it was still rejected because a per-component `#id` rule already expresses the deviation with no framework edit, and the codebase has an existing precedent for that route in `Text.setLineClamp`.

---

## Implementation Notes

Three deviations, all forced by one discovery the plan anticipated but could not resolve offline.

### The marker had to move inside the item box

The plan's `## Potential Challenges` flagged that the framework's `overflow: hidden` might clip the `::marker`, and instructed the implementer to report it rather than relax `overflow`. It does clip it: with `display: list-item` restored, the items stacked correctly but **no bullet or number painted at all**. Setting `overflow: visible` on a single `<li>` in the live page made that one item's bullet appear, confirming the item's own overflow is the clipper — an `outside` marker is painted beyond the item's box, so the item clips its own marker.

Relaxing `overflow` was rejected for the reason the plan gives, and additionally because `Text`'s ellipsis truncation depends on `overflow: hidden`. The fix is `list-style-position: inside`, written alongside `display` into the same `#id` rule: the marker becomes inline content of the item, so `overflow: hidden` no longer has anything to clip. Verified in the browser — bullets and correctly incrementing numbers both paint. The user chose this over the two alternatives.

This makes the plan's `## Non-Goals` entry "changing the 25px gutter" partly moot in spirit: the padding is kept exactly as the plan requires, but it now reads as a plain indent rather than the marker's column, because the marker no longer paints there.

### `ListItem` overrides `getPreferredSize` to reserve marker width

An `inside` marker is content the browser prepends to the item, but text measurement only ever sees the string — so every item under-reported its width and the marker pushed the text out of the box. This was visible on the `NumberedList`, where items were handed 38px boxes for 42–53px of content and truncated.

`ListItem.getPreferredSize()` therefore widens the measured width by a marker allowance. The plan did not call for this override; it follows from the `inside` decision above, and without it the fix is visibly broken for any item whose text nearly fills its column.

The allowance is **font-relative**, not a fixed pixel count. Measured across 10–40px font sizes the marker holds steady at ~1.4x the font size for `disc` and ~1.07x for a single-digit `decimal`, so the constant is `1.6` em-equivalents and is re-derived from the resolved font size on every call. A fixed pixel constant was written first and rejected: the marker is a glyph drawn at the item's font size, so a theme that enlarges the font would have made the marker outgrow a fixed reserve and truncate the text again.

**Known limitation:** the allowance is an estimate, not a measurement — the browser generates the marker and never exposes its width. A marker wider than 1.6em still crowds its text: a three-digit number, or `UPPER_ROMAN` past `VIII.`. This is recorded on the `ListItem` doc page. Removing the estimate means not using the browser's marker at all — rendering the marker as a real child component so the framework measures it — which is a different design and a separate plan.

### `ListItem` also overrides `setPreferredSize`

The plan's `## Public API` lists only `getKey` and `setDisplayed` as `ListItem`'s own members. A third was needed. The marker allowance must not widen a size the consumer pinned, and the usual guard — `getPreferredSizeConstraint() !== null`, as `Markdown.getPreferredSize` uses — does not discriminate here: `Text.setCalculatedSize` publishes its own *measurement* through `super.setPreferredSize`, so the constraint is non-null for every measured item and the guard would have disabled the allowance entirely. `Text` records the distinction in a private `_hasExplicitPreferredSize`, which a subclass cannot read.

`ListItem` therefore tracks the pin itself, mirroring `Button._consumerSetPreferredSize` (`component/button/Button.ts:357`, guard at `:1891`) — but it keeps the pinned **size**, not just a flag, and returns that copy directly.

A flag alone was written first and is not enough. A `preferredSize` supplied through the options bag reaches the same setter during the construction cascade, so the flag is set correctly — but `Text._hasExplicitPreferredSize` (`component/input/Text.ts:96`) is a real field initializer, so it resets to `false` after `super()` returns, and `Text.setCalculatedSize` then overwrites the pin with its own measurement. Reading the pin back through `super.getPreferredSize()` therefore returns the measurement, and a flag-guarded override would hand back a size that is neither pinned nor widened. Returning the stored copy makes the options bag — this project's preferred construction style — behave identically to the setter.

The underlying reset is a pre-existing `Text` defect, not something this branch introduced; it is worked around here rather than fixed, because changing `Text`'s explicit-size bookkeeping affects every text-bearing component in the framework.

### Test host ordering, and one plan check that no longer greps clean

`## Ordered Implementation Steps` step 4 says to model the test host on `tests/component/layout/VBox.test.ts`, which sizes the host before adding children. That recipe assumes a `Container` host, whose `clampsToContentSize()` is `false`. A marker list is a plain `Component`, so its committed size is clamped against what its children imply, and sizing an empty list clamps it to its 25px padding. The suite therefore adds items **before** calling `setWidth` / `setHeight`.

`## Verification` lists `grep -rn 'applyStyle' ListItem.ts — expect zero matches`. The override is gone as intended, but the file still mentions `applyStyle` in a comment explaining why the `#id` rule survives re-styling, so the literal grep returns one hit. Check for the method instead: `grep -nE '^\s+(protected |public )?applyStyle\s*\(' ListItem.ts`.
