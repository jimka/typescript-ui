# Class-Tier Default Hoists — Implementation Plan

## Overview

The live Style Audit panel ([`packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts)) flags `#id`-scoped CSS rules whose declaration body duplicates another instance's — a value every instance writes identically, which belongs on the shared class-tier rule instead of on each instance's own rule. A capture found six components each writing a construction-time-uniform value this way: [`SelectableListRow`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L276)'s `padding`, [`HiddenFileInput`](packages/lib/src/typescript/lib/component/input/FileField.ts#L31)'s `displayed`, [`FooterRow`](packages/lib/src/typescript/lib/component/table/Footer.ts#L16)'s `border`/`backgroundColor`/`backgroundImage`, [`TableHeader`](packages/lib/src/typescript/lib/component/table/Header.ts#L117)'s same trio, [`Table`](packages/lib/src/typescript/lib/component/table/Table.ts#L197)'s `border`/`minSize`, and [`ToolBar`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L127)'s horizontal-default `border`. All six are mechanical: no design decision, one construction site each, values verified below against the current source.

This plan is the third round of the same recipe [`delegate-class-style-defaults-followups.md`](plans/implemented/delegate-class-style-defaults-followups.md) already ran twice.[^third-round] It fixes six small, independent hoists as six sequential, independently revertable steps — not six plans, because none touches a file another step touches and none depends on another's outcome.

Two class-tier mechanisms already exist and this plan picks between them per class, never inventing a third:

- **A registered `_default<Name>Options` bag**, forwarded through the constructor's `subclassDefaults` parameter into `_defaultOptions` — the flat mechanism from `component-chrome-base-tier-hoisting.md`, unconditionally live for any class (`Component.getClassStyleDefaults()`'s base body is `return this._defaultOptions;`).
- **A `protected static readonly ownClassStyleDefaults: StyleBag`** field — the hierarchy-aware mechanism from [`class-hierarchy-cascade.md`](plans/implemented/class-hierarchy-cascade.md), independent of `_defaultOptions` entirely. [`PickerInput`](packages/lib/src/typescript/lib/component/input/PickerInput.ts#L44) and [`Cell`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L55) are the established shape to mirror.

---

## Architecture Decisions

### Mechanism choice follows whether the class already threads a `subclassDefaults` bag

| Class | Mechanism | Why |
|---|---|---|
| `SelectableListRow` | Extend the existing `_defaultSelectableListRowOptions` bag | Already forwarded through `subclassDefaults` (`AbstractSelectableList.ts:312`); adding one field is the smallest possible change |
| `HiddenFileInput` | Add a `subclassDefaults` argument to its own `super()` call | Zero-parameter constructor, no bag exists yet; the value (`displayed: false`) is an ordinary `ComponentOptions` field, so it belongs in `_defaultOptions` per `Component.ts`'s own guidance[^getclassstyledefaults-scope] |
| `FooterRow`, `TableHeader`, `Table` | `ownClassStyleDefaults` | None has an options-bag constructor at all — `FooterRow()`/`TableHeader(model, store)`/`Table(store, spec?, bodyFactory?)` take no `ComponentOptions`, so there is no `subclassDefaults` slot to extend |
| `ToolBar` | `ownClassStyleDefaults` | `_defaultToolBarOptions` exists, but the border value is orientation-conditional; a single bag entry can't express "horizontal vs. vertical," and `applyOrientation`'s own unconditional recompute would fight a bag-based default[^toolbar-border-conflict] |

For `FooterRow`/`TableHeader`/`Table`/`ToolBar`, `ownClassStyleDefaults` is a **parallel, independent** declaration — it does not touch `_defaultOptions`, `applyOptions`, or any constructor parameter. `Component.applyStyle`'s hierarchy-aware path (`ensureClassStyleRule` → `resolveClassLevel`, [core/ClassStyleRules.ts:522](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L522)) reads the static field directly and never consults `getClassStyleDefaults()` for a class that participates this way ([core/ClassStyleRules.ts:911-936](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L911-L936)), so adding the field cannot interact with anything the constructor already does.

### Every constructor call stays exactly as it is — the class tier only enables dedup, it doesn't replace the write

Every one of the six imperative calls (`setPadding`, `setDisplayed`, `setBorder`, `setBackgroundColor`, `setBackgroundImage`, `setMinSize`) stays in its current constructor, unconditional, untouched. This differs from `delegate-class-style-defaults-followups.md`, which deleted the matching setter calls after registering each default. That plan could do that because *nothing else* needed the value on the instance; here [ARCHITECTURE.md](ARCHITECTURE.md)'s *Class-level defaults must survive the getter* section and this plan's own brief scope both call for the minimal fix — add the default, leave the call.

The outcome is uniform across all six: because the constructor always calls the setter, the value always lands in the instance style layer. Once the class tier declares the same value, `flushStyleBag`'s per-key comparison (`core/Component.ts`, the layered-style-bag mechanism) finds a match and queues an explicit `null` removal for that key on the instance's own `#id` rule — not a fully skipped write. This is the exact pattern `SelectableListRow`'s already-shipped `border` hoist demonstrates today ([`SelectableListRow.classStyleDefaults.test.ts`](packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts), row 5's assertions), and it recurs for every property this plan touches:

| Property | Constructor call | `ownClassStyleDefaults`/bag value | Flush-time `#id` outcome |
|---|---|---|---|
| `SelectableListRow.padding` | `setPadding(new Insets(0, 8, 0, 8))`, kept | same `Insets` in the bag | `padding: null` |
| `HiddenFileInput.displayed` | `setDisplayed(false)`, kept | `displayed: false` | `display: null` |
| `FooterRow`/`TableHeader`/`Table`/`ToolBar` (horizontal) `.border` | `setBorder({...})`, kept | same value | `borderTop`/`Right`/`Bottom`/`Left`: all four `null` (`borderToStyle` always expands to all four sides — see below) |
| `TableHeader`/`Table`/`FooterRow.backgroundColor`/`.backgroundImage` | kept | same value | `null` each |
| `Table.minSize` | `setMinSize({width:100,height:100})`, kept | same value | `minWidth: null`, `minHeight: null` |

`border`'s four-key expansion needs its own note: [`borderToStyle`](packages/lib/src/typescript/lib/primitive/Border.ts#L33) always resolves all four sides — an unspecified side falls back to `border ?? "none"`, never `undefined`. So `FooterRow`'s `{ borderTop: "..." }` resolves to `{borderTop: "1px solid...", borderRight: "none", borderBottom: "none", borderLeft: "none"}`, and once the class tier declares the identical bag, **all four** keys match and all four null out — not just `borderTop`. This is exactly what the existing `SelectableListRow` test already asserts for its own single-sided border (all four `toBeNull()`), and every new test in this plan follows the same shape.

### `ToolBar`'s hoist covers only the horizontal/default case; a vertical instance correctly keeps diverging with no special-casing

`ownClassStyleDefaults.border` is `{ borderBottom: "1px solid ${TOOLBAR_BORDER_COLOR}" }` — the value `applyOrientation` writes for the default `"horizontal"` orientation. A vertical `ToolBar` writes `{ borderRight: "..." }` instead, and the flush-time per-key comparison — already generic, not written for this plan — resolves each side independently:

| Side | Horizontal instance write | Vertical instance write | Class tier | Horizontal `#id` | Vertical `#id` |
|---|---|---|---|---|---|
| `borderTop` | `"none"` | `"none"` | `"none"` | `null` (match) | `null` (match) |
| `borderRight` | `"none"` | `"1px solid ..."` | `"none"` | `null` (match) | `"1px solid ..."` (real — diverges) |
| `borderBottom` | `"1px solid ..."` | `"none"` | `"1px solid ..."` | `null` (match) | `"none"` (real — correctly clears the class tier's bottom border) |
| `borderLeft` | `"none"` | `"none"` | `"none"` | `null` (match) | `null` (match) |

No code needs to know about orientation for this to work — it falls out of the existing per-key comparison. A caller-supplied `border` option (`applyOrientation`'s `options?.border !== undefined` branch, [`ToolBar.ts:263`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L263)) is unaffected: it still writes whatever value the caller passed, which the flush compares against the class tier the same way.

### `SelectableListRow.padding` is only safe to hoist now because `layered-style-bag.md` shipped

`delegate-class-style-defaults-followups.md` (the prior round) explicitly left `padding` out, with this reasoning in its own `## Non-Goals`: *"`padding` is not a member of `ClassStyleDefaults`... there is no render-time... phase to compare against a class default... Registering `padding` in `_defaultOptions` would fix `getPadding()`'s folding-getter value... but would not, on its own, produce any CSS write... A real fix needs... widening `ClassStyleDefaults`/`resolveDeclarations` to cover `padding` generally — [a] small, independent follow-up, not attempted here."*

That follow-up is done: [`layered-style-bag.md`](plans/implemented/layered-style-bag.md) added `padding?: Insets | null` to `StyleBag` with a real writer (`ClassStyleRules.ts:299`: `padding: (v) => ({ padding: v ? v.render() as string : null })`). `padding` now flows through the same `writeStyle`/`flushStyleBag` dedup as every other layering property, confirmed live in the current source — this plan's item 1 is exactly the deferred follow-up, now safe.

### `Table`'s hoist widens `TreeTable`'s DOM class list — expected, harmless, not a new mechanism

`Table` has one subclass, [`TreeTable`](packages/lib/src/typescript/lib/component/table/TreeTable.ts#L87), which declares no `ownClassStyleDefaults` of its own and writes no `border`/`minSize` in its own constructor. Once `Table` participates in the hierarchy-aware class tier, `chainParticipates(TreeTable)` becomes `true` (it wasn't before), so a rendered `TreeTable` element gains the `Table` class alongside its own (`getStyleClassChain`, [`class-hierarchy-cascade.md`](plans/implemented/class-hierarchy-cascade.md)) — going from `ts-ui-component TreeTable` to `ts-ui-component Table TreeTable`. `TreeTable` itself shares `.Table`'s rule outright (no deviation, no new `.TreeTable` rule). This is the same documented consequence `class-hierarchy-cascade.md` flagged for every chain it widened; no test in this repo asserts on `Table`/`TreeTable`'s exact class list (confirmed by `grep`), so nothing needs updating beyond the changelog note in `## Documentation Impact`.

---

## Internal Structure

### `component/list/AbstractSelectableList.ts` — `SelectableListRow`'s bag gains `padding`

```typescript
const _defaultSelectableListRowOptions: Partial<ComponentOptions> = {
    cursor:  "pointer",
    border:  { borderBottom: "1px solid var(--ts-ui-list-row-separator, transparent)" },
    padding: new Insets(0, ROW_PADDING_X_PX, 0, ROW_PADDING_X_PX),
};
```

No other line in the file changes. The constructor's `this.setPadding(new Insets(0, ROW_PADDING_X_PX, 0, ROW_PADDING_X_PX));` ([`AbstractSelectableList.ts:327`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L327)) stays exactly as it is — it is what keeps `getPadding()`/layout math correct and is now also the write the class tier dedups against. `Insets` is already imported.

### `component/input/FileField.ts` — `HiddenFileInput`'s `super()` call gains a `displayed: false` default

```typescript
// Before ([FileField.ts:44](packages/lib/src/typescript/lib/component/input/FileField.ts#L44)):
constructor() {
    super({ tag: "input" });
    ...
    this.setDisplayed(false);
    this.setType("file");
}

// After:
constructor() {
    super({ tag: "input" }, { displayed: false });
    ...
    this.setDisplayed(false);
    this.setType("file");
}
```

No named constant is introduced — this is a single-field, single-caller internal class; an inline literal matches its own minimal shape. No new import is needed. `HiddenFileInput`'s own constructor stays zero-parameter for callers, so `local/require-subclass-defaults` (which exempts zero-parameter "fixed-configuration leaf" constructors) doesn't apply — see `## Potential Challenges`.

### `component/table/Footer.ts` — hoist `footerBg` to `FOOTER_BG`, add `ownClassStyleDefaults`

```typescript
import type { StyleBag } from "~/core/ClassStyleRules.js";

// Apply the surface as both a colour and an image so a flat-colour theme
// (e.g. ModernTheme, where --ts-ui-button-bg is a solid colour) paints via
// the colour and a gradient theme via the image. Setting only
// background-image left the footer transparent under a flat-colour theme,
// since a colour is invalid as a background-image.
const FOOTER_BG = "var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))";

class FooterRow extends Component {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Mirrors what the
    // constructor below already writes imperatively.
    protected static readonly ownClassStyleDefaults: StyleBag = {
        border:          { borderTop: "1px solid var(--ts-ui-border-color, black)" },
        backgroundColor: FOOTER_BG,
        backgroundImage: FOOTER_BG,
    };

    constructor() {
        super({ tag: "tfoot" });

        this.setBorder({ borderTop: "1px solid var(--ts-ui-border-color, black)" });
        this.setBackgroundColor(FOOTER_BG);
        this.setBackgroundImage(FOOTER_BG);

        let row = new Row();
        this.addRow(row);
    }
    // ... unchanged from here
```

The comment that previously sat above the local `footerBg` const moves up with it, unchanged in substance. `ownClassStyleDefaults` is the first member of the class body, matching `Cell.ts`'s placement.

### `component/table/Header.ts` — `TableHeader` gains `ownClassStyleDefaults` reusing `TABLE_HEADER_BG`

```typescript
import type { StyleBag } from "~/core/ClassStyleRules.js";

class TableHeader extends Component {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Mirrors what the
    // constructor below already writes imperatively.
    protected static readonly ownClassStyleDefaults: StyleBag = {
        border:          { borderBottom: "1px solid var(--ts-ui-table-header-border, black)" },
        backgroundColor: TABLE_HEADER_BG,
        backgroundImage: TABLE_HEADER_BG,
    };

    private _model: AbstractModel;
    // ... unchanged from here
```

`TABLE_HEADER_BG` is already a module constant ([`Header.ts:73`](packages/lib/src/typescript/lib/component/table/Header.ts#L73)); no new constant needed. The constructor's `setBorder`/`setBackgroundColor`/`setBackgroundImage` calls ([`Header.ts:182-184`](packages/lib/src/typescript/lib/component/table/Header.ts#L182-L184)) are untouched. `setOverflow("hidden")` (line 187) is untouched and out of scope — it already matches the framework tier's own baseline default and was never part of the audit finding (see `## Non-Goals`).

### `component/table/Table.ts` — `Table` gains `ownClassStyleDefaults`

```typescript
import type { StyleBag } from "~/core/ClassStyleRules.js";

class Table extends Component<TableOptions> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Mirrors what the
    // constructor below already writes imperatively. TreeTable (Table's
    // only subclass) declares no field of its own and shares this rule
    // outright.
    protected static readonly ownClassStyleDefaults: StyleBag = {
        border:  { border: "1px solid var(--ts-ui-border-color, black)" },
        minSize: { width: 100, height: 100 },
    };

    private _store            : AbstractStore;
    // ... unchanged from here
```

The constructor's `setBorder`/`setMinSize` calls ([`Table.ts:287,290`](packages/lib/src/typescript/lib/component/table/Table.ts#L287)) are untouched.

### `component/menubar/ToolBar.ts` — hoist `ruleColor` to `TOOLBAR_BORDER_COLOR`, add `ownClassStyleDefaults`

```typescript
import type { StyleBag } from "~/core/ClassStyleRules.js";

/** Border colour token `applyOrientation` derives both border values from. */
const TOOLBAR_BORDER_COLOR = "var(--ts-ui-toolbar-border, rgb(220, 220, 220))";

// ... _defaultToolBarOptions unchanged ...

class ToolBar<TOptions extends ToolBarOptions = ToolBarOptions> extends Container<TOptions> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Covers only the
    // horizontal/default orientation — see ## Architecture Decisions for
    // why a vertical instance still correctly diverges with no
    // special-casing.
    protected static readonly ownClassStyleDefaults: StyleBag = {
        border: { borderBottom: `1px solid ${TOOLBAR_BORDER_COLOR}` },
    };

    declare private _orientation:  AxisOrientation;
    // ... unchanged from here
```

`applyOrientation`'s body ([`ToolBar.ts:262-274`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L262-L274)) changes only its local `const ruleColor = "...";` line, deleted in favour of referencing `TOOLBAR_BORDER_COLOR`:

```typescript
// Before:
const ruleColor = "var(--ts-ui-toolbar-border, rgb(220, 220, 220))";

if (value === "horizontal") {
    this.setBorder({ borderBottom: `1px solid ${ruleColor}` });
} else {
    this.setBorder({ borderRight: `1px solid ${ruleColor}` });
}

// After:
if (value === "horizontal") {
    this.setBorder({ borderBottom: `1px solid ${TOOLBAR_BORDER_COLOR}` });
} else {
    this.setBorder({ borderRight: `1px solid ${TOOLBAR_BORDER_COLOR}` });
}
```

---

## Ordered Implementation Steps

1. **`AbstractSelectableList.ts`** — add `padding` to `_defaultSelectableListRowOptions`. Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

2. **`SelectableListRow.classStyleDefaults.test.ts`** — fix the stale file-header comment (it currently says padding "is not a `StyleBag` member... so it is not asserted here" — no longer true) and add a new `it()` case asserting the padding dedup. Template (mirrors the existing `it('row 5: ...')` case in the same file, same `CONFIG`/`idSelector`/`declarationsDuring` helpers already in the file):

   ```typescript
   it('a rendered row carries no static padding declaration on its own #id rule, and getPadding() still reports the row inset', () => {
       const sink = installTestDOM(CONFIG);

       const list = new _List({ items: ['Apple', 'Banana'] });
       const row  = (list as any)._rowPool[0];

       const declarations = declarationsDuring(sink, idSelector(row), () => list.getElement(true));

       expect(declarations.padding).toBeNull();
       expect(_ruleCacheHas('.SelectableListRow')).toBe(true);
       expect(row.getPadding()?.getLeft()).toBe(8); // ROW_PADDING_X_PX
   });
   ```

   *Check:* `npx vitest run tests/component/list/SelectableListRow.classStyleDefaults.test.ts` from `packages/lib` — both cases green.

3. **`FileField.ts`** — change `HiddenFileInput`'s `super({ tag: "input" });` to `super({ tag: "input" }, { displayed: false });`. Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

4. **New file `packages/lib/tests/component/input/HiddenFileInput.classStyleDefaults.test.ts`.** Copy the `CONFIG`/`idSelector`/`declarationsDuring` helpers from `SelectableListRow.classStyleDefaults.test.ts` (or `TextInputClassTier.test.ts`, which reaches a private inner input the same way). Construct via `new FileField()` and reach the hidden input as `(field as any)._input`, mirroring `TextInputClassTier.test.ts:136`'s `(field as any)._input` pattern:

   ```typescript
   it('a rendered FileField\'s hidden input carries no static display declaration on its own #id rule, and .HiddenFileInput exists', () => {
       const sink  = installTestDOM(CONFIG);
       const field = new FileField();
       const input = (field as any)._input;

       const declarations = declarationsDuring(sink, idSelector(input), () => field.getElement(true));

       expect(declarations.display).toBeNull();
       expect(_ruleCacheHas('.HiddenFileInput')).toBe(true);
       expect(input.isDisplayed()).toBe(false);
   });
   ```

   *Check:* `npx vitest run tests/component/input/HiddenFileInput.classStyleDefaults.test.ts` from `packages/lib`.

5. **`Footer.ts`** — hoist `footerBg` to module-level `FOOTER_BG`, add the `ownClassStyleDefaults` field and the `StyleBag` import. Per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'footerBg' packages/lib/src/typescript/lib/component/table/Footer.ts` — zero matches (renamed to `FOOTER_BG` everywhere).

6. **New file `packages/lib/tests/component/table/FooterRow.classStyleDefaults.test.ts`.**

   ```typescript
   it('a rendered FooterRow carries no static border/backgroundColor/backgroundImage declaration on its own #id rule, and .FooterRow exists', () => {
       const sink   = installTestDOM(CONFIG);
       const footer = new _FooterRow();

       const declarations = declarationsDuring(sink, idSelector(footer), () => footer.getElement(true));

       expect(declarations.borderTop).toBeNull();
       expect(declarations.borderRight).toBeNull();
       expect(declarations.borderBottom).toBeNull();
       expect(declarations.borderLeft).toBeNull();
       expect(declarations.backgroundColor).toBeNull();
       expect(declarations.backgroundImage).toBeNull();
       expect(_ruleCacheHas('.FooterRow')).toBe(true);
       expect(footer.getBorderSize().top).toBe(1);
   });
   ```

   *Check:* `npx vitest run tests/component/table/FooterRow.classStyleDefaults.test.ts` from `packages/lib`.

7. **`Header.ts`** — add `TableHeader`'s `ownClassStyleDefaults` field and the `StyleBag` import. Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

8. **New file `packages/lib/tests/component/table/TableHeader.classStyleDefaults.test.ts`.** Construct via `new _TableHeader(MODEL, new MemoryStore(MODEL, []))`, matching `content-box-containment.test.ts`'s existing construction pattern.

   ```typescript
   it('a rendered TableHeader carries no static border/backgroundColor/backgroundImage declaration on its own #id rule, and .TableHeader exists', () => {
       const sink   = installTestDOM(CONFIG);
       const header = new _TableHeader(MODEL, new MemoryStore(MODEL, []));

       const declarations = declarationsDuring(sink, idSelector(header), () => header.getElement(true));

       expect(declarations.borderTop).toBeNull();
       expect(declarations.borderRight).toBeNull();
       expect(declarations.borderBottom).toBeNull();
       expect(declarations.borderLeft).toBeNull();
       expect(declarations.backgroundColor).toBeNull();
       expect(declarations.backgroundImage).toBeNull();
       expect(_ruleCacheHas('.TableHeader')).toBe(true);
   });
   ```

   *Check:* `npx vitest run tests/component/table/TableHeader.classStyleDefaults.test.ts` from `packages/lib`.

9. **`Table.ts`** — add `Table`'s `ownClassStyleDefaults` field and the `StyleBag` import. Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

10. **New file `packages/lib/tests/component/table/Table.classStyleDefaults.test.ts`.** Construct via `new Table(new MemoryStore(MODEL, []))`, matching `Table.test.ts`'s existing pattern.

    ```typescript
    it('a rendered Table carries no static border/minSize declaration on its own #id rule, and .Table exists', () => {
        const sink  = installTestDOM(CONFIG);
        const table = new Table(new MemoryStore(MODEL, []));

        const declarations = declarationsDuring(sink, idSelector(table), () => table.getElement(true));

        expect(declarations.borderTop).toBeNull();
        expect(declarations.borderRight).toBeNull();
        expect(declarations.borderBottom).toBeNull();
        expect(declarations.borderLeft).toBeNull();
        expect(declarations.minWidth).toBeNull();
        expect(declarations.minHeight).toBeNull();
        expect(_ruleCacheHas('.Table')).toBe(true);
    });
    ```

    *Check:* `npx vitest run tests/component/table/Table.classStyleDefaults.test.ts` from `packages/lib`.

11. **`ToolBar.ts`** — hoist `ruleColor` to module-level `TOOLBAR_BORDER_COLOR`, add the `ownClassStyleDefaults` field and the `StyleBag` import, update `applyOrientation`. Per `## Internal Structure`.
    *Check:* `npm run typecheck`. `grep -n 'const ruleColor' packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` — zero matches. `npx vitest run tests/component/menubar/ToolBar.test.ts` from `packages/lib` — the existing `getBorder()` assertions (lines 62-89) stay green unmodified, since they read the semantic getter, not the raw `#id` declarations.

12. **New file `packages/lib/tests/component/menubar/ToolBar.classStyleDefaults.test.ts`.**

    ```typescript
    it('a horizontal ToolBar carries no static border declaration on its own #id rule, and .ToolBar exists', () => {
        const sink = installTestDOM(CONFIG);
        const bar  = new ToolBar();

        const declarations = declarationsDuring(sink, idSelector(bar), () => bar.getElement(true));

        expect(declarations.borderTop).toBeNull();
        expect(declarations.borderRight).toBeNull();
        expect(declarations.borderBottom).toBeNull();
        expect(declarations.borderLeft).toBeNull();
        expect(_ruleCacheHas('.ToolBar')).toBe(true);
    });

    it('a vertical ToolBar keeps a real borderRight and clears the class tier\'s borderBottom explicitly', () => {
        const sink = installTestDOM(CONFIG);
        const bar  = new ToolBar({ orientation: 'vertical' });

        const declarations = declarationsDuring(sink, idSelector(bar), () => bar.getElement(true));

        expect(declarations.borderRight).toBe('1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))');
        expect(declarations.borderBottom).toBe('none');
        expect(declarations.borderTop).toBeNull();
        expect(declarations.borderLeft).toBeNull();
    });
    ```

    *Check:* `npx vitest run tests/component/menubar/ToolBar.classStyleDefaults.test.ts` from `packages/lib`.

13. **`next.md` changelog entry.** See `## Documentation Impact`.
    *Check:* `npm run docs:api` finishes with zero warnings.

14. **Full verification.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/FileField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Footer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/input/HiddenFileInput.classStyleDefaults.test.ts` |
| Create | `packages/lib/tests/component/table/FooterRow.classStyleDefaults.test.ts` |
| Create | `packages/lib/tests/component/table/TableHeader.classStyleDefaults.test.ts` |
| Create | `packages/lib/tests/component/table/Table.classStyleDefaults.test.ts` |
| Create | `packages/lib/tests/component/menubar/ToolBar.classStyleDefaults.test.ts` |

---

## Expected Behaviour

All rows are unit-testable with the existing `installTestDOM`/`RecordingDOMSink` harness and the `declarationsDuring`/`idSelector` helper pattern (`SelectableListRow.classStyleDefaults.test.ts`, `TextInputClassTier.test.ts`). Row 7 additionally needs a manual check.

| # | Case | Expected |
|---|---|---|
| 1 | A rendered `SelectableListRow` (via `List`) | No `padding` declaration on its own `#id` rule (`null`, per `## Architecture Decisions`' dedup table); `.SelectableListRow` class rule exists; `getPadding()` still reports the row's 8px horizontal inset |
| 2 | A rendered `FileField`'s hidden `_input` | No `display` declaration on its own `#id` rule (`null`); `.HiddenFileInput` class rule exists; `isDisplayed()` still reports `false` |
| 3 | A rendered `FooterRow` | No `border-*`/`background-color`/`background-image` declaration on its own `#id` rule (all `null` — border expands to all four sides per `## Architecture Decisions`); `.FooterRow` class rule exists; `getBorderSize().top` still reports `1` |
| 4 | A rendered `TableHeader` | Same shape as row 3, for `.TableHeader` |
| 5 | A rendered `Table` | No `border-*`/`min-width`/`min-height` declaration on its own `#id` rule (all `null`); `.Table` class rule exists |
| 6 | A rendered horizontal (default) `ToolBar` | No `border-*` declaration on its own `#id` rule (all `null`); `.ToolBar` class rule exists |
| 7 | A rendered vertical `ToolBar` (`{ orientation: "vertical" }`) | `borderRight` is a real value (`"1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))"`); `borderBottom` is the real, explicit value `"none"` (clearing the class tier's inherited bottom border); `borderTop`/`borderLeft` are `null` — see the worked table in `## Architecture Decisions` |
| 8 | Style Audit panel (`#/style-audit`, `npm run dev`), before/after, opening a view that renders each of the six components | The six duplicate-body rows this plan targets are gone from the panel's ranked list |
| 9 | Demo app: `#/tables` (Table/TableHeader/FooterRow), a `SelectableList`, a `FileField`, `#/toolbars` or wherever `ToolBar` renders in both orientations | Every component's appearance is visually identical to before this plan — no rendered pixel changes, only which CSS tier supplies each value |

Row 8-9 are manual — start a dev server on a spare port from *this worktree*, not the user's existing server.

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Run from `packages/lib` unless noted. Grep invariants:

- `grep -n 'footerBg' packages/lib/src/typescript/lib/component/table/Footer.ts` — zero (renamed to `FOOTER_BG`).
- `grep -n 'const ruleColor' packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` — zero (renamed to `TOOLBAR_BORDER_COLOR`).
- `grep -rn 'ownClassStyleDefaults' packages/lib/src/typescript/lib/component/table/Footer.ts packages/lib/src/typescript/lib/component/table/Header.ts packages/lib/src/typescript/lib/component/table/Table.ts packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` — one match each.

**Manual verification (Expected Behaviour rows 8-9) is required** — start a dev server (`npm run dev`) from this worktree on a spare port, exercise `#/tables`, wherever `SelectableList`/`FileField`/`ToolBar` render, then open `#/style-audit` and refresh.

---

## Documentation Impact

No exported symbol changes — `ownClassStyleDefaults` is `protected`, `HiddenFileInput`'s constructor signature is unchanged for callers, and every other edit is either a module-constant rename or an additive static field. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`:

> **`SelectableListRow`, `HiddenFileInput`, `FooterRow`, `TableHeader`, `Table`, and `ToolBar` (horizontal/default orientation) no longer duplicate their fixed styling on every instance's own CSS rule.** Each now shares one CSS rule per piece across every instance in the app. Nothing changes visually; no consumer action needed.

A second, separate note for `Table`'s DOM class widening, mirroring `class-hierarchy-cascade.md`'s own precedent for this exact consequence:

> **A rendered `TreeTable` element now additionally carries the `Table` class** (`ts-ui-component Table TreeTable`, previously `ts-ui-component TreeTable`). A consumer stylesheet selector targeting bare `.Table` — previously matching no `TreeTable` element — now matches `TreeTable` too. Audit any such selector before upgrading.

---

## Potential Challenges

- **`local/require-subclass-defaults`** (the ESLint rule `delegate-class-style-defaults-followups.md`'s Implementation Notes found) flags a constructor that already has ≥1 parameter and passes a `_default<Name>Options` bag to `super()` without also forwarding its own `subclassDefaults`. Confirmed not triggered: `SelectableListRow`'s constructor already forwards `subclassDefaults` (unrelated to this plan's step 1, which only adds a field to the existing bag); `HiddenFileInput`'s constructor stays zero-parameter, the rule's documented exemption.
- **`default-options-fallback.test.ts`'s default-resolution registry.** Confirmed not applicable — it only covers exported classes seeding `_defaultOptions` (`grep` confirms neither `Cell` nor `PickerInput`, the two existing `ownClassStyleDefaults` classes, appear there), and none of this plan's six classes ever needs its getter to fall back to the class tier (every constructor writes the value unconditionally, so the instance layer always answers first).

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/input/PickerInput.ts`, `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` | The `ownClassStyleDefaults` shape this plan mirrors for `FooterRow`/`TableHeader`/`Table`/`ToolBar` |
| `packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts` | Existing, already-shipped test for this exact class — its `border` case is the template every new test in this plan copies, and its stale padding comment must be fixed |
| `plans/implemented/delegate-class-style-defaults-followups.md` | Direct precedent for this whole plan's shape and recipe; its `## Non-Goals` explains why `padding` was deferred and its Implementation Notes surfaced the `local/require-subclass-defaults` rule and the registry's scope |
| `plans/implemented/layered-style-bag.md` | Added `StyleBag.padding`, the mechanism that makes item 1 safe now |
| `plans/implemented/class-hierarchy-cascade.md` | The `ownClassStyleDefaults`/`resolveClassLevel`/`getStyleClassChain` mechanism items 3-6 register into, and the precedent for documenting `Table`'s DOM class widening |
| `packages/lib/src/typescript/lib/core/Component.ts` | `applyChromeOptions` (auto-dispatch for the chrome group), `resolveClassDefaults`/`_defaultOptions` construction, `flushStyleBag`/`writeStyle` (the per-key dedup every row in this plan relies on) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureClassStyleRule`, `resolveClassLevel`, `chainParticipates` — confirms `ownClassStyleDefaults` is fully self-contained and ignores `getClassStyleDefaults()` for a participating class |
| `packages/lib/src/typescript/lib/primitive/Border.ts` | `borderToStyle` — why a single-sided `border` value still expands to four `null`-eligible keys |
| `packages/lib/tests/component/input/TextInputClassTier.test.ts` | The `(field as any)._input` pattern for reaching a private inner component, used by step 4's new test |

---

## Non-Goals

- **Deleting any of the six constructors' imperative setter calls.** Kept unconditionally in every case — see `## Architecture Decisions`. `delegate-class-style-defaults-followups.md` deleted its setter calls; this plan does not.
- **`TableHeader.setOverflow("hidden")`.** Already matches the framework tier's own baseline default (`FRAMEWORK_DEFAULTS.overflow`), already deduped with no class-tier default needed, and not part of the audit finding this plan addresses.
- **Any other Style Audit duplicate not named in the six items above.** Out of scope for this round.
- **`default-options-fallback.test.ts` registry rows.** Confirmed not applicable — see `## Potential Challenges`.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^third-round]: `checkbox-radio-delegate-static-style-defaults.md` ran the recipe first; `delegate-class-style-defaults-followups.md` ran it a second time against six more Style Audit findings. This plan is a third pass against a new capture, using the exact same two mechanisms (no new mechanism, no change to `core/ClassStyleRules.ts` or `core/Component.ts`).

[^getclassstyledefaults-scope]: `Component.ts`'s own doc comment on `getClassStyleDefaults()` (the override escape hatch `Text`/`TextInput`/`Scrollbar`'s `ScrollArrowGlyph` use) states it exists to let "a subclass... contribute a comparison value that doesn't live in `_defaultOptions`" — e.g. `Text`'s `fontSize`/`lineHeight`, which resolve through private derived fields with no flat options-bag counterpart. `HiddenFileInput.displayed` has no such obstacle: `ComponentOptions.displayed?: boolean` is a plain, already-existing field, so it belongs in `_defaultOptions` via the ordinary `subclassDefaults` route, not the override reserved for values that don't fit there. This plan deliberately doesn't use `ownClassStyleDefaults` for `HiddenFileInput` either — it has no subclasses and no ancestor participates, so the flat `_defaultOptions` route is both sufficient and the smaller diff.

[^toolbar-border-conflict]: `Component.applyChromeOptions` (called automatically from every `Component`'s constructor via `applyOptions`) always-dispatches `border` from `options.border ?? this._defaultOptions.border` — so if `border` were added to `_defaultToolBarOptions`, it would fire `setBorder(...)` once, unconditionally, before `ToolBar`'s own constructor body runs `applyOrientation`. `applyOrientation` (invoked from `ToolBar.applyOptions`, after `super.applyOptions` returns) then unconditionally recomputes and overwrites `border` from `value`/`options?.border` again — the bag-sourced write would be silently clobbered by the very next statement, and could never express the vertical case regardless. `ownClassStyleDefaults` sidesteps this entirely: it's a parallel CSS-tier-only declaration, never dispatched through `applyOptions`/`applyChromeOptions`, so it can't collide with `applyOrientation`'s own write.
