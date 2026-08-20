# Delegate Class Style Default Follow-ups — Implementation Plan

## Overview

[`checkbox-radio-delegate-static-style-defaults.md`](checkbox-radio-delegate-static-style-defaults.md) established the recipe for a component that writes a fixed, class-wide-constant CSS value through an ordinary imperative setter in its constructor instead of registering it as a class default: give the piece its own small, module-private `Component`/subclass, move the constant into a `_default<Name>Options` bag forwarded through the `subclassDefaults` constructor parameter, and delete the now-redundant setter call. Once registered, the already-shipped `ensureClassStyleRule` mechanism ([core/ClassStyleRules.ts:222](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L222)) dedupes the declaration onto one shared `.ClassName` rule automatically.

A second pass of the in-app Style Audit panel (`#/style-audit`, refreshed after opening the Misc tab's slow table and wide-45-column table) found six more places with the identical shape: [`ScrollArrowButton`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L129) and the `Scrollbar` thumb (both file-local pieces of [`Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts)), [`ResizeHandle`](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L86), `ComboBoxCaret` ([component/input/ComboBox.ts:520](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L520)), `SelectableListRow` ([component/list/AbstractSelectableList.ts:271](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L271)), and `HeaderCell`'s own text renderer ([component/table/cell/Header.ts:104](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L104), built via [`DefaultCell`](packages/lib/src/typescript/lib/component/table/cell/Default.ts#L15)). Combined, these account for roughly 15 KB of the audit's reported duplication. This plan applies the same recipe to all six — no change to `core/ClassStyleRules.ts` or `core/Component.ts` is needed, since every property involved (`backgroundColor`, `backgroundImage`, `cursor`, `minSize`, `maxSize`, `border`, `userSelect`) is already a member of `ClassStyleDefaults` and already flows through the class-tier comparison at render time.

This plan is self-contained and has no dependency on unmerged work — every mechanism it uses (`subclassDefaults` forwarding, `ensureClassStyleRule`, the render-time class-tier comparison) is already on `master`.[^no-dependency] It is a prerequisite for [`state-tier-rule-dedup-followups.md`](state-tier-rule-dedup-followups.md), which extends the `ScrollArrowButton` and `Scrollbar` thumb delegates this plan creates with a state-toggling colour on top of the resting default this plan registers.

---

## Architecture Decisions

### Each fix is a direct copy of the `CheckboxBox`/`RadioButtonRing` shape — one new module-private class, one `_default<Name>Options` bag, the matching setter call deleted

No new design is needed anywhere in this plan; every row was checked against `checkbox-radio-delegate-static-style-defaults.md`'s own precedent and fits it exactly. The per-component table below is the whole of this decision.

| Component | File | New/changed class | Moves into `_default<Name>Options` | Stays imperative |
|---|---|---|---|---|
| `ScrollArrowButton` | [Scrollbar.ts:129](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L129) | Existing file-local class, gains a defaults bag | `backgroundColor` (resting `var(--ts-ui-scrollbar-arrow-bg, transparent)`, [line 148](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L148)) | `cursor` (already matches the framework default, never duplicates — see footnote[^cursor-already-matches]); the enabled/disabled `foregroundColor` swap (state-tier plan) |
| `Scrollbar`'s thumb | [Scrollbar.ts:452](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L452) | New `ScrollbarThumb extends Component` | `cursor: "grab"`, resting `backgroundColor: "var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))"` ([lines 453-454](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L453-L454)) | `setWillChange`, `setX`/`setY`, `setWidth`/`setHeight` (orientation-dependent, genuinely per-instance); the hover-fill `backgroundColor` swap (state-tier plan) |
| `ResizeHandle` | [ResizeHandle.ts:86](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L86) | Existing class, gains a defaults bag | `cursor: RESIZE_HANDLE_CURSOR`, `backgroundImage` (the gradient stripe), both [lines 102-110](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L102-L110) | `setZIndex(1)` (writes inline, not a class-tier-eligible property — see `## Non-Goals`) |
| `ComboBoxCaret` | [ComboBox.ts:520](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L520) | Existing class, gains a defaults bag | `minSize`/`maxSize`, both computed as `Util.lineHeightPx({ linePadding: false })` ([lines 533-535](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L533-L535)) | `setPointerEvents("none")`; the owned `_glyph`'s own size (see `## Non-Goals`) |
| `SelectableListRow` | [AbstractSelectableList.ts:271](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L271) | Existing class, gains a defaults bag | `cursor: "pointer"` ([line 324](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L324)), `border: { borderBottom: "1px solid var(--ts-ui-list-row-separator, transparent)" }` ([line 319](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L319)) | `setPreferredSize`, `setPadding` (see `## Non-Goals` — `padding` cannot move) |
| `HeaderCell`'s renderer | [Header.ts:104](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L104), [Default.ts:15](packages/lib/src/typescript/lib/component/table/cell/Default.ts#L15) | New `HeaderCellRenderer extends StringRenderer` | `cursor: "default"`, `userSelect: "none"` ([Header.ts:122-128](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L122-L128)) | Everything else `DefaultCell`'s renderer already does |

### `ComboBoxCaret`'s default is computed at construction, not a module-level literal — following `Text`'s precedent, not `Checkbox`'s

Every other row's `_default<Name>Options` value is a fixed string, declared once as a frozen module constant. `ComboBoxCaret`'s `minSize`/`maxSize` are the field's own font-derived line-height in pixels (`Util.lineHeightPx({ linePadding: false })`, [core/Util.ts:174](packages/lib/src/typescript/lib/core/Util.ts#L174)) — a value that depends on the current theme, not a source-code literal. This still fits the mechanism: `ensureClassStyleRule` caches the resolved class-tier bag once per class, from whichever instance renders first, exactly like [`Text.getClassStyleDefaults()`](packages/lib/src/typescript/lib/component/input/Text.ts#L1391) already does for its own theme-derived `fontSize`. A `ComboBoxCaret` constructed under a later theme change would compute a different `_defaultOptions.minSize`, correctly fail the class-tier comparison, and write its own (correct) value to `#id` — the existing per-instance-construction-time freezing this class already has today is unchanged; only which instances succeed at sharing the class rule can vary.[^theme-change-caveat]

### `StringRenderer`'s constructor gains a `subclassDefaults` parameter it does not have today

[`StringRenderer`](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L20)'s constructor takes no arguments and calls `super(_defaultStringRendererOptions)` directly — a dead end per ARCHITECTURE.md's *Constructors forward `subclassDefaults`*: nothing below it can layer its own defaults. `HeaderCellRenderer` needs exactly that layering, so `StringRenderer`'s constructor widens to accept an optional `subclassDefaults` and merge it over its own bag, the same shape [`CellRenderer`](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L18)'s own constructor already uses one level down.

### `DefaultCell` gains an optional `renderer` constructor parameter so `HeaderCell` can substitute its own renderer class

[`DefaultCell`](packages/lib/src/typescript/lib/component/table/cell/Default.ts#L15)'s constructor hardcodes `new StringRenderer()` with no way for a subclass to inject a different renderer instance. Adding an optional second parameter — `constructor(tag?: string, renderer?: StringRenderer)`, defaulting to `new StringRenderer()` when omitted — lets `HeaderCell` pass a `new HeaderCellRenderer()` instead, with no change to any other `DefaultCell` construction site (`ParentHeaderCell`, `GroupSeparatorCell`, and every plain `DefaultCell` call already pass zero or one argument).

### `HeaderCell`'s own `renderer.setUserSelect(...)`/`renderer.setCursor(...)` calls are deleted, not left alongside the new default

Once `cursor`/`userSelect` are `HeaderCellRenderer`'s own registered defaults, the render-time class-tier comparison delivers them for free; the imperative calls in `HeaderCell`'s constructor ([Header.ts:122-128](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L122-L128)) become dead code with two sources of truth for the same value, the same "delete the redundant call" judgement `checkbox-radio-delegate-static-style-defaults.md` already made for `Cell`'s border.

### `SelectableListRow`'s border stays a typed-setter default — the in-code comment warning against this is stale

[AbstractSelectableList.ts:315-318](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L315-L318) currently reads: *"Declared through the typed setter rather than the shared class rule so `getBorderSize()` sees the 1px the separator takes out of the row's content box; a class-rule border is invisible to the framework's box math."* This is true of a **hand-rolled** module-level `StyleRule({ scope: "class" })` rule (the `ResizeHandle`/`SortPriorityBadge` shape, which never touches any JS-visible field) — it is not true of the `_default<Name>Options` route this plan uses. `Component.applyChromeOptions` ([Component.ts:685-704](packages/lib/src/typescript/lib/core/Component.ts#L685-L704)) always-dispatches `border` from `options.border ?? this._defaultOptions.border`, so a registered default still calls the real `setBorder()` setter once at construction and populates `this._border` — the exact field `getBorderSize()` reads. `CheckboxBox`'s own resting border already proves this live (`checkbox-radio-delegate-state-style-defaults.md`, merged). Update the comment to say the value is now a registered class default instead of removing the explanation outright — the reasoning about why a *hand-rolled* rule would be wrong is still worth keeping nearby for the next person who considers that route.

---

## Public API

No new exported symbols. Two existing exported classes gain an optional, additive constructor parameter — a widening, not a breaking change:

```typescript
// component/table/cell/renderer/String.ts
class StringRenderer {
    constructor(subclassDefaults?: Partial<ComponentOptions>); // was: constructor()
}
```

```typescript
// component/table/cell/Default.ts
class DefaultCell {
    constructor(tag?: string, renderer?: StringRenderer); // was: constructor(tag?: string)
}
```

`ScrollbarThumb` and `HeaderCellRenderer` are new module-private classes, never exported.

---

## Internal Structure

### `component/container/Scrollbar.ts` — `ScrollArrowButton`'s defaults bag

```typescript
const _defaultScrollArrowButtonOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-scrollbar-arrow-bg, transparent)",
};

class ScrollArrowButton extends Component {
    constructor(direction: ArrowDirection) {
        super(undefined, _defaultScrollArrowButtonOptions);

        this.setWidth(TRACK_WIDTH);
        this.setHeight(TRACK_WIDTH);
        this.setCursor("default");
        this.setForegroundColor("var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))");
        // ... unchanged from here
```

Delete the `this.setBackgroundColor(...)` call at [line 148](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L148); `setCursor("default")` and `setForegroundColor(...)` stay (the former already matches the framework default and never duplicates; the latter is this plan's `## Non-Goals` — see `state-tier-rule-dedup-followups.md`).

### `component/container/Scrollbar.ts` — new `ScrollbarThumb`, placed above `Scrollbar`

```typescript
const _defaultScrollbarThumbOptions: Partial<ComponentOptions> = {
    cursor:          "grab",
    backgroundColor: "var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))",
};

/**
 * The draggable thumb inside a {@link Scrollbar}'s track. File-local — not
 * exported from the container barrel because it is a Scrollbar implementation
 * detail, mirroring {@link ScrollArrowButton}.
 */
class ScrollbarThumb extends Component {
    constructor() {
        super(undefined, _defaultScrollbarThumbOptions);
    }
}
```

Constructor, before → after ([Scrollbar.ts:452-454](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L452-L454)):

```typescript
// Before:
this._thumb = new Component();
this._thumb.setBackgroundColor("var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))");
this._thumb.setCursor("grab");
```

```typescript
// After:
this._thumb = new ScrollbarThumb();
```

`Scrollbar`'s `private _thumb: Component;` field declaration narrows to `private _thumb: ScrollbarThumb;` (same reasoning as `checkbox-radio-delegate-state-style-defaults.md`'s `_box`/`_ring` narrowing — the state-tier follow-on plan adds a method that exists only on `ScrollbarThumb`, so narrow now to avoid a second field-type edit later).

### `component/table/cell/ResizeHandle.ts` — defaults bag

```typescript
const _defaultResizeHandleOptions: Partial<ComponentOptions> = {
    cursor: RESIZE_HANDLE_CURSOR,
    backgroundImage:
        "linear-gradient(to right,transparent 80%," +
        "var(--ts-ui-table-resize-handle-color,rgba(0,0,0,0.2)) 80%)",
};

class ResizeHandle extends Component<ResizeHandleOptions> {
    constructor(options?: ResizeHandleOptions) {
        ensureResizeHandleClassRule();

        super({ tag: "div", ...(options ?? {}) }, _defaultResizeHandleOptions);

        this.setZIndex(1);
        // ... unchanged from here
```

Delete the `this.setCursor(RESIZE_HANDLE_CURSOR)` and `this.setBackgroundImage(...)` calls at [lines 102-110](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L102-L110); `setZIndex(1)` stays (writes inline, not class-tier-eligible).

### `component/input/ComboBox.ts` — `ComboBoxCaret`'s defaults bag

```typescript
class ComboBoxCaret extends Component {
    private _glyph: Glyph = new Glyph("chevron-down");
    private _size:  number;

    constructor() {
        const size = Util.lineHeightPx({ linePadding: false });

        super({ tag: "span" }, { minSize: { width: size, height: size }, maxSize: { width: size, height: size } });

        this._size = size;
        this.setPointerEvents("none");

        this._glyph.setPreferredSize({ width: this._size, height: this._size });
        this._glyph.setPointerEvents("none");
        this.addComponent(this._glyph);
    }
    // ... unchanged from here
```

Delete the `this.setMinSize(...)`/`this.setMaxSize(...)` calls at [lines 534-535](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L534-L535); `this._size` is now assigned from the local `size` computed before `super()` (constructor arguments evaluate before the call), instead of from `Util.lineHeightPx(...)` called a second time after it. The `_glyph`'s own `setPreferredSize` call is untouched — see `## Non-Goals`.

### `component/list/AbstractSelectableList.ts` — `SelectableListRow`'s defaults bag

```typescript
const _defaultSelectableListRowOptions: Partial<ComponentOptions> = {
    cursor: "pointer",
    border: { borderBottom: "1px solid var(--ts-ui-list-row-separator, transparent)" },
};

class SelectableListRow extends Component {
    constructor(handlers: RowHandlers, index: number, rendererFactory: () => ListItemRenderer) {
        super({ tag: "div" }, _defaultSelectableListRowOptions);

        this._handlers = handlers;
        this._index    = index;
        this._renderer = rendererFactory();
        this._renderer.setPointerEvents("none");

        this.getAria().setRole("option");
        this.setPreferredSize({ width: 0, height: ROW_HEIGHT_PX });
        this.setPadding(new Insets(0, ROW_PADDING_X_PX, 0, ROW_PADDING_X_PX));
        // ... unchanged from here (setPadding stays — see ## Non-Goals)
```

Delete the `this.setBorder(...)` call at [line 319](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L319) and the `this.setCursor("pointer")` call at [line 324](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L324), and update the comment above the deleted border call per `## Architecture Decisions`. `setPadding` stays exactly as-is.

### `component/table/cell/renderer/String.ts` — `subclassDefaults` forwarding

```typescript
// Before:
constructor() {
    super(_defaultStringRendererOptions);
    ...
}

// After:
constructor(subclassDefaults?: Partial<ComponentOptions>) {
    super({ ..._defaultStringRendererOptions, ...(subclassDefaults ?? {}) });
    ...
}
```

### `component/table/cell/Default.ts` — optional renderer parameter

```typescript
// Before:
constructor(tag?: string) {
    let renderer = new StringRenderer();
    super(tag || "td", renderer);
}

// After:
constructor(tag?: string, renderer?: StringRenderer) {
    super(tag || "td", renderer ?? new StringRenderer());
}
```

### `component/table/cell/Header.ts` — new `HeaderCellRenderer`, placed above `HeaderCell`

```typescript
const _defaultHeaderCellRendererOptions: Partial<ComponentOptions> = {
    cursor:     "default",
    userSelect: "none",
};

/**
 * {@link HeaderCell}'s own text renderer. A column title is chrome, not
 * data, so it stays unselectable with a default cursor even though
 * {@link StringRenderer} itself now opts into `cursor: "text"` /
 * `userSelect: "text"` for ordinary data cells.
 */
class HeaderCellRenderer extends StringRenderer {
    constructor() {
        super(_defaultHeaderCellRendererOptions);
    }
}
```

New imports needed in `Header.ts`: `StringRenderer` (value) from `~/component/table/cell/renderer/String.js`, `type { ComponentOptions }` from `~/core/Component.js`.

`HeaderCell`'s constructor, before → after ([Header.ts:104-128](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L104-L128)):

```typescript
// Before:
constructor(text: String, fieldName: string, headerGlyph?: string | null) {
    super("th");

    this.getAria().setRole("columnheader");
    this.getAria().setSort("none");

    this._text = text;
    this._fieldName = fieldName;
    this._headerGlyph = headerGlyph ?? null;

    let renderer = this.getRenderer();
    renderer.getText().setFontSize("--ts-ui-table-header-font-size");
    renderer.getText().setFontWeight("bold");
    renderer.getText().setText(text);

    renderer.setUserSelect("none");
    renderer.getText().setUserSelect("none");
    renderer.setCursor("default");
    // ... unchanged from here
```

```typescript
// After:
constructor(text: String, fieldName: string, headerGlyph?: string | null) {
    super("th", new HeaderCellRenderer());

    this.getAria().setRole("columnheader");
    this.getAria().setSort("none");

    this._text = text;
    this._fieldName = fieldName;
    this._headerGlyph = headerGlyph ?? null;

    let renderer = this.getRenderer();
    renderer.getText().setFontSize("--ts-ui-table-header-font-size");
    renderer.getText().setFontWeight("bold");
    renderer.getText().setText(text);

    renderer.getText().setUserSelect("none");
    // ... unchanged from here
```

`renderer.setUserSelect("none")` and `renderer.setCursor("default")` are deleted (now the renderer's own class defaults); `renderer.getText().setUserSelect("none")` stays — the child `Text` is a separate element with no class-default route in this plan's scope.

---

## Ordered Implementation Steps

1. **`Scrollbar.ts` — add `_defaultScrollArrowButtonOptions`, register it on `ScrollArrowButton`.** Per `## Internal Structure`. Delete the `setBackgroundColor` call at line 148.
   *Check:* `npm run typecheck`. `grep -n 'this.setBackgroundColor' packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — only the `_onMouseOver`/`_onMouseOut` hover calls and `ScrollbarThumb`'s (not yet added) remain.

2. **`Scrollbar.ts` — add `ScrollbarThumb` and its defaults bag; construct it instead of a bare `Component`.** Per `## Internal Structure`. Narrow the `_thumb` field type.
   *Check:* `npm run typecheck`.

3. **`ResizeHandle.ts` — add `_defaultResizeHandleOptions`, register it.** Delete the `setCursor`/`setBackgroundImage` calls.
   *Check:* `npm run typecheck`. `grep -n 'this.setCursor\|this.setBackgroundImage' packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts` — zero matches.

4. **`ComboBox.ts` — register `ComboBoxCaret`'s computed `minSize`/`maxSize`.** Per `## Internal Structure`. Delete the `setMinSize`/`setMaxSize` calls.
   *Check:* `npm run typecheck`. `grep -n 'this.setMinSize\|this.setMaxSize' packages/lib/src/typescript/lib/component/input/ComboBox.ts` — zero matches within `ComboBoxCaret`'s own constructor (matches inside other classes in the same file, if any, are unrelated and must stay).

5. **`AbstractSelectableList.ts` — register `SelectableListRow`'s `cursor`/`border`.** Delete the `setBorder`/`setCursor` calls; update the comment per `## Architecture Decisions`.
   *Check:* `npm run typecheck`. `grep -n 'this.setBorder\|this.setCursor' packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` — zero matches within `SelectableListRow`'s constructor.

6. **`String.ts` — widen `StringRenderer`'s constructor to accept `subclassDefaults`.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`. `npx vitest run tests/component/table/cell/renderer/String.test.ts` (if it exists — otherwise the nearest existing `StringRenderer` coverage) still green.

7. **`Default.ts` — add the optional `renderer` constructor parameter.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

8. **`Header.ts` — add `HeaderCellRenderer`; construct it from `HeaderCell`; delete the redundant setter calls.** Per `## Internal Structure`. Add the two new imports.
   *Check:* `npm run typecheck`. `grep -n 'renderer.setUserSelect\|renderer.setCursor' packages/lib/src/typescript/lib/component/table/cell/Header.ts` — zero matches.

9. **Add tests covering `## Expected Behaviour` rows 1-6**, following `CellTextSelection.test.ts`'s pattern for the class-rule-existence checks (`_ruleCacheHas` from `~/core/StyleTarget`) and `ClassChromeRules.test.ts`'s `declarationsDuring`/`idSelector` helpers for the per-instance-emptiness checks:
   - Row 1 (`ScrollArrowButton`) and row 2 (`ScrollbarThumb`): new `describe` blocks in `packages/lib/tests/component/container/ScrollbarArrow.test.ts` and `packages/lib/tests/component/container/Scrollbar.test.ts` respectively (both files already exist and test these two classes).
   - Row 3 (`ResizeHandle`): new file `packages/lib/tests/component/table/cell/ResizeHandle.classStyleDefaults.test.ts` — no dedicated test file exists for this class today (confirmed via `grep -rl 'ResizeHandle' packages/lib/tests`).
   - Row 4 (`ComboBoxCaret`): new `describe` block in `packages/lib/tests/component/input/ComboBox.test.ts`.
   - Row 5 (`SelectableListRow`): new file `packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts` — no dedicated test file exists today (confirmed via `grep -rl 'SelectableListRow' packages/lib/tests`).
   - Row 6 (`HeaderCellRenderer`): new `describe` block in `packages/lib/tests/component/table/cell/Header.test.ts` (the table-cell `HeaderCell` test file — not `component/display/Header.test.ts`, an unrelated component of the same name).
   *Check:* `npx vitest run` on each file above — new cases pass, nothing else regresses.

10. **`default-options-fallback.test.ts` — add registry rows** for every field this plan defaults on a class that didn't have a registered default before (`ScrollArrowButton.backgroundColor`, `ScrollbarThumb.cursor`/`backgroundColor`, `ResizeHandle.cursor`/`backgroundImage`, `ComboBoxCaret.minSize`, `SelectableListRow.cursor`/`border`, `HeaderCellRenderer.cursor`/`userSelect`), per ARCHITECTURE.md's *Class-level defaults must survive the getter*.
    *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — new rows pass.

11. **`next.md` — add the changelog bullet.** See `## Documentation Impact`.
    *Check:* `npm run docs:api` finishes with zero warnings.

12. **Full verification.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Default.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/tests/component/container/ScrollbarArrow.test.ts` |
| Modify | `packages/lib/tests/component/container/Scrollbar.test.ts` |
| Create | `packages/lib/tests/component/table/cell/ResizeHandle.classStyleDefaults.test.ts` |
| Modify | `packages/lib/tests/component/input/ComboBox.test.ts` |
| Create | `packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/Header.test.ts` |

---

## Expected Behaviour

| # | Case | Expected | Testable |
|---|---|---|---|
| 1 | Two `ScrollArrowButton`s rendered (e.g. two `Scrollbar`s with arrows enabled) | Neither's own `#id` rule carries `background-color`; `_ruleCacheHas('.ScrollArrowButton')` is `true` after the first renders | Unit |
| 2 | Two `Scrollbar`s | Neither thumb's own `#id` rule carries `background-color`/`cursor`; `_ruleCacheHas('.ScrollbarThumb')` is `true` | Unit |
| 3 | Two `ResizeHandle`s | Neither's own `#id` rule carries `background-image`/`cursor`; `_ruleCacheHas('.ResizeHandle')` is `true` (the class rule keeps only `position`/`top`/`right`/`width`/`height`/`z-index` from the pre-existing hand-rolled rule, plus the newly-hoisted pair via the separate class-tier mechanism) | Unit |
| 4 | Two `ComboBox`es under the same theme | Neither caret's own `#id` rule carries `min-width`/`min-height`/`max-width`/`max-height`; `_ruleCacheHas('.ComboBoxCaret')` is `true` | Unit |
| 5 | Two `SelectableListRow`s (e.g. two rows in the same list) | Neither's own `#id` rule carries `cursor` or any `border-*` longhand; `_ruleCacheHas('.SelectableListRow')` is `true`; `getBorderSize()` on either row still reports the 1px bottom border | Unit |
| 6 | Two `HeaderCell`s in the same table | Neither's renderer's own `#id` rule carries `cursor`/`user-select`; `_ruleCacheHas('.HeaderCellRenderer')` is `true`; an ordinary (non-header) `DefaultCell`'s renderer is unaffected and still gets `cursor: "text"`/`userSelect: "text"` from `.StringRenderer` | Unit |
| 7 | A `ComboBoxCaret` constructed, a theme change fires, then a second `ComboBoxCaret` is constructed | The second instance's own `#id` rule carries its new, post-theme-change `min-width`/`min-height`/`max-width`/`max-height` (no visual regression — see `## Architecture Decisions`) | Manual — needs a real theme-font-size change; not attempted as a unit test unless `Text.test.ts`'s own font-size tests establish a reusable theme-mocking helper (check before writing) |
| 8 | Demo app: `#/inputs` (`ComboBox`), a table with header cells and a resizable column, a `Scrollbar`-backed `autoScroll` panel, a `SelectableList` | Every touched component's appearance and behaviour (cursor, drag, resize, hover) is visually identical to before this plan | Manual |
| 9 | Style Audit panel, before/after, on the Misc tab's slow table + wide table | The six rows this plan targets are gone or reduced to whatever remainder `## Non-Goals` documents (the `ComboBoxCaret`/`Glyph` row shrinks but does not disappear; the `SelectableListRow` row shrinks to padding-only) | Manual |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

**Manual verification (rows 7-9) is required.** Start a dev server on a spare port from *this worktree*, open `#/inputs` and `#/misc` (both table-opening buttons), exercise every touched component, then open `#/style-audit` and refresh. Row 7 additionally needs a live theme switch (`#/misc`'s "Switch to classic theme" button changes the root font size) with a `ComboBox` constructed on each side of the switch.

---

## Documentation Impact

No exported symbol changes — every new class (`ScrollbarThumb`, `HeaderCellRenderer`) is module-private; `StringRenderer.constructor`'s new parameter and `DefaultCell.constructor`'s new parameter are both optional and additive, not a breaking signature change. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`:

> **`ScrollArrowButton`, `Scrollbar`'s thumb, `ResizeHandle`, `ComboBoxCaret`, `SelectableListRow`, and `HeaderCell`'s text renderer no longer duplicate their fixed styling on every instance's own CSS rule.** Each now shares one CSS rule per piece across every instance in the app. Nothing changes visually; no consumer action needed.

---

## Potential Challenges

- **`ComboBoxCaret`'s theme-derived default only fully dedupes when every instance renders under the same theme as the first one constructed.** Not a regression — see `## Architecture Decisions`' theme-change footnote; worth confirming live with a theme toggle (row 7 covers this offline, but the live Style Audit numbers will only show the byte savings for same-theme instances).
- **A future `DefaultCell` subclass (`ParentHeaderCell`, `GroupSeparatorCell`) accidentally relies on the removed single-argument constructor signature.** Not a risk: the new `renderer` parameter is optional and appended, so every existing zero/one-argument call site is unaffected — confirmed via `grep -rn 'new DefaultCell\|extends DefaultCell' packages/lib/src`.
- **`ResizeHandle`'s class rule name collision.** `_ruleCacheHas('.ResizeHandle')` for the *class-tier* mechanism is a different cache from the pre-existing hand-rolled `.ResizeHandle` rule ([ResizeHandle.ts:42-68](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L42-L68)) — both are real, separate CSS rules sharing the same selector name `.ResizeHandle`, which is safe (CSS allows multiple rules for the same selector; the browser merges them in cascade order) but worth confirming live that both rules' declarations end up applied (row 9's manual check covers this).

---

## Critical Files

| File | Why |
|---|---|
| `plans/implemented/checkbox-radio-delegate-static-style-defaults.md` | The precedent this whole plan mirrors — read before touching any file below |
| `packages/lib/src/typescript/lib/core/Component.ts` | `applyChromeOptions` (685) — the always-dispatch path that keeps `getBorderSize()` accurate for `SelectableListRow`'s registered border; `getClassStyleDefaults()` (4808); `constructor`'s `subclassDefaults` forwarding (530) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ClassStyleDefaults` (37), `ensureClassStyleRule` (222) — confirms every property this plan moves is already hoistable with zero new mechanism |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | `getClassStyleDefaults()` override (1391) — the precedent for a theme-derived (not literal) class default, cited for `ComboBoxCaret` |
| `packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts` | `constructor` (18) — the `subclassDefaults`-forwarding shape `StringRenderer`'s widened constructor must match |
| `packages/lib/src/typescript/lib/core/Util.ts` | `lineHeightPx` (174) — what `ComboBoxCaret`'s computed default calls |
| `packages/lib/tests/core/ClassChromeRules.test.ts`, `packages/lib/tests/component/table/CellTextSelection.test.ts` | Test conventions step 9's new cases copy — `declarationsDuring`/`idSelector` (`ClassChromeRules.test.ts`) and `_ruleCacheHas` (both; `CellTextSelection.test.ts` already asserts `_ruleCacheHas('.StringRenderer')` on `master` today, the direct precedent for row 6's `HeaderCellRenderer` check) |

---

## Non-Goals

- **`SelectableListRow`'s `padding`.** `padding` is not a member of `ClassStyleDefaults` — `Component.setPadding`'s runtime write ([Component.ts:2091](packages/lib/src/typescript/lib/core/Component.ts#L2091)) is the *only* code path that ever writes the `padding` CSS declaration; there is no render-time `writeRuleDeclaration("padding", ...)` phase to compare against a class default the way `cursor`/`border` have. Registering `padding` in `_defaultOptions` would fix `getPadding()`'s folding-getter value (useful for layout math) but would not, on its own, produce *any* CSS write once the imperative `setPadding` call is deleted — the declaration would vanish from the page entirely. A real fix needs either a hand-rolled module-level `.SelectableListRow { padding: ... }` rule (the `ResizeHandle`/`SortPriorityBadge` shape, kept in sync with `_defaultOptions.padding` by hand) or widening `ClassStyleDefaults`/`resolveDeclarations` to cover `padding` generally — both are a small, independent follow-up, not attempted here.
- **`ComboBoxCaret`'s owned `_glyph`'s `min-width`/`min-height`/`max-width`/`max-height`.** `checkbox-radio-delegate-static-style-defaults.md`'s own Implementation Notes already found and documented this exact blocker for `CheckboxCheckGlyph`/`RadioButtonDot`: `Glyph.applyOptions` unconditionally re-pins `minSize`/`maxSize` via a direct setter call whenever `setPreferredSize` is called, which `ComboBoxCaret`'s glyph needs (for the same "square box regardless of content" reason `CheckboxCheckGlyph` needed it) — so giving the glyph its own registered size default would not stop the duplicate write, and would add a same-valued, permanently-outranked class rule on top. Fixing this needs a `Glyph.applyOptions`-wide change, out of scope here exactly as it was there.
- **`ScrollArrowButton`'s enabled/disabled `foregroundColor` toggle, and `ScrollbarThumb`'s hover `backgroundColor` toggle.** State-dependent, rewritten on every transition — see [`state-tier-rule-dedup-followups.md`](state-tier-rule-dedup-followups.md), which depends on this plan.
- **`ScrollArrowButton`'s `:hover` background swap** (`_onMouseOver`/`_onMouseOut`, [Scrollbar.ts:297-310](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L297-L310)). Not observed as a live duplicate in this audit pass (the audit did not simulate hover), but structurally the same gap as `ScrollbarThumb`'s hover toggle. Left for a future round once it is confirmed to actually duplicate live.
- **`Component.setVisible`'s `visibility` write path.** A separate, much larger finding (roughly 1,100 duplicate instances across five component types, ~27 KB) surfaced incidentally while investigating `HeaderCell`'s renderer — `Component.setVisible` ([Component.ts:1843](packages/lib/src/typescript/lib/core/Component.ts#L1843)) writes `visibility` via the raw, non-reconciled `setElementCSSRule` instead of `setReconciledCSSRules`, so a `Card`-based show/hide toggle (`Card.syncVisible`, used by every `Cell`/`DynamicCell`/`Tab`/`Accordion`) permanently pins `visibility: inherit` onto `#id` the first time it runs. This is already under separate investigation as part of this effort; not fixed here.
- **Changes to `core/ClassStyleRules.ts` or `core/Component.ts`.** The hoisting mechanism already shipped; this plan only supplies data to it.
- **Any change to rendered appearance.** Every value written is identical before and after; only which CSS rule carries it changes.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^no-dependency]: Confirmed directly against `master` (not the in-flight `feature/checkbox-radio-delegate-state-style-defaults` chain this plan's investigation was carried out from): `subclassDefaults` forwarding, `ensureClassStyleRule`, and the render-time `writeRuleDeclaration`/`reconcileRuleDeclaration` comparison for every property this plan touches (`backgroundColor`, `backgroundImage`, `cursor`, `minSize`, `maxSize`, `border`, `userSelect`) are all already present and unchanged on `master`'s `core/Component.ts` and `core/ClassStyleRules.ts`. None of this plan's six fixes needs `getRestingExclusionSuffixes()`, `createStateStyleRule`'s class-tier comparison widening, or any other piece of the five-plan chain (`state-chrome-isolation-generalization`, `reconciled-write-path-widening`, `table-cell-class-style-defaults`, `checkbox-radio-delegate-static-style-defaults`, `checkbox-radio-delegate-state-style-defaults`) currently sitting on unmerged feature branches.

[^cursor-already-matches]: `ScrollArrowButton.setCursor("default")` ([Scrollbar.ts:147](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L147)) sets the exact same value the framework-tier `:where(.ts-ui-component)` rule already declares (`FRAMEWORK_DECLARATIONS.cursor`, [ClassStyleRules.ts:91](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L91)). The render-time comparison already skips this write with no class default registered at all — confirmed live: the Style Audit panel's `ScrollArrowButton` rows carry only `background-color`/`color`, never `cursor`.

[^theme-change-caveat]: `ensureClassStyleRule`'s cache is keyed per-class and computed once, from whichever instance renders first, for the lifetime of the page ([ClassStyleRules.ts:222-259](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L222-L259)) — this is true today for every class-tier default, not something this plan introduces. `ComboBoxCaret` already freezes each instance's own size at its own construction time (it computes `Util.lineHeightPx()` once, in the constructor, and never re-reads it) — moving that computation into `_defaultOptions` does not change *when* it is read, only *where* the resulting CSS declaration is written. A `ComboBoxCaret` built under a different theme from the first-ever instance simply fails the class-tier match and falls back to writing its own `#id` rule, exactly as every `ComboBoxCaret` does today.

---

## Implementation Notes

**`ScrollArrowButton`, `ResizeHandle`, and `SelectableListRow` gained a `subclassDefaults` parameter the plan's own `## Internal Structure` snippets omitted.** The project's `local/require-subclass-defaults` ESLint rule (`packages/lib/scripts/eslint/require-subclass-defaults.js`, enforcing ARCHITECTURE.md's *Constructors forward `subclassDefaults`*) flags any constructor that already takes at least one parameter and hands a `_default<Name>Options` constant straight to `super()` without also accepting and forwarding its own `subclassDefaults`. The rule deliberately exempts a *zero-parameter* constructor as a "fixed-configuration leaf" (matching `checkbox-radio-delegate-static-style-defaults.md`'s `CheckboxBox`/`CheckboxCheckGlyph`/`CheckboxDash` precedent, and this plan's own `ScrollbarThumb`, all zero-arg) — but `ScrollArrowButton(direction)`, `ResizeHandle(options?)`, and `SelectableListRow(handlers, index, rendererFactory)` all already had a parameter list, so the rule reported all three. Each constructor now takes an added, optional trailing `subclassDefaults?: Partial<ComponentOptions>` and merges it as `{ ..._default<Name>Options, ...(subclassDefaults ?? {}) }`, mirroring the exact shape this same plan already gives `StringRenderer`. Purely additive — no existing call site passes a colliding argument, and no subclass of any of the three exists in the tree today, the same "forward it even with no subclass yet" posture ARCHITECTURE.md calls for.

**`HeaderCellRenderer`'s Expected Behaviour row 6 claim that `_ruleCacheHas('.HeaderCellRenderer')` is `true` does not hold — dedup happens at the framework tier instead, with no class rule ever created.** `_defaultHeaderCellRendererOptions`'s two values (`cursor: "default"`, `userSelect: "none"`) are exactly `ClassStyleRules.ts`'s `FRAMEWORK_DECLARATIONS` values for the same two keys. `ensureClassStyleRule`'s own deviation filter (`classDeviations`) drops any key whose resolved value matches the framework declaration before ever constructing a `.HeaderCellRenderer` `StyleRule`, so with both values coinciding the deviations bag is empty and no class rule — and therefore no `_ruleCache` entry — is ever created. This is the same "already matches, no class default needed" case the plan's own `[^cursor-already-matches]` footnote documents for `ScrollArrowButton`'s `cursor`, just discovered a second time for a different property pair. The `#id`-rule-emptiness half of row 6 (no per-instance `cursor`/`userSelect` declaration) still holds and is what the test in `Header.test.ts` asserts; the `_ruleCacheHas` assertion was corrected to expect `false`, with a comment explaining why.

**Two pre-existing regression tests asserted on a per-instance rule the `ScrollbarThumb` change now eliminates, and needed a different proxy.** `tests/core/Panel.styleRuleDisposal.test.ts` (case B1-2) and `tests/component/container/VirtualScroller.styleRuleDisposal.test.ts` (case B1-3) guard against a real, previously-fixed leak (`Component.destructor()`'s child recursion never reaching a raw-appended `Scrollbar`) by checking that the scrollbar's thumb — documented in both files as "the reliable per-instance proxy" because its cursor/backgroundColor "always deviate" — has a materialised `#id` rule before teardown and none after. This plan's `ScrollbarThumb` change moves exactly those two properties onto the shared `.ScrollbarThumb` class rule, so a thumb with no other deviation now materialises no `#id` rule of its own at all, and both tests failed (`_ruleCacheKeys()` no longer contained the thumb's id at any point). Both were updated to use the scrollbar's start arrow button instead — its `foregroundColor` is imperative and was never a candidate for hoisting in this plan (`## Non-Goals`), so it still always deviates and still guarantees a rule — with the doc comments in both files updated to explain the change. No plan file outside this one names these two tests; they were found via the full `npm test` run in `## Verification`, not a step-level check, since neither test file is part of this plan's own `## Files to Create / Modify / Delete` table.
