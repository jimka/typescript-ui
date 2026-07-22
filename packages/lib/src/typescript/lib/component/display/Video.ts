// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, MediaState } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";

/**
 * The media events {@link Video} re-emits through its custom `on` / `off`
 * surface. All are non-bubbling DOM media events, wired natively at render time
 * via `DOM.sink.addListener` (they never reach the `Event` class's window-level
 * capture handler) and fanned back out through the {@link ListenerBag}.
 *
 * @category Components
 */
export type VideoMediaEvent =
    | "timeupdate"
    | "play"
    | "pause"
    | "ended"
    | "loadedmetadata"
    | "durationchange"
    | "volumechange"
    | "ratechange";

/** The re-emitted media event types, iterated when wiring native listeners. */
const VIDEO_MEDIA_EVENTS: readonly VideoMediaEvent[] = [
    "timeupdate",
    "play",
    "pause",
    "ended",
    "loadedmetadata",
    "durationchange",
    "volumechange",
    "ratechange",
];

// Full volume — the browser's own default for a fresh media element, mirrored so
// a Video with no `volume` option reports the same value the element would.
const DEFAULT_VOLUME = 1;

// Normal playback speed — the browser's default `playbackRate`, mirrored so a
// Video with no `playbackRate` option reports the element's own default.
const DEFAULT_PLAYBACK_RATE = 1;

/**
 * Construction-time options for {@link Video}.
 *
 * @category Components
 */
export interface VideoOptions extends ComponentOptions {
    src?:          string;
    poster?:       string;
    autoplay?:     boolean;
    loop?:         boolean;
    muted?:        boolean;
    preload?:      "none" | "metadata" | "auto";
    /** Audio volume, clamped to `[0, 1]`. */
    volume?:       number;
    playbackRate?: number;
    /**
     * Construction-time listener bag — the declarative form of `on()`, one key
     * per re-emitted media event.
     */
    listeners?: {
        timeupdate?:      () => void;
        play?:            () => void;
        pause?:           () => void;
        ended?:           () => void;
        loadedmetadata?:  () => void;
        durationchange?:  () => void;
        volumechange?:    () => void;
        ratechange?:      () => void;
    };
}

/**
 * Class-level defaults forwarded to `super` so the cascade hits Component's
 * applyOptions with `{ tag: "video" }` already merged into `_defaultOptions`
 * (mirrors {@link Image}'s `tag: "img"`).
 */
const _defaultVideoOptions: Partial<VideoOptions> = {
    tag: "video",
};

/**
 * A native `<video>` surface primitive — the media twin of [`Image`](/api/component/display/classes/Image).
 *
 * Owns the typed media setters, a live playback-state read
 * ({@link Video.getMediaState}), and the native media-event bridge: because DOM
 * media events (`timeupdate`, `play`, …) do not bubble, they are wired directly
 * on the element through the DOM seam at render time and re-emitted through this
 * component's custom `on` / `off` surface. A bare video surface is independently
 * useful; the `VideoPlayer` composite layers a control bar on top of it.
 *
 * @category Components
 */
class Video extends Component<VideoOptions> {

    /** Custom-event fan-out for the re-emitted media events. */
    private _listeners: ListenerBag<VideoMediaEvent> = new ListenerBag<VideoMediaEvent>();

    /**
     * Per-type native handlers, held so the exact reference registered at render
     * can be removed on {@link Video.dispose}. Built once in the constructor.
     */
    private readonly _mediaHandlers: Map<VideoMediaEvent, () => void> = new Map();

    /**
     * Constructs a video surface.
     *
     * @param options - Optional construction options.
     */
    constructor(options?: VideoOptions) {
        super(options, _defaultVideoOptions);

        this.clearInsets();
        this.getAria().setLabel("Video");

        this.buildMediaHandlers();
        this.applyListeners(options?.listeners);
    }

    /**
     * Forwards the option-backed media fields to their setters after inherited
     * Component fields cascade through `super.applyOptions`. The setters cache on
     * `_options`; DOM writes no-op until the element exists and are replayed by
     * {@link Video.init}.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: VideoOptions): this {
        super.applyOptions(options);

        if (options.src          !== undefined) this.setSrc(options.src);
        if (options.poster       !== undefined) this.setPoster(options.poster);
        if (options.autoplay     !== undefined) this.setAutoplay(options.autoplay);
        if (options.loop         !== undefined) this.setLoop(options.loop);
        if (options.preload      !== undefined) this.setPreload(options.preload);
        if (options.muted        !== undefined) this.setMuted(options.muted);
        if (options.volume       !== undefined) this.setVolume(options.volume);
        if (options.playbackRate !== undefined) this.setPlaybackRate(options.playbackRate);

        return this;
    }

    /**
     * Returns the current media source URL.
     *
     * @returns The `src`, or `null` when unset.
     */
    getSrc(): string | null {
        return this._options.src ?? null;
    }

