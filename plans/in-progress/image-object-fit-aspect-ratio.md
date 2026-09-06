---
depends-on: [image-intrinsic-size-lifecycle]
touches-shared: ["packages/lib/src/typescript/lib/component/display/Image.ts"]
---

# Image Object-Fit and Aspect-Ratio Preservation — Implementation Plan

## Overview

`Image` ([packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts)) has no fit model today. Three gaps compound into one problem: nothing sets CSS `object-fit` or `object-position`, so an `<img>` handed a box that doesn't match its natural aspect ratio stretches under the CSS default `object-fit: fill`; nothing lets a caller keep width and height proportional as the box is resized, because CSS `aspect-ratio` is inert here — this framework always assigns both width and height explicitly (`ARCHITECTURE.md`, *Positioning is always absolute*), and `aspect-ratio` has no effect once both axes are non-auto; and the current `getMinSize()` ([Image.ts:94-110](packages/lib/src/typescript/lib/component/display/Image.ts#L94-L110)) floors *both* axes independently at `Math.min(natural, 100)`, so a large image handed a small box (e.g. 60×48) gets clamped up to a distorted 100×100 square that overflows its slot.

This plan adds `objectFit` / `objectPosition` (plain CSS-backed typed setters) and `preserveAspectRatio` (a sizing behaviour that re-derives the dependent axis from the natural aspect ratio whenever the box is resized) to `Image`, and removes the auto-min-floor cap that causes the distortion. It builds directly on `image-intrinsic-size-lifecycle` ([plans/image-intrinsic-size-lifecycle.md](plans/image-intrinsic-size-lifecycle.md)), which must implement first: that plan adds the cached `_naturalSize: Size | null` field this plan reads to compute the aspect ratio, and the `handleLoad()` method that publishes the image's initial preferred size. This plan does not depend on `image-attribute-options-surface` ([plans/image-attribute-options-surface.md](plans/image-attribute-options-surface.md)) — the sibling plan that gives `Image` its `applyOptions` override and typed-setter/options-bag conventions for `src`/`alt`/etc — but follows the same conventions it establishes. This plan's own `## Ordered Implementation Steps` are written to work whether that sibling plan has landed first or not (see `## Architecture Decisions`).

Because `image-intrinsic-size-lifecycle` is not yet implemented anywhere, code it introduces (`_naturalSize`, `handleLoad()`) has no real line numbers yet; steps touching it are anchored to symbol names and quoted snippets, not line numbers. Instructions touching code already on `master` today cite today's real line numbers.

---

## Architecture Decisions

### Drop the auto-min-floor cap entirely; the aspect-ratio floor (below) is the only automatic minimum left

`getMinSize()`'s `Math.min(natural, IMAGE_AUTO_MIN_CAP_PX)` cap on *both* axes is deleted, along with the `IMAGE_AUTO_MIN_CAP_PX` constant. Post-load, an `Image` with no explicit `setMinSize` and `preserveAspectRatio` off reports `{0, 0}` — the same "no opinion" default `image-intrinsic-size-lifecycle` already established for the pre-load state — and lets its parent shrink it freely.[^drop-cap]

### `objectFit` / `objectPosition` are plain CSS-backed setters, Image-local

Both follow `ARCHITECTURE.md`'s default typed-setter shape exactly — cache into `_options`, write through `this.setElementCSSRule(...)` — because neither is a *layering property* (`core/ClassStyleRules.ts`'s `StyleBag` interface, lines 44-93, has no `objectFit`/`objectPosition` entry) and neither needs value normalisation. They stay `Image`-local rather than moving to `Component`: a repo-wide search found no second consumer today.[^object-fit-local]

```typescript
setObjectFit(value: "fill" | "contain" | "cover" | "none" | "scale-down"): this {
    this._options.objectFit = value;
    this.setElementCSSRule("objectFit", value);
    return this;
}
```

### `preserveAspectRatio` overrides `setWidth` / `setHeight` symmetrically, mirroring `Text.setWidth`

