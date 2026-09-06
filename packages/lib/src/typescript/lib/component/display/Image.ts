// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { type StyleBag, type StyleStateSpec } from "~/core/ClassStyleRules.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";
import { ListenerBag } from "~/core/ListenerBag.js";

/**
 * The native, non-bubbling image events {@link Image} re-emits through its
 * custom `on` / `off` surface, wired directly on the element through the
 * DOM seam at render time (mirrors {@link Video}'s media-event bridge).
 *
 * @category Components
 */
export type ImageMediaEvent = "load" | "error";

/**
 * Construction-time options for {@link Image}.
 *
 * @remarks Supplying `preferredSize` pins the component's preferred size and
 * disables the default natural-dimension auto-fit `getPreferredSize()` would
 * otherwise publish on load. `getMinSize()` reports `{0, 0}` (no minimum)
 * until an explicit `setMinSize`, `preserveAspectRatio`'s own
 * `setWidth`/`setHeight`-driven floor (see `preserveAspectRatio` below), or
 * a failed decode's fixed placeholder floor (see `isBroken()` below) has
 * raised it.
 *
 * @category Components
 */
export interface ImageOptions extends ComponentOptions {
    /** Image source URL. */
    src?: string;
    /** Accessible text alternative; pass `""` to mark the image decorative. */
    alt?: string;
    /** Native lazy-loading hint (`loading` attribute). */
    loading?: "lazy" | "eager";
    /** Native decode hint (`decoding` attribute). */
    decoding?: "sync" | "async" | "auto";
    /** Native fetch-priority hint (`fetchpriority` attribute). */
    fetchPriority?: "high" | "low" | "auto";
    /** CORS mode for the image request (`crossorigin` attribute). */
    crossOrigin?: "anonymous" | "use-credentials";
    /** Referrer policy for the image request (`referrerpolicy` attribute). */
    referrerPolicy?: ReferrerPolicy; // TypeScript's built-in DOM-lib global type
    /** CSS `object-fit`: how the image content fits its box when the box's aspect ratio doesn't match the image's. */
    objectFit?: "fill" | "contain" | "cover" | "none" | "scale-down";
    /** CSS `object-position`: alignment of the image content within its box. */
    objectPosition?: string;
    /** Keeps width and height proportional to the natural aspect ratio as the box is resized. Opt-in; off by default. */
    preserveAspectRatio?: boolean;

    /**
     * Construction-time listener bag — the declarative form of `on()`, one key
     * per re-emitted image event.
     */
    listeners?: {
        load?:  () => void;
        error?: () => void;
    };
}

/**
 * Class-level defaults forwarded to `super` so the cascade hits Component's
 * applyOptions with `{ tag: "img" }` already merged into `_defaultOptions`.
 */
const _defaultImageOptions: Partial<ImageOptions> = {
    tag: "img",
};

// Fallback square size published as the broken image's preferred/min size
// when no explicit size was requested, so a failed decode still reserves a
// visible box instead of collapsing to nothing. A fixed literal, not
// theme-scaled: this is a layout decision (big enough to read as a
// deliberate placeholder), not a chrome token.
const IMAGE_BROKEN_PLACEHOLDER_PX = 48;

/** `.loading`'s chrome — a flat neutral wash while the image decodes. */
const IMAGE_LOADING_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-image-loading-bg, rgba(0, 0, 0, 0.06))",
};

/** `.broken`'s chrome — a flat, distinct wash marking a failed decode. */
const IMAGE_BROKEN_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-image-broken-bg, rgba(220, 60, 60, 0.08))",
};

