// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, MediaState } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import type { Size } from "~/primitive/Size.js";
import { Border } from "~/layout/Border.js";
import { HBox } from "~/layout/HBox.js";
import { Placement } from "~/primitive/Placement.js";
import { Button } from "~/component/button/Button.js";
import { Slider } from "~/component/input/Slider.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Video } from "~/component/display/Video.js";
import { ProgressiveEngine } from "~/component/display/PlaybackEngine.js";
import type { PlaybackEngine } from "~/component/display/PlaybackEngine.js";
import { play } from "~/glyphs/solid/play.js";
import { pause } from "~/glyphs/solid/pause.js";
import { volume_high } from "~/glyphs/solid/volume_high.js";
import { volume_mute } from "~/glyphs/solid/volume_mute.js";
import { expand } from "~/glyphs/solid/expand.js";
import { compress } from "~/glyphs/solid/compress.js";

Glyph.register(play, pause, volume_high, volume_mute, expand, compress);

// Square side of each glyph-only control button, matching PaginationBar's 28px
// navigation buttons so the control bar reads as one row of same-sized controls.
const CONTROL_BUTTON_SIZE = 28;

// Fixed width of the volume slider. Narrower than the default 200px Slider so it
// stays a compact secondary control beside the flexible seek scrubber.
const VOLUME_SLIDER_WIDTH = 80;

// Height the time readout centres within, matching the control-button row height
// so its baseline lines up with the buttons.
const CONTROL_ROW_HEIGHT = 28;

// Volume-slider granularity — 20 steps across [0, 1] is fine enough for smooth
// adjustment without sub-percent jitter.
const VOLUME_STEP = 0.05;

// Gap between control-bar children, matching PaginationBar's inter-button spacing.
const CONTROL_SPACING = 6;

/**
 * Formats a media time in seconds as `h:mm:ss` (when at least an hour) or `m:ss`.
 * A non-finite or negative input (no metadata yet, a live stream) renders as
 * `"0:00"`. Pure and module-level so it is trivially unit-testable.
 *
 * @param seconds - The time in seconds.
 * @returns The formatted `m:ss` / `h:mm:ss` string.
 *
 * @category Components
 */
export function formatMediaTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "0:00";
    }

    const total   = Math.floor(seconds);
    const secs     = total % 60;
    const mins     = Math.floor(total / 60) % 60;
    const hours    = Math.floor(total / 3600);
    const secsText = String(secs).padStart(2, "0");

    if (hours >= 1) {
        const minsText = String(mins).padStart(2, "0");

        return `${hours}:${minsText}:${secsText}`;
    }

    return `${mins}:${secsText}`;
}

/**
 * The custom events {@link VideoPlayer} emits — the player-level lifecycle
 * subset of the underlying {@link Video}'s media events.
 *
 * @category Components
 */
export type VideoPlayerEvent = "play" | "pause" | "ended";

/**
 * Construction-time options for {@link VideoPlayer}.
 *
 * @category Components
 */
export interface VideoPlayerOptions extends ComponentOptions {
    src?:          string;
    poster?:       string;
    autoplay?:     boolean;
    loop?:         boolean;
    muted?:        boolean;
    /** Audio volume, clamped to `[0, 1]`. */
    volume?:       number;
    playbackRate?: number;
    /** Show the custom control bar. Default `true`. */
    controls?:     boolean;
    /** Media-loading strategy. Defaults to a {@link ProgressiveEngine}. */
    engine?:       PlaybackEngine;
    /**
     * Construction-time listener bag — the declarative form of `on()`.
     */
    listeners?: {
        play?:  () => void;
        pause?: () => void;
        ended?: () => void;
    };
}

