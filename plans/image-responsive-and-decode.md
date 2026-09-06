---
depends-on: [image-intrinsic-size-lifecycle, image-attribute-options-surface]
touches-shared: ["packages/lib/src/typescript/lib/component/display/Image.ts", "packages/lib/src/typescript/lib/core/DOM.ts"]
---

# Image Responsive Sources and Proactive Decode — Implementation Plan

## Overview

`Image` ([packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts)) gains two loading-pipeline enhancements once `image-intrinsic-size-lifecycle` ([plans/image-intrinsic-size-lifecycle.md](plans/image-intrinsic-size-lifecycle.md)) and `image-attribute-options-surface` ([plans/image-attribute-options-surface.md](plans/image-attribute-options-surface.md)) have both landed: responsive `srcset`/`sizes` attributes, and a proactive `decode()` call that resolves the image's natural size before first paint instead of waiting only for the native `load` event. Both build directly on the cached-natural-size, cache-once-per-`load`-event model the lifecycle plan built into `handleLoad()`, and on the attribute-backed setter / `applyOptions` shape the options-surface plan built for `src` / `alt` / `loading` / etc.

`srcset` and `sizes` are two more attribute-backed fields, added in exactly that shape. Their wrinkle is timing, not mechanism: the browser picks a `srcset` candidate from the element's *rendered* width, which this framework only knows once layout runs (`ARCHITECTURE.md`, *Positioning is always absolute* — every component is positioned and sized after construction, not during it). A later resize can cross a breakpoint and make the browser swap candidates, firing a second `load` event carrying a different natural size. This plan changes `handleLoad()` so it republishes the preferred size, and re-emits `"load"`, only when the newly measured size actually differs from what is already cached — so a same-size resettle (including one this plan's own `decode()` call can itself cause, see below) never churns layout or double-announces.

The `decode()` half adds one new seam verb, `DOM.sink.decodeImage(handle): Promise<void>` — `HTMLImageElement.decode()` reached through the DOM seam, following `Video`'s precedent of adding media-specific verbs (`setVolume`, `mediaPlay`, `setPlaybackRate`, …) where the generic `DOMSink` / `DOMSource` API has no equivalent. `Image` calls it itself, automatically, right after every source change and at first render, and feeds a successful result into the same `handleLoad()` that the native `load` listener drives, and a failed one into the same `_onError()` the native `error` listener drives — so a decode failure converges on whatever error handling currently exists (today, a bare `emit("error")`; `.broken` styling once the separate, non-dependency `image-loading-error-states` plan lands).

This plan touches `Image.ts`, `core/DOM.ts` (the new seam verb and both its implementations), `Image.test.ts`, `tests/dom/TestDOM.ts` (the modelled counterpart the new verb needs to keep implementing `DOMSink`), and `docs/components/Image.md`.

---

## Architecture Decisions

### `image-attribute-options-surface` is a hard dependency; `image-loading-error-states` is not

This plan's own code calls four symbols that only exist once `image-attribute-options-surface` has landed: `getLoading()` (the `loading: "lazy"` skip below), the existing `setSrc()` method (this plan adds a call inside its body), the existing `applyOptions()` override (this plan adds two dispatch lines inside its body), and the `_hasExplicitPreferredSize` gate inside `handleLoad()` (this plan's own edit sits directly above it and must reason about how the two interact). None of that is true of `image-loading-error-states` — this plan never names `.broken`, `isBroken()`, or `handleError()`; it only ever calls the stable `_onError()` field, whose *body* may or may not have been widened by that plan, without needing to know which.[^hard-dep]

### `srcset` / `sizes` are attribute-backed fields in exactly `image-attribute-options-surface`'s shape

`ImageOptions` gains `srcset?: string` and `sizes?: string`; `getSrcset` / `setSrcset` and `getSizes` / `setSizes` cache into `_options` and write through `setElementAttribute`, dispatched from the existing `applyOptions` override — the same shape as that plan's `setAlt` / `setLoading`. Neither value needs normalization, so neither gets a private backing field.

### A `load` signal republishes only when the measured size actually changed

`handleLoad()` gains an early return, inserted right after it reads the fresh natural size and before anything else: if that size equals the currently cached `_naturalSize`, it returns immediately — no `setPreferredSize`, no style-state churn (whatever the current sibling-plan shape of that is), no `"load"` emit. A first-ever measurement (`_naturalSize` still `null`) never matches, so the pre-existing, single-`load` case from the lifecycle plan is unaffected.

| Event | Measured size | Cached `_naturalSize` before | Result |
|---|---|---|---|
| First native `load` (no `decode()` involved) | 300×200 | `null` | Differs (nothing cached yet) → cache, publish, emit `"load"` |
| `decode()` resolves, then the native `load` fires moments later for the same settled candidate | 300×200, then 300×200 again | `null`, then 300×200 | First call differs → full work. Second call matches → early return, no second emit |
| Resize crosses a breakpoint; browser swaps `srcset` candidate; native `load` refires | 600×400 | 300×200 | Differs → cache, publish, emit `"load"` again |
| A later resize swaps back to a candidate with the same natural size as an *earlier*, not the *immediately prior*, measurement | 300×200 | 600×400 | Differs from 600×400 → still republishes (the comparison is only ever against the *current* cache, never the whole history) |

