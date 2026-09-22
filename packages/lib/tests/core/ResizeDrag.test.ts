// Offline coverage for plans/in-progress/drag-resize-outline-mode.md's
// `## Expected Behaviour` cases R1-R14 and B1: the shared per-frame drag
// session every resize drag runs through, and the app-wide `resizeMode`
// default `Body` sets.
//
// Frame-capture harness copied from
// AbstractWindow.resizeFpsCoalescing.test.ts (lines 49-93): the offline sink
// discards a real requestAnimationFrame callback, so it is spied and drained
// by hand via flushFrame(), with a matching cancelAnimationFrame spy so a
// cancelled frame really never runs. flushFrame() takes an explicit timestamp
// because R10 lands drains at exact millisecond offsets on either side of the
// fps-cap boundary.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Body } from '~/core/Body';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { Favicon } from '~/core/Favicon';
import { ResizeDrag, gutterOutline, getAppResizeMode, setAppResizeMode, IN_PAGE_OUTLINE_Z_INDEX } from '~/core/ResizeDrag';
import type { OutlineRect, ResizeDragHooks } from '~/core/ResizeDrag';
import { styleRuleEntries } from '~/core/StyleTarget';
import { Split } from '~/layout/Split';
import { installTestDOM, makeEvent, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The outline's box when a drag starts, in the host's coordinate space. */
const START: OutlineRect = { x: 10, y: 0, width: 4, height: 100 };

/** Spied hooks: `preview` maps the scheduled number onto the outline's x. */
interface SpiedHooks extends ResizeDragHooks<number> {
    apply:   ResizeDragHooks<number>['apply'] & { mock: unknown };
    preview: ResizeDragHooks<number>['preview'] & { mock: unknown };
    commit:  ResizeDragHooks<number>['commit'] & { mock: unknown };
}

/**
 * Hooks whose three members are spies, so a case can count the frames each
 * mode ran. `preview` reports the scheduled value as the outline's own x.
 *
 * @returns The spied hooks.
 */
function spiedHooks(): SpiedHooks {
    return {
        apply:   vi.fn((_value: number): void => {}),
        preview: vi.fn((value: number): OutlineRect => ({ x: value, y: 0, width: 4, height: 100 })),
        commit:  vi.fn((_value: number): void => {}),
    } as unknown as SpiedHooks;
}

/** White-box access to the session's outline component. */
function outlineOf(drag: ResizeDrag<number>): Component | null {
    return (drag as unknown as { _outline: Component | null })._outline;
}

describe('ResizeDrag', () => {
    let frames:      Map<number, FrameRequestCallback>;
    let nextFrameId: number;
    let sessions:    ResizeDrag<number>[];

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames      = new Map();
        nextFrameId = 1;
        sessions    = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            const id = nextFrameId++;

            frames.set(id, cb);

            return id;
        });
        // A real cancelAnimationFrame drops a callback before it ever fires;
        // mirroring that here is what lets a cancellation case tell a real
        // cancel from a no-op one.
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((id: number) => {
            frames.delete(id);
        });
    });

    afterEach(() => {
        // An outline left on screen keeps its two viewport listeners, and
        // `Event`'s own registration maps are module state DOM.reset() does not
        // clear: a type map that survives with entries in it stops the next
        // `addViewportListener` re-registering the base listener against the
        // fresh sink, and the case after this one would hear no keydown at all.
        for (const session of sessions) {
            session.cancel();
        }

        vi.restoreAllMocks();
        // Module state in core/ResizeDrag.ts, which DOM.reset() does not
        // touch: left at "outline", every later file's drags would run in
        // outline mode.
        setAppResizeMode('live');
        // Body is a page-level singleton whose own module state outlives
        // DOM.reset() too; B1 configures both of these, as
        // BodyContextMenu.test.ts's afterEach does.
        Favicon._reset();
        Body.getInstance().setNativeContextMenu(true);
        DOM.reset();
    });

    /**
     * Runs every frame callback still pending (i.e. not cancelled) since the
     * last drain, at the given timestamp.
     *
     * @param timestamp - The rAF timestamp handed to each drained callback.
     */
    function flushFrame(timestamp: number = performance.now()): void {
        const pending = [...frames.values()];

        frames.clear();

        for (const cb of pending) {
            cb(timestamp);
        }
    }

    /**
     * A session registered for the `afterEach` cleanup above.
     *
     * @param hooks - The owner's three per-frame hooks.
     * @param fps - Optional frames-per-second cap.
     * @returns The session.
     */
    function newDrag(hooks: SpiedHooks, fps?: () => number): ResizeDrag<number> {
        const drag = new ResizeDrag<number>(hooks, fps);

        sessions.push(drag);

        return drag;
    }

    /**
     * A rendered host the outline mounts into.
     *
     * @returns The host container.
     */
    function renderedHost(): Container {
        const host = new Container();

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);

        return host;
    }

    /**
     * Starts an outline drag inside `host` at {@link START}.
     *
     * @param drag - The session to start.
     * @param host - The host whose element the outline is appended to.
     */
    function beginOutlineIn(drag: ResizeDrag<number>, host: Container): void {
        drag.beginOutline({ parent: host.getElement(true)!, start: START, zIndex: IN_PAGE_OUTLINE_Z_INDEX });
    }

    it('R1. buffers live moves and applies only the freshest, once per frame', () => {
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);

        drag.beginLive();
        drag.schedule(1);
        drag.schedule(2);
        drag.schedule(3);

        expect(hooks.apply).not.toHaveBeenCalled();

        flushFrame(1000);

        expect(hooks.apply).toHaveBeenCalledTimes(1);
        expect(hooks.apply).toHaveBeenCalledWith(3);
        expect(hooks.preview).not.toHaveBeenCalled();
        expect(hooks.commit).not.toHaveBeenCalled();
    });

    it('R2. a live release applies the buffered move synchronously', () => {
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);

        drag.beginLive();
        drag.schedule(5);

        expect(drag.end()).toBe(true);
        expect(hooks.apply).toHaveBeenCalledTimes(1);
        expect(hooks.apply).toHaveBeenCalledWith(5);

        flushFrame(1000);

        expect(hooks.apply).toHaveBeenCalledTimes(1);
    });

    it('R3. an outline drag mounts an outline and moves it instead of applying', () => {
        const host  = renderedHost();
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);

        beginOutlineIn(drag, host);

        const outline = outlineOf(drag)!;

        expect(DOM.source.getParentElement(outline.getElement()!)).toBe(host.getElement());
        expect(outline.getX()).toBe(START.x);
        expect(outline.getY()).toBe(START.y);
        expect(outline.getWidth()).toBe(START.width);
        expect(outline.getHeight()).toBe(START.height);
        expect(outline.getZIndex()).toBe(IN_PAGE_OUTLINE_Z_INDEX);
        expect(outline.getPointerEvents()).toBe('none');
        expect(outline.getWillChange()).toBe('transform');

        drag.schedule(40);
        flushFrame(1000);

        expect(hooks.preview).toHaveBeenCalledTimes(1);
        expect(hooks.preview).toHaveBeenCalledWith(40);
        expect(hooks.apply).not.toHaveBeenCalled();
        expect(outline.getTranslateX()).toBe(30);
        expect(outline.getTranslateY()).toBe(0);
    });

    it('R4. an outline release previews the freshest move, then commits it once', () => {
        const host  = renderedHost();
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);

        beginOutlineIn(drag, host);
        drag.schedule(40);
        flushFrame(1000);

        const outline = outlineOf(drag)!;

        drag.schedule(55);

        expect(drag.end()).toBe(true);
        expect(hooks.preview).toHaveBeenCalledWith(55);
        expect(hooks.commit).toHaveBeenCalledTimes(1);
        expect(hooks.commit).toHaveBeenCalledWith(55);
        expect(outlineOf(drag)).toBeNull();
        expect(DOM.source.getParentElement(outline.getElement()!)).toBeNull();
    });

    it('R5. a press and release with no move in between commits nothing', () => {
        const host  = renderedHost();
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);

        beginOutlineIn(drag, host);

        expect(drag.end()).toBe(true);
        expect(hooks.commit).not.toHaveBeenCalled();
        expect(outlineOf(drag)).toBeNull();
    });

    it('R6. cancelling an outline drag removes it, ignores later moves, and leaves the session reusable', () => {
        const host  = renderedHost();
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);

        beginOutlineIn(drag, host);
        drag.schedule(40);
        flushFrame(1000);
        drag.cancel();

        expect(outlineOf(drag)).toBeNull();

        drag.schedule(60);
        flushFrame(1010);

        expect(hooks.preview).toHaveBeenCalledTimes(1);
        expect(drag.end()).toBe(false);
        expect(hooks.commit).not.toHaveBeenCalled();

        drag.beginLive();
        drag.schedule(1);
        flushFrame(1020);

        expect(hooks.apply).toHaveBeenCalledTimes(1);
        expect(hooks.apply).toHaveBeenCalledWith(1);
    });

    it('R7. cancelling a live drag drops the buffered move but still ends normally', () => {
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);

        drag.beginLive();
        drag.schedule(5);
        drag.cancel();
        flushFrame(1000);

        expect(drag.end()).toBe(true);
        expect(hooks.apply).not.toHaveBeenCalled();
    });

    it('R8. Escape cancels an outline drag and leaves no viewport listener behind', () => {
        const host   = renderedHost();
        const hooks  = spiedHooks();
        const drag   = newDrag(hooks);
        const before = Event.listenerCounts().viewport;

        beginOutlineIn(drag, host);

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(host.getElement()!, 'keydown', { key: 'a' }));

        expect(outlineOf(drag)).not.toBeNull();

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(host.getElement()!, 'keydown', { key: 'Escape' }));

        expect(outlineOf(drag)).toBeNull();
        expect(Event.listenerCounts().viewport).toBe(before);
        expect(() => DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(host.getElement()!, 'keydown', { key: 'Escape' }))).not.toThrow();
        expect(drag.end()).toBe(false);
    });

    it('R9. only the browser window\'s own blur cancels an outline drag', () => {
        const host  = renderedHost();
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);

        beginOutlineIn(drag, host);

        // Viewport listeners are capture-phase, so an element's own blur
        // arrives here too and must be ignored.
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(host.getElement()!, 'blur'));

        expect(outlineOf(drag)).not.toBeNull();

        // The offline source has no window object, so `isWindow` is false for
        // every handle; the real browser's window blur is modelled by making
        // it answer true for this one dispatch.
        vi.spyOn(DOM.source, 'isWindow').mockReturnValue(true);
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(host.getElement()!, 'blur'));

        expect(outlineOf(drag)).toBeNull();
        expect(drag.end()).toBe(false);
    });

    it('R10. the fps cap caps live frames only', () => {
        const host  = renderedHost();
        const hooks = spiedHooks();
        const live  = newDrag(hooks, () => 20);

        live.beginLive();
        live.schedule(1);
        flushFrame(1000);

        expect(hooks.apply).toHaveBeenCalledTimes(1);

        live.schedule(2);
        // 30 ms after the applied frame, inside 20fps's 50 ms period.
        flushFrame(1030);

        expect(hooks.apply).toHaveBeenCalledTimes(1);

        flushFrame(1050);

        expect(hooks.apply).toHaveBeenCalledTimes(2);

        const outline = newDrag(hooks, () => 20);

        beginOutlineIn(outline, host);
        outline.schedule(20);
        flushFrame(1000);
        outline.schedule(30);
        flushFrame(1010);

        expect(hooks.preview).toHaveBeenCalledTimes(2);
    });

    it('R11. beginning again closes the drag still open without committing it', () => {
        const host  = renderedHost();
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);

        beginOutlineIn(drag, host);

        const first = outlineOf(drag)!;

        beginOutlineIn(drag, host);

        const second = outlineOf(drag)!;

        expect(second).not.toBe(first);
        expect(DOM.source.getParentElement(first.getElement()!)).toBeNull();
        expect(DOM.source.getParentElement(second.getElement()!)).toBe(host.getElement());
        expect(hooks.commit).not.toHaveBeenCalled();
    });

    it('R12. the outline writes no stylesheet rule of its own', () => {
        const host  = renderedHost();
        const hooks = spiedHooks();
        const drag  = newDrag(hooks);
        const sink  = DOM.sink as RecordingDOMSink;
        const start = sink.writes.length;

        beginOutlineIn(drag, host);

        const first = outlineOf(drag)!;

        drag.end();
        beginOutlineIn(drag, host);

        const second = outlineOf(drag)!;

        drag.end();

        // The chrome is hoisted onto the shared class tier, so it names the
        // bright "it lands here" drag token there and nowhere per-instance.
        // Read off the resolved class layer rather than the rule's CSS text:
        // the offline source reports no `cssText`, and the class rule is
        // written once per process, so a later case could not see the write.
        const classLayer = (first as unknown as { _classLayer: { authored: { border?: unknown } } })._classLayer;

        expect(String(classLayer.authored.border)).toContain('--ts-ui-drag-reorder-color');
        expect(styleRuleEntries().some(entry => entry.selector === '.ResizeOutline')).toBe(true);

        const ids = [first.getId(), second.getId()];

        expect(styleRuleEntries().filter(entry => ids.some(id => entry.selector.includes(`#${id}`)))).toEqual([]);
        expect(sink.writes.slice(start).filter(w => w.op === 'setRuleStyles' && ids.some(id => String(w.args[0]).includes(`#${id}`)))).toEqual([]);
    });

    it('R13. the app-wide mode starts live and round-trips', () => {
        expect(getAppResizeMode()).toBe('live');

        setAppResizeMode('outline');

        expect(getAppResizeMode()).toBe('outline');
    });

    it.each([
        [{ x: 97, y: 0, width: 10, height: 300 }, 'x' as const, { x: 100, y: 0, width: 4, height: 300 }],
        [{ x: 0, y: 221.766, width: 400, height: 6 }, 'y' as const, { x: 0, y: 222.766, width: 400, height: 4 }],
    ])('R14. gutterOutline(%j, %s) centres a 4 px bar on the gutter', (box, axis, expected) => {
        expect(gutterOutline(box, axis)).toEqual(expected);
    });

    it('B1. Body sets the app-wide mode, and a manager with none of its own follows it', async () => {
        installTestDOM(CONFIG);

        Body.getInstance().setResizeMode('outline');

        expect(Body.getInstance().getResizeMode()).toBe('outline');
        expect(getAppResizeMode()).toBe('outline');
        expect(new Split().getResizeMode()).toBe('outline');

        await Body.init({ resizeMode: 'live' });

        expect(Body.getInstance().getResizeMode()).toBe('live');
    });
});