/**
 * A video player: a native `<video>` surface ({@link Video}) framed by a control
 * bar built entirely from this library's own components — play / pause, a seek
 * scrubber, a current-time / duration readout, volume, mute, and fullscreen. The
 * native browser `controls` chrome is not used.
 *
 * @remarks
 * The player is a [`Border`](/api/layout/classes/Border) layout with the video
 * in the centre region and the control bar docked south. All coordination — the
 * play-state machine, the scrubber⇄currentTime sync (guarded against a feedback
 * loop), volume / mute sync, fullscreen state, and media-loading engine
 * dispatch — lives here; the control bar itself is a composed `HBox` of existing
 * primitives. Source loading routes through a pluggable {@link PlaybackEngine}
 * (progressive download by default) so an adaptive-streaming engine can be
 * attached without rewriting the component.
 *
 * @example
 * ```typescript
 * import { VideoPlayer } from '@jimka/typescript-ui/component/display';
 *
 * const player = new VideoPlayer({ src: '/media/clip.mp4', poster: '/media/poster.png' });
 * player.on('ended', () => console.log('done'));
 * ```
 *
 * @category Components
 */
class VideoPlayer extends Component<VideoPlayerOptions> {

    private _video:         Video;
    private _controls!:      Component;
    private _playBtn!:       Button;
    private _scrubber!:      Slider;
    private _timeText!:      Text;
    private _muteBtn!:       Button;
    private _volume!:        Slider;
    private _fullscreenBtn!: Button;

    /** Media-loading strategy; progressive download unless overridden. */
    private _engine: PlaybackEngine = new ProgressiveEngine();

    /** Whether the video is currently playing (driven by media events). */
    private _playing: boolean = false;

    /** Whether the player is currently fullscreen. */
    private _fullscreen: boolean = false;

    /**
     * Guards the scrubber⇄timeupdate feedback loop: while the user drags the
     * scrubber, incoming `timeupdate` syncs must not overwrite the thumb.
     */
    private _scrubbing: boolean = false;

    /**
     * Guards against a programmatic `setValue` on a slider re-entering its own
     * `action` / `change` handler — every {@link Slider.setValue} fires those
     * events, so a `syncFromState` write would otherwise loop back as a seek.
     */
    private _syncing: boolean = false;

    /** Custom-event fan-out for the player's `play` / `pause` / `ended` events. */
    private _listeners: ListenerBag<VideoPlayerEvent> = this.registerListenerBag(new ListenerBag<VideoPlayerEvent>());

    private readonly _onPlayButton:       () => void       = () => this.togglePlay();
    private readonly _onMuteButton:       () => void       = () => this.setMuted(!this.isMuted());
    private readonly _onFullscreenButton: () => void       = () => this.toggleFullscreen();
    private readonly _onScrub:            () => void        = () => this.beginScrub();
    private readonly _onVolumeChange:     (v: number) => void = (v) => this.onVolumeSlider(v);

    private readonly _onVideoPlay:       () => void = () => this.onVideoPlay();
    private readonly _onVideoPause:      () => void = () => this.onVideoPause();
    private readonly _onVideoEnded:      () => void = () => this.onVideoEnded();
    private readonly _onVideoTimeUpdate: () => void = () => this.onVideoTimeUpdate();
    private readonly _onVideoSync:       () => void = () => this.syncFromVideo();
    private readonly _onFullscreenChange: () => void = () => this.syncFullscreen();