/**
 * An image component backed by an `<img>` element.
 *
 * Reports its preferred size from the image's natural intrinsic dimensions
 * once loaded: a native `load` handler caches the natural size and publishes
 * it through `setPreferredSize` (unless the caller already set an explicit
 * `preferredSize`), and re-emits `load` / `error` through this component's
 * own `on` / `off` surface, since neither DOM event bubbles. Before the image
 * has loaded, `getPreferredSize()` reports no opinion (`null`).
 *
 * Every standard `<img>` attribute (`src`, `alt`, `loading`, `decoding`,
 * `fetchPriority`, `crossOrigin`, `referrerPolicy`) has a typed getter/setter
 * pair and a matching `ImageOptions` field. `alt` is the native accessible
 * name for an image — always pass one (an empty string for a purely
 * decorative image). `setSrc` swaps the displayed source after construction
 * and invalidates the cached natural size, so the next `load` re-measures
 * instead of reporting the previous image's dimensions; an explicit
 * `preferredSize` survives a source change.
 *
 * `objectFit` / `objectPosition` are plain CSS pass-throughs (no default
 * effect until set). `preserveAspectRatio` is an opt-in sizing behaviour,
 * off by default: once enabled, `setWidth`/`setHeight` re-derive the other
 * axis from the natural aspect ratio and raise `getMinSize()`'s floor to
 * match, so a parent's layout pass keeps the image's proportions locked as
 * its box is resized.
 *
 * While a source is decoding, `Image` carries a declared `.loading` visual
 * state (a neutral background wash); if the decode fails, it carries
 * `.broken` instead (a distinct wash) and publishes a fixed 48x48 placeholder
 * size in place of the failed image, so a broken source still reserves a
 * visible box rather than collapsing to nothing. `isLoading()` / `isBroken()`
 * report which applies — both are derived from the native `load`/`error`
 * events, with no public setter.
 *
 * @category Components
 */
class Image extends Component<ImageOptions> {

