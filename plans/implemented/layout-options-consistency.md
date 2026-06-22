# Layout Options-Bag Consistency & Typing Hygiene — Implementation Plan

## Overview

Five small, independent, mechanical consistency fixes across the layout managers under [`src/typescript/lib/layout/`](../src/typescript/lib/layout/). They came out of an audit of every layout manager's options bag. **No behavior changes** — pure renames and type tightening. Each item is a self-contained commit (the project enforces one-functionality-per-commit), and the items have no dependencies on each other except that **item 4's Split half folds into item 3** (handled by ordering item 3 before/together-with item 4's Split portion).

The managers all use the `callable()` wrapper pattern — `const XCallable = callable(_X); export { _X as _X, XCallable as X }` — and are re-exported through the per-subpath barrel [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) (there is no root barrel). Renamed setters/options surface through both the class form (`new Border({...})`) and the callable form (`Border({...})`), so the option-literal call sites matter as much as the method call sites.

Out of scope: the shared main-axis alignment vocabulary for Box/Flow (covered by `layout-main-axis-vocabulary.md`). [`BoxLayout.ts`](../src/typescript/lib/layout/BoxLayout.ts) and [`FlowLayout.ts`](../src/typescript/lib/layout/FlowLayout.ts) are not touched here.

---

## Architecture Decisions

### Item 2 key name — `fillHeight`, not `stretchContent`

`fillHeight` reads clearly and stays close to the existing vocabulary (the option absorbs the container's *leftover height*). `stretchContent` is vaguer about the axis. Going with **`fillHeight`** per the audit's lean. The point of the rename is removing the type-collision trap where the bare key `fill` means a `FillType` enum in [`Fit`](../src/typescript/lib/layout/Fit.ts) (`fill`) and [`Grid`](../src/typescript/lib/layout/Grid.ts) (`defaultFill`) but a `boolean` in Accordion — a `boolean` key named `fillHeight` can never be confused with a `FillType` key named `fill`.

### Item 3 — `SplitDirection` is a string-literal union, not bare `string`

Split's `direction` is currently typed `string` — the only orientation/mode field in the whole layout package not given a literal union (Tab has `TabOrientation`, `TabSide`, etc.; Anchor has `AnchorValue`). Introduce `export type SplitDirection = "horizontal" | "vertical";` and thread it through the option, the setter parameter, the `_direction` field, and the `getDirection()` return.

### Item 4 — primitive `string`, no branded `ComponentId`

Both Split (`_direction: String`) and Card (`_visibleComponentId: String`, etc.) use the boxed `String` wrapper object. `new String("x") !== "x"` is a latent identity bug — Card only works today because [`Card.ts:220`](../src/typescript/lib/layout/Card.ts#L220) compares with `==` (loose) rather than `===`. Widen to the primitive `string`. [`Component.getId()`](../src/typescript/lib/core/BaseObject.ts#L24) already returns primitive `string`, and the call sites in [`Cell.ts`](../src/typescript/lib/component/table/cell/Cell.ts) pass `editor.getId()` (a `string`), so this *aligns* the types rather than changing them.

**Non-Goal (hard constraint):** do **not** introduce a nominal/branded `ComponentId` type. Just the primitive widening. Card's id stays a plain `string`.

### Item 5 — Split adopts the house `constructor(options?: SplitOptions)` shape

Split is the lone layout manager still carrying a legacy dual-form constructor with runtime type-sniffing ([`Split.ts:70-86`](../src/typescript/lib/layout/Split.ts#L70)): `constructor(direction?: String | SplitOptions, options?: SplitOptions)`. Every other manager (Border, Accordion, Card, Fit, Grid, …) is `constructor(options?: XOptions)`. Collapse Split to `constructor(options?: SplitOptions)`; `direction` arrives via the options field (item 3). The one positional source call site is rewritten to the options form.

### `String(getDirection())` wrappers in DockRegion — left as-is

[`DockRegion.ts`](../src/typescript/lib/layout/DockRegion.ts) wraps `getDirection()` in `String(...)` four times (lines 350, 374, 424, 447) precisely because the return was boxed `String`. After item 3 these become redundant (comparing a primitive `string` to `axis`), but they remain correct and harmless. Removing them is unrelated cleanup outside the "surgical changes" rule, so leave them. Mention, don't touch.

---

## Public API (TypeScript Signatures)

### Item 1 — Border

```typescript
export interface BorderOptions extends LayoutManagerOptions {
    spacing?: number;            // was: gap?: number
}

class Border extends LayoutManager {
    private _spacing: number = 5;                 // was: _gap, default unchanged
    getComponentSpacing(): number;               // was: getComponentGap()
    setComponentSpacing(spacing: number): this;  // was: setComponentGap(gap)
}
```

### Item 2 — Accordion

```typescript
export interface AccordionOptions extends LayoutManagerOptions {
    // ...
    fillHeight?: boolean;        // was: fill?: boolean
}

class Accordion extends LayoutManager {
    private _fillHeight: boolean = false;   // was: _fill
    isFillHeight(): boolean;               // was: isFill()
    setFillHeight(value: boolean): this;   // was: setFill(value)
}
```

### Item 3 — Split direction typing

```typescript
export type SplitDirection = "horizontal" | "vertical";

export interface SplitOptions extends LayoutManagerOptions {
    direction?: SplitDirection;  // was: direction?: string
    collapsedPanes?: number[];
}

class Split extends LayoutManager {
    private _direction: SplitDirection = "horizontal";   // was: String
    getDirection(): SplitDirection;
    setDirection(direction: SplitDirection): this;       // was: direction: String
}
```

`SplitDirection` must be added to the barrel's `export type { SplitOptions } from '~/layout/Split.js'` line.

### Item 4 — Card primitive `string`

```typescript
class Card extends LayoutManager {
    private _visibleComponentId: string | null = null;   // was: String | null
    getVisibleComponentId(): string | null;             // was: String | null
    setVisibleComponentId(id: string): this;            // was: id: String
}
```

### Item 5 — Split constructor

```typescript
class Split extends LayoutManager {
    constructor(options?: SplitOptions);   // was: (direction?: String | SplitOptions, options?: SplitOptions)
}
```

The new body drops the `typeof direction === 'string' || direction instanceof String` sniff; it simply does `if (options) { this.applyOptions(options); }` — mirroring Border/Card/Accordion. `applyOptions` already routes `direction` and `collapsedPanes`, so no logic moves.

---

## Ordered Implementation Steps

Each numbered step is **one commit**. Items are independent; the only coupling is that Split's `String → SplitDirection` widening (item 4's Split half) is satisfied by item 3, so item 3 lands before item 5.

### Step 1 — Border `gap` → `spacing` (commit 1)

In [`Border.ts`](../src/typescript/lib/layout/Border.ts):
1. `BorderOptions.gap?: number` → `spacing?: number` (line 39).
2. Field `_gap: number = 5` → `_spacing: number = 5` (line 60). Default unchanged.
3. `applyOptions`: `options.gap` → `options.spacing`, `this.setComponentGap(options.gap)` → `this.setComponentSpacing(options.spacing)` (lines 109–111).
4. Getter `getComponentGap()` → `getComponentSpacing()` (line 196); update its body `return this._gap` → `return this._spacing`.
5. Setter `setComponentGap(gap)` → `setComponentSpacing(spacing)` (lines 205–209); body `this._gap = gap` → `this._spacing = spacing`.
6. Internal `_gap` reads in `computeTotalMinSize` (lines 789, 804) and `doLayout` (lines 941, 958, 1043, 1052) → `_spacing`.
7. Update the JSDoc on `applyOptions` (line 102 "dispatching the inter-region gap") and the getter/setter doc verbs if they say "gap" — match existing style, minimal touch.

Call sites to update in the **same commit**:
- [`Dialog.ts:500`](../src/typescript/lib/core/Dialog.ts#L500): `layout.setComponentGap(0)` → `layout.setComponentSpacing(0)`.

Checkpoint: `grep -rn 'setComponentGap\|_gap\b' src/typescript/lib/layout/Border.ts` → expect zero.

### Step 2 — Accordion `fill` → `fillHeight` (commit 2)

In [`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts):
1. `AccordionOptions.fill?: boolean` → `fillHeight?: boolean` (line 95).
2. Field `_fill: boolean = false` → `_fillHeight` (line 150).
3. `applyOptions`: `options.fill` / `this.setFill(options.fill)` → `options.fillHeight` / `this.setFillHeight(options.fillHeight)` (lines 208–210).
4. Getter `isFill()` → `isFillHeight()` (line 450); body `return this._fill` → `this._fillHeight`.
5. Setter `setFill(value)` → `setFillHeight(value)` (line 465); body `this._fill = value` → `this._fillHeight`.
6. Internal `_fill` read in `computeFill` (line 1370 `if (!this._fill ...)`) → `_fillHeight`.
7. Update doc verbs mentioning "fill mode" only where the symbol name appears; keep "fill mode" prose unchanged where it describes behavior.

Call sites to update in the **same commit**:
- [`AccordionDemoPanel.ts:95`](../src/typescript/AccordionDemoPanel.ts#L95): `.setFill(true)` → `.setFillHeight(true)`.
- [`AccordionDemoPanel.ts:149`](../src/typescript/AccordionDemoPanel.ts#L149): `.isFill()` → `.isFillHeight()`.
- [`AccordionDemoPanel.ts:151`](../src/typescript/AccordionDemoPanel.ts#L151): `.setFill(next)` → `.setFillHeight(next)`.

(No `fill:` option-literal call sites exist for Accordion — the demo uses the setters.)

Checkpoint: `grep -rEn '\b(setFill|getFill|isFill)\b' src/typescript/lib/layout/Accordion.ts` → expect zero; `grep -rn '_fill\b' src/typescript/lib/layout/Accordion.ts` → expect zero. (Beware `Fit.ts` has its own legitimate `setFill`/`getFill` for `FillType` — do not touch.)

### Step 3 — Split `direction` typed as `SplitDirection` (commit 3)

In [`Split.ts`](../src/typescript/lib/layout/Split.ts):
1. Add `export type SplitDirection = "horizontal" | "vertical";` near the top (after the imports / `GUTTER_SIZE`).
2. `SplitOptions.direction?: string` → `direction?: SplitDirection` (line 25).
3. Field `_direction: String = "horizontal"` → `_direction: SplitDirection = "horizontal"` (line 39). (This also satisfies item 4's Split half — the boxed `String` is gone.)
4. `getDirection()` — annotate return `: SplitDirection` (line 261; currently inferred). Optional but makes the public surface explicit and matches the audit's intent.
5. `setDirection(direction: String)` → `setDirection(direction: SplitDirection)` (line 270).

Barrel: [`layout/index.ts:41`](../src/typescript/lib/layout/index.ts#L41) `export type { SplitOptions } from '~/layout/Split.js'` → add `SplitDirection`:
`export type { SplitOptions, SplitDirection } from '~/layout/Split.js';`

Call sites — verify these still typecheck (they already pass literal unions, so no edits expected):
- [`LayoutSerialization.ts:195`](../src/typescript/lib/layout/LayoutSerialization.ts#L195) compares `manager.getDirection() === "vertical"` — now exact-typed.
- [`DockRegion.ts:350,374,424,447`](../src/typescript/lib/layout/DockRegion.ts#L350): `String(regionLm.getDirection()) === axis` — still compiles; leave the `String(...)` wrappers (see Architecture Decisions).
- `SplitOptions.direction` is passed to `new SplitGutter(this._direction, …)` at [`Split.ts:749`](../src/typescript/lib/layout/Split.ts#L749); `SplitGutter`'s constructor takes boxed `String`, and a primitive `string`/literal union is assignable to `String`, so this still compiles unchanged. (SplitGutter's own boxed `String` is out of scope.)

Checkpoint: `grep -n ': String' src/typescript/lib/layout/Split.ts` → expect zero (the `_direction`, setter param, and option are all `SplitDirection` now; item 5 removes the last `String` in the constructor signature).

### Step 4 — Card boxed `String` → primitive `string` (commit 4)

In [`Card.ts`](../src/typescript/lib/layout/Card.ts):
1. Field `_visibleComponentId: String | null = null` → `string | null` (line 27).
2. `getVisibleComponentId(): String | null` → `string | null` (line 59).
3. `setVisibleComponentId(id: String)` → `id: string` (line 176).
4. Scan Card for any other boxed `String`/`Number`/`Boolean` — there are none beyond `_visibleComponentId` (verified). `getId() == this._visibleComponentId` at line 220 keeps working (now `string == string`); leaving `==` is a surgical no-op, but if the implementer prefers, tightening to `===` is now safe — **not required**, leave as-is to honor surgical-changes.

Call sites — already pass primitive `string`, no edits expected:
- [`Cell.ts:299,353,457`](../src/typescript/lib/component/table/cell/Cell.ts#L299): `setVisibleComponentId(editor.getId())` etc. — `getId()` returns `string`.

**Non-Goal reminder:** no branded `ComponentId`. Primitive `string` only.

Checkpoint: `grep -n 'String' src/typescript/lib/layout/Card.ts` → expect zero.

### Step 5 — Split single-options constructor (commit 5)

In [`Split.ts`](../src/typescript/lib/layout/Split.ts), constructor at lines 70–86:

Replace
```typescript
constructor(direction?: String | SplitOptions, options?: SplitOptions) {
    // eslint-disable-next-line local/forward-super-options
    super();

    if (direction === undefined || typeof direction === 'string' || direction instanceof String) {
        if (direction) {
            this._direction = direction;
        }
        if (options) {
            this.applyOptions(options);
        }
    } else {
        this.applyOptions(direction);
    }
}
```
with
```typescript
constructor(options?: SplitOptions) {
    // LayoutManager's constructor takes no options; applied via applyOptions below.
    // eslint-disable-next-line local/forward-super-options
    super();

    if (options) {
        this.applyOptions(options);
    }
}
```

Positional call site to rewrite in the **same commit**:
- [`LayoutSerialization.ts:430`](../src/typescript/lib/layout/LayoutSerialization.ts#L430): `const split = new Split(node.direction);` → `const split = new Split({ direction: node.direction });`. `node.direction` is typed `"horizontal" | "vertical"` ([`LayoutSerialization.ts:71`](../src/typescript/lib/layout/LayoutSerialization.ts#L71)), so it slots straight into `SplitOptions.direction: SplitDirection`.

No-arg call sites unaffected (already valid under `options?`):
- [`SplitPanel.ts:21,31`](../src/typescript/SplitPanel.ts#L21): `new Split()`.

Already-options call sites unaffected:
- [`SplitPanel.ts:16`](../src/typescript/SplitPanel.ts#L16): `new Split({ direction: "vertical" })`.
- [`DockRegion.ts:455`](../src/typescript/lib/layout/DockRegion.ts#L455): `new Split({ direction: axis })`.
- [`Dock.ts:372`](../src/typescript/lib/core/Dock.ts#L372): `new Split({ direction: spec.split })`.

Checkpoint: `grep -rEn 'new Split\([^){]' src/` → expect zero (no positional-argument constructor calls remain); `grep -n 'String' src/typescript/lib/layout/Split.ts` → expect zero.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Border.ts` (item 1) |
| Modify | `src/typescript/lib/core/Dialog.ts` (item 1 call site) |
| Modify | `src/typescript/lib/layout/Accordion.ts` (item 2) |
| Modify | `src/typescript/AccordionDemoPanel.ts` (item 2 call sites) |
| Modify | `src/typescript/lib/layout/Split.ts` (items 3, 5) |
| Modify | `src/typescript/lib/layout/index.ts` (item 3 — export `SplitDirection`) |
| Modify | `src/typescript/lib/layout/LayoutSerialization.ts` (item 5 call site) |
| Modify | `src/typescript/lib/layout/Card.ts` (item 4) |
| Modify | `docs/layouts/Border.md` (item 1 — see Documentation Impact) |
| Modify | `docs/layouts/Accordion.md` (item 2) |
| Modify | `docs/layouts/Split.md` (items 3, 5) |
| Modify | `docs/recipes/component-options.md` (item 5 — positional-form mention) |

---

## Verification

1. **Typecheck / build clean:** `npm run build` (or the project's `tsc` step) with 0 errors. The literal-union widening (item 3) and primitive widening (item 4) must not surface new assignability errors at the enumerated call sites.
2. **Docs build clean:** `npm run docs:build` → 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
3. **Grep invariants (old names gone in the relevant managers):**
   - `grep -rn 'setComponentGap\|getComponentGap' src/` → 0.
   - `grep -rn '_gap\b' src/typescript/lib/layout/Border.ts` → 0.
   - `grep -rEn '\b(setFill|getFill|isFill)\b' src/typescript/lib/layout/Accordion.ts src/typescript/AccordionDemoPanel.ts` → 0. (Note: `Fit.ts` keeps its `setFill`/`getFill` for `FillType` — that's expected and untouched.)
   - `grep -rn '_fill\b' src/typescript/lib/layout/Accordion.ts` → 0.
   - `grep -n 'String' src/typescript/lib/layout/Split.ts src/typescript/lib/layout/Card.ts` → 0.
   - `grep -rEn 'new Split\([^){]' src/` → 0 (no positional constructor calls).
4. **Manual smoke (no behavior change expected):**
   - **Split** demo screen (main.ts "Split" tab → `SplitPanel`): panes render and drag as before; the serialization round-trip (`LayoutSerializationPanel`) still rebuilds horizontal/vertical splits.
   - **Accordion** demo (`AccordionDemoPanel`): the Fill toggle button still flips the bottommost-section-fills behavior.
   - **Border**-based screens (Dialog, Window header): inter-region spacing unchanged (default still 5; Dialog still 0).
   - **Card**: a table cell (`Cell`) still swaps renderer/editor correctly.

---

## Documentation Impact

All three of items 1, 2, 3 (and 5's signature) are consumer-visible public-API renames. Run the **document** skill after implementation. The `layout` barrel ([`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts)) exports every affected symbol: `Border`/`BorderOptions` (lines 22–23), `Accordion`/`AccordionOptions` (15–16), `Split`/`SplitOptions` (40–41, **add `SplitDirection`**), `Card`/`CardOptions` (44–45).

Curated pages and the exact references to update (`grep -rln` confirmed):

- **Item 1 — [`docs/layouts/Border.md`](../docs/layouts/Border.md):**
  - Line 29: `BorderLayout({ gap: 4 })` → `BorderLayout({ spacing: 4 })`.
  - Line 38: prose "accepts `gap` declaratively … the `setComponentGap` setter still works" → `spacing` / `setComponentSpacing`.
  - (Pre-existing drift, out of scope: [`Border.ts:33`](../src/typescript/lib/layout/Border.ts#L33) JSDoc claims `BorderOptions` is re-exported as `BorderLayoutOptions`, but the barrel actually exports it as `BorderOptions`. Mention to the user; do not fix here.)

- **Item 2 — [`docs/layouts/Accordion.md`](../docs/layouts/Accordion.md):**
  - Line 49 options table row: ``| `fill` | `setFill` / `isFill` | … ``→ ``| `fillHeight` | `setFillHeight` / `isFillHeight` | …``. The "See [Fill mode](#fill-mode)" link and the `## Fill mode` heading (line 102) describe *behavior* (the words "fill mode") and need no anchor change — only the symbol names in the table row change. Confirm the `#fill-mode` anchor still resolves (heading text unchanged).
  - Line 104 prose "With `fill` on" → "With `fillHeight` on" (this is the option key, not the behavior name).

- **Item 3 / 5 — [`docs/layouts/Split.md`](../docs/layouts/Split.md):**
  - Line 28: "The legacy positional `Split('horizontal')` form and the `setDirection` setter still work." The positional form is **removed** by item 5 — rewrite to drop the "legacy positional `Split('horizontal')` form" claim, keeping only the `setDirection` mention.
  - `direction` examples (lines 22, 65) already use the options form — no change. The `setDirection(value)` row (line 89) is still accurate.
  - Optionally document the new `SplitDirection` type alias where `direction` is introduced (line 28 area), linking `/api/layout/type-aliases/SplitDirection` once the barrel export lands.

- **Item 5 — [`docs/recipes/component-options.md`](../docs/recipes/component-options.md):**
  - Line 192: "The previous positional `VBox(spacing)` and `Split(direction)` signatures still compile…" — `Split(direction)` no longer compiles after item 5. Update to drop `Split(direction)` from that sentence (leave the `VBox(spacing)` claim, which is unaffected by this plan).

- **Item 4 — Card:** [`docs/layouts/Card.md`](../docs/layouts/Card.md) references `setVisibleComponentId` / `visibleComponentId` (lines 21, 28, 31, 36) but never spells out the boxed-`String` type, so the `String → string` widening is doc-invisible. No Card doc change needed.

No new sidebar entries or `index.md` catalog entries — every affected page already exists and is linked in [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) (lines 161, 167, 169, 170).

---

## Non-Goals

- **No branded/nominal `ComponentId` type** (item 4 hard constraint) — Card's id stays primitive `string`.
- **No Box/Flow main-axis vocabulary work** — `BoxJustify`/`FlowAlign`/`FlowJustify`/`MainAxis` and the files `BoxLayout.ts`/`FlowLayout.ts` belong to `layout-main-axis-vocabulary.md`.
- **No `SplitGutter` boxed-`String` widening** — `SplitGutter`'s own `_direction: String` and `constructor(direction: String, …)` are out of scope; a primitive `SplitDirection` remains assignable to `String`, so Split's call into it compiles unchanged.
- **No removal of DockRegion's `String(getDirection())` wrappers** — redundant after item 3 but correct; unrelated cleanup.
- **No fix of the pre-existing `BorderLayoutOptions` JSDoc drift** in `Border.ts:33` — flagged for the user, not changed.
- **No behavior changes** — defaults (Border spacing 5, Accordion fillHeight false, Split direction "horizontal") and all geometry are preserved.

---

## Critical Files

- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — item 1; `_gap` reads scattered through `computeTotalMinSize`/`doLayout`.
- [`src/typescript/lib/layout/Accordion.ts`](../src/typescript/lib/layout/Accordion.ts) — item 2; `_fill` read in `computeFill`.
- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — items 3 + 5; add `SplitDirection`, thread it, collapse constructor.
- [`src/typescript/lib/layout/Card.ts`](../src/typescript/lib/layout/Card.ts) — item 4.
- [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — barrel; add `SplitDirection` export (item 3).
- [`src/typescript/lib/layout/LayoutSerialization.ts`](../src/typescript/lib/layout/LayoutSerialization.ts) — item 5's one positional `new Split(node.direction)` call site; item 3's `getDirection() === "vertical"` comparison.
- [`src/typescript/lib/layout/Fit.ts`](../src/typescript/lib/layout/Fit.ts) — **reference only**: keeps its own `setFill`/`getFill`/`_fill: FillType`; the item-2 grep invariants must not catch these.
- [`src/typescript/lib/core/BaseObject.ts`](../src/typescript/lib/core/BaseObject.ts) — `getId(): string` (primitive), the basis for item 4's widening.
