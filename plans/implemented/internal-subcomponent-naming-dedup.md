# Dedicated Subclasses for Anonymous Internal Struts — Implementation Plan

## Overview

The live Style Audit panel (`packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts`) reported three duplicate-CSS rows with `component: "—"` — a `Slider`'s thumb, and a `Toggle`'s track and thumb — plus a 145-instance duplicate row for `ListItem`'s marker. All four findings trace to the same underlying gap: an internal visual strut built as a bare `new Component()` (or, for the marker, a bare `new Text(...)`) never gets a class name of its own, so its chrome can never be hoisted into a shared class-tier CSS rule and instead repeats on every instance's own `#id` rule.

This plan gives each strut its own tiny, file-local subclass — [`packages/lib/src/typescript/lib/component/input/Slider.ts`](../packages/lib/src/typescript/lib/component/input/Slider.ts) (thumb, track, active-track), [`packages/lib/src/typescript/lib/component/input/Toggle.ts`](../packages/lib/src/typescript/lib/component/input/Toggle.ts) (track, thumb), and [`packages/lib/src/typescript/lib/component/list/ListItem.ts`](../packages/lib/src/typescript/lib/component/list/ListItem.ts) (marker) — mirroring three precedents already in the codebase: `ScrollArrowButton`/`ScrollbarThumb` in [`Scrollbar.ts`](../packages/lib/src/typescript/lib/component/container/Scrollbar.ts), `CheckboxBox` in [`Checkbox.ts`](../packages/lib/src/typescript/lib/component/input/Checkbox.ts), and `NumberRendererText` in [`Number.ts`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts). No public API changes: every new class stays file-local and unexported, exactly like its three precedents.

---

## Architecture Decisions

### A dedicated constructor is structurally required, not a naming nicety

Giving each strut its own subclass is the only way to make it resolvable and dedupable — not a cosmetic choice.[^structural-gap]

### No `getClassStyleDefaults()` override — `subclassDefaults` alone is enough

`ScrollArrowButton` and `ScrollbarThumb` (`Scrollbar.ts:178`, `:411`) are both `extends Component` with no `getClassStyleDefaults()` override; each just forwards a `_default<Name>Options` bag as the constructor's second (`subclassDefaults`) argument. The five new plain-`Component` struts (`SliderThumb`, `SliderTrack`, `SliderActiveTrack`, `ToggleTrack`, `ToggleThumb`) follow the same shape.

### Toggle's "on" track fill is a declared state, not an instance override

`ToggleTrack`'s resting (off) `backgroundColor` is a class default; the checked (on) `backgroundColor` is a `protected static readonly ownStyleStates` `.selected` entry, applied via `setStyleState`. This mirrors `CheckboxBox` (`Checkbox.ts:52`–`118`), which does exactly this for its own checked-state background and border.[^toggle-state]

### Only genuinely CSS-hoistable fields move into `subclassDefaults`

A field moves into a strut's `_default<Name>Options` bag only when it is one of `ClassStyleRules.ts`'s `StyleBag` keys (`backgroundColor`, `borderRadius`, `border`, `shadow`, `cursor`, `minSize`, `maxSize`, …). Everything else — `preferredSize`, `pointerEvents`, `transform`, `transition`, and all `setX`/`setY`/`setSize` geometry — stays exactly as an imperative constructor call, unchanged from today.[^non-stylebag-fields]

### Slider's track and active-track are swept in

`Slider._track` and `Slider._activeTrack` (`Slider.ts:87`–`98`) have the identical bare-`Component` gap as the thumb, in the same file, but didn't happen to rank as a duplicate in the captured audit. Fixing only the thumb would leave the same gap to be independently rediscovered later. Two more trivial classes (~10 lines total, same shape as the thumb) is small added surface for one coherent pass over `Slider.ts` instead of two across two plans.[^progressbar-out]

### ListItemMarkerText mirrors NumberRendererText