`Text.setWidth` ([Text.ts:690-703](packages/lib/src/typescript/lib/component/input/Text.ts#L690-L703)) is the precedent this project already uses for "re-derive the dependent axis from the axis the parent just assigned, and republish through `setPreferredSize` so the parent re-lays-out one pass later." `Image` adds the same shape, but symmetrically on both axes (`Text` only ever derives height from width; an image's dependent axis can be either, depending on which axis the parent's layout manager happens to constrain): `setWidth(w)` re-derives height from the cached `_naturalSize` ratio and republishes; `setHeight(h)` does the reverse.

| Call (natural 300×150, ratio 2:1, no border/padding) | Derived axis |
|---|---|
| `setWidth(120)` | height = 60 (120 ÷ 2) |
| `setHeight(150)` | width = 300 (150 × 2) |

A parent's `writeBounds` ([Component.ts:3911-3920](packages/lib/src/typescript/lib/core/Component.ts#L3911-L3920)) always calls `setWidth` before `setHeight`, so within one `writeBounds` call the height-derived republish is the one that survives — the width-derived republish from the same call is overwritten before the parent ever reads it back. This settles within one extra layout pass, the same way `Text.setWidth`'s own re-measurement does: `Component.setPreferredSize` fires the ancestor notify, the parent re-lays-out next pass with the now-published aspect-correct size, and once the parent hands back a width/height pair that already matches, further calls are no-ops (`Component.setPreferredSize` ([Component.ts:3327-3339](packages/lib/src/typescript/lib/core/Component.ts#L3327-L3339)) already skips an unchanged value).

Both overrides call `super.setPreferredSize(...)`, not `this.setPreferredSize(...)` — bypassing any explicit-preferred-size bookkeeping a sibling plan may have layered onto `Image.setPreferredSize`, since this is a derived republish, not a caller override. This is safe regardless of whether such an override exists: if it doesn't, `super.setPreferredSize` is identical to `this.setPreferredSize`.

### `preserveAspectRatio` does not gate on "was the preferred size caller-explicit" — a deliberate divergence from `Text`

`Text.setWidth`'s re-derivation only republishes when `!this._hasExplicitPreferredSize` ([Text.ts:398-402](packages/lib/src/typescript/lib/component/input/Text.ts#L398-L402)), so an explicit `preferredSize` permanently disables `Text`'s wrap-driven recalculation. `Image`'s `setWidth`/`setHeight` overrides do not check anything equivalent: once `preserveAspectRatio` is `true`, every call re-derives and republishes, even over an explicit constructor `preferredSize`.[^no-explicit-gate]

| Scenario (natural 300×150) | `getPreferredSize()` |
|---|---|
| `new Image('/x.png', { preferredSize: { width: 120, height: 40 }, preserveAspectRatio: true })`, then `load` fires | `{120, 40}` — explicit size wins for the initial ask |
| Parent later calls `setWidth(300)` | `{300, 150}` — aspect-derived; the explicit size no longer binds once a real layout pass assigns a width |

### The aspect-ratio min floor is a cache populated by `setWidth`/`setHeight`, not by `handleLoad`

A new private field, `_aspectMinSize: Size | null`, is written by the same `setWidth`/`setHeight` overrides that derive the preferred size — set to the same `{width, height}` pair — and `getMinSize()` returns it (when no explicit `setMinSize` is set) instead of falling through to `Component`'s `{0, 0}` default. This mirrors `Text`'s "the box's own min height also rising, so the current pass already reserves the room rather than clipping" (`Text.setWidth`'s own doc comment, [Text.ts:672-689](packages/lib/src/typescript/lib/component/input/Text.ts#L672-L689)): `clampHeight`/`clampWidth` ([Component.ts:4010-4024](packages/lib/src/typescript/lib/core/Component.ts#L4010-L4024), [4076-4090](packages/lib/src/typescript/lib/core/Component.ts#L4076-L4090)) read `getMinSize()` on every `setWidth`/`setHeight` call, so once the floor is raised, the *same* pass's later `setHeight`/`setWidth` call is already protected from clipping below the aspect-correct size.

`_aspectMinSize` stays `null` until the parent's layout manager calls `setWidth`/`setHeight` at least once — `handleLoad()` (from the dependency plan) is not edited to pre-populate it. This mirrors the dependency plan's own established rule that the minimum only strengthens once real data exists (there: "once the image has loaded"; here: "once the parent has actually assigned a concrete width or height"). Before that first call, `getMinSize()` reports the same `{0, 0}` the "drop the cap" decision above establishes.

### Coordinating with `image-attribute-options-surface` without a hard dependency

Because this plan does not depend on `image-attribute-options-surface`, `Image` may or may not already have a `protected applyOptions(options: ImageOptions): this` override by the time this plan runs — both plans declare `touches-shared` on `Image.ts`, but their relative implementation order is not fixed by `depends-on`. `## Ordered Implementation Steps` below branches on whether that override already exists, mirroring how `image-attribute-options-surface` itself anchored to symbols rather than line numbers for the same reason.

`_aspectMinSize` is not invalidated by `setSrc` (added by that sibling plan) — a source swap can leave `_aspectMinSize` briefly stale between `setSrc` nulling `_naturalSize` and the new image's first post-load `setWidth`/`setHeight` call. This is the same class of staleness the dependency plan already accepts for perimeter tracking (its `[^perimeter-once]` note) and is left unfixed for the same reason: no live-tracking mechanism exists anywhere in this file today, and adding one here would be scope creep for a gap this plan's own `Non-Goals` already excludes (`setSrc`/`srcset` handling belongs to the sibling plans that own those methods).

---

## Public API

```typescript
export interface ImageOptions extends ComponentOptions {
    objectFit?:           "fill" | "contain" | "cover" | "none" | "scale-down";
    objectPosition?:      string;
    preserveAspectRatio?: boolean;
    // Unchanged, added by image-intrinsic-size-lifecycle / image-attribute-options-surface:
    // listeners?, src?, alt?, loading?, decoding?, fetchPriority?, crossOrigin?, referrerPolicy?
}

class Image extends Component<ImageOptions> {
    getObjectFit(): "fill" | "contain" | "cover" | "none" | "scale-down" | null;
    setObjectFit(value: "fill" | "contain" | "cover" | "none" | "scale-down"): this;

    getObjectPosition(): string | null;
    setObjectPosition(value: string): this;

    getPreserveAspectRatio(): boolean;
    setPreserveAspectRatio(value: boolean): this;

    // Overridden — see "preserveAspectRatio overrides setWidth / setHeight" above.
    // Signatures unchanged from Component.
    setWidth(width: number): this;
    setHeight(height: number): this;

    // Body replaced — see "The aspect-ratio min floor" above. Signature unchanged.
    getMinSize(): Size | null;

    protected applyOptions(options: ImageOptions): this; // new, or extended if a sibling plan already added it
}
```

`IMAGE_AUTO_MIN_CAP_PX` is deleted — no replacement constant.

---

## Internal Structure

New private field, alongside `image-intrinsic-size-lifecycle`'s `_naturalSize`:

```typescript
// The {width, height} pair last derived by setWidth/setHeight under
// preserveAspectRatio, used as getMinSize()'s floor. Null until the parent
// has assigned a concrete width or height at least once — see "The
// aspect-ratio min floor" in Architecture Decisions.
private _aspectMinSize: Size | null = null;
```

This is a plain field, not `declare` — nothing in `ComponentOptions` drives `setWidth`/`setHeight`/`setPreserveAspectRatio` from inside the `super()` cascade (confirmed: `ComponentOptions` has no `width`/`height` field, and `preserveAspectRatio`'s own cascade-time write, if any, sets `_aspectMinSize` to `null`, the same value the field initializer would produce), so the `declare`-field trap (`CODE_CONVENTIONS.md`, *Fields written during the `super()` cascade must use `declare`*) does not apply here.

`setWidth` / `setHeight` overrides and the shared derivation helper:

```typescript
setWidth(width: number): this {
    super.setWidth(width);
    this.applyAspectRatio("width");

    return this;
}

setHeight(height: number): this {
    super.setHeight(height);
    this.applyAspectRatio("height");

    return this;
}

/**
 * Re-derives the axis `setWidth`/`setHeight` did *not* just commit, from the
 * cached natural aspect ratio, and republishes both as the preferred size —
 * bypassing any explicit-preferred-size bookkeeping a sibling plan may have
 * added to `setPreferredSize`, since this is a derived value, not a caller
 * override. Also raises `_aspectMinSize` to the same pair, so the current
 * pass's own clamp already reserves the room. No-op before the first `load`
 * (`_naturalSize` still `null`), for a malformed zero-dimension natural size,
 * or when `preserveAspectRatio` is off.
 *
 * @param drivingAxis - The axis `setWidth`/`setHeight` just committed; the
 *   other axis is derived from it.
 */
private applyAspectRatio(drivingAxis: "width" | "height"): void {
    if (!this._options.preserveAspectRatio
        || !this._naturalSize
        || this._naturalSize.width === 0
        || this._naturalSize.height === 0) {
        return;
    }

    const ratio     = this._naturalSize.width / this._naturalSize.height;
    const perimeter = this.getPerimeterSize();

    const size: Size = drivingAxis === "width"
        ? {
              width:  this.getWidth(),
              height: (this.getWidth() - perimeter.left - perimeter.right) / ratio
                      + perimeter.top + perimeter.bottom,
          }
        : {
              width:  (this.getHeight() - perimeter.top - perimeter.bottom) * ratio
                      + perimeter.left + perimeter.right,
              height: this.getHeight(),
          };

    this._aspectMinSize = size;
    super.setPreferredSize(size);
}
```

`getMinSize()` — full replacement of the dependency plan's cap-based body:

```typescript
getMinSize(): Size | null {
    if (!this.getMinSizeConstraint() && this._aspectMinSize) {
        return this._aspectMinSize;
    }

    return super.getMinSize();
}
```

The three new getter/setter pairs:

```typescript
getObjectFit(): "fill" | "contain" | "cover" | "none" | "scale-down" | null {
    return this._options.objectFit ?? null;
}

setObjectFit(value: "fill" | "contain" | "cover" | "none" | "scale-down"): this {
    this._options.objectFit = value;
    this.setElementCSSRule("objectFit", value);

    return this;
}

getObjectPosition(): string | null {
    return this._options.objectPosition ?? null;
}

setObjectPosition(value: string): this {
    this._options.objectPosition = value;
    this.setElementCSSRule("objectPosition", value);

    return this;
}

getPreserveAspectRatio(): boolean {
    return this._options.preserveAspectRatio ?? false;
}

setPreserveAspectRatio(value: boolean): this {
    this._options.preserveAspectRatio = value;
    // Force a fresh derive on the next setWidth/setHeight rather than risk
    // getMinSize() returning a floor computed under the opposite setting.
    this._aspectMinSize = null;

    return this;
}
```

`applyOptions` dispatch (see `## Ordered Implementation Steps` for whether this creates or extends the override):

```typescript
if (options.objectFit            !== undefined) this.setObjectFit(options.objectFit);
if (options.objectPosition       !== undefined) this.setObjectPosition(options.objectPosition);
if (options.preserveAspectRatio  !== undefined) this.setPreserveAspectRatio(options.preserveAspectRatio);
```

---

## Ordered Implementation Steps

Run these only after `image-intrinsic-size-lifecycle` has been implemented and `Image.ts` carries `_naturalSize`, `handleLoad()`, and the thin `getPreferredSize()` override.

1. **Widen `ImageOptions`.** Add `objectFit`, `objectPosition`, `preserveAspectRatio` from `## Public API` to the interface, wherever it currently stands (after any fields a sibling plan already added). Give each a one-line doc comment.
   Verify: `grep -n "objectFit?:\|objectPosition?:\|preserveAspectRatio?:" packages/lib/src/typescript/lib/component/display/Image.ts` shows all three.

2. **Add the `_aspectMinSize` private field** from `## Internal Structure`, next to `_naturalSize`.

3. **Delete the auto-min-floor cap.** Remove the module-level `const IMAGE_AUTO_MIN_CAP_PX = 100;` declaration and its comment block, and replace `getMinSize()`'s body with the version from `## Internal Structure` (reads the `_aspectMinSize` field added in step 2). Update its JSDoc to describe the new contract: `{0, 0}` by default post-load (no cap), or `_aspectMinSize` once `preserveAspectRatio` has derived one, or the explicit `setMinSize` constraint — no more "100px cap."
   Verify: `grep -n "IMAGE_AUTO_MIN_CAP_PX" packages/lib/src/typescript/lib/component/display/Image.ts` — zero matches.

4. **Add the `setWidth`/`setHeight` overrides and the private `applyAspectRatio` helper** from `## Internal Structure`, anywhere in the class body (suggested: just above `getMinSize()`).

5. **Add the three getter/setter pairs** (`getObjectFit`/`setObjectFit`, `getObjectPosition`/`setObjectPosition`, `getPreserveAspectRatio`/`setPreserveAspectRatio`) from `## Internal Structure`, each with a doc comment.

6. **Dispatch the three new fields from `applyOptions`.** Check whether `Image` already declares `protected applyOptions(options: ImageOptions): this` (added by `image-attribute-options-surface`, if that plan landed first):
   - **If it exists**, add the three `if (options.foo !== undefined) this.setFoo(options.foo);` lines from `## Internal Structure` inside it, after the existing `super.applyOptions(options);` call.
   - **If it does not exist**, add the override in full: `super.applyOptions(options);` first, then the three dispatch lines, mirroring `Video.applyOptions` ([Video.ts:138-151](packages/lib/src/typescript/lib/component/display/Video.ts#L138-L151)).
   Verify: `grep -n "options.objectFit\|options.objectPosition\|options.preserveAspectRatio" packages/lib/src/typescript/lib/component/display/Image.ts` shows all three inside `applyOptions`.

7. **Update the class-level JSDoc** to mention `objectFit`/`objectPosition` (CSS pass-throughs, no default effect until set) and `preserveAspectRatio` (opt-in, off by default) — see `## Documentation Impact`.

8. **Typecheck.** `npm run typecheck` — expect zero errors.

9. **Update `packages/lib/tests/component/display/Image.test.ts`** per `## Expected Behaviour` below.

10. **Run tests.** `npm test` — all `Image.test.ts` cases green, no regressions elsewhere.

11. **Update `packages/lib/docs/components/Image.md`** per `## Documentation Impact`.

12. **Run `npm run docs:api`** — expect zero TypeDoc warnings.

13. **Re-read the full diff of `Image.ts` once, end to end**, checking: `IMAGE_AUTO_MIN_CAP_PX` has no remaining references; `_aspectMinSize` is read only in `getMinSize()` and written only in `applyAspectRatio`/`setPreserveAspectRatio`; `setWidth`/`setHeight` both call `super.setWidth`/`super.setHeight` before `applyAspectRatio`, never after; `applyAspectRatio` and the new setters both call `super.setPreferredSize`/`setElementCSSRule` correctly (not `this.setPreferredSize` inside `applyAspectRatio`); `applyOptions` dispatches all three new fields exactly once (no duplicate `if` block from mis-merging with a sibling plan's override).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Image.ts` |
| Modify | `packages/lib/tests/component/display/Image.test.ts` |
| Modify | `packages/lib/docs/components/Image.md` |

---

## Expected Behaviour

All rows are unit-testable offline using `image-intrinsic-size-lifecycle`'s `_onLoad`/`TestDOM.setNaturalSize` bridge to seed `_naturalSize`, plus direct `setWidth`/`setHeight` calls (no real layout manager needed — these are public methods). CSS `object-fit`/`object-position` visual rendering is browser-only; the getter/setter cache round-trip is testable offline the same way every other CSS-backed setter in this codebase is (`getObjectFit()` reflects the cached value; the actual `StyleRule` flush machinery is exercised by the framework's existing style-rule tests, not re-tested per component).

### Auto-min-floor removal

| Scenario | `getMinSize()` |
|---|---|
| Post-load, natural `1000×800`, no explicit `setMinSize`, `preserveAspectRatio` off | `{0, 0}` — no cap (was `{100, 100}`) |
| Post-load, natural `16×16`, no explicit `setMinSize`, `preserveAspectRatio` off | `{0, 0}` — no cap (was `{16, 16}`) |
| `setMinSize({ width: 40, height: 50 })` called, `preserveAspectRatio` off | `{40, 50}` — explicit constraint still wins, unchanged from before this plan |

### `objectFit` / `objectPosition`

| Setter call | Getter | Written CSS property : value |
|---|---|---|
| `setObjectFit("contain")` | `getObjectFit()` → `"contain"` | `objectFit` : `"contain"` |
| `setObjectPosition("top center")` | `getObjectPosition()` → `"top center"` | `objectPosition` : `"top center"` |
| Either getter before its setter is ever called | returns `null` | — |
| `new Image('/x.png', { objectFit: "cover" })` | `getObjectFit()` → `"cover"` after `getElement(true)` | `objectFit` : `"cover"` written on first render |

### `preserveAspectRatio` — derivation and min-floor rise

One `Image` instance, natural size `300×150` (ratio 2:1), no border/padding, `preserveAspectRatio: true` for the whole sequence except the last row:

| Step | `getPreferredSize()` | `getMinSize()` |
|---|---|---|
| 1. `load` fires, no explicit `preferredSize` | `{300, 150}` (dependency plan's own auto-publish; unaffected by this plan) | `{0, 0}` (no `setWidth`/`setHeight` yet) |
| 2. `setWidth(120)` | `{120, 60}` | `{120, 60}` |
| 3. `setHeight(150)` | `{300, 150}` | `{300, 150}` |
| 4. `setPreserveAspectRatio(false)`, then `setWidth(90)` | `{300, 150}` (unchanged — no more aspect-derivation) | `{0, 0}` (the stale `_aspectMinSize` from step 3 was cleared by the toggle) |

A separate, freshly-constructed `Image` with `preserveAspectRatio` left at its default (`false`) behaves exactly like `Component`'s own `setWidth`/`setHeight` — no row above applies to it.

### `preserveAspectRatio` vs. an explicit `preferredSize`

| Scenario | `getPreferredSize()` |
|---|---|
| `new Image('/x.png', { preferredSize: { width: 120, height: 40 }, preserveAspectRatio: true })`, `load` fires (natural `300×150`) | `{120, 40}` — explicit size wins for the initial ask |
| Parent then calls `setWidth(300)` | `{300, 150}` — aspect-derived; explicit size no longer binds |

### Manual verification (not automatable)

- Real browser: open the `Image` docs demo (`npm run docs:dev`, `/components/Image`), set `objectFit: "contain"` on an `Image` inside a box smaller than its natural size, and confirm the image letterboxes instead of stretching.
- Real browser: enable `preserveAspectRatio` on an `Image` inside a resizable container (e.g. a `Split` pane) and confirm the box's proportions stay locked as the pane is dragged, settling within one or two frames per the "one pass later" convergence described in `## Architecture Decisions`.

---

## Verification

- `npm run typecheck` — zero errors.
- `npm test` — `Image.test.ts` green, full suite green (no regressions in any container test fixture that lays out an `Image`).
- `npm run docs:api` — zero TypeDoc warnings.
- `grep -n "IMAGE_AUTO_MIN_CAP_PX" packages/lib/src/typescript/lib/component/display/Image.ts` — zero matches.
- `grep -c "protected applyOptions" packages/lib/src/typescript/lib/component/display/Image.ts` — exactly `1` (guards against a duplicate override from mis-merging with `image-attribute-options-surface`).
- Manual smoke tests per `## Expected Behaviour`'s last two bullets.

---

## Documentation Impact

`Image` gains six new public methods and three `ImageOptions` fields — update:

- **`packages/lib/docs/components/Image.md`**: add rows to the "Common methods" table for `getObjectFit`/`setObjectFit`, `getObjectPosition`/`setObjectPosition`, `getPreserveAspectRatio`/`setPreserveAspectRatio`. Add a "Notes" bullet: "`objectFit`/`objectPosition` set the standard CSS properties directly — use `objectFit: 'contain'` (or `'cover'`) so a mismatched box letterboxes instead of stretching the image. `preserveAspectRatio: true` keeps width and height proportional as the box is resized, overriding the CSS default no-op that `aspect-ratio` alone would have here." Add a second bullet noting the removed 100px auto-min-floor: "An `Image` with no explicit `setMinSize` now reports `{0, 0}` as its minimum (previously capped at up to 100×100), so a parent layout can shrink it freely; use `preserveAspectRatio` or an explicit `setMinSize` if a floor is wanted."
- **`Image.ts`'s class-level JSDoc**: see step 7 above.
- Run `npm run docs:api` (step 12) — must finish with zero warnings.

---

## Potential Challenges

- **`applyOptions` may or may not already exist.** See `## Architecture Decisions`, *Coordinating with `image-attribute-options-surface`* — step 6 branches on this; check the current file before editing rather than assuming either state.
- **Multi-pass convergence can look like a bug during manual testing.** A `preserveAspectRatio` image's box may visibly jump size twice (once per axis) before settling, per the worked example in `## Architecture Decisions`. This is expected — confirm it settles within one or two frames, not that it never moves.
- **Division-by-zero guard.** `applyAspectRatio` must check both `_naturalSize.width === 0` and `_naturalSize.height === 0` (not just one) — a ratio of `0` or `Infinity` corrupts the derived axis silently (no thrown error) rather than crashing, so this is easy to under-guard without noticing in a quick test.
- **Perimeter (border/padding) participates in the derivation.** `Image` clears insets in its constructor but not border/padding — an `Image` with a caller-set `border` must still derive against its *inner* (content-box) width/height, per `## Internal Structure`'s `getPerimeterSize()` calls, not its outer committed width/height directly.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/display/Image.ts](packages/lib/src/typescript/lib/component/display/Image.ts) — the file this plan rewrites.
- [plans/image-intrinsic-size-lifecycle.md](plans/image-intrinsic-size-lifecycle.md) — the dependency this plan builds on; defines `_naturalSize` and `handleLoad()`.
- [plans/image-attribute-options-surface.md](plans/image-attribute-options-surface.md) — sibling plan establishing the `applyOptions`/typed-setter conventions this plan follows; not a hard dependency, but step 6 must check whether it landed first.
- [packages/lib/src/typescript/lib/component/input/Text.ts](packages/lib/src/typescript/lib/component/input/Text.ts) (lines 646-798) — the `setWidth`/re-derive-and-republish precedent this plan mirrors, and (per `## Architecture Decisions`) the explicit-preferredSize gate this plan deliberately does not copy.
- [packages/lib/src/typescript/lib/component/display/Video.ts](packages/lib/src/typescript/lib/component/display/Video.ts) (lines 52-151) — the `applyOptions`/typed-setter shape to mirror if step 6 needs to create the override from scratch.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) (lines 1855-1863 `setElementCSSRule`, 3245-3436 preferred/min-size contracts, 3655-3689 `getPerimeterSize`, 3911-4090 `setWidth`/`setHeight`/`clampsToContentSize`/`clampWidth`/`clampHeight`) — every contract this plan's overrides must honor.
- [packages/lib/src/typescript/lib/core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) (lines 44-93, `StyleBag`) — confirms `objectFit`/`objectPosition` are not layering properties, so the plain `setElementCSSRule` + `_options` shape applies.
- [ARCHITECTURE.md](ARCHITECTURE.md), *Positioning is always absolute*, *Size constraints: who is responsible for what*, *All attributes and styles go through typed setters*, *Three non-negotiable rules for every DOM write* — the rules this plan's setters and sizing overrides must honor.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Fields written during the `super()` cascade must use `declare`* — governs (and, per `## Internal Structure`, rules out the need for `declare` on) `_aspectMinSize`.

---

## Non-Goals

- **A `Component`-level home for `objectFit`/`objectPosition`.** No second consumer exists today; see `## Architecture Decisions`.
- **Retroactive re-derivation when `preserveAspectRatio` is toggled on after the box is already stable.** `setPreserveAspectRatio` clears `_aspectMinSize` but does not itself call `applyAspectRatio` — the new floor/preferred size only take effect on the next `setWidth`/`setHeight` call from a parent layout pass. Most callers set this at construction, well before any layout, so this is not exercised in the common case.
- **`_aspectMinSize` invalidation on `setSrc`.** Accepted staleness; see `## Architecture Decisions`, *Coordinating with `image-attribute-options-surface`*.
- **CSS `aspect-ratio`.** Explicitly not used — inert under this framework's always-absolute, always-both-axes-assigned positioning model (see `## Overview`).
- **Loading/error visual states, `srcset`/`decode()`.** Each is its own not-yet-drafted sibling plan.

---

## Implementation Notes

**`getMinSize()` reads `this.instanceLayer().authored.minSize`, not `this.getMinSizeConstraint()` as `## Internal Structure`'s snippet specified.** `getMinSizeConstraint()` (`Component.ts`) resolves to `ComponentDefaults.ts`'s `BASE_DEFAULTS.minSize`, a frozen `{width: 0, height: 0}` that every `Component` subclass's `_defaultOptions` carries as its base case (`resolveClassDefaults` overlays `BASE_DEFAULTS` under any `subclassDefaults`, and `Image` supplies none for `minSize`) — so `getMinSizeConstraint()` returns that truthy `{0, 0}` *object* for every instance that has never called `setMinSize`, not `null` as the plan's Architecture Decisions assumed. `{0, 0}` is truthy in JavaScript, so the plan's literal `!this.getMinSizeConstraint() && this._aspectMinSize` guard was always `false`, and `_aspectMinSize` was never returned — confirmed by a red test (`preserveAspectRatio` test's `getMinSize()` assertion after `setWidth(120)` returned `{0, 0}` instead of the expected `{120, 60}`). The pre-plan `Image.getMinSize()` body (`!this.instanceLayer().authored.minSize && this._naturalSize`) already avoided this trap — `instanceLayer().authored` is the raw per-instance authored bag, which only contains a `minSize` key once `setMinSize` has actually been called on *this* instance, never the class-level default — so this plan's replacement keeps that same check, substituting `this._aspectMinSize` for the natural-size cap it used to gate. No other use of `getMinSizeConstraint()` appears in this plan's changes. Every `## Expected Behaviour` table row this plan specifies continues to hold under the corrected check; no test assertion changed as a result.

**Two documentation spots outside `## Documentation Impact`'s listed file needed a fix, found while running the `document` skill.** `packages/lib/docs/concepts/sizing.md`'s baseline section stated `getMinSize()` "still auto-derives its floor from the natural size independently of a pinned `preferredSize`" as a general fact about every `Image` — true before this plan, false after (the auto-derive-from-natural-size behaviour this plan deletes was the very thing that sentence described). Reworded to scope the same divergence to the `preserveAspectRatio` case specifically, which still exhibits it through the new `_aspectMinSize` floor. `packages/lib/docs/reference/changelog/next.md` gained a third `### Components` bullet for `Image` (mirroring the two the dependency plans already added there, per their own precedent), documenting the new options/accessors and the auto-min-floor removal as a behaviour change; `packages/lib/docs/reference/migration/next.md` was checked and skipped — every existing entry there corresponds to a compile-breaking rename/removal, and this plan's change (a runtime behaviour change with no removed or renamed symbol) doesn't fit that page's stated scope.

**`applyAspectRatio`'s literal `this._aspectMinSize = size` (flooring *both* axes to the just-derived pair) is a genuine defect in `## Internal Structure`, caught by this branch's own audit loop, not a cosmetic deviation.** Because `clampWidth`/`clampHeight` read `getMinSize()` *before* the current call's own derivation runs, flooring both axes makes the floor a one-way ratchet: `setWidth(300)` derives and floors `{300, 150}`; a later `setWidth(100)` is clamped back up to `300` by its own stale floor, and the image can grow but never shrink again. Worse, because a parent's `writeBounds` always calls `setWidth` then `setHeight` (the plan's own cited fact), the axis left floored at the end of every full layout pass is deterministically `width` (from that pass's final `setHeight` call deriving it) — so a parent handing an ill-fitting box (e.g. a `Split` pane) inflates the image on one axis and it never returns to the parent's later, smaller allocation, exactly the "clamped up … and overflows its slot" failure `## Overview` set out to delete, now unbounded instead of capped at 100px. The plan's own `[^drop-cap]` footnote independently concluded "`Text`'s real precedent is *no natural-size-derived width floor at all*" without carrying that conclusion through to `_aspectMinSize`'s design. The fix keeps the floor's shape (still asserted in `## Expected Behaviour`'s table, still protecting a same-pass companion call) but makes it correctly transient: `applyAspectRatio` floors only the *derived* axis (the driving axis gets `0`), and `setWidth`/`setHeight` each clear any stale floor on their *own* axis — via `{...this._aspectMinSize, width: 0}` / `{..., height: 0}` — before delegating to `super.setWidth`/`super.setHeight`, so a call is never blocked from shrinking by a floor an earlier, unrelated call left behind. This changes `## Expected Behaviour`'s `preserveAspectRatio` table: `getMinSize()` after `setWidth(120)` is now `{0, 60}` (not `{120, 60}`) and after the following `setHeight(150)` is now `{300, 0}` (not `{300, 150}`) — `getPreferredSize()` is unaffected in every row. A new test (`Image.test.ts`, "lets the image shrink again after growing, across repeated setWidth/setHeight passes") pins both the standalone-shrink case and the realistic repeated-pass case the audit's repro used.

**A second audit round found the ratchet fix above was itself incomplete in two ways, both since fixed.** First, `setHeight`'s own pre-clamp clear zeroed the *height* component of `_aspectMinSize` before `super.setHeight` ran — but a non-zero height floor only ever comes from the `setWidth` call immediately preceding it in the same pass (the intended same-pass protection), never from a stale earlier pass (that staleness only ever lands on *width*, since `writeBounds` always calls `setHeight` last), so `setHeight`'s clear was destroying the exact protection it was supposed to preserve, making the floor dead code on the only path the framework actually drives. Fixed by removing `setHeight`'s clear entirely — `setWidth`'s own clear (of *its own* axis only) is sufficient and correct, since only width ever accumulates real cross-pass staleness. Second, and more serious: `applyAspectRatio` republished a preferred size on *every* `setWidth`/`setHeight` call unconditionally, and the width-derived and height-derived pairs disagree whenever the committed box isn't already aspect-correct (true for any `fill`-type parent — `Fit`, a `Split` pane holding a fixed allocation — that doesn't defer to the child's preferred size); each disagreement fires `Component.setPreferredSize`'s change notify, which schedules another layout pass, which re-derives the same disagreeing pair again, forever — an actual infinite `requestAnimationFrame` loop, reproduced live in `packages/docs/src/demos/image-preserve-aspect-ratio.ts`'s own `Split` shape. The plan's `## Architecture Decisions` convergence argument ("once the parent hands back a width/height pair that already matches, further calls are no-ops") assumes the parent eventually adapts its allocation to the child's published preferred size, which is false for a `fill`-type parent — `## Internal Structure`'s `applyAspectRatio` snippet has no guard against this, and neither does its cited precedent as literally reproduced there, even though `Text.setWidth` (`Text.ts:690-699`) — the same precedent — does guard on it (`if (this.isWrapping() && this.getWidth() !== previous)`, documented there as "idempotent once the width settles"). Fixed by adding the same guard to both `setWidth` and `setHeight`: capture `getWidth()`/`getHeight()` before calling `super.setWidth`/`super.setHeight`, and only call `applyAspectRatio` when the committed value actually changed. A parent that keeps re-asserting an unwinnable box now settles after exactly the "one extra pass" the plan's own convergence argument describes, holding the box at the parent's actual allocation (not aspect-correct, since nothing can force that against a rigid `fill` parent) rather than spinning — verified against `Component.writeBounds`'s real call path via a throwaway `Container` + `Fit` + `Image` probe (one `requestAnimationFrame` drained, zero pending afterward; not kept in the branch, since the committed `Image.test.ts` regression test pins the same guarantee — no further notifies once a mismatched box repeats — without needing a real layout manager). This also makes `packages/lib/docs/components/Image.md`'s and `changelog/next.md`'s "keeps width and height proportional as the box is resized" description true of the shipped demo rather than aspirational.

## Notes

[^drop-cap]: The alternative considered was making the whole auto-min-floor behaviour opt-in behind a new option (e.g. `enforceMinNaturalSize`). Rejected in favour of dropping it outright: `Text.getMinSize()` ([Text.ts:764-798](packages/lib/src/typescript/lib/component/input/Text.ts#L764-L798)) is the cited precedent for an auto-derived minimum floor, and its actual behaviour — not just its doc comment — floors only the **height** axis (one line of text) and never the width; the `autoMinWidth`/`TEXT_AUTO_MIN_WIDTH_CAP_PX` computation in `applyNaturalMetrics` ([Text.ts:437-439](packages/lib/src/typescript/lib/component/input/Text.ts#L437-L439)) is stored in `_measuredMinSize.width` but never read back — `getMinSize()`'s return statements ([Text.ts:790-797](packages/lib/src/typescript/lib/component/input/Text.ts#L790-L797)) use only `base.width`, never `measured.width`. So `Text`'s real precedent is "no natural-size-derived width floor at all," which is closer to dropping `Image`'s cap than to gating it behind a new option. A new option would also add a speculative, currently-unrequested knob (`CLAUDE.md`'s Simplicity First: "no configurability that wasn't requested") for a behaviour `preserveAspectRatio` already gives callers a principled, aspect-consistent way to opt into.

[^object-fit-local]: `grep -rn "object-fit\|objectFit\|object-position\|objectPosition" packages/lib/src/` returned no matches anywhere in the source tree before this plan. `Video` is a plausible second consumer (a `<video>` element also respects `object-fit`) but has no such field today and is out of this plan's `touches-shared` scope; generalizing now would be speculative for a consumer that doesn't yet exist in code.

[^no-explicit-gate]: Reproducing `Text`'s gate would require knowing "was the current `preferredSize` set by the caller or auto-published by `handleLoad`" — exactly the distinction `image-attribute-options-surface`'s `_hasExplicitPreferredSize` flag exists to make, and this plan does not depend on that plan (see `## Architecture Decisions`, *Coordinating with...*). `Component.getPreferredSizeConstraint()` alone cannot substitute: it reports only "is a `preferredSize` currently set," which becomes non-null after `handleLoad`'s own first auto-publish regardless of whether that publish was caller- or framework-initiated (the same limitation the dependency plan's own `[^no-flag]` note describes) — gating on it would permanently disable `preserveAspectRatio`'s derivation after the very first `load` event, defeating the feature. Rather than take a soft dependency on a flag that may not exist yet, this plan makes `preserveAspectRatio` a standing contract with no gate: unlike `Text`'s wrap recalculation (a best-effort heuristic that should defer to a caller who fixed the size on purpose), `preserveAspectRatio: true` is an explicit, opt-in statement that width and height should always track each other, so a caller who also wants a fixed size simply leaves it off.
