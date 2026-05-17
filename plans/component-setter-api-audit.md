# Component Setter API Audit — Implementation Plan

## Overview

A small follow-up to [Typed Style Setters and `clear*` API](implemented/typed-style-setters-and-clear-api.md). That branch made every external `setElement*` call route through a typed setter and added `clearX` companions for the nullable style setters on [`Component`](../src/typescript/lib/core/Component.ts), [`Button`](../src/typescript/lib/component/button/Button.ts), [`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts), and [`HeaderCell`](../src/typescript/lib/component/table/cell/Header.ts). The audit was scoped to migration sites; it did not sweep `Component.ts` and its other subclasses for setters that *predate* the migration and never adopted the cache/get/clear shape.

This plan closes those two gaps:

- **Issue A — Setters that write straight to the DOM without a backing field.** Each such setter loses its value on element re-creation (`removeElement()` then a later `getElement(true)`), can't participate in `applyStyle` re-render, can't answer a `getX()` without forcing a style read, and can't be serialised. The fix is uniform: introduce a cached backing field, write to it before delegating to `setElement*`.
- **Issue B — `setX` methods without paired `getX` / `clearX`.** The convention established in [typed-style-setters-and-clear-api.md:32-42](implemented/typed-style-setters-and-clear-api.md) is that every typed DOM-bound setter on `Component` ships with a `getX` returning the cached value and (for nullable-style properties) a `clearX` resetting to inherit/default/null. The pre-existing setters that don't conform are gaps the convention now requires us to close.

The fix shape already exists in the codebase: `_willChange` ([Component.ts:176](../src/typescript/lib/core/Component.ts#L176)), the typed pattern at [Component.ts:1999-2008 (`setContain`)](../src/typescript/lib/core/Component.ts#L1999), and [Component.ts:2026-2051 (`setAnimation` / `clearAnimation`)](../src/typescript/lib/core/Component.ts#L2026) are the reference. This plan just extends them.

---

## Architecture Decisions

### One uniform setter shape, no new options bag fields

Every offender adopts the same five-line pattern (lifted verbatim from `setContain` at [Component.ts:1999](../src/typescript/lib/core/Component.ts#L1999)):

```typescript
private _foo: T | null = null;

getFoo(): T | null { return this._foo; }

setFoo(value: T): this {
    if (this._foo === value) {
        return this;
    }
    this._foo = value;
    this.setElementCSSRule("foo", value);   // or setElementStyle / setElementAttribute
    return this;
}

clearFoo(): this {
    if (this._foo === null) {
        return this;
    }
    this._foo = null;
    this.setElementCSSRule("foo", null);
    return this;
}
```

Underscore-prefix the field. The recent [Component constructor-options refactor](implemented/component-constructor-options.md) split state across `_options` (option-backed, surface-visible in `XOptions`) and underscore-prefixed private fields (runtime-only, not surfaced). The Issue A setters fixed here are *not* part of `ComponentOptions` today, and the audit explicitly does **not** add them — the constructor-options surface is its own design decision and falls outside the scope of an API hygiene pass. So every cache introduced here is the underscore-prefixed runtime form, alongside the existing `_willChange`, `overflowX`, `overflowY`, `contain`, `animation`, `disabledAttribute`, `wordBreak`, `lineClamp` family at [Component.ts:176-193](../src/typescript/lib/core/Component.ts#L176) and [Text.ts](../src/typescript/lib/component/input/Text.ts).

### Why introduce a cache when `setElementCSSRule` reads from the CSSOM?

Three concrete failure modes the cache fixes:

1. **Element re-creation.** `Component#removeElement()` drops the DOM node; a later `getElement(true)` re-renders. `applyStyle` ([Component.ts:2242-2378](../src/typescript/lib/core/Component.ts#L2242)) re-applies fields it knows about. A setter that only wrote to a freshly created `CSSStyleRule` has no cached value for `applyStyle` to re-emit, so the visual state is lost on re-render.
2. **`getX` honesty.** Without a cache, the getter either has to read computed style (forced reflow) or return a stale assumption. The convention is "getter returns the value the caller last passed in, without hitting the DOM."
3. **State / serialisation parity.** Theme switches, snapshot/restore, and future debug dumps all read through getters. A setter that doesn't cache is invisible to all three.

### `clearX` semantics: "remove the property" not "remove the cache"

Existing companions in `Component.ts` keep a uniform meaning:

- `clearBackgroundColor` ([Component.ts:943](../src/typescript/lib/core/Component.ts#L943)) writes `setElementCSSRule("backgroundColor", null)` — i.e. `removeProperty`.
- `clearShadow` ([Component.ts:1198](../src/typescript/lib/core/Component.ts#L1198)) writes `"none"` (not `removeProperty`) — explicitly preserving legacy `setShadow(null)` semantic.
- `clearInsets` ([Component.ts:855](../src/typescript/lib/core/Component.ts#L855)) and `clearPadding` ([Component.ts:904](../src/typescript/lib/core/Component.ts#L904)) are *resets to zero* (`new Insets(0,0,0,0)` / `"0px 0px 0px 0px"`), documented as such.

Every new `clearX` added by this plan follows the **`removeProperty`** form unless an existing pattern dictates otherwise. The only exceptions in the offender list are the two reset-to-default cases flagged in the table below.

### Don't change setter bodies past adding the cache write

The Issue A fixes are intentionally minimal: introduce a field, write it before the existing DOM call, expose a getter, expose a clear. Do **not** refactor the existing setter bodies (e.g. don't switch `setElementCSSRule` calls to `setElementCSSRules` for batching, don't fold `setOutline` into `setAppearance`'s pattern, don't add early-return identity guards beyond what the field naturally enables).

### Issue B without Issue A

Several setters already cache their value but lack a `getX` or `clearX`. These are pure Issue B (no field work, no `XOptions` field). The plan lists each one and adds only the missing method. The convention from [typed-style-setters-and-clear-api.md:118-141](implemented/typed-style-setters-and-clear-api.md) governs the `clearX` semantic ("remove property" vs "reset to default").

### Non-style setters intentionally excluded

The audit only covers DOM-bound setters (those that ultimately call `setElement*` / `setStyle` / `setElementAttribute` to mirror to the DOM). Excluded:

- **Domain / state setters** with no DOM write: `Menu#setMenuWidth` ([Menu.ts:210](../src/typescript/lib/core/Menu.ts#L210)) and `Menu#setExcludedElement` ([Menu.ts:473](../src/typescript/lib/core/Menu.ts#L473)) cache a field but never touch the DOM directly; they're config inputs read elsewhere. No `clearX` is meaningful here.
- **Data setters** like `Checkbox#setValue` ([Checkbox.ts:101](../src/typescript/lib/component/input/Checkbox.ts#L101)), `Slider#setValue`, `TimeField#setValue`, `DateField#setValue` — `null` is data-state, not "clear my styling", per the explicit carve-out at [typed-style-setters-and-clear-api.md:145](implemented/typed-style-setters-and-clear-api.md#L145).
- **Composite-state setters** like `WindowHeader#setActive` and `MenuBarButton#setActive` — they compose multiple already-typed setters (`setBackgroundImage` + `clearBackgroundColor`). They aren't gaps; they're sugar.
- **Window#setContentFactory / setResizeFps** — config callbacks / runtime parameters, not DOM-bound; no DOM mirror needed.

If something straddles the line (e.g. `Text#setAutoMeasure` ([Text.ts:390](../src/typescript/lib/component/input/Text.ts#L390)) which caches but never writes to the DOM), the plan errs on the side of leaving it alone. The audit is "every setter that *writes to the DOM* should cache before writing and expose getter + clear".

### Dependency on the underscore-prefix convention

The cache field naming follows the recent [`_willChange` / `_options` convention](../src/typescript/lib/core/Component.ts#L176). If a separate plan ships first to rename the existing private fields (`overflowX`, `overflowY`, `contain`, `animation`, `disabledAttribute`, `wordBreak`, `lineClamp`, `verticalAlign`, `userSelect`, `whiteSpace`, `borderCSS`) to the underscore-prefixed form, this plan should adopt that form for its new fields. Until then, this plan uses the underscore-prefixed form for the *new* fields (`_outline`, `_appearance`, `_borderImage`, `_transform`, `_colorScheme`, `_pointerEvents`, `_opacity`, `_textOverflow`, `_textShadow`, …) and leaves the inconsistency visible — better than introducing a second mixed convention.

---

## Audit Findings

Legend per row: **A** = Issue A (no cached field); **B** = Issue B (missing get and/or clear); **B-get** = missing get only; **B-clear** = missing clear only. Setter "kind" classifies the DOM target: `cssRule` for `setElementCSSRule`, `style` for `setElementStyle`, `attr` for `setElementAttribute`.

### `Component.ts` — [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed field | Proposed additions |
|---|---|---|---|---|---|---|---|---|
| `setColorScheme` ([L1039](../src/typescript/lib/core/Component.ts#L1039)) | 1039 | cssRule (`colorScheme`) | yes (`_options.colorScheme`) | yes | no | B-clear | — | `clearColorScheme(): this` — writes `setElementCSSRule("colorScheme", null)` and clears `_options.colorScheme`. |
| `setCursor` ([L1118](../src/typescript/lib/core/Component.ts#L1118)) | 1118 | style (`cursor`) | yes (`_options.cursor`) | yes | no | B-clear | — | `clearCursor(): this` — writes `setElementStyle("cursor", null)` and clears `_options.cursor`. |
| `setOutline` ([L1212](../src/typescript/lib/core/Component.ts#L1212)) | 1212 | cssRule (`outline`) | **no** | **no** | yes | A + B-get | `_outline: string \| null = null` | `getOutline(): string \| null`. `setOutline` body caches `this._outline = outline` before delegating. (`clearOutline` already exists at [L1223](../src/typescript/lib/core/Component.ts#L1223); update it to clear the field.) |
| `setAppearance` ([L1236](../src/typescript/lib/core/Component.ts#L1236)) | 1236 | cssRules (`webkitAppearance`+`appearance`) | **no** | **no** | yes | A + B-get | `_appearance: string \| null = null` | `getAppearance(): string \| null`. `setAppearance` caches. (`clearAppearance` already exists; update to clear field.) |
| `setBorderImage` ([L1266](../src/typescript/lib/core/Component.ts#L1266)) | 1266 | cssRule (`borderImage`) | **no** | **no** | yes | A + B-get | `_borderImage: string \| null = null` | `getBorderImage(): string \| null`. `setBorderImage` caches. (`clearBorderImage` already exists; update.) |
| `setTransform` ([L1290](../src/typescript/lib/core/Component.ts#L1290)) | 1290 | cssRule (`transform`) | **no** | **no** | yes | A + B-get | `_transform: string \| null = null` | `getTransform(): string \| null`. `setTransform` caches. (`clearTransform` already exists; update.) Note interaction with `setTranslate` ([L1858](../src/typescript/lib/core/Component.ts#L1858)) which writes `transform` via inline style — document that the two are independent surfaces (rule vs inline) and the cache here reflects the *rule* value. |
| `setVerticalAlign` ([L1628](../src/typescript/lib/core/Component.ts#L1628)) | 1628 | cssRule (`verticalAlign`) | yes (`verticalAlign`) | yes (`getVerticalAlign` at [L1621](../src/typescript/lib/core/Component.ts#L1621)) | no | B-clear | — | `clearVerticalAlign(): this` — writes `setElementCSSRule("verticalAlign", null)`, clears `verticalAlign`. |
| `setPosition` ([L1891](../src/typescript/lib/core/Component.ts#L1891)) | 1891 | cssRule (`position`) | yes (`_options.position`) | yes | no | B-clear | — | `clearPosition(): this` — writes `setElementCSSRule("position", null)`, clears `_options.position`. (Note: `getPosition` returns `Position.ABSOLUTE` as fallback at [L1881](../src/typescript/lib/core/Component.ts#L1881); the clear leaves the framework default in place, so the visible effect of `clearPosition` is "drop the explicit override".) |
| `setOverflow` ([L1920](../src/typescript/lib/core/Component.ts#L1920)) | 1920 | cssRule (`overflow`) | yes (`_options.overflow`) | yes | no | B-clear | — | `clearOverflow(): this` — writes `setElementCSSRule("overflow", null)`, clears `_options.overflow`. |
| `setOverflowX` ([L1944](../src/typescript/lib/core/Component.ts#L1944)) | 1944 | cssRule (`overflowX`) | yes (`overflowX`) | yes | no | B-clear | — | `clearOverflowX(): this` — writes `setElementCSSRule("overflowX", null)`, clears `overflowX`. |
| `setOverflowY` ([L1971](../src/typescript/lib/core/Component.ts#L1971)) | 1971 | cssRule (`overflowY`) | yes (`overflowY`) | yes | no | B-clear | — | `clearOverflowY(): this` — symmetric. |
| `setContain` ([L1999](../src/typescript/lib/core/Component.ts#L1999)) | 1999 | cssRule (`contain`) | yes (`contain`) | yes | no | B-clear | — | `clearContain(): this`. |
| `setPointerEvents` ([L2116](../src/typescript/lib/core/Component.ts#L2116)) | 2116 | style (`pointerEvents`) | yes (`_options.pointerEvents`) | no | no | B-get + B-clear | — | `getPointerEvents(): string \| null` (read `_options.pointerEvents ?? null`). `clearPointerEvents(): this` — writes `setElementStyle("pointerEvents", null)`, clears `_options.pointerEvents`. |
| `setOpacity` ([L2131](../src/typescript/lib/core/Component.ts#L2131)) | 2131 | style (`opacity`) | **no** | **no** | yes | A + B-get | `_opacity: number \| null = null` | `getOpacity(): number \| null`. `setOpacity` caches `this._opacity = value` before delegating. (`clearOpacity` already exists at [L2143](../src/typescript/lib/core/Component.ts#L2143); update to clear the field.) |
| `setUserSelect` ([L2191](../src/typescript/lib/core/Component.ts#L2191)) | 2191 | cssRule (`userSelect`) | yes (`userSelect`) | no | no | B-get + B-clear | — | `getUserSelect(): string \| null` (return `this.userSelect`). `clearUserSelect(): this` — writes `setElementCSSRule("userSelect", null)`, clears `userSelect`. |

The eight already-typed setters that do **not** need a `clearX` (per the convention's "non-nullable + no meaningful clear" carve-out at [typed-style-setters-and-clear-api.md:143-147](implemented/typed-style-setters-and-clear-api.md#L143)) are: `setId`, `setVisible`, `setZIndex`, `setDisplayed`, `setPreferredSize`, `setMinSize`, `setMaxSize`, `setSize` / `setWidth` / `setHeight` / `setX` / `setY` / `setTranslate`, `setLayoutManager`, `setAutoCommitStyle`, `setLayoutConstraints`, `setDisabledAttribute`, `applyAriaAttribute`. These are non-nullable or framework-internal; the audit leaves them alone.

### `Text.ts` — [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts)

`Text` already has a healthy `_options`-backed cache for the font family (`setFontFamily`, `setFontKerning`, `setFontSize`, `setFontStretch`, `setFontStyle`, `setFontVariant`, `setFontWeight`, `setLineHeight`, `setFontSizeAdjust`, `setTextAlign`, `setTextShadow`). Gaps:

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed field | Proposed additions |
|---|---|---|---|---|---|---|---|---|
| `setTextOverflow` ([L730](../src/typescript/lib/component/input/Text.ts#L730)) | 730 | cssRule (`textOverflow`) | **no** | **no** | **no** | A + B | `_textOverflow: string \| null = null` | `getTextOverflow(): string \| null`, `clearTextOverflow(): this`. |
| `setWhiteSpace` ([L743](../src/typescript/lib/component/input/Text.ts#L743)) | 743 | cssRule (`whiteSpace`) | **no** | **no** | **no** | A + B | `_whiteSpace: string \| null = null` (note: `Component` already declares a private `whiteSpace` at [Component.ts:190](../src/typescript/lib/core/Component.ts#L190), unused for setter caching but read by `applyStyle` at [L2326](../src/typescript/lib/core/Component.ts#L2326)). Resolve by **promoting the field to `Component` proper** — `Text#setWhiteSpace` already inherits the parent class. The fix is: introduce `getWhiteSpace` and `setWhiteSpace` on `Component`, move the existing `Text#setWhiteSpace` body up, write to `this.whiteSpace` (the already-declared field). | `getWhiteSpace(): string \| null`, `clearWhiteSpace(): this`. |
| `setTextShadow` ([L436](../src/typescript/lib/component/input/Text.ts#L436)) | 436 | cssRule (`textShadow`) | yes (`_options.textShadow`) | yes ([L425](../src/typescript/lib/component/input/Text.ts#L425)) | no | B-clear | — | `clearTextShadow(): this`. |
| `setFontFamily` ([L460](../src/typescript/lib/component/input/Text.ts#L460)) | 460 | cssRule (`fontFamily`) | yes | yes | no | B-clear | — | `clearFontFamily(): this` (only if a "revert to theme default" use case exists — see Potential Challenges; otherwise mark as deliberately out of scope). |
| `setFontKerning`, `setFontSizeAdjust`, `setFontStretch`, `setFontStyle`, `setFontVariant`, `setFontWeight` | 487, 554, 578, 602, 626, 650 | cssRule | yes | yes | no | B-clear | — | `clearFontKerning() / clearFontSizeAdjust() / clearFontStretch() / clearFontStyle() / clearFontVariant() / clearFontWeight()`. Same "revert to default" caveat. **Recommendation:** defer these to a follow-up plan — none have a documented "clear" use case today, so adding six `clearX` methods purely for symmetry is speculative. List as Potential Challenges, not in the Ordered Steps. |
| `setTextAlign` ([L412](../src/typescript/lib/component/input/Text.ts#L412)) | 412 | cssRule (`textAlign`) | yes | yes | no | B-clear | — | `clearTextAlign(): this` — same defer-to-follow-up note. |

The hot path here is `setTextOverflow` and `setWhiteSpace` (real A + B gaps). The Text-side font-property `clearX` family is a B-clear gap but with no demonstrated use case; deferred.

### `TextInput.ts` — [src/typescript/lib/component/input/TextInput.ts](../src/typescript/lib/component/input/TextInput.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setTextAlign` ([L99](../src/typescript/lib/component/input/TextInput.ts#L99)) | 99 | cssRule (`textAlign`) | yes (`_options.textAlign`) | yes | no | B-clear | `clearTextAlign(): this` — symmetric to the `Text` follow-up. Deferred unless `Text#clearTextAlign` lands. |
| `setText` ([L123](../src/typescript/lib/component/input/TextInput.ts#L123)) | 123 | DOM-prop (`element.value`) | yes | yes | no | B-clear | `clearText(): this` writes empty string. Consistent with the "data setter" carve-out — `setText` is data-state, **excluded by the non-style carve-out**. Mention only for completeness. |
| `setPlaceholder`, `setReadOnly`, `setMaxLength` ([L152, L175, L203](../src/typescript/lib/component/input/TextInput.ts)) | 152, 175, 203 | attr | yes | yes (`getPlaceholder` / `isReadOnly` / `getMaxLength`) | no | B-clear | `clearPlaceholder(): this`, `clearReadOnly(): this` (or rely on `setReadOnly(false)` since boolean), `clearMaxLength(): this`. `setReadOnly` is non-nullable boolean — convention says **no clear**, leave alone. `clearPlaceholder` and `clearMaxLength` both remove the HTML attribute. |

### `TextArea.ts` — [src/typescript/lib/component/input/TextArea.ts](../src/typescript/lib/component/input/TextArea.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setRows` ([L95](../src/typescript/lib/component/input/TextArea.ts#L95)) | 95 | attr (`rows`) | yes | yes | no | B-clear | `clearRows(): this` — `removeElementAttribute("rows")`. |
| `setCols` ([L118](../src/typescript/lib/component/input/TextArea.ts#L118)) | 118 | attr (`cols`) | yes | yes | no | B-clear | `clearCols(): this`. |
| `setWrap` ([L141](../src/typescript/lib/component/input/TextArea.ts#L141)) | 141 | attr (`wrap`) | yes | yes | no | B-clear | `clearWrap(): this`. |

### `Slider.ts` — [src/typescript/lib/component/input/Slider.ts](../src/typescript/lib/component/input/Slider.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setMinValue`, `setMaxValue`, `setStep`, `setValue` ([L109, L133, L157, L181](../src/typescript/lib/component/input/Slider.ts)) | 109, 133, 157, 181 | attr | yes | yes | no | B-clear | Data setters with non-nullable signatures and intrinsic defaults (0 / 100 / 1 / 50). The convention says non-nullable setters don't gain a clear ([typed-style-setters-and-clear-api.md:146](implemented/typed-style-setters-and-clear-api.md#L146)). **Leave alone.** Listed for completeness. |

### `Glyph.ts` — [src/typescript/lib/component/display/Glyph.ts](../src/typescript/lib/component/display/Glyph.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setLineHeight`, `setTextAlign` ([L155, L186](../src/typescript/lib/component/display/Glyph.ts)) | 155, 186 | cssRule | yes | yes | no | B-clear | Inherited from `Text`. If `Text#clearTextAlign` is deferred, `Glyph` follows. Defer. |

### `RadioButton.ts` — [src/typescript/lib/component/input/RadioButton.ts](../src/typescript/lib/component/input/RadioButton.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setRadioName` ([L138](../src/typescript/lib/component/input/RadioButton.ts#L138)) | 138 | attr-on-inner (`name`) | yes (`_options.radioName`) | yes | no | B-clear | `clearRadioName(): this` — `this._options.radioName = undefined; this.radio.removeElementAttribute("name")` (or whatever the inner `TextInput`'s setName helper exposes — confirm during implementation). |
| `setSelected` ([L159](../src/typescript/lib/component/input/RadioButton.ts#L159)) | 159 | DOM-prop (`element.checked`) | yes | yes (`isSelected`) | no | B-clear | Data setter — non-nullable boolean. **Leave alone**, per the carve-out. |

### `Option.ts` — [src/typescript/lib/component/input/Option.ts](../src/typescript/lib/component/input/Option.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setSelected` ([L94](../src/typescript/lib/component/input/Option.ts#L94)) | 94 | attr (`selected`) | yes | yes (`isSelected`) | no | B-clear | Data setter — non-nullable boolean. **Leave alone.** |

### `NumberSpinner.ts` — [src/typescript/lib/component/input/NumberSpinner.ts](../src/typescript/lib/component/input/NumberSpinner.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setValue`, `setMin`, `setMax`, `setStep` ([L192, L212, L234, L256](../src/typescript/lib/component/input/NumberSpinner.ts)) | 192, 212, 234, 256 | data | yes | yes | no | — | Data setters — non-nullable. **Leave alone.** |
| `setPrecision` ([L276](../src/typescript/lib/component/input/NumberSpinner.ts#L276)) | 276 | data | yes | yes | accepts `null` directly | — | Already accepts `null` as the "derive from step" mode. No `clearX` needed — null is the documented signal. |

### `Window.ts` — [src/typescript/lib/core/Window.ts](../src/typescript/lib/core/Window.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setHeaderText` ([L379](../src/typescript/lib/core/Window.ts#L379)) | 379 | inner-Text (`Text#setText`) | no (delegates to `header.getText().setText`) | no | no | composite — excluded | — | Pure delegate; the inner `Text` is the cache. No setter-level work needed. |
| `setResizeFps` ([L435](../src/typescript/lib/core/Window.ts#L435)) | 435 | runtime config | yes | no | no | B-get | `getResizeFps(): number` — return `this.resizeFps`. No `clearX` (runtime parameter, not DOM). |
| `setContentFactory` ([L303](../src/typescript/lib/core/Window.ts#L303)) | 303 | runtime config | yes | no | no | excluded | Factory closure, framework-internal. Leave alone. |

### `Menu.ts` — [src/typescript/lib/core/Menu.ts](../src/typescript/lib/core/Menu.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setMenuWidth` ([L210](../src/typescript/lib/core/Menu.ts#L210)) | 210 | runtime config | yes | no | no | B-get | `getMenuWidth(): number` — return `this._menuWidth`. Not DOM-bound; no `clearX`. |
| `setExcludedElement` ([L473](../src/typescript/lib/core/Menu.ts#L473)) | 473 | runtime config (already nullable) | yes | no | accepts `null` directly | — | `null` is the documented clear signal; no `clearX` needed. Optionally add `getExcludedElement(): HTMLElement \| null`. |

### `Dialog.ts` — [src/typescript/lib/core/Dialog.ts](../src/typescript/lib/core/Dialog.ts)

All three setters (`setGlyph` at [L196](../src/typescript/lib/core/Dialog.ts#L196), `clearGlyph` at [L218](../src/typescript/lib/core/Dialog.ts#L218), `getGlyph` at [L233](../src/typescript/lib/core/Dialog.ts#L233)) already conform. No gaps.

### `WindowHeader.ts` — [src/typescript/lib/component/container/WindowHeader.ts](../src/typescript/lib/component/container/WindowHeader.ts)

Conforming for the glyph trio. `setActive` ([L158](../src/typescript/lib/component/container/WindowHeader.ts#L158)) is a composite — excluded.

### `MenuBarButton.ts` — [src/typescript/lib/component/menubar/MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts)

Conforming for glyph trio. `setActive` ([L187](../src/typescript/lib/component/menubar/MenuBarButton.ts#L187)) is a composite — excluded.

### `MenuItem.ts` — [src/typescript/lib/component/container/MenuItem.ts](../src/typescript/lib/component/container/MenuItem.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setFocused` ([L316](../src/typescript/lib/component/container/MenuItem.ts#L316)) | 316 | composite state | likely yes | no | no | composite — excluded | — |

### `HeaderCell.ts` — [src/typescript/lib/component/table/cell/Header.ts](../src/typescript/lib/component/table/cell/Header.ts)

| Setter | Line | Kind | Cached? | get? | clear? | Issue | Proposed additions |
|---|---|---|---|---|---|---|---|
| `setSortState` ([L120](../src/typescript/lib/component/table/cell/Header.ts#L120)) | 120 | inner-DOM (text + ARIA + badge) | **no** (writes to renderer + ARIA + badge directly) | no | yes ([L141](../src/typescript/lib/component/table/cell/Header.ts#L141)) | A + B-get | Add `_sortState: { state: 'asc' \| 'desc', priority: number \| null } \| null = null`. Cache before delegating; expose `getSortState(): { state: 'asc' \| 'desc', priority: number \| null } \| null`. Update `clearSortState` to also null the cache. |
| `setTooltip` ([L182](../src/typescript/lib/component/table/cell/Header.ts#L182)) | 182 | runtime config (`tooltipText` field, read elsewhere) | yes | no | no | B-get | `getTooltip(): string` — return `this.tooltipText`. Not DOM-bound today; no `clearX`. |

### Other files audited — no offenders

- [`Panel.ts`](../src/typescript/lib/core/Panel.ts): no setters of its own.
- [`Body.ts`](../src/typescript/lib/core/Body.ts): no setters of its own.
- [`Notification.ts`](../src/typescript/lib/core/Notification.ts): no setters.
- [`Tooltip.ts`](../src/typescript/lib/core/Tooltip.ts): no setters.
- [`Button.ts`](../src/typescript/lib/component/button/Button.ts): the `pressed*` / `hover*` / `glyph` setter families all conform (`get` + `set` + `clear` triples added by the prior plan).
- [`Checkbox.ts`](../src/typescript/lib/component/input/Checkbox.ts), [`Tree.ts`](../src/typescript/lib/component/tree/Tree.ts), [`Table.ts`](../src/typescript/lib/component/table/Table.ts): only data/runtime setters, all excluded.

---

## Public API (TypeScript Signatures)

### `Component` — new caches, getters, and clears

```typescript
class Component<TOptions extends ComponentOptions = ComponentOptions> extends BaseObject {

    // -------- New cached fields (Issue A) --------
    private _outline:      string | null = null;
    private _appearance:   string | null = null;
    private _borderImage:  string | null = null;
    private _transform:    string | null = null;
    private _opacity:      number | null = null;

    // -------- Issue A: setters write the cache before the DOM --------
    // (existing setters; bodies gain `this._X = value;` before the existing setElementCSSRule call)
    setOutline(outline: string): this;
    setAppearance(value: string): this;
    setBorderImage(value: string): this;
    setTransform(value: string): this;
    setOpacity(value: number): this;

    // -------- Issue A: new getters --------
    getOutline():     string | null;
    getAppearance():  string | null;
    getBorderImage(): string | null;
    getTransform():   string | null;
    getOpacity():     number | null;

    // -------- Issue B: missing clears on already-cached setters --------
    clearColorScheme():     this;
    clearCursor():          this;
    clearVerticalAlign():   this;
    clearPosition():        this;
    clearOverflow():        this;
    clearOverflowX():       this;
    clearOverflowY():       this;
    clearContain():         this;
    clearPointerEvents():   this;
    clearUserSelect():      this;

    // -------- Issue B: missing getters on already-cached setters --------
    getPointerEvents(): string | null;
    getUserSelect():    string | null;

    // -------- whiteSpace promotion from Text to Component --------
    // (Component already declares the private whiteSpace field; promote the setter.)
    getWhiteSpace():    string | null;
    setWhiteSpace(value: string): this;
    clearWhiteSpace():  this;
}
```

### `Text` — close the textOverflow + whiteSpace gaps; defer the font-property clears

```typescript
class Text extends Component {

    // -------- New cached field --------
    private _textOverflow: string | null = null;

    // -------- Setter caches; getter + clear added --------
    setTextOverflow(value: string): this;
    getTextOverflow():  string | null;
    clearTextOverflow(): this;

    // setWhiteSpace removed from this class — promoted to Component (see above).

    // -------- Issue B: missing clear on cached setter --------
    clearTextShadow(): this;

    // Font-property clears (clearFontFamily, clearFontKerning, clearFontWeight,
    // clearFontStyle, clearFontVariant, clearFontStretch, clearFontSizeAdjust,
    // clearTextAlign) — DEFERRED to a follow-up plan; no demonstrated caller need.
}
```

### `TextInput` — placeholder + maxLength clears

```typescript
class TextInput extends Input {
    clearPlaceholder(): this;   // removeElementAttribute("placeholder")
    clearMaxLength():   this;   // removeElementAttribute("maxlength")
    // setReadOnly stays as-is (non-nullable boolean; convention exempts it).
}
```

### `TextArea` — rows / cols / wrap clears

```typescript
class TextArea extends TextInput {
    clearRows(): this;   // removeElementAttribute("rows")
    clearCols(): this;   // removeElementAttribute("cols")
    clearWrap(): this;   // removeElementAttribute("wrap")
}
```

### `RadioButton` — radioName clear

```typescript
class RadioButton extends Input {
    clearRadioName(): this;
}
```

### `Window` — getResizeFps

```typescript
class Window extends Panel {
    getResizeFps(): number;
}
```

### `Menu` — getMenuWidth + getExcludedElement

```typescript
class Menu extends Panel {
    getMenuWidth():        number;
    getExcludedElement():  HTMLElement | null;
}
```

### `HeaderCell` — cached sort state + tooltip getter

```typescript
class HeaderCell extends DefaultCell {
    private _sortState: { state: 'asc' | 'desc', priority: number | null } | null = null;

    setSortState(state: 'asc' | 'desc', priority?: number | null): this;
    getSortState():  { state: 'asc' | 'desc', priority: number | null } | null;
    clearSortState(): this;     // (already exists; updated to clear _sortState)

    getTooltip(): string;
}
```

---

## Ordered Implementation Steps

Each step compiles cleanly. File order is bottom-up: most-foundational class first, dependents after.

### Step 1 — `Component.ts` Issue A fixes

1. Add the five new private fields: `_outline`, `_appearance`, `_borderImage`, `_transform`, `_opacity` (alongside `_willChange` at [L176](../src/typescript/lib/core/Component.ts#L176)).
2. Cache-then-delegate in five existing setters: `setOutline`, `setAppearance`, `setBorderImage`, `setTransform`, `setOpacity`.
3. Add five matching getters: `getOutline`, `getAppearance`, `getBorderImage`, `getTransform`, `getOpacity`.
4. Update the four existing clear methods (`clearOutline`, `clearAppearance`, `clearBorderImage`, `clearTransform`, `clearOpacity`) to also null the cache.

Verify: `npm run typecheck` — clean.

### Step 2 — `Component.ts` Issue B clears (no field work)

Add the ten missing clear methods, each writing `setElementCSSRule(<key>, null)` or `setElementStyle(<key>, null)` and clearing the existing cache field:

- `clearColorScheme`, `clearCursor`, `clearVerticalAlign`, `clearPosition`, `clearOverflow`, `clearOverflowX`, `clearOverflowY`, `clearContain`, `clearPointerEvents`, `clearUserSelect`.

Add the two missing getters: `getPointerEvents`, `getUserSelect`.

Verify: `npm run typecheck` — clean.

### Step 3 — `Component.ts` whiteSpace promotion

Move `setWhiteSpace` from `Text` ([Text.ts:743](../src/typescript/lib/component/input/Text.ts#L743)) to `Component`. The private `whiteSpace` field at [Component.ts:190](../src/typescript/lib/core/Component.ts#L190) is already there but unused for setter caching. Wire the setter to cache before delegating.

Add `getWhiteSpace(): string | null` and `clearWhiteSpace(): this` on `Component`.

Verify: `grep -rn 'setWhiteSpace' src/typescript --include='*.ts'` — every existing call site still compiles because `Text extends Component`. Run `npm run typecheck`.

### Step 4 — `Text.ts` textOverflow fix + textShadow clear

1. Add `_textOverflow: string | null = null`.
2. `setTextOverflow` caches before delegating.
3. Add `getTextOverflow(): string | null` and `clearTextOverflow(): this`.
4. Remove the `Text#setWhiteSpace` override (promoted to `Component` in Step 3).
5. Add `clearTextShadow(): this` (writes `setElementCSSRule("textShadow", null)` and clears `_options.textShadow`).

Verify: `npm run typecheck`.

### Step 5 — `TextInput.ts` and `TextArea.ts` clears

`TextInput.ts`:
- Add `clearPlaceholder(): this` — `this._options.placeholder = undefined; this.removeElementAttribute("placeholder")`.
- Add `clearMaxLength(): this` — `this._options.maxLength = undefined; this.removeElementAttribute("maxlength")`.

`TextArea.ts`:
- Add `clearRows(): this`, `clearCols(): this`, `clearWrap(): this` — each clears `_options.X` and removes the attribute.

Verify: `npm run typecheck`.

### Step 6 — `RadioButton.ts`, `Window.ts`, `Menu.ts` getters

- `RadioButton#clearRadioName(): this`.
- `Window#getResizeFps(): number`.
- `Menu#getMenuWidth(): number`, optionally `Menu#getExcludedElement(): HTMLElement | null`.

Verify: `npm run typecheck`.

### Step 7 — `HeaderCell.ts` sort-state cache + tooltip getter

1. Add `private _sortState: { state: 'asc' | 'desc', priority: number | null } | null = null`.
2. `setSortState` caches `this._sortState = { state, priority: priority ?? null }` before its existing DOM writes.
3. `clearSortState` adds `this._sortState = null` to its existing body.
4. Add `getSortState()` returning `this._sortState`.
5. Add `getTooltip(): string` returning `this.tooltipText`.

Verify: `npm run typecheck`.

### Step 8 — Final verification

- `npm run typecheck` — zero errors.
- `npm run build:lib` and `npx vite build` — clean.
- `npm run docs:build` — zero errors, zero new link warnings. New `getX` / `clearX` methods appear under their typedoc class pages.
- `graphify update . --directed` — refresh the graph.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — Steps 1, 2, 3 |
| Modify | [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — Step 4 |
| Modify | [src/typescript/lib/component/input/TextInput.ts](../src/typescript/lib/component/input/TextInput.ts) — Step 5 |
| Modify | [src/typescript/lib/component/input/TextArea.ts](../src/typescript/lib/component/input/TextArea.ts) — Step 5 |
| Modify | [src/typescript/lib/component/input/RadioButton.ts](../src/typescript/lib/component/input/RadioButton.ts) — Step 6 |
| Modify | [src/typescript/lib/core/Window.ts](../src/typescript/lib/core/Window.ts) — Step 6 |
| Modify | [src/typescript/lib/core/Menu.ts](../src/typescript/lib/core/Menu.ts) — Step 6 |
| Modify | [src/typescript/lib/component/table/cell/Header.ts](../src/typescript/lib/component/table/cell/Header.ts) — Step 7 |
| Create | none |
| Delete | none |

---

## Verification

1. **Type check:** `npm run typecheck` — zero errors after each step and at the end.
2. **Library + demo build:** `npm run build:lib` and `npx vite build` — clean.
3. **Docs build:** `npm run docs:build` — zero errors, zero new link warnings. The typedoc-generated pages for `Component`, `Text`, `TextInput`, `TextArea`, `RadioButton`, `Window`, `Menu`, `HeaderCell` show the new `getX` / `clearX` pairs.
4. **Grep invariant — every setter that writes to the DOM has a paired getter:**

   ```
   grep -rnE "^\s*set[A-Z][a-zA-Z]+\s*\(" src/typescript/lib --include='*.ts'
   ```

   For each hit, verify a sibling `get*` exists in the same file (or an inherited one from `Component`). The audit table above is the manual baseline; the grep is the regression check.

5. **Grep invariant — every nullable-style setter has a `clearX`:**

   ```
   grep -rnE "^\s*set[A-Z][a-zA-Z]+\(.*:\s*[A-Za-z]+\s*\|\s*null" src/typescript/lib --include='*.ts'
   ```

   Each match should have a `clearX` companion or be flagged as a data-bearing carve-out (`setValue`, `setRecord`, `setStore`, `setPrecision`).

6. **Manual smoke walk:** `npm run dev`, open each demo panel, confirm no visual regression. Particular attention to:
   - `MiscPanel` table sort indicator (uses `HeaderCell#setSortState`/`clearSortState`).
   - `FieldDecorator` validation flow (uses `Component#setOutline` / `clearOutline`).
   - `ProgressBar` / `ProgressSpinner` (use `setAnimation` / `clearAnimation` — already conforming, regression check).
   - Window drag (uses `Component#setWillChange` — regression check that the existing cached-field pattern still works).

7. **Refresh the knowledge graph:** `graphify update . --directed`.

---

## Documentation Impact

All additions are method-level on existing classes. Typedoc regenerates the per-class pages automatically; the new `getX` / `clearX` symbols appear under each class's API page. No new entry-point barrels, no new sidebar items.

The `Text#setWhiteSpace` → `Component#setWhiteSpace` promotion is a documentation-level move, not a breaking change — `Text` still exposes the inherited method. JSDoc on the promoted `Component#setWhiteSpace` should state "previously declared on `Text`; promoted because the property has no Text-specific semantics."

No `XOptions` interface changes — all new fields are runtime-only (the audit deliberately stays out of the constructor-options surface, per the Non-Goals).

---

## Potential Challenges

- **`setTransform` and `setTranslate` interaction.** `Component#setTransform` writes the `transform` CSS rule ([L1290](../src/typescript/lib/core/Component.ts#L1290)). `Component#setTranslate` writes `transform` inline ([L1858](../src/typescript/lib/core/Component.ts#L1858)). The new `_transform` cache reflects the rule, not the inline — `getTransform()` returns the last `setTransform` value, even if `setTranslate` has overlaid an inline rule. Document this in the `getTransform` JSDoc explicitly.
- **`whiteSpace` promotion subtlety.** `Component#applyStyle` ([L2326](../src/typescript/lib/core/Component.ts#L2326)) already reads `this.whiteSpace` to apply on re-render. Promoting `setWhiteSpace` to `Component` and wiring it to cache into `this.whiteSpace` aligns the read and write sides for the first time. Audit `applyStyle` after the move to confirm the existing block still does the right thing (it should — same field, same property, the only change is who writes it).
- **`HeaderCell#setSortState` cache shape.** The current `setSortState` signature passes a separate `priority` arg. The cache stores them together as a `{ state, priority }` object — first-class type. Consider whether to keep `priority` as `number | null | undefined` in the cache; the proposed shape normalises `undefined` and `null` to `null` for cleaner JSON serialisation.
- **Font-property `clearX` family deferred.** `Text#clearFontFamily`, `clearFontWeight`, etc. could be added for symmetry, but no current caller needs them. Adding eight methods purely for shape is speculation. Defer; surface as a separate follow-up if a caller ever wants "revert to theme default".
- **`Slider#setValue` and friends.** These look like B-clear gaps but are data setters with intrinsic defaults — convention exempts them. The audit table flags them so a future reader doesn't re-open the question; the implementation skips them.
- **Underscore-prefix naming inconsistency.** The new fields use `_X`, the older private fields use bare `X`. Documented in Architecture Decisions; a future rename pass is out of scope here.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — the bulk of the work. Read the existing `_willChange` field ([L176](../src/typescript/lib/core/Component.ts#L176)) and the `setContain` / `setAnimation` / `clearAnimation` triple ([L1999-L2051](../src/typescript/lib/core/Component.ts#L1999)) as the reference shape. Also read `applyStyle` ([L2242](../src/typescript/lib/core/Component.ts#L2242)) before touching `setWhiteSpace` — it reads `this.whiteSpace` directly.
- [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — second-largest setter surface. The existing `setWordBreak` / `getWordBreak` ([L754-L774](../src/typescript/lib/component/input/Text.ts#L754)) and `setLineClamp` / `getLineClamp` / `clearLineClamp` ([L781-L833](../src/typescript/lib/component/input/Text.ts#L781)) are the local reference.
- [plans/implemented/typed-style-setters-and-clear-api.md](implemented/typed-style-setters-and-clear-api.md) — the convention this plan inherits. Re-read the CR9 naming-convention table and the "non-nullable + no clear" carve-out before implementing.
- [src/typescript/lib/component/table/cell/Header.ts](../src/typescript/lib/component/table/cell/Header.ts) — the `HeaderCell` setSortState cache is the only Issue-A case that doesn't write through `setElement*`. The pattern still applies (cache before DOM-side write), but the DOM-side writes are spread across the renderer's Text, the ARIA helper, and a raw priority badge `<span>`. Three distinct write paths; one cache.

---

## Non-Goals

- **No `XOptions` interface changes.** New fields stay runtime-only (`_outline`, `_appearance`, `_borderImage`, `_transform`, `_opacity`, `_textOverflow`, `_sortState`). Promoting them to `ComponentOptions` / `TextOptions` / `HeaderCellOptions` is a separate design decision tied to the constructor-options refactor and out of scope here.
- **No call-site changes.** Setter bodies gain a cache write; nothing about how callers invoke the setters changes. No grep-and-replace sweeps across the codebase.
- **No `clearX` on non-nullable / non-style / data-bearing setters.** `setSelected` (Checkbox / Option / RadioButton), `setValue` (Slider / NumberSpinner / DateField / TimeField / TextInput / ComboBox / Checkbox), `setText`, `setSize`, `setWidth`, `setHeight`, `setX`, `setY`, `setMinSize`, `setMaxSize`, `setPreferredSize`, `setZIndex`, `setVisible`, `setDisplayed`, `setEnabled` all stay as-is per the convention's carve-out.
- **No font-property `clearX` family on `Text`.** Speculative without a demonstrated caller. Deferred to a follow-up if and when one appears.
- **No underscore-prefix rename of existing private fields.** Out of scope; that's a separate consistency pass.
- **No setter-body refactors past the cache write.** E.g. don't switch `setOutline`'s `setElementCSSRule` call to a `setElementCSSRules` batch, don't fold the `_appearance` writes into a single `setElementCSSRule` call.