    /**
     * Constructs a video player.
     *
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: VideoPlayerOptions, subclassDefaults?: Partial<VideoPlayerOptions>) {
        // Child components are built first; options are applied via applyOptions
        // at the constructor tail, after the control children exist. The
        // `local/forward-super-options` rule only flags a bare, zero-argument
        // `super()`, so passing `subclassDefaults` through (with `options`
        // still deliberately not forwarded) needs no disable comment.
        super(undefined, subclassDefaults);

        this.setLayoutManager(new Border());
        this.getAria().setRole("region");
        this.getAria().setLabel("Video player");

        this._video = new Video();

        this.buildControlBar();
        this.wireControlListeners();
        this.wireVideoListeners();

        this.addComponent(this._video, { placement: Placement.CENTER });
        this.addComponent(this._controls, { placement: Placement.SOUTH });

        this.syncFromState(this._video.getMediaState());

        if (options) {
            this.applyOptions(options);
        }

        this.applyListeners(options?.listeners);
    }

    /**
     * Applies a {@link VideoPlayerOptions} bag after inherited Component fields
     * cascade. Dispatched from the constructor tail (not the `super()` cascade),
     * so the control children the setters touch already exist. The engine is set
     * before `src` so a supplied engine handles the initial load.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: VideoPlayerOptions): this {
        super.applyOptions(options);

        // Configure the video directly rather than through the UI-syncing public
        // setters: a control-bar slider write fires a DOM event that requires a
        // rendered element, so the control bar is instead synced from the video
        // at render time (see init). Construction stays JS-only.
        if (options.engine       !== undefined) this._engine = options.engine;
        if (options.src          !== undefined) this.setSrc(options.src);
        if (options.poster       !== undefined) this._video.setPoster(options.poster);
        if (options.autoplay     !== undefined) this._video.setAutoplay(options.autoplay);
        if (options.loop         !== undefined) this._video.setLoop(options.loop);
        if (options.muted        !== undefined) this._video.setMuted(options.muted);
        if (options.volume       !== undefined) this._video.setVolume(options.volume);
        if (options.playbackRate !== undefined) this._video.setPlaybackRate(options.playbackRate);
        if (options.controls     !== undefined) this.setControlsVisible(options.controls);

        return this;
    }

    /**
     * Returns the current media source URL.
     *
     * @returns The `src`, or `null` when unset.
     */
    getSrc(): string | null {
        return this._video.getSrc();
    }

    /**
     * Sets the media source, routing the load through the playback engine: the
     * previous engine session is destroyed, then the new source is loaded.
     *
     * @param src - The media source URL.
     *
     * @returns This component, for method chaining.
     */
    setSrc(src: string): this {
        this._engine.destroy();
        this._engine.load(this._video, src);

        return this;
    }

    /**
     * Returns the audio volume.
     *
     * @returns The volume in `[0, 1]`.
     */
    getVolume(): number {
        return this._video.getVolume();
    }

    /**
     * Sets the audio volume (clamped to `[0, 1]` by the video surface) and
     * refreshes the control bar.
     *
     * @param value - The desired volume.
     *
     * @returns This component, for method chaining.
     */
    setVolume(value: number): this {
        this._video.setVolume(value);
        this.syncFromVideo();

        return this;
    }

    /**
     * Whether audio is muted.
     *
     * @returns The muted state.
     */
    isMuted(): boolean {
        return this._video.isMuted();
    }

    /**
     * Sets the muted state and refreshes the control bar.
     *
     * @param value - Whether to mute audio.
     *
     * @returns This component, for method chaining.
     */
    setMuted(value: boolean): this {
        this._video.setMuted(value);
        this.syncFromVideo();

        return this;
    }

    /**
     * Returns the playback speed multiplier.
     *
     * @returns The playback rate (`1` is normal speed).
     */
    getPlaybackRate(): number {
        return this._video.getPlaybackRate();
    }

    /**
     * Sets the playback speed multiplier.
     *
     * @param value - The playback rate (`1` is normal speed).
     *
     * @returns This component, for method chaining.
     */
    setPlaybackRate(value: number): this {
        this._video.setPlaybackRate(value);

        return this;
    }

    /**
     * Seeks to a playback position.
     *
     * @param seconds - The target position in seconds.
     *
     * @returns This component, for method chaining.
     */
    setCurrentTime(seconds: number): this {
        this._video.setCurrentTime(seconds);

        return this;
    }

    /**
     * Reads the live playback position.
     *
     * @returns The current time in seconds.
     */
    getCurrentTime(): number {
        return this._video.getMediaState().currentTime;
    }

    /**
     * Reads the live media duration.
     *
     * @returns The duration in seconds (`NaN` before metadata loads).
     */
    getDuration(): number {
        return this._video.getMediaState().duration;
    }

