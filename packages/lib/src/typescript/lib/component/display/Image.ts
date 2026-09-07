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
 * @category Components
 */
class Image extends Component<ImageOptions> {

    private _src: String;

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

    /**
     * @param src - Image source URL.
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(src: String, options?: ImageOptions, subclassDefaults?: Partial<ImageOptions>) {
        super(options, { ..._defaultImageOptions, ...(subclassDefaults ?? {}) });

        this._src = src;
        this.clearInsets();
        this.applyListeners(options?.listeners);
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

        if (this.getPreferredSizeConstraint()) {
            // An explicit preferredSize means the natural size isn't
            // published below, but it can still change the auto-derived
            // minSize (see getMinSize()) — relay that upward, since neither
            // setPreferredSize nor setMinSize runs on this branch to do so
            // automatically.
            this.notifyIntrinsicSizeChanged();
        } else {
            const perimeter = this.getPerimeterSize();

            this.setPreferredSize({
                width:  this._naturalSize.width  + perimeter.left + perimeter.right,
                height: this._naturalSize.height + perimeter.top  + perimeter.bottom,
            });
        }

        this.emit("load");
    }

    /**
     * Returns the component's element handle.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's element handle.
     */
    getElement(createIfMissing: boolean = false): Handle | undefined {
        return super.getElement(createIfMissing);
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
     * Renders the img element and sets its src attribute.
     *
     * @returns The created HTMLImageElement with its src initialised.
     */
    render(): Handle {
        let element = super.render();

        DOM.sink.apply(element, { setAttr: { src: this._src.valueOf() } });

        return element;
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