    // `.loading`'s and `.broken`'s chrome — see `resetLoadState()` /
    // `handleLoad()` / `handleError()` for when each is toggled. Not
    // restating Component's own `.undisplayed`/`.invisible` entries — a
    // subclass with its own `ownStyleStates` isn't required to (Component.ts
    // 408-410).
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        { selector: ".loading", extract: (): StyleBag => IMAGE_LOADING_DECLARATIONS },
        { selector: ".broken",  extract: (): StyleBag => IMAGE_BROKEN_DECLARATIONS },
    ];

    // Cached once per load — see `handleLoad`. `null` before the image has
    // decoded. Content-box dimensions (no perimeter).
    private _naturalSize: Size | null = null;

    // The {width, height} pair last derived by setWidth/setHeight under
    // preserveAspectRatio, used as getMinSize()'s floor. Null until the
    // parent has assigned a concrete width or height at least once — see
    // `applyAspectRatio`.
    private _aspectMinSize: Size | null = null;

    // The _naturalSize reference applyAspectRatio last derived
    // _aspectMinSize from. setWidth/setHeight compare this against the
    // current _naturalSize (by reference — handleLoad always assigns a
    // fresh object) to force one extra re-derivation after setSrc swaps in
    // a differently-shaped image, even when the committed value on that
    // axis happens to repeat — see setWidth's doc comment.
    private _aspectDerivedFrom: Size | null = null;

    /** Custom-event fan-out for the re-emitted load/error events. */
    private _listeners: ListenerBag<ImageMediaEvent> =
        this.registerListenerBag(new ListenerBag<ImageMediaEvent>());

    // Stable per-instance references so `destructor()` removes the exact
    // listener `init()` registered — mirrors Video's `_mediaHandlers` entries.
    private readonly _onLoad:  () => void = () => this.handleLoad();
    private readonly _onError: () => void = () => this.handleError();

    // Whether the current preferredSize constraint came from the caller (a
    // constructor `preferredSize` option or a direct setPreferredSize /
    // clearPreferredSize call) rather than this component's own auto-publish
    // in handleLoad(). Declared bare — no initializer — per
    // CODE_CONVENTIONS.md's "Fields written during the super() cascade must
    // use declare": Component.applyOptions calls
    // `this.setPreferredSize(options.preferredSize)` polymorphically from
    // inside super(), before a plain `= false` initializer would run and
    // silently wipe a cascade-set `true` back to `false`.
    declare private _hasExplicitPreferredSize: boolean;

    /**
     * @param src - Image source URL.
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(src: string, options?: ImageOptions, subclassDefaults?: Partial<ImageOptions>) {
        super(options, { ..._defaultImageOptions, ...(subclassDefaults ?? {}) });

        // Seeds the flag for a subclass that defaults `preferredSize` via
        // `subclassDefaults` without the cascade ever calling this class's
        // own `setPreferredSize` override (a class default is a pure
        // fallback Component.applyOptions never dispatches — see
        // ARCHITECTURE.md's "Class-level defaults must survive the getter").
        // `getPreferredSizeConstraint()` folds that default in, so treating
        // a non-null constraint here as "explicit" preserves the same
        // "don't overwrite a pinned size on load" behaviour the pre-plan
        // code got for free from its own `getPreferredSizeConstraint()`
        // gate. A no-default instance still seeds `false`, unchanged.
        this._hasExplicitPreferredSize ??= this.getPreferredSizeConstraint() !== null;
        this.clearInsets();
        this.resetLoadState();

        // Positional `src` argument: applied only when `options.src` didn't
        // already win via the applyOptions cascade above. See "src stays a
        // required positional constructor argument" in the plan's
        // Architecture Decisions.
        if (this._options.src === undefined) {
            this.setSrc(src);
        }

        this.applyListeners(options?.listeners);
    }

    /**
     * Forwards the option-backed attribute fields to their setters after
     * inherited Component fields cascade through `super.applyOptions`. The
     * setters cache on `_options`; DOM writes no-op until the element exists
     * and are replayed at render.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: ImageOptions): this {
        super.applyOptions(options);

        if (options.src            !== undefined) this.setSrc(options.src);
        if (options.alt            !== undefined) this.setAlt(options.alt);
        if (options.loading        !== undefined) this.setLoading(options.loading);
        if (options.decoding       !== undefined) this.setDecoding(options.decoding);
        if (options.fetchPriority  !== undefined) this.setFetchPriority(options.fetchPriority);
        if (options.crossOrigin    !== undefined) this.setCrossOrigin(options.crossOrigin);
        if (options.referrerPolicy !== undefined) this.setReferrerPolicy(options.referrerPolicy);
        if (options.objectFit            !== undefined) this.setObjectFit(options.objectFit);
        if (options.objectPosition       !== undefined) this.setObjectPosition(options.objectPosition);
        if (options.preserveAspectRatio  !== undefined) this.setPreserveAspectRatio(options.preserveAspectRatio);

        return this;
    }

    /**
     * Returns the image source URL.
     *
     * @returns The `src`, or `null` when unset.
     */
    getSrc(): string | null {
        return this._options.src ?? null;
    }

    /**
     * Sets the image source URL (writes the `src` attribute) and invalidates
     * the cached natural size, so the next `load` re-measures instead of
     * reporting the previous image's dimensions.
     *
     * @param src - The image source URL.
     *
     * @returns This component, for method chaining.
     */
    setSrc(src: string): this {
        this.resetLoadState();
        this._options.src = src;
        this.setElementAttribute("src", src);
        this._naturalSize = null; // new source — the cached natural size is stale; re-measure on the next load

        return this;
    }

    /**
     * Returns the accessible text alternative.
     *
     * @returns The `alt` text, or `null` when unset.
     */
    getAlt(): string | null {
        return this._options.alt ?? null;
    }

    /**
     * Sets the accessible text alternative (writes the `alt` attribute) — the
     * native accessible-name source for an image. Pass `""` to mark the
     * image decorative.
     *
     * @param value - The alt text.
     *
     * @returns This component, for method chaining.
     */
    setAlt(value: string): this {
        this._options.alt = value;
        this.setElementAttribute("alt", value);

        return this;
    }

    /**
     * Returns the lazy-loading hint.
     *
     * @returns The `loading` value, or `null` when unset.
     */
    getLoading(): "lazy" | "eager" | null {
        return this._options.loading ?? null;
    }

    /**
     * Sets the lazy-loading hint (writes the `loading` attribute).
     *
     * @param value - One of `"lazy"`, `"eager"`.
     *
     * @returns This component, for method chaining.
     */
    setLoading(value: "lazy" | "eager"): this {
        this._options.loading = value;
        this.setElementAttribute("loading", value);

        return this;
    }

    /**
     * Returns the decode hint.
     *
     * @returns The `decoding` value, or `null` when unset.
     */
    getDecoding(): "sync" | "async" | "auto" | null {
        return this._options.decoding ?? null;
    }

    /**
     * Sets the decode hint (writes the `decoding` attribute).
     *
     * @param value - One of `"sync"`, `"async"`, `"auto"`.
     *
     * @returns This component, for method chaining.
     */
    setDecoding(value: "sync" | "async" | "auto"): this {
        this._options.decoding = value;
        this.setElementAttribute("decoding", value);

        return this;
    }

    /**
     * Returns the fetch-priority hint.
     *
     * @returns The `fetchPriority` value, or `null` when unset.
     */
    getFetchPriority(): "high" | "low" | "auto" | null {
        return this._options.fetchPriority ?? null;
    }

    /**
     * Sets the fetch-priority hint (writes the `fetchpriority` attribute).
     *
     * @param value - One of `"high"`, `"low"`, `"auto"`.
     *
     * @returns This component, for method chaining.
     */
    setFetchPriority(value: "high" | "low" | "auto"): this {
        this._options.fetchPriority = value;
        this.setElementAttribute("fetchpriority", value); // literal HTML attribute name — no camelCase

        return this;
    }

    /**
     * Returns the CORS mode.
     *
     * @returns The `crossOrigin` value, or `null` when unset.
     */
    getCrossOrigin(): "anonymous" | "use-credentials" | null {
        return this._options.crossOrigin ?? null;
    }

    /**
     * Sets the CORS mode (writes the `crossorigin` attribute).
     *
     * @param value - One of `"anonymous"`, `"use-credentials"`.
     *
     * @returns This component, for method chaining.
     */
    setCrossOrigin(value: "anonymous" | "use-credentials"): this {
        this._options.crossOrigin = value;
        this.setElementAttribute("crossorigin", value); // literal HTML attribute name — no camelCase

        return this;
    }

    /**
     * Returns the referrer policy.
     *
     * @returns The `referrerPolicy` value, or `null` when unset.
     */
    getReferrerPolicy(): ReferrerPolicy | null {
        return this._options.referrerPolicy ?? null;
    }

    /**
     * Sets the referrer policy (writes the `referrerpolicy` attribute).
     *
     * @param value - A `ReferrerPolicy` value.
     *
     * @returns This component, for method chaining.
     */
    setReferrerPolicy(value: ReferrerPolicy): this {
        this._options.referrerPolicy = value;
        this.setElementAttribute("referrerpolicy", value); // literal HTML attribute name — no camelCase

        return this;
    }

    /**
     * Returns the CSS `object-fit` value.
     *
     * @returns The `objectFit` value, or `null` when unset.
     */
    getObjectFit(): "fill" | "contain" | "cover" | "none" | "scale-down" | null {
        return this._options.objectFit ?? null;
    }

    /**
     * Sets the CSS `object-fit` property, controlling how the image content
     * fits its box when the box's aspect ratio doesn't match the image's.
     *
     * @param value - One of `"fill"`, `"contain"`, `"cover"`, `"none"`,
     *   `"scale-down"`.
     *
     * @returns This component, for method chaining.
     */
    setObjectFit(value: "fill" | "contain" | "cover" | "none" | "scale-down"): this {
        this._options.objectFit = value;
        this.setElementCSSRule("objectFit", value);

        return this;
    }

    /**
     * Returns the CSS `object-position` value.
     *
     * @returns The `objectPosition` value, or `null` when unset.
     */
    getObjectPosition(): string | null {
        return this._options.objectPosition ?? null;
    }

    /**
     * Sets the CSS `object-position` property, aligning the image content
     * within its box.
     *
     * @param value - A CSS `object-position` value (e.g. `"top center"`).
     *
     * @returns This component, for method chaining.
     */
    setObjectPosition(value: string): this {
        this._options.objectPosition = value;
        this.setElementCSSRule("objectPosition", value);

        return this;
    }

    /**
     * Returns whether `preserveAspectRatio` is enabled.
     *
     * @returns `true` when `setWidth`/`setHeight` re-derive the dependent
     *   axis from the natural aspect ratio; `false` (the default) otherwise.
     */
    getPreserveAspectRatio(): boolean {
        return this._options.preserveAspectRatio ?? false;
    }

    /**
     * Enables or disables aspect-ratio-preserving sizing (see
     * `applyAspectRatio`). Clears the `_aspectMinSize` floor so a stale
     * value computed under the opposite setting can't leak into
     * `getMinSize()`; the new floor is derived on the next
     * `setWidth`/`setHeight` call.
     *
     * @param value - `true` to keep width and height proportional to the
     *   natural aspect ratio as the box is resized.
     *
     * @returns This component, for method chaining.
     */
    setPreserveAspectRatio(value: boolean): this {
        this._options.preserveAspectRatio = value;
        this._aspectMinSize = null;

        return this;
    }

    /**
     * Pins an explicit preferred size, marking it as caller-supplied so
     * `handleLoad()` never overwrites it with an auto-derived natural size.
     *
     * @param size - The preferred size to pin.
     *
     * @returns This component, for method chaining.
     */
    setPreferredSize(size: Size): this {
        this._hasExplicitPreferredSize = true;

        return super.setPreferredSize(size);
    }

    /**
     * Drops the explicit preferred-size constraint, letting `handleLoad()`
     * auto-derive the preferred size from the natural dimensions again on
     * the next load.
     *
     * @returns This component, for method chaining.
     */
    clearPreferredSize(): this {
        this._hasExplicitPreferredSize = false;

        return super.clearPreferredSize();
    }

    /**
     * Whether the image is currently decoding — active from construction (or
     * a source change, via `setSrc`) until `load` or `error` fires.
     *
     * @returns True while `.loading` is the active visual state.
     */
    isLoading(): boolean {
        return this.isStyleState(".loading");
    }

    /**
     * Whether the most recent decode attempt failed.
     *
     * @returns True while `.broken` is the active visual state.
     */
    isBroken(): boolean {
        return this.isStyleState(".broken");
    }

    /**
     * Re-enters the loading state: clears `.broken` and sets `.loading`.
     * Called from the constructor (initial entry) and from `setSrc`
     * (re-entry on a source change).
     */
    private resetLoadState(): void {
        this.setStyleState(".broken", false);
        this.setStyleState(".loading", true);
    }

    /**
     * Caches the image's natural intrinsic size and, unless the caller already
     * set an explicit `preferredSize`, publishes it (natural size plus this
     * component's own perimeter) so it reaches layout. Clears both `.loading`
     * and `.broken` unconditionally, so this is correct regardless of which
     * state the instance was in before `load` fired. Re-emits `"load"`
     * either way.
     */
    private handleLoad(): void {
        const element = this.getElement();

        if (!element) {
            return;
        }

        const natural = DOM.source.getNaturalSize(element);
        this._naturalSize = { width: natural.width, height: natural.height };

        this.setStyleState(".loading", false);
        this.setStyleState(".broken", false);

        if (this._hasExplicitPreferredSize) {
            // An explicit preferredSize means the natural size isn't
            // published below, but it can still change the auto-derived
            // minSize (see getMinSize()) — relay that upward, since neither
            // setPreferredSize nor setMinSize runs on this branch to do so
            // automatically.
            this.notifyIntrinsicSizeChanged();
        } else {
            const perimeter = this.getPerimeterSize();

            // Calls the base setter directly so this auto-publish does not
            // itself trip `_hasExplicitPreferredSize` back to true (which
            // would freeze out a later reload's own auto-publish).
            super.setPreferredSize({
                width:  this._naturalSize.width  + perimeter.left + perimeter.right,
                height: this._naturalSize.height + perimeter.top  + perimeter.bottom,
            });
        }

        this.emit("load");
    }

    /**
     * Marks the decode as failed: sets `.broken` and clears `.loading`, and —
     * unless the caller already set an explicit `preferredSize` — publishes a
     * fixed placeholder size so a broken source still reserves a visible box
     * instead of collapsing to nothing. `getMinSize()` floors to the same
     * placeholder regardless of the preferred-size constraint (see its own
     * override). Re-emits `"error"` either way.
     */
    private handleError(): void {
        this.setStyleState(".loading", false);
        this.setStyleState(".broken", true);

        if (this._hasExplicitPreferredSize) {
            // preferredSize itself is unchanged, but getMinSize()'s new
            // `.broken` floor still needs relaying upward — mirrors
            // handleLoad()'s own explicit-size branch above.
            this.notifyIntrinsicSizeChanged();
        } else {
            const perimeter = this.getPerimeterSize();

            // Calls the base setter directly, matching handleLoad() above, so
            // this auto-publish does not itself trip `_hasExplicitPreferredSize`.
            super.setPreferredSize({
                width:  IMAGE_BROKEN_PLACEHOLDER_PX + perimeter.left + perimeter.right,
                height: IMAGE_BROKEN_PLACEHOLDER_PX + perimeter.top  + perimeter.bottom,
            });
        }

        this.emit("error");
    }

    /**
     * Returns the preferred size: an explicit caller override, else the
     * natural size published by `handleLoad` once the image has loaded, else
     * `null` (no opinion pre-load).
     *
     * @returns The preferred `Size`, or `null` before an explicit size or a
     *   completed load has published one.
     */
    getPreferredSize(): Size | null {
        return super.getPreferredSize();
    }

    /**
     * Re-derives the height from the current width under `preserveAspectRatio`
     * and republishes the preferred size (see `applyAspectRatio`).
     *
     * Clears a stale width floor `applyAspectRatio` may have left on
     * `_aspectMinSize` from an earlier `setHeight`-driven derivation, before
     * `super.setWidth`'s own clamp reads `getMinSize()` — otherwise a later,
     * smaller `setWidth` call could be clamped back up by a floor that had
     * nothing left to protect (nothing follows `setHeight` within the same
     * `writeBounds` pass, since it always runs last — see
     * `applyAspectRatio`'s doc comment). `setHeight` below has no matching
     * clear: a non-zero height floor only ever comes from the `setWidth`
     * call immediately preceding it in the same pass, which is exactly the
     * protection that floor exists to provide.
     *
     * Skips re-deriving when the committed width didn't actually change
     * (mirrors `Text.setWidth`'s own idempotency guard, `Text.ts:690-699`)
     * — otherwise a parent that keeps re-asserting the same box every layout
     * pass (one that can never become aspect-correct, e.g. a fixed-size
     * `Fit`/`Split` allocation) would have this and `setHeight` perpetually
     * disagree on the published preferred size, notifying forever instead
     * of settling once idempotent. Re-derives anyway when `_naturalSize` has
     * moved on since the last derivation — otherwise a `setSrc` swap whose
     * next committed width happens to repeat the previous value would leave
     * `_aspectMinSize` and the published preferred size locked to the old
     * image's aspect ratio forever, since nothing else would ever trigger a
     * re-derivation for that axis again.
     *
     * @param width - The new width in pixels.
     *
     * @returns This component, for method chaining.
     */
    setWidth(width: number): this {
        const previous = this.getWidth();

        if (this._aspectMinSize) {
            this._aspectMinSize = { ...this._aspectMinSize, width: 0 };
        }

        super.setWidth(width);

        if (this.getWidth() !== previous || this._naturalSize !== this._aspectDerivedFrom) {
            this.applyAspectRatio("width");
        }

        return this;
    }

    /**
     * Re-derives the width from the current height under `preserveAspectRatio`
     * and republishes the preferred size (see `applyAspectRatio`). Skips
     * re-deriving when the committed height didn't actually change and
     * `_naturalSize` hasn't moved on since the last derivation, mirroring
     * `setWidth`'s own idempotency guard (see its doc comment for why).
     *
     * @param height - The new height in pixels.
     *
     * @returns This component, for method chaining.
     */
    setHeight(height: number): this {
        const previous = this.getHeight();

        super.setHeight(height);

        if (this.getHeight() !== previous || this._naturalSize !== this._aspectDerivedFrom) {
            this.applyAspectRatio("height");
        }

        return this;
    }

    /**
     * Re-derives the axis `setWidth`/`setHeight` did *not* just commit, from
     * the cached natural aspect ratio, and republishes both as the preferred
     * size — bypassing any explicit-preferred-size bookkeeping this class's
     * own `setPreferredSize` override adds, since this is a derived value,
     * not a caller override. Also raises `_aspectMinSize`'s floor on the
     * *derived* axis only (the driving axis is left at `0`) — a floor on the
     * driving axis would block a later call from shrinking that same axis
     * again. The derived-axis floor still protects a same-pass companion
     * call (a parent's `writeBounds` always calls `setWidth` then
     * `setHeight`) from clipping below the aspect-correct size — `setWidth`
     * always runs first, so only the floor `setHeight` reads (on height) is
     * ever a live same-pass protection; the floor `setWidth` would read (on
     * width) is always stale from an earlier pass, which is why only
     * `setWidth` clears it. No-op before the first `load` (`_naturalSize`
     * still `null`), for a malformed zero-dimension natural size, or when
     * `preserveAspectRatio` is off — in all three no-op cases,
     * `_aspectDerivedFrom` is left untouched. On an actual derivation, it is
     * set to the `_naturalSize` reference just used, so `setWidth`/
     * `setHeight`'s idempotency guard can tell a genuinely unchanged box from
     * one that only looks unchanged because a `setSrc` swap hasn't been
     * accounted for yet.
     *
     * @param drivingAxis - The axis `setWidth`/`setHeight` just committed;
     *   the other axis is derived from it.
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

        this._aspectMinSize = drivingAxis === "width"
            ? { width: 0, height: size.height }
            : { width: size.width, height: 0 };

        this._aspectDerivedFrom = this._naturalSize;

        super.setPreferredSize(size);
    }

    /**
     * Returns a minimum size: the fixed broken-image placeholder while
     * `.broken` is active, else the `preserveAspectRatio`-derived floor
     * raised by the last `setWidth`/`setHeight` call (see
     * `applyAspectRatio`), when present. An explicit `setMinSize` from the
     * caller always wins over either.
     *
     * @returns The minimum `{width, height}` from the broken-state
     *   placeholder or `_aspectMinSize`, or `{0, 0}` (no minimum) before
     *   either applies.
     */
    getMinSize(): Size | null {
        if (!this.instanceLayer().authored.minSize && this.isBroken()) {
            return { width: IMAGE_BROKEN_PLACEHOLDER_PX, height: IMAGE_BROKEN_PLACEHOLDER_PX };
        }

        if (!this.instanceLayer().authored.minSize && this._aspectMinSize) {
            return this._aspectMinSize;
        }

        return super.getMinSize();
    }

    /**
     * Returns the bottom edge of the preferred size as the baseline, matching
     * the CSS default baseline for a replaced element. `Image` content has no
     * ink-shape assumption to nudge against (unlike `Glyph`'s icon offset), so
     * this is the plain bottom edge with no adjustment.
     *
     * @returns The preferred height, or `null` before a size is known.
     */
    getBaseline(): number | null {
        const size = this.getPreferredSize();

        return size ? size.height : null;
    }

    /**
     * Registers a listener for one of this component's re-emitted image
     * events.
     *
     * @param event - The image event name.
     * @param listener - The callback invoked when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: ImageMediaEvent, listener: () => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered image-event listener.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: ImageMediaEvent, listener: () => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans an image event out to its registered listeners.
     *
     * @param event - The event to emit.
     */
    protected emit(event: ImageMediaEvent): void {
        this._listeners.fire(event);
    }

    /**
     * Wires the native, non-bubbling `load`/`error` listeners onto the
     * freshly created element.
     *
     * @param element - The element being initialised, when provided by the caller.
     *
     * @returns This component, for method chaining.
     */
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

    /**
     * Detaches the native `load`/`error` listeners installed at render, then
     * defers to the base class for the rest of teardown.
     */
    protected destructor(): void {
        const element = this.getElement();

        if (element) {
            DOM.sink.removeListener(element, "load", this._onLoad);
            DOM.sink.removeListener(element, "error", this._onError);
        }

        super.destructor();
    }
}

const ImageCallable = callable(Image);
type ImageCallable = Image;
export {
    Image         as _Image,
    ImageCallable as Image
};