`NumberRendererText` (`Number.ts:36`–`48`) is the existing, working pattern for a `Text`-family strut whose alignment deviates from `Text`'s own class default: an `ownClassStyleDefaults.font` override (spread over the parent's own font bag) *plus* the identical value forwarded through `subclassDefaults`, so the real applied value and the CSS class-tier default agree. `ListItemMarkerText` (in `ListItem.ts`) copies this shape exactly, replacing `ListItem.ts:80`'s `new Text(undefined, { textAlign: "right" })`.

---

## Public API

No public API changes. All six new classes (`SliderThumb`, `SliderTrack`, `SliderActiveTrack`, `ToggleTrack`, `ToggleThumb`, `ListItemMarkerText`) are file-local — declared and used inside the same file as their owner, never exported from a barrel — matching `ScrollArrowButton`, `ScrollbarThumb`, `CheckboxBox`, and `NumberRendererText`.

---

## Internal Structure

### `Slider.ts`

Insert before the `Slider` class (after `_defaultSliderOptions`):

```typescript
const _defaultSliderTrackOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-slider-track-bg, rgb(220, 220, 220))",
    borderRadius:    "999px",
};

class SliderTrack extends Component {
    constructor() {
        super(undefined, _defaultSliderTrackOptions);
    }
}

const _defaultSliderActiveTrackOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-slider-track-active-bg, rgb(30, 100, 200))",
    borderRadius:    "999px",
};

class SliderActiveTrack extends Component {
    constructor() {
        super(undefined, _defaultSliderActiveTrackOptions);
    }
}

const _defaultSliderThumbOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-slider-thumb-bg, rgb(255, 255, 255))",
    borderRadius:    "50%",
    border:          "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))",
    shadow:          "0 1px 2px rgba(0, 0, 0, 0.25)",
    maxSize:         { width: THUMB_SIZE, height: THUMB_SIZE },
};

class SliderThumb extends Component {
    constructor() {
        super(undefined, _defaultSliderThumbOptions);
    }
}
```

`Slider`'s constructor body (`Slider.ts:87`–`107`) becomes:

```typescript
this._track = new SliderTrack();
this._track.setPointerEvents("none");

this._activeTrack = new SliderActiveTrack();
this._activeTrack.setPointerEvents("none");

this._thumb = new SliderThumb();
this._thumb.setPreferredSize({ width: THUMB_SIZE, height: THUMB_SIZE });
this._thumb.setPointerEvents("none");
```

The old `setBackgroundColor`/`setBorderRadius`/`setBorder`/`setShadow`/`setMaxSize` calls on `_track`, `_activeTrack`, and `_thumb` are all dropped — each value now lives in the matching class's `_default*Options` bag instead.

Field declarations (`Slider.ts:67`–`69`) narrow from `Component` to the new types: `private _track: SliderTrack; private _activeTrack: SliderActiveTrack; private _thumb: SliderThumb;` — mirroring `Scrollbar._thumb: ScrollbarThumb` (`Scrollbar.ts:509`).

### `Toggle.ts`

Insert before the `Toggle` class (after `_defaultToggleOptions`):

```typescript
const _defaultToggleTrackOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-toggle-track-bg-off, rgb(200, 200, 200))",
    borderRadius:    "999px",
    minSize:         { width: 36, height: 20 },
    maxSize:         { width: 36, height: 20 },
    cursor:          "pointer",
};

/** `.selected`'s backgroundColor declaration (the "on" fill), read by `ownStyleStates`' `.selected` entry — mirrors `CheckboxBox`'s `CHECKBOX_SELECTED_DECLARATIONS`. */
const TOGGLE_TRACK_SELECTED_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-toggle-track-bg-on, rgb(30, 100, 200))",
});

class ToggleTrack extends Component {
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".selected",
            extract: (): StyleBag => ({ backgroundColor: TOGGLE_TRACK_SELECTED_DECLARATIONS.backgroundColor }),
        },
    ];

    private _checked: boolean = false;

    constructor() {
        super(undefined, _defaultToggleTrackOptions);
    }

    /** Applies the checked visual state. The `.selected` background comes from
     *  `ownStyleStates` above, resolved onto the shared class-tier rule. */
    applySelected(checked: boolean): void {
        this._checked = checked;
        this.setStyleState(".selected", checked);
    }

    /** Re-applies the cached checked state at render, for a state set before mount. */
    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { selected: this._checked } });
        return element;
    }
}

const _defaultToggleThumbOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-toggle-thumb-bg, rgb(255, 255, 255))",
    borderRadius:    "999px",
    maxSize:         { width: 16, height: 16 },
    shadow:          "0 1px 2px rgba(0, 0, 0, 0.25)",
};

class ToggleThumb extends Component {
    constructor() {
        super(undefined, _defaultToggleThumbOptions);
    }
}
```