    /**
     * Whether the video is currently playing.
     *
     * @returns `true` while playing.
     */
    isPlaying(): boolean {
        return this._playing;
    }

    /**
     * Starts (or resumes) playback.
     *
     * @returns This component, for method chaining.
     */
    play(): this {
        this._video.play();

        return this;
    }

    /**
     * Pauses playback.
     *
     * @returns This component, for method chaining.
     */
    pause(): this {
        this._video.pause();

        return this;
    }

    /**
     * Toggles between play and pause.
     *
     * @returns This component, for method chaining.
     */
    togglePlay(): this {
        return this._playing ? this.pause() : this.play();
    }

    /**
     * Whether the custom control bar is visible.
     *
     * @returns `true` when the control bar shows.
     */
    isControlsVisible(): boolean {
        return this._options.controls ?? true;
    }

    /**
     * Shows or hides the custom control bar.
     *
     * @param value - Whether the control bar is visible.
     *
     * @returns This component, for method chaining.
     */
    setControlsVisible(value: boolean): this {
        this._options.controls = value;
        this._controls.setVisible(value);

        return this;
    }

    /**
     * Whether the player is currently fullscreen.
     *
     * @returns `true` while fullscreen.
     */
    isFullscreen(): boolean {
        return this._fullscreen;
    }

    /**
     * Requests fullscreen for the player. Must be called from a user gesture
     * (e.g. the fullscreen button's action); a programmatic call is rejected by
     * the browser.
     *
     * @returns This component, for method chaining.
     */
    enterFullscreen(): this {
        const element = this.getElement();

        if (element) {
            DOM.sink.requestFullscreen(element);
        }

        return this;
    }

    /**
     * Exits fullscreen.
     *
     * @returns This component, for method chaining.
     */
    exitFullscreen(): this {
        DOM.sink.exitFullscreen();

        return this;
    }

    /**
     * Toggles fullscreen.
     *
     * @returns This component, for method chaining.
     */
    toggleFullscreen(): this {
        return this._fullscreen ? this.exitFullscreen() : this.enterFullscreen();
    }

    /**
     * Registers a listener for one of the player's lifecycle events.
     *
     * @param event - The event name.
     * @param listener - The callback invoked when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: VideoPlayerEvent, listener: () => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered lifecycle listener.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: VideoPlayerEvent, listener: () => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans a lifecycle event out to its registered listeners.
     *
     * @param event - The event to emit.
     */
    protected emit(event: VideoPlayerEvent): void {
        this._listeners.fire(event);
    }

    /**
     * Wires the `fullscreenchange` listener on the root element (it bubbles to
     * `document`, unlike the non-bubbling media events) so external Esc-key or
     * browser-driven fullscreen exits keep the player's state in sync.
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

        DOM.sink.addListener(el, "fullscreenchange", this._onFullscreenChange);

        // The video and its control sliders are now rendered, so populating the
        // control bar from the configured media state can safely fire the sliders'
        // value-change events (which a pre-render write cannot).
        this.syncFromVideo();

        return this;
    }

    /**
     * Detaches the native + video listeners installed by this player, then
     * defers to the base class for the rest of teardown. Call before
     * discarding it so no stray native listener survives.
     */
    protected destructor(): void {
        // `_video` is registered via `addComponent`, so `super.destructor()`'s
        // child recursion below already disposes it — an explicit call here
        // would run `Video.destructor()` a second time.
        const element = this.getElement();

        if (element) {
            DOM.sink.removeListener(element, "fullscreenchange", this._onFullscreenChange);
        }

        super.destructor();
    }

