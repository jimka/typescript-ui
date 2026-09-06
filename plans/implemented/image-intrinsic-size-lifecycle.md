---
touches-shared: ["packages/lib/src/typescript/lib/component/display/Image.ts"]
---

# Image Intrinsic-Size and Load Lifecycle — Implementation Plan

## Overview

`Image` ([packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts)) reports its preferred and minimum size by reading `naturalWidth`/`naturalHeight` straight off the `<img>` element every time `getPreferredSize()` or `getMinSize()` is called. This diverges from how every other content-sized component in this library works: `Text` ([Text.ts:715](packages/lib/src/typescript/lib/component/input/Text.ts#L715)) and `Glyph` ([Glyph.ts:310](packages/lib/src/typescript/lib/component/display/Glyph.ts#L310)) measure intrinsic size once, cache it, and *publish* it upward through `setPreferredSize` — which fires the parent's re-layout relay. `Image` never does the publish step, so a decoded image's real dimensions never reach layout; worse, `getPreferredSize()` force-unwraps `getElement()` and throws before the component is even rendered.

This plan replaces the live-DOM-read design with the cache-and-publish pattern, using `Video` ([Video.ts:99](packages/lib/src/typescript/lib/component/display/Video.ts#L99)) as the template for wiring the non-bubbling `load`/`error` events (which cannot go through the framework's `Event` class — see [ARCHITECTURE.md](ARCHITECTURE.md), *Event handling*). It touches only `Image.ts`, its test file, and its docs page. Four sibling plans (not yet drafted) will build `src`/`alt` options, `object-fit`/aspect-ratio, loading/error visual states, and `srcset` on top of the class this plan produces — see `## Non-Goals` for the seam they'll need.

---

## Architecture Decisions

### Cache the natural size once; never read the DOM from a size getter

`getPreferredSize()` and `getMinSize()` stop calling `DOM.source.getNaturalSize()` directly. A new private field, `_naturalSize: Size | null`, is written exactly once per image load — by a native `load` handler wired in `init()` — and both size getters read that field instead.[^cache-field] This is the same shape as `Text._measuredMinSize`/`Text._measuredBaseline` (written by `applyNaturalMetrics`, read by `getPreferredSize`/`getMinSize`) and `Glyph`'s constructor-pinned size.

### `getPreferredSize()` becomes a thin pass-through to `Component.getPreferredSize()`

The override's entire body is `return super.getPreferredSize();`. `Component.getPreferredSize()` ([Component.ts:3267](packages/lib/src/typescript/lib/core/Component.ts#L3267)) already implements the full contract this component needs: explicit caller constraint wins, else the layout manager's opinion (`null` for a childless `Image`), else `null`. The override exists only to carry `Image`-specific JSDoc, matching the existing pass-through shape of `Image.getElement()` a few lines above it in the same file.[^thin-getPreferredSize]

### No persistent "explicit size" flag — gate on `getPreferredSizeConstraint()` at load time

`Text` needs a persistent `_hasExplicitPreferredSize` flag because it re-measures many times over its life (every text/font/width change) and must remember "explicit" across all of them. `Image`'s `load` event fires once per element in this plan's scope (`src` is construction-only — see `## Non-Goals`), so the `load` handler only needs to ask, at the single moment it fires, "does a preferred-size constraint already exist?" via `this.getPreferredSizeConstraint()`. If yes (caller passed `preferredSize` at construction, or called `setPreferredSize` before load fired), skip the publish. If no, publish the natural size.[^no-flag]

### Perimeter is added once, at publish time

`Component.getPreferredSize()`'s contract is the component's **outer** box (border + padding + content), per [ARCHITECTURE.md](ARCHITECTURE.md)'s size-constraint rules. `naturalWidth`/`naturalHeight` are content-box dimensions. The `load` handler adds `this.getPerimeterSize()` to the cached natural size before calling `setPreferredSize`, so the published value is correct even if a future caller sets a border or padding on an `Image` (today masked by the constructor's `clearInsets()` call, which zeroes insets but not border/padding).[^perimeter-once]

### Pre-load minimum is `{0, 0}`, not a magic floor

The current `{width: 20, height: 20}` fallback is an undocumented magic number. Once `getMinSize()` no longer reads the DOM, there is nothing image-specific to report before load — `Component.getMinSize()`'s own inherited default (`{0, 0}`, from `mergeConstraintSize`'s fallback when neither a constraint nor a layout-manager opinion exists) already means "no minimum," which is the correct pre-load statement. `getMinSize()` defers to `super.getMinSize()` in this case instead of inventing a floor.

### Native `load`/`error` bridge mirrors `Video`, with named fields instead of a handler map

`Video` re-emits 8 media events through a `Map<VideoMediaEvent, () => void>` built by a loop (`buildMediaHandlers`), because looping over 8 attach/detach calls earns back the map's indirection. `Image` has 2 events. This plan uses two named fields, `_onLoad` and `_onError`, wired individually in `init()`/`destructor()` — same native-bridge shape (`ListenerBag`, closed `listeners?` option, constructor-time `applyListeners`, `DOM.sink.addListener`/`removeListener`), without the map machinery a 2-entry loop doesn't pay for.[^two-fields]

### `getBaseline()` returns the bottom edge, with no offset

`Glyph.getBaseline()` returns `size.height - 3`: a deliberate upward nudge because glyph ink is a square icon shape that needs to sit slightly proud of a text baseline. `Image` content is arbitrary (a photo, a logo) with no equivalent ink-shape assumption, so this plan uses the plain bottom edge — `size.height` — matching the CSS default baseline for a replaced element. Returning `null` (the un-overridden default) is not an option: this codebase's row-layout auto-centers a component whose `getBaseline()` returns `null` rather than aligning it to its bottom edge, so a real number is required for an inline `Image` next to `Text` to baseline-align correctly.[^baseline]

---

## Public API

```typescript
// New exported type
export type ImageMediaEvent = "load" | "error";

// ImageOptions gains a closed listeners bag
export interface ImageOptions extends ComponentOptions {
    listeners?: {
        load?:  () => void;
        error?: () => void;
    };
}

// New public methods on Image
on(event: ImageMediaEvent, listener: () => void): this;
off(event: ImageMediaEvent, listener: () => void): this;
getBaseline(): number | null;
```

`getPreferredSize(): Size | null` and `getMinSize(): Size | null` keep their existing public signatures; only their bodies change.

---

## Internal Structure

New private state and lifecycle wiring on `Image`:

```typescript
// Cached once per load — see "Cache the natural size once" above. `null`
// before the image has decoded. Content-box dimensions (no perimeter).
private _naturalSize: Size | null = null;

private _listeners: ListenerBag<ImageMediaEvent> =
    this.registerListenerBag(new ListenerBag<ImageMediaEvent>());

// Stable per-instance references so `destructor()` removes the exact
// listener `init()` registered — mirrors Video's `_mediaHandlers` entries.
private readonly _onLoad:  () => void = () => this.handleLoad();
private readonly _onError: () => void = () => this.emit("error");
```

The `load` handler — the only place `DOM.source.getNaturalSize()` is still called:

```typescript
private handleLoad(): void {
    const element = this.getElement();
    if (!element) {
        return;
    }

    const natural = DOM.source.getNaturalSize(element);
    this._naturalSize = { width: natural.width, height: natural.height };

    if (!this.getPreferredSizeConstraint()) {
        const perimeter = this.getPerimeterSize();

        this.setPreferredSize({
            width:  this._naturalSize.width  + perimeter.left + perimeter.right,
            height: this._naturalSize.height + perimeter.top  + perimeter.bottom,
        });
    }

    this.emit("load");
}
```

`init()`/`destructor()`, mirroring [Video.ts:481-511](packages/lib/src/typescript/lib/component/display/Video.ts#L481-L511):

```typescript
protected init(element?: Handle): this {
    super.init(element);

    const el = element ?? this.getElement();
    if (!el) {
        return this;
    }

    DOM.sink.addListener(el, "load", this._onLoad);
    DOM.sink.addListener(el, "error", this._onError);

    return this;
}

protected destructor(): void {
    const element = this.getElement();

    if (element) {
        DOM.sink.removeListener(element, "load", this._onLoad);
        DOM.sink.removeListener(element, "error", this._onError);
    }

    super.destructor();
}
```

`getPreferredSize()` / `getMinSize()` / `getBaseline()` / `on()` / `off()` / `emit()`:

```typescript
getPreferredSize(): Size | null {
    return super.getPreferredSize();
}

getMinSize(): Size | null {
    if (!this.getMinSizeConstraint() && this._naturalSize) {
        return {
            width:  Math.min(this._naturalSize.width,  IMAGE_AUTO_MIN_CAP_PX),
            height: Math.min(this._naturalSize.height, IMAGE_AUTO_MIN_CAP_PX),
        };
    }

    return super.getMinSize();
}

getBaseline(): number | null {
    const size = this.getPreferredSize();

    return size ? size.height : null;
}

on(event: ImageMediaEvent, listener: () => void): this {
    this._listeners.add(event, listener);

    return this;
}

off(event: ImageMediaEvent, listener: () => void): this {
    this._listeners.remove(event, listener);

    return this;
}

protected emit(event: ImageMediaEvent): void {
    this._listeners.fire(event);
}
```

The constructor gains one line, after the existing `this.clearInsets();`:

```typescript
this.applyListeners(options?.listeners);
```

No `applyOptions` override is needed — `listeners` dispatches from the constructor body per [ARCHITECTURE.md](ARCHITECTURE.md)'s *Event handling*, not from `applyOptions`. `Image` is directly constructed (no subclass exists today), so the call is unconditional, matching `Video`'s own unconditional `applyListeners` call — no instance-identity guard needed.

---

## Ordered Implementation Steps

1. **Add the `ListenerBag` import.** In [Image.ts:3-7](packages/lib/src/typescript/lib/component/display/Image.ts#L3-L7), add `import { ListenerBag } from "~/core/ListenerBag.js";` alongside the existing imports.
   Verify: `grep -n "ListenerBag" packages/lib/src/typescript/lib/component/display/Image.ts` shows the import.

2. **Add the `ImageMediaEvent` type**, exported, just above `ImageOptions` (around [Image.ts:9](packages/lib/src/typescript/lib/component/display/Image.ts#L9)):
   ```typescript
   /**
    * The native, non-bubbling image events {@link Image} re-emits through its
    * custom `on` / `off` surface, wired directly on the element through the
    * DOM seam at render time (mirrors {@link Video}'s media-event bridge).
    *
    * @category Components
    */
   export type ImageMediaEvent = "load" | "error";
   ```

3. **Widen `ImageOptions`** ([Image.ts:17-18](packages/lib/src/typescript/lib/component/display/Image.ts#L17-L18)) to add the closed `listeners?` field from `## Public API`, with a doc comment matching `VideoOptions.listeners`'s style.

4. **Add the new private fields** from `## Internal Structure` (`_naturalSize`, `_listeners`, `_onLoad`, `_onError`) to the `Image` class body, near the existing `private _src: String;` at [Image.ts:42](packages/lib/src/typescript/lib/component/display/Image.ts#L42).

5. **Add `this.applyListeners(options?.listeners);`** to the constructor body ([Image.ts:51-56](packages/lib/src/typescript/lib/component/display/Image.ts#L51-L56)), after `this.clearInsets();`.

6. **Add `private handleLoad(): void`** from `## Internal Structure`, anywhere in the class body (suggested: just before `getPreferredSize()`).

7. **Replace `getPreferredSize()`** ([Image.ts:74-82](packages/lib/src/typescript/lib/component/display/Image.ts#L74-L82)) with the thin pass-through from `## Internal Structure`, and update its JSDoc ([Image.ts:69-73](packages/lib/src/typescript/lib/component/display/Image.ts#L69-L73)) to describe the caller-override-else-cached-else-null contract instead of "reads the DOM element."

8. **Replace `getMinSize()`** ([Image.ts:94-110](packages/lib/src/typescript/lib/component/display/Image.ts#L94-L110)) with the version from `## Internal Structure`. Update its JSDoc ([Image.ts:84-93](packages/lib/src/typescript/lib/component/display/Image.ts#L84-L93)) to describe the `{0, 0}` pre-load default (no more "20×20 fallback") and the `getMinSizeConstraint()`-based explicit check.

9. **Add `getBaseline()`**, `on()`, `off()`, `protected emit()` from `## Internal Structure`, each with a doc comment (see `## Documentation Impact`).

10. **Add `protected init(element?: Handle): this`** and **`protected destructor(): void`** from `## Internal Structure`.

11. **Update the class-level JSDoc** ([Image.ts:33-39](packages/lib/src/typescript/lib/component/display/Image.ts#L33-L39)) to mention the `load`/`error` re-emission and the "no opinion pre-load" contract — see `## Documentation Impact` for suggested text. Leave the `ImageOptions` `@remarks` ([Image.ts:12-13](packages/lib/src/typescript/lib/component/display/Image.ts#L12-L13)) unchanged — it already accurately describes the behavior this plan implements.

12. **Typecheck.** `npm run typecheck` — expect zero errors.

13. **Rewrite `packages/lib/tests/component/display/Image.test.ts`** per `## Expected Behaviour` below. Follow `Video.test.ts`'s pattern of casting to a narrow `Bridged` type to invoke `_onLoad`/`_onError` directly (the offline harness cannot dispatch a real non-bubbling `load` event) and `setNaturalSize` from `TestDOM.ts` to seed dimensions before invoking the handler.

14. **Run tests.** `npm test` (runs `typecheck:test` then `vitest run`) — all `Image.test.ts` cases green, no regressions elsewhere.

15. **Update `packages/lib/docs/components/Image.md`** per `## Documentation Impact`.

16. **Run `npm run docs:api`** — expect zero TypeDoc warnings (checks the new JSDoc's `{@link}` targets all resolve to public, documented symbols).

17. **Re-read the full diff of `Image.ts` once, end to end**, checking: every `DOM.source.getNaturalSize` call site is inside `handleLoad` only (`grep -n "getNaturalSize" packages/lib/src/typescript/lib/component/display/Image.ts` — expect exactly one hit); no leftover `{ width: 20, height: 20 }` fallback (`grep -n "20, height: 20" packages/lib/src/typescript/lib/component/display/Image.ts` — expect zero hits); `_naturalSize`/`_listeners`/`_onLoad`/`_onError` are all referenced somewhere (no orphans).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Image.ts` |
| Modify | `packages/lib/tests/component/display/Image.test.ts` |
| Modify | `packages/lib/docs/components/Image.md` |

---

## Expected Behaviour

All rows below are unit-testable offline: `TestDOM.ts`'s `setNaturalSize(handle, w, h)` seeds `DOM.source.getNaturalSize()`'s return value, and casting the `Image` instance to a narrow `{ _onLoad: () => void; _onError: () => void }` type (matching `Video.test.ts`'s `Bridged` type) lets a test invoke the handler directly in place of a real (non-bubbling, undispatchable-offline) `load`/`error` event. The only non-automatable case is a real browser decoding a real image end to end — manual-verify via the `image-basic` docs demo.

### Size reporting

| Scenario | `getPreferredSize()` | `getMinSize()` |
|---|---|---|
| Never rendered (`getElement()` returns `undefined`) | `null`, no throw | `{0, 0}` |
| Rendered, pre-load, no explicit size | `null` | `{0, 0}` |
| Rendered, `_onLoad()` fires with natural `300×200`, no explicit size | `{300, 200}` | `{100, 100}` (capped by `IMAGE_AUTO_MIN_CAP_PX`) |
| Rendered, `_onLoad()` fires with natural `16×16`, no explicit size | `{16, 16}` | `{16, 16}` (under the cap) |
| Constructed with `{ preferredSize: { width: 120, height: 40 } }`, then `_onLoad()` fires with natural `300×200` | `{120, 40}` (unchanged) | `{100, 100}` (min still auto-derives from natural size, independent of the preferred-size constraint) |
| `setMinSize({ width: 40, height: 50 })` called (before or after `_onLoad()`), no `preferredSize` set | auto-fits from natural size as normal — a `minSize` constraint doesn't gate the preferred-size publish | `{40, 50}` (wins regardless of load state) |

### Events

| Native event | Re-emitted as | Payload | Side effect |
|---|---|---|---|
| `load` | `"load"` | none | caches `_naturalSize`; publishes `preferredSize` iff no constraint was already set |
| `error` | `"error"` | none | none |

- `on("load", fn)` / `on("error", fn)` register a listener; `off` removes it; a constructor `listeners: { load, error }` bag registers the same way via `applyListeners`.
- `_onLoad()` firing with no explicit preferred size calls `this.setPreferredSize(...)`, which (per `Component.setPreferredSize`, already covered by `Component.test.ts`'s "case 4") calls `_onPreferredSizeChange` — verify by assigning a `vi.fn()` spy directly to the cast `_onPreferredSizeChange` field before calling `_onLoad()`, matching `Component.test.ts:191`'s pattern.
- `destructor()` (via `dispose()`) removes both native listeners — assert via the recording sink's `removeListener` op, matching `Video.test.ts`'s "detaches native listeners on dispose" case.
- `init()` registers both native listeners at render — assert via the recording sink's `addListener` ops, whose types include `"load"` and `"error"`.

### Baseline

| Scenario | `getBaseline()` |
|---|---|
| Pre-load, no explicit preferred size | `null` |
| Post-load, natural `300×200`, no explicit size | `200` |
| Explicit `preferredSize: { width: 120, height: 40 }` | `40` |

---

## Verification

- `npm run typecheck` — zero errors.
- `npm test` — `packages/lib/tests/component/display/Image.test.ts` green, full suite green (no regressions in components that lay out an `Image`, e.g. any container test fixture that includes one).
- `npm run docs:api` — zero TypeDoc warnings (validates every new `{@link}`).
- `grep -n "getNaturalSize" packages/lib/src/typescript/lib/component/display/Image.ts` — exactly one match, inside `handleLoad`.
- Manual smoke test (real browser, not automatable): open the `Image` docs demo (`npm run docs:dev`, per this project's dev-URL convention, `/components/Image`), confirm the inline SVG data-URI image renders at its natural size with no console error, and that resizing the window doesn't throw.

---

## Documentation Impact

`Image` gains public API (`on`, `off`, `getBaseline`, the `listeners` option, the `ImageMediaEvent` type) — update:

- **`packages/lib/docs/components/Image.md`**: add an `## Events` section mirroring [Video.md's](packages/lib/docs/components/Video.md#L42-L46) shape:
  ```markdown
  ## Events

  `load` and `error` do not bubble, so they cannot route through the framework's
  window-level `Event` layer. `Image` wires them natively at render time and
  re-emits them through its own `on` / `off` surface: `load`, `error`.
  ```
  Add `on(event, fn)` / `off(event, fn)` to the "Common methods" table. The existing "Notes" bullet — "the component reports the image's natural dimensions once loaded" — already accurately states the behavior this plan implements; leave it as-is and add one new bullet: "Before the image has loaded (and with no explicit `preferredSize`), `getPreferredSize()` returns `null` — no placeholder size is reported."
- **`Image.ts`'s own class-level JSDoc** ([Image.ts:33-39](packages/lib/src/typescript/lib/component/display/Image.ts#L33-L39)): see step 11 above.
- Run the `document` skill's conventions check (per this project's `CLAUDE.md`) if it flags anything `npm run docs:api` doesn't already catch.

---

## Potential Challenges

- **`getElement()` inside `init()` may not resolve.** `Video.ts`'s own comment ([Video.ts:533-539](packages/lib/src/typescript/lib/component/display/Video.ts#L533-L539)) documents that during `init()`, the element is created but not yet attached, so `getElement()` (an id-based document lookup) can return nothing. Mitigation: `init()` uses `element ?? this.getElement()`, exactly as designed above — never `this.getElement()` alone.
- **A future `setSrc()` will re-trigger `load` on the same instance.** This plan's gate (`getPreferredSizeConstraint()` checked once per `load` firing) is correct only because `load` fires once per instance today. If a sibling plan adds a mutable `src`, a second `load` after `setPreferredSize` already auto-published once would see a non-null constraint (its own prior auto-publish) and wrongly treat it as caller-authored, freezing the size at the first image's dimensions. That plan will need `Text`'s persistent-flag pattern (`_hasExplicitPreferredSize`, distinguishing "caller set it" from "we auto-set it") — see `## Non-Goals`.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts) — the file this plan rewrites.
- [packages/lib/src/typescript/lib/component/display/Video.ts](packages/lib/src/typescript/lib/component/display/Video.ts) — the native non-bubbling event bridge precedent (`ListenerBag`, `applyListeners`, `init`/`destructor` pairing, `_mediaHandlers`-style stable references).
- [packages/lib/src/typescript/lib/component/input/Text.ts](packages/lib/src/typescript/lib/component/input/Text.ts) (lines 143, 388-402, 511-543, 715-731, 764-798) — the cache-then-publish precedent, and (per `## Architecture Decisions`) the pattern this plan deliberately diverges from on the explicit-size flag.
- [packages/lib/src/typescript/lib/component/display/Glyph.ts](packages/lib/src/typescript/lib/component/display/Glyph.ts) (lines 310-332) — `setPreferredSize` pinning and the `getBaseline` precedent.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) (lines 3245-3436, 3655-3689, 7126-7131) — `getPreferredSizeConstraint`, `getPreferredSize`, `getMinSizeConstraint`, `getMinSize`, `getPerimeterSize`, `notifyIntrinsicSizeChanged` — the contracts this plan's overrides must honor.
- [packages/lib/tests/component/display/Video.test.ts](packages/lib/tests/component/display/Video.test.ts) (lines 244-314) — the exact offline test pattern (direct handler invocation, `addListener`/`removeListener` op assertions) to mirror in the rewritten `Image.test.ts`.
- [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts) (lines 1572-1577) — `setNaturalSize`, the seam that makes this lifecycle testable offline.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Fields written during the `super()` cascade must use `declare`* — relevant because this plan's fields are deliberately written outside the cascade (see `## Notes`), not because any field here needs `declare`.

---

## Non-Goals

- **`src`/`alt` options and attribute-backed construction.** Covered by a sibling plan. `_src: String` and `render()`'s `setAttr: { src }` write are untouched here.
- **`object-fit`/aspect-ratio preservation and the `IMAGE_AUTO_MIN_CAP_PX` *width/height cap* redesign.** Covered by a sibling plan. This plan keeps the existing 100px cap value and logic unchanged, only relocating where it reads from (`_naturalSize` instead of a live DOM read).
- **Loading/error visual states (style states, spinners, broken-image placeholders).** Covered by a sibling plan. This plan's `error` handling is limited to re-emitting a public `"error"` event with no visual response.
- **`srcset`/`decode()`.** Covered by a sibling plan.
- **Re-triggering `load` on a source change.** Out of scope because `src` is immutable in this plan (see above). See `## Potential Challenges` for what the `setSrc` sibling plan will need to add.

---

## Notes

[^cache-field]: **Cache-field contract for sibling plans.** `_naturalSize: Size | null`, private, content-box (no perimeter) dimensions, written exactly once by `handleLoad()` when the native `load` event fires, `null` before that. Not invalidated or re-written anywhere else in this plan. A sibling plan that makes `src` mutable (re-triggering `load`) will need to decide how `_naturalSize` behaves across a second load (likely: overwrite, plus the persistent-flag fix noted in `## Potential Challenges`). A sibling plan needing to read it externally (e.g. for aspect-ratio math) should add a public accessor at that point — no getter exists yet, since nothing in this plan's scope needs one (Simplicity First: no speculative API surface).

[^thin-getPreferredSize]: Deleting the override entirely (relying purely on inheritance, as `Glyph` and `Video` both do — neither overrides `getPreferredSize`) was considered and would work identically at runtime. This plan keeps a one-line override instead, matching the existing pass-through shape of `Image.getElement()` ([Image.ts:65-67](packages/lib/src/typescript/lib/component/display/Image.ts#L65-L67)) already in this file, purely so the method carries `Image`-specific JSDoc rather than forcing a reader to look up `Component`'s generic contract. Either choice is behaviorally correct; this plan picks the one consistent with the file's own existing convention.

[^no-flag]: Investigated whether `Image` needs `Text`'s `_hasExplicitPreferredSize` flag-plus-override machinery. It does not, because `Image`'s `load` fires once per instance in this plan's scope, while `Text` re-measures on every text/font/width/theme change and must remember "explicit" across arbitrarily many of those. A flag would in fact be *worse* here: `Text._hasExplicitPreferredSize` is a plain (non-`declare`) field written to `true` by a `setPreferredSize` override that `Component.applyOptions` ([Component.ts:803](packages/lib/src/typescript/lib/core/Component.ts#L803)) dispatches polymorphically *during* the `super()` cascade — before `Text`'s own field initializers run. Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s "Fields written during the `super()` cascade must use `declare`", a plain initializer run after the cascade silently resets a cascade-written field back to its default, which is exactly what `_hasExplicitPreferredSize`'s own field declaration (`= false`, not `declare`) would do to a value the cascade just set to `true` for a `new Text(..., { preferredSize })` construction. Whether this is a live bug in `Text` today is outside this plan's scope to fix — it is raised here only to explain why this plan does not copy that shape onto `Image`: checking `getPreferredSizeConstraint()` at the moment `load` fires sidesteps the whole cascade-timing question, because it needs no field write during construction at all.

[^perimeter-once]: This bakes the perimeter into the published value only once, at the moment `load` fires. If a caller changes border or padding on an already-loaded `Image` afterward, the previously-published preferred size goes stale (does not grow to match). This matches the scope of the audit finding this plan fixes (item 9: the *initial* publish must account for perimeter) and avoids adding live perimeter-tracking, which `Text`'s own precedent doesn't do either (`Text.setCalculatedSize` never adds perimeter to its measured size at all). `getPerimeterSize()` itself is cheap (reads cached insets/border/padding, no DOM), so a future plan could add live tracking cheaply if this staleness ever proves to matter in practice.

[^two-fields]: `Video`'s `Map<VideoMediaEvent, () => void>` plus its loop-based `buildMediaHandlers()`/`attachMediaListeners()` (and the matching `for...of` loop inline in `destructor()`) exists to avoid repeating the same attach/detach call 8 times. For `Image`'s 2 events, the loop's own setup (a `Map`, a `for...of`, a constant array of type names) costs about as much code as just writing the 2 calls directly, so this plan writes them directly — per [ARCHITECTURE.md](ARCHITECTURE.md)'s *Compose before specializing* judgment ("the bar is... does it actively reduce total complexity"), the map abstraction does not pay for itself at n=2.

[^baseline]: The project's own `Component.getBaseline()` JSDoc ([Component.ts:3704](packages/lib/src/typescript/lib/core/Component.ts#L3704) area) states that a `null` baseline is "treated as if their bottom edge were the baseline (CSS replaced-element behavior)" — but this plan follows the working precedent (`Glyph`, and this project's own prior finding that row layout auto-centers a `null` baseline rather than bottom-aligning it) over that comment's stated intent, since `Glyph` already needed a real numeric override to get bottom/baseline alignment in practice rather than relying on `null`.

---

## Implementation Notes

**`getMinSize()`'s explicit-check reads `this.instanceLayer().authored.minSize`, not `this.getMinSizeConstraint()` as `## Internal Structure` specifies.** The plan's given code, `if (!this.getMinSizeConstraint() && this._naturalSize)`, was written test-first and immediately failed: `getMinSizeConstraint()` is documented on `Component` itself (`Component.ts` around line 3368) as returning "the caller/setter value, **else the class default**" — and `ComponentDefaults.ts`'s `resolveClassDefaults` unconditionally seeds every component's `_defaultOptions` with `BASE_DEFAULTS.minSize = { width: 0, height: 0 }` (frozen, shared across all classes). So `getMinSizeConstraint()` returns `{0, 0}` — a truthy object — for *every* `Image`, whether or not a caller ever called `setMinSize`, and the plan's `!this.getMinSizeConstraint()` guard is never true. Verified with a scratch debug test: `getMinSizeConstraint()` on a fresh `Image` returns `{"width":0,"height":0}`, while `this.instanceLayer().authored.minSize` (checking only the instance-authored style bag, bypassing the class-tier fallback) correctly reads `undefined` pre-`setMinSize` and the real value after. This is exactly what the pre-plan code already did (`this.instanceLayer().authored.minSize`), so the fix restores that one check while keeping every other part of the plan's `getMinSize()` (the cache field, the cap, the `{0, 0}` pre-load default) as specified. The `## Expected Behaviour` table's min-size rows now pass as written; no other part of the plan needed a change.

**Two small additions the plan's `## Ordered Implementation Steps` didn't spell out, both required by the plan's own stated goals:**
- `packages/lib/tests/component/dispose-full-teardown.test.ts` gained an `Image` row in its class-wide destructor-coverage registry (mirroring the existing `Video` row). This project-wide test asserts every class with a `protected destructor()` is either covered by a row or listed in its shrink-only unclaimed baseline; adding `Image.destructor()` per this plan's `## Internal Structure` made the registry fail without a matching row.
- `packages/lib/src/typescript/lib/component/display/index.ts` now re-exports `ImageMediaEvent` (mirroring the existing `VideoMediaEvent` re-export). The plan's `## Public API` lists `ImageMediaEvent` as a new exported type, but the type is only importable from the package's public entry point once the barrel file re-exports it — without this, `npm run docs:api` warned that `ImageMediaEvent` is referenced by `Image.off`'s signature but not included in the documentation.

**A first audit round found four BLOCKING gaps in the initial implementation, all fixed on this branch:**
- **`handleLoad()`'s two branches are inverted relative to `## Internal Structure`'s snippet, and the constraint branch now calls `notifyIntrinsicSizeChanged()`.** The plan's `handleLoad` is a single `if (!this.getPreferredSizeConstraint()) { …publish… }` with no `else`. An explicit `preferredSize` still leaves `_naturalSize` freshly cached, which changes what `getMinSize()` reports (see the auto-derived-minimum branch above) — but nothing signals that upward, since neither `setPreferredSize` nor `setMinSize` runs when the publish is skipped. The shipped code restructures the same two branches as `if (this.getPreferredSizeConstraint()) { this.notifyIntrinsicSizeChanged(); } else { …publish… }`, so the constraint branch relays the min-size change the same way `Component.notifyIntrinsicSizeChanged()`'s own doc comment (`Component.ts:7126`) describes: "preferred and minimum sizes changed for a reason the framework cannot observe." Covered by a new test spying on `_onPreferredSizeChange`/`_onConstraintSizeChange`.
- **The perimeter-inclusive publish (`## Architecture Decisions`, *Perimeter is added once, at publish time*) was untested.** Every existing test builds a bare `Image` whose `clearInsets()` plus absent border/padding makes `getPerimeterSize()` a no-op, so the `+ perimeter.*` arithmetic in `handleLoad()` could be deleted without failing anything. Fixed with a test that sets `padding` at construction and asserts the perimeter is folded into the published size.
- **No changelog entry.** `packages/lib/docs/reference/changelog/next.md` gained a `## Changed` → `### Components` bullet — the plan's `## Documentation Impact` never listed the changelog, but this branch adds public API and changes documented behaviour, and every comparable change on `master` updates that page.
- **The plan's designated manual-verify demo doesn't exercise the behaviour it's meant to verify.** `## Expected Behaviour`'s closing line names `image-basic` as the manual-verify demo for "a real browser decoding a real image end to end," and `## Verification`'s smoke-test bullet points at the `Image` docs page generically — but `image-basic` (`packages/docs/src/demos/image-basic.ts`) pins `preferredSize: {80,80}` at construction, which is exactly the branch `handleLoad()` skips the publish on. It cannot show the natural-size auto-fit this plan adds. A second demo, `image-auto-fit` (`packages/docs/src/demos/image-auto-fit.ts` — no `preferredSize`, an inline SVG with explicit `width`/`height="64"` on its root so its browser-reported natural size actually is 64×64, and a `Text` status line updated from `on('load', ...)`), was added and embedded on the `Image` docs page via a second `<!-- demo: image-auto-fit -->` block; `Image.test.ts`'s manual-verify comment now points at it instead of `image-basic`. This is the demo the plan's `## Expected Behaviour` and `## Verification` should have named; treat `image-auto-fit`, not `image-basic`, as the manual-verify demo for this plan's central behaviour going forward. (An SVG with no explicit `width`/`height` reports a browser-default natural size derived from its `viewBox` aspect ratio rather than that `viewBox`'s own dimensions — `image-basic`'s SVG, which has no `width`/`height`, was live-measured at 150×150 despite its `viewBox="0 0 64 64"`; `image-auto-fit`'s corrected SVG was live-verified at the intended 64×64. `image-basic` itself is unchanged, since it predates this plan and pinning `preferredSize` was always its point.)

**A second audit round found two further BLOCKING gaps, both documentation-only fixes (no behavior change — the underlying facts were already true of the shipped code, the docs were wrong):**
- **`packages/lib/docs/concepts/sizing.md`'s baseline section still listed `Image` among the components whose `getBaseline()` returns `null` and center-aligns in a row.** This plan makes `Image.getBaseline()` return a real bottom-edge value (per `## Architecture Decisions`, *`getBaseline()` returns the bottom edge, with no offset*), so `Image` no longer belongs in that list; the page now calls it out as bottom-aligning instead, mirroring the wording already used for `Glyph`'s equivalent (undocumented, pre-existing) exception. Missed initially because the plan's `## Documentation Impact` only named `Image.md` and `Image.ts`'s own class JSDoc, not this framework-level concepts page.
- **`ImageOptions`'s `@remarks` (`Image.ts`) and `Image.md`'s "Common methods" row overstate what `preferredSize` pins.** Both said supplying `preferredSize` "locks"/"pins" the *rendered* size. It only pins the *preferred* size: `getMinSize()` still auto-derives a floor from the natural size independently of `preferredSize` (unchanged behavior — this plan only relocated where that floor reads from, per `## Non-Goals`), and a parent layout floors the committed size to that minimum regardless. Live-verified on `image-basic`: a `preferredSize: {80,80}` over a (150×150-natural, per the note above) source image renders at 100×100, not 80×80. This plan's own step 11 said to leave the `@remarks` unchanged as "already accurate" — that call was wrong; both the `@remarks` and the docs page now describe the min-floor interaction and point callers at `setMinSize()` when a smaller pinned size must render exactly as given. No code changed; `IMAGE_AUTO_MIN_CAP_PX`'s redesign remains an explicit Non-Goal for a sibling plan.