This single rule answers two separate questions with one mechanism. For `srcset`, it is the deliberate choice on churn: republishing on every native `load` regardless of content would make `.loading`-style churn and relayout track the browser's candidate-selection noise instead of an actual size change.[^size-diff-churn] For `decode()`, it is what makes calling `handleLoad()` from two independent triggers (a proactive `decode()` and the native listener) safe without a second, redundant mechanism — see the next two decisions.

### `decode()` is a new `DOM.sink` verb, not `DOM.source`

`DOMSink` already holds action verbs whose promise is either dropped (`mediaPlay`, `requestFullscreen` — result observed through events instead) or, in `mountView` / `createViewElement`'s case, returned synchronously because the write itself produces a value the caller needs. `DOMSource` holds exactly one asynchronous method, `readClipboardText()`, which is a **data read** — its whole point is the string it hands back. `decodeImage` is not a data read: its point is *when* it settles, the same completion signal `mediaPlay`/`requestFullscreen` already model as a Sink action — the only difference is that here the caller genuinely needs to observe the settlement (to know when to measure and publish), rather than discarding it as those two do. It goes on `DOMSink`, extending the existing "an action can return something the write produced" shape those two methods already carry, one step further to "the something is a promise."[^seam-placement]

### `Image` triggers `decode()` itself; no public method, no opt-out option

The whole point of this feature is to remove a jank window every `Image` has today, not to require every call site to opt in. `Image` calls `DOM.sink.decodeImage` from `init()` (first render) and from `setSrc` / `setSrcset` / `setSizes` (a later source change), with no new public method and no `ImageOptions` field to disable it.[^auto-decode]

### The automatic decode is skipped for `loading: "lazy"`

Calling `decode()` forces the browser to fetch and decode immediately, even for an element marked `loading="lazy"` — this is a documented browser behavior, not a framework quirk, and it would silently defeat the attribute `image-attribute-options-surface` just added. `triggerDecode()`'s first line is `if (this.getLoading() === "lazy") { return; }`.[^lazy-skip]

### Two guards protect every `decode()` settlement: a generation counter and a live-element recheck

Calling `decode()` again on the same element (because `setSrc` / `setSrcset` / `setSizes` ran again before the previous decode finished) can make the *previous* call's promise reject for reasons that have nothing to do with a broken image — the request was simply superseded. Naively routing every rejection to `_onError()` would run whatever failure handling exists today on a perfectly healthy, just-updated `Image`. `triggerDecode()` mints a private `_decodeGeneration` counter, captures it before calling `DOM.sink.decodeImage`, and both the success and failure continuation check it still matches `this._decodeGeneration` before doing anything — a stale settlement is silently dropped.

The second guard is unrelated: a settlement can also arrive after the component itself has been destroyed while the decode was in flight. Both continuations re-fetch `this.getElement()` and no-op if it's now `undefined` — the exact pattern `TextInput.paste()` already uses for its own pending-clipboard-read case (`TextInput.ts:795-797`, "the field may have been destroyed while the read was in flight").[^disposal-guard]

| Sequence | Outcome |
|---|---|
| `decode()` for `/a.png` still pending; `setSrc("/b.png")` called (bumps the generation, starts a new decode) | The `/a.png` decode's eventual settlement (success or failure) is ignored — its captured generation no longer matches |
| `decode()` pending; `image.dispose()` called; the promise then settles | Ignored — `getElement()` now returns `undefined` |
| `decode()` for the current source resolves, generation still current, element still live | `handleLoad()` runs normally |
| `decode()` for the current source rejects, generation still current, element still live | `_onError()` runs normally |

### `_decodeGeneration` stays a plain field, not `declare`

Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s cascade-timing rule, a field only needs `declare` when a cascade-dispatched setter (one `applyOptions` calls from inside `super()`) writes it before its own initializer would run. `_decodeGeneration` is written only inside `triggerDecode()`, which every call site reaches through a `this.getElement()` truthiness guard — and no element exists yet during the `super()` cascade (nothing has rendered before the constructor body itself runs), so `triggerDecode()` structurally cannot execute before `_decodeGeneration`'s own `= 0` initializer has already run. A plain field is correct and simpler than working around a trap that does not apply here.

---

## Public API

New `DOMSink` method (`core/DOM.ts`):