    /**
     * Maps a {@link MediaState} snapshot onto the control-bar controls: the
     * scrubber range + position (skipped while the user is scrubbing), the time
     * readout, the play / mute glyphs, and the volume slider. Pure with respect
     * to media state — every media-event handler and the unit tests call it.
     *
     * @param state - The media-state snapshot to reflect.
     */
    private syncFromState(state: MediaState): void {
        this._syncing = true;

        try {
            if (!this._scrubbing) {
                this._scrubber.setMax(state.duration || 0);
                this._scrubber.setValue(state.currentTime);
            }

            this._timeText.setText(`${formatMediaTime(state.currentTime)} / ${formatMediaTime(state.duration)}`);
            this._playBtn.setGlyph(state.paused ? "play" : "pause");
            this._muteBtn.setGlyph(state.muted || state.volume === 0 ? "volume-mute" : "volume-high");
            this._volume.setValue(state.muted ? 0 : state.volume);
        } finally {
            this._syncing = false;
        }
    }

    /** Reads the video's live state and reflects it onto the control bar. */
    private syncFromVideo(): void {
        this.syncFromState(this._video.getMediaState());
    }

    /** Builds the south-docked control bar as an `HBox` of existing primitives. */
    private buildControlBar(): void {
        this._playBtn       = this.makeControlButton("play", "Play");
        this._muteBtn       = this.makeControlButton("volume-high", "Mute");
        this._fullscreenBtn = this.makeControlButton("expand", "Fullscreen");

        this._scrubber = new Slider({ min: 0, max: 0, value: 0 });
        this._scrubber.getAria().setLabel("Seek");

        this._volume = new Slider({ min: 0, max: 1, step: VOLUME_STEP, value: 1 });
        this._volume.getAria().setLabel("Volume");
        this._volume.setPreferredSize({ width: VOLUME_SLIDER_WIDTH, height: this._volume.getPreferredSize()!.height });
        this._volume.setMaxSize({ width: VOLUME_SLIDER_WIDTH, height: this._volume.getPreferredSize()!.height });

        this._timeText = new Text("0:00 / 0:00");
        this._timeText.centerInHeight(CONTROL_ROW_HEIGHT);

        const bar = new HBox();

        bar.setComponentSpacing(CONTROL_SPACING);

        this._controls = new Component();
        this._controls.setLayoutManager(bar);
        // Give the control bar an opaque, theme-tracking surface. Transparent, it
        // borrowed the page background in-page (readable) but showed the black
        // :fullscreen backdrop in fullscreen, hiding the dark time text and glyphs.
        // The body background is what already showed through in-page, so this is
        // invisible there yet keeps the controls readable over the fullscreen video.
        this._controls.setBackgroundColor("var(--ts-ui-body-bg, rgb(255, 255, 255))");
        this._controls.addComponent(this._playBtn);
        this._controls.addComponent(this._scrubber, { weight: 1 });
        this._controls.addComponent(this._timeText);
        this._controls.addComponent(this._muteBtn);
        this._controls.addComponent(this._volume);
        this._controls.addComponent(this._fullscreenBtn);
    }

    /**
     * Builds a fixed-size glyph-only control button with an accessible label.
     *
     * @param glyph - The glyph name to show.
     * @param label - The accessible name (drives `aria-label` and the tooltip).
     * @returns The configured button.
     */
    private makeControlButton(glyph: string, label: string): Button {
        const button = new Button({ glyph, text: label, showText: false });

        button.setPreferredSize({ width: CONTROL_BUTTON_SIZE, height: CONTROL_BUTTON_SIZE });

        return button;
    }

    /** Wires the control-bar children's interaction events to the player. */
    private wireControlListeners(): void {
        this._playBtn.on("action", this._onPlayButton);
        this._muteBtn.on("action", this._onMuteButton);
        this._fullscreenBtn.on("action", this._onFullscreenButton);
        this._scrubber.on("action", this._onScrub);
        this._volume.on("change", this._onVolumeChange);
    }

    /** Subscribes to the video surface's re-emitted media events. */
    private wireVideoListeners(): void {
        this._video.on("play", this._onVideoPlay);
        this._video.on("pause", this._onVideoPause);
        this._video.on("ended", this._onVideoEnded);
        this._video.on("timeupdate", this._onVideoTimeUpdate);
        this._video.on("durationchange", this._onVideoSync);
        this._video.on("loadedmetadata", this._onVideoSync);
        this._video.on("volumechange", this._onVideoSync);
        this._video.on("ratechange", this._onVideoSync);
    }

