---
depends-on: [image-intrinsic-size-lifecycle]
touches-shared: ["packages/lib/src/typescript/lib/component/display/Image.ts"]
---

# Image Attribute and Options Surface — Implementation Plan

## Overview

`Image` ([packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts)) writes its `src` attribute with a raw `DOM.sink.apply(element, { setAttr: { src } })` call inside `render()`, has an empty `ImageOptions` bag, and exposes no way to set `alt` or any other standard `<img>` attribute. This breaks the three non-negotiable DOM-write rules in [ARCHITECTURE.md](ARCHITECTURE.md) (typed setter, in-memory cache, `XOptions` exposure) and leaves screen readers announcing the raw image URL instead of a label. `Video` ([packages/lib/src/typescript/lib/component/display/Video.ts](packages/lib/src/typescript/lib/component/display/Video.ts)) is this framework's working example of the shape `Image` is missing: an options bag with one field per attribute, a typed `get`/`set` pair per field routed through `setElementAttribute`, and an `applyOptions` override that dispatches the bag. This plan gives `Image` that same shape for `src`, `alt`, `loading`, `decoding`, `fetchPriority`, `crossOrigin`, and `referrerPolicy`, and deletes two dead pass-through overrides (`render()`, `getElement()`).

This plan depends on `image-intrinsic-size-lifecycle` ([plans/image-intrinsic-size-lifecycle.md](plans/image-intrinsic-size-lifecycle.md)), which must implement first. That plan adds `_naturalSize`, the `ListenerBag`-based `on`/`off`/`emit` surface, and a `handleLoad()` method that auto-publishes `preferredSize` from the decoded image's natural dimensions the first time `load` fires. Because that plan's own `## Potential Challenges` flags that a *second* `load` (which this plan's mutable `setSrc` introduces) would find `handleLoad()`'s publish gate permanently closed, this plan also edits `handleLoad()`: it swaps the gate's condition for a new explicit-vs-auto flag and invalidates the cached natural size on every `setSrc` call, so swapping an `Image`'s source correctly re-measures. Three more sibling plans (not yet drafted) — object-fit/aspect-ratio, loading/error visual states, and `srcset`/`decode()` — will also touch `Image.ts`; see the last `## Architecture Decisions` subsection for how this plan's shape constrains them.

Because the dependency plan is not yet implemented anywhere (no branch or worktree exists for it), none of the code this plan builds on top of has real line numbers yet. Every instruction below that touches dependency-introduced code (fields, `handleLoad()`, the constructor after the dependency's edits) is anchored to a symbol or a quoted snippet, not a line number. Instructions that touch code already on `master` today cite today's real line numbers.

---

## Architecture Decisions

### Every new field gets a `Video`-shaped typed setter, dispatched from a new `applyOptions` override

`Image` currently has no `applyOptions` override. This plan adds one, following `Video.applyOptions` ([Video.ts:138-151](packages/lib/src/typescript/lib/component/display/Video.ts#L138-L151)) exactly: one `if (options.foo !== undefined) this.setFoo(options.foo);` line per field, calling `super.applyOptions(options)` first. Each setter follows the *default* shape from [ARCHITECTURE.md](ARCHITECTURE.md)'s "Three non-negotiable rules for every DOM write" — cache into `_options.foo`, write through `this.setElementAttribute(...)` — because none of these fields need value normalization (no private backing field, matching `Video.setPreload`/`setPoster`, not the `lineHeight`-style normalizing shape).

### `src` stays a required positional constructor argument; `ImageOptions.src` wins when both are given

The audit's own instruction keeps `new Image(src, options)` — `src` positional, sugar for `setSrc`. When `options.src` is *also* given, the options-bag value wins: the constructor applies the positional argument only when `this._options.src` is still `undefined` after `super()` returns.

| Construction | `getSrc()` after construction |
|---|---|
| `new Image("/a.png")` | `"/a.png"` — positional only |
| `new Image("/a.png", { src: "/b.png" })` | `"/b.png"` — bag wins |
| `Image("/a.png", {})` | `"/a.png"` — bag has no `src` key |

This is not a novel rule for this plan to invent: it is the house pattern for every other `Component` subclass with a positional argument that duplicates an options field — `Text` ([Text.ts:207-212](packages/lib/src/typescript/lib/component/input/Text.ts#L207-L212)), `Markdown.ts:630-634`, `CodeEditor.ts:482-486` all apply the positional value only when the matching `_options` key is still `undefined` post-`super()`. `Glyph`, which the audit also cites, is not this case: `GlyphOptions` has no `glyph` field to conflict with, so it never needed a precedence rule.[^glyph-not-precedent]

### `setSrc` invalidates `_naturalSize`; a new `_hasExplicitPreferredSize` flag stops the second `load` from being frozen out

`setSrc` sets `this._naturalSize = null` on every call, so `getMinSize()` (which the dependency plan makes read `_naturalSize`) reports the pre-load `{0, 0}` default instead of the previous image's stale dimensions while the new one is in flight.

Nulling `_naturalSize` alone does not make `getPreferredSize()` re-measure, though. The dependency plan's `handleLoad()` only auto-publishes `preferredSize` when `!this.getPreferredSizeConstraint()`; the *first* auto-publish makes that constraint non-null, so on a *second* `load` (triggered by this plan's `setSrc`) the gate stays shut and the box freezes at the first image's dimensions forever — exactly the risk the dependency plan's own `## Potential Challenges` names and defers to "that plan" (this one). The fix is a private `_hasExplicitPreferredSize` flag, set by an override of `setPreferredSize`/`clearPreferredSize`, that `handleLoad()` checks instead of `getPreferredSizeConstraint()`.[^explicit-flag]

| Sequence | `getMinSize()` | `getPreferredSize()` |
|---|---|---|
| Construct, `_onLoad()` fires, natural `300×200`, no explicit size | `{100, 100}` (capped) | `{300, 200}` |
| `setSrc("/new.png")` called, before the new `load` fires | `{0, 0}` | `{300, 200}` (unchanged — nothing new to report yet) |
| New `_onLoad()` fires, natural `50×50` | `{50, 50}` | `{50, 50}` — re-published, not frozen at `300×200` |

| Sequence (explicit size set) | `getPreferredSize()` |
|---|---|
| `new Image("/a.png", { preferredSize: { width: 120, height: 40 } })` | `{120, 40}` |
| `_onLoad()` fires, natural `300×200` | `{120, 40}` (unchanged — per the dependency plan) |
| `setSrc("/b.png")`, then `_onLoad()` fires again, natural `50×50` | `{120, 40}` — still unchanged; an explicit size survives a source change |

### `alt` is the native accessible name; no automatic `Aria` wiring

`Video` calls `this.getAria().setLabel("Video")` in its constructor because a `<video>` has no built-in text alternative. `<img alt>` *is* the browser's native accessible-name source for an image, and `aria-label` — if ever set — would outrank it in accessible-name computation. So `setAlt` writes only the `alt` attribute; this plan adds no constructor-time `getAria()` call for `Image`, unlike `Video`.[^alt-vs-aria]

### Decorative images use `alt=""`; no new decorative-specific option

An empty `alt` is the standard HTML/ARIA way to mark an image decorative — screen readers skip it entirely. `ImageOptions.alt` already accepts `""`, so no `decorative` flag or automatic `getAria().setHidden(true)` call is added. A consumer who wants belt-and-suspenders hiding can already call `image.getAria().setHidden(true)` directly; `Aria` is already public via `Component.getAria()` and needs no change here.[^decorative]

| `alt` passed | Rendered `alt` attribute | Screen-reader behaviour |
|---|---|---|
| `"Company logo"` | `alt="Company logo"` | Announces the text |
| `""` | `alt=""` | Skips the image (decorative) |
| unset | no `alt` attribute | Falls back to browser default (often announces the file name) — always pass one |

### `loading` / `decoding` / `fetchPriority` / `crossOrigin` / `referrerPolicy` each get a named setter

Mirrors `Video`, which gives every comparable attribute-backed field (`preload`, `autoplay`, `loop`, `muted`) its own named setter rather than routing them only through construction options. Three of the five write an attribute name that is not the camelCase of its method name — `setFetchPriority` writes `fetchpriority`, `setCrossOrigin` writes `crossorigin`, `setReferrerPolicy` writes `referrerpolicy` — because those are the literal (lower-cased, unhyphenated) HTML attribute names; the setter name still matches the DOM IDL property name (`fetchPriority`, `crossOrigin`, `referrerPolicy`) for API familiarity, matching how `Video.setPreload` mirrors the native `preload` IDL name.[^attr-casing] `referrerPolicy` reuses TypeScript's built-in global `ReferrerPolicy` union type (from the DOM lib) rather than a hand-written duplicate.

### `render()` and `getElement()` are deleted, not kept as empty overrides

Once `setSrc` replaces the raw `setAttr` write, `render()`'s body is `return super.render();` — nothing `Image`-specific remains, unlike `getPreferredSize()` in the dependency plan, which the dependency plan intentionally keeps as a thin override so it can carry `Image`-specific JSDoc. `Image`'s class-level JSDoc already documents its shape, and `Video` (the shape precedent for this plan) has no `render()` override at all. `getElement()` is deleted for the same reason — item 6 of the audit already names it dead pass-through code independent of any other change here.[^render-delete]

### This plan's `ImageOptions`/`applyOptions` shape constrains three not-yet-drafted sibling plans

- The object-fit/aspect-ratio plan will add CSS-backed fields (`objectFit`, `objectPosition`) to the *same* `applyOptions` override this plan creates, using `setElementCSSRule` instead of `setElementAttribute` — a different setter shape, same dispatch method.
- The `srcset`/`decode()` plan's `setSrcset` will need the same cache-invalidation line this plan's `setSrc` adds (`this._naturalSize = null;`), since a `srcset` change can also swap the decoded image.
- The loading/error visual-states plan should not assume `setSrc` resets any visual/error state — this plan's `setSrc` only invalidates the size cache; it does not clear a prior `error` emission or any future loading-state indicator.
- Any future override of `setPreferredSize`/`clearPreferredSize` on `Image` must preserve this plan's `_hasExplicitPreferredSize` bookkeeping (call `super.setPreferredSize`/`super.clearPreferredSize` and don't reintroduce a second explicit-tracking mechanism).

---

## Public API

```typescript
export interface ImageOptions extends ComponentOptions {
    src?:            string;
    alt?:            string;
    loading?:        "lazy" | "eager";
    decoding?:       "sync" | "async" | "auto";
    fetchPriority?:  "high" | "low" | "auto";
    crossOrigin?:    "anonymous" | "use-credentials";
    referrerPolicy?: ReferrerPolicy; // TypeScript's built-in DOM-lib global type

    // Unchanged, added by the image-intrinsic-size-lifecycle plan:
    listeners?: {
        load?:  () => void;
        error?: () => void;
    };
}

class Image extends Component<ImageOptions> {
    constructor(src: string, options?: ImageOptions, subclassDefaults?: Partial<ImageOptions>);

    getSrc(): string | null;
    setSrc(src: string): this;

    getAlt(): string | null;
    setAlt(value: string): this;

    getLoading(): "lazy" | "eager" | null;
    setLoading(value: "lazy" | "eager"): this;

    getDecoding(): "sync" | "async" | "auto" | null;
    setDecoding(value: "sync" | "async" | "auto"): this;

    getFetchPriority(): "high" | "low" | "auto" | null;
    setFetchPriority(value: "high" | "low" | "auto"): this;

    getCrossOrigin(): "anonymous" | "use-credentials" | null;
    setCrossOrigin(value: "anonymous" | "use-credentials"): this;

    getReferrerPolicy(): ReferrerPolicy | null;
    setReferrerPolicy(value: ReferrerPolicy): this;

    // Overridden to track caller intent — see "setSrc invalidates _naturalSize" above.
    // Signatures unchanged from Component; not previously overridden by Image.
    setPreferredSize(size: Size): this;
    clearPreferredSize(): this;

    protected applyOptions(options: ImageOptions): this;
}
```

`Image` no longer overrides `render()` or `getElement()` — both are deleted, so both fall back to `Component`'s own `protected render(): Handle` and public `getElement(createIfMissing?: boolean): Handle | undefined`. See "`render()` and `getElement()` are deleted, not kept as empty overrides" above.

`_src: String` is deleted; `src` is now cached the default way, in `_options.src` (`string`, not boxed `String`), like every other field on this bag.

For the new private field: `declare private _hasExplicitPreferredSize: boolean;` — no matching `ImageOptions` field, since it is internal bookkeeping (which of the last preferred-size writes was the caller's), not consumer configuration, per [ARCHITECTURE.md](ARCHITECTURE.md)'s carve-out for "properties intrinsic to the component's internal functioning."

---

## Internal Structure

The declare-field flag and its two override call sites (new in this plan):

```typescript
// Whether the current preferredSize constraint came from the caller (a
// constructor `preferredSize` option or a direct setPreferredSize /
// clearPreferredSize call) rather than this component's own auto-publish in
// handleLoad(). Declared bare — no initializer — per CODE_CONVENTIONS.md's
// "Fields written during the super() cascade must use declare":
// Component.applyOptions calls `this.setPreferredSize(options.preferredSize)`
// polymorphically from inside super(), before a plain `= false` initializer
// would run and silently wipe a cascade-set `true` back to `false`. Text.ts's
// own `_hasExplicitPreferredSize` (Text.ts:143) has exactly this bug today —
// a plain, non-declare field — because Text's override predates this
// convention; this plan does not repeat it (see Notes).
declare private _hasExplicitPreferredSize: boolean;

setPreferredSize(size: Size): this {
    this._hasExplicitPreferredSize = true;

    return super.setPreferredSize(size);
}

clearPreferredSize(): this {
    this._hasExplicitPreferredSize = false;

    return super.clearPreferredSize();
}
```

The constructor seeds the flag right after `super()` returns (`_hasExplicitPreferredSize` is `undefined`, not `false`, until either this seed or the cascade's `setPreferredSize` call writes it), then applies the guarded positional `src` dispatch before the dependency plan's `applyListeners` call, which keeps its existing position as the last line of the constructor:

```typescript
constructor(src: string, options?: ImageOptions, subclassDefaults?: Partial<ImageOptions>) {
    super(options, { ..._defaultImageOptions, ...(subclassDefaults ?? {}) });

    this._hasExplicitPreferredSize ??= false;
    this.clearInsets();

    // Positional `src` argument: applied only when `options.src` didn't
    // already win via the applyOptions cascade above. See "src stays a
    // required positional constructor argument" in Architecture Decisions.
    if (this._options.src === undefined) {
        this.setSrc(src);
    }

    this.applyListeners(options?.listeners); // added by image-intrinsic-size-lifecycle; unchanged
}
```

`handleLoad()` (introduced by the dependency plan) changes in exactly two places — the gate condition and the auto-publish call, so the auto-publish itself does not trip the new flag:

```typescript
private handleLoad(): void {
    const element = this.getElement();
    if (!element) {
        return;
    }

    const natural = DOM.source.getNaturalSize(element);
    this._naturalSize = { width: natural.width, height: natural.height };

    if (!this._hasExplicitPreferredSize) {              // was: !this.getPreferredSizeConstraint()
        const perimeter = this.getPerimeterSize();

        super.setPreferredSize({                         // was: this.setPreferredSize(...)
            width:  this._naturalSize.width  + perimeter.left + perimeter.right,
            height: this._naturalSize.height + perimeter.top  + perimeter.bottom,
        });
    }

    this.emit("load");
}
```

The seven new typed setters, one representative pair shown (the rest are the same shape with a different attribute name — see the Public API table above for every signature):

```typescript
getSrc(): string | null {
    return this._options.src ?? null;
}

setSrc(src: string): this {
    this._options.src = src;
    this.setElementAttribute("src", src);
    this._naturalSize = null; // new source — the cached natural size is stale; re-measure on the next load

    return this;
}

getAlt(): string | null {
    return this._options.alt ?? null;
}

setAlt(value: string): this {
    this._options.alt = value;
    this.setElementAttribute("alt", value);

    return this;
}

getFetchPriority(): "high" | "low" | "auto" | null {
    return this._options.fetchPriority ?? null;
}

setFetchPriority(value: "high" | "low" | "auto"): this {
    this._options.fetchPriority = value;
    this.setElementAttribute("fetchpriority", value); // literal HTML attribute name — no camelCase

    return this;
}
```

`getLoading`/`setLoading`, `getDecoding`/`setDecoding`, `getCrossOrigin`/`setCrossOrigin` (writes `"crossorigin"`), and `getReferrerPolicy`/`setReferrerPolicy` (writes `"referrerpolicy"`) all follow the `setAlt` shape exactly — cache into `_options.foo`, write through `setElementAttribute` with the literal HTML attribute name.

`applyOptions`:

```typescript
protected applyOptions(options: ImageOptions): this {
    super.applyOptions(options);

    if (options.src            !== undefined) this.setSrc(options.src);
    if (options.alt            !== undefined) this.setAlt(options.alt);
    if (options.loading        !== undefined) this.setLoading(options.loading);
    if (options.decoding       !== undefined) this.setDecoding(options.decoding);
    if (options.fetchPriority  !== undefined) this.setFetchPriority(options.fetchPriority);
    if (options.crossOrigin    !== undefined) this.setCrossOrigin(options.crossOrigin);
    if (options.referrerPolicy !== undefined) this.setReferrerPolicy(options.referrerPolicy);

    return this;
}
```

---

## Ordered Implementation Steps

Run these only after the `image-intrinsic-size-lifecycle` plan has been implemented and `Image.ts` carries `_naturalSize`, `_listeners`, `_onLoad`, `_onError`, `handleLoad()`, `init()`, `destructor()`, the thin `getPreferredSize()` override, the natural-size-based `getMinSize()`, `getBaseline()`, `on()`, `off()`, and `protected emit()`.

1. **Widen `ImageOptions`.** Add `src`, `alt`, `loading`, `decoding`, `fetchPriority`, `crossOrigin`, `referrerPolicy` from `## Public API` to the interface, alongside the dependency plan's `listeners` field. Give each a one-line doc comment (see `## Documentation Impact` for wording to reuse in the class JSDoc).
   Verify: `grep -n "src?:\|alt?:\|loading?:\|decoding?:\|fetchPriority?:\|crossOrigin?:\|referrerPolicy?:" packages/lib/src/typescript/lib/component/display/Image.ts` shows all seven.

2. **Delete the `private _src: String;` field.** It sits near the dependency plan's `_naturalSize`/`_listeners`/`_onLoad`/`_onError` fields; delete only this one line. `src` is now cached in `_options.src`.

3. **Add `declare private _hasExplicitPreferredSize: boolean;`** from `## Internal Structure`, next to the other private fields.

4. **Change the constructor's `src` parameter type from `String` to `string`.** Replace the body's `this._src = src;` line and the rest of the body with the version from `## Internal Structure` — flag seed, `clearInsets()`, guarded positional `src` dispatch, then the dependency plan's existing `this.applyListeners(options?.listeners);` call (keep that line as-is, in place).
   Verify: `grep -n "_src\b" packages/lib/src/typescript/lib/component/display/Image.ts` — zero matches (the field and every reference are gone).

5. **Delete the `getElement()` override.** Component's own `getElement()` is already public; this override added nothing.

6. **Add the seven typed setter/getter pairs** from `## Internal Structure` and the Public API table (`getSrc`/`setSrc`, `getAlt`/`setAlt`, `getLoading`/`setLoading`, `getDecoding`/`setDecoding`, `getFetchPriority`/`setFetchPriority`, `getCrossOrigin`/`setCrossOrigin`, `getReferrerPolicy`/`setReferrerPolicy`), each with a doc comment matching `Video`'s style for its comparable field.

7. **Add `setPreferredSize`/`clearPreferredSize` overrides** from `## Internal Structure`, each with a short doc comment noting they track `_hasExplicitPreferredSize` for `handleLoad()`.

8. **Add the `protected applyOptions(options: ImageOptions): this` override** from `## Internal Structure` (`Image` has none today).

9. **Edit `handleLoad()`'s two lines** per `## Internal Structure`: the gate condition (`!this.getPreferredSizeConstraint()` → `!this._hasExplicitPreferredSize`) and the auto-publish call (`this.setPreferredSize(...)` → `super.setPreferredSize(...)`).
   Verify: `grep -n "getPreferredSizeConstraint" packages/lib/src/typescript/lib/component/display/Image.ts` — zero matches (no longer called anywhere in this file).

10. **Delete the `render()` override.** Nothing `Image`-specific remains in it once step 4 removes the raw `setAttr` write it existed for.
    Verify: `grep -n "DOM.sink.apply" packages/lib/src/typescript/lib/component/display/Image.ts` — zero matches.

11. **Update the class-level JSDoc** to mention the accessible `alt` attribute and that `src` is settable post-construction — see `## Documentation Impact`.

12. **Typecheck.** `npm run typecheck` — expect zero errors. This is the cheapest check that `ReferrerPolicy` resolves as a global type with no import (see `## Potential Challenges`).

13. **Update `packages/lib/tests/component/display/Image.test.ts`** per `## Expected Behaviour` below, following `Video.test.ts`'s `Recorder`/`lastAttr` helper pattern ([Video.test.ts:19-36](packages/lib/tests/component/display/Video.test.ts#L19-L36)).

14. **Run tests.** `npm test` — all `Image.test.ts` cases green, no regressions elsewhere.

15. **Update `packages/lib/docs/components/Image.md`** per `## Documentation Impact`.

16. **Run `npm run docs:api`** — expect zero TypeDoc warnings.

17. **Re-read the full diff of `Image.ts` once, end to end**, adversarially: every new setter caches into `_options` and writes through `setElementAttribute` (no direct `DOM.sink`/`DOM.source` call outside `handleLoad`); `applyOptions` dispatches all seven fields; the positional/bag `src` precedence table holds; `handleLoad()`'s two edits are both present; no leftover reference to `_src`, `getPreferredSizeConstraint`, or the deleted `render()`/`getElement()` overrides.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Image.ts` |
| Modify | `packages/lib/tests/component/display/Image.test.ts` |
| Modify | `packages/lib/docs/components/Image.md` |

---

## Expected Behaviour

All rows are unit-testable offline via the recording sink (`DOM.sink` cast to `{ writes: {op, args}[] }`, matching `Video.test.ts`'s `Recorder`/`lastAttr` helpers) and the dependency plan's `_onLoad`/`TestDOM.setNaturalSize` bridge for load-triggered cases. Nothing here needs a real browser.

### Attribute round-trip (unit-testable)

| Setter call | Getter | Written attribute : value |
|---|---|---|
| `setSrc("/logo.png")` | `getSrc()` → `"/logo.png"` | `src` : `"/logo.png"` |
| `setAlt("Company logo")` | `getAlt()` → `"Company logo"` | `alt` : `"Company logo"` |
| `setAlt("")` | `getAlt()` → `""` | `alt` : `""` |
| `setLoading("lazy")` | `getLoading()` → `"lazy"` | `loading` : `"lazy"` |
| `setDecoding("async")` | `getDecoding()` → `"async"` | `decoding` : `"async"` |
| `setFetchPriority("high")` | `getFetchPriority()` → `"high"` | `fetchpriority` : `"high"` |
| `setCrossOrigin("anonymous")` | `getCrossOrigin()` → `"anonymous"` | `crossorigin` : `"anonymous"` |
| `setReferrerPolicy("no-referrer")` | `getReferrerPolicy()` → `"no-referrer"` | `referrerpolicy` : `"no-referrer"` |
| Any getter before its setter is ever called | returns `null` | — |

### Options-bag construction

- `new Image("/a.png", { alt: "Logo", crossOrigin: "anonymous", loading: "lazy" })` then `getElement(true)` writes `src`, `alt`, `crossorigin`, and `loading` attributes on first render (mirrors `Video.test.ts`'s "records src / poster / autoplay / loop / muted / preload attribute writes", [Video.test.ts:106-127](packages/lib/tests/component/display/Video.test.ts#L106-L127)).
- Positional-vs-bag `src` precedence: the three rows under "`src` stays a required positional constructor argument" in `## Architecture Decisions`.

### `setSrc` cache invalidation and re-measure (unit-testable via the `_onLoad` bridge)

- Both tables under "`setSrc` invalidates `_naturalSize`..." in `## Architecture Decisions` — the reload-without-freezing case and the explicit-size-survives-reload case. These are the two rows that most need coverage: they are the regression this plan's `handleLoad()` edit exists to prevent.
- `setSrc` called before the element ever renders does not throw (mirrors the dependency plan's "never rendered" row).

### Deleted overrides (regression coverage, not new behaviour)

- With `render()` deleted, `getElement(true)` on a freshly constructed `Image` still writes every set attribute (`src` at minimum) to the element — proves `Component.render()` → `init()` → the base `_elementAttributes` buffer replay covers what the deleted override used to do manually.
- `getElement()` behaves identically to `Component.getElement()` (no override left to diverge).

### Manual verification (not automatable)

- Real browser: open the `Image` docs demo (`npm run docs:dev`, `/components/Image`), confirm `alt` text appears in the accessibility tree (e.g. via the browser's Accessibility panel), and that swapping `src` on a live instance re-measures the displayed size without a console error.

---

## Verification

- `npm run typecheck` — zero errors.
- `npm test` — `Image.test.ts` green, full suite green.
- `npm run docs:api` — zero TypeDoc warnings.
- `grep -n "_src\b" packages/lib/src/typescript/lib/component/display/Image.ts` — zero matches.
- `grep -n "getPreferredSizeConstraint" packages/lib/src/typescript/lib/component/display/Image.ts` — zero matches.
- Manual smoke test per `## Expected Behaviour`'s last bullet.

---

## Documentation Impact

`Image` gains seven attribute-backed fields and two setter overrides — update:

- **`packages/lib/docs/components/Image.md`**:
  - Replace the "Notes" bullet "The image URL is fixed at construction (`Image(src)`); there is no `setSrc` / `setAlt`. Construct a new `Image` to display a different source." — this is no longer true. Replace with something like: "`setSrc(url)` swaps the displayed image and re-measures on the next load, unless an explicit `preferredSize` is set (which survives a source change). Pass `alt` — an empty string for a purely decorative image — so screen readers get a label instead of the raw URL."
  - Add a "Common methods" row per new getter/setter pair (mirror [Video.md's table](packages/lib/docs/components/Video.md#L26-L40)).
  - Update the "Usage" example to include `alt`, e.g. `Image('/assets/logo.png', { alt: 'Company logo' })`.
  - Keep the existing CORS note; add one sentence that `crossOrigin` is now settable when the CORS response needs it.
- **`Image.ts`'s class-level JSDoc**: mention the new attribute setters and that `alt` provides the accessible name — see step 11.
- Run `npm run docs:api` (step 16) — must finish with zero warnings, including from any new `{@link}` (only link to public, documented symbols per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).

---

## Potential Challenges

- **`ReferrerPolicy` must resolve as a global type with no import.** It's part of TypeScript's built-in DOM lib (confirmed present in this environment's `lib.dom.d.ts`) and this project's `tsconfig.json` sets no explicit `"lib"` override, so the target-based default should include it. If `npm run typecheck` (step 12) disagrees, fall back to a local union type with the same literal set TypeScript ships (`"" | "no-referrer" | "no-referrer-when-downgrade" | "origin" | "origin-when-cross-origin" | "same-origin" | "strict-origin" | "strict-origin-when-cross-origin" | "unsafe-url"`).
- **Attribute-name casing.** `fetchpriority`, `crossorigin`, and `referrerpolicy` are single lower-case words with no internal capitalization in the actual HTML attribute, unlike their camelCase setter/IDL names. A typo here (`"fetchPriority"` instead of `"fetchpriority"`) silently writes the wrong attribute and would only surface as a missing effect in a real browser, not a type error — double-check each `setElementAttribute` call's first argument against the Public API table.
- **`_hasExplicitPreferredSize` is read only asynchronously (from `handleLoad`, fired by a native `load` event), so its constructor-body seed (`??=`) never races a read.** No mitigation needed; noted here so a reviewer doesn't need to re-derive it.
- **Future sibling plans also touch `Image.ts`.** See the last `## Architecture Decisions` subsection for the specific constraints this plan's shape puts on them.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts) — the file this plan rewrites.
- [packages/lib/src/typescript/lib/component/display/Video.ts](packages/lib/src/typescript/lib/component/display/Video.ts) (lines 52-76, 138-297) — the options-bag/typed-setter/`applyOptions` shape this plan mirrors for every new field.
- [plans/image-intrinsic-size-lifecycle.md](plans/image-intrinsic-size-lifecycle.md) — the dependency this plan builds on; defines `_naturalSize`, `handleLoad()`, and the exact fields/methods this plan's steps assume already exist.
- [packages/lib/src/typescript/lib/component/input/Text.ts](packages/lib/src/typescript/lib/component/input/Text.ts) (lines 143, 207-212, 388-402) — precedent for both the positional-arg-vs-options-bag guard and the `_hasExplicitPreferredSize`-style flag, including the cascade-timing bug this plan avoids by using `declare` (Text's own field is not `declare` and has the bug).
- [packages/lib/src/typescript/lib/core/Aria.ts](packages/lib/src/typescript/lib/core/Aria.ts) (`setLabel`/`clearLabel`, `setHidden`) — already-public API a consumer can reach for decorative-image edge cases; unchanged by this plan.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) (lines 782-827 `applyOptions`, 1690-1719 `setElementAttribute`/`removeElementAttribute`, 2180-2186 `getAria`, 3245-3365 `getPreferredSizeConstraint`/`getPreferredSize`/`setPreferredSize`/`clearPreferredSize`, 7291-7354 `init` attaching `_elementAttributes`) — every contract this plan's overrides must honor.
- [packages/lib/tests/component/display/Video.test.ts](packages/lib/tests/component/display/Video.test.ts) (lines 1-140) — the `Recorder`/`lastAttr` offline test pattern and the exact "attribute writes on render" / "setSrc round-trip" shapes to mirror.
- [ARCHITECTURE.md](ARCHITECTURE.md), "All attributes and styles go through typed setters" and "Three non-negotiable rules for every DOM write" — the rules this plan brings `Image` into compliance with.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), "Fields written during the `super()` cascade must use `declare`" — governs `_hasExplicitPreferredSize`.

---

## Non-Goals

- **`object-fit`/aspect-ratio, loading/error visual states, `srcset`/`decode()`.** Each is its own not-yet-drafted sibling plan; see the last `## Architecture Decisions` subsection for how this plan's shape constrains them.
- **A `decorative` boolean option or automatic `getAria().setHidden(true)` wiring.** `alt=""` already covers the decorative case per HTML/ARIA convention; see "Decorative images use `alt=""`" above.
- **`clearSrc`/`clearAlt`/`clear*` companions for the new setters.** `Video` has none for its comparable fields (`clearPoster`, `clearPreload`, etc. don't exist); this plan doesn't invent them either.
- **Fixing `Text._hasExplicitPreferredSize`'s own cascade-timing bug.** Flagged by the dependency plan's footnote and confirmed real while researching this plan (see Notes), but it's a pre-existing issue in a different file, unrelated to `Image`.
- **Live perimeter re-tracking, aspect-ratio preservation, or any other change to `handleLoad()` beyond the two lines this plan edits.** Everything else in `handleLoad()` is the dependency plan's, unchanged.

---

## Notes

[^glyph-not-precedent]: `Glyph`'s constructor takes a required positional `name: string` with no matching field on `GlyphOptions` and no setter (`Glyph.ts` — the class doc states the name "is fixed at construction and cannot be changed afterwards"). It is valid precedent for *keeping a required positional argument as sugar* (the audit's point), but it has no precedence rule to contribute, because it never has two sources to arbitrate between. `Image.src` does, once `ImageOptions.src` exists, so the precedent for the arbitration rule itself has to come from a component that actually has both — `Text`, `Markdown`, and `CodeEditor` all do, and all pick "bag wins."

[^explicit-flag]: Investigated whether `setSrc` could get away with only nulling `_naturalSize`, skipping the flag. It can't: `Component.getPreferredSizeConstraint()` only reports "is a preferredSize currently set", not "who set it" — after the first auto-publish, that constraint is non-null regardless of whether the caller or `handleLoad()` itself set it, so the dependency plan's original `!this.getPreferredSizeConstraint()` gate can never reopen on its own for an instance that has already auto-published once. Two designs were considered for tracking provenance. The chosen one — an explicit `declare` boolean flipped by overriding `setPreferredSize`/`clearPreferredSize`, with `handleLoad()`'s own auto-publish bypassing the override via `super.setPreferredSize(...)` — mirrors `Text.ts:388-402` exactly (`Text.setCalculatedSize` likewise calls `super.setPreferredSize` to avoid tripping its own override). The rejected alternative — comparing the current constraint against the last value `handleLoad()` itself published, with no override at all — avoids touching `setPreferredSize`, but has a real false-positive: a caller who happens to call `setPreferredSize` with a value that coincidentally equals a previous auto-publish would have that explicit call silently overwritten on the next load, since nothing would distinguish it from `handleLoad()`'s own write. The override-based flag has no such gap and is the pattern this codebase already uses for the identical problem, so it wins on both correctness and precedent. Copying `Text`'s field verbatim (a plain, non-`declare` field) was also considered and rejected: `Text.ts:143`'s `private _hasExplicitPreferredSize: boolean = false;` is not `declare`, and `Component.applyOptions` ([Component.ts:803](packages/lib/src/typescript/lib/core/Component.ts#L803)) calls `this.setPreferredSize(options.preferredSize)` polymorphically from inside `super()` — before that field's own initializer runs — so a `new Text(..., { preferredSize })` construction has its cascade-set `true` silently reset to `false` immediately after, per exactly the trap [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) documents. This plan confirmed the bug is live in `Text` today while researching this precedent; fixing it is out of this plan's scope (see `## Non-Goals`), but this plan does not repeat it — `_hasExplicitPreferredSize` on `Image` is declared bare and seeded explicitly in the constructor body instead.

[^alt-vs-aria]: Considered mirroring `Video`'s unconditional `this.getAria().setLabel("Video")` with something like `this.getAria().setLabel(alt)` inside `setAlt`. Rejected: `aria-label`, when present, wins over `alt` in the browser's accessible-name computation for an image, so writing both would make `aria-label` (a component-internal echo) shadow the very `alt` value the caller just set, for no benefit — `alt` alone is already the correct, native mechanism. `Video` needs `Aria` because `<video>` has no attribute that serves as an accessible name at all.

[^decorative]: `getAria().setHidden(true)` was considered as a second decorative-image mechanism (e.g. an option that calls both `setAlt("")` and `setHidden(true)`). Rejected as unnecessary duplication: `alt=""` is the standard, sufficient, and more portable mechanism (works even where ARIA support is partial), and a consumer who wants the belt-and-suspenders combination can already call `image.getAria().setHidden(true)` directly today — `Component.getAria()` is public and unchanged by this plan, so no new API is needed to support that combination.

[^attr-casing]: `fetchpriority`, `crossorigin`, and `referrerpolicy` are the literal HTML attribute names (confirmed against the HTML Living Standard); `loading`, `decoding`, `src`, and `alt` happen to already be single lower-case words so they don't raise the same question. The DOM IDL property names (`fetchPriority`, `crossOrigin`, `referrerPolicy`) are camelCase, and this plan names the TypeScript setters after the IDL property (matching `Video.setPreload`'s precedent of naming the setter after the concept, not the attribute string) while still writing the literal lower-case attribute name in the `setElementAttribute` call body.

[^render-delete]: Keeping `render()` as `protected render(): Handle { return super.render(); }` (satisfying only the audit's "mark it protected" instruction) was considered and rejected: it would be exactly the kind of dead pass-through the audit's own item 6 asks to delete `getElement()` for, just for a different method. `Video` — the shape precedent for the rest of this plan — has no `render()` override at all, confirming a component with a plain `<tag>` element and no render-time-only work doesn't need one.
