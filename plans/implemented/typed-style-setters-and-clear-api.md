# Typed Style Setters and `clear*` API — Implementation Plan

## Overview

A code-quality consolidation pass deferred from the [UX polish pass](implemented/ux-polish-pass.md) review. Three coupled cleanups, landing as a single branch (`feature/typed-style-setters-and-clear-api`) because items 1 and 2 share an audit and item 3 lives in the same setter layer they touch:

1. **CR1 — Convert raw `setElementCSSRule` / `setElementAttribute` / `removeElementAttribute` call sites to typed setters.** Roughly 107 call sites under `src/typescript/lib/**` reach for the raw DOM-access methods on `Component`. Each is either already covered by a typed setter (`setOverflow`, `setLineHeight`, …) and should be migrated, or it is a spot-fix worth promoting to a named setter on the relevant `Component` subclass — value cached on the instance, exposed through a public `setX` / `getX` pair with explicit types and JSDoc, and applied through the raw helper internally.
2. **CR2 — Mark the raw element-access methods `protected`.** Once CR1 has emptied every external call site, narrow the visibility of `setElementCSSRule`, `setElementCSSRules`, `setElementAttribute`, `removeElementAttribute`, `setElementStyle`, and `setElementStyles` so consumer code can no longer reach for them. Subclasses keep access when they need raw control to back a new typed setter.
3. **CR9 — `clearProperty()` API to complement `setProperty(null)`.** Each public `setX(value: T | null): this` on `Component` (and subclasses) where `null` is the documented "clear" semantic gains a `clearX(): this` companion. `setX` is then tightened to require a non-null value. Every in-tree call site that passes `null` migrates to `clearX()`. This is the breaking change in this branch.

