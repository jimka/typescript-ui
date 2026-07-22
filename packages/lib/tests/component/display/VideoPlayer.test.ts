import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoPlayer, formatMediaTime } from '~/component/display/VideoPlayer';
import { Video } from '~/component/display/Video';
import { ProgressiveEngine } from '~/component/display/PlaybackEngine';
import type { PlaybackEngine } from '~/component/display/PlaybackEngine';
import type { MediaState } from '~/core/DOM';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

type Recorder = { writes: { op: string; args: unknown[] }[] };

/** Access to the player's private control internals for white-box assertions. */
interface Labelled { getAria(): { getLabel(): string | null } }

interface Internals {
    _controls:      { getComponents(): unknown[]; isVisible(): boolean | null; getBackgroundColor(): string | null };
    _scrubber:      { getMax(): number; getValue(): number } & Labelled;
    _timeText:      { getText(): string };
    _playBtn:       { getGlyph(): { getGlyphName(): string } | null } & Labelled;
    _muteBtn:       { getGlyph(): { getGlyphName(): string } | null } & Labelled;
    _fullscreenBtn: Labelled;
    _volume:        { getValue(): number } & Labelled;
    _scrubbing:     boolean;
    syncFromState(state: MediaState): void;
    syncFullscreen(): void;
    getPerimeterSize(): { left: number; right: number; top: number; bottom: number };
}

const internals = (player: VideoPlayer): Internals => player as unknown as Internals;

const state = (over: Partial<MediaState>): MediaState => ({
    currentTime:  0,
    duration:     0,
    paused:       true,
    ended:        false,
    volume:       1,
    muted:        false,
    playbackRate: 1,
    ...over,
});

describe('VideoPlayer construction', () => {
    it('builds the six control-bar children', () => {
        const player = new VideoPlayer();

        expect(internals(player)._controls.getComponents()).toHaveLength(6);
    });

    it('shows the control bar by default', () => {
        const player = new VideoPlayer();

        expect(player.isControlsVisible()).toBe(true);
        expect(internals(player)._controls.isVisible()).not.toBe(false);
    });

    it('hides the control bar when controls: false', () => {
        const player = new VideoPlayer({ controls: false });

        expect(player.isControlsVisible()).toBe(false);
        expect(internals(player)._controls.isVisible()).toBe(false);
    });

    it('gives the control bar an opaque themed background so it reads over the fullscreen backdrop', () => {
        const player = new VideoPlayer();

        expect(internals(player)._controls.getBackgroundColor()).toBe('var(--ts-ui-body-bg, rgb(255, 255, 255))');
    });
});

describe('VideoPlayer accessibility', () => {
    it('exposes a labelled region role on the player root', () => {
        const player = new VideoPlayer();

        expect(player.getAria().getRole()).toBe('region');
        expect(player.getAria().getLabel()).toBe('Video player');
    });

    it('gives every control an accessible label', () => {
        const i = internals(new VideoPlayer());

        expect(i._playBtn.getAria().getLabel()).toBe('Play');
        expect(i._muteBtn.getAria().getLabel()).toBe('Mute');
        expect(i._fullscreenBtn.getAria().getLabel()).toBe('Fullscreen');
        expect(i._scrubber.getAria().getLabel()).toBe('Seek');
        expect(i._volume.getAria().getLabel()).toBe('Volume');
    });
});

describe('formatMediaTime', () => {
    it.each([
        [0, '0:00'],
        [5, '0:05'],
        [65, '1:05'],
        [3661, '1:01:01'],
        [NaN, '0:00'],
        [Infinity, '0:00'],
        [-4, '0:00'],
    ])('formats %p as %p', (input, expected) => {
        expect(formatMediaTime(input)).toBe(expected);
    });
});

describe('VideoPlayer.syncFromState', () => {
    it('sets the time readout to "current / duration"', () => {
        const player = new VideoPlayer();

        player.getElement(true);
        internals(player).syncFromState(state({ currentTime: 65, duration: 3661 }));
        expect(internals(player)._timeText.getText()).toBe('1:05 / 1:01:01');
    });

    it('shows the play glyph when paused, pause glyph when playing', () => {
        const player = new VideoPlayer();

        player.getElement(true);
        internals(player).syncFromState(state({ paused: true }));
        expect(internals(player)._playBtn.getGlyph()?.getGlyphName()).toBe('play');

        internals(player).syncFromState(state({ paused: false }));
        expect(internals(player)._playBtn.getGlyph()?.getGlyphName()).toBe('pause');
    });

    it('shows the mute glyph when muted or volume is zero', () => {
        const player = new VideoPlayer();

        player.getElement(true);
        internals(player).syncFromState(state({ muted: true, volume: 1 }));
        expect(internals(player)._muteBtn.getGlyph()?.getGlyphName()).toBe('volume-mute');

        internals(player).syncFromState(state({ muted: false, volume: 0 }));
        expect(internals(player)._muteBtn.getGlyph()?.getGlyphName()).toBe('volume-mute');

        internals(player).syncFromState(state({ muted: false, volume: 0.5 }));
        expect(internals(player)._muteBtn.getGlyph()?.getGlyphName()).toBe('volume-high');
    });

    it('drives the scrubber max and value from duration and currentTime', () => {
        const player = new VideoPlayer();

        player.getElement(true);
        internals(player).syncFromState(state({ currentTime: 30, duration: 120 }));
        expect(internals(player)._scrubber.getMax()).toBe(120);
        expect(internals(player)._scrubber.getValue()).toBe(30);
    });

    it('leaves the scrubber untouched while scrubbing', () => {
        const player = new VideoPlayer();

        player.getElement(true);
        internals(player).syncFromState(state({ currentTime: 30, duration: 120 }));
        internals(player)._scrubbing = true;
        internals(player).syncFromState(state({ currentTime: 90, duration: 120 }));

        expect(internals(player)._scrubber.getValue()).toBe(30);
    });
});