    /** Marks the scrubber as being dragged and seeks the video to its value. */
    private beginScrub(): void {
        if (this._syncing) {
            return;
        }

        this._scrubbing = true;
        this._video.setCurrentTime(this._scrubber.getValue());
    }

    /**
     * Handles a volume-slider change: applies the volume to the video (ignoring
     * the programmatic echo from a sync write).
     *
     * @param value - The new slider value in `[0, 1]`.
     */
    private onVolumeSlider(value: number): void {
        if (this._syncing) {
            return;
        }

        this._video.setVolume(value);
        this.syncFromVideo();
    }

    /** Media `play`: records the play state, refreshes, and re-emits. */
    private onVideoPlay(): void {
        this._playing = true;
        this.syncFromVideo();
        this.emit("play");
    }

    /** Media `pause`: records the pause state, refreshes, and re-emits. */
    private onVideoPause(): void {
        this._playing = false;
        this.syncFromVideo();
        this.emit("pause");
    }

    /** Media `ended`: records the stopped state, refreshes, and re-emits. */
    private onVideoEnded(): void {
        this._playing = false;
        this.syncFromVideo();
        this.emit("ended");
    }

    /** Media `timeupdate`: refreshes, then releases the scrubbing guard. */
    private onVideoTimeUpdate(): void {
        this.syncFromVideo();
        this._scrubbing = false;
    }

    /**
     * Reconciles the player with the document's fullscreen state: relayouts to
     * fill (or shrink back from) the fullscreen viewport and swaps the fullscreen
     * glyph. Driven by the `fullscreenchange` listener, so a browser-initiated
     * exit (Esc) is handled the same as the button.
     *
     * The browser's `:fullscreen` UA rules blow the root element up to fill the
     * screen, but the absolute layout keeps sizing the children for the
     * pre-fullscreen bounds — leaving the video in the corner over a black
     * backdrop. Resizing the player to the viewport re-runs the `Border` layout
     * so the video stretches to fill and the controls stay docked at the bottom;
     * the saved in-page bounds are restored on exit.
     */
    private syncFullscreen(): void {
        const fullscreen = DOM.source.getFullscreenElement();
        const element    = this.getElement();

        this._fullscreen = element != null && fullscreen === element;
        this._fullscreenBtn.setGlyph(this._fullscreen ? "compress" : "expand");

        // Re-lay the children against the now fullscreen-aware inner size (see
        // getInnerSize): entering stretches the video to fill the viewport,
        // exiting reverts it to the in-page size.
        this.doLayout();
    }

    /**
     * Reports the content area a layout manager fills. While fullscreen the
     * browser's `:fullscreen` UA rules blow the root element up to the viewport,
     * but its parent-committed box stays at the in-page size — so the `Border`
     * layout would keep positioning the video and controls for the small box,
     * leaving the video in a corner over a black backdrop. Returning the viewport
     * extent here makes every layout pass (including parent-driven relayouts that
     * re-commit the in-page box) stretch the children to fill the screen; exiting
     * fullscreen falls back to the inherited inner size.
     *
     * @returns The inner content size, or `null` before the element renders.
     */
    getInnerSize(): Size | null {
        if (this._fullscreen && this.getElement()) {
            const viewport  = DOM.source.getViewportSize();
            const perimeter = this.getPerimeterSize();

            return {
                width:  viewport.width  - perimeter.left - perimeter.right,
                height: viewport.height - perimeter.top  - perimeter.bottom,
            };
        }

        return super.getInnerSize();
    }
}

const VideoPlayerCallable = callable(VideoPlayer);
type VideoPlayerCallable = VideoPlayer;
export {
    VideoPlayer         as _VideoPlayer,
    VideoPlayerCallable as VideoPlayer
};