The three cleanups stay together because CR1 and CR2 share the same audit (the set of files that needed migration in CR1 is the set of files that compile-fail when CR2's `protected` qualifier is dropped on, and reviewing both together prevents a tail of follow-up "I missed one" PRs). CR9 lives in the same setter layer — the new `clearX` companions are mechanical to add next to each migrated `setX` and the same review eye catches both.

---

## Architecture Decisions

### Three CRs, one branch, but four-plus commits

CR1's diff is mostly mechanical but spans every file in `src/typescript/lib`. CR2 is a one-line-per-method visibility flip and is trivial only because CR1 prepared the ground. CR9 is a typed-API change — small in absolute LOC but with a transitive caller-update wave.

The branch lands on `master` cut from current `master`. Inside the branch, commits split along the three-concerns convention (code / docs / graphify) plus per-CR commits where each CR is too large for one diff:

- **Commit 1** — CR1 typed-setter migrations + new setters on `Component` and subclasses (no visibility changes yet, no `clearX` yet).
- **Commit 2** — CR2 visibility flip (`protected` qualifiers on the raw helpers).
- **Commit 3** — CR9 `clearX` introduction, `setX` signature tightening, and in-tree migration. This is the breaking-change commit.
- **Commit 4** — Docs update across `docs/`, recipes, and the changelog (one commit, all three concerns merged into the docs site at once).
- **Commit 5** — Graphify refresh (`graphify update . --directed`).

If CR1's diff alone overflows what's reviewable (the call-site count and subclass touch points make this plausible), split CR1 into two commits along a clean axis — e.g. "Component-only call sites" then "subclass-only call sites". Decide during implementation when the diff is in front of you.

### What "typed setter" means here

A typed setter is the existing pattern Component already uses for `setBackgroundColor`, `setOverflow`, `setLineHeight`, and so on. Concretely, every newly introduced one in CR1 follows the same five-part shape:

1. A private backing field of the right type, defaulted to `null` or the framework default.
2. A public `setX(value: T): this` returning `this` (after CR9, non-nullable for clear-capable setters).
3. A matching `getX(): T | null` returning the cached value without hitting the DOM.
4. JSDoc with one sentence of summary and one `@param` per parameter, ending with `@returns This component, for method chaining.` — same wording as the rest of `Component.ts`.
5. The setter writes the value to the cached field, then forwards to `setElementCSSRule` / `setElementCSSRules` / `setElementAttribute` (now `protected`, so the subclass can still call it).

This shape is non-negotiable; existing setters look like this and the audit benefit only works when new ones do too.

### Subclass-local vs `Component`-promoted typed setters

For each migrated call site, decide whether the setter belongs on `Component` or on the specific subclass:

- **Promote to `Component`** when the property is universally meaningful for any Component (e.g. `overflow-y`, `vertical-align`, `contain`, `userSelect`). The list expands `Component`'s public API once.
- **Keep on the subclass** when the property is component-specific in practice (e.g. `MenuItem`'s `whiteSpace: nowrap` / `overflow: hidden` / `textOverflow: ellipsis` cluster is really an "ellipsis when truncated" choice that only makes sense for the title text inside a menu row; promoting it to `Component` would invite misuse).

The default leans toward promotion to `Component` for any CSS property that already has a registry entry in the existing setter family (`setBackgroundColor`, `setOverflow`, …) and a clear cross-component meaning. The subclass keeps it when the property only makes sense inside the subclass's layout invariants.

Concrete decisions, by raw CSS property:

| Property                                    | Belongs on              | Notes                                                                                                  |
|---------------------------------------------|-------------------------|--------------------------------------------------------------------------------------------------------|
| `contain`                                   | `Component`             | New `setContain(value: string): this`. 8 call sites: `Dialog`, `Notification`, `Menu` ×2, `Window`, `AutoCompleteDropdown`, `Tooltip`, `Accordion`. |
| `overflowX` / `overflowY`                   | `Component`             | New `setOverflowX` / `setOverflowY`. Existing `setOverflow` only sets the shorthand. Dialog uses one per axis. |
| `wordBreak`                                 | `Text`                  | Three call sites are all on `Text` instances inside `Notification` and `Dialog`. Promote to `Text`.    |
| `webkitLineClamp`, `webkitBoxOrient`, `display: -webkit-box` | `Text` (composite) | These three CSS rules only make sense as a group ("clamp this text to N lines with an ellipsis"). New `Text#setLineClamp(lines: number | null): this` writes all three (and `overflow: hidden` + `text-overflow: ellipsis`). One call site today (`Notification`) becomes one method call. |
| `whiteSpace` (no-op duplication with `Text#setWhiteSpace`) | `Text` | `Text` already has a `setWhiteSpace`. The 8 raw call sites are spread across `Tooltip`, `AutoCompleteItem`, `MenuItem`, `MenuBarButton`, `Notification`, `Dialog`. Migrate. |
| `textOverflow`                              | `Text`                  | `Text` already has `setTextOverflow`. 4 raw call sites; migrate.                                       |
| `textAlign`                                 | `Text`                  | `Text` already has `setTextAlign`. 5 raw call sites (incl. `Glyph`, `TextInput`, `MenuItem`); migrate. |
| `lineHeight`                                | `Text`                  | `Text` already has `setLineHeight` (and `centerInHeight`). 5 raw call sites; migrate.                  |
| `fontSize`, `fontWeight`, `fontVariant`, `fontStyle`, `fontStretch`, `fontKerning`, `fontFamily`, `fontSizeAdjust` | `Text` | `Text` already has all of these. The single non-Text call sites (`MenuItem`, `MenuBarButton`) set `font-size` on the row itself for CSS-cascade reasons. Add `setFontSize(value: string): this` to `Component` (`Text#setFontSize` is the typed-number version; the row-level one takes a CSS expression). |
| `overflow`                                  | `Component`             | `Component#setOverflow` already exists. The remaining call sites (`AutoCompleteItem`, `Notification`'s `messageText`) actually want it on the `Text` inner — `Text` inherits `setOverflow` from `Component`, no new API needed. |
| `userSelect`                                | `Component`             | `Component#setUserSelect` already exists; `MenuBarButton` migrates from raw call.                       |
| `verticalAlign`                             | `Component`             | `Component#setVerticalAlign` already exists; one raw call site inside `Component` itself disappears when we route through it. |
| `position`                                  | `Component`             | `Component#setPosition` already exists; the raw call inside `Component` becomes the typed call.        |
| `visibility`                                | `Component`             | Already wrapped by `setVisible`; no external call sites today.                                          |
| `margin`                                    | Subclass-local          | `MenuItem` and `MenuSeparator` use `"4px 0"` to vertically space separators. This is layout-internal — make it a private constant inside each subclass and keep the raw call there (these are the only two call sites). Marking `setElementCSSRule` protected in CR2 lets them stay. **Do not** add `setMargin` to `Component` — that conflates margin (used by external layout managers) with padding (handled by `setPadding`) in a way the framework doesn't want. |
| `borderTop` (in `MenuSeparator`)            | Subclass-local          | The separator's "top hairline" is internal; keep the raw `setElementCSSRule("borderTop", …)` call, which now lives inside a `protected` helper. |
| `animation`                                 | `Component`             | New `setAnimation(value: string | null): this`. Two callers: `ProgressBar` and `ProgressSpinner`. The third site is `null` to clear, which becomes `clearAnimation()` under CR9. |
| `display` (when `-webkit-box`)              | Folded into `Text#setLineClamp` | Not exposed standalone; the line-clamp helper owns this combination. |
| `disabled` (attribute)                      | `Component`             | New `setDisabled(value: boolean): this` already conceptually exists via `setEnabled` on `Button` and friends. But the raw attribute calls in `Checkbox`, `TimeField`, `DateField`, `NumberSpinner`, `RadioButton` all set the `disabled` attribute directly — promote to `Component#setDisabledAttribute(value: boolean): this` (verbose name on purpose: it sets the HTML attribute, distinct from `setEnabled` which carries semantic + aria + visual state). Then each input's existing `setEnabled` calls `setDisabledAttribute` internally. Audit during implementation to confirm no subclass already does something fancier. |
| `placeholder`, `readonly`, `maxlength`, `rows`, `cols`, `wrap`, `name`, `min`, `max`, `step`, `value`, `selected`, `type` (attributes) | Subclass (each is HTML-input-specific) | `TextInput`, `TextArea`, `Slider`, `Option`, `RadioButton`, `AutoCompleteField`. Each gets its own typed setter — most already do (e.g. `Slider#setMin`); the `applyOptions` sites currently bypass them and call raw `setElementAttribute` instead, which is the bug CR1 fixes. |
| `aria-*` attributes                         | Stay on `Aria` helper   | `Aria` (in `src/typescript/lib/core/Aria.ts`) is a sibling helper, not a `Component` subclass — it holds a reference to a Component and writes to it via `setElementAttribute`. The visibility flip in CR2 would lock it out. **Solution:** add `public applyAriaAttribute(name: string, value: string | null)` on `Component`, marked `@internal` in JSDoc. (TypeScript-`protected` would not let `Aria` — a sibling class — call it; `@internal` is the documented convention.) Refactor `Aria` to call it. |
| `list-style-type` (in `AbstractListComponent`) | Subclass-local      | New finding: `src/typescript/lib/component/list/AbstractListComponent.ts:75` uses raw `setElementCSSRule("list-style-type", style)`. It's intrinsic to `<ul>`/`<ol>` semantics. Keep the raw call internally (CR2's `protected` flip still permits it because `AbstractListComponent` extends `Component`). Do not promote to a top-level `Component#setListStyleType`. |

### Sampling — not enumerating — the 107 sites

The plan does not list each of the ~107 raw call sites. Instead the section above enumerates the call sites by CSS property and binds each to a typed setter (existing or new). The migration is then mechanical at the file level — grep for the raw call inside each file, apply the typed setter listed in the table. The verification step grep at the end catches any miss.

### Audit findings vs original plan

After surveying the codebase against the plan's enumerated decisions, the following adjustments apply:

- **`Aria` helper**: `Aria.ts` is a sibling class (not a subclass of `Component`), so a `protected` qualifier on `applyAriaAttribute` would not allow `Aria.ts` to call it. The plan resolves this by adding `applyAriaAttribute` as `public` with an `@internal` JSDoc tag (so it stays out of the public docs and is documented as not-for-consumer-use), while still routing all `Aria` writes through it.
- **`AbstractListComponent.ts:75`**: previously unenumerated raw `setElementCSSRule("list-style-type", style)` call. Treated as subclass-local (kept raw inside the file; protected access after CR2 still permits it).
- **`Text.ts` ~14 raw `setElementCSSRule` calls**: all live inside `Text`'s own typed setters (e.g. `setFontSize`, `setFontFamily`, `setLineHeight`, etc.). These are not external migrations under CR1 — they're already the typed wrappers the plan wants. They continue to work after CR2 because `Text extends Component`.
- **`setGlyph` family**: `Dialog#setGlyph` and `MenuBarButton#setGlyph` also take `name: string | null` and need the same CR9 treatment as `Button#setGlyph` and `WindowHeader#setGlyph`. (`IconText#setGlyph` and `IconLabel#setGlyph` already accept `string` only.)
- **`RadioButton.ts:177`**: `this.radio.setElementAttribute("type", "radio")` is one-time init. Wrap it via the new `RadioButton#setType` (private use) or keep raw inside the file (subclass-local, still allowed after CR2).

### CR2 visibility audit

The full set of currently-public methods in the raw element-access family on `Component`:

| Method                       | New visibility | Rationale                                                                                          |
|------------------------------|----------------|----------------------------------------------------------------------------------------------------|
| `getElement(createIfMissing?)` | **stays public** | Subclasses, sibling helpers (`Aria`, `Tooltip`), and layout managers (`Accordion`, `Tab`, `Split`) all need to read the rendered element. Heavily used; making it protected breaks the framework's own collaborators. |
| `removeElement()`            | **stays public** | Same reasoning — `Tooltip`, `Menu`, `Notification`, `DialogBackdrop`, `ProgressSpinner` all call it from non-self code paths. |
| `getElementAttribute(key)`   | stays public   | Read-side. No risk of consumer misuse; useful for tests.                                            |
| `setElementAttribute(key, value)` | **protected** | Wrapped by CR1's typed setters. `Aria` is the only legit external caller; address via `applyAriaAttribute` helper (see above). |
| `removeElementAttribute(key)` | **protected** | Same as `setElementAttribute`.                                                                     |
| `setElementStyle(key, value)` | **protected** | Migrate the few external call sites first (Component-internal uses are unaffected by the visibility flip). |
| `setElementStyles(values)`   | **protected** | Same.                                                                                              |
| `commitElementStyle()`       | **protected** | Only `Component` internals and subclasses need to force-flush after a `setAutoCommitStyle(false)` block. |
| `setElementCSSRule(key, value)` | **protected** | The big one. Wrapped by CR1's typed setters.                                                       |
| `setElementCSSRules(values)` | **protected** | Used internally by `Text#applyStyle`; subclass call. Wrap externally if there's a use case (there isn't today). |
| `commitCSSRule()`            | **protected** | Same rationale as `commitElementStyle`.                                                            |
| `setAutoCommitStyle(value)`  | stays public   | Documented batching API; legitimately called by perf-sensitive consumer code (`TreeRow.setRowData` uses `setAutoCommitStyle(false)` to bulk-update). |
| `getAutoCommitStyle()`       | stays public   | Read-side counterpart.                                                                              |
| `setAttribute(key, value)` / `delAttribute(key)` / `getAttribute(key)` | stays public | These are the component-level attribute helpers that maintain the internal `attributes` Map AND mirror to the DOM via `setElementAttribute`. They are the typed-ish wrapper around `setElementAttribute` that consumers already use — they are not in the family that needs locking down. |

In summary: the `setElement* / removeElement*` family becomes `protected`, except `getElement` / `getElementAttribute` (read-side, used externally) and `removeElement` (destructor; called by peer instances). `commit*` helpers become `protected`. The `setAutoCommitStyle` opt-out stays public because some performance-tuned consumers need it.

### CR9 naming convention

The `clearX` companions map straightforwardly for most setters; a handful need a naming call:

| `setX(null)` today                   | `clearX()` introduced                | Notes                                                                                  |
|--------------------------------------|--------------------------------------|----------------------------------------------------------------------------------------|
| `setBackgroundColor(null)`           | `clearBackgroundColor()`             | Obvious.                                                                               |
| `setBackgroundImage(null)`           | `clearBackgroundImage()`             | Obvious. Note `setBackgroundImage` defaults `value` to `null` today (parameter default) — keep the default until CR9 lands, then drop it. |
| `setForegroundColor(null)`           | `clearForegroundColor()`             | Obvious.                                                                               |
| `setBorderRadius(null)`              | `clearBorderRadius()`                | Obvious. `setBorderRadius(borderRadius: string | null = null)` had a default; drop after migration. |
| `setShadow(null)`                    | `clearShadow()`                      | `setShadow(null)` currently writes `'none'` (not removeProperty); preserve that exact behaviour in `clearShadow`. |
| `setOutline(null)`                   | `clearOutline()`                     | Obvious.                                                                               |
| `setAppearance(null)`                | `clearAppearance()`                  | Obvious. Today it removes both `-webkit-appearance` and `appearance`; the clear-companion keeps the dual removal. |
| `setBorderImage(null)`               | `clearBorderImage()`                 | Obvious.                                                                               |
| `setTransform(null)`                 | `clearTransform()`                   | Obvious.                                                                               |
| `setOpacity(null)`                   | `clearOpacity()`                     | Obvious.                                                                               |
| `setInsets(null)`                    | `clearInsets()`                      | Today `setInsets(null)` resets to `new Insets(0,0,0,0)` (not strictly a "clear" — a reset). The companion is `clearInsets()` and the implementation keeps the same reset-to-zero semantic, documented explicitly so the breaking-change is by-name not by-behaviour. |
| `setPadding(null)`                   | `clearPadding()`                     | Similarly a reset-to-zero (`"0px 0px 0px 0px"`). Same documentation note as `clearInsets`. |
| `setBorder()` / `setBorder(undefined)` | `clearBorder()` (new) | `setBorder` today takes optional `BorderOptions | string`. Passing nothing applies `new Border(undefined)` — which currently is the implicit "default border". This is not a `null` site, so CR9 leaves `setBorder` alone signature-wise. **But** the 4 call sites that call `setBorder()` with no arguments are doing it because their parent set a border and they want to clear it; the new convention is `clearBorder()`. Implement `clearBorder()` to write `removeProperty("border")`. The behaviour change: today `setBorder()` paints a Border object onto the CSS rule; after CR9 it still does, and `clearBorder()` is the new "no border" call. Audit the 4 call sites to confirm none of them depend on the old "default border" rendering. |
| `setPressedBackgroundColor(null)`    | `clearPressedBackgroundColor()`      | On `Button`.                                                                           |
| `setPressedBackgroundImage(null)`    | `clearPressedBackgroundImage()`      | On `Button`. Drop the `= null` default in the same commit.                              |
| `setPressedForegroundColor(null)`    | `clearPressedForegroundColor()`      | On `Button`.                                                                           |
| `setPressedBorderRadius(null)`       | `clearPressedBorderRadius()`         | On `Button`. Drop the `= null` default.                                                |
| `setPressedShadow(null)`             | `clearPressedShadow()`               | On `Button`.                                                                           |
| `setGlyph(null)`                     | `clearGlyph()`                       | On `Button`, `WindowHeader`, `Dialog`, and `MenuBarButton` (audit confirmed these four take `name: string \| null`). All gain `clearGlyph()`. (`IconText#setGlyph` and `IconLabel#setGlyph` already accept `string` only; no change needed there.) |
| `setSortState(null)`                 | `clearSortState()`                   | On `HeaderCell`. The two-arg form `setSortState(state, priority?)` becomes `setSortState(state: 'asc' | 'desc', priority?)` after CR9. `clearSortState()` takes no args and clears both. |

Two interesting cases that **do not** get a `clearX` companion:

- **`setValue(null)`** on data-bearing fields (`TimeField`, `DateField`, …) is a data-state setter, not a style setter. `null` is a legitimate "no value selected" state, not a "clear my styling". Out of scope for CR9 — these stay `setValue(value: T | null)`.
- **`setVerticalAlign`, `setOverflow`, `setUserSelect`, `setPointerEvents`** are non-nullable today. No change needed; CR9 only touches setters whose current signature is `T | null`.

### Why this is a breaking change

Consumer code that writes `button.setBackgroundColor(null)` today will:

- After CR1 alone: still compile and work. The signature is `string | null` and `null` still means "clear".
- After CR9: fail to typecheck. The new signature is `string`, and the typecheck error directs the user to `clearBackgroundColor()`.

The `_setX = null` → "clear" idiom is widespread in CSS / JS APIs. Downstream code probably uses it. The plan explicitly accepts that this is breaking, calls it out in the changelog, and documents the migration as a one-line search-and-replace per call site (`setX(null)` → `clearX()`). No deprecation period — the project is small enough and pre-1.0 enough that the explicit `clearX` call is worth the churn.

### Should CR9 land separately?

A real risk: CR1 + CR2 are mostly mechanical and review well; CR9 introduces a typed-API change that requires reviewers to think about each `setX(null)` migration. If CR1's diff already exceeds the comfortable review size, split CR9 into a follow-up branch. Decide when the CR1 diff is ready for review.

If CR9 is split out, name the follow-up `feature/clear-property-api` and order it after this branch merges. The CR1+CR2 branch then changes nothing about the `null` semantic — `setX(null)` continues to work — and CR9 is delivered alone with no other code-shape churn.

The plan assumes the single-branch path; the verification matrix below treats CR9 as part of the branch.

---

## Public API (TypeScript Signatures)

### `Component` — new setters (CR1) and clear companions (CR9)

```typescript
class Component extends BaseObject {

    // -------- CR1: new typed setters (non-exhaustive — see decision table) --------

    /**
     * Sets the CSS `contain` property on the component's CSS rule. Hints the
     * rendering engine that descendants are isolated from external layout/paint.
     *
     * @param value - A CSS `contain` value (e.g. `"layout"`, `"strict"`, `"layout paint"`).
     *
     * @returns This component, for method chaining.
     */
    setContain(value: string): this;

    /** Returns the current `contain` value, or null if not set. */
    getContain(): string | null;

    /** Sets the CSS `overflow-x` property. */
    setOverflowX(value: string): this;
    getOverflowX(): string | null;

    /** Sets the CSS `overflow-y` property. */
    setOverflowY(value: string): this;
    getOverflowY(): string | null;

    /** Sets the CSS `animation` shorthand. Pass null via clearAnimation(). */
    setAnimation(value: string): this;
    getAnimation(): string | null;
    /** Removes the CSS `animation` property. */
    clearAnimation(): this;

    /**
     * Sets the HTML `disabled` attribute on the underlying element.
     * Distinct from setEnabled, which carries semantic + ARIA + visual state.
     */
    setDisabledAttribute(value: boolean): this;
    getDisabledAttribute(): boolean;

    // -------- CR9: clear companions for existing nullable setters --------

    clearBackgroundColor(): this;
    clearBackgroundImage(): this;
    clearForegroundColor(): this;
    clearBorderRadius(): this;
    clearShadow(): this;                // writes "none", matching legacy setShadow(null)
    clearOutline(): this;
    clearAppearance(): this;
    clearBorderImage(): this;
    clearTransform(): this;
    clearOpacity(): this;
    clearInsets(): this;                // resets to new Insets(0,0,0,0)
    clearPadding(): this;                // resets to "0px 0px 0px 0px"
    clearBorder(): this;                 // writes removeProperty("border")

    // -------- CR9: tightened set* signatures (formerly T | null) --------

    setBackgroundColor(backgroundColor: string): this;
    setBackgroundImage(backgroundImage: string): this;
    setForegroundColor(foregroundColor: string): this;
    setBorderRadius(borderRadius: string): this;
    setShadow(shadow: string): this;
    setOutline(outline: string): this;
    setAppearance(value: string): this;
    setBorderImage(value: string): this;
    setTransform(value: string): this;
    setOpacity(value: number): this;
    setInsets(insets: Insets): this;
    setPadding(padding: Insets): this;
    // setBorder unchanged (its signature is already non-null-bearing).

    // -------- CR2: visibility narrowing (declared, not added) --------

    protected setElementCSSRule(key: string, value: Object | null): this;
    protected setElementCSSRules(values: Style): this;
    protected setElementAttribute(key: string, value: Object | null | undefined): this;
    protected removeElementAttribute(key: string): this;
    protected setElementStyle(key: string, value: Object | null): this;
    protected setElementStyles(values: Style): this;
    protected commitElementStyle(): this;
    protected commitCSSRule(): this;
    protected applyAriaAttribute(name: string, value: string | null): this;   // new in CR1, called by Aria
}
```

### `Text` — `wordBreak`, `lineClamp`, and new clear companions

```typescript
class Text extends Component {
    /** Sets the CSS `word-break` property. */
    setWordBreak(value: string): this;
    getWordBreak(): string | null;

    /**
     * Clamps the rendered text to a maximum line count via CSS line-clamp.
     * Writes `display: -webkit-box`, `-webkit-box-orient: vertical`,
     * `-webkit-line-clamp: <n>`, `overflow: hidden`, `text-overflow: ellipsis`
     * in one call. Pass via clearLineClamp() to remove the clamp.
     */
    setLineClamp(lines: number): this;
    getLineClamp(): number | null;
    clearLineClamp(): this;

    /**
     * Allows a CSS expression for font-size in addition to the existing
     * number-or-CSS-var setFontSize signature. Used by row-level (MenuItem,
     * MenuBarButton) sites that today set `fontSize` raw on the row element
     * for CSS-cascade reasons.
     */
    // Note: setFontSize unchanged — it already accepts number | string.
    // The new behaviour lives in Component (see above) for row-level use.
}
```

### `Button` — clear companions for pressed setters and glyph slot

```typescript
class Button extends Component {
    // CR9: clear companions
    clearPressedBackgroundColor(): this;
    clearPressedBackgroundImage(): this;
    clearPressedForegroundColor(): this;
    clearPressedBorderRadius(): this;
    clearPressedShadow(): this;
    clearGlyph(): this;

    // CR9: tightened signatures (formerly T | null)
    setPressedBackgroundColor(backgroundColor: string): this;
    setPressedBackgroundImage(backgroundImage: string): this;
    setPressedForegroundColor(foregroundColor: string): this;
    setPressedBorderRadius(borderRadius: string): this;
    setPressedShadow(shadow: string): this;
    setGlyph(name: string): this;
}
```

### `WindowHeader`, `HeaderCell`

```typescript
class WindowHeader extends Header {
    // CR9
    clearGlyph(): this;
    setGlyph(name: string): this;
}

class HeaderCell extends Cell {
    // CR9
    clearSortState(): this;
    setSortState(state: 'asc' | 'desc', priority?: number | null): this;
    //                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^
    //   The `priority` parameter keeps its `null` semantic (no badge);
    //   only the `state` parameter loses its `null` form.
}
```

### `Aria` — refactor to use the new `protected` helper

Internal-only refactor. `Aria` is constructed via `Component#getAria()` and lives in the same trust boundary as `Component`. Add:

```typescript
class Component {
    /**
     * Applies an ARIA attribute on this component's element. Used by the Aria
     * helper. Not part of the public consumer API — callers should use
     * `getAria()` to access the typed Aria interface instead.
     *
     * @internal
     */
    protected applyAriaAttribute(name: string, value: string | null): this {
        if (value === null) {
            return this.removeElementAttribute(name);
        }
        return this.setElementAttribute(name, value);
    }
}

class Aria {
    setRole(role: AriaRole): this {
        // was: this.component.setElementAttribute("role", role);
        this.component.applyAriaAttribute("role", role);   // NB: same trust boundary
        return this;
    }
    // …same pattern for the other ~30 aria-* setters.
}
```

**Implementation caveat**: `Aria` lives in `~/core/Aria.ts`, not in `~/core/Component.ts`, so the `protected` qualifier on `applyAriaAttribute` does not technically permit `Aria` to call it. The plan resolves this by either (a) making `applyAriaAttribute` package-private via a `@internal` JSDoc tag while keeping it `public` in TypeScript (the JSDoc tag is enforced by `npm run docs:build` and surfaces to consumers as "don't call this") or (b) declaring `Aria` as a `friend` via the documented framework convention — there isn't one today, so go with (a). Pick (a) during implementation.

---

## Theme Tokens

No new theme tokens.

---

## Internal Structure

### Pattern for adding a new typed setter on `Component`

```typescript
// before, somewhere in a subclass:
this.setElementCSSRule("contain", "strict");

// after, in Component.ts:
private contain: string | null = null;

getContain(): string | null {
    return this.contain;
}

setContain(value: string): this {
    if (this.contain === value) {
        return this;
    }
    this.contain = value;
    this.setElementCSSRule("contain", value);
    return this;
}

clearContain(): this {
    this.contain = null;
    this.setElementCSSRule("contain", null);
    return this;
}

// and at every call site:
this.setContain("strict");
```

The early-return on identical-value writes mirrors what existing setters do (`setBackgroundColor`, `setCursor`, …) — call sites that fire the setter every frame don't generate redundant CSSOM writes.

### Pattern for tightening a setter signature under CR9

```typescript
// before:
setBackgroundColor(backgroundColor: string | null): this {
    if (this.backgroundColor === backgroundColor) {
        return this;
    }

    this.backgroundColor = backgroundColor;

    if (backgroundColor) {
        this.cssRule.style.setProperty('background-color', backgroundColor);
    } else {
        this.cssRule.style.removeProperty('background-color');
    }

    return this;
}

// after:
setBackgroundColor(backgroundColor: string): this {
    if (this.backgroundColor === backgroundColor) {
        return this;
    }
    this.backgroundColor = backgroundColor;
    this.cssRule.style.setProperty('background-color', backgroundColor);
    return this;
}

clearBackgroundColor(): this {
    if (this.backgroundColor === null) {
        return this;
    }
    this.backgroundColor = null;
    this.cssRule.style.removeProperty('background-color');
    return this;
}
```

The `getBackgroundColor` return type stays `string | null` because the value can still be cleared — the breaking change is on the input side.

---

## Ordered Implementation Steps

Each step compiles and renders. CR1 lands first because CR2 cannot succeed until every external `setElement*` call is removed, and CR9 builds on the now-typed setters.

### Step 1 — Add new typed setters on `Component`

`src/typescript/lib/core/Component.ts`:

- Add `setContain` / `getContain` / `clearContain`.
- Add `setOverflowX` / `getOverflowX`, `setOverflowY` / `getOverflowY`.
- Add `setAnimation` / `getAnimation`.
- Add `setDisabledAttribute` / `getDisabledAttribute`.
- Add `applyAriaAttribute` (protected, `@internal`).

No call site migrations yet — this step exists to make the typed surface available before Step 2 starts swapping call sites.

Verify: `npm run typecheck`. Setter exists.

### Step 2 — Add new typed setters on `Text`

`src/typescript/lib/component/input/Text.ts`:

- Add `setWordBreak` / `getWordBreak`.
- Add `setLineClamp(lines: number) / getLineClamp / clearLineClamp`. The setter writes `display: -webkit-box`, `-webkit-box-orient: vertical`, `-webkit-line-clamp: <n>`, `overflow: hidden`, `text-overflow: ellipsis`. `clearLineClamp` removes all five.

Verify: typecheck, plus a quick scratch render — `new Text("...").setLineClamp(2)` produces the right CSS on the element.

### Step 3 — Migrate `setElementCSSRule` call sites file by file (CR1, part 1: CSS rules)

Order chosen for low blast-radius first; each file is independent so the order is mainly a review convenience:

1. `src/typescript/lib/core/Tooltip.ts` — `contain`, `whiteSpace` → `setContain`, `text.setWhiteSpace`.
2. `src/typescript/lib/component/container/MenuSeparator.ts` — `borderTop`, `margin`. Both stay raw inside the file (subclass-local), but the raw call moves behind a private helper that's clearly scoped to "MenuSeparator-internal". Keeping it raw is fine because the file is already a `Component` subclass and will retain access after CR2.
3. `src/typescript/lib/component/input/AutoCompleteItem.ts` — `lineHeight`, `whiteSpace`, `overflow`, `textOverflow` → `text.setLineHeight`, `text.setWhiteSpace`, `text.setOverflow`, `text.setTextOverflow`.
4. `src/typescript/lib/component/menubar/MenuBar.ts` — `contain` → `setContain`.
5. `src/typescript/lib/core/Dialog.ts` — `contain` → `setContain`; `overflowY`, `overflowX` → `contentContainer.setOverflowY`, `setOverflowX`; `whiteSpace` + `wordBreak` on `messageText` → `text.setWhiteSpace` + `text.setWordBreak`.
6. `src/typescript/lib/layout/Accordion.ts` — `contain` → `setContain`.
7. `src/typescript/lib/component/display/ProgressSpinner.ts` — `animation` → `setAnimation`. The clear-side here is the only call to `setElementCSSRule("animation", null)` (in `ProgressBar.ts:218`) — handled in CR9.
8. `src/typescript/lib/core/Notification.ts` — `contain` → `setContain`; `display`, `webkitBoxOrient`, `webkitLineClamp`, `whiteSpace`, `wordBreak`, `textOverflow` on `messageText` → single `messageText.setLineClamp(2)` call + `text.setWhiteSpace("normal")` + `text.setWordBreak("break-word")`. The composite `setLineClamp` collapses six raw calls into one.
9. `src/typescript/lib/component/display/Glyph.ts` — `lineHeight`, `textAlign` → `setLineHeight`, `setTextAlign`. Glyph extends Component (or Text? — confirm during implementation; either way it inherits the setters).
10. `src/typescript/lib/component/input/TextInput.ts` — `textAlign` → `text.setTextAlign` (TextInput delegates to a Text child).
11. `src/typescript/lib/component/container/MenuItem.ts` — eight raw calls. Subset:
    - `borderTop` and `margin` on the separator branch stay raw (subclass-local; CR2 still lets `MenuItem` use them after the `protected` flip).
    - `fontSize` on the row → `setFontSize("var(--ts-ui-button-font-size, 12px)")` via the new `Component#setFontSize` (the row-level string form). If promoting to Component feels too broad, alternatively add `setFontSize` to `MenuItem` and `MenuBarButton` only (both are `Component`-extending classes); the call sites are limited to these two files.
    - `whiteSpace`, `overflow`, `textOverflow` on `_titleText` → `_titleText.setWhiteSpace`, `_titleText.setOverflow`, `_titleText.setTextOverflow`.
    - `textAlign` on `_shortcutText` and `_chevronText` → `setTextAlign` on each.
12. `src/typescript/lib/component/menubar/MenuBarButton.ts` — `fontSize` → `setFontSize` (same row-level pattern as `MenuItem`); `userSelect` on `_text` → `_text.setUserSelect` (inherited from Component); `whiteSpace` on `_text` → `_text.setWhiteSpace`.
13. `src/typescript/lib/core/Menu.ts` — two `contain` calls → `setContain`.
14. `src/typescript/lib/component/display/ProgressBar.ts` — `animation` set/clear → `setAnimation` / `clearAnimation`.
15. `src/typescript/lib/core/Window.ts` — `contain` → `setContain`.
16. `src/typescript/lib/component/input/AutoCompleteDropdown.ts` — `contain` → `setContain`.

Verify after each file: `npm run typecheck`. After the whole step: `grep -rn 'setElementCSSRule' src/typescript/lib --include="*.ts" | grep -v Component.ts | grep -v MenuSeparator.ts | grep -v MenuItem.ts | grep -v "src/typescript/lib/core/Component.ts"` — the only allowed survivors are the two subclass-local sites flagged above (`MenuSeparator` `borderTop`+`margin`, `MenuItem` separator's `borderTop`+`margin`). If anything else hits, fix it.

### Step 4 — Migrate `setElementAttribute` / `removeElementAttribute` call sites (CR1, part 2: attributes)

The 38 attribute call sites fall into clear buckets:

- **Form-input `disabled` attribute** (`Checkbox`, `TimeField`, `DateField`, `NumberSpinner`, `RadioButton`): all currently route through `setEnabled(options.enabled)` inside `applyOptions` and then do a raw `setElementAttribute("disabled", options.enabled ? null : "")`. Replace each with `setDisabledAttribute(!options.enabled)` (the negation is intentional — `disabled` is the inverse of `enabled`). The new method lives on `Component`.
- **`Input`-subclass attribute setters** (`name`, `placeholder`, `readonly`, `maxlength`, `rows`, `cols`, `wrap`, `min`, `max`, `step`, `value`, `selected`, `type`): each input subclass gets per-attribute typed setters that wrap the raw call. `Slider#setMin`, `setMax`, `setStep`, `setValue` already exist; the bug is that `applyOptions` bypasses them and calls `setElementAttribute` directly — fix to call the typed setters. For `Option#setSelected`, `Option#setDisabled`, `RadioButton#setName`, `RadioButton#setType`, `TextInput#setPlaceholder` / `setReadOnly` / `setMaxLength`, `TextArea#setRows` / `setCols` / `setWrap`, `AutoCompleteField#setPlaceholder` — add the typed setter on each subclass if one doesn't already exist; have `applyOptions` route through it.
- **`Aria` helper attribute calls** (8 in `Aria.ts`): refactor `Aria` to call `Component#applyAriaAttribute` (added in Step 1) instead of the raw helpers. `applyAriaAttribute` handles the null-or-string dispatch.

Verify after this step: `grep -rn 'setElementAttribute\|removeElementAttribute' src/typescript/lib --include="*.ts" | grep -v Component.ts | grep -v Aria.ts` — zero matches. (`Aria.ts` retains the calls if we go with the `@internal` qualifier on a public helper; if we go with `applyAriaAttribute`, `Aria.ts` also drops to zero.)

### Step 5 — Mark the raw element-access methods `protected` (CR2)

`src/typescript/lib/core/Component.ts`:

- Change `public setElementCSSRule` → `protected setElementCSSRule`.
- Change `public setElementCSSRules` → `protected setElementCSSRules`.
- Change `public setElementAttribute` → `protected setElementAttribute`.
- Change `public removeElementAttribute` → `protected removeElementAttribute`.
- Change `public setElementStyle` → `protected setElementStyle`.
- Change `public setElementStyles` → `protected setElementStyles`.
- Change `public commitElementStyle` → `protected commitElementStyle`.
- Change `public commitCSSRule` → `protected commitCSSRule`.

Do **not** change visibility on:

- `getElement` (external read-side)
- `getElementAttribute` (external read-side)
- `removeElement` (peer-instance destructor pattern; called by `Tooltip`, `Menu`, `Notification`, `DialogBackdrop`, `ProgressSpinner`)
- `setAutoCommitStyle`, `getAutoCommitStyle` (documented batching API for perf-sensitive consumers)
- `setAttribute`, `getAttribute`, `delAttribute` (component-level attribute API, separate from element-level)

The `Aria` helper's calls compile-fail under the new `protected` flag because `Aria` is not a `Component` subclass — Step 4 already migrated `Aria` to use `applyAriaAttribute` instead. If Step 4 left `Aria` calling `setElementAttribute` directly, that's the failing test for whether CR1 fully landed.

Verify: `npm run typecheck` passes clean. `npm run build:lib` and `npx vite build` pass.

### Step 6 — Add `clearX` companions (CR9, part 1: additions)

For each entry in the CR9 naming-convention table:

- Add the `clearX()` method on the relevant class (`Component`, `Button`, `WindowHeader`, `HeaderCell`).
- Keep the existing `setX(value: T | null)` signature unchanged in this step — only add the companions.

This step intentionally does not break anything. `setX(null)` still works for the entire library.

Verify: typecheck. Library build. The new `clearX` methods exist on the relevant classes.

### Step 7 — Migrate every in-tree `setX(null)` call site to `clearX()` (CR9, part 2: call-site migration)

Grep for `set[A-Z][a-zA-Z]*(null)` under `src/typescript/lib` and `src/typescript` (demo) and migrate each:

- `WindowHeader.ts:151,153` — `setBackgroundColor(null)` → `clearBackgroundColor()`; `setBackgroundImage(null)` → `clearBackgroundImage()`.
- `Header.ts:314` (table) — `cell.setSortState(null)` → `cell.clearSortState()`.
- `Notification.ts:144,146,147` — `setBackgroundImage(null)` → `clearBackgroundImage()`; `setShadow(null)` → `clearShadow()`; `setPressedShadow(null)` → `clearPressedShadow()`.
- `Dialog.ts:164,166,167` — same three migrations.
- `FieldDecorator.ts:88` — `setOutline(null)` → `clearOutline()`.
- `Image.ts:33`, `Text.ts:72`, `Body.ts:64`, `FieldDecorator.ts:40`, `TreeRow.ts:42,107`, `Tab.ts:63`, `ProgressSpinner.ts:73` — all `setInsets(null)` → `clearInsets()`.
- `Number.ts` (editor), `String.ts` (editor) — `setPadding(null)` → `clearPadding()`.
- `Button.ts:462`, `NumberSpinner.ts:301` — `setOpacity(null)` → `clearOpacity()`.
- `SpinButton.ts:45,46`, `Tab.ts:282,296,307` — `setShadow(null)` → `clearShadow()`; `setPressedShadow(null)` → `clearPressedShadow()`.
- `ProgressSpinner.ts:208` — `setBackgroundColor(null)` → `clearBackgroundColor()`.
- `ProgressBar.ts:218` — already migrated in Step 3 to `setAnimation`/`clearAnimation`; double-check.
- `Header.ts:312` (the two-arg `setSortState(entry.dir, …)` call) — the `state` arg loses `null` after CR9, but this call site already passes `entry.dir` (non-null), so it survives unchanged.
- `Tab.ts:280,295,305`, `WindowHeader.ts:67` — `setBorder()` (no args, the "clear" usage) → `clearBorder()`.
- `setBorder({ style: BorderStyle.NONE })` sites (`Notification.ts:143`, `Dialog.ts:163`, `NumberSpinner.ts:66`, `SpinButton.ts:47`) — these are not `null` clears, they're explicit "no border" styles, so they stay. Optionally a follow-up could migrate these to `clearBorder()` too, but it's behaviour-changing and out of scope here.
- `BindingPanel.ts:87` — `setValue(null)` on a `TimeField` is data-state, NOT a style clear. Stays unchanged (out of scope for CR9).

After every call site is migrated:

```
grep -rnE "set[A-Z][a-zA-Z]*\(null\)" src/typescript --include="*.ts"
```

The remaining hits should be data-bearing setters like `setValue(null)`, `setRecord(null)`, `setStore(null)` etc. — none of which are CSS/style setters. If a style-property `setX(null)` survives, fix it.

### Step 8 — Tighten `setX` signatures (CR9, part 3: drop `| null` from inputs)

For each `setX` listed in the CR9 table, update the TypeScript signature to drop `| null` from the parameter type:

- `setBackgroundColor(string | null)` → `setBackgroundColor(string)`.
- `setBackgroundImage(string | null = null)` → `setBackgroundImage(string)`. Drop the default.
- `setForegroundColor(string | null)` → `setForegroundColor(string)`.
- `setBorderRadius(string | null = null)` → `setBorderRadius(string)`. Drop the default.
- `setShadow(string | null)` → `setShadow(string)`.
- `setOutline(string | null)` → `setOutline(string)`.
- `setAppearance(string | null)` → `setAppearance(string)`.
- `setBorderImage(string | null)` → `setBorderImage(string)`.
- `setTransform(string | null)` → `setTransform(string)`.
- `setOpacity(number | null)` → `setOpacity(number)`.
- `setInsets(Insets | null)` → `setInsets(Insets)`.
- `setPadding(Insets | null)` → `setPadding(Insets)`.
- `Button#setPressedBackgroundColor`, `setPressedBackgroundImage`, `setPressedForegroundColor`, `setPressedBorderRadius`, `setPressedShadow`, `setGlyph` — all lose `| null`.
- `WindowHeader#setGlyph` — loses `| null`.
- `HeaderCell#setSortState` — `state` arg loses `| null`. `priority` keeps `number | null` (no badge / hide badge).

Inside each setter body, remove the `if (value) { … } else { removeProperty } ` branches — only the set branch remains. The `else` is now the responsibility of `clearX`.

After this step:

```
grep -rnE "setX\(null\)" tests || true
```

Test harness (if present under `src/typescript/perf` or anywhere else): audit similarly. Treat the test code identically to consumer code.

Verify: `npm run typecheck` passes. `npm run build:lib`, `npx vite build`, `npm run docs:build` all pass clean.

### Step 9 — Documentation pass

`docs/`:

- `docs/components/Component.md` (or wherever the Component API page lives, likely under `docs/api/core/classes/Component.md`) — regenerated from typedoc, so the new typed setters and `clearX` companions appear automatically. Re-run `npm run docs:build` to confirm.
- `docs/reference/changelog.md` — add a "Breaking" section noting:
  - `setX(null)` → `clearX()` for the listed setters.
  - Migration: in your codebase, run `git grep -nE "set[A-Z][a-zA-Z]*\(null\)" src` and replace each style/CSS-property hit with `clearX()`.
  - Note that `setValue(null)` and other data-bearing nullable setters are **unaffected**.
- `docs/recipes/notifications.md` and any other recipe that demonstrates a `setX(null)` — sweep and update.
- `docs/guide/styling.md` (if it exists; check during implementation) — add a one-line example showing the `setX(value)` / `clearX()` pattern.
- `docs/data/binding.md:102` — the `setRecord(null)` mention is data-bearing and stays as-is. Confirm during the sweep.

### Step 10 — Refresh the knowledge graph

```
graphify update . --directed
```

The new `clearX` symbols and the `applyAriaAttribute` helper plus all the visibility flips show up in the next graph build.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (Steps 1, 5, 6, 8) |
| Modify | `src/typescript/lib/core/Aria.ts` (Step 4 refactor to `applyAriaAttribute`) |
| Modify | `src/typescript/lib/component/input/Text.ts` (Step 2 + Step 7 + Step 8) |
| Modify | `src/typescript/lib/component/button/Button.ts` (Step 6 + Step 7 + Step 8) |
| Modify | `src/typescript/lib/component/container/WindowHeader.ts` (Step 6, 7, 8) |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` (Step 6, 7, 8: `setSortState` / `clearSortState`) |
| Modify | `src/typescript/lib/component/table/Header.ts` (Step 7 call-site migration) |
| Modify | `src/typescript/lib/core/Notification.ts` (Step 3 + Step 7) |
| Modify | `src/typescript/lib/core/Dialog.ts` (Step 3 + Step 7) |
| Modify | `src/typescript/lib/core/Tooltip.ts` (Step 3) |
| Modify | `src/typescript/lib/core/Menu.ts` (Step 3) |
| Modify | `src/typescript/lib/core/Window.ts` (Step 3) |
| Modify | `src/typescript/lib/core/Body.ts` (Step 7: `setInsets(null)` → `clearInsets()`) |
| Modify | `src/typescript/lib/layout/Accordion.ts` (Step 3) |
| Modify | `src/typescript/lib/layout/Tab.ts` (Step 7: `setShadow(null)`, `setBorder()` migrations) |
| Modify | `src/typescript/lib/validation/FieldDecorator.ts` (Step 7) |
| Modify | `src/typescript/lib/component/container/MenuItem.ts` (Step 3 typed-setter swap) |
| Modify | `src/typescript/lib/component/container/MenuSeparator.ts` (Step 3 — keeps internal `setElementCSSRule` after CR2; verify) |
| Modify | `src/typescript/lib/component/menubar/MenuBarButton.ts` (Step 3) |
| Modify | `src/typescript/lib/component/menubar/MenuBar.ts` (Step 3) |
| Modify | `src/typescript/lib/component/display/Glyph.ts` (Step 3) |
| Modify | `src/typescript/lib/component/display/ProgressBar.ts` (Step 3 + Step 7) |
| Modify | `src/typescript/lib/component/display/ProgressSpinner.ts` (Step 3 + Step 7) |
| Modify | `src/typescript/lib/component/display/Image.ts` (Step 7) |
| Modify | `src/typescript/lib/component/input/AutoCompleteItem.ts` (Step 3) |
| Modify | `src/typescript/lib/component/input/AutoCompleteDropdown.ts` (Step 3) |
| Modify | `src/typescript/lib/component/input/AutoCompleteField.ts` (Step 4: `placeholder` attribute) |
| Modify | `src/typescript/lib/component/input/TextInput.ts` (Steps 3, 4) |
| Modify | `src/typescript/lib/component/input/TextArea.ts` (Step 4) |
| Modify | `src/typescript/lib/component/input/Slider.ts` (Step 4) |
| Modify | `src/typescript/lib/component/input/Checkbox.ts` (Step 4) |
| Modify | `src/typescript/lib/component/input/DateField.ts` (Step 4) |
| Modify | `src/typescript/lib/component/input/TimeField.ts` (Step 4) |
| Modify | `src/typescript/lib/component/input/NumberSpinner.ts` (Steps 4, 7) |
| Modify | `src/typescript/lib/component/input/RadioButton.ts` (Step 4) |
| Modify | `src/typescript/lib/component/input/Option.ts` (Step 4) |
| Modify | `src/typescript/lib/component/input/Input.ts` (Step 4: `name` attribute) |
| Modify | `src/typescript/lib/component/input/SpinButton.ts` (Step 7) |
| Modify | `src/typescript/lib/component/tree/TreeRow.ts` (Step 7) |
| Modify | `src/typescript/lib/component/table/cell/editor/String.ts` (Step 7) |
| Modify | `src/typescript/lib/component/table/cell/editor/Number.ts` (Step 7) |
| Modify | `src/typescript/BindingPanel.ts` (audit only — `setValue(null)` is data-state and stays) |
| Modify | `docs/reference/changelog.md` (Step 9) |
| Modify | `docs/recipes/notifications.md` + any other recipes (Step 9) |
| Create | none |
| Delete | none |

---

## Verification

Each gate is a hard pass/fail. Order matters: typecheck before build, build before docs, smoke after build.

1. **Type check:**
   ```
   npm run typecheck
   ```
   Zero errors. Every `setX(null)` site under `src/typescript` was migrated (otherwise the tightened signature fails compilation).

2. **Library build:**
   ```
   npm run build:lib
   ```
   Clean.

3. **Demo build:**
   ```
   npx vite build
   ```
   Clean.

4. **Docs build:**
   ```
   npm run docs:build
   ```
   Zero errors, zero new link warnings. New `clearX` methods appear under the typedoc-generated class pages.

5. **Grep invariants:**
   ```
   grep -rnE 'setElementCSSRule|setElementAttribute|removeElementAttribute' src/typescript/lib --include='*.ts' \
       | grep -v 'src/typescript/lib/core/Component.ts' \
       | grep -v 'src/typescript/lib/core/Aria.ts'
   ```
   Allowed survivors after CR1+CR2:
   - `MenuSeparator.ts` lines that set `borderTop` and `margin` (subclass-local; protected access).
   - `MenuItem.ts` lines that set `borderTop` and `margin` inside the separator branch (same rationale).
   - The internal call sites from inside the new typed setters themselves do not appear in this grep because they live in `Component.ts` and `Aria.ts` which are excluded.

   Everything else: zero matches.

   ```
   grep -rnE "set[A-Z][a-zA-Z]*\(null\)" src/typescript --include='*.ts'
   ```
   Allowed survivors:
   - `setValue(null)` on data-bearing fields (`TimeField`, `DateField`, `NumberSpinner`, `AutoCompleteField`, …).
   - `setRecord(null)`, `setStore(null)` and other data-bearing nullable setters.

   No style-property `setX(null)` survives.

6. **Dev-server smoke walk:**
   ```
   npm run dev
   ```
   - Open every panel from the demo (`MainPanel`, `AccordionPanel`, `BindingPanel`, `BorderPanel`, `ColumnPanel`, `ComplexUIPanel`, `FitPanel`, `GridPanel`, `HBoxPanel`, `LayoutTestPanel`, `MenuBarPanel`, `MiscPanel`, `MultiSelectListPanel`, `RowPanel`, `SplitPanel`, `TabPanel`, `VBoxPanel`, `BaselinePanel`).
   - Confirm nothing visual has changed. The typed-setter migration is meant to be behaviour-preserving; the only intentional visual delta is "none".
   - Trigger every interaction that fires a `clearX`: open and close a `Notification`, open and close a `Dialog`, open the validation `FieldDecorator` flow (showError → clearError), drag a `Tab` close button, expand and collapse a `TreeRow`.
   - Tab the spinner buttons, the slider, the radio buttons. The `disabled` attribute migration affects every form input.

7. **`Aria` regression check:**
   - Open devtools, inspect any focusable component, confirm the `role`, `aria-label`, `aria-disabled`, `aria-expanded`, `aria-valuenow`, `aria-controls`, `aria-activedescendant`, `aria-sort` attributes still appear on the element. The `applyAriaAttribute` refactor must not drop any attribute.

8. **Refresh the knowledge graph:**
   ```
   graphify update . --directed
   ```

---

## Documentation Impact

Public API additions:

- `Component#setContain`, `setOverflowX`, `setOverflowY`, `setAnimation`, `setDisabledAttribute`, plus the entire `clearX` family (`clearBackgroundColor`, `clearBackgroundImage`, `clearForegroundColor`, `clearBorderRadius`, `clearShadow`, `clearOutline`, `clearAppearance`, `clearBorderImage`, `clearTransform`, `clearOpacity`, `clearInsets`, `clearPadding`, `clearBorder`, `clearAnimation`). Typedoc generates them; each has standard JSDoc.
- `Text#setWordBreak`, `setLineClamp` / `clearLineClamp`.
- `Button#clearPressedBackgroundColor`, `clearPressedBackgroundImage`, `clearPressedForegroundColor`, `clearPressedBorderRadius`, `clearPressedShadow`, `clearGlyph`.
- `WindowHeader#clearGlyph`.
- `HeaderCell#clearSortState`.
- `Component#applyAriaAttribute` (marked `@internal`; suppressed from public docs by typedoc's `@internal` filter).

Public API removals (signature tightening):

- The `| null` form of every setter listed in the CR9 table. Documented in `docs/reference/changelog.md` as a breaking change with one-line replacement per site.

Documented visibility narrowing:

- `Component#setElementCSSRule`, `setElementCSSRules`, `setElementAttribute`, `removeElementAttribute`, `setElementStyle`, `setElementStyles`, `commitElementStyle`, `commitCSSRule` all become `protected`. They disappear from the public typedoc-generated docs.
- Note in the changelog: "If you were calling these directly, you likely want a typed setter — file an issue if your case isn't covered."

Sidebar / `docs/.vitepress/config.mts` — no new pages.

---

## Potential Challenges

- **`Aria` calling `protected` methods after CR2.** `Aria` is in a sibling file, not a subclass, so the `protected` qualifier on `setElementAttribute`/`removeElementAttribute` would lock it out. Step 1 adds `applyAriaAttribute` as a `protected` helper and Step 4 routes `Aria` through it. If during implementation you discover `Aria` has more attribute call sites than the 8 we counted, just keep routing them through the helper — there is no rate-of-change concern.
- **`MenuSeparator` / `MenuItem` separator-branch raw calls.** Both files retain `setElementCSSRule("borderTop", …)` and `setElementCSSRule("margin", "4px 0")` calls because the values are layout-internal and don't benefit from being promoted to a typed setter. The `protected` qualifier in CR2 still permits these calls because both classes extend `Component`. **Subtle risk**: someone reviewing the grep invariant in verification might flag these — the verification step explicitly lists them as allowed survivors, so they pass review.
- **`setBorder()` (no-args) vs `clearBorder()`.** The current code uses `setBorder()` with no arguments in 4 places to "clear" the border. `setBorder()` internally constructs a `new Border(undefined)` which is not the same as "no border" — it applies the default Border. The 4 call sites *expect* a default border to be drawn there. **Audit during implementation**: confirm each of the 4 call sites (`Tab.ts:280,295,305`, `WindowHeader.ts:67`) renders correctly today, and whether `clearBorder()` (which removes the property entirely) produces the same visual or a different one. If different, the 4 sites need to migrate to `setBorder({ style: BorderStyle.NONE })` instead, and `clearBorder()` is reserved for genuine clears. Treat this as a finding to confirm before merging.
- **`setShadow(null)` semantic — `'none'` vs `removeProperty`.** Today `setShadow(null)` writes `'none'`, not `removeProperty('box-shadow')`. The `clearShadow()` companion preserves this exact behaviour (writes `'none'`). Document this in the JSDoc so future readers don't "fix" it to a `removeProperty`.
- **`setInsets(null)` and `setPadding(null)` are resets, not clears.** They both reset to zero rather than removing the cached value. The plan keeps the same semantic in `clearInsets()` / `clearPadding()`. Document explicitly in JSDoc.
- **Tests that pass `null`.** If `src/typescript/perf/` or any test harness passes `null` to a now-tightened setter, the test breaks. Step 8's grep step catches these.
- **Diff size for CR1.** ~107 call sites across ~25 files. Some files (Notification, MenuItem) get 6+ migrations each. If the diff is too large for one PR, split CR1 into two commits (Component-internal-only changes, then subclass-only changes) as noted in the commit-strategy decision.
- **CR9 breaking-change communication.** The library is pre-1.0 and the project's CHANGELOG is the canonical migration path. The plan does not add a deprecation period — the `setX(null)` call simply fails to compile, and the TypeScript error message directs the user to the `clearX()` companion (clear enough). If a deprecation path is desired, leave the `setX(value: T | null)` signature in place and have `setX(null)` log a console warning that calls `clearX()` internally — but this is more code to maintain than the benefit warrants for a pre-1.0 library.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — the entire public-API change lives here. Read end-to-end before starting; understand the `cssRule` vs `dirtyStyle` distinction (cached style vs element style) because every new setter has to pick one or the other.
- [src/typescript/lib/core/Aria.ts](../src/typescript/lib/core/Aria.ts) — the only non-subclass external caller of `setElementAttribute`. Step 1's `applyAriaAttribute` helper and Step 4's refactor are the only thing keeping CR2 from breaking ARIA.
- [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — second-largest setter surface and the home of the new `setLineClamp` composite. The existing `centerInHeight` is the right reference for the JSDoc-and-shape conventions.
- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — the `pressed*` setter family is the largest concentration of CR9 changes outside `Component`. The `pressedCSSRule` field handles the `:active` selector; understand how it relates to the regular `cssRule` before tightening signatures.
- [src/typescript/lib/core/Notification.ts](../src/typescript/lib/core/Notification.ts) — densest concentration of raw `setElementCSSRule` calls (9), and the test bed for the new `setLineClamp` helper. After Step 3 this file should be the cleanest example of "raw call sites consolidated into a typed setter call".