```typescript
export interface DOMSink {
    // ...existing methods...

    /**
     * Forces the browser to fetch and fully decode an image, resolving once
     * it is ready to paint — the same readiness point the element's own
     * `load` event settles at, reached earlier and as an awaitable signal
     * instead of only an event. Rejects if the resource fails to load or the
     * decode is aborted (e.g. a `src` change before this decode finished);
     * the caller is responsible for ignoring a rejection that arrives after
     * a newer request has superseded it.
     *
     * @param handle - The `<img>` element handle.
     * @returns A promise that resolves once decoded, or rejects on failure/abort.
     */
    decodeImage(handle: Handle): Promise<void>;
}
```

New `Image` fields and methods:

```typescript
export interface ImageOptions extends ComponentOptions {
    // ...existing fields from image-attribute-options-surface...
    srcset?: string;
    sizes?:  string;
}

class Image extends Component<ImageOptions> {
    getSrcset(): string | null;
    setSrcset(value: string): this;

    getSizes(): string | null;
    setSizes(value: string): this;
}
```

No other `Image` method's public signature changes. `decodeImage` is not exposed on `Image` itself — see *`Image` triggers `decode()` itself* above.

---

## Internal Structure

The new private field, alongside `_naturalSize` / `_hasExplicitPreferredSize`:

```typescript
// Bumped once per triggerDecode() call. A decode() settlement whose captured
// generation no longer matches this field belongs to a source that has since
// been replaced (setSrc/setSrcset/setSizes ran again before it finished) and
// is silently ignored — see "Two guards protect every decode() settlement"
// in Architecture Decisions.
private _decodeGeneration = 0;
```

The two new attribute-backed setter pairs, matching `setAlt`'s shape exactly:

```typescript
getSrcset(): string | null {
    return this._options.srcset ?? null;
}

setSrcset(value: string): this {
    this._options.srcset = value;
    this.setElementAttribute("srcset", value);
    this._naturalSize = null; // a new candidate set is stale — re-measure on the next settle

    const element = this.getElement();

    if (element) {
        this.triggerDecode(element);
    }

    return this;
}

getSizes(): string | null {
    return this._options.sizes ?? null;
}

setSizes(value: string): this {
    this._options.sizes = value;
    this.setElementAttribute("sizes", value);
    this._naturalSize = null; // sizes changes which candidate the browser resolves — re-measure

    const element = this.getElement();

    if (element) {
        this.triggerDecode(element);
    }

    return this;
}
```

`triggerDecode`, the shared proactive-decode trigger every source-changing setter and `init()` calls:

```typescript
/**
 * Proactively decodes the current source so its natural size is known
 * before first paint — the resource is fetched either way; this only
 * changes when Image learns the result. Skipped for `loading: "lazy"`,
 * where forcing a decode would defeat the whole point of lazy loading. Each
 * call supersedes any decode still in flight from a previous source; a
 * stale settlement (this call's generation no longer current, or the
 * component destroyed while the decode was in flight) is silently ignored.
 *
 * @param element - The rendered `<img>` element to decode.
 */
private triggerDecode(element: Handle): void {
    if (this.getLoading() === "lazy") {
        return;
    }

    const generation = ++this._decodeGeneration;

    void DOM.sink.decodeImage(element)
        .then(() => {
            if (generation === this._decodeGeneration && this.getElement()) {
                this.handleLoad();
            }
        })
        .catch(() => {
            if (generation === this._decodeGeneration && this.getElement()) {
                this._onError();
            }
        });
}
```

`setSrc` (defined by `image-attribute-options-surface`) gains the same trigger, inserted between its existing `this._naturalSize = null;` line and its final `return this;`:

```typescript
setSrc(src: string): this {
    this._options.src = src;
    this.setElementAttribute("src", src);
    this._naturalSize = null;

    const element = this.getElement();

    if (element) {
        this.triggerDecode(element);
    }

    return this;
}
```

`applyOptions` (defined by `image-attribute-options-surface`) gains two dispatch lines:

```typescript
protected applyOptions(options: ImageOptions): this {
    super.applyOptions(options);

    // ...existing dispatch lines...
    if (options.srcset !== undefined) this.setSrcset(options.srcset);
    if (options.sizes  !== undefined) this.setSizes(options.sizes);

    return this;
}
```

`init()` (defined by `image-intrinsic-size-lifecycle`) gains one line, after the two `addListener` calls:

```typescript
protected init(element?: Handle): this {
    super.init(element);

    const el = element ?? this.getElement();
    if (!el) {
        return this;
    }

    DOM.sink.addListener(el, "load", this._onLoad);
    DOM.sink.addListener(el, "error", this._onError);
    this.triggerDecode(el);

    return this;
}
```

`handleLoad()` (defined by `image-intrinsic-size-lifecycle`, possibly already edited by `image-attribute-options-surface` and/or `image-loading-error-states`) gains an early return, inserted between its `const natural = DOM.source.getNaturalSize(element);` line and whatever comes after it:

```typescript
    const natural = DOM.source.getNaturalSize(element);

    if (this._naturalSize && this._naturalSize.width === natural.width && this._naturalSize.height === natural.height) {
        return; // same size already published — nothing changed to re-announce
    }

    // ...the rest of the method's existing body, unchanged...
```