describe('VideoPlayer source loading via the engine', () => {
    it('destroys then loads through the engine on setSrc', () => {
        const calls: string[] = [];
        const spy: PlaybackEngine = {
            load:    () => { calls.push('load'); },
            destroy: () => { calls.push('destroy'); },
        };
        const player = new VideoPlayer({ engine: spy });

        player.setSrc('clip.mp4');
        expect(calls).toEqual(['destroy', 'load']);
    });

    it('ProgressiveEngine.load writes the src onto the video', () => {
        const engine = new ProgressiveEngine();
        const video = new Video();

        engine.load(video, 'clip.webm');
        expect(video.getSrc()).toBe('clip.webm');
    });
});

describe('VideoPlayer option → setter routing', () => {
    it('routes every configurable field to its setter', () => {
        const player = new VideoPlayer({
            src:          'clip.mp4',
            volume:       0.25,
            muted:        true,
            playbackRate: 1.5,
            controls:     false,
        });

        expect(player.getSrc()).toBe('clip.mp4');
        expect(player.getVolume()).toBe(0.25);
        expect(player.isMuted()).toBe(true);
        expect(player.getPlaybackRate()).toBe(1.5);
        expect(player.isControlsVisible()).toBe(false);
    });
});

describe('VideoPlayer playback control routes to the video', () => {
    it('play() invokes mediaPlay through the sink', () => {
        const player = new VideoPlayer();
        const recorder = DOM.sink as unknown as Recorder;

        player.getElement(true);
        player.play();
        expect(recorder.writes.some(w => w.op === 'mediaPlay')).toBe(true);
    });

    it('pause() invokes mediaPause through the sink', () => {
        const player = new VideoPlayer();
        const recorder = DOM.sink as unknown as Recorder;

        player.getElement(true);
        player.pause();
        expect(recorder.writes.some(w => w.op === 'mediaPause')).toBe(true);
    });

    it('setCurrentTime seeks through the video', () => {
        const player = new VideoPlayer();
        const recorder = DOM.sink as unknown as Recorder;

        player.getElement(true);
        player.setCurrentTime(15);
        expect(recorder.writes.find(w => w.op === 'setCurrentTime')?.args[0]).toBe(15);
    });
});

describe('VideoPlayer fullscreen relayout', () => {
    it('reports the viewport as its inner size while fullscreen so the Border fills the screen', () => {
        const player = new VideoPlayer({ preferredSize: { width: 360, height: 240 } });

        player.getElement(true);

        const perimeter = internals(player).getPerimeterSize();
        const fullscreenInner = {
            width:  CONFIG.viewport.width  - perimeter.left - perimeter.right,
            height: CONFIG.viewport.height - perimeter.top  - perimeter.bottom,
        };

        // Entering fullscreen: the modelled sink records the element as the
        // fullscreen element. getInnerSize must then report the viewport so the
        // Border stretches the video to fill it — the bug was that the children
        // stayed at the in-page inner size, leaving the video in a corner.
        player.enterFullscreen();
        internals(player).syncFullscreen();

        expect(player.isFullscreen()).toBe(true);
        expect(player.getInnerSize()).toEqual(fullscreenInner);

        // Exiting stops forcing the viewport size.
        player.exitFullscreen();
        internals(player).syncFullscreen();

        expect(player.isFullscreen()).toBe(false);
        expect(player.getInnerSize()).not.toEqual(fullscreenInner);
    });
});

describe('VideoPlayer dispose', () => {
    it('runs the registered _video child\'s destructor() exactly once', () => {
        const player = new VideoPlayer();

        // `_video` is a registered child (added via `addComponent`), so its
        // teardown is reached through the base class's recursive
        // `destructor()` call — a redundant explicit call in
        // `VideoPlayer.destructor()` would run it twice. Regression for
        // that double-teardown class, matching Chart.test.ts's
        // `_legend.destructor` spy.
        const videoDestructor = vi.spyOn(
            (player as unknown as { _video: { destructor(): void } })._video as unknown as { destructor(): void },
            'destructor'
        );

        player.getElement(true);
        player.dispose();

        expect(videoDestructor).toHaveBeenCalledTimes(1);
    });
});