`Toggle`'s constructor body (`Toggle.ts:59`–`86`) becomes:

```typescript
this._track = new ToggleTrack();
this._track.setPreferredSize({ width: 36, height: 20 });

this._thumb = new ToggleThumb();
this._thumb.setPreferredSize({ width: 16, height: 16 });
this._thumb.setSize({ width: 16, height: 16 });
this._thumb.setX(2);
this._thumb.setY(2);
this._thumb.setPointerEvents("none");
```

The old `setBackgroundColor`/`setBorderRadius`/`setMaxSize`/`setShadow` calls on `_track` and `_thumb` are dropped the same way — each value now lives in `_defaultToggleTrackOptions`/`_defaultToggleThumbOptions`. The `setCursor("pointer")` call on `_track` is also dropped (folded into `_defaultToggleTrackOptions.cursor`).

Keep the existing explanatory comments (why the track owns the click surface, why min=preferred=max, why the thumb is pointer-events:none) — move each one to sit above whichever line now carries that concern (the `cursor` key's comment moves to sit above `_defaultToggleTrackOptions`; the size-clamp comment moves to sit above `this._track.setPreferredSize(...)`).

`Toggle.applyValue` (`Toggle.ts:298`–`308`) replaces the direct background-color write:

```typescript
private applyValue(value: boolean): void {
    this.getAria().setChecked(value);
    this._thumb.setTransform(value ? "translateX(16px)" : "translateX(0px)");
    this._track.applySelected(value);
}
```

Field declarations (`Toggle.ts:39`–`40`) narrow to `private _track: ToggleTrack; private _thumb: ToggleThumb;`.

### `ListItem.ts`

Insert before the `ListItem` class:

```typescript
const LIST_ITEM_MARKER_TEXT_ALIGN = "right";

const _defaultListItemMarkerTextOptions: Partial<TextOptions> = {
    textAlign: LIST_ITEM_MARKER_TEXT_ALIGN,
};

/**
 * The marker text for a {@link ListItem} — every marker in a list renders
 * right-aligned by default, so without a shared class rule every item's
 * marker would carry an identical `text-align: right` declaration on its own
 * `#id` rule. Mirrors `NumberRendererText`
 * (component/table/cell/renderer/Number.ts).
 */
class ListItemMarkerText extends Text {
    protected static readonly ownClassStyleDefaults: StyleBag = {
        font: {
            ...Text.ownClassStyleDefaults.font,
            textAlign: LIST_ITEM_MARKER_TEXT_ALIGN,
        },
    };

    constructor() {
        super(undefined, undefined, _defaultListItemMarkerTextOptions);
    }
}
```

`ListItem.ts:80` changes from `this._marker = new Text(undefined, { textAlign: "right" });` to `this._marker = new ListItemMarkerText();`. The `_marker` field stays typed `Text` (matching `NumberRenderer._text: Text`, which likewise holds a `NumberRendererText` instance without narrowing the field type).

---

## Ordered Implementation Steps

1. **`Slider.ts`**: add `ComponentOptions` to the existing `Component` import. Insert `SliderTrack`, `SliderActiveTrack`, `SliderThumb` and their `_default*Options` constants before the `Slider` class, per Internal Structure above. Update the constructor body and narrow the three field types. → verify: `npx tsc --noEmit` in `packages/lib` compiles clean.
2. **`Toggle.ts`**: add `ComponentOptions` to the existing `Component` import; add `import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";`; add `import { DOM, type Handle } from "~/core/DOM.js";`. Insert `ToggleTrack`, `ToggleThumb`, and `TOGGLE_TRACK_SELECTED_DECLARATIONS` before the `Toggle` class. Update the constructor body, `applyValue`, and narrow the two field types. → verify: `npx tsc --noEmit` compiles clean.
3. **`ListItem.ts`**: add `import type { StyleBag } from "~/core/ClassStyleRules.js";`; add `TextOptions` to the existing `Text` import. Insert `ListItemMarkerText` and its constants before the `ListItem` class. Change line 80's construction call. → verify: `npx tsc --noEmit` compiles clean.
4. **`grep -rn 'new Component()' packages/lib/src/typescript/lib/component/input/Slider.ts packages/lib/src/typescript/lib/component/input/Toggle.ts`** — expect zero matches (every bare-`Component()` construction in these two files is now a named subclass).
5. **`packages/lib/tests/component/default-options-fallback.test.ts`**: add one row per moved `StyleBag` field, next to the existing `Slider`/`Toggle`/`ListItem` rows (~line 330 for the `ScrollbarThumb` precedent, ~445–447 for `Toggle`/`Slider`, ~350 for `ListItem`), following the exact `{ label, resolve, expected }` shape already used there:
   - `SliderTrack backgroundColor`, `SliderTrack borderRadius`
   - `SliderActiveTrack backgroundColor`, `SliderActiveTrack borderRadius`
   - `SliderThumb backgroundColor`, `SliderThumb borderRadius`, `SliderThumb border` (expected `{ border: "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))" }`, matching `getBorder()`'s string-normalisation), `SliderThumb shadow`, `SliderThumb maxSize` (via `getMaxSizeConstraint()`, expected `{ width: 16, height: 16 }`, mirroring the `ScrollArrowGlyph minSize` row's `getMinSizeConstraint()` shape)
   - `ToggleTrack backgroundColor (off)`, `ToggleTrack borderRadius`, `ToggleTrack cursor`, `ToggleTrack maxSize`
   - `ToggleThumb backgroundColor`, `ToggleThumb borderRadius`, `ToggleThumb shadow`, `ToggleThumb maxSize`
   - `ListItemMarkerText textAlign` (via `(new ListItem('k','v') as any)._marker.getTextAlign()`, expected `"right"`)
   → verify: `npx vitest run tests/component/default-options-fallback.test.ts`.
6. **`packages/lib/tests/component/input/Slider.test.ts`**: add a `describe('SliderTrack/SliderActiveTrack/SliderThumb class-rule hoisting', ...)` block mirroring `Scrollbar.test.ts`'s row-2 test (`Scrollbar.test.ts:516`–`528`) — copy its `idSelector`/`declarationsDuring` helpers, import `_ruleCacheHas` from `~/core/StyleTarget`, and assert that a rendered `Slider`'s track/active-track/thumb `#id` rules carry no static `backgroundColor`/`borderRadius` declaration while `_ruleCacheHas('.SliderTrack')`, `_ruleCacheHas('.SliderActiveTrack')`, and `_ruleCacheHas('.SliderThumb')` are all `true`. → verify: `npx vitest run tests/component/input/Slider.test.ts`.
7. **`packages/lib/tests/component/input/Toggle.test.ts`**: add a `describe('ToggleTrack/ToggleThumb class-rule hoisting', ...)` block with the same shape, plus a `.selected` state-hoisting case mirroring `Scrollbar.test.ts`'s `ScrollbarThumb hover state-class hoisting` block (`Scrollbar.test.ts:536`–`587`): construct two `Toggle`s, set the first's value to `true` to warm `.ToggleTrack.selected`, then assert the second's `#id.selected` rule carries no `backgroundColor` while `_ruleCacheHas('.ToggleTrack.selected')` is `true`. Also assert a `Toggle` constructed with `{ value: true }` shows the `selected` DOM class on its track element immediately after `getElement(true)` (pre-render state survives to first paint). → verify: `npx vitest run tests/component/input/Toggle.test.ts`.
8. Run the full lib suite and the project's typecheck: `npm run test` and `npm run typecheck` (or the project's equivalent scripts) from `packages/lib`. → verify: zero failures, zero new errors.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Toggle.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/ListItem.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/component/input/Slider.test.ts` |
| Modify | `packages/lib/tests/component/input/Toggle.test.ts` |

---

## Expected Behaviour

1. A rendered `Slider`'s track, active-track, and thumb elements each carry their own class name (`SliderTrack`, `SliderActiveTrack`, `SliderThumb`) in their `class` attribute, alongside `ts-ui-component` — resolvable by `StyleAudit.ts`'s `componentNameForSelector`. **Unit-testable** via the class-rule-hoisting test in step 6.
2. A rendered `Toggle`'s track and thumb elements likewise carry `ToggleTrack` / `ToggleThumb`. **Unit-testable** via step 7.
3. None of the six new classes' `#id` rules carries a static `backgroundColor`/`borderRadius`/`border`/`shadow`/`cursor`/`maxSize`/`minSize` declaration once rendered — those live on the shared `.ClassName` rule instead. **Unit-testable** (steps 6–7).
4. A `Toggle` constructed with `value: true` (or `setValue(true)` called later) writes no `backgroundColor` to the track's own `#id.selected` rule; the shared `.ToggleTrack.selected` rule carries the "on" fill. Toggling back off reverts to the resting `.ToggleTrack` rule's off fill, with no instance-level override either way. **Unit-testable** (step 7).
5. A `Toggle` constructed with `value: true` — where `applyValue` runs inside the constructor, before the component has ever been rendered — still shows the `selected` DOM class on the track immediately after first render, because `ToggleTrack.render()` re-asserts the cached state. **Unit-testable** (step 7).
6. `ListItem`'s marker still renders right-aligned (`getTextAlign()` returns `"right"`), with no `#id`-level `text-align` declaration — the value now comes from the cascade of `.Text` + `.ListItemMarkerText` shared rules. **Unit-testable** (step 5).
7. Every existing `Slider`/`Toggle`/`ListItem` test — value transitions, geometry (`content-box-containment.test.ts`), ARIA — continues to pass unmodified: this is a pure internal refactor with no change to any public getter/setter/behaviour. **Unit-testable** (existing suites, step 8).
8. The live Style Audit demo tab no longer shows `component: "—"` for the Slider-thumb / Toggle-track / Toggle-thumb duplicate rows (they either resolve to a real name or drop out of the duplicates table entirely, since the resting declarations now live on a shared class rule instead of repeating per instance). **Manual-verify only** — open the app (`npm run dev`, `localhost:8015`) and the "Stylesheet Dedup Audit" tab (`packages/lib/src/typescript/StyleAuditPanel.ts`), place several `Slider`/`Toggle` instances on screen, and inspect the audit table.