    /**
     * Sets the media source URL (writes the `src` attribute).
     *
     * @param src - The media source URL.
     *
     * @returns This component, for method chaining.
     */
    setSrc(src: string): this {
        this._options.src = src;
        this.setElementAttribute("src", src);

        return this;
    }

    /**
     * Returns the poster image URL.
     *
     * @returns The `poster`, or `null` when unset.
     */
    getPoster(): string | null {
        return this._options.poster ?? null;
    }

    /**
     * Sets the poster image shown before playback (writes the `poster` attribute).
     *
     * @param url - The poster image URL.
     *
     * @returns This component, for method chaining.
     */
    setPoster(url: string): this {
        this._options.poster = url;
        this.setElementAttribute("poster", url);

        return this;
    }

    /**
     * Whether the media autoplays once it can.
     *
     * @returns The `autoplay` state.
     */
    isAutoplay(): boolean {
        return this._options.autoplay ?? false;
    }

    /**
     * Sets whether the media autoplays (toggles the boolean `autoplay` attribute).
     *
     * @param value - Whether to autoplay.
     *
     * @returns This component, for method chaining.
     */
    setAutoplay(value: boolean): this {
        this._options.autoplay = value;
        this.setElementAttribute("autoplay", value ? "" : null);

        return this;
    }

    /**
     * Whether the media loops on reaching the end.
     *
     * @returns The `loop` state.
     */
    isLoop(): boolean {
        return this._options.loop ?? false;
    }

    /**
     * Sets whether the media loops (toggles the boolean `loop` attribute).
     *
     * @param value - Whether to loop.
     *
     * @returns This component, for method chaining.
     */
    setLoop(value: boolean): this {
        this._options.loop = value;
        this.setElementAttribute("loop", value ? "" : null);

        return this;
    }

    /**
     * Whether audio is muted.
     *
     * @returns The muted state.
     */
    isMuted(): boolean {
        return this._options.muted ?? false;
    }

    /**
     * Sets the muted state. Toggles the boolean `muted` attribute (initial-state
     * channel) and drives the live `muted` IDL property through the seam so a
     * change takes effect on an already-loaded element.
     *
     * @param value - Whether to mute audio.
     *
     * @returns This component, for method chaining.
     */
    setMuted(value: boolean): this {
        this._options.muted = value;
        this.setElementAttribute("muted", value ? "" : null);

        const element = this.getElement();

        if (element) {
            DOM.sink.setMuted(element, value);
        }

        return this;
    }

    /**
     * Returns the preload strategy.
     *
     * @returns The `preload` value, or `null` when unset.
     */
    getPreload(): string | null {
        return this._options.preload ?? null;
    }

    /**
     * Sets the preload strategy (writes the `preload` attribute).
     *
     * @param value - One of `"none"`, `"metadata"`, `"auto"`.
     *
     * @returns This component, for method chaining.
     */
    setPreload(value: "none" | "metadata" | "auto"): this {
        this._options.preload = value;
        this.setElementAttribute("preload", value);

        return this;
    }

    /**
     * Returns the audio volume.
     *
     * @returns The volume in `[0, 1]`.
     */
    getVolume(): number {
        return this._options.volume ?? DEFAULT_VOLUME;
    }

    /**
     * Sets the audio volume, clamped to `[0, 1]`. Drives the live `volume` IDL
     * property through the seam (there is no `volume` attribute).
     *
     * @param value - The desired volume; saturates outside `[0, 1]`.
     *
     * @returns This component, for method chaining.
     */
    setVolume(value: number): this {
        const clamped = Math.max(0, Math.min(1, value));

        this._options.volume = clamped;

        const element = this.getElement();

        if (element) {
            DOM.sink.setVolume(element, clamped);
        }

        return this;
    }

    /**
     * Returns the playback speed multiplier.
     *
     * @returns The playback rate (`1` is normal speed).
     */
    getPlaybackRate(): number {
        return this._options.playbackRate ?? DEFAULT_PLAYBACK_RATE;
    }

    /**
     * Sets the playback speed multiplier. Drives the live `playbackRate` IDL
     * property through the seam (there is no `playbackRate` attribute).
     *
     * @param value - The playback rate (`1` is normal speed).
     *
     * @returns This component, for method chaining.
     */
    setPlaybackRate(value: number): this {
        this._options.playbackRate = value;

        const element = this.getElement();

        if (element) {
            DOM.sink.setPlaybackRate(element, value);
        }

        return this;
    }

    /**
     * Seeks to a playback position. Runtime-only — the live playhead is not
     * consumer configuration, so it is not on {@link VideoOptions}.
     *
     * @param seconds - The target position in seconds.
     *
     * @returns This component, for method chaining.
     */
    setCurrentTime(seconds: number): this {
        const element = this.getElement();

        if (element) {
            DOM.sink.setCurrentTime(element, seconds);
        }

        return this;
    }

    /**
     * Starts (or resumes) playback.
     *
     * @returns This component, for method chaining.
     */
    play(): this {
        const element = this.getElement();

        if (element) {
            DOM.sink.mediaPlay(element);
        }

        return this;
    }

