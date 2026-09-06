// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
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
 * otherwise publish on load. It does not pin the *rendered* size on its
 * own: `getMinSize()` still auto-derives a floor from the natural size once
 * loaded (capped at 100px per axis), independently of `preferredSize`, and a
 * parent layout floors the committed size to that minimum — call
 * `setMinSize()` explicitly if a smaller pinned size must render exactly as
 * given.
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

    /**
     * Construction-time listener bag — the declarative form of `on()`, one key
     * per re-emitted image event.
     */
    listeners?: {
        load?:  () => void;
        error?: () => void;
    };
}

// Upper bound for the auto-derived `minSize` per axis. Small images report
// their intrinsic size (so a 16×16 favicon stays sharp at full natural size);
// larger images cap here so their parent layout can always shrink them down.
const IMAGE_AUTO_MIN_CAP_PX = 100;

/**
 * Class-level defaults forwarded to `super` so the cascade hits Component's
 * applyOptions with `{ tag: "img" }` already merged into `_defaultOptions`.
 */
const _defaultImageOptions: Partial<ImageOptions> = {
    tag: "img",
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
 * @category Components
 */
class Image extends Component<ImageOptions> {

    // Cached once per load — see `handleLoad`. `null` before the image has
    // decoded. Content-box dimensions (no perimeter).
    private _naturalSize: Size | null = null;

    /** Custom-event fan-out for the re-emitted load/error events. */
    private _listeners: ListenerBag<ImageMediaEvent> =
        this.registerListenerBag(new ListenerBag<ImageMediaEvent>());

    // Stable per-instance references so `destructor()` removes the exact
    // listener `init()` registered — mirrors Video's `_mediaHandlers` entries.
    private readonly _onLoad:  () => void = () => this.handleLoad();
    private readonly _onError: () => void = () => this.emit("error");

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
     * Caches the image's natural intrinsic size and, unless the caller already
     * set an explicit `preferredSize`, publishes it (natural size plus this
     * component's own perimeter) so it reaches layout. Re-emits `"load"`
     * either way.
     */
    private handleLoad(): void {
        const element = this.getElement();

        if (!element) {
            return;
        }

        const natural = DOM.source.getNaturalSize(element);
        this._naturalSize = { width: natural.width, height: natural.height };

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
     * Returns a minimum size derived from the image's cached natural
     * dimensions (mirrors the `Math.min(natural, 100)` cap that `Text`
     * applies), so small images keep their full size while large images stay
     * shrinkable by their parent layout. An explicit `setMinSize` from the
     * caller always wins.
     *
     * @returns The minimum `{width, height}` from the cached natural size, or
     *   `{0, 0}` (no minimum) before the image has loaded.
     */
    getMinSize(): Size | null {
        if (!this.instanceLayer().authored.minSize && this._naturalSize) {
            return {
                width:  Math.min(this._naturalSize.width,  IMAGE_AUTO_MIN_CAP_PX),
                height: Math.min(this._naturalSize.height, IMAGE_AUTO_MIN_CAP_PX),
            };
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
