---
depends-on: [marker-list-component-markers]
touches-shared:
  - packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts
  - packages/lib/src/typescript/lib/component/list/ListItem.ts
---

# Marker List Numbering Styles — Implementation Plan

## Overview

[`NumberedList`](packages/lib/src/typescript/lib/component/list/NumberedList.ts) renders two of the eleven [`NumberedListItemStyle`](packages/lib/src/typescript/lib/component/list/NumberedListItemStyle.ts#L8) members. The other nine log a `console.warn` from [`setStyle`](packages/lib/src/typescript/lib/component/list/NumberedList.ts#L53) and render decimal instead. This plan gives each of the nine its own index-to-string conversion, then deletes the `SUPPORTED_STYLES` set and the warning path.

It also fixes a layout defect the nine styles would make much worse. Each item lays its marker and label out with a plain [`HBox`](packages/lib/src/typescript/lib/layout/HBox.ts), so the label's x follows its *own* marker's width. In a twelve-item `NumberedList`, `1.` measures 8px and `10.` measures 12px, so the labels start at 12 and 16 — two different left edges. Markers are also flush left inside their slots, so the full stops do not line up either. This plan gives every item in a list the same marker slot width and right-aligns the marker inside it.

The two halves ship together because the second is what makes the first look right: roman, greek and alpha markers vary in width far more than decimals do.

Three source files change — [component/list/NumberedList.ts](packages/lib/src/typescript/lib/component/list/NumberedList.ts), [component/list/AbstractMarkerList.ts](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts), [component/list/ListItem.ts](packages/lib/src/typescript/lib/component/list/ListItem.ts) — plus two test files and five doc pages. `BulletedList` is untouched.

---

## Architecture Decisions

### The list owns the marker column width and pushes it onto each item

`AbstractMarkerList` measures every item's marker at layout time, keeps the widest width in a private field, and pushes that width onto each `ListItem`, which applies it to its marker slot. The width is measured, never a constant.[^why-not-fixed]

This mirrors [`layout/Table.ts:123-131`](packages/lib/src/typescript/lib/layout/Table.ts#L123): when a width must be shared across many sibling row containers, the owning component stores it ([`component/table/Table.ts:475`](packages/lib/src/typescript/lib/component/table/Table.ts#L475) / [:486](packages/lib/src/typescript/lib/component/table/Table.ts#L486)), the layout pass recomputes it, and each row is handed the resolved numbers ([`layout/Table.ts:311`](packages/lib/src/typescript/lib/layout/Table.ts#L311)). The loop that walks every item and pushes a value through a public setter is the same shape as [`AbstractSelectableList.syncRows`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1537), which the parent plan already followed for the marker strings.

A [`Grid`](packages/lib/src/typescript/lib/layout/Grid.ts) column track cannot express this.[^why-not-grid]

### The shared width is pushed as a minimum size, never a preferred size

`ListItem.setMarkerColumnWidth(width)` calls `setMinSize({ width, height: 0 })` on its marker `Text`. It must not call `setPreferredSize`.[^why-min-not-preferred]

A minimum is enough to widen the slot *and* to keep the reported sizes honest. [`Component.getPreferredSize`](packages/lib/src/typescript/lib/core/Component.ts#L2666) floors its result at the component's own minimum constraint, so the marker reports the column width as its preferred width; `HBox` then sums the column, the gap and the label into the item's preferred width, and places the marker at exactly the column width.[^hbox-min-path]

### The marker's own measured width is read back off its preferred-size constraint

Once a minimum is applied, `marker.getPreferredSize()` returns the *column* width, not the marker's own. Measuring the column from that value would ratchet it wider and never let it shrink. `ListItem.getMarkerWidth()` therefore forces the measurement and then reads the raw measured size back through [`Component.getPreferredSizeConstraint`](packages/lib/src/typescript/lib/core/Component.ts#L2655), which is unclamped.[^raw-measurement]

### The column is recomputed in `AbstractMarkerList.doLayout`, not in `renumber`

`AbstractMarkerList` overrides [`doLayout`](packages/lib/src/typescript/lib/core/Component.ts#L5207) to call a new protected `syncMarkerColumn()` before delegating to `super.doLayout()`. It cannot live in [`renumber`](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts#L120), which runs during construction when nothing has been measured.[^why-dolayout]

### Right-alignment is `textAlign: "right"` on the marker `Text`

`ListItem` builds its marker as `new Text(undefined, { textAlign: "right" })`. The marker slot is exactly as wide as the widest marker, so every marker's trailing full stop lands on the same x. Under a bulleted list — where every marker is the same glyph and the slot is exactly that glyph's width — right alignment is indistinguishable from left, so `BulletedList` is unaffected.

### Every remaining numbering style renders; nothing warns

`SUPPORTED_STYLES` and the `NumberedList.setStyle` override are deleted. `markerText` looks the style up in a module-level table of index-to-string functions, mirroring how [`BulletedList`](packages/lib/src/typescript/lib/component/list/BulletedList.ts#L16) keeps its `BULLET_MARKERS` table beside the class that owns it.

Two conversions carry decisions worth stating up front:

- **`LOWER_ALPHA` and `LOWER_LATIN` produce identical output**, as do `UPPER_ALPHA` and `UPPER_LATIN`. CSS defines each pair as aliases of one counter style, and this framework follows that. Both members stay on the enum.[^alias]
- **Roman numerals cover 1–3999.** Item 4000 and beyond render as decimal. This is the range CSS Counter Styles gives `lower-roman` / `upper-roman`, and decimal is the fallback the spec names.[^roman-range]

The marker string for item `n` (1-based) is the style's conversion followed by a full stop, exactly as `DECIMAL` already produces `1.`:

| n | `DECIMAL` | `DECIMAL_LEADING_ZERO` | `LOWER_ALPHA` / `LOWER_LATIN` | `UPPER_ALPHA` / `UPPER_LATIN` | `LOWER_GREEK` | `UPPER_GREEK` | `LOWER_ROMAN` | `UPPER_ROMAN` |
|---|---|---|---|---|---|---|---|---|
| 1 | `1.` | `01.` | `a.` | `A.` | `α.` | `Α.` | `i.` | `I.` |
| 9 | `9.` | `09.` | `i.` | `I.` | `ι.` | `Ι.` | `ix.` | `IX.` |
| 10 | `10.` | `10.` | `j.` | `J.` | `κ.` | `Κ.` | `x.` | `X.` |
| 24 | `24.` | `24.` | `x.` | `X.` | `ω.` | `Ω.` | `xxiv.` | `XXIV.` |
| 26 | `26.` | `26.` | `z.` | `Z.` | `αβ.` | `ΑΒ.` | `xxvi.` | `XXVI.` |
| 27 | `27.` | `27.` | `aa.` | `AA.` | `αγ.` | `ΑΓ.` | `xxvii.` | `XXVII.` |

Reading the table: `DECIMAL_LEADING_ZERO` pads to a minimum of two digits and never truncates. The four alphabetic families count in bijective base-N over their alphabet — 26 latin letters, 24 greek — so the letter after the last one is the two-letter `aa` / `αα`, not a wrap back to `a`. Greek uses the 24-letter alphabet with `σ` and no final sigma `ς`. `NONE` still returns `""`.

The roman range, with the two rows that pin it:

| n | `LOWER_ROMAN` | `UPPER_ROMAN` |
|---|---|---|
| 3999 | `mmmcmxcix.` | `MMMCMXCIX.` |
| 4000 | `4000.` | `4000.` |

---

## Public API

```typescript
// component/list/AbstractMarkerList.ts
abstract class AbstractMarkerList<U extends BulletedListItemStyle | NumberedListItemStyle>
    extends Component<AbstractMarkerListOptions<U>> {

    /** The width every item's marker slot is currently widened to, in pixels. */
    getMarkerColumnWidth(): number;

    /** Recomputes the shared marker column, then lays the items out. */
    doLayout(): this;

    /** Measures every item's marker and pushes the widest width onto all of them. */
    protected syncMarkerColumn(): void;
}
```

The backing field is `private _markerColumnWidth: number = 0`. It is framework-managed derived state, so it gets **no** setter and **no** `AbstractMarkerListOptions` field (ARCHITECTURE.md, *Three non-negotiable rules*, rule 3). A plain initializer is correct — no setter dispatched during the `super()` cascade writes it.

```typescript
// component/list/ListItem.ts
class ListItem extends Component<ListItemOptions> {

    /** The marker's own measured width, before any shared column widens it. */
    getMarkerWidth(): number;

    /** Widens the marker slot to the owning list's shared column width. */
    setMarkerColumnWidth(width: number): this;
}
```

Both are public because the owning list — a different class — drives them, the same reason `setMarker` is public (ARCHITECTURE.md, *Event handling*: the inner component exposes a public domain verb). Neither reaches `ListItemOptions`; the marker `Text`'s own `minSize` is the cache.

```typescript
// component/list/NumberedList.ts
class NumberedList extends AbstractMarkerList<NumberedListItemStyle> {
    protected markerText(index: number): string;   // unchanged signature
}
```

`NumberedList.setStyle` is **removed** — the inherited `AbstractMarkerList.setStyle` is now sufficient. `SUPPORTED_STYLES` is removed.

---

## Internal Structure

### `NumberedList.ts` — the conversion table

```typescript
/** CSS `decimal-leading-zero` pads to a minimum of two digits and never truncates. */
const DECIMAL_MIN_DIGITS = 2;

/**
 * The largest item number roman numerals cover. CSS Counter Styles gives
 * `lower-roman` / `upper-roman` the range 1–3999 and falls back to `decimal`
 * outside it; above 3999 the additive symbol set has no notation left.
 */
const ROMAN_MAX = 3999;

/** Latin letters, in the order CSS's `lower-alpha` / `lower-latin` counts them. */
const LOWER_LATIN_LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** The 24 Greek letters CSS's `lower-greek` counts, with `σ` and no final sigma. */
const LOWER_GREEK_LETTERS = "αβγδεζηθικλμνξοπρστυφχψω";

/** Roman symbols in descending value order, subtractive pairs included. */
const ROMAN_SYMBOLS: ReadonlyArray<readonly [number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100,  "c"], [90,  "xc"], [50,  "l"], [40,  "xl"],
    [10,   "x"], [9,   "ix"], [5,   "v"], [4,   "iv"],
    [1,    "i"],
];

/** Every numbering style except NONE, which the caller short-circuits. */
type CountingStyle = Exclude<NumberedListItemStyle, NumberedListItemStyle.NONE>;

const NUMBER_FORMATTERS: Record<CountingStyle, (n: number) => string> = {
    [NumberedListItemStyle.DECIMAL]:              n => String(n),
    [NumberedListItemStyle.DECIMAL_LEADING_ZERO]: n => String(n).padStart(DECIMAL_MIN_DIGITS, "0"),
    [NumberedListItemStyle.LOWER_ALPHA]:          n => alphabetic(n, LOWER_LATIN_LETTERS),
    [NumberedListItemStyle.LOWER_LATIN]:          n => alphabetic(n, LOWER_LATIN_LETTERS),
    [NumberedListItemStyle.UPPER_ALPHA]:          n => alphabetic(n, LOWER_LATIN_LETTERS).toUpperCase(),
    [NumberedListItemStyle.UPPER_LATIN]:          n => alphabetic(n, LOWER_LATIN_LETTERS).toUpperCase(),
    [NumberedListItemStyle.LOWER_GREEK]:          n => alphabetic(n, LOWER_GREEK_LETTERS),
    [NumberedListItemStyle.UPPER_GREEK]:          n => alphabetic(n, LOWER_GREEK_LETTERS).toUpperCase(),
    [NumberedListItemStyle.LOWER_ROMAN]:          n => roman(n),
    [NumberedListItemStyle.UPPER_ROMAN]:          n => roman(n).toUpperCase(),
};
```

Typing the record over `CountingStyle` rather than the whole enum makes it exhaustive: adding an enum member becomes a compile error rather than a silent `undefined` lookup.

The two conversions:

```typescript
/**
 * Counts `n` in bijective base-N over `alphabet` — the "alphabetic" system CSS
 * counter styles use, where the value after the last letter is `aa`, not a wrap.
 */
function alphabetic(n: number, alphabet: string): string {
    const base = alphabet.length;
    let   out  = "";
    let   rest = n;

    while (rest > 0) {
        rest -= 1;
        out   = alphabet[rest % base] + out;
        rest  = Math.floor(rest / base);
    }

    return out;
}

/** Converts `n` to lowercase roman numerals, falling back to decimal past ROMAN_MAX. */
function roman(n: number): string {
    if (n > ROMAN_MAX) {
        return String(n);
    }

    let out  = "";
    let rest = n;

    for (const [value, symbol] of ROMAN_SYMBOLS) {
        while (rest >= value) {
            out  += symbol;
            rest -= value;
        }
    }

    return out;
}
```

`markerText` becomes:

```typescript
protected markerText(index: number): string {
    const style = this.getStyle()!;

    if (style === NumberedListItemStyle.NONE) {
        return "";
    }

    return NUMBER_FORMATTERS[style](index + 1) + ".";
}
```

### `AbstractMarkerList.ts` — the column pass

```typescript
doLayout(): this {
    if (this.isLayoutPaused()) {
        return this;
    }

    this.syncMarkerColumn();

    return super.doLayout();
}

protected syncMarkerColumn(): void {
    const items = this.getComponents() as ListItem[];
    let   width = 0;

    for (const item of items) {
        width = Math.max(width, item.getMarkerWidth());
    }

    this._markerColumnWidth = width;

    for (const item of items) {
        item.setMarkerColumnWidth(width);
    }
}
```

The pause check is duplicated from `Component.doLayout` on purpose: without it a paused list would still measure and write minimum sizes, and each write would schedule a layout on its parent.

`syncMarkerColumn` walks `getComponents()`, not `getLaidOutComponents()`, matching `renumber()`.[^count-all]

### `ListItem.ts` — the two new members

```typescript
getMarkerWidth(): number {
    // Force the lazy measurement, then read the raw measured width back off the
    // preferred-size constraint. getPreferredSize() would floor the width at the
    // shared column this item already carries, which would ratchet the column
    // wider on every pass and never let it shrink.
    this._marker.getPreferredSize();

    return this._marker.getPreferredSizeConstraint()?.width ?? 0;
}

setMarkerColumnWidth(width: number): this {
    // A minimum, not a preferred size: Text republishes its own measurement
    // through setPreferredSize, and pinning one would freeze the measurement
    // this list has to read back.
    this._marker.setMinSize({ width: width, height: 0 });

    return this;
}
```

`Component.setMinSize` ([:2854](packages/lib/src/typescript/lib/core/Component.ts#L2854)) returns early when the value is unchanged, so a settled list writes nothing on later passes and schedules no further layouts.

---

## Ordered Implementation Steps

1. **`component/list/NumberedList.ts` — add the conversions.** Add `DECIMAL_MIN_DIGITS`, `ROMAN_MAX`, `LOWER_LATIN_LETTERS`, `LOWER_GREEK_LETTERS`, `ROMAN_SYMBOLS`, the `CountingStyle` type, `NUMBER_FORMATTERS`, `alphabetic`, and `roman` from `## Internal Structure`. Give each function a JSDoc block per CODE_CONVENTIONS.md.

2. **`component/list/NumberedList.ts` — delete the warning path.** Remove `SUPPORTED_STYLES` and the whole `setStyle` override. Rewrite `markerText` to the body in `## Internal Structure`. Update the class JSDoc: every member renders now; drop the "logs a warning and renders decimal" sentence and mention that roman falls back to decimal above 3999. Check: `grep -n 'SUPPORTED_STYLES\|not supported yet' packages/lib/src/typescript/lib/component/list/NumberedList.ts` — expect zero matches.

3. **`packages/lib` typecheck.** `npm run typecheck`. The `Record<CountingStyle, …>` must compile with all ten keys present and no extras.

4. **`tests/component/list/MarkerListLayout.test.ts` — replace the unsupported-style block.** Delete the whole `NumberedList — unsupported styles` describe block (four cases). Keep the `vi` import — case 10 still needs it. Add a `NumberedList — numbering styles` block covering `## Expected Behaviour` cases 1–10, with the `ProbeNumberedList` helper that block needs.

5. **`tests/component/list/MarkedList.test.ts` — refresh one stale comment.** The comment above `List-style enums keep their CSS keyword values` ([:67-70](packages/lib/tests/component/list/MarkedList.test.ts#L67)) says "a follow-up plan renders the numbering styles this component does not cover yet". Every style renders now; say instead that the keywords are the documented public surface and must not drift. The assertions are unchanged.

6. **`component/list/ListItem.ts` — right-align the marker.** Change `this._marker = new Text();` ([:63](packages/lib/src/typescript/lib/component/list/ListItem.ts#L63)) to `new Text(undefined, { textAlign: "right" })`. Add a comment: the marker sits in a slot shared with every other item in the list, so it hugs the slot's right edge and the full stops line up.

7. **`component/list/ListItem.ts` — add the two column members.** Add `getMarkerWidth()` and `setMarkerColumnWidth(width)` from `## Internal Structure`, with the JSDoc each needs. No new import is required — both go through `Component` members the class already inherits.

8. **`component/list/AbstractMarkerList.ts` — add the column pass.** Add `private _markerColumnWidth: number = 0;`, the public `getMarkerColumnWidth()`, the `doLayout()` override, and the protected `syncMarkerColumn()` from `## Internal Structure`. Update the class JSDoc to say the list also owns the shared marker column width.

9. **`packages/lib` typecheck + list tests.** `npm run typecheck`, then `npx vitest run tests/component/list`. Every pre-existing case in `MarkerListLayout.test.ts` must still pass. `places the marker before the label inside the item` is the one to watch: it builds a one-item bulleted list, whose column equals the bullet's own width, so the column pass must leave its numbers untouched.

10. **`tests/component/list/MarkerListLayout.test.ts` — add the column block.** Add an `AbstractMarkerList — shared marker column` describe block covering `## Expected Behaviour` cases 11–19.

11. **Docs.** Apply every edit in `## Documentation Impact`.

12. **Run the full check set** from `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/list/NumberedList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/ListItem.ts` |
| Modify | `packages/lib/tests/component/list/MarkerListLayout.test.ts` |
| Modify | `packages/lib/tests/component/list/MarkedList.test.ts` |
| Modify | `packages/lib/docs/components/NumberedList.md` |
| Modify | `packages/lib/docs/components/ListItem.md` |
| Modify | `packages/lib/docs/components/BulletedList.md` |
| Modify | `packages/lib/docs/reference/changelog.md` |
| Modify | `packages/lib/docs/reference/migration.md` |

---

## Expected Behaviour

Cases 1–19 are **unit-testable offline** through `installTestDOM` plus `tests/dom/font-metrics.test-font.json`. Build lists with the existing `hostList` helper, which adds the items before setting the size. Cases 20–22 need a browser.

The offline font gives every character not listed in the fixture — every digit, letter, full stop and bullet — the 4px space advance, so a marker's measured width is `4 × character count`. Derive widths in tests from a bare `Text` (`new _Text('12.').getPreferredSize()!.width`) rather than writing the number in, following the existing cases.

### Numbering styles

Cases 1–8 read the conversion directly, without building a list per position. `markerText` is protected, so the test file declares one probe subclass beside its other helpers:

```typescript
/** Exposes the protected marker conversion so a case can check position 4000 without 4000 items. */
class ProbeNumberedList extends _NumberedList {
    marker(index: number): string {
        return this.markerText(index);
    }
}
```

Every case below indexes it zero-based, so item `n` is `probe.marker(n - 1)`.

1. Each of the six worked rows in the `## Architecture Decisions` table — n = 1, 9, 10, 24, 26, 27 — produces the listed marker under every counting style. The table has eight columns because each alias pair shares one, so cover all ten members by running both members of a pair against its column. One table-driven case, not sixty `it` blocks.
2. `DECIMAL_LEADING_ZERO` pads but never truncates: n = 1 → `01.`, n = 9 → `09.`, n = 10 → `10.`, n = 100 → `100.`.
3. `LOWER_ALPHA` past the alphabet: n = 26 → `z.`, n = 27 → `aa.`, n = 52 → `az.`, n = 53 → `ba.`.
4. `LOWER_ALPHA` and `LOWER_LATIN` agree at n = 1, 26, 27; so do `UPPER_ALPHA` and `UPPER_LATIN`.
5. `UPPER_ALPHA` is `LOWER_ALPHA` upper-cased at n = 1, 26, 27.
6. `LOWER_GREEK`: n = 1 → `α.`, n = 18 → `σ.` (not `ς.`), n = 24 → `ω.`, n = 25 → `αα.`. `UPPER_GREEK` is the same sequence upper-cased, starting `Α.`.
7. `LOWER_ROMAN` at n = 1, 4, 9, 10, 24, 40, 90, 400, 900 → `i.`, `iv.`, `ix.`, `x.`, `xxiv.`, `xl.`, `xc.`, `cd.`, `cm.`. `UPPER_ROMAN` is the same upper-cased.
8. Roman range: n = 3999 → `mmmcmxcix.`, n = 4000 → `4000.`, under both roman styles.
9. A real twelve-item `NumberedList` set to `LOWER_ROMAN` reports markers `i.` through `xii.` in order, and switching it to `UPPER_GREEK` rewrites them to `Α.` through `Μ.`. This is the case that proves the conversions are wired through `renumber`, not just callable.
10. `NONE` still yields `""` for every item, and `console.warn` is never called for any style — spy on it across the whole matrix and assert zero calls.

### The shared marker column

11. A twelve-item `NumberedList` under `DECIMAL`, after `list.doLayout()`: every item's label child reports the same `getX()`, and every item's marker child reports the same `getWidth()`.

    Worked case, x measured inside the item (the item itself sits at x = 25, the list indent):

    | marker | before: markerW / labelX | after: markerW / labelX |
    |---|---|---|
    | `1.`  | 8 / 12  | 12 / 16 |
    | `9.`  | 8 / 12  | 12 / 16 |
    | `10.` | 12 / 16 | 12 / 16 |
    | `12.` | 12 / 16 | 12 / 16 |

12. `list.getMarkerColumnWidth()` equals `new _Text('12.').getPreferredSize()!.width` for that list, and each marker child's `getWidth()` equals it.
13. The column shrinks when the widest marker goes away: build twelve items, `doLayout()`, remove items until five remain, `doLayout()` again — `getMarkerColumnWidth()` is now `new _Text('5.').getPreferredSize()!.width`, strictly less than before. This is the case that catches a ratcheting column.
14. `getMarkerWidth()` is unaffected by `setMarkerColumnWidth`: on a standalone `ListItem`, call `setMarker('1.')` then `setMarkerColumnWidth(200)`, and assert `getMarkerWidth()` still equals `new _Text('1.').getPreferredSize()!.width`.
15. Each item's preferred width equals `column + MARKER_GAP + labelWidth` after `doLayout()` (`MARKER_GAP` is the test file's existing constant), where `labelWidth` comes from a bare `Text` of the same label. The item that reports this must be one whose own marker is *narrower* than the column, so the assertion fails if only the marker's own width were counted.
16. The marker child's `getTextAlign()` is `"right"`, on both list types and on a standalone `ListItem`.
17. A `BulletedList` is unchanged: after `doLayout()`, `getMarkerColumnWidth()` equals `new _Text('•').getPreferredSize()!.width` and every label sits at that width plus `MARKER_GAP`.
18. Under `NONE` (either list type), after `doLayout()` the column is `0` and every marker child reports `isDisplayed() === false`.
19. An empty list survives `doLayout()`: no throw, `getMarkerColumnWidth()` is `0`.

### Regressions that must stay green

Every existing case in `MarkerListLayout.test.ts` and `MarkedList.test.ts` outside the deleted `NumberedList — unsupported styles` block. In particular the single-item geometry cases, which build one-item bulleted lists whose column equals the bullet's own width, so the column pass must not move anything.

### Manual verification

20. Demo app, **Border** tab, east region ([BorderPanel.ts:55](packages/lib/src/typescript/BorderPanel.ts#L55)): the `NumberedList`'s five markers `1.`–`5.` and their labels look exactly as before — one left edge, nothing clipped, nothing overlapping. All five markers are the same width, so this is the no-regression check; cases 21 and 22 are the ones that exercise the shared column.
21. Temporarily set that list to `UPPER_ROMAN`, then to `LOWER_GREEK`, and confirm the Greek and roman glyphs render in the theme font rather than as tofu boxes, and that markers of different widths still share a right edge and a label left edge. Revert the change before committing.
22. Temporarily grow that list past ten items and confirm the labels do not shift when item 10 appears, and that the list does not keep re-laying-out (the CPU stays idle once it settles). Revert before committing.

---

## Verification

Run in `packages/lib`:

- `npm run typecheck`
- `npx vitest run` — the whole suite, not just the list files.
- `npm run lint` — a small number of pre-existing, unrelated errors are expected. Record the count and files *before* editing and confirm they are unchanged; do not chase a clean run.
- `npm run docs:api` — no new warning may appear relative to a pre-edit run.
- `npm run docs:llms`

Run in `packages/docs`: `npx vitest run`.

Grep checks:

- `grep -rn 'SUPPORTED_STYLES' packages/lib/` — expect zero matches.
- `grep -rni 'not supported yet' packages/lib/` — expect zero matches, in source and docs alike.
- `grep -n 'setPreferredSize' packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts packages/lib/src/typescript/lib/component/list/ListItem.ts packages/lib/src/typescript/lib/component/list/NumberedList.ts` — expect zero matches; the column is pushed as a minimum. (`AbstractSelectableList.ts` has an unrelated call, which is why the grep names files rather than the directory.)
- `grep -rn 'console.warn' packages/lib/src/typescript/lib/component/list/` — expect zero matches.

Manual smoke test (cases 20–22): `npm run dev` in `packages/lib`, open `http://localhost:8015`, select the **Border** tab. That app aliases `@jimka/typescript-ui/*` at `src/`, so no build step is needed. If you check the docs app at `http://localhost:5173` instead, run `npm run build:lib` first — it resolves through the package `exports` map to `dist/`, which a source edit alone does not refresh.

---

## Documentation Impact

No barrel change: `NumberedList`, `AbstractMarkerList` and `ListItem` are already exported from `component/list/index.ts`, and this plan adds no new exported symbol.

- **`docs/components/NumberedList.md`** — delete the "Only `DECIMAL` and `NONE` render today…" paragraph (line 5) and the explanatory paragraph under the table (lines 35–40). Replace the three-column "Value / Renders today / Intended" table with a two-column "Value / Renders" table carrying the real output, using the worked rows from `## Architecture Decisions`. State that `LOWER_ALPHA` and `LOWER_LATIN` are aliases (as are the upper pair), that the alphabetic styles continue `aa`, `ab`, … past their alphabet, and that roman numbering falls back to decimal above item 3999. Add a sentence that every item in one list shares a marker column, so labels line up.
- **`docs/components/ListItem.md`** — add `getMarkerWidth()` and `setMarkerColumnWidth(width)` to the "Common methods" table, both noted as driven by the owning list. Add a "Notes" bullet: the marker sits in a slot as wide as the list's widest marker and is right-aligned inside it, so markers and labels line up down the list.
- **`docs/components/BulletedList.md`** — one sentence in the intro: every item shares one marker column, which for a bulleted list is the single bullet glyph's width.
- **`docs/reference/changelog.md`** — 0.3.0 is unreleased and its *Breaking changes* section already carries a marker-list entry saying nine styles warn and render decimal ([:9-18](packages/lib/docs/reference/changelog.md#L9)). **Rewrite that entry in place** rather than appending a second one, or the released notes will contradict themselves: all eleven members render, nothing warns, and markers now share a right-aligned column per list. Keep the sentence about the bullet characters being the framework's own.
- **`docs/reference/migration.md`** — same treatment for the `Marker lists paint their own bullets and numbers` section under *Upgrading from 0.2.x to 0.3.0* ([:221](packages/lib/docs/reference/migration.md#L221)). Delete the `UPPER_ROMAN` before/after code block and the "stay on 0.2.x until the remaining styles land" advice; say instead that every numbering style renders, that `UPPER_GREEK` renders uppercase Greek even though no browser ever did (it is not a predefined CSS counter style), and that roman falls back to decimal above 3999. Keep the `markerText(index)` subclass note.
- **`llms.txt`** — regenerated by `npm run docs:llms`; do not hand-edit.

Per CODE_CONVENTIONS.md, public JSDoc must not `{@link}` a protected or internal member: describe `syncMarkerColumn` in prose from any public doc comment rather than linking it.

---

## Potential Challenges

- **The reported size lags the first layout by one frame.** A parent that reads `list.getPreferredSize()` before the list has ever laid out sees item widths measured from each item's own marker, not from the shared column. The first `setMinSize` write relays a constraint change up the tree ([Component.ts:4794](packages/lib/src/typescript/lib/core/Component.ts#L4794)), which schedules one more pass; the second pass is correct and writes nothing, so it does not schedule a third. Do not "fix" this by computing the column inside `getPreferredSize` — that would mutate children from a size query, and `getPreferredSize` is on the hot layout-gathering path.
- **A repeated-write loop is the failure mode to watch for.** If `syncMarkerColumn` ever writes a *different* minimum on every pass, each pass schedules the next and the list spins. The two guards are `Component.setMinSize`'s unchanged-value early return and `getMarkerWidth()` reading the raw measurement instead of the floored one. If a browser check shows the list pegging the CPU, that is the pair to inspect first.
- **`getMarkerWidth()` returns 0 before the first measurement.** It calls `getPreferredSize()` first precisely to force the measurement, so do not reorder those two lines.
- **`Record<CountingStyle, …>` must not list `NONE`.** Including it makes the type wrong (the key is excluded) and adding it back as a `() => ""` entry reintroduces dead code the `markerText` early return already covers.
- **Greek and roman glyph coverage is a font question, not a layout one.** The offline harness gives every unlisted character the same advance, so it cannot tell whether the theme font actually has `α` or `Ω`. That is what manual case 21 is for.
- **Right alignment inside the slot is CSS, so the harness cannot see it.** `getTextAlign()` is assertable offline (case 16), but where the glyph actually paints inside its box is not modelled. Manual case 21 covers it.

---

## Critical Files

Read before implementing:

- [layout/Table.ts:123-131](packages/lib/src/typescript/lib/layout/Table.ts#L123) and [component/table/Table.ts:475-497](packages/lib/src/typescript/lib/component/table/Table.ts#L475) — the precedent: shared widths stored on the owning component, recomputed each layout pass, pushed onto each row container.
- [component/list/AbstractMarkerList.ts](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts) and [component/list/ListItem.ts](packages/lib/src/typescript/lib/component/list/ListItem.ts) — the current state this plan extends.
- [component/list/NumberedList.ts](packages/lib/src/typescript/lib/component/list/NumberedList.ts) and [component/list/BulletedList.ts:16](packages/lib/src/typescript/lib/component/list/BulletedList.ts#L16) — the file being rewritten, and the module-level marker table it mirrors.
- [component/input/Text.ts:301](packages/lib/src/typescript/lib/component/input/Text.ts#L301), [:311](packages/lib/src/typescript/lib/component/input/Text.ts#L311), [:546](packages/lib/src/typescript/lib/component/input/Text.ts#L546), [:595](packages/lib/src/typescript/lib/component/input/Text.ts#L595) — `setPreferredSize`, `setCalculatedSize`, `getPreferredSize`, `getMinSize`. The four methods that decide why the column is a minimum and how the raw measurement is read back.
- [component/input/Text.ts:695](packages/lib/src/typescript/lib/component/input/Text.ts#L695) — `setTextAlign`, and [:18](packages/lib/src/typescript/lib/component/input/Text.ts#L18) for the `textAlign` option field.
- [core/Component.ts:2655](packages/lib/src/typescript/lib/core/Component.ts#L2655), [:2666](packages/lib/src/typescript/lib/core/Component.ts#L2666), [:2709](packages/lib/src/typescript/lib/core/Component.ts#L2709), [:2854](packages/lib/src/typescript/lib/core/Component.ts#L2854) — `getPreferredSizeConstraint`, `getPreferredSize`, `clampPreferredToConstraints`, `setMinSize`.
- [core/Component.ts:5207](packages/lib/src/typescript/lib/core/Component.ts#L5207) and [:5149](packages/lib/src/typescript/lib/core/Component.ts#L5149) — `doLayout` and `isLayoutPaused`, the pair the override reproduces.
- [layout/HBox.ts:591](packages/lib/src/typescript/lib/layout/HBox.ts#L591) and [:614](packages/lib/src/typescript/lib/layout/HBox.ts#L614) — `preferredChildWidth` and `resolveChildWidth`, which are why a minimum alone widens the slot.
- [tests/component/list/MarkerListLayout.test.ts](packages/lib/tests/component/list/MarkerListLayout.test.ts) — the `hostList` helper and the geometry cases the new block sits beside.
- [tests/dom/TestDOM.ts:927](packages/lib/tests/dom/TestDOM.ts#L927) — the modelled `measureText`, which gives unlisted characters the space advance. This is why marker widths are offline-assertable at all.

---

## Non-Goals

- **A consumer-configurable marker column.** No option to force a fixed column width, to left-align markers, or to turn the shared column off. Nothing asked for it, and each would need its own options field and getter.
- **A configurable marker suffix.** The trailing full stop stays hard-coded, matching what `DECIMAL` already produced.
- **Roman numerals above 3999.** Decimal fallback, matching CSS. Overline and bracket notations for large roman numerals are not implemented.
- **Collapsing `LOWER_ALPHA` / `LOWER_LATIN` into one enum member.** They render identically but both stay, because removing a public enum member breaks compiling code for no gain.
- **Changing `HBox`.** [`HBox.getPreferredSize`](packages/lib/src/typescript/lib/layout/HBox.ts#L75) sums children's preferred widths without flooring them at their minimums, unlike the `doLayout` path. That difference does not bite here — `Component.getPreferredSize` already floors each marker at its own minimum before `HBox` ever sees it — so the manager is left alone.
- **Reacting to a child's `setDisplayed`.** Nothing notifies a parent when a child's displayed flag flips, so hiding an item neither renumbers nor resizes the column until the next layout. Unchanged from the parent plan.
- **The 25px list indent, the 4px marker gap, and the `VBox` item stacking.** All delivered by earlier plans and untouched.
- **Selection state on `AbstractMarkerList`.** Still not offline-testable, still out of scope.

---

## Notes

[^why-not-fixed]: Giving the marker slot a fixed width — an em multiple such as `1.6em`, scaled by the theme font size — does align the column, and it is cheaper than measuring. It is rejected because it is a guess about *content*, and this plan makes content vary by more than an order of magnitude. At the default 14px theme font (`Theme.ts:1328`) `1.6em` is about 22px, roughly 5.6 characters at the test font's 4px advance. That is far too wide for a bulleted list, whose `•` measures 4px and today sits snug — every bulleted list would grow a five-times-oversized gutter, a visible regression against what currently ships. It is simultaneously far too narrow for the roman styles this plan adds: `XXXVIII.` measures 32px and `MMMDCCCLXXXVIII.` measures 64px, so both overflow. No single constant serves a one-character bullet and a sixteen-character roman numeral. A multiplier does not even fit the two styles that render today: sweeping the font size from 10px to 40px, the allowance a disc bullet needs scales by about 1.4x while decimal needs about 1.07x, so a constant tuned for one is wrong for the other. This exact approach shipped as `MARKER_COLUMN_EM = 1.6` on the `marker-list-layout-manager` branch and was deleted by the pivot to component-rendered markers; do not reintroduce it. Measuring keeps the font-relative behaviour that motivated the em multiple — a measured width tracks a theme change automatically, with no constant to mis-tune — at the cost of one `O(n)` pass inside a `doLayout` that already runs.

[^why-not-grid]: [`Grid`](packages/lib/src/typescript/lib/layout/Grid.ts) supports a `"content"` [`GridTrack`](packages/lib/src/typescript/lib/layout/GridTrack.ts) mode that sizes a column to its children, which is exactly the mechanism a shared marker column wants. It cannot reach here: `Grid` sizes tracks from its container's **own direct children**, and `AbstractMarkerList`'s direct children are `ListItem`s, so each item would occupy a single cell. The marker/label split is one level deeper and invisible to the track solver, and this framework has no subgrid analogue. Making `Grid` work would mean promoting the marker and label `Text`s to direct children of the list, which deletes the `<li>` wrapper and with it per-item `role="listitem"`, `data-key`, and the whole `ListItem` public API. Verified against the code rather than assumed: `Grid`'s track resolution reads the container's children, and nothing in `GridTrack` addresses a grandchild.

[^why-min-not-preferred]: `Text.setPreferredSize` ([:301](packages/lib/src/typescript/lib/component/input/Text.ts#L301)) sets a private `_hasExplicitPreferredSize` flag, and `Text.setCalculatedSize` ([:311](packages/lib/src/typescript/lib/component/input/Text.ts#L311)) skips republishing its measurement while that flag is set. Two distinct failures follow. First, `_hasExplicitPreferredSize` is a real field initializer ([:96](packages/lib/src/typescript/lib/component/input/Text.ts#L96)), so any `preferredSize` that arrives through the `super()` cascade is reverted after `super()` returns and the measurement overwrites the pin — the failure recorded in the `marker-list-layout-manager` plan's implementation notes, under *`ListItem` also overrides `setPreferredSize`*, where it silently clobbered a `MARKER_COLUMN_EM` width estimate. Second, and fatal here even post-construction where the pin *does* stick: pinning freezes the marker's measurement, so the natural width this plan has to read back every pass would never update, and the pin also requires inventing a height the marker would then keep across theme font changes. A minimum has neither problem — it constrains width only, leaves the measurement live, and `Text.getMinSize` ([:595](packages/lib/src/typescript/lib/component/input/Text.ts#L595)) folds its own one-line height floor on top of the zero height passed in.

[^hbox-min-path]: Three places in `HBox` make a minimum sufficient. `Component.getPreferredSize` ([:2666](packages/lib/src/typescript/lib/core/Component.ts#L2666)) floors its result at the component's own minimum constraint via `clampPreferredToConstraints` ([:2709](packages/lib/src/typescript/lib/core/Component.ts#L2709)), so the marker *reports* the column width and `HBox.getPreferredSize` sums an honest item width. `HBox.preferredChildWidth` ([:591](packages/lib/src/typescript/lib/layout/HBox.ts#L591)) returns `Math.max(preferred, minSize.width)`, so the row reserves the column. `HBox.resolveChildWidth` ([:614](packages/lib/src/typescript/lib/layout/HBox.ts#L614)) applies the same floor last, after any shrink, so the marker is placed at exactly the column width and the label's x follows it.

[^raw-measurement]: `Text` republishes each measurement through `super.setPreferredSize` ([:313](packages/lib/src/typescript/lib/component/input/Text.ts#L313)), which writes it into `_options.preferredSize`. `Component.getPreferredSizeConstraint` ([:2655](packages/lib/src/typescript/lib/core/Component.ts#L2655)) returns that value untouched, while `getPreferredSize` clamps it. So the constraint is the raw measurement and the getter is the clamped one — the same quirk the `marker-list-layout-manager` notes flagged as unhelpful for a *guard* is exactly what makes an unfloored read possible. It also stays fresh: `Text.getPreferredSize` re-measures lazily whenever the text or the theme's metric generation changes, and republishes, so no cache of our own is needed. Two alternatives were rejected. Clearing the minimum before each measurement and restoring it afterwards writes `setMinSize` twice per pass, and each write relays a constraint change to the parent and schedules another layout — a spin. Caching the natural width inside `ListItem` needs its own theme-generation invalidation to avoid going stale after a font change, which is bookkeeping `Text` already does.

[^why-dolayout]: `renumber()` is the wrong hook because it runs from `insertComponent`, i.e. during construction, and measuring a marker there would force an off-screen text probe at construction time — which ARCHITECTURE.md's *Defer DOM work to render time* forbids and which the parent plan already called out. `doLayout` is the right one: it runs after sizes are resolvable, ARCHITECTURE.md's *Positioning is always absolute* names "override `doLayout` on the owning component" as a sanctioned seam for arrangements no manager generalises, and there is precedent for a component overriding `doLayout` to place or prepare state before delegating — [`AbstractSelectableList.doLayout`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L528), [`ComboBox.doLayout`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L491), [`Body.doLayout`](packages/lib/src/typescript/lib/component/table/Body.ts#L680). Overriding `getPreferredSize` instead was rejected: it is called from inside the layout-gathering recursion, so mutating children from it risks re-entrancy, and the same recursion reason is why `Component.getPreferredSize` deliberately avoids the merged bounds.

[^alias]: CSS Counter Styles defines `lower-latin` as an alias of `lower-alpha` and `upper-latin` as an alias of `upper-alpha` — the same symbol set, the same alphabetic system. Producing different sequences for them would be a framework invention with nothing to point at. Dropping two members instead would break code that compiles today for no benefit, and the enum values are asserted against their CSS keywords in `MarkedList.test.ts`. So both members stay and both map to the same formatter.

[^roman-range]: CSS Counter Styles gives the predefined `lower-roman` / `upper-roman` styles `range: 1 3999`, and a counter style falls back to `decimal` outside its range. Above 3999 the classical additive symbol set has no notation left — the medieval overline and bracket forms are not something a list marker should introduce. Following the CSS range keeps the framework's output matching what a browser drew before the marker rewrite, for every value a real list is going to reach.

[^count-all]: `syncMarkerColumn` walks `getComponents()` rather than `getLaidOutComponents()` for the same reason `renumber()` does. Nothing notifies a list when a child's displayed flag flips, so a column measured from displayed items only would go stale the moment a consumer hid an item — and worse, hiding the item carrying the widest marker would shift every remaining label sideways on the next unrelated layout. Counting all children keeps the column stable across a hide/show cycle, and a hidden item's marker still measures normally.