    /**
     * Pauses playback.
     *
     * @returns This component, for method chaining.
     */
    pause(): this {
        const element = this.getElement();

        if (element) {
            DOM.sink.mediaPause(element);
        }

        return this;
    }

    /**
     * Reads the live playback state through the DOM read seam. Before the element
     * renders, reports a paused snapshot from the cached configuration.
     *
     * @returns The current {@link MediaState}.
     */
    getMediaState(): MediaState {
        const element = this.getElement();

        if (element) {
            return DOM.source.getMediaState(element);
        }

        return {
            currentTime:  0,
            duration:     0,
            paused:       true,
            ended:        false,
            volume:       this.getVolume(),
            muted:        this.isMuted(),
            playbackRate: this.getPlaybackRate(),
        };
    }

    /**
     * Registers a listener for one of this surface's re-emitted media events.
     *
     * @param event - The media event name.
     * @param listener - The callback invoked when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: VideoMediaEvent, listener: () => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered media-event listener.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: VideoMediaEvent, listener: () => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans a media event out to its registered listeners.
     *
     * @param event - The event to emit.
     */
    protected emit(event: VideoMediaEvent): void {
        this._listeners.fire(event);
    }

    /**
     * Replays the cached media options onto the freshly created element and wires
     * the native, non-bubbling media listeners. The base class's
     * `setElementAttribute` now also caches and replays the attribute-backed
     * options (`src`, `poster`, `preload`, `autoplay`, `loop`, `muted`), making
     * that part of the replay redundant — kept anyway, see
     * {@link replayMediaOptions} for why this call still matters for `volume` /
     * `playbackRate` / live-property `muted`.
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

        this.replayMediaOptions(el);
        this.attachMediaListeners(el);

        return this;
    }

    /**
     * Detaches the native media listeners installed at render. Call before
     * discarding the surface so no stray native listener survives.
     */
    dispose(): void {
        const element = this.getElement();

        if (!element) {
            return;
        }

        for (const [type, handler] of this._mediaHandlers) {
            DOM.sink.removeListener(element, type, handler);
        }
    }

    /**
     * Builds one stable re-emit handler per media event, stored so the exact
     * reference registered at render can be removed on disposal.
     */
    private buildMediaHandlers(): void {
        for (const type of VIDEO_MEDIA_EVENTS) {
            this._mediaHandlers.set(type, () => this.emit(type));
        }
    }

    /**
     * Re-applies every cached media option onto the freshly-rendered element.
     *
     * @remarks The `setAttr` block below (`src`/`poster`/`preload`/`autoplay`/
     * `loop`/`muted`) is now redundant with the base class's
     * `setElementAttribute` cache, which `Component.init()` already replays
     * onto this same `element` parameter — kept here for parity with the rest
     * of this method rather than split out. `volume`, `playbackRate`, and
     * `muted` as a live IDL property have no reflecting attribute, so they are
     * never covered by that cache and this method remains the only place they
     * get applied to a freshly-created element. Writes go to the **passed**
     * `element`, never through the `getElement()`-based setters: during
     * `init()` the element has been created but `render()` stores it as the
     * component's element only *after* `init()` returns, so `getElement()`
     * (which resolves by document id) returns nothing yet. (The offline
     * modelled source resolves detached elements by id, which is why this was
     * invisible to the recording-sink tests and had to be caught live.)
     *
     * @param element - The rendered (still-detached) video element.
     */
    private replayMediaOptions(element: Handle): void {
        const options = this._options;
        const setAttr: Record<string, string> = {};

        if (options.src     !== undefined) setAttr.src     = options.src;
        if (options.poster  !== undefined) setAttr.poster  = options.poster;
        if (options.preload !== undefined) setAttr.preload = options.preload;
        if (options.autoplay) setAttr.autoplay = "";
        if (options.loop)     setAttr.loop     = "";
        if (options.muted)    setAttr.muted    = "";

        if (Object.keys(setAttr).length > 0) {
            DOM.sink.apply(element, { setAttr });
        }

        // Live IDL properties: volume/playbackRate have no reflecting attribute,
        // and muted must also be driven as a property to take effect immediately.
        if (options.muted        !== undefined) DOM.sink.setMuted(element, options.muted);
        if (options.volume       !== undefined) DOM.sink.setVolume(element, options.volume);
        if (options.playbackRate !== undefined) DOM.sink.setPlaybackRate(element, options.playbackRate);
    }

    /**
     * Registers each per-type native handler on the element through the DOM seam.
     *
     * @param element - The rendered video element.
     */
    private attachMediaListeners(element: Handle): void {
        for (const [type, handler] of this._mediaHandlers) {
            DOM.sink.addListener(element, type, handler);
        }
    }
}

const VideoCallable = callable(Video);
type VideoCallable = Video;
export {
    Video         as _Video,
    VideoCallable as Video
};
