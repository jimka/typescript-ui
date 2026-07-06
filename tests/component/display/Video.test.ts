import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Video } from '~/component/display/Video';
import type { VideoMediaEvent } from '~/component/display/Video';
import { DOM } from '~/core/DOM';
import { installTestDOM, setMediaState } from '../../dom/TestDOM';
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

/** Reads back the last `setAttr` patch value written for `key` on any element. */
const lastAttr = (recorder: Recorder, key: string): string | undefined => {
    let value: string | undefined;

    for (const w of recorder.writes) {
        if (w.op === 'apply') {
            const patch = w.args[1] as { setAttr?: Record<string, string> };

            if (patch.setAttr && key in patch.setAttr) {
                value = patch.setAttr[key];
            }
        }
    }

    return value;
};

const hasOp = (recorder: Recorder, op: string): boolean =>
    recorder.writes.some(w => w.op === op);

describe('Video construction & tag', () => {
    it('builds a <video>-tagged element', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);

        expect(video.getTag()).toBe('video');
        expect(recorder.writes.some(w => w.op === 'createElement' && w.args[0] === 'video')).toBe(true);
    });

    it('supports options-bag construction', () => {
        const video = Video({});

        expect(video.getTag()).toBe('video');
    });

    it('clears its insets', () => {
        const insets = new Video().getInsets();

        expect([insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft()]).toEqual([0, 0, 0, 0]);
    });
});

describe('Video accessibility', () => {
    it('gives the video surface an accessible label, written to the element on render', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        expect(video.getAria().getLabel()).toBe('Video');

        video.getElement(true);

        expect(lastAttr(recorder, 'aria-label')).toBe('Video');
    });
});

describe('Video attribute writes on render', () => {
    it('records src / poster / autoplay / loop / muted / preload attribute writes', () => {
        const video = new Video({
            src:      'clip.mp4',
            poster:   'poster.png',
            autoplay: true,
            loop:     true,
            muted:    true,
            preload:  'metadata',
        });
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);

        expect(lastAttr(recorder, 'src')).toBe('clip.mp4');
        expect(lastAttr(recorder, 'poster')).toBe('poster.png');
        expect(lastAttr(recorder, 'autoplay')).toBe('');
        expect(lastAttr(recorder, 'loop')).toBe('');
        expect(lastAttr(recorder, 'muted')).toBe('');
        expect(lastAttr(recorder, 'preload')).toBe('metadata');
    });
});

describe('Video.setSrc round-trip', () => {
    it('round-trips through getSrc and writes the src attribute', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);
        video.setSrc('other.webm');

        expect(video.getSrc()).toBe('other.webm');
        expect(lastAttr(recorder, 'src')).toBe('other.webm');
    });
});

describe('Video.setVolume clamps to [0, 1]', () => {
    it('saturates a value below 0', () => {
        const video = new Video();

        video.setVolume(-1);
        expect(video.getVolume()).toBe(0);
    });

    it('saturates a value above 1', () => {
        const video = new Video();

        video.setVolume(2);
        expect(video.getVolume()).toBe(1);
    });

    it('keeps an in-range value', () => {
        const video = new Video();

        video.setVolume(0.4);
        expect(video.getVolume()).toBe(0.4);
    });

    it('clamps a constructor-supplied volume', () => {
        expect(new Video({ volume: 5 }).getVolume()).toBe(1);
    });
});

describe('Video playback control routes through the sink', () => {
    it('play() invokes mediaPlay', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);
        video.play();
        expect(hasOp(recorder, 'mediaPlay')).toBe(true);
    });

    it('pause() invokes mediaPause', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);
        video.pause();
        expect(hasOp(recorder, 'mediaPause')).toBe(true);
    });

    it('setCurrentTime(n) invokes setCurrentTime', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);
        video.setCurrentTime(42);

        const seek = recorder.writes.find(w => w.op === 'setCurrentTime');

        expect(seek?.args[0]).toBe(42);
    });

    it('setPlaybackRate(n) invokes setPlaybackRate', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);
        video.setPlaybackRate(1.5);

        const rate = recorder.writes.find(w => w.op === 'setPlaybackRate');

        expect(rate?.args[0]).toBe(1.5);
    });

    it('setMuted(true) invokes setMuted on the live element', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);
        video.setMuted(true);
        expect(hasOp(recorder, 'setMuted')).toBe(true);
    });
});

describe('Video.getMediaState reads through the source', () => {
    it('reflects the modelled media state', () => {
        const video = new Video();

        video.getElement(true);
        setMediaState(video.getElement()!, { currentTime: 12, duration: 60, paused: false });

        const state = video.getMediaState();

        expect(state.currentTime).toBe(12);
        expect(state.duration).toBe(60);
        expect(state.paused).toBe(false);
    });

    it('reports a paused snapshot before the element renders', () => {
        const state = new Video({ volume: 0.3 }).getMediaState();

        expect(state.paused).toBe(true);
        expect(state.volume).toBe(0.3);
    });
});

// The native media-event → custom `emit` bridge. The offline harness cannot
// dispatch a non-bubbling event at a non-window element, so instead of a real
// media event these tests invoke the stored native handler directly and assert
// it re-emits through the custom `on` surface — the same code path a real
// `timeupdate` would drive. End-to-end playback remains a manual-verify step.
describe('Video re-emits native media events as custom events', () => {
    type Bridged = { _mediaHandlers: Map<VideoMediaEvent, () => void> };

    it('registers native listeners for every media event at render', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);

        const addedTypes = recorder.writes
            .filter(w => w.op === 'addListener')
            .map(w => w.args[0]);

        for (const type of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'volumechange', 'ratechange']) {
            expect(addedTypes).toContain(type);
        }
    });

    it('re-emits a media event to an `on` listener', () => {
        const video = new Video();

        video.getElement(true);

        let fired = 0;

        video.on('timeupdate', () => { fired += 1; });
        (video as unknown as Bridged)._mediaHandlers.get('timeupdate')!();

        expect(fired).toBe(1);
    });

    it('wires a constructor listeners bag', () => {
        let fired = 0;
        const video = new Video({ listeners: { play: () => { fired += 1; } } });

        video.getElement(true);
        (video as unknown as Bridged)._mediaHandlers.get('play')!();

        expect(fired).toBe(1);
    });

    it('stops re-emitting after off()', () => {
        const video = new Video();

        video.getElement(true);

        let fired = 0;
        const listener = (): void => { fired += 1; };

        video.on('timeupdate', listener);
        video.off('timeupdate', listener);
        (video as unknown as Bridged)._mediaHandlers.get('timeupdate')!();

        expect(fired).toBe(0);
    });

    it('detaches native listeners on dispose', () => {
        const video = new Video();
        const recorder = DOM.sink as unknown as Recorder;

        video.getElement(true);
        video.dispose();

        expect(hasOp(recorder, 'removeListener')).toBe(true);
    });
});
