---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/Util.ts
  - packages/lib/src/typescript/lib/core/Body.ts
  - packages/lib/src/typescript/lib/component/input/Text.ts
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
---

# Per-Class Component Defaults — Implementation Plan

## Overview

`Component._defaultOptions` ([packages/lib/src/typescript/lib/core/Component.ts:452](packages/lib/src/typescript/lib/core/Component.ts#L452)) is documented as a class-level fallback bag that nothing writes to after construction. It is neither. Every constructor builds a fresh copy — including a fresh `new Absolute()` layout manager — and three sites in `Text` write into it at runtime. A 45-column table window builds ~1,440 cell components, so ~1,440 identical bags and ~1,440 throwaway layout managers.

This plan makes the bag genuinely per class: one frozen object shared by every instance of a concrete class, cached on the class constructor. The two members that cannot be shared — the default layout manager, and the theme-derived line height `Text` caches — move out of the bag: the layout manager into a lazily-created per-instance slot, the line height into `Util`'s existing theme-invalidated metrics cache. With the line height out of the bag, `Text`'s per-instance `subscribeTheme` call disappears entirely (~1,186 subscriptions in one wide-table window, each doing a `getComputedStyle` read on every theme switch), replaced by one subscription per root component.

Release target: **library 0.3.0** (`packages/lib/package.json` currently reads `0.2.0`). This plan is the **prerequisite for a follow-up plan** that hoists class-uniform style declarations into class-scoped `.ClassName` CSS rules: that plan needs a per-class registry keyed on the concrete class, which is exactly what `core/ComponentDefaults.ts` introduces here. Three sibling plans from the same investigation are independent of this one and own their own files: the `ensureStyleRule` lookup fix, the `StyleRule` batched flush, and the class-scoped-rule hoist.

---

## Architecture Decisions

### Key the per-class cache on the class constructor, not on `constructor.name`

The cache is a `Map` keyed by `this.constructor` — the class object itself. Class *names* are not unique in this codebase and are not needed.[^ctor-key]

### The default layout manager leaves the bag and becomes a per-instance slot

`layoutManager` is stripped out of the defaults bag. `Component` gains a private `_defaultLayoutManager` slot, seeded from `subclassDefaults.layoutManager` when the subclass supplied one and otherwise filled with `new Absolute()` the first time `getLayoutManager()` needs it.[^lm-slot]

### The remaining base defaults become shared frozen module constants

`insets`, `minSize`, and `maxSize` move from per-constructor literals to frozen module-level constants. Sharing them is already the shipped pattern for subclass defaults — `_defaultHeaderOptions`, `_defaultIconLabelOptions`, `_defaultStatusBarOptions`, `_defaultDiagramNodeOptions` and others all put one `new Insets(...)` instance in a module constant that every instance of the class reads.[^shared-objects]

### The bag is frozen and typed `Readonly`

`resolveClassDefaults` returns `Object.freeze(...)`, and `Component._defaultOptions` is typed `Readonly<TOptions>`. The freeze turns the "nothing writes to it" convention into a runtime throw, and the type turns it into a compile error.[^freeze]

### A subclass whose defaults vary per instance falls back to a private bag

The cache stores the first bag built for a class. A later instance of that class whose `subclassDefaults` differ gets its own fresh frozen bag instead of the cached one; the cached entry is never replaced. This is needed because four shipped classes derive their subclass defaults from constructor arguments.[^varying-defaults]

The comparison is shallow, over the keys of the incoming `subclassDefaults` (ignoring `layoutManager`, which never enters the bag):

| Construction sequence | `subclassDefaults` seen | Result |
|---|---|---|
| `new StringCell(...)` ×1,440 | same module constant each time | 1,439 cache hits — one shared frozen bag |
| `Glyph("user")` then `Glyph("check")` | `{…, tag:"span"}` both times | hit — one shared bag |
| `Glyph("user")` then `Glyph("chart-line-svg")` | `{…, tag:"span"}` then `{…, tag:"svg"}` | miss — the SVG glyph gets a private frozen bag |
| `Panel({})` then `Panel({flush:true})` | `insets` differs | miss — the flush panel gets a private frozen bag |
| `IconText("a","b")` ×N | `layoutManager` differs, nothing else | hit — `layoutManager` is excluded from the comparison |

### `Text` drops its theme subscription; its theme-derived numbers move into `Util`'s metrics cache

`Text` stops calling `subscribeTheme`. The two numbers its callback re-resolved move to `Util`, which already owns a family of theme-derived cached numbers (`linePaddingCache`, `rootFontSizeCache`, `textBaselineCache`, `opticalOffsetCache`) cleared by one `Util.invalidateTextMetricsCache()` call that `ThemeManager.reflowText()` already makes.[^util-precedent] The re-measure the callback triggered becomes lazy, driven by a generation counter on the same cache.

### One reflow subscription per root component replaces the per-`Text` ones

`Body` and `AbstractWindow` each call `subscribeTheme(...)` to `scheduleLayout()` on themselves. That is one subscription for the page plus one per floating window, in place of one per `Text`.[^root-reflow]

---

## Public API

No consumer-facing export changes. `core/ComponentDefaults.ts` is internal and **must not** be added to `packages/lib/src/typescript/lib/core/index.ts`.

Internal signatures the implementer writes:

```typescript
// core/ComponentDefaults.ts
export function resolveClassDefaults<TOptions>(
    ctor:             Function,
    subclassDefaults: Partial<TOptions> | undefined,
): Readonly<TOptions>;
```

```typescript
// core/Component.ts — changed member types
protected _defaultOptions!: Readonly<TOptions>;
private   _defaultLayoutManager: LayoutManager | null;
```

```typescript
// core/Util.ts — additions to the existing namespace
export function textMetricsGeneration(): number;
export function boundFontSizePx(cssVar: string, cssRule: string | null): number | null;
```

`Util.textMetricsGeneration` and `Util.boundFontSizePx` are new members of the already-exported `Util` namespace, so they do render in the API docs.

---

## Internal Structure

### `core/ComponentDefaults.ts`

```typescript
const ZERO_INSETS    = Object.freeze(new Insets(0, 0, 0, 0));
const ZERO_MIN_SIZE  = Object.freeze({ width: 0,         height: 0 });
const UNBOUNDED_MAX  = Object.freeze({ width: UNBOUNDED, height: UNBOUNDED });

const BASE_DEFAULTS = Object.freeze({
    cursor   : "default",
    insets   : ZERO_INSETS,
    minSize  : ZERO_MIN_SIZE,
    maxSize  : UNBOUNDED_MAX,
    overflow : "hidden",   // keep Component.ts:504-511's comment with this field
    zIndex   : 0,
    displayed: true,
});

interface CacheEntry { bag: object; keys: string[]; }

const cache = new Map<Function, CacheEntry>();

export function resolveClassDefaults<TOptions>(
    ctor: Function,
    subclassDefaults: Partial<TOptions> | undefined,
): Readonly<TOptions> {
    const supplied = subclassDefaults ?? {};
    const keys     = Object.keys(supplied).filter(k => k !== "layoutManager");
    const entry    = cache.get(ctor);

    if (entry && matches(entry, supplied, keys)) {
        return entry.bag as Readonly<TOptions>;
    }

    const bag: Record<string, unknown> = { ...BASE_DEFAULTS };
    for (const key of keys) {
        bag[key] = (supplied as Record<string, unknown>)[key];
    }
    Object.freeze(bag);

    if (!entry) {
        cache.set(ctor, { bag, keys });
    }

    return bag as Readonly<TOptions>;
}
```

`matches(entry, supplied, keys)` returns `true` when `entry.keys.length === keys.length` and every `key` in `keys` satisfies `entry.bag[key] === supplied[key]`. The length check matters: without it, a class that supplies a key on one construction and omits it on the next would silently inherit the stale value.

### `Component` constructor and `getLayoutManager`

```typescript
// constructor, replacing the inline `this._defaultOptions = { … }` literal
this._defaultLayoutManager = (subclassDefaults?.layoutManager as LayoutManager | undefined) ?? null;
this._defaultOptions       = resolveClassDefaults<TOptions>(this.constructor, subclassDefaults);
```

```typescript
// both getLayoutManager bodies (Component.ts:762 and Component.ts:4960)
const layoutManager = (this._options.layoutManager as LayoutManager | undefined)
    ?? (this._defaultLayoutManager ??= new Absolute());
// …existing lazy-attach block unchanged…
```

`_defaultLayoutManager` is written from the constructor body *after* `super()` in `Component` itself, so it takes a plain initializer — the `declare` rule in CODE_CONVENTIONS.md applies to fields written by cascade-dispatched setters, and no setter writes this one.

### `Util` additions

```typescript
let metricsGeneration = 0;
const boundFontSizeCache = new Map<string, number | null>();

export function textMetricsGeneration(): number { return metricsGeneration; }

export function boundFontSizePx(cssVar: string, cssRule: string | null): number | null {
    const key    = cssVar + "|" + (cssRule ?? "");
    const cached = boundFontSizeCache.get(key);
    if (cached !== undefined) return cached;

    const raw      = parseFloat(DOM.source.getThemeVar(cssVar));
    const resolved = isNaN(raw)
        ? DOM.source.resolveFontSizePx(cssRule ?? `var(${cssVar})`)
        : raw;

    boundFontSizeCache.set(key, resolved);
    return resolved;
}
```

`invalidateTextMetricsCache()` additionally runs `boundFontSizeCache.clear()` and `metricsGeneration++`.

### `Text` after the change

```typescript
private _measuredGeneration: number = -1;

private needsMeasure(): boolean {
    return this._measurementDirty || this._measuredGeneration !== Util.textMetricsGeneration();
}
```

`calculateSize()` sets `this._measuredGeneration = Util.textMetricsGeneration()` next to its existing `this._measurementDirty = false`. The three lazy read gates — `getBaseline` (Text.ts:442), `getPreferredSize` (:573), `getMinSize` (:622) — call `needsMeasure()` instead of reading `_measurementDirty`.

---

## Ordered Implementation Steps

1. **Write the failing tests first.** Add `packages/lib/tests/core/ComponentDefaults.test.ts` covering Expected Behaviour rows 1-8, and extend `packages/lib/tests/component/input/` with a `TextThemeReflow.test.ts` covering rows 9-13. Run them and confirm they fail. `TextThemeReflow.test.ts` calls `ThemeManager.setTheme`, which synchronously fires every listener still registered in the process — keep it in its own file and restore `ModernTheme` in an `afterEach`, exactly as `tests/core/TextDispose.test.ts:1-16` and `:36-41` explain.

2. **Create `packages/lib/src/typescript/lib/core/ComponentDefaults.ts`** with `ZERO_INSETS` / `ZERO_MIN_SIZE` / `UNBOUNDED_MAX`, `BASE_DEFAULTS`, `matches`, and `resolveClassDefaults` as shown in `## Internal Structure`. Move the `overflow: "hidden"` comment block verbatim from `Component.ts:504-511`. Do **not** export it from `core/index.ts`.

3. **`core/Component.ts` — swap the bag construction.** Replace the `this._defaultOptions = { … } as TOptions;` literal (`:498-516`) with the two lines from `## Internal Structure`. Add the `private _defaultLayoutManager: LayoutManager | null;` field declaration next to `_options` / `_defaultOptions` (`:451-452`), and change `_defaultOptions`'s type to `Readonly<TOptions>`. Update the `_defaultOptions` doc comment (`:442-450`) to describe the shared frozen bag and the per-instance layout-manager slot.

4. **`core/Component.ts` — route both layout-manager fallbacks.** Change `Component.ts:762` and `Component.ts:4960` to read `this._defaultLayoutManager ??= new Absolute()` instead of `this._defaultOptions.layoutManager`. Check: `grep -n '_defaultOptions.layoutManager' packages/lib/src` → expect zero matches.

5. **Typecheck to find every mutation the freeze forbids.** `cd packages/lib && npm run typecheck`. Expected new errors: the three `Text` writes (`Text.ts:138`, `:161`, `:367`). Anything else is a genuine write site the grep missed — fix it in place rather than widening the type.

6. **`component/input/Text.ts` — move `fontFamily` into the class defaults constant.** Delete the `this._defaultOptions.fontFamily = …` write at `:138` and add `fontFamily: "var(--ts-ui-font-family, system-ui, sans-serif)"` to the `_defaultTextOptions` constant (`:60-71`). Check: `grep -rn 'fontFamily' packages/lib/src/typescript/lib --include=*.ts | grep '_default'` → confirm no `Text` subclass seeds `fontFamily` in its own defaults, which would now lose to the constant instead of winning.

7. **`core/Util.ts` — add the generation counter and the bound-font-size cache** per `## Internal Structure`, and extend `invalidateTextMetricsCache()` to clear both. Give both new exported functions full JSDoc (they render in the API docs).

8. **`component/input/Text.ts` — delete the `subscribeTheme` block** (`:143-165`) and the class-doc paragraph describing it (`:92-94`). Delete the lazy line-height seeding block in `calculateSize()` (`:366-368`).

9. **`component/input/Text.ts` — re-point the resolvers.** Rewrite `resolveBoundFontSizePx()` (`:318-325`) as a one-line delegate to `Util.boundFontSizePx(this._fontSizeCSSVar, this._fontSizeCSSRule)`, returning `null` when `_fontSizeCSSVar` is null. Change `getFontSize()` (`:825-827`) to prefer that resolved value when `_fontSizeCSSVar` is set, falling back to the existing `_options` → `_defaultOptions` chain. Change `getLineHeight()` (`:992-994`) to end its fallback chain with `this.readThemeLineHeightPx()` instead of `null`, and update its `@returns` doc.

10. **`component/input/Text.ts` — add the generation gate.** Add `_measuredGeneration` and `needsMeasure()`, set the field in `calculateSize()`, and swap the three read gates (`:442`, `:573`, `:622`) to `this.needsMeasure()`. Leave the two write-side `_measurementDirty = true` sites in `setWidth` (`:553`) and the font setters untouched.

11. **`core/Body.ts` — add the root reflow subscription.** In `init()`, after the existing `Event.addViewportListener` line, add `this.subscribeTheme(this._onThemeReflow)` with a named bound field `private _onThemeReflow = (): void => { this.scheduleLayout(); };` beside `_onViewportResize` (ARCHITECTURE.md requires a named function reference, not an inline arrow argument).

12. **`overlay/AbstractWindow.ts` — add the same subscription** in the constructor after `super(...)` (`:270`), using the same named-field shape.

13. **Update the two theme-subscription tests.** `packages/lib/tests/core/TextDispose.test.ts:43-58` asserts `Text` registers exactly one theme listener — change it to assert zero new listeners; `:60-72` spies on `calculateSize` after `setTheme` — change it to assert that a *live* `Text` re-measures lazily on the next `getPreferredSize()` after a theme change, and that a disposed one is never touched.

14. **Run the full check set** per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/ComponentDefaults.ts` |
| Create | `packages/lib/tests/core/ComponentDefaults.test.ts` |
| Create | `packages/lib/tests/component/input/TextThemeReflow.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Util.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/tests/core/TextDispose.test.ts` |

---

## Expected Behaviour

All rows are unit-testable offline against `installTestDOM` except rows 14 and 15.

**Per-class defaults**

1. Two instances of the same class get **distinct** layout managers: `new Component().getLayoutManager() !== new Component().getLayoutManager()`, and each manager's `getContainer()` is its own component.
2. Two instances of the same class share **one** defaults bag object. Reaching the protected field through an `as any` cast, `a._defaultOptions === b._defaultOptions` is `true`.
3. A subclass's defaults override the base's: a subclass passing `{ overflow: "auto" }` as `subclassDefaults` reports `getOverflowX() === "auto"`, while a plain `Component` still reports `"hidden"`.
4. A subclass and its base do **not** share a bag: `new Subclass()._defaultOptions !== new Component()._defaultOptions`.
5. The bag rejects mutation: `expect(() => { (c as any)._defaultOptions.cursor = "pointer"; }).toThrow()`.
6. A getter still falls back to the default when `_options` is unset: `new Component().getCursor() === "default"`, `getZIndex() === 0`, `getInsets().getTop() === 0`, `getMinSizeConstraint()` is `{width:0,height:0}`.
7. A subclass supplying a `layoutManager` in `subclassDefaults` gets that manager per instance, and two instances get different ones. Use a local test subclass passing `{ layoutManager: new Fit() }`; both instances report a `Fit`, and the two `Fit`s are not the same object.
8. Instance-varying subclass defaults do not cross-contaminate: constructing `Panel({})` then `Panel({ flush: true })` (in either order) yields `getInsets().getTop() === 4` for the first and `0` for the flush one.

**Theme reflow**

9. Constructing a `Text` registers **zero** theme listeners: `ThemeManager._themeListenerCount()` is unchanged across `new Text("hi")`.
10. A theme change causes exactly **one** re-resolution of the bound font size per distinct CSS var, not one per instance: with 5 `Text` instances alive, spy on `DOM.source.getThemeVar` (or `resolveFontSizePx`), call `ThemeManager.setTheme(DarkTheme)`, then read `getFontSize()` on all 5 — the spy fires once.
11. A `Text` re-measures lazily after a theme change: `getPreferredSize()` returns a cached value, `ThemeManager.setTheme(DarkTheme)` runs, and the next `getPreferredSize()` triggers a fresh `calculateSize()` (spy on the private method as `TextDispose.test.ts` already does).
12. A disposed `Text` is never re-measured after a theme change (the existing `TextDispose.test.ts` guarantee, preserved).
13. `getLineHeight()` on a freshly constructed `Text` returns the resolved additive line box (font size + line padding) rather than `null`.

**Manual verification only**

14. Switching theme in the running app (`npm run dev`, http://localhost:8015) reflows text: open the wide-table demo in a floating `Window`, toggle Modern → Dark, and confirm row heights, tab labels, and button labels re-fit rather than clipping or leaving gaps. The offline harness cannot exercise a real CSS cascade, so the resolved-font-size path is only truly proven in a browser.
15. Theme switching on the page body (not in a window) reflows the main shell the same way.

---

## Verification

- `cd packages/lib && npx vitest run --no-file-parallelism` — read the **`Errors`** line and the process exit code, not just `Tests N passed`. A non-zero exit or any unhandled error is a failure even with every assertion green.
- `cd packages/lib && npm run typecheck` — exactly **7** pre-existing errors, no more. Any new error is this change's.
- `cd packages/lib && npm run typecheck:test`.
- `cd packages/lib && npm run lint` — the `local/no-raw-dom` rule has an empty baseline; the new `Util` code must go through `DOM.source`.
- `grep -rn '_defaultOptions\.[A-Za-z]* *=' packages/lib/src packages/lib/tests` → expect zero matches (was 4).
- `grep -rn 'subscribeTheme' packages/lib/src/typescript/lib/component/input/Text.ts` → expect zero matches.
- `grep -n 'ComponentDefaults' packages/lib/src/typescript/lib/core/index.ts` → expect zero matches.
- `npm run docs:build` from the repo root — must finish with **zero warnings** (two new `Util` members and a changed `Text.getLineHeight` doc).
- Manual: Expected Behaviour rows 14-15 in the dev app.

---

## Documentation Impact

- `Util.textMetricsGeneration` and `Util.boundFontSizePx` are new members of the exported `Util` namespace and need complete JSDoc (`@param`, `@returns`, `@remarks`). They are reached through the existing `~/core` entry point, so no barrel or sidebar entry is needed.
- `Text.getLineHeight`'s `@returns` changes from "or null if not set" to the resolved line box. Update the JSDoc and check `grep -rn 'getLineHeight' packages/lib/docs/` for prose repeating the null claim.
- `Text`'s class-level JSDoc (`Text.ts:92-94`) states that `Text` subscribes to `ThemeManager` on construction. Delete that paragraph.
- Per CODE_CONVENTIONS.md, none of the new JSDoc may `{@link}` `ComponentDefaults`, `resolveClassDefaults`, or any `private` member — describe them in prose instead.

---

## Potential Challenges

- **Widest blast radius of the four sibling plans.** Every `Component` construction path runs the new code. Mitigation: the change is confined to two lines of the constructor plus two `getLayoutManager` bodies; run the full suite after step 4 and again at the end, and keep the shared-bag change and the `Text` change as separate commits so a bisect can separate them.
- **The freeze can throw at runtime in code the typecheck did not reach.** `Readonly<TOptions>` only catches writes through the declared type; an `as any` or `as ButtonOptions` cast (e.g. `Button.ts:1610`) bypasses it. Mitigation: step 5's typecheck plus the `_defaultOptions.X =` grep in `## Verification`; both are cheap and exhaustive over the source tree.
- **`Insets` is a mutable class, and one frozen instance is now shared by every component that never sets insets.** A caller mutating `getInsets()` would now throw instead of silently corrupting one component. No such call site exists today (`grep -rn 'getInsets()\.set'` is empty), and the throw is the desired outcome if one is added.
- **The offline harness cannot exercise a real theme switch.** `installTestDOM` models `getThemeVar` from a fixed `themeVars` map, so the tests prove the *number of resolutions* and the *laziness*, not that the resolved value is right after a real cascade flip. Rows 14-15 are the substitute and must actually be performed.
- **Deferring the re-measure defers the relayout.** Today each `Text` pushes a new preferred size up its parent chain on theme change; after this plan nothing does until a layout pass runs. The root subscriptions in step 11-12 cover the page body and floating windows. Transient overlays constructed outside those two roots — `Menu`, `Dialog`, `Popover`, `Drawer`, `Rail`, `Tooltip`, `Notification` — are not covered and will re-fit on their next layout for any other reason. Mitigation: these are short-lived and usually built after the theme is already set; if a stale overlay is observed during manual verification, add the same two-line subscription to that class rather than restoring the per-`Text` one.
- **A class whose first construction carries atypical defaults poisons the fast path.** If the first `Panel` ever built is a `flush` one, every later non-flush `Panel` takes the miss branch and allocates its own bag. Correctness is unaffected; only the allocation saving is. Not worth a fix — the high-count classes (`Text`, `StringCell`, `NumberCell`, `DateCell`, `BooleanCell`, `StringRenderer`) all have constant defaults.

---

## Critical Files

- `packages/lib/src/typescript/lib/core/Component.ts` — the `_defaultOptions` field and doc comment (`:442-452`), the constructor seed (`:498-516`), `applyChromeOptions` (`:645-655`, reads defaults), and both `getLayoutManager` bodies (`:762`, `:4960`).
- `packages/lib/src/typescript/lib/core/Util.ts` — `linePaddingPx` / `rootFontSizePx` / `measureTextBaseline` / `opticalCenterOffset` / `invalidateTextMetricsCache` (`:47-52`, `:262-267`). **This is the precedent** the new cache follows: module-level theme-derived numbers with one global invalidation.
- `packages/lib/src/typescript/lib/core/Theme.ts:1253-1347` — `ThemeManager.onThemeChange`, `_themeListenerCount`, `reflowText`.
- `packages/lib/src/typescript/lib/component/input/Text.ts` — `_defaultTextOptions` (`:60-71`), the constructor (`:119-178`), `readThemeLineHeightPx` (`:275-293`), `resolveBoundFontSizePx` (`:318-325`), `calculateSize` (`:357-416`), and the font/line-height accessors (`:825`, `:992`).
- `packages/lib/src/typescript/lib/core/Callable.ts` — confirms `instance.constructor` is the original class even through the callable Proxy, which is what makes the constructor-keyed cache sound.
- `packages/lib/tests/component/default-options-fallback.test.ts` — the existing registry ARCHITECTURE.md requires for every class-defaulted field. Read it before writing new tests; its `ScrollingPanel` fixture passes `layoutManager` through `subclassDefaults` and must keep passing.
- `packages/lib/tests/core/TextDispose.test.ts` — the two assertions this plan inverts.
- `packages/lib/src/typescript/lib/component/display/Glyph.ts:240-254`, `component/input/SpinButton.ts:73-81`, `core/Panel.ts:250-262`, `component/list/AbstractMarkerList.ts:38-46` — the four instance-varying `subclassDefaults` sites the cache must not merge.

---

## Non-Goals

- **The class-scoped `.ClassName` style-rule hoist.** A separate plan owns it and depends on this one. Do not add style-rule machinery to `ComponentDefaults.ts`.
- **The `ensureStyleRule` lookup fix and the `StyleRule` batched flush.** Sibling plans own those files.
- **The other ~20 `subscribeTheme` call sites.** Only `Text`'s is removed here; see the addendum for the classification and the one follow-up it surfaces.
- **`Component.clearInsets()`'s per-call `new Insets(0,0,0,0)`.** It writes `_options`, not `_defaultOptions`, so it sits outside this plan's rule; sharing a frozen instance there would widen the blast radius for a marginal saving.
- **The stale var-bound line height.** When `setLineHeight("--some-var")` has been called, `_options.lineHeight` holds a resolved number that already goes stale on theme change today, because it shadows the `_defaultOptions` fallback the old callback wrote. This plan preserves that behaviour rather than fixing it.

---

## Addendum: `subscribeTheme` call-site audit

Every current theme subscriber, classified as the brief requires: does the callback re-resolve a cached value (foldable into a shared cache), or does it write genuinely per-instance state?

| Site | What the callback does | Class |
|---|---|---|
| `component/input/Text.ts:143` | re-resolves font size + line height, then re-measures | **re-resolve** — removed by this plan |
| `core/Component.ts:2209` | `this._borderWidths = null` | per-instance cache clear (one subscription per component that ever calls `setBorder`) |
| `component/table/cell/Cell.ts:66` | `setBorder('var(--ts-ui-table-cell-border, none)')` | **writes per-instance CSS** — see below |
| `component/table/cell/renderer/CellRenderer.ts:33` | `setInsets(new Insets(0, p, 0, p))` from `theme.table.cell.padding` | re-resolve — the value is class-uniform; foldable |
| `component/table/cell/editor/CellEditor.ts:86` | same as `CellRenderer` | re-resolve; foldable |
| `component/table/Body.ts:144` | recomputes row height, invalidates geometry, re-renders the window | per-instance (one per table) |
| `component/button/Button.ts:518` | rebuilds the content row and re-measures | per-instance |
| `component/display/Header.ts:79` | `updatePreferredSize()` | per-instance |
| `component/container/TabBar.ts:632` | reads `theme.tab.underBorderFullWidth`, re-applies the under-border | per-instance (one per tab bar) |
| `component/display/ProgressSpinner.ts:93` | re-reads the theme font size, resizes itself | per-instance |
| `component/input/TextField.ts:41`, `PasswordField.ts:46`, `UsernameField.ts:45`, `ComboBox.ts:650`, `AbstractPickerField.ts:105`, `NumberSpinner.ts:132`, `SpinButton.ts:84`, `AutoCompleteField.ts:121` | recompute their own box height | per-instance, low instance counts |
| `component/display/Markdown.ts:355`, `component/editor/CodeEditor.ts:163`, `layout/Tab.ts:319`, `component/chart/AbstractChart.ts:178` | re-measure / re-layout; these four call `ThemeManager.onThemeChange` **directly** rather than `subscribeTheme` | per-instance, low counts |

**One site writes per-instance CSS: `Cell.ts:66`.** It re-applies the *same constant* `'var(--ts-ui-table-cell-border, none)'` string it already set two lines earlier at construction — the CSS is var-based, so the cascade handles a theme change with no rewrite needed, and the callback is a no-op that costs one subscription and one style write per cell (~1,440 in a wide table). Removing it looks safe and would be a worthwhile follow-up, but it is a change to the table cell subsystem and is **deliberately not designed here**. Recorded so it is not lost.

`CellRenderer.ts:33` and `CellEditor.ts:86` are the next-largest saving after `Text` — one subscription per renderer and per editor, re-deriving a single class-uniform padding number. They fold into the same shape this plan applies to `Text`, and are also left for a follow-up rather than absorbed.

---

## Notes

[^ctor-key]: `constructor.name` is unsafe as a key here for two independent reasons. First, it is not unique in this tree: `class Body` is declared twice — `core/Body.ts:21` and `component/table/Body.ts:111` — and both are `Component` subclasses, so a name-keyed cache would hand one of them the other's defaults. (`class Table` is also declared twice, at `layout/Table.ts:40` and `component/table/Table.ts:74`, but only the second is a `Component`.) Second, name-keying would make the cache depend on the `keepNames` settings in `vite.config.ts:49-50` and on `plans/minification-safe-class-names.md` landing. `this.constructor` has neither problem: `core/Callable.ts` forwards `[[Construct]]` through `Reflect.construct(target, args)`, so `instance.constructor` is the original class object for both `new Text(…)` and `Text(…)`, and a `Map<Function, …>` key survives any minifier. `getClassName()` is untouched by this plan.

[^lm-slot]: A `LayoutManager` holds `_container` state — `setLayoutManager` calls `detach()` on the outgoing manager and `attach(this)` on the incoming one, and `getLayoutManager`'s lazy-attach block gates on `getContainer() !== this`. One instance shared across every component would have its container rewritten by whichever component read it last, silently breaking every other component's layout. `Button.applyOptions` (Button.ts:571-573) already records this in a comment: "a fresh manager can't live in the shared `_defaultOptions` bag". The subclasses that seed a default manager all construct it inline in the `super(...)` call — `DiagramNode.ts:65` (`new Fit()`), `DiagramGroupNode.ts:53`, `Dock.ts:294`, `IconText.ts:69` — so they are already per instance; routing them through `_defaultLayoutManager` preserves that exactly while keeping the key out of the shared bag. A `protected defaultLayoutManager()` factory hook was considered and rejected: it would require editing every one of those `super(...)` calls, for no behavioural gain over the slot.

[^shared-objects]: `mergeConstraintSize` (Component.ts, private) always constructs a fresh `{width, height}` from its inputs and never returns the default literal itself, so no caller can reach the shared `minSize` / `maxSize` objects to mutate them. `getInsets()` does return the shared `Insets` directly, but `grep -rn 'getInsets()\.set'` over the source tree is empty, and `clearInsets()` allocates its own instance into `_options` rather than touching the default. The status quo already relies on this: `_defaultStatusBarOptions` (StatusBar.ts:60), `_defaultHeaderOptions` (Header.ts:34), `_defaultIconLabelOptions` (IconLabel.ts:32), `_defaultIconTextOptions` (IconText.ts:31) and `_defaultDiagramNodeOptions` (DiagramNode.ts:38) each hold a single `new Insets(...)` that every instance of the class shares.

[^freeze]: `Insets` uses plain TypeScript `private` fields (real own properties), and `BaseObject`'s constructor assigns `_id` eagerly with no lazy write afterwards, so `Object.freeze(new Insets(0,0,0,0))` is safe and makes `setTop` throw in the strict-mode module scope. Only four sites write to `_defaultOptions` today — `Component.ts:498` (the constructor seed this plan replaces) and `Text.ts:138`, `:161`, `:367` — so the freeze costs three edits and buys a permanent structural guarantee. `Readonly<TOptions>` is shallow, which is exactly right: the bag's own keys become read-only, while the values it points at are already treated as immutable by the argument above.

[^varying-defaults]: Four shipped classes derive `subclassDefaults` from constructor input, so one bag per class name would be wrong: `Panel.ts:250-262` seeds zero `insets` when `options.flush` is set; `Glyph.ts:240-254` picks `tag: "svg"` or `"span"` from the registry entry's `kind`; `SpinButton.ts:73-81` picks `glyph: "chevron-up"` or `"chevron-down"` from its `symbol` argument; and `AbstractMarkerList.ts:38-46` seeds its required `style` constructor parameter as `itemStyle`. Three alternatives were rejected. A per-class opt-in flag pushes the correctness burden onto every future subclass author, and getting it wrong fails silently. A content hash of the bag costs more than the object spread it replaces. Excluding those four classes by name is a hard-coded list that rots. The shallow identity comparison is cheap (the bags carry fewer than a dozen keys), needs no call-site cooperation, and fails safe: a miss allocates, exactly as today.

[^util-precedent]: `Util` already holds `linePaddingCache`, `rootFontSizeCache`, `textBaselineCache`, and `opticalOffsetCache` — theme-derived numbers cached at module scope, read lazily, and cleared as a group by `invalidateTextMetricsCache()`, which `ThemeManager.reflowText()` (Theme.ts:1343-1347) already calls before notifying listeners. `Util.lineHeightPx` — the whole body of `Text.readThemeLineHeightPx`'s default path — is therefore already one shared arithmetic step over cached values, which is why `_defaultOptions.lineHeight` can be deleted outright rather than replaced by a new per-class cache: the cache it was duplicating already exists one layer down. The only genuinely uncached read left in `Text`'s callback is `resolveBoundFontSizePx`, and the new `Util.boundFontSizePx` map joins the same invalidation family. A footnote-worthy detail: the callback's `_defaultOptions.lineHeight` write at `Text.ts:161` is already dead, because it only runs when `_lineHeightCSSVar` is set, and the only path that sets it (`setLineHeight(varName)`) also writes `_options.lineHeight`, which shadows the default in `getLineHeight()`.

[^root-reflow]: `ThemeManager.setTheme` rewrites the root CSS variables, so the browser repaints at the new font size immediately; what goes stale is the framework's measured geometry, and that only refreshes when a layout pass runs. Today the pass is triggered bottom-up — each `Text` re-measures, `setPreferredSize` fires `_onPreferredSizeChange`, and the parent chain schedules a layout. With the re-measure deferred, the trigger has to come from the top instead. `Body` is the singleton page root (`Body.ts:23`) and `AbstractWindow` is the root of every floating window (windows are appended to `document.documentElement`, not to the body), so one `scheduleLayout()` on each covers the two places long-lived, text-heavy content lives. A general root registry inside `Component` was considered and rejected: it would add module state and three new maintenance points (`init`, `wireChild`, `unwireChild`) to the file with the widest blast radius, to cover overlays that are transient anyway.
