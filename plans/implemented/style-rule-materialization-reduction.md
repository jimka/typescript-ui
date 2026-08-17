# Style-Rule Materialization Reduction — Implementation Plan

## Overview

A profiling session on `Table.setDisplayMode` ([packages/lib/src/typescript/lib/component/table/Table.ts](packages/lib/src/typescript/lib/component/table/Table.ts)) found that switching a wide table's display mode is dominated by per-instance CSS stylesheet-rule churn: `DOM.sink.ensureStyleRule`/`setRuleStyles` ([packages/lib/src/typescript/lib/core/DOM.ts:1563](packages/lib/src/typescript/lib/core/DOM.ts#L1563)) accounted for 94% of one profiled switch's cost. `Component.applyStyle` ([packages/lib/src/typescript/lib/core/Component.ts:4646](packages/lib/src/typescript/lib/core/Component.ts#L4646)) already has a three-tier lazy design — a framework-wide rule, a per-class rule, and a per-instance `#id` rule — that is supposed to let most components skip materializing their own rule. Live instrumentation found it isn't working: of 6,225 components rendered in one large-table switch, 5,615 (90%) materialized a `#id` rule for reasons that turn out to be avoidable bugs or gaps in the class-rule mechanism, not genuine per-instance state.

This plan fixes eight of those avoidable causes, all found and verified by reading the current source (not assumed from the profiling write-up):

1. `border: null` is written unconditionally by every component with no border, but the class-rule comparison bag has no `border` key, so it always looks like a divergence.
2. `cursor: "text"` / `userSelect: "text"` on the table's text-rendering cell renderers are set with imperative constructor calls that bypass the class-defaults mechanism entirely.
3. `outline: "none"` on `Checkbox` ([packages/lib/src/typescript/lib/component/input/Checkbox.ts:37-39](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L37-L39)) is already a correct class default, but `ensureClassStyleRule` doesn't know how to hoist `outline` at all.
4. `color` (`foregroundColor`) on every `Cell` ([packages/lib/src/typescript/lib/component/table/cell/Cell.ts:63](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L63)) is set with an imperative constructor call for the same reason as (2).
5. `Cell.setBaseBackground` ([packages/lib/src/typescript/lib/component/table/cell/Cell.ts:309](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L309)) re-materializes a pooled cell's `#id` rule on every column-window recycle, the same problem `Row.updateVisualState` ([packages/lib/src/typescript/lib/component/table/Row.ts:224](packages/lib/src/typescript/lib/component/table/Row.ts#L224)) already solved for rows with a direct inline-style write.
6. Ten `Text` children across the library opt into selectable text with a per-instance `setUserSelect("text")` call (and, at three of them, a `setCursor("text")` call too) — one class-uniform value spelled ten times. A new `SelectableText` subclass of `Text`, living beside it in `component/input/`, carries both as class defaults; nine of the ten switch to it.
7. `Markdown` ([packages/lib/src/typescript/lib/component/display/Markdown.ts:602-610](packages/lib/src/typescript/lib/component/display/Markdown.ts#L602-L610)) and `WysiwygSurface`, the contenteditable host inside `MarkdownEditor` ([packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts:168-180](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L168-L180)), each set their own `userSelect`/`cursor` imperatively in their constructor. Both are class-uniform and move to a defaults bag.
8. `Link` ([packages/lib/src/typescript/lib/component/input/Link.ts:104-109](packages/lib/src/typescript/lib/component/input/Link.ts#L104-L109)) already carries a class-defaults bag, `_defaultLinkOptions` — the same mechanism items 2 and 7 use to replace an imperative call — but the bag never sets `userSelect`, so a `Link`'s text falls through to the framework default of `"none"`. `LinkCellRenderer` ([packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts:74](packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts#L74)) papers over the gap with a per-instance `this._text.setUserSelect("text")` call on its child `Link`. `Link` gains `userSelect: "text"` in its own defaults bag instead, and the imperative call is removed.

Fixes (6) and (7) remove declarations, not whole rules: `Text.applyStyle` ([Text.ts:1245-1272](packages/lib/src/typescript/lib/component/input/Text.ts#L1245-L1272)) writes twelve font and text declarations into every `Text`'s own `#id` rule on every render, so that rule exists either way.[^text-rule-exists-anyway] Their value is a smaller rule body per instance, one less inline-style write per `setCursor` call, and a single named home for a value the library currently repeats at ten call sites.

Two candidates turned out **not** to be safely fixable this way — `Checkbox`'s `borderRadius` and a blanket `userSelect` default on `Text` itself. Both are dropped; see [Non-Goals](#non-goals).

The mechanism these fixes extend is `ensureClassStyleRule` in [packages/lib/src/typescript/lib/core/ClassStyleRules.ts:140](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L140), which computes, once per concrete class, a merged declaration bag the framework and class stylesheet rules already deliver. `Component.writeRuleDeclaration` ([packages/lib/src/typescript/lib/core/Component.ts:4621](packages/lib/src/typescript/lib/core/Component.ts#L4621)) compares every render-time value against that bag and only queues a per-instance `#id`-rule write when the value genuinely differs.

---

## Architecture Decisions

### Extend `ensureClassStyleRule`'s declaration set; don't special-case classes

`ClassStyleRules.ts` already generalizes one property this way: `cursor` is read from a `ClassStyleDefaults.cursor` field, itself read from `Component._defaultOptions.cursor`.[^cursor-already-generic] This plan adds three more fields the exact same way — `userSelect`, `outline`, and `color` (sourced from `ComponentOptions.foregroundColor`) — plus one framework-wide constant, `border`, that needs no per-class field at all. No class is named inside `ClassStyleRules.ts`; every affected class becomes correct purely by populating its own `_defaultOptions` correctly, which the remaining decisions below and the per-file steps set up for each affected class.

### `border: null` becomes a framework-wide constant, not a per-class default

`Component.applyChromeStyles` ([Component.ts:4804-4809](packages/lib/src/typescript/lib/core/Component.ts#L4804-L4809)) writes `writeRuleDeclaration("border", null)` whenever a component has no border. This is the *only* path that ever consults `_inheritedStyleBag.border` — a component **with** a real border goes through a completely different, unconditional call (`this._styleRule.queueMany(borderToStyle(this._border))`) that never looks at the class bag at all.[^border-queueMany] So there is nothing to make per-class: every class's "no border" resolution is the same value, `null`, forever. The fix adds a literal `border: null` to both `FRAMEWORK_DECLARATIONS` and `resolveDeclarations`'s returned bag — a bookkeeping-only change (`writeDeclaration` in [DOM.ts:304-316](packages/lib/src/typescript/lib/core/DOM.ts#L304-L316) treats a `null`-valued style as "no declaration", so the `:where(.ts-ui-component)` rule gains no visible CSS at all).[^border-safety]

### A component element never inherits `cursor` or `user-select` from its parent

`ensureFrameworkStyleRule` ([ClassStyleRules.ts:66-74](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L66-L74)) writes `cursor: default` and `user-select: none` into `:where(.ts-ui-component)`, and every rendered element carries that class ([Component.ts:5728](packages/lib/src/typescript/lib/core/Component.ts#L5728)). A declaration that matches the element itself always beats an inherited value, whatever its specificity — CSS inheritance only fills in properties the element has no declared value for. So a `Text` nested inside a renderer that declares `cursor: text` still resolves to `default` unless it declares `text` in its own right.

That declaration rule is why each inner `Text` needs its own `user-select` opt-in, and every decision below rests on it.

### Hoist `cursor`/`userSelect` onto each cell-renderer class, not onto `Text`

`StringRenderer`, `NumberRenderer`, `DateRenderer`, `DateTimeRenderer`, `TimeRenderer`, `ComboRenderer`, and `LinkCellRenderer` (all in `packages/lib/src/typescript/lib/component/table/cell/renderer/`) each call `this.setUserSelect("text")` and `this.setCursor("text")` imperatively in their constructor.[^seven-renderers] The renderer's own root element is safe to hoist: every instance of e.g. `StringRenderer` really does want `cursor: "text"`, and `tests/component/table/CellTextSelection.test.ts` already asserts this for all seven classes plus three call sites that deliberately override it back to `"none"`/`"default"` (`HeaderCell`, `ParentHeaderCell`, `GroupSeparatorCell` — see [Header.ts:119-128](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L119-L128)).

`Text` itself is **not** safe to hoist: it is the framework's general-purpose text component, used everywhere from `Button` labels to `MenuItem` titles, and `CellTextSelection.test.ts` also asserts those stay `userSelect: "none"`. A blanket default on `Text` would flip every button label and menu title framework-wide to selectable text. The renderers' inner text children move to `SelectableText` instead — the next decision.

### `SelectableText` carries the selectable-text default for the whole library

A new `SelectableText extends Text` in `packages/lib/src/typescript/lib/component/input/SelectableText.ts` defaults `userSelect: "text"` and `cursor: "text"` through a module-level `_defaultSelectableTextOptions` bag passed to `super()`. It mirrors `Link` ([Link.ts:104-149](packages/lib/src/typescript/lib/component/input/Link.ts#L104-L149)), the library's existing `Text` subclass whose whole purpose is a class-default styling bag — same module-level constant, same `subclassDefaults` forwarding, same `callable()` export pair, same barrel entry.[^selectable-precedent]

Ten `Text` children currently write those values per instance. Nine switch to `SelectableText`; `LinkCellRenderer`'s does not, because its child is a `Link`, not a plain `Text` — its own fix follows this table. The table also lists the three header cells that override the value back off: unchanged code, included because the swap has to keep them working.

| Site | Today | After | Visible change |
|---|---|---|---|
| `_text` in `StringRenderer`, `NumberRenderer`, `DateRenderer`, `DateTimeRenderer`, `TimeRenderer`, `ComboRenderer` | `new Text()` + `this._text.setUserSelect("text")` | `new SelectableText()`, imperative call removed | none — `user-select` moves from the `#id` rule to `.SelectableText`; the added `cursor` never shows because each `_text` sets `pointerEvents: "none"` and so is never the hit target[^cursor-inert] |
| `HeaderCell`, `ParentHeaderCell`, `GroupSeparatorCell` | `renderer.getText().setUserSelect("none")` | unchanged | none — the write now overrides a class default instead of restating the framework value, and `_options` still beats `_defaultOptions` in the folding getter |
| `Notification._messageText` ([Notification.ts:195-203](packages/lib/src/typescript/lib/overlay/Notification.ts#L195-L203)), `Notification.showDetail`'s `content` ([Notification.ts:512-518](packages/lib/src/typescript/lib/overlay/Notification.ts#L512-L518)), `Dialog`'s `messageText` ([Dialog.ts:629-635](packages/lib/src/typescript/lib/overlay/Dialog.ts#L629-L635)) | `new Text(...)` + `setUserSelect("text")` + `setCursor("text")` | `new SelectableText(...)`, both imperative calls removed | none — both declarations move to `.SelectableText`, and the inline `cursor` write `setCursor` performs disappears |

Every converted site keeps its declared type as `Text`, changing only the constructed class.[^declared-type] `SelectableText` passes `child instanceof Text` in `CellRenderer.doLayout` ([CellRenderer.ts:114](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L114)), so the renderers' line-height centring is unaffected. `LinkCellRenderer._text` is a `Link`, not a plain `Text`, so it is not part of this conversion — its own fix is below.

### `Link` gets its own `userSelect` default; it does not become a `SelectableText`

`LinkCellRenderer`'s `_text` field is a `Link` ([Link.ts:104-109](packages/lib/src/typescript/lib/component/input/Link.ts#L104-L109)), not a plain `Text` — swapping it for a `SelectableText` would drop `Link`'s own class defaults (`tag: "a"`, the link colour, `cursor: "pointer"`). `Link` already carries its own class-defaults bag, `_defaultLinkOptions`, the same mechanism `SelectableText` and the seven cell renderers use — it just never set `userSelect`. Adding `userSelect: "text"` there fixes the gap the same way `Checkbox`'s `outline` and `Cell`'s `foregroundColor` are fixed below: by populating the owning class's own defaults bag, not by routing through another class.[^link-not-selectabletext]

This makes every `Link` in the app selectable text by default, not only the one inside `LinkCellRenderer` — `ensureClassStyleRule`'s cache keys on the concrete constructor, so there is no per-call-site opt-in short of a second `Link` subclass. A link's label is content the reader may want to select and copy, the same category `SelectableText`'s own docstring puts dialog and notification messages in, so this is the correct default, not just an expedient one.

### `Markdown` and `WysiwygSurface` hoist their own `userSelect`/`cursor`

Both classes set the same two values on themselves at construction, on every instance, and neither is a `Text` subclass — `Markdown extends Component<MarkdownOptions>` and `WysiwygSurface extends Component`. Each gets a module-level defaults bag passed to `super()`, the same pattern the seven renderer classes use. The declarations move from each instance's `#id` rule to a `.Markdown` / `.WysiwygSurface` class rule; both classes' raw-DOM children still inherit them, because the declaration is still on the host element.[^markdown-inheritance]

`Markdown` gains a third `subclassDefaults` parameter, per ARCHITECTURE.md's *Constructors forward `subclassDefaults`*. `WysiwygSurface` does not: it is file-private, takes no options bag, and cannot be subclassed from outside `MarkdownEditor.ts`.[^surface-private]

### Hoist `Cell`'s `foregroundColor`; drop `Checkbox`'s `borderRadius`

`Cell`'s constructor ([Cell.ts:63](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L63)) imperatively sets `foregroundColor` to the same token on every instance, and no other call site in `component/table/` ever overrides it — safe to hoist onto `Cell` itself, benefiting every subclass (`DefaultCell`, `HeaderCell`, `ParentHeaderCell`, `FilterCell`, …) with one change. `Checkbox`'s `borderRadius`, by contrast, is set on `this._box` ([Checkbox.ts:75-85](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L75-L85)) — a plain, anonymous `new Component()`, not a named subclass. `ensureClassStyleRule`'s cache is keyed on the concrete constructor, so hoisting anything onto bare `Component` would apply it to *every* bare-`Component` instance framework-wide, not just Checkbox's box. Fixing this properly would mean extracting `_box` into its own named class — out of scope here (see [Non-Goals](#non-goals)). `Checkbox`'s `outline` has no such problem: it's already set via `_defaultCheckboxOptions` ([Checkbox.ts:37-39](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L37-L39)) directly on `Checkbox` itself, so only the `ClassStyleRules.ts` generalization is needed. `BooleanEditor` ([packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts)) never sets `outline`/`borderRadius` itself — it only owns a `Checkbox` instance (`this._checkBox = new Checkbox()`) — so it needs no change at all; every `Checkbox` it constructs benefits from the `ClassStyleRules.ts` fix automatically.

### `Cell.setBaseBackground` writes an inline style but keeps its cache

`Row.updateVisualState`'s inline-style pattern is the precedent — but it cannot be copied verbatim.[^row-precedent] `Row` has no getter that reads its tint back, so it bypasses `Component._options` entirely. `Cell` does: `getBackgroundColor()` is a public, tested contract (`tests/component/table/cell/Cell.test.ts:92-153`, `tests/component/table/Body.test.ts:1121-1126`, `tests/component/table/HeaderColumnWindow.test.ts:237-253`) that must keep returning the current read-only/group-color tint after a `setReadOnly`/`setBaseBackground` call. `_applyStateTint` ([Cell.ts:323-342](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L323-L342)) therefore keeps writing the resolved value into `this._options.backgroundColor` directly (the same cache `Component.getBackgroundColor()` already reads), but replaces the call to `this.setBackgroundColor(...)` — which unconditionally re-materializes the `#id` rule via `setElementCSSRule` — with a direct `DOM.sink.apply` inline-style write, guarded by an element-existence check exactly like `Row.updateVisualState`. Both branches of `_applyStateTint` (read-only tint and base/group background) move together: they share one resolved value and are mutually exclusive, so fixing only one would leave the other on the expensive path for every read-only cell's rebind.

Both call sites that invoke `setBaseBackground` on a freshly-built cell (`Header.ts:809` and `Row.ts:462`) do so immediately after `addComponent`, which synchronously creates the child's element once the parent row is already mounted — so the element-existence guard is not expected to skip a real write in practice; it exists for parity with `Row.updateVisualState` and as a defensive no-op for a cell that outlives its row.[^element-guard] Even if it did skip, `applyBoxAndVisibilityStyles`'s normal render path re-derives `getBackgroundColor()` and writes it through the CSS-rule path at first render, so no state is ever lost — only deferred to the rule mechanism for that one render.

`ParentHeaderCell` never calls `setBaseBackground` — it calls `setBackgroundColor` directly, once, in its own constructor ([ParentHeader.ts:69](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L69)) — and `Header.rebuildParentCells` ([Header.ts:856-920](packages/lib/src/typescript/lib/component/table/Header.ts#L856-L920)) disposes and reconstructs every `ParentHeaderCell` from scratch rather than recycling them, so it needs no change: there is no pooled rebind to make cheap.

---

## Public API

One new exported component, `SelectableText`, plus two additive signature widenings. Nothing is removed or renamed.

```typescript
// component/input/SelectableText.ts — NEW
export interface SelectableTextOptions extends TextOptions {
}

class SelectableText extends Text<SelectableTextOptions> {
    constructor(
        text?: String,
        options?: SelectableTextOptions,
        subclassDefaults?: Partial<SelectableTextOptions>,
    );
}

const SelectableTextCallable = callable(SelectableText);
type SelectableTextCallable = SelectableText;
export {
    SelectableText         as _SelectableText,
    SelectableTextCallable as SelectableText,
};
```

```typescript
// core/Component.ts — new option, existing shape
export interface ComponentOptions {
    // ...
    cursor?:     string;
    userSelect?: string;   // NEW — mirrors `cursor`
    // ...
}

getUserSelect(): string | null;      // now folds `_defaultOptions.userSelect`
setUserSelect(value: string): this;  // now caches into `_options.userSelect`
clearUserSelect(): this;             // now clears via `_options.userSelect = undefined`
```

```typescript
// component/display/Markdown.ts — widened constructor
class Markdown extends Component<MarkdownOptions> {
    constructor(
        markdown?: string,
        options?: MarkdownOptions,
        subclassDefaults?: Partial<MarkdownOptions>,   // NEW, optional
    );
}
```

```typescript
// component/table/cell/renderer/CellRenderer.ts — widened constructor
export abstract class CellRenderer<T> extends Component {
    constructor(subclassDefaults?: Partial<ComponentOptions>);
}
```

All seven renderer constructors keep their existing parameters and gain nothing new on their public surface — the `subclassDefaults` plumbing is internal, passed by each renderer's own constructor to `super(...)`, not by callers.

---

## Internal Structure

### `ClassStyleRules.ts`: widened types and declaration set

```typescript
type ClassStyleBag = Readonly<Record<string, string | null>>;   // was Record<string, string>

interface ClassStyleDefaults {
    visible?:         boolean | null;
    displayed?:        boolean;
    minSize?:          { width: number; height: number } | null;
    maxSize?:          { width: number; height: number } | null;
    overflow?:         string | null;
    cursor?:           string | null;
    userSelect?:       string | null;   // NEW
    outline?:          string | null;   // NEW
    foregroundColor?:  string | null;   // NEW — maps to the CSS `color` declaration
}

const FRAMEWORK_DECLARATIONS: ClassStyleBag = Object.freeze({
    boxSizing:  "border-box",
    position:   Position.ABSOLUTE,
    display:    "block",
    visibility: "inherit",
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor:     "default",
    border:     null,                 // NEW — constant; no per-class variation exists
    margin:     "0px 0px 0px 0px",
    minWidth:   "0px",
    minHeight:  "0px",
    maxWidth:   "none",
    maxHeight:  "none",
    overflowX:  "hidden",
    overflowY:  "hidden",
});

function resolveDeclarations(defaults: ClassStyleDefaults): Record<string, string | null> {
    // ...unchanged minSize/maxSize/overflow resolution...

    const declarations: Record<string, string | null> = {
        boxSizing:  "border-box",
        position:   Position.ABSOLUTE,
        display:    (defaults.displayed ?? true) ? "block" : "none",
        visibility: (defaults.visible ?? null) === false ? "hidden" : "inherit",
        whiteSpace: "nowrap",
        userSelect: defaults.userSelect ?? "none",   // was hardcoded "none"
        cursor:     defaults.cursor ?? "default",
        border:     null,                            // NEW — constant, not defaults-derived
        margin:     "0px 0px 0px 0px",
        minWidth:   minSize ? minSize.width  + "px" : "auto",
        minHeight:  minSize ? minSize.height + "px" : "auto",
        maxWidth:   maxSize ? (isUnbounded(maxSize.width)  ? "none" : maxSize.width  + "px") : "none",
        maxHeight:  maxSize ? (isUnbounded(maxSize.height) ? "none" : maxSize.height + "px") : "none",
        overflowX:  overflow ?? "visible",
        overflowY:  overflow ?? "visible",
    };

    // outline/color are conditional: most classes declare neither, and
    // Component only ever writes them when non-null (see applyChromeStyles /
    // applyBoxAndVisibilityStyles), so an absent key here must stay absent —
    // never introduce a key with value `undefined`.
    if (defaults.outline)         declarations.outline = defaults.outline;
    if (defaults.foregroundColor) declarations.color   = defaults.foregroundColor;

    return declarations;
}
```

`classDeviations`'s return type also widens to `Record<string, string | null>` (it assigns `resolved[key]` verbatim); no other line in that function changes; `border`'s resolved value equals `FRAMEWORK_DECLARATIONS.border` (`null === null`) for every class, so it is never included as a deviation.

**Why `outline`/`color` are conditional but `userSelect`/`cursor` are not:** `applyMiscInlineStyles` writes `userSelect` whenever `getUserSelect()` is truthy and `applyBoxAndVisibilityStyles` writes `cursor` whenever `getCursor()` is truthy — but every class's resolved value (framework default `"none"`/`"default"`, or a class override) is *always* truthy, so in practice these two keys are always present. `outline` and `color` have no such non-empty framework default — most classes resolve to `null` and get no declaration and no key at all, which the `if (defaults.X)` guards mirror exactly.

### `SelectableText.ts`: the whole file

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text, TextOptions } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link SelectableText}.
 *
 * @category Components
 */
export interface SelectableTextOptions extends TextOptions {
}

// Class-level defaults, resolved once per class by `resolveClassDefaults` and
// read back through the folding `getUserSelect()` / `getCursor()` getters —
// never dispatched into `_options`, so they land on the shared
// `.SelectableText` rule instead of each instance's `#id` rule.
const _defaultSelectableTextOptions: Partial<SelectableTextOptions> = {
    userSelect: "text",
    cursor:     "text",
};

/**
 * Text the reader can select and copy, with a matching text cursor.
 *
 * Framework {@link Text} is unselectable by default, because most text in a UI
 * is chrome — a button label, a menu title. Use `SelectableText` for content
 * the reader is meant to be able to select: a dialog or notification message,
 * a data cell's value.
 *
 * @category Components
 */
class SelectableText extends Text<SelectableTextOptions> {

    constructor(
        text?: String,
        options?: SelectableTextOptions,
        subclassDefaults?: Partial<SelectableTextOptions>,
    ) {
        super(text, options, { ..._defaultSelectableTextOptions, ...(subclassDefaults ?? {}) });
    }
}

const SelectableTextCallable = callable(SelectableText);
type SelectableTextCallable = SelectableText;
export {
    SelectableText         as _SelectableText,
    SelectableTextCallable as SelectableText,
};
```

### `Cell.ts`: `_applyStateTint`

```typescript
private _applyStateTint(): void {
    const background = this._readOnly
        ? 'var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))'
        : this._baseBackground;

    // Pooled, frequently-rebound cell: Row.setColumnWindow / Header's column
    // reconciler call setBaseBackground (and Body.applyReadOnlyState calls
    // setReadOnly) on every recycle pass, not just on a real change. Routing
    // through the persistent setBackgroundColor setter would re-materialise
    // this cell's #id stylesheet rule every time — the same cost
    // Row.updateVisualState already avoids for rows. Cache the resolved
    // value directly (so getBackgroundColor() keeps answering correctly —
    // see Cell.test.ts's background/cursor/outline precedence block) and
    // paint it as a direct inline style instead.
    if (this._options.backgroundColor !== background) {
        this._options.backgroundColor = background;

        const el = this.getElement();
        if (el) {
            DOM.sink.apply(el, { style: { 'background-color': background } });
        }
    }

    if (this._readOnly) {
        this.setCursor('default');
    } else {
        this.clearCursor();
    }

    if (this._requiredEmpty && !this._readOnly) {
        this.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-required-outline, rgba(220, 60, 60, 0.6))');
    } else {
        this.clearShadow();
    }
}
```

Only the background branch changes; the cursor and shadow branches are untouched (see [Non-Goals](#non-goals) for the cursor toggle).

---

## Ordered Implementation Steps

1. **`core/ClassStyleRules.ts`** — widen `ClassStyleBag` to `Readonly<Record<string, string | null>>`; add `userSelect?: string | null`, `outline?: string | null`, `foregroundColor?: string | null` to `ClassStyleDefaults`; add `border: null` to `FRAMEWORK_DECLARATIONS`; update `resolveDeclarations` per the [Internal Structure](#internal-structure) snippet (read `defaults.userSelect`, add the constant `border: null`, conditionally add `outline`/`color`); widen `resolveDeclarations`'s and `classDeviations`'s return types to `Record<string, string | null>`.
   Check: `npx tsc --noEmit` on `packages/lib` — no new errors from this file alone yet (Component.ts's matching type still needs step 2).

2. **`core/Component.ts`**:
   - Widen `_inheritedStyleBag`'s field type ([Component.ts:446](packages/lib/src/typescript/lib/core/Component.ts#L446)) to `Readonly<Record<string, string | null>> | null`.
   - Add `userSelect?: string;` to `ComponentOptions` ([Component.ts:123-160](packages/lib/src/typescript/lib/core/Component.ts#L123-L160)), next to `cursor?: string;` ([Component.ts:140](packages/lib/src/typescript/lib/core/Component.ts#L140)).
   - Remove the `private _userSelect : string | null;` field declaration ([Component.ts:435](packages/lib/src/typescript/lib/core/Component.ts#L435)) and the constructor line `this._userSelect = "none";` ([Component.ts:541](packages/lib/src/typescript/lib/core/Component.ts#L541)).
   - Add `if (options.userSelect !== undefined) this.setUserSelect(options.userSelect);` to `applyOptions` ([Component.ts:612](packages/lib/src/typescript/lib/core/Component.ts#L612)), next to the `cursor` dispatch.
   - Rewrite `getUserSelect`/`setUserSelect`/`clearUserSelect` ([Component.ts:4526-4565](packages/lib/src/typescript/lib/core/Component.ts#L4526-L4565)) to the `_options`-backed folding shape shown in [Public API](#public-api), mirroring `getCursor`/`setCursor`/`clearCursor` ([Component.ts:2381-2415](packages/lib/src/typescript/lib/core/Component.ts#L2381-L2415)) exactly — including `getCursor`'s key-presence test (`"userSelect" in this._options ? … : this._defaultOptions.userSelect ?? null`) and `setCursor`'s unchanged-value early return — except keeping `setElementCSSRule` (userSelect's existing DOM-write primitive, not `setElementStyle`).
   - In `applyMiscInlineStyles` ([Component.ts:4878-4880](packages/lib/src/typescript/lib/core/Component.ts#L4878-L4880)), replace `if (this._userSelect) { this.writeRuleDeclaration("userSelect", this._userSelect); }` with `const userSelect = this.getUserSelect(); if (userSelect) { this.writeRuleDeclaration("userSelect", userSelect); }`.
   Check: `grep -n "_userSelect" packages/lib/src/typescript/lib/core/Component.ts` — zero matches left.

3. **Create `component/input/SelectableText.ts`** — the full file is given in [Internal Structure](#internal-structure). It depends on step 2's `ComponentOptions.userSelect` field; written before it, the defaults bag will not typecheck.
   Check: `npx tsc --noEmit` — the new file compiles.

4. **`component/input/index.ts`** — add, immediately after the two `Text` lines ([index.ts:3-4](packages/lib/src/typescript/lib/component/input/index.ts#L3-L4)):
   ```typescript
   export { SelectableText } from '~/component/input/SelectableText.js';
   export type { SelectableTextOptions } from '~/component/input/SelectableText.js';
   ```
   Check: `npx tsc --noEmit`; the barrel is already a typedoc entry point ([typedoc.json:11](packages/lib/typedoc.json#L11)), so no config change is needed.

5. **`component/table/cell/renderer/CellRenderer.ts`** — import `ComponentOptions` from `~/core/Component.js`; change the constructor to `constructor(subclassDefaults?: Partial<ComponentOptions>) { super(undefined, subclassDefaults); ... }` (body otherwise unchanged).
   Check: `npx tsc --noEmit` — `CellRenderer` compiles.

6. **`component/table/cell/renderer/String.ts`** (worked example — steps 7-11 repeat this shape):
   - Import `ComponentOptions` from `~/core/Component.js` and `SelectableText` from `~/component/input/SelectableText.js`. Keep the existing `Text` import — the `_text` field's declared type stays `Text`.
   - Add a module-level `const _defaultStringRendererOptions: Partial<ComponentOptions> = { cursor: "text", userSelect: "text" };` above the class.
   - Change the field initialiser ([String.ts:18](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L18)) from `private _text: Text = new Text();` to `private _text: Text = new SelectableText();`. Leave `getText(): Text` ([String.ts:48-50](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L48-L50)) alone.
   - Change `constructor() { super(); ... }` to `constructor() { super(_defaultStringRendererOptions); ... }`.
   - Remove all three imperative lines: `this.setUserSelect("text");` ([String.ts:36](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L36)), `this._text.setUserSelect("text");` ([String.ts:37](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L37)), and `this.setCursor("text");` ([String.ts:40](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L40)). Keep `this._text.setPointerEvents("none");`.
   - Replace the comment above them ([String.ts:30-39](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L30-L39)) with one that keeps the original reasoning and states the new mechanism: the renderer is the element the pointer hits (the `Text` stays `pointer-events: none`), so its own `cursor`/`user-select` — now from `_defaultStringRendererOptions` — is what the browser uses; the child still needs its own `user-select`, which it now gets from being a `SelectableText` rather than from an imperative call.
   Check: `tests/component/table/CellTextSelection.test.ts` — `'StringRenderer and its Text opt in'` still passes unmodified.

7. **`component/table/cell/renderer/Number.ts`** — same shape. `_defaultNumberRendererOptions`. Field at [Number.ts:19](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L19). Constructor is `constructor(align: "left" | "right" = "right")` — becomes `constructor(align: "left" | "right" = "right") { super(_defaultNumberRendererOptions); ... }`. Remove lines 40, 41 and 42 ([Number.ts:40-42](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L40-L42)).

8. **`component/table/cell/renderer/Date.ts`** — same shape. `_defaultDateRendererOptions`. Field at [Date.ts:17](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L17). Remove lines 29, 30 and 31 ([Date.ts:29-31](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L29-L31)).

9. **`component/table/cell/renderer/DateTime.ts`** — same shape. `_defaultDateTimeRendererOptions`. Field at [DateTime.ts:17](packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L17). Constructor is `constructor(showSeconds: boolean = false)`. Remove lines 31, 32 and 33 ([DateTime.ts:31-33](packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L31-L33)).

10. **`component/table/cell/renderer/Time.ts`** — same shape. `_defaultTimeRendererOptions`. Field at [Time.ts:18](packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L18). Constructor is `constructor(showSeconds: boolean = false)`. Remove lines 32, 33 and 34 ([Time.ts:32-34](packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L32-L34)).

11. **`component/table/cell/renderer/Combo.ts`** — same shape. `_defaultComboRendererOptions`. Field at [Combo.ts:24](packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L24). Constructor is `constructor(optionList: Array<ComboOption | string>)`. Remove lines 46, 47 and 48 ([Combo.ts:46-48](packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L46-L48)).

12. **`component/input/Link.ts`** — add `userSelect: "text"` to `_defaultLinkOptions` ([Link.ts:104-109](packages/lib/src/typescript/lib/component/input/Link.ts#L104-L109)), next to `cursor: "pointer"`. This is the same `_defaultOptions` bag `tag`/`foregroundColor`/`cursor`/`interactive` already use, so no other change is needed in this file — the folding `getUserSelect()` rewritten in step 2 picks it up automatically.
    Then **`component/table/cell/renderer/Link.ts`** — `_defaultLinkCellRendererOptions`; constructor is `constructor(options?: LinkCellRendererOptions)` and becomes `super(_defaultLinkCellRendererOptions)`. Remove all three lines 73-75 ([Link.ts:73-75](packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts#L73-L75)) — the same three-line removal as steps 6-11. `this.setUserSelect("text")` / `this.setCursor("text")` (lines 73, 75) are superseded by `_defaultLinkCellRendererOptions`, and `this._text.setUserSelect("text")` (line 74) is now superseded by the `Link` default just added above. Keep `this._text = new Link("", {...})` as it is — this renderer's child is a `Link`, not a plain `Text`, and does not become a `SelectableText` (see [Architecture Decisions](#architecture-decisions)). Do not import `SelectableText` here.
    Check after steps 6-12: every `it(...)` in `tests/component/table/CellTextSelection.test.ts` still passes unmodified — it is the exact regression suite for this whole block of changes. Also check: `new Link('x').getUserSelect()` returns `'text'`.

13. **`overlay/Notification.ts`** — add `import { SelectableText } from "~/component/input/SelectableText.js";` (keep the existing `Text` import; `_messageText`'s declared type at [Notification.ts:131](packages/lib/src/typescript/lib/overlay/Notification.ts#L131) stays `Text`). Change `this._messageText = new Text(message);` ([Notification.ts:195](packages/lib/src/typescript/lib/overlay/Notification.ts#L195)) to `new SelectableText(message)` and remove lines 202-203 (`setUserSelect`/`setCursor`). Change `const content = new Text(message);` ([Notification.ts:512](packages/lib/src/typescript/lib/overlay/Notification.ts#L512)) to `new SelectableText(message)` and remove lines 517-518. Leave every other setter on both (`setLineClamp`, `setWhiteSpace`, `setWordBreak`, `setAutoMeasure`, `setPadding`) untouched.
    Check: `grep -n "new Text(" packages/lib/src/typescript/lib/overlay/Notification.ts` — zero matches.

14. **`overlay/Dialog.ts`** — add `import { SelectableText } from "~/component/input/SelectableText.js";` (keep the `Text` import — `DialogTitleBar._titleText` at [Dialog.ts:220](packages/lib/src/typescript/lib/overlay/Dialog.ts#L220) still uses it). Change `const messageText = new Text(config.message ?? '');` ([Dialog.ts:629](packages/lib/src/typescript/lib/overlay/Dialog.ts#L629)) to `new SelectableText(config.message ?? '')` and remove the `messageText.setUserSelect("text");` / `messageText.setCursor("text");` lines ([Dialog.ts:633-634](packages/lib/src/typescript/lib/overlay/Dialog.ts#L633-L634)). Leave `setWhiteSpace`/`setWordBreak`/`setPadding` alone.
    Check: `tests/overlay/Dialog.test.ts`'s `'makes a message dialog's body text selectable and copyable'` still passes unmodified.

15. **`component/table/cell/Cell.ts`** — import `ComponentOptions` from `~/core/Component.js` (alongside the existing `Component` import). Add a module-level `const _defaultCellOptions: Partial<ComponentOptions> = { foregroundColor: 'var(--ts-ui-table-cell-color, inherit)' };` above the class. Change `super({ tag: tag || "td" });` ([Cell.ts:51](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L51)) to `super({ tag: tag || "td" }, _defaultCellOptions);`. Remove `this.setForegroundColor('var(--ts-ui-table-cell-color, inherit)');` ([Cell.ts:63](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L63)).
    Check: `new StringCell().getForegroundColor()` still returns `'var(--ts-ui-table-cell-color, inherit)'` (folds through `_defaultOptions` now, not `_options`). Use a concrete subclass — a bare `new Cell()` throws, because `Cell`'s constructor adds a renderer its subclass supplies.

16. **`component/table/cell/Cell.ts`** — add `import { DOM } from "~/core/DOM.js";`. Rewrite `_applyStateTint`'s background handling per the [Internal Structure](#internal-structure) snippet — replace the two `this.setBackgroundColor(...)` calls ([Cell.ts:325](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L325), [Cell.ts:328](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L328)) with the cache-write-plus-conditional-inline-write block. Leave the cursor and shadow branches untouched.
    Check: every `it(...)` in the `'Cell background/cursor/outline state precedence'` describe block of `tests/component/table/cell/Cell.test.ts` still passes unmodified.

17. **`component/table/cell/Header.ts`** — reword the comment at [Header.ts:124-127](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L124-L127) ("StringRenderer's constructor now sets cursor: 'text' unconditionally") to reflect that the value now comes from `StringRenderer`'s class default rather than an imperative constructor call. No code change — `renderer.setCursor("default")` and `renderer.getText().setUserSelect("none")` still correctly override the class defaults via `_options`. Do **not** add a `renderer.getText().setCursor("default")` call: the renderer's `Text` carries `pointer-events: none`, so its cursor is never the one the browser shows.

18. **`component/display/Markdown.ts`** — add a module-level `const _defaultMarkdownOptions: Partial<MarkdownOptions> = { userSelect: "text", cursor: "text" };` above the class ([Markdown.ts:502](packages/lib/src/typescript/lib/component/display/Markdown.ts#L502)). Widen the constructor ([Markdown.ts:585](packages/lib/src/typescript/lib/component/display/Markdown.ts#L585)) to `constructor(markdown?: string, options?: MarkdownOptions, subclassDefaults?: Partial<MarkdownOptions>)` and its `super(options)` to `super(options, { ..._defaultMarkdownOptions, ...(subclassDefaults ?? {}) })`. Remove `this.setUserSelect("text");` ([Markdown.ts:607](packages/lib/src/typescript/lib/component/display/Markdown.ts#L607)) and `this.setCursor("text");` ([Markdown.ts:610](packages/lib/src/typescript/lib/component/display/Markdown.ts#L610)); move the two explanatory comments above them ([Markdown.ts:602-609](packages/lib/src/typescript/lib/component/display/Markdown.ts#L602-L609)) onto the new defaults bag, keeping their reasoning (rendered prose is read-only content the reader copies; the children are raw DOM nodes with no `user-select`/`cursor` of their own, so they inherit the root's) and noting that the value now lands on the shared `.Markdown` rule.
    Check: `tests/component/display/Markdown.test.ts`'s `'opts the root into user-select: text so rendered prose can be selected'` still passes unmodified.

19. **`component/editor/MarkdownEditor.ts`** — add a module-level `const _defaultWysiwygSurfaceOptions: Partial<ComponentOptions> = { userSelect: "text", cursor: "text" };` above `class WysiwygSurface` ([MarkdownEditor.ts:140](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L140)). Change `super();` in its constructor ([MarkdownEditor.ts:154](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L154)) to `super(undefined, _defaultWysiwygSurfaceOptions);` — no new constructor parameter (see [Architecture Decisions](#architecture-decisions)). Remove `this.setCursor("text");` ([MarkdownEditor.ts:173](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L173)) and `this.setUserSelect("text");` ([MarkdownEditor.ts:180](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L180)); move their comments onto the defaults bag, preserving both reasons (a text caret over the whole surface signals editability; stating `user-select: text` in the framework's own rule means select-and-copy doesn't depend on Lexical's inline write surviving a re-render). `ComponentOptions` is already imported at [MarkdownEditor.ts:3](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3). Leave `setOverflow`, `setPadding`, `setContentEditable` and the `lineHeight` rule alone.

20. **`tests/component/default-options-fallback.test.ts`** — add six rows to the `DEFAULT_RESOLUTION` array ([line 261](packages/lib/tests/component/default-options-fallback.test.ts#L261)), with the matching imports (`Link` is already imported at [line 23](packages/lib/tests/component/default-options-fallback.test.ts#L23)). ARCHITECTURE.md requires a registry row for every class that defaults a field; rows are added here only where no dedicated test already asserts the same folded getter (the exceptions are named in [Expected Behaviour](#expected-behaviour)) — `Link` is not one of the exceptions, because its three existing rows (`tag`, `foregroundColor`, `cursor`) already establish that this class's defaults are registered regardless of `tests/component/input/Link.test.ts`'s own coverage, and the new field follows that precedent.

    | `label` | `resolve` | `expected` |
    |---|---|---|
    | `'StringCell foregroundColor'` | `() => new StringCell().getForegroundColor()` | `'var(--ts-ui-table-cell-color, inherit)'` |
    | `'SelectableText userSelect'` | `() => new SelectableText().getUserSelect()` | `'text'` |
    | `'SelectableText cursor'` | `() => new SelectableText().getCursor()` | `'text'` |
    | `'MarkdownEditor surface userSelect'` | `() => (new MarkdownEditor() as any)._wysiwyg.getUserSelect()` | `'text'` |
    | `'MarkdownEditor surface cursor'` | `() => (new MarkdownEditor() as any)._wysiwyg.getCursor()` | `'text'` |
    | `'Link userSelect'` | `() => new Link().getUserSelect()` | `'text'` |

    All six construct cleanly under the global harness (`tests/setup/node-setup.ts`). Do not add an `installTestDOM` `beforeEach` to this file — it deliberately has none.

21. **`tests/core/ClassStyleRules.test.ts`** — see [Expected Behaviour](#expected-behaviour) for the exact cases to add and change.

22. **`tests/component/table/CellTextSelection.test.ts`** — add the rule-tier regression tests for the renderers and for `SelectableText` (see [Expected Behaviour](#expected-behaviour)).

23. **`tests/overlay/Notification.test.ts`** — add the notification message-text selectability test (see [Expected Behaviour](#expected-behaviour)), mirroring `tests/overlay/Dialog.test.ts:131-138`.

24. **`tests/component/table/cell/Cell.test.ts`** — add the inline-vs-rule regression test for `_applyStateTint` (see [Expected Behaviour](#expected-behaviour)).

25. **Documentation** — apply the edits in [Documentation Impact](#documentation-impact).

26. Run the full verification pass (see [Verification](#verification)).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/input/SelectableText.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Link.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` (comment only) |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/core/ClassStyleRules.test.ts` |
| Modify | `packages/lib/tests/component/table/CellTextSelection.test.ts` |
| Modify | `packages/lib/tests/overlay/Notification.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/Cell.test.ts` |
| Modify | `packages/lib/docs/components/index.md` |
| Modify | `packages/lib/docs/components/Text.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### `border`

- A component with no border (the default) writes **no** `border` declaration to its `#id` rule. Unit-testable: in `tests/core/ClassStyleRules.test.ts` case 16, change `expect(declarations.border).toBeNull();` to `expect(declarations.border).toBeUndefined();` (the write is now skipped entirely, not written-as-null) **and delete `expect(HOISTED_KEYS).not.toContain('border');`** — `border` is a hoisted key now, so that assertion would fail. Keep the `backgroundColor` assertions.
- Add `'border'` to the file's `HOISTED_KEYS` array (update its docstring from "fourteen" to "fifteen"). This automatically extends case 1 (`'a default-valued declaration lands on no per-component rule'`) and case 15 (`'two classes with the same name — the second opts out of both tiers'`) to cover `border` — no new `it(...)` needed for those.
- A component **with** a real border (e.g. `new Button({...})`, which sets a default border) still renders it correctly — unit-testable via any existing test that asserts a bordered component's rendered CSS; this path (`queueMany(borderToStyle(...))`) is untouched by this plan.

### `userSelect` / `cursor` on cell renderers

- `StringRenderer`, `NumberRenderer`, `DateRenderer`, `DateTimeRenderer`, `TimeRenderer`, `ComboRenderer`, `LinkCellRenderer`: `getUserSelect()` returns `"text"` and `getCursor()` returns `"text"` on every instance, sourced from the class default rather than an instance write. Already covered by `tests/component/table/CellTextSelection.test.ts` (must pass unmodified) — this is also why no `DEFAULT_RESOLUTION` rows are added for these seven classes.
- `HeaderCell`, `ParentHeaderCell`, `GroupSeparatorCell` (which wrap `StringRenderer` via `DefaultCell`) still override back to `"none"`/`"default"` on their renderer, and to `"none"` on that renderer's `Text` — their explicit `setUserSelect` / `setCursor` calls write into `_options`, which always wins over the class default in the folding getters. Already covered by the same test file (`'header, parent-header and group-separator cells opt back out'`).
- A plain `Text` used elsewhere (`Button` label, `MenuItem` title, `TabButton` label) still defaults to `userSelect: "none"`. Already covered (`'interactive chrome keeps its unselectable default'`).
- New unit test in `tests/component/table/CellTextSelection.test.ts`: render one `StringRenderer`, then render a second one and record the sink's `setRuleStyles` ops for the second renderer's own `#id` selector — neither `userSelect` nor `cursor` appears among the written keys. Copy the two small helpers (`idSelector`, and a `setRuleStyles`-filtering `declarationsDuring`) from `tests/core/ClassStyleRules.test.ts:60-90`, and follow cases 1 and 4's shape of rendering one instance before the measured one, so the `.StringRenderer` rule's own creation sits outside the measured window. This must fail against current code (every instance currently writes both keys onto `#id`) and pass after steps 6-12.

### `SelectableText`

- `new SelectableText().getUserSelect()` returns `"text"` and `new SelectableText().getCursor()` returns `"text"`, both folded from `_defaultOptions` — `(instance as any)._options.userSelect` and `._options.cursor` stay `undefined`. Unit-testable; covered by the two new `DEFAULT_RESOLUTION` rows.
- `new SelectableText("x") instanceof Text` is `true`, so `CellRenderer.doLayout`'s single-`Text`-child line-height centring still applies to every converted renderer. Unit-testable.
- An instance override still wins: `new SelectableText("x", { userSelect: "none" }).getUserSelect()` returns `"none"`, and a post-construction `setUserSelect("none")` does too — this is what the three header-cell opt-outs rely on. Unit-testable.
- Rendering a second `SelectableText` writes neither `userSelect` nor `cursor` to its own `#id` rule; a `.SelectableText` class rule carries both. Unit-testable with the same helpers as the renderer case above. It does **not** write *zero* `#id` declarations — `Text.applyStyle` always writes its font block — so assert on the absence of those two keys, never on the absence of the rule.
- `Dialog`'s message text stays selectable: `tests/overlay/Dialog.test.ts:131-138` must pass **unmodified**.
- New unit test in `tests/overlay/Notification.test.ts`: for a notification constructed the way that file already constructs one, `(notification as any)._messageText.getUserSelect()` is `'text'` and `.getCursor()` is `'text'`. Passes before and after — it pins the behaviour the swap must not lose.

### `userSelect` on `Link`

- `new Link().getUserSelect()` returns `"text"`, folded from `_defaultOptions` — `(instance as any)._options.userSelect` stays `undefined`. Unit-testable; covered by the new `DEFAULT_RESOLUTION` row.
- `new Link().getCursor()` still returns `"pointer"` — unrelated to this change, confirms the existing default survives. `tests/component/input/Link.test.ts`'s `'defaults to the link colour and a pointer cursor'` passes unmodified.
- An instance override still wins: `new Link('x', { userSelect: 'none' }).getUserSelect()` returns `'none'`. Unit-testable.
- `LinkCellRenderer`'s child `Link` no longer sets `userSelect` imperatively; `tests/component/table/CellTextSelection.test.ts`'s `'LinkCellRenderer and its Text opt in'` (lines 90-96) still passes unmodified, now reading the value off `Link`'s own class default instead of an instance write.
- `grep -rn 'setUserSelect("text")\|setCursor("text")' packages/lib/src/typescript/lib/` now returns **zero** matches (see [Verification](#verification)).

### `outline` on `Checkbox`

- `new Checkbox().getOutline()` still returns `"none"`.
- New unit tests in `tests/core/ClassStyleRules.test.ts`, mirroring cases 18-19 for `cursor`:
  - A probe class with `outline` set via `subclassDefaults` gets it written to its `.ClassName` rule, not its `#id` rule.
  - A probe class with no `outline` default writes no `outline` key anywhere (it stays conditional, unlike `cursor`).
  - An instance-level `setOutline(...)` override still lands on `#id`.

### `userSelect` as a hoistable key

- New unit tests in `tests/core/ClassStyleRules.test.ts`, mirroring cases 18-22 for `cursor`: a probe class defaulting `userSelect: "text"` gets it on its `.ClassName` rule and not on `#id`; a probe class with no `userSelect` default writes nothing (the framework value covers it); an instance-level `setUserSelect("text")` lands on `#id`; an instance-level `setUserSelect("none")` on a class that defaults `"text"` also lands on `#id`, because it deviates from the class bag.

### `color` on `Cell`

- `new StringCell().getForegroundColor()` still returns `'var(--ts-ui-table-cell-color, inherit)'` (a bare `new Cell()` cannot be constructed — its constructor adds a renderer the subclass supplies).
- Same three-case shape as `outline` above, added to `tests/core/ClassStyleRules.test.ts`, using `foregroundColor` in `subclassDefaults` and asserting the `color` CSS key.
- `ParentHeaderCell` (histogram's original sample) benefits automatically — no `ParentHeader.ts` change needed.

### `Markdown` and `WysiwygSurface`

- `new Markdown('# Hi').getUserSelect()` returns `'text'` and `.getCursor()` returns `'text'` — `tests/component/display/Markdown.test.ts:1657-1661` must pass **unmodified**. This existing test is why no `DEFAULT_RESOLUTION` rows are added for `Markdown`.
- `(new MarkdownEditor() as any)._wysiwyg.getUserSelect()` / `.getCursor()` return `'text'`. Unit-testable; covered by the two new `DEFAULT_RESOLUTION` rows.
- `new Markdown('# Hi', { userSelect: 'none' }).getUserSelect()` returns `'none'` — a caller-supplied option still beats the class default. Unit-testable.
- Manual verification: rendered Markdown prose is still selectable with the mouse and still shows a text cursor, and the WYSIWYG editing surface still shows a caret cursor and supports select-and-copy. The declaration moves from an `#id` rule (plus, for `cursor`, an inline style) to a `.Markdown` / `.WysiwygSurface` rule, which no offline test can distinguish visually.

### `Cell.setBaseBackground` / `_applyStateTint`

All of `tests/component/table/cell/Cell.test.ts`'s `'Cell background/cursor/outline state precedence'` block (lines 92-153) must pass **unmodified** — this is the exact contract the new inline-write design was built to preserve:
- Starts on the base background token, `getBackgroundColor()` reflects it.
- `setRequiredEmpty` toggles the shadow without touching the background.
- `setReadOnly` wins over the background (readonly token) and restores the base token when cleared.
- `setBaseBackground(color)` changes the fallback; `setBaseBackground(null)` restores the theme-default token.

New unit test in `tests/component/table/cell/Cell.test.ts`: render a `Cell`, record the sink's write count, then call `setBaseBackground` (or `setReadOnly`) repeatedly with different values, and assert **zero** `setRuleStyles`/`ensureStyleRule` ops touch the cell's own `#id` selector for the `backgroundColor` key — only `apply` ops with an inline `style.background-color` patch. This must fail against current code (each call currently re-materializes the `#id` rule) and pass after step 16.

### Manual verification (not unit-testable offline)

- Visual: a table with grouped columns still shows the correct group-color band on header cells and body cells, and read-only cells still show the readonly tint, in a real browser.
- Visual: dragging across a body cell's text still selects it; the pointer shows an I-beam over a body cell and an arrow over a header cell.
- Visual: a `Dialog` message and a `Notification` toast message are still selectable and still show an I-beam.
- Visual: a standalone `Link` (the docs app's `MiscPanel` sample, [MiscPanel.ts:1660](packages/lib/src/typescript/MiscPanel.ts#L1660)) can now be selected and copied by dragging across its text; the pointer cursor over it is unchanged — still a pointer, from `Link`'s own `cursor: "pointer"` default, which is independent of `userSelect`.
- Re-run (or approximate) the original profiling scenario (`RECORD_COUNT = 5000` in `packages/lib/src/typescript/RotatedRecordPanel.ts`, `Table.setDisplayMode`) under Chrome DevTools and confirm the `#id`-rule materialization count for the switch drops substantially. Absolute timings are not comparable across sessions (CDP inflates them); compare call counts, not milliseconds.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test` from `packages/lib` — zero new errors.
- `npm run lint` from `packages/lib` — clean against the existing baseline. The `local/forward-super-options` rule is the one this plan could trip: `SelectableText` and `Markdown` both forward their `options` parameter to `super`, and `WysiwygSurface` has no `options`-named parameter, so none of the three reports.
- `npm test` (vitest) from `packages/lib` — full suite green, with particular attention to:
  - `tests/core/ClassStyleRules.test.ts` (all existing cases plus the new ones from step 21).
  - `tests/component/table/CellTextSelection.test.ts` (existing cases unmodified, plus the new rule-tier block).
  - `tests/component/default-options-fallback.test.ts` (six new rows).
  - `tests/component/table/cell/Cell.test.ts` (unmodified precedence block, plus new inline-write test).
  - `tests/overlay/Dialog.test.ts`, `tests/overlay/DialogSeverity.test.ts`, `tests/overlay/DialogCappedScroll.test.ts`, `tests/overlay/DialogWrappingRefit.test.ts`, `tests/overlay/Notification.test.ts`, `tests/overlay/NotificationHistory.test.ts`, `tests/overlay/Notification.styleRuleDisposal.test.ts` (construct the converted message texts).
  - `tests/component/display/Markdown.test.ts`, and every `MarkdownViewer` / `MarkdownMinimap` / `MarkdownEditor` suite.
  - `tests/component/table/cell/CellText.test.ts`, `tests/component/table/cell/DynamicCell.test.ts`, `tests/component/table/cell/renderer.test.ts`, `tests/component/table/cell/TreeCellRenderer.test.ts`, `tests/component/content-box-containment.test.ts`, `tests/component/table/ColumnFilter.test.ts` (all construct one or more of the seven renderer classes).
  - `tests/component/input/Checkbox.test.ts`, `tests/component/input/AbstractBooleanInput.test.ts`, `tests/component/table/cell/BooleanCell.test.ts` (construct `Checkbox`).
  - `tests/component/table/Body.test.ts`, `tests/component/table/HeaderColumnWindow.test.ts`, `tests/component/table/HeaderParentCellMerge.test.ts`, `tests/component/table/Header.disposal.test.ts`, `tests/component/table/HeaderCell.disposal.test.ts`, `tests/component/table/cell/Header.test.ts`, `tests/component/table/RowVisibility.test.ts`, `tests/component/table/ColumnFilterRow.test.ts` (exercise `Cell`/`Row`/`Header` pooling and `getBackgroundColor()`).
  - `tests/component/input/Link.test.ts` (existing cases unmodified — none assert a standalone `Link`'s `userSelect`), `tests/component/table/CustomRenderer.test.ts`, `tests/component/table/ColumnWidths.test.ts` (construct `Link`/`LinkCellRenderer` directly).
- `grep -rn "_userSelect" packages/lib/src/typescript/lib/core/Component.ts` — zero matches (field fully removed).
- `grep -rn 'setUserSelect("text")\|setCursor("text")' packages/lib/src/typescript/lib/` — zero matches remain.
- `grep -rn "new Text(" packages/lib/src/typescript/lib/overlay/Notification.ts` — zero matches. (`Dialog.ts` keeps one, for `DialogTitleBar._titleText`.)
- `npm run docs:api` from `packages/lib` — zero warnings (new public JSDoc on `SelectableText`).
- Manual smoke test: open the docs app's table demo (or `RotatedRecordPanel`), toggle display mode, confirm no visual change to cell/header backgrounds, text-selection cursor, or Checkbox outline; open a `Dialog` and a `Notification` and select their message text; open the Markdown viewer and editor pages and confirm prose selection and the editing caret; open the `MiscPanel` `Link` demo and confirm its text is now selectable while its pointer cursor is unchanged.

---

## Documentation Impact

`SelectableText` is a new exported component and `ComponentOptions` gains a `userSelect` field, so the consumer-facing surface changes.

- **Export surface.** `packages/lib/src/typescript/lib/component/input/index.ts` is already a typedoc entry point ([typedoc.json:11](packages/lib/typedoc.json#L11)), so adding the two lines in step 4 generates `/api/component/input/classes/SelectableText` automatically. `package.json`'s export map already covers the `@jimka/typescript-ui/component/input` subpath — no change.
- **Catalog.** Add one row to the *Display* table in `packages/lib/docs/components/index.md`, immediately after the `Text` row ([index.md:75](packages/lib/docs/components/index.md#L75)), in the same shape as its neighbours: a link to `/api/component/input/classes/SelectableText` in the first column, and "Text the reader can select and copy — an I-beam cursor and selectable content" in the second.
- **Cross-reference.** `packages/lib/docs/components/Text.md`'s second paragraph already routes readers from `Text` to `Label` and `Header`; add `SelectableText` to that sentence as the choice for text the reader is meant to select.
- **No dedicated doc page.** `SelectableText` adds no methods or options of its own, so the generated API page plus the `Text.md` cross-reference cover it. A `docs/components/SelectableText.md` would restate `Text.md`.
- **No `llms.txt` entry.** `packages/lib/llms.txt` has no entry for `Text` either, so adding one only for its subclass would misrepresent the catalog. Leave the file alone.
- **Changelog.** Add to `packages/lib/docs/reference/changelog/next.md` (the unreleased page): one *Added* line for `SelectableText`, one *Added* line for the `ComponentOptions.userSelect` option (construction-time parity with the existing `setUserSelect`), one *Changed* line noting that `user-select`, `outline`, `color` and `border` now resolve through the shared class-rule tier, so a consumer stylesheet targeting a component by class ties on specificity with the generated class rule where the framework's `#id` rule previously always won, and one *Changed* line noting that `Link` text is selectable by default (`userSelect: "text"`) — matching what `LinkCellRenderer` already did per-cell, now true for every `Link` in the app.
- **No `ARCHITECTURE.md` change.** Its *Constructors forward `subclassDefaults`* and *Class-level defaults must survive the getter* sections already describe every pattern this plan uses.

---

## Potential Challenges

- **A future renderer forgetting its selectable child.** If a new renderer copies the String/Number/Date pattern but constructs a plain `Text`, its text would silently be unselectable. Mitigation: `SelectableText` is now the one named thing to reach for, and `CellTextSelection.test.ts` groups every renderer under one assertion shape a new class is expected to join.
- **`LinkCellRenderer` touches two files.** Steps 6-11 each edit one renderer file. Step 12 first edits `component/input/Link.ts` to add `userSelect: "text"` to `_defaultLinkOptions`, then `component/table/cell/renderer/Link.ts` to remove all three imperative lines — the same three-line removal as the other six renderers, now possible because `Link`'s own default covers the child. Mitigation: step 12 states both edits explicitly and in order.
- **A class currently relying on the old always-`null` `_inheritedStyleBag.outline`/`.color`.** Nothing does today (grepped for `setForegroundColor`/`borderRadius` call sites in `component/table/`), but a future class could add a *different* default without realizing it's now hoisted; this is inherent to the mechanism and identical to how `cursor` already behaves.
- **Type-widening ripples.** Widening `ClassStyleBag`/`_inheritedStyleBag` to allow `null` values touches a type used across `ClassStyleRules.ts` and `Component.ts`; `npx tsc --noEmit` in step 1-2's checks catches any missed call site.
- **`WysiwygSurface` is file-private, so its class rule depends on `constructor.name` surviving minification.** That is already true of every class rule in the library, and [`packages/lib/docs/recipes/local-development.md:35`](packages/lib/docs/recipes/local-development.md#L35) documents the requirement; a mangled name simply takes `ensureClassStyleRule`'s existing opt-out branch and falls back to `#id` writes, which is correct, just not cheaper.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — the mechanism this plan extends; read in full before editing.
- [packages/lib/src/typescript/lib/core/Component.ts:4608-4928](packages/lib/src/typescript/lib/core/Component.ts#L4608-L4928) — `writeRuleDeclaration` through `materialiseDeferredRules`, the `applyStyle` phases.
- [packages/lib/src/typescript/lib/core/ComponentDefaults.ts](packages/lib/src/typescript/lib/core/ComponentDefaults.ts) — `resolveClassDefaults`, how `_defaultOptions` is cached per concrete class.
- [packages/lib/src/typescript/lib/component/input/Link.ts:104-149](packages/lib/src/typescript/lib/component/input/Link.ts#L104-L149) — both the precedent `SelectableText` mirrors (a `Text` subclass whose entire body is a class-defaults bag) and, per step 12, a file this plan edits directly: `userSelect: "text"` joins `_defaultLinkOptions`.
- [packages/lib/src/typescript/lib/component/input/Text.ts:15-120](packages/lib/src/typescript/lib/component/input/Text.ts#L15-L120) — `TextOptions`, `_defaultTextOptions`, and the three-parameter constructor `SelectableText` forwards to.
- [packages/lib/src/typescript/lib/component/input/Text.ts:1245-1272](packages/lib/src/typescript/lib/component/input/Text.ts#L1245-L1272) — `applyStyle`'s unconditional font block; why a `Text` always has an `#id` rule.
- [packages/lib/src/typescript/lib/component/input/index.ts](packages/lib/src/typescript/lib/component/input/index.ts) — the barrel `SelectableText` joins.
- [packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts:105-122](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L105-L122) — `doLayout`'s `child instanceof Text` gate, which a `SelectableText` child must keep satisfying.
- [packages/lib/src/typescript/lib/component/table/Row.ts:224-243](packages/lib/src/typescript/lib/component/table/Row.ts#L224-L243) — `updateVisualState`, the precedent for `Cell`'s inline-write fix.
- [packages/lib/src/typescript/lib/component/table/cell/Cell.ts](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) — full file; `_applyStateTint`'s read-only/required-empty precedence must not be disturbed.
- [packages/lib/tests/core/ClassStyleRules.test.ts](packages/lib/tests/core/ClassStyleRules.test.ts) — existing test shapes (`declarationsDuring`, `idSelector`, `ensureStyleRuleOpsFor`, `HOISTED_KEYS`) to extend rather than reinvent.
- [packages/lib/tests/component/table/CellTextSelection.test.ts](packages/lib/tests/component/table/CellTextSelection.test.ts) — the existing regression suite that pins every renderer's `userSelect`/`cursor`, including the override sites.
- [packages/lib/tests/component/default-options-fallback.test.ts:261](packages/lib/tests/component/default-options-fallback.test.ts#L261) — the `DEFAULT_RESOLUTION` registry ARCHITECTURE.md requires a row in.
- [packages/lib/tests/dom/TestDOM.ts:387-475](packages/lib/tests/dom/TestDOM.ts#L387-L475) — `RecordingDOMSink`, `ruleStyleWrites`; what the offline harness can observe about stylesheet-rule materialization.

---

## Non-Goals

- **`minWidth`/`minHeight`/`maxWidth`/`maxHeight` divergence on glyph/icon components** (610 of 6,225 components in the profiled workload). These are genuine per-instance divergences — icons legitimately declare different sizes — not a bug. A smaller possible follow-up, not part of this plan.
- **Hoisting `userSelect`/`cursor` onto `Text` itself.** Proven unsafe: `Text` is used framework-wide with both selectable (cell renderers, dialog and notification messages) and unselectable (`Button`, `MenuItem`, `TabButton`) intent. `SelectableText` is the sanctioned route for the selectable half.
- **Converting `LinkCellRenderer`'s inner text to `SelectableText`.** Its `_text` is a `Link`, not a plain `Text` — it carries the `<a>` tag, the link colour, and `cursor: "pointer"`, all of which a `SelectableText` swap would drop. The underlying gap — `Link` text was never selectable by default — is fixed directly on `Link` instead (see [Architecture Decisions](#architecture-decisions) and step 12), so this is no longer an open problem, only a rejected implementation route.
- **`Checkbox`'s `borderRadius` on `_box`.** `_box` is an anonymous `new Component()`, not a named class; the class-rule cache is keyed on the concrete constructor, so hoisting here would leak Checkbox's border-radius onto every other bare-`Component` instance framework-wide. Fixing this needs a named `_box` subclass — a larger, separate change.
- **`_applyStateTint`'s read-only cursor toggle** (`this.setCursor('default')` / `this.clearCursor()`). Same hot-rebind-path materialization cost as the background branches, but outside this plan's `setBaseBackground` scope; a smaller possible follow-up mirroring this plan's Cell fix.
- **`WysiwygSurface`'s other class-uniform styling** (`overflow: "auto"`, its padding, its `lineHeight` rule). Hoistable by the same argument, but not part of the `userSelect`/`cursor` sweep this plan runs; leaving them keeps the diff readable.
- **Extending the fix to consumer-authored custom `CellRenderer` subclasses.** Nothing in this plan requires or forbids a custom renderer from doing the same thing; it isn't part of the framework's own code, so it's out of scope here.

---

## Notes

[^cursor-already-generic]: `resolveDeclarations` already reads `defaults.cursor ?? "default"` where `defaults` is `Component._defaultOptions` ([ClassStyleRules.ts:93](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L93)), and `Component.getCursor()` already folds `_defaultOptions.cursor` ([Component.ts:2381-2382](packages/lib/src/typescript/lib/core/Component.ts#L2381-L2382)). `userSelect`, by contrast, is currently hardcoded to `"none"` in `resolveDeclarations` ([ClassStyleRules.ts:92](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L92)) and backed by a raw, non-defaulted `_userSelect` field on `Component` ([Component.ts:435](packages/lib/src/typescript/lib/core/Component.ts#L435), [Component.ts:541](packages/lib/src/typescript/lib/core/Component.ts#L541)) — it needs both the `ClassStyleRules.ts` generalization and the `Component.ts` getter/setter conversion to the folding pattern. `outline`/`color` need only the `ClassStyleRules.ts` side; their `Component.ts` getters already fold `_defaultOptions` correctly (`getOutline()` at [Component.ts:2552-2553](packages/lib/src/typescript/lib/core/Component.ts#L2552-L2553), `getForegroundColor()` at [Component.ts:2260-2261](packages/lib/src/typescript/lib/core/Component.ts#L2260-L2261)).

[^border-queueMany]: `applyChromeStyles` ([Component.ts:4804-4809](packages/lib/src/typescript/lib/core/Component.ts#L4804-L4809)): `if (this._border) { this._styleRule.queueMany(borderToStyle(this._border)); } else { this.writeRuleDeclaration("border", null); }`. `this._border` is set unconditionally at construction for any class with a default border (`applyChromeOptions` dispatches `options.border ?? this._defaultOptions.border` through `setBorder` — [Component.ts:679-689](packages/lib/src/typescript/lib/core/Component.ts#L679-L689)), so a class with a real default border never reaches the `writeRuleDeclaration("border", null)` branch at all, and `_inheritedStyleBag.border`'s value is irrelevant to it. Grepping `border:` literals across `component/` confirms many classes (`Button`, `TextInput`, `SpinButton`, `AbstractSelectableList`, `Table`, several table cell editors, …) set a real default border this way — all unaffected by this plan.

[^border-safety]: Grepping the codebase for any mechanism that sets the literal CSS property `border` outside `Component`'s own `_border`/`borderToStyle` path (raw `styleRules` bag entries, `setElementStyle("border", ...)`, `setElementCSSRule("border", ...)`, a global stylesheet) found none. `writeDeclaration` in `DOM.ts` ([DOM.ts:304-316](packages/lib/src/typescript/lib/core/DOM.ts#L304-L316)) treats a `null` value as "remove/never set this property" (`style.removeProperty` / `style[key] = ""`), so `border: null` in `FRAMEWORK_DECLARATIONS` never actually inserts a `border` declaration into the `:where(.ts-ui-component)` rule — it only makes the class-rule comparison bag correctly represent "no border" as `null` instead of `undefined`, matching the literal `null` `writeRuleDeclaration("border", null)` already passes at every call site.

[^seven-renderers]: `StringRenderer` ([String.ts:22-41](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L22-L41)), `NumberRenderer` ([Number.ts:30-43](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L30-L43)), `DateRenderer` ([Date.ts:21-32](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L21-L32)), `DateTimeRenderer` ([DateTime.ts:22-34](packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L22-L34)), `TimeRenderer` ([Time.ts:23-35](packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L23-L35)), `ComboRenderer` ([Combo.ts:34-49](packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L34-L49)), `LinkCellRenderer` ([Link.ts:57-76](packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts#L57-L76)) all have the identical three-line pattern. Only `StringRenderer`/`NumberRenderer`/`DateRenderer` were in the profiling session's sample, but `tests/component/table/CellTextSelection.test.ts` already groups all seven under one assertion shape ("text-bearing cell renderers opt in to user-select: text and cursor: text"), which is direct evidence — not assumption — that the uniformity holds across all seven, not just the three sampled.

[^selectable-precedent]: `Link` is the closest existing solution to the same problem: a `Text` subclass that exists to carry class-uniform styling (`tag: "a"`, `foregroundColor`, `cursor: "pointer"`) in a module-level `_defaultLinkOptions` bag rather than in imperative constructor calls, forwards `subclassDefaults`, and exports through `callable()` plus a barrel line. `Label` ([Label.ts:13-14](packages/lib/src/typescript/lib/component/input/Label.ts#L13-L14)) supplies the second half of the shape: an empty `XOptions extends TextOptions` interface exported alongside the class even when the subclass adds no fields. `SelectableText` copies both and adds nothing else — no new state, no new methods, no new plumbing in `ClassStyleRules.ts` or `ComponentDefaults.ts`.

[^link-not-selectabletext]: This flips every `Link` instance framework-wide to `userSelect: "text"`, not just `LinkCellRenderer`'s. Verified safe: no test in `tests/component/input/Link.test.ts` asserts a standalone `Link`'s `userSelect`, and `tests/component/table/CellTextSelection.test.ts`'s `'LinkCellRenderer and its Text opt in'` case ([CellTextSelection.test.ts:90-96](packages/lib/tests/component/table/CellTextSelection.test.ts#L90-L96)) already asserts `r.getText().getUserSelect()` returns `'text'` and keeps passing unmodified, now reading the value off the class default instead of the removed instance call. `MiscPanel.ts:1660` is the only other `new Link(...)` call site in the library and does not touch `userSelect`. Rejected alternative: leaving `LinkCellRenderer`'s `this._text.setUserSelect("text")` in place, scoped to the table cell only — rejected because it repeats the exact imperative-call problem this plan fixes everywhere else, on the one class that is already built to carry this kind of default.

[^cursor-inert]: All six converted renderers call `this._text.setPointerEvents("none")` ([String.ts:26](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L26), [Number.ts:33](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L33), [Date.ts:25](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L25), [DateTime.ts:27](packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L27), [Time.ts:28](packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L28), [Combo.ts:42](packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L42)), so those elements are never hit-tested and the browser reads the renderer's `cursor` instead — the reason `StringRenderer`'s existing comment gives for setting `cursor` on the renderer and not on the child. Including `cursor: "text"` in `SelectableText`'s defaults therefore changes nothing at those six sites (nor at the three header-cell opt-outs, which override the renderer's cursor and leave the child's alone), while making the three overlay sites — which are hit targets — able to drop their `setCursor("text")` call. Splitting the two properties into separate components was rejected: it would mean two near-identical classes distinguished by a property that is inert wherever the distinction would matter.

[^declared-type]: Each converted field keeps `Text` as its declared type (`private _text: Text = new SelectableText();`, `private readonly _messageText: Text;`). `SelectableText` adds no API, so the wider type loses nothing, and it keeps `StringRenderer.getText(): Text` / `ComboRenderer.getText(): Text` — a public return type — unchanged. It also avoids an import churn asymmetry: `NumberRenderer`, `DateRenderer`, `DateTimeRenderer` and `TimeRenderer` reference `Text` only as that field's type, so narrowing the field would orphan their `Text` import while `StringRenderer` and `ComboRenderer` kept theirs.

[^markdown-inheritance]: Both classes' comments justify the opt-in by inheritance: `Markdown`'s children are raw DOM nodes with no `user-select`/`cursor` of their own, so they inherit the root's, and `WysiwygSurface`'s Lexical-managed content does the same. Moving the declaration from the element's `#id` rule to a `.Markdown` / `.WysiwygSurface` class rule leaves it on the same element, so descendants inherit exactly as before. The framework rule's `user-select: none` does not interfere: it targets `.ts-ui-component` elements, and the raw DOM children are not components.

[^surface-private]: ARCHITECTURE.md's *Constructors forward `subclassDefaults`* rule exists so a subclass can seed defaults without editing its parent. `WysiwygSurface` is declared and used entirely inside `MarkdownEditor.ts` and is not exported, so no subclass can exist outside that file; its constructor also takes a required `onReady` callback rather than an options bag, so the parameter would have no natural position. `Markdown`, which is exported and callable, does get the parameter.

[^text-rule-exists-anyway]: `Text.applyStyle` calls `setElementCSSRules({ fontFamily, textAlign, textShadow, fontKerning, fontSize, fontSizeAdjust, fontStretch, fontStyle, fontVariant, fontWeight, lineHeight, textOverflow })` unconditionally on every render, and several of those resolve to non-empty theme-var strings for every instance. Those writes go straight into the component's own `#id` `StyleRule` rather than through `writeRuleDeclaration`'s class-bag comparison, so a `Text` always materializes its own rule. Hoisting `user-select` (and `cursor`) removes declarations from that rule and, for the three overlay sites, one inline-style write per `setCursor` call — it does not remove the rule. A test asserting zero `ensureStyleRule` ops for a `SelectableText` would therefore fail; assert on the absence of the two keys instead.

[^row-precedent]: `Row.updateVisualState` ([Row.ts:224-243](packages/lib/src/typescript/lib/component/table/Row.ts#L224-L243)): "Going through a cached Component setter (setBackgroundColor) would persist this into `_options` and replay it onto the next record bound to this reused row, so write/remove the inline style directly instead." `Row` has no getter reading this state back, so it can skip `_options` entirely; `Cell.getBackgroundColor()` cannot.

[^element-guard]: `Header.reconcileColumnCells` builds a fresh cell with `cell = new HeaderCell(...); row.addComponent(cell, ...);` in Pass 2 ([Header.ts:769-782](packages/lib/src/typescript/lib/component/table/Header.ts#L769-L782)) before Pass 3 calls `cell.setBaseBackground(...)` ([Header.ts:809](packages/lib/src/typescript/lib/component/table/Header.ts#L809)). `Row.setColumnWindow` follows the identical shape ([Row.ts:437-462](packages/lib/src/typescript/lib/component/table/Row.ts#L437-L462)). `Component.insertComponent` (called by `addComponent`) appends the child's element at the matching DOM position once its parent already has one; both the header's column row and a body `Row` are already mounted before their column-window reconciler runs, so the newly-built cell has a live element by the time `setBaseBackground` reads it.

---

## Implementation Notes

### `Cell` and `WysiwygSurface` both gained a `subclassDefaults` parameter

**What the plan called for.** Step 15 specified `Cell`'s constructor call
verbatim as `super({ tag: tag || "td" }, _defaultCellOptions);`, and step 19
specified `WysiwygSurface`'s as `super(undefined, _defaultWysiwygSurfaceOptions);`
— "no new constructor parameter", argued in
[Architecture Decisions](#architecture-decisions) and footnote `[^surface-private]`
on the grounds that `WysiwygSurface` is file-private, takes no options bag, and
cannot be subclassed from outside `MarkdownEditor.ts`.

**What was done instead.** Both constructors now accept a trailing optional
`subclassDefaults?: Partial<ComponentOptions>` and layer it over the class bag in
the established way:

```typescript
super({ tag: tag || "td" }, { ..._defaultCellOptions,            ...(subclassDefaults ?? {}) });
super(undefined,            { ..._defaultWysiwygSurfaceOptions,  ...(subclassDefaults ?? {}) });
```

**Why.** Both forms the plan specified are rejected by the
`local/require-subclass-defaults` ESLint rule
([packages/lib/scripts/eslint/require-subclass-defaults.js](packages/lib/scripts/eslint/require-subclass-defaults.js)),
which runs at `"error"` severity with no baseline file — so the plan's own
[Verification](#verification) step (`npm run lint` clean) could not pass as
written. The rule reports any `super()` call whose second-or-later argument names
a `_default<Name>Options` constant without also forwarding a constructor
parameter. Its only exemption is `params.length === 0` (a fixed-configuration
leaf with no parameter to plumb); `Cell` takes five parameters and
`WysiwygSurface` takes `onReady`, so neither qualifies. The rule has no exemption
for a file-private or non-exported class — it reads the AST shape, not the
export surface — so the plan's `[^surface-private]` reasoning, though sound as
design rationale, does not reach the mechanically-enforced repo rule.

Rather than weaken the rule or add the project's first `require-subclass-defaults`
baseline entry for a change that introduced the violation, both sites adopt the
same pattern this branch already applies correctly to `SelectableText`, `Link`,
`Markdown`, and the seven cell renderers. The cost is one optional parameter each,
which ARCHITECTURE.md's *Constructors forward `subclassDefaults`* explicitly says
to add "even when no subclass exists yet, [because] it cannot be added later
without touching every subclass". Neither parameter is part of the consumer-facing
surface: `WysiwygSurface` is not exported, and `Cell`'s is trailing and optional,
so every existing call site is unchanged.

### `ComponentDefaults.ts`'s `BASE_DEFAULTS` gained a `userSelect` field

**What the plan called for.** Step 2 described `getUserSelect`/`setUserSelect`/
`clearUserSelect` as mirroring `getCursor`/`setCursor`/`clearCursor` "exactly",
but named no base-level default value for `userSelect` — `cursor`'s own base
default (`"default"`) already lived in `ComponentDefaults.ts`'s `BASE_DEFAULTS`
bag before this plan, seeded by a different, earlier plan.

**What was done instead.** `BASE_DEFAULTS` gained `userSelect: "none"`, alongside
`cursor`, so `getUserSelect()` folds to `"none"` for a stock component exactly as
it did before this plan's refactor away from the constructor-seeded `_userSelect`
field.

**Why.** Before this plan, `Component`'s constructor unconditionally set
`this._userSelect = "none"`, so every instance already had the base default
regardless of `_defaultOptions`. Step 2 replaces that field with the same
folding-getter shape `cursor` already uses (`_options.userSelect ?? _defaultOptions.userSelect ?? null`),
which depends on `_defaultOptions.userSelect` carrying the base value — but
`_defaultOptions` for a plain `Component` resolves from `BASE_DEFAULTS`, and
nothing in the plan's Ordered Steps added `userSelect` there. Implementing step 2
exactly as specified, without this addition, silently regresses `getUserSelect()`
from `"none"` to `null` for every component that never opts into selectable
text — including `GlyphRenderer`, `Button` labels, `MenuItem` titles, and
`TabButton` labels, all of which `tests/component/table/CellTextSelection.test.ts`
already pins at `'none'`. Adding `userSelect: "none"` to `BASE_DEFAULTS` restores
the pre-plan behaviour through the new mechanism instead of through the deleted
field, the same fix shape the plan's own `cursor` precedent already established.