---

## Verification

- `npx tsc --noEmit` (or the project's `npm run typecheck`) in `packages/lib` — zero errors.
- `npx vitest run` in `packages/lib` — full suite green, including the new/updated test blocks from steps 5–7 and the untouched `content-box-containment.test.ts` / `Slider.test.ts` / `Toggle.test.ts` geometry and value cases.
- `grep -rn 'new Component()' packages/lib/src/typescript/lib/component/input/Slider.ts packages/lib/src/typescript/lib/component/input/Toggle.ts` — zero matches.
- `npm run docs:api` — zero warnings (the new classes are unexported, so this should be a no-op, but confirms no accidental barrel leakage).
- Manual: the Style Audit demo tab, per Expected Behaviour item 8.

---

## Potential Challenges

- **Non-`StyleBag` fields silently lose their DOM effect if moved into `subclassDefaults`.** `pointerEvents`, `preferredSize`, `transform`, and `transition` are plain `ComponentOptions` fields, not `StyleBag` members — their setters are only dispatched by `applyOptions` when the *caller-supplied* options bag carries them (`Component.ts:727`–`731`), never from `subclassDefaults`. Moving one of these into a `_default*Options` bag would make the getter still report the right value while the actual inline style is never written. Mitigation: the Internal Structure section above lists exactly which fields move and which stay imperative — don't move anything not explicitly listed there.
- **Losing an explanatory comment.** Several of the lines being moved carry comments explaining *why* a value is set (the click-surface rationale, the min=preferred=max shrink-prevention rationale, the pointer-events pass-through rationale). Preserve each one at its new location rather than dropping it — see the note at the end of the `Toggle.ts` Internal Structure subsection.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`](../packages/lib/src/typescript/lib/component/container/Scrollbar.ts) — `ScrollArrowButton` (line 178) and `ScrollbarThumb` (line 411): the precedent for a bare-`Component` internal strut needing no `getClassStyleDefaults()` override, and for a toggled state via `ownStyleStates` (`ScrollbarThumb`'s `.hover`).
- [`packages/lib/src/typescript/lib/component/input/Checkbox.ts`](../packages/lib/src/typescript/lib/component/input/Checkbox.ts) — `CheckboxBox` (line 52): the precedent for splitting a resting class default from a toggled `ownStyleStates` entry on the *same* CSS property, which `ToggleTrack` copies.
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts`](../packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts) — `NumberRendererText` (line 36): the precedent for `ListItemMarkerText`.
- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](../packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — `getStyleClassChain`, `ensureClassStyleRule`, `ownStyleStates`/`resolveStyleStates`: the mechanism this plan works around.
- [`packages/lib/src/typescript/lib/core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts) — `init()` (~line 6781), `applyStyle()` (~line 5720), `applyOptions()` (~line 727): where the DOM class list is stamped and where `StyleBag` vs. plain-options fields diverge in how `subclassDefaults` reaches the DOM.
- [`packages/lib/tests/component/container/Scrollbar.test.ts`](../packages/lib/tests/component/container/Scrollbar.test.ts) — lines 490–587: the exact test shape (`idSelector`, `declarationsDuring`, `_ruleCacheHas`) to copy for steps 6–7.
- [`packages/lib/tests/component/default-options-fallback.test.ts`](../packages/lib/tests/component/default-options-fallback.test.ts) — the registry rows to extend in step 5.

---

## Non-Goals

- **`StyleAudit.ts` itself is not touched.** The audit tool's "—" resolution logic is correct; the gap it exposed is architectural (see Architecture Decisions), not a bug in `componentNameForSelector`.
- **`componentNameForSelector`'s "first non-`ts-ui-component` class wins" heuristic is not changed**, even though it means a rendered `ListItemMarkerText` will report as `"Text"` in the audit (its DOM class list is `["Text", "ListItemMarkerText"]`, and `.find()` picks the first token) rather than the more specific name. `NumberRendererText` already has this exact same cosmetic property today, unaddressed — this plan doesn't newly introduce it, and fixing it is a separate, StyleAudit-scoped change.
- **`ProgressBar._track`/`_fill`** (`packages/lib/src/typescript/lib/component/display/ProgressBar.ts:58`) have the identical bare-`Component` gap but are in a different file, weren't part of the reported "—" rows, and aren't touched by this fix already being made to `Slider.ts`/`Toggle.ts`/`ListItem.ts` — left for a separate pass.
- **No visual or theming change.** Every CSS custom-property token (`--ts-ui-slider-thumb-bg`, `--ts-ui-toggle-track-bg-on`, etc.) is reused verbatim; this is a pure internal restructuring of *where* the same declarations live in the stylesheet.

---

## Notes

[^structural-gap]: Two independent, confirmed mechanisms both key on the literal `this.constructor`, and every bare `new Component()` anywhere in the framework shares that same literal constructor:

    1. `getStyleClassChain` (`ClassStyleRules.ts:961`–`998`) special-cases the root: `if (ctor === _rootCtor) { return []; }`. `_rootCtor` is `Component` itself, registered once at module load (`Component.ts:6894`). So `Component.init()`'s `DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, ...getStyleClassChain(this.constructor), ...] })` (`Component.ts:6802`) adds nothing beyond `ts-ui-component` for a bare `Component` instance — the element's `class` attribute is structurally incapable of carrying a distinguishing token, which is exactly what `StyleAudit.ts`'s `componentNameForSelector` needs to resolve a name.
    2. `ensureClassStyleRule`'s `_bags` cache (`ClassStyleRules.ts:138`, `:894`–`898`) is keyed purely on `ctor`, with **no comparison against the `defaults` argument on a cache hit** — `const existing = _bags.get(ctor); if (existing !== undefined) return existing;`. This is notably *not* how its sibling `resolveClassDefaults` (`ComponentDefaults.ts:86`–`109`) behaves: that function compares the incoming `subclassDefaults` against what's cached and builds a fresh, uncached bag on a mismatch (`ComponentDefaults.ts`'s own doc comment: "a class whose `subclassDefaults` vary per instance … gets its own private frozen bag on a mismatch, without disturbing the cached entry"). `ensureClassStyleRule` has no such fallback. So whichever bare-`Component` strut is first to call `applyStyle()` anywhere in the running app permanently determines the `_classLayer` every *other* bare-`Component` instance compares its own writes against for the rest of the process — even though (per point 1) that comparison layer's hypothetical `.Component` rule can never match any element anyway. Beyond blocking dedup, this is a latent correctness hazard: `matchesLowerTier`/`flushStyleBag` (`Component.ts:4967`–`4975`) skip writing an instance declaration whenever it happens to equal the (wrong, unrelated) cached layer's value for that key — and since no rule ever actually matches "Component", a coincidental collision would silently drop a real declaration. Giving a strut its own constructor gives both mechanisms a cache key unique to that visual shape, which is the only way to opt into a working `.ClassName` rule or a correct DOM class token.

[^toggle-state]: The alternative — leaving `applyValue` calling `this._track.setBackgroundColor(...)` directly for the "on" value — would still leave that declaration duplicated per-instance on every checked `Toggle`'s own `#id` rule, which is exactly the class of waste the Style Audit measures; it would just move the duplicate from the "off" value to the "on" one instead of removing it. `CheckboxBox`'s `ownStyleStates` `.selected` entry is the established fix for precisely this shape (a resting default plus a toggled deviation on the same property), so `ToggleTrack` reuses it rather than introducing a second pattern for the same problem.