`ProductionDOMSink.decodeImage` (`core/DOM.ts`):

```typescript
/** @inheritDoc */
decodeImage(handle: Handle): Promise<void> {
    const element = _registry.resolve(handle) as HTMLImageElement;

    // No `decode()` in this environment (SSR, a worker, or a plain jsdom
    // setup without full HTMLImageElement support) — degrade to an
    // already-resolved promise, mirroring matchMedia's environment guard.
    if (typeof element.decode !== "function") {
        return Promise.resolve();
    }

    return element.decode();
}
```

`RecordingDOMSink.decodeImage` (`tests/dom/TestDOM.ts`):

```typescript
decodeImage(handle: Handle): Promise<void> {
    this.record('decodeImage');

    return _table.stub(handle).decodeResult === 'reject'
        ? Promise.reject(new Error('decodeImage: modelled rejection'))
        : Promise.resolve();
}
```

`HandleStub` (`tests/dom/TestDOM.ts`) gains one field, seeded in `TestHandleTable.mint()`:

```typescript
/** Modelled `decode()` outcome, seeded by {@link setDecodeResult}. */
decodeResult: "resolve" | "reject";
```

```typescript
/**
 * Seeds a handle's modelled `decode()` outcome, read back by
 * {@link RecordingDOMSink.decodeImage}. Default `'resolve'` — call this only
 * to test the rejection path.
 *
 * @param handle - The image element handle.
 * @param result - `'resolve'` (the default) or `'reject'`.
 */
export function setDecodeResult(handle: Handle, result: "resolve" | "reject"): void {
    _table.stub(handle).decodeResult = result;
}
```

---

## Ordered Implementation Steps

Run these only after `image-intrinsic-size-lifecycle` and `image-attribute-options-surface` have both been implemented — `Image.ts` must already carry `_naturalSize`, `_onLoad` / `_onError`, `handleLoad()`, `init()` / `destructor()`, `_hasExplicitPreferredSize`, `getLoading()`, `setSrc()`, and `applyOptions()` before any step below applies.