[^non-stylebag-fields]: `setPreferredSize` writes a `data-preferred-size` debug attribute and fires an `_onPreferredSizeChange` callback (`Component.ts:3029`–`3038`); `setPointerEvents` writes an inline `pointer-events` style directly (`Component.ts:4603`–`4609`). Both effects happen **only** inside the setter body, dispatched **only** by `applyOptions`'s caller-supplied-options gate (`Component.ts:727`–`731`: "Dispatch only the caller-supplied options — class-level defaults are a pure fallback consulted by the getters … never written into `_options`"). `subclassDefaults` is never passed through `applyOptions`. By contrast, every `StyleBag` field's real CSS effect comes from `Component.applyStyle()` independently calling `resolveDeclarations(this.getClassStyleDefaults())` (`Component.ts:5720`–`5738`), which *does* consult `_defaultOptions` regardless of whether any setter ever ran — proven already by `ScrollArrowGlyph`'s `minSize`/`maxSize` (`Scrollbar.ts:129`–`132`), which take effect with zero imperative `setMinSize`/`setMaxSize` call. So a `StyleBag` field is safe to move into `subclassDefaults` alone; a non-`StyleBag` field is not — it would silently stop taking effect on the real element while its getter kept reporting the (still-correct-looking) default value.

[^progressbar-out]: Sweeping `ProgressBar` in as well would mean editing a fourth, otherwise-untouched file for a gap that wasn't part of the reported audit rows — the same "how much extra surface" tradeoff argued the other way for `Slider._track`/`_activeTrack`, which share the file already being edited.