1. **Add `decodeImage(handle: Handle): Promise<void>;`** to the `DOMSink` interface in [DOM.ts:944](packages/lib/src/typescript/lib/core/DOM.ts#L944), after `exitFullscreen(): void;` and before the interface's closing brace, with the JSDoc from `## Public API`.
   Verify: `grep -n "decodeImage" packages/lib/src/typescript/lib/core/DOM.ts` shows the interface declaration.

2. **Implement `decodeImage` on `ProductionDOMSink`**, after its `exitFullscreen()` method ([DOM.ts:2027-2032](packages/lib/src/typescript/lib/core/DOM.ts#L2027-L2032)), from `## Internal Structure`.

3. **Add the `decodeResult` field to `HandleStub`** in [TestDOM.ts:61-108](packages/lib/tests/dom/TestDOM.ts#L61-L108) (near `naturalWidth` / `naturalHeight`), and seed it `'resolve'` inside `TestHandleTable.mint()`'s object literal ([TestDOM.ts:142-167](packages/lib/tests/dom/TestDOM.ts#L142-L167), near `naturalWidth: 0, naturalHeight: 0,`).

4. **Implement `decodeImage` on `RecordingDOMSink`**, after its `exitFullscreen()` method ([TestDOM.ts:816-819](packages/lib/tests/dom/TestDOM.ts#L816-L819)), from `## Internal Structure`.
   Verify: `npm run typecheck` — zero errors (both `DOMSink` implementers now satisfy the widened interface; this was the first point in these steps where the build could fail on a missing method).

5. **Add the exported `setDecodeResult` helper**, near `setNaturalSize` ([TestDOM.ts:1577-1590](packages/lib/tests/dom/TestDOM.ts#L1577-L1590)), from `## Internal Structure`.

6. **Widen `ImageOptions`** in `Image.ts`: add `srcset?: string;` and `sizes?: string;` alongside the fields `image-attribute-options-surface` added.
   Verify: `grep -n "srcset?:\|sizes?:" packages/lib/src/typescript/lib/component/display/Image.ts` shows both.

7. **Add the `_decodeGeneration` field** from `## Internal Structure`, near `_naturalSize` / `_hasExplicitPreferredSize`.

8. **Add `getSrcset` / `setSrcset` / `getSizes` / `setSizes`** from `## Internal Structure`, each with a doc comment matching `getAlt` / `setAlt`'s style.

9. **Add `private triggerDecode(element: Handle): void`** from `## Internal Structure`, near `handleLoad()`.

10. **Edit `setSrc`**: insert the `triggerDecode` call block from `## Internal Structure` between its existing `this._naturalSize = null;` line and its final `return this;`.
    Verify: `grep -n -A 6 "this._naturalSize = null;" packages/lib/src/typescript/lib/component/display/Image.ts` shows a `triggerDecode` call inside `setSrc` (and, after later steps, inside `setSrcset` / `setSizes` too).

11. **Edit `applyOptions`**: add the two `srcset` / `sizes` dispatch lines from `## Internal Structure`, anywhere before its `return this;`.

12. **Edit `init()`**: add `this.triggerDecode(el);` from `## Internal Structure`, after the two `addListener` calls and before `return this;`.

13. **Edit `handleLoad()`**: insert the size-diff early return from `## Internal Structure`, immediately after the line that computes `natural` via `DOM.source.getNaturalSize(element)` and before whatever follows it. Do not reorder or remove anything else in the method.
    Verify: `grep -n -A 3 "getNaturalSize(element)" packages/lib/src/typescript/lib/component/display/Image.ts` shows the new guard immediately after, inside `handleLoad`.

14. **Update the class-level JSDoc** to mention `srcset` / `sizes` and the proactive-decode optimisation — see `## Documentation Impact`.

15. **Typecheck.** `npm run typecheck` — zero errors.

16. **Update `packages/lib/tests/component/display/Image.test.ts`** per `## Expected Behaviour` below, using `vi.spyOn(DOM.sink, 'decodeImage')` for controlled per-call resolve/reject sequencing — the same pattern `TextInput.test.ts` uses for `DOM.source.readClipboardText` ([TextInput.test.ts:157-265](packages/lib/tests/component/input/TextInput.test.ts#L157-L265)) — plus the `Video.test.ts`-style `Recorder` / `hasOp` cast ([Video.test.ts:19-39](packages/lib/tests/component/display/Video.test.ts#L19-L39)) for call-count and call-presence assertions.

17. **Run tests.** `npm test` — all `Image.test.ts` cases green, no regressions elsewhere.

18. **Update `packages/lib/docs/components/Image.md`** per `## Documentation Impact`.

19. **Run `npm run docs:api`** — expect zero TypeDoc warnings.

20. **Re-read the full diff of `DOM.ts`, `TestDOM.ts`, and `Image.ts` once, end to end**, adversarially: `decodeImage` is implemented on both `DOMSink` implementers; `triggerDecode` is called from exactly four sites (`init`, `setSrc`, `setSrcset`, `setSizes`), every one of them guarded by an `element` truthiness check; `handleLoad()`'s new guard sits before whatever currently follows the `natural` computation, not replacing any of it; `_decodeGeneration` is referenced only inside `triggerDecode`; `grep -n "handleError\|isBroken\|\.broken" packages/lib/src/typescript/lib/component/display/Image.ts` shows no matches introduced by this plan's own diff (this plan never assumes `image-loading-error-states` has landed).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Image.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/tests/component/display/Image.test.ts` |
| Modify | `packages/lib/docs/components/Image.md` |

---

## Expected Behaviour

### Attribute round-trip (unit-testable)

| Setter call | Getter | Written attribute : value |
|---|---|---|
| `setSrcset("a.jpg 1x, b.jpg 2x")` | `getSrcset()` → `"a.jpg 1x, b.jpg 2x"` | `srcset` : `"a.jpg 1x, b.jpg 2x"` |
| `setSizes("(min-width: 600px) 480px, 100vw")` | `getSizes()` → same | `sizes` : same |
| Either getter before its setter is ever called | `null` | — |

### `srcset` / `sizes` invalidate the cache and re-trigger decode (unit-testable)

- `setSrcset(...)` called on an already-rendered `Image`: `_naturalSize` is cleared and `DOM.sink.decodeImage` is called again (assert a second call via a `vi.spyOn` call-count check).
- Same for `setSizes(...)`.
- `setSrcset(...)` / `setSizes(...)` called before the element has ever rendered: no throw, and `DOM.sink.decodeImage` is not called until the element actually renders (mirrors `setSrc`'s existing pre-render contract).

### Automatic decode trigger (unit-testable)

- `getElement(true)` on a freshly constructed, default-`loading` (`"eager"` or unset) `Image` calls `DOM.sink.decodeImage` exactly once.
- `new Image(src, { loading: "lazy" })`, then `getElement(true)`: `DOM.sink.decodeImage` is never called.
- `setSrc("/new.png")` on an already-rendered `Image`: `DOM.sink.decodeImage`'s call count increases by one (a distinct, second call).

### `decode()` success publishes early, before any native `load` (unit-testable)

Seed `TestDOM.setNaturalSize(handle, w, h)` with the "decoded" dimensions, mock `DOM.sink.decodeImage` to resolve, render the `Image`, and flush one microtask (`await Promise.resolve()`):

- `getPreferredSize()` reports the seeded natural size, even though `_onLoad()` was never invoked directly.
- The `"load"` listener (`on("load", fn)`) fires exactly once.

### `decode()` resolving, then a same-size native `load`, does not double-publish (unit-testable)

After the above settle, invoke `_onLoad()` directly (the dependency plan's own bridge pattern) with the same seeded natural size:

- The `"load"` listener's call count stays at 1 (not 2).
- `getPreferredSize()` is unchanged.

### A later, size-different native `load` still republishes (unit-testable)

Continuing from the previous case, reseed `TestDOM.setNaturalSize` with different dimensions and invoke `_onLoad()` again:

- The `"load"` listener's call count becomes 2.
- `getPreferredSize()` reflects the new dimensions.

### `decode()` rejection converges on the error path (unit-testable)

Mock `DOM.sink.decodeImage` to reject, render the `Image`, flush a microtask:

- The `"error"` listener (`on("error", fn)`) fires exactly once. (This only asserts the guaranteed `_onError()` contract from the dependency plan — not `.broken`, which this plan does not assume exists.)

### A superseded decode settlement is silently ignored (unit-testable)

`vi.spyOn(DOM.sink, 'decodeImage')`, chained with `mockReturnValueOnce` twice: the first call returns a controlled, still-pending promise; the second returns an already-resolved one (the exact value doesn't matter — it just needs to not crash `triggerDecode`'s `.then`/`.catch` chain). Render the `Image` (consumes the first mocked return, starts the pending decode); call `setSrc("/new.png")` before it settles (consumes the second mocked return, bumps the generation); then reject the *first* pending promise:

- The `"error"` listener never fires.

### A decode settlement after disposal does not throw (unit-testable)

Mock `DOM.sink.decodeImage` to return a controlled pending promise; render the `Image`; call `image.dispose()`; then resolve (and, in a second case, reject) the pending promise:

- Neither settlement throws.
- No getter/setter is called on the disposed instance as a result (nothing to assert directly — the absence of a thrown error, mirroring `TextInput.test.ts`'s "paste() does not throw when the field is destroyed while the clipboard read is pending" case, is the assertion).

### Manual verification (not automatable)

- Real browser: open the `Image` docs demo (`npm run docs:dev`, `/components/Image`).
  - A slow, network-throttled image shows no visible layout jump on first paint.
  - An `Image` constructed with `loading: "lazy"`, placed off-screen, does not eagerly fetch until scrolled near.
  - A `srcset` demo resized across a breakpoint swaps candidates and updates the reported size with no flicker or duplicate loading-state flash.

---

## Verification

- `npm run typecheck` — zero errors.
- `npm test` — `Image.test.ts` green, `TestDOM.ts`-consuming suites green, full suite green.
- `npm run docs:api` — zero TypeDoc warnings.
- `grep -n "decodeImage" packages/lib/src/typescript/lib/core/DOM.ts` — matches in the interface and `ProductionDOMSink`.
- `grep -n "decodeImage" packages/lib/tests/dom/TestDOM.ts` — matches in `RecordingDOMSink` and (via `decodeResult`) the stub table.
- `grep -n "handleError\|isBroken\|\.broken" packages/lib/src/typescript/lib/component/display/Image.ts` — zero matches introduced by this plan's diff.
- Manual smoke test per `## Expected Behaviour`'s last section.

---

## Documentation Impact

`Image` gains four public methods (`getSrcset` / `setSrcset` / `getSizes` / `setSizes`) and `DOMSink` gains one (`decodeImage`) — update:

- **`packages/lib/docs/components/Image.md`**: add `getSrcset` / `setSrcset` / `getSizes` / `setSizes` rows to the "Common methods" table. Add a "Notes" bullet: "`Image` calls the browser's `decode()` on the current source automatically — at first render and after any source change — so its natural size is usually known before first paint instead of only once the `load` event fires. This is skipped when `loading` is `\"lazy\"`, since forcing a decode would defeat lazy loading." Add a second bullet: "For a responsive `srcset` / `sizes` image, resizing across a breakpoint can make the browser swap candidates; `Image` re-measures and republishes its preferred size only when the new candidate's natural size actually differs from the previous one."
- **`Image.ts`'s class-level JSDoc**: mention `srcset` / `sizes` and the proactive decode optimisation — see step 14.
- **No `docs/concepts/dom-seams.md` update.** That page's verb listing is a curated set of categories, not an exhaustive list — `Video`'s own media verbs (`mediaPlay`, `setVolume`, `setPlaybackRate`, …) were never added there either, confirmed by grep. `decodeImage` follows the same precedent.
- Run `npm run docs:api` (step 19) — must finish with zero warnings, including from the new `DOMSink.decodeImage` JSDoc.

---

## Potential Challenges

- **`handleLoad()`'s current shape is uncertain at plan-write time.** Neither sibling plan that also edits it (`image-attribute-options-surface`, `image-loading-error-states`) is guaranteed to have landed in a fixed order relative to the other. Because this plan's edit is a *prepended* early return anchored to the stable `getNaturalSize(element)` line — present, unmodified, since the original lifecycle plan — it is correct regardless of which of the other two edits are already present.
- **Test timing.** Every new behavior this plan adds is driven by a real `Promise` (`DOM.sink.decodeImage`), not a purely synchronous seam call like `getNaturalSize`. Tests must flush a microtask (`await Promise.resolve()`, or `await` the mocked promise directly) between triggering a render/setter and asserting the result — a synchronous assertion immediately after `getElement(true)` will observe the pre-decode state.
- **`decodeImage` widens `DOMSink`.** Any other `DOMSink` implementation outside `ProductionDOMSink` / `RecordingDOMSink` (none exist today per a repo-wide grep for `implements DOMSink`) would also need this method to keep compiling.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts) — the file this plan's `Image`-side changes land in.
- [packages/lib/src/typescript/lib/core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts) (lines 883-945 `DOMSink`'s action-verb group, 1988-2032 `ProductionDOMSink`'s matching implementations, 2440-2446 `readClipboardText` — the seam's one other async method, cited to justify placing `decodeImage` on `DOMSink` instead) — the seam this plan extends.
- [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts) (lines 61-108 `HandleStub`, 116-170 `TestHandleTable.mint()`, 397-820 `RecordingDOMSink`, 1577-1590 `setNaturalSize`) — the modelled counterpart this plan's new verb must keep satisfying, and the exact shape (`stub` field + exported seed helper) `setDecodeResult` mirrors.
- [packages/lib/src/typescript/lib/component/display/Video.ts](packages/lib/src/typescript/lib/component/display/Video.ts) (lines 99-151 constructor/`applyOptions`, 303-328 `setVolume` calling its seam verb directly from a runtime setter, 481-575 `init()`/`destructor()` wiring the native bridge) — the precedent for adding a media-specific seam verb and calling it from both `init()` and a runtime setter.
- [packages/lib/src/typescript/lib/component/input/TextInput.ts](packages/lib/src/typescript/lib/component/input/TextInput.ts) (lines 779-810, comment at 795-797) — the "re-fetch `getElement()` after an await, no-op if the component was destroyed while it was pending" precedent this plan's `triggerDecode` guard mirrors.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) (line 1146 `destructor()` clearing `_element`, lines 1254-1267 `getElement()`) — confirms the disposal guard actually works: a post-dispose `getElement()` call reliably returns `undefined` rather than a stale cached handle.
- [plans/image-intrinsic-size-lifecycle.md](plans/image-intrinsic-size-lifecycle.md) — defines `_naturalSize`, `handleLoad()`, `_onLoad` / `_onError`, `init()` / `destructor()`; this plan's hard dependency.
- [plans/image-attribute-options-surface.md](plans/image-attribute-options-surface.md) — defines `setSrc`, `applyOptions`, `getLoading`, `_hasExplicitPreferredSize`; this plan's other hard dependency.
- [plans/image-loading-error-states.md](plans/image-loading-error-states.md) — the plan `_onError()`'s eventual failure-path richness comes from; not a dependency, skimmed only so this plan's decode-failure convergence doesn't assume or contradict it.
- [ARCHITECTURE.md](ARCHITECTURE.md), *Positioning is always absolute* and *Minimize direct DOM access* / *All attributes and styles go through typed setters* — the rules motivating the candidate-swap timing wrinkle and the new seam verb's placement.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Fields written during the `super()` cascade must use `declare`* — the rule `_decodeGeneration`'s design was checked against.
- [packages/lib/tests/component/input/TextInput.test.ts](packages/lib/tests/component/input/TextInput.test.ts) (lines 157-265) — the `vi.spyOn` async-DOM-seam mocking pattern this plan's tests reuse for `DOM.sink.decodeImage`.
- [packages/lib/tests/component/display/Video.test.ts](packages/lib/tests/component/display/Video.test.ts) (lines 19-39) — the `Recorder` / `hasOp` cast pattern for asserting a seam call happened (or its count).

---

## Non-Goals

- **`object-fit` / aspect-ratio, `.loading` / `.broken` visual states, `src` / `alt` / other plain attributes.** Each is its own sibling plan; this plan only adds `srcset`, `sizes`, and the proactive `decode()` trigger.
- **A public `Image.decode(): Promise<void>` method.** Considered and rejected — see *`Image` triggers `decode()` itself* in `## Architecture Decisions`.
- **An `ImageOptions` field to opt out of the automatic decode.** Not requested; `loading: "lazy"` is already the one documented case where skipping it is correct, and this plan handles that unconditionally.
- **`srcset` descriptor syntax validation.** The attribute is written verbatim; malformed syntax is the browser's own concern, exactly like every other attribute-backed field in `image-attribute-options-surface`.
- **Updating `docs/concepts/dom-seams.md`.** See `## Documentation Impact`.

---

## Notes

[^hard-dep]: The four symbols named in this decision's body are all defined by `image-attribute-options-surface`, not by `image-intrinsic-size-lifecycle` alone: `getLoading()` and `setSrc()` are new methods that plan adds; `applyOptions()` is a new override that plan adds (this plan does not want to create a *second* `applyOptions` override, nor duplicate that plan's establishment work); and `_hasExplicitPreferredSize` replaces the lifecycle plan's original, simpler `getPreferredSizeConstraint()` gate inside `handleLoad()` — this plan's own edit sits directly above that gate and its worked table (`## Architecture Decisions`, *A `load` signal republishes...*) is written against the gate as it exists *after* `image-attribute-options-surface`'s edit, not before. Declaring only `image-intrinsic-size-lifecycle` as a dependency and treating the other as a "style precedent" (the way `image-loading-error-states` treats it) was considered and rejected: that plan's own conditional step ("only if `Image` already declares a public `setSrc`...") works because none of its logic depends on `setSrc`'s *specific* contract, only on the method's presence. This plan's `setSrcset` / `setSizes` need to mirror `setSrc`'s *exact* cache-invalidation shape, and `triggerDecode`'s lazy-loading skip needs `getLoading()` to exist as called code, not as an optional enhancement — a soft dependency with a conditional step would leave `Image` in a broken, half-wired state if implemented before `image-attribute-options-surface` lands.

[^size-diff-churn]: The alternative — republish and re-emit `"load"` on every native `load`, unconditionally, exactly as the lifecycle plan's original single-fire design implicitly assumed — was viable for `srcset`'s own sake alone (a genuine candidate swap almost always does change the natural size, since that is the whole point of a width-descriptor `srcset`). It was rejected once `decode()` entered the picture: with `decode()` and the native listener both able to independently call `handleLoad()` for the *same* settled candidate (see the next two decisions), an unconditional emit would double-fire `"load"` for the common, non-responsive case — not a rare `srcset` edge case, but every single `Image` this plan touches. Gating on an actual size change removes that duplicate for free, and only changes `srcset`'s own behavior in the rare case where two different candidates happen to share identical natural pixel dimensions (e.g. same-size, different-quality variants) — in that case, nothing about the rendered box needs to change, so skipping the republish is the more correct outcome, not merely an acceptable side effect.

[^seam-placement]: `DOM.source`'s methods answer "what is true right now" (geometry, attributes, media state) with `readClipboardText()` as the sole, deliberate exception because there is no synchronous way to read the system clipboard. `decodeImage` is not answering a question about current state; it is performing a browser action (forcing a decode) whose completion the caller must observe — structurally the same shape as `mediaPlay` / `requestFullscreen`, both already on `DOMSink`, both already returning something beyond a bare acknowledgement in spirit (`mediaPlay`'s comment explicitly discusses its dropped promise as a deliberate choice, meaning the *shape* of "an action with a promise" is already native to this interface). Putting it on `DOMSource` instead was considered and rejected because it would establish a second, inconsistent reason for a method to live there ("triggers work" instead of "reads a value"), which the next hand-authored `DOMSource` addition would have no clean rule to follow.

[^auto-decode]: A public `decode(): Promise<void>` method — returning `DOM.sink.decodeImage`'s own promise directly to the caller — was considered. It would let a consumer explicitly await "this image is ready," which is a real, independently useful capability. It was rejected for this plan's scope because the audit finding this plan addresses is about a jank window every `Image` already has today, not about a capability consumers currently lack a way to reach — the automatic, no-configuration version fixes the actual problem for every existing call site with zero migration, while a public method would fix it only for call sites updated to use it. Nothing about this plan's `triggerDecode` design blocks adding a public wrapper later if a genuine "await this image" use case shows up; it just is not what was asked here (`CLAUDE.md`, *Simplicity First*: no speculative API surface).

[^lazy-skip]: Per the HTML Living Standard and confirmed browser behavior (Chrome, Firefox, Safari all currently trigger eager fetch on `decode()` regardless of the `loading` attribute), calling `<img>.decode()` before the browser would otherwise have started fetching forces that fetch immediately. `loading="lazy"`'s entire contract is deferring the fetch until the image nears the viewport; an unconditional `triggerDecode()` call would silently break that contract for every lazy `Image`, the moment `image-attribute-options-surface`'s `loading` option meets this plan's automatic decode. The one-line guard is cheap and total — it does not need to distinguish "still off-screen" from "already near the viewport," since by the time the browser's own lazy-loading heuristic decides to fetch, the resulting native `load` / `error` events already drive `handleLoad()` / `_onError()` exactly as they did before this plan.

[^disposal-guard]: `TextInput.paste()`'s own comment at the re-fetch site (`TextInput.ts:795-797`) states the identical concern: "the field may have been destroyed while the read was in flight (e.g. its parent panel closed mid-permission-prompt)." `Component.destructor()` sets `this._element = undefined` (`Component.ts:1146`), so a post-dispose `getElement()` call reliably returns `undefined` rather than a stale handle — confirmed by reading `Component.ts`'s `getElement()` (`Component.ts:1254-1267`), which only re-queries when `this._element` is falsy and otherwise returns the cached value, so the guard is not defeated by `getElement()`'s own caching.
