// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins the deferred-resync fix at the shape it exists for: a `Tab`-hosted
// strip resized on the axis it does not lay tabs along (a horizontal-gutter
// drag resizing the pane's height, in Loom's 2x2 editor grid) must not force
// a single scroll-geometry read, because the strip's own box never changes.
// See `ScrollStrip.resizeResyncCoalescing.test.ts` for the mechanism this
// pins from `ScrollStrip`'s own side; this file confirms it from the
// `Tab`/`TabBar` integration the plan measured.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab, TabOptions } from '~/layout/Tab';
import { TabBar } from '~/component/container/TabBar';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The offline sink drops requestAnimationFrame/cancelAnimationFrame (see
// DOMSink); capture them so the settle mechanism (Component.afterNextLayout
// — see ScrollStrip.ts's scheduleResizeSettle) can be driven to completion
// explicitly, the same harness ScrollStrip.resizeResyncCoalescing.test.ts
// uses.
let nextFrameHandle = 1;
let frames: Map<number, FrameRequestCallback> = new Map();

/** Installs the Map-keyed requestAnimationFrame/cancelAnimationFrame capture. */
function installFrameCapture(): void {
    nextFrameHandle = 1;
    frames = new Map();
    (DOM.sink as any).requestAnimationFrame = (callback: FrameRequestCallback): number => {
        const handle = nextFrameHandle++;
        frames.set(handle, callback);

        return handle;
    };
    (DOM.sink as any).cancelAnimationFrame = (handle: number): void => {
        frames.delete(handle);
    };
}

/**
 * Runs exactly the currently-queued frames once, without draining any a
 * callback re-queues in turn.
 */
function runQueuedFramesOnce(): void {
    const pending = Array.from(frames.values());
    frames.clear();

    for (const callback of pending) {
        callback(0);
    }
}

/** Runs queued frames to quiescence, including any newly re-armed in turn. */
function drainFrames(): void {
    for (let guard = 0; guard < 10 && frames.size > 0; guard++) {
        runQueuedFramesOnce();
    }
}

/** A Tab-managed strip, sized and rendered so tab cells materialise on doLayout. */
function hostTab(options?: TabOptions): { host: Container; tab: Tab } {
    const tab  = new Tab(options);
    const host = new Container({ layoutManager: tab });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);
    host.clearInsets();

    return { host, tab };
}

/** Reaches the Tab's TabBar's inner ScrollStrip — the same private surface Tab.doLayout drives. */
function hostedStrip(tab: Tab): ScrollStrip {
    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return (bar as unknown as { _tabClip: ScrollStrip })._tabClip;
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    DOM.reset();
});

describe('Tab-hosted strip relayout economy', () => {
    it('a pane height change alone reads nothing from the strip', () => {
        installTestDOM(CONFIG);
        installFrameCapture();

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();
        drainFrames();

        const strip = hostedStrip(tab);
        const getScrollLeftSpy = vi.spyOn(DOM.source, 'getScrollLeft');
        const getScrollTopSpy = vi.spyOn(DOM.source, 'getScrollTop');
        const getScrollMetricsSpy = vi.spyOn(DOM.source, 'getScrollMetrics');

        host.setHeight(310);
        host.doLayout();

        expect(getScrollLeftSpy).not.toHaveBeenCalled();
        expect(getScrollTopSpy).not.toHaveBeenCalled();
        expect(getScrollMetricsSpy).not.toHaveBeenCalled();
        expect((strip as any)._resizeSettleHandle).toBeNull();
    });

    it('a repeated pass writes no ARIA and toggles no class', () => {
        const sink = installTestDOM(CONFIG);
        installFrameCapture();

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();
        drainFrames();

        host.setHeight(310);
        host.doLayout();

        sink.writes.length = 0;

        host.setHeight(320);
        host.doLayout();

        const classWrites = sink.writes.filter(w => {
            const patch = w.args[1] as { addClass?: string[]; removeClass?: string[] };

            return w.op === 'apply' && (patch.addClass !== undefined || patch.removeClass !== undefined);
        });
        const ariaWrites = sink.writes.filter(w => {
            const patch = w.args[1] as { setAttr?: Record<string, string> };

            return w.op === 'apply' && Object.keys(patch.setAttr ?? {}).some(key => key.startsWith('aria-'));
        });

        expect(classWrites.length).toBe(0);
        expect(ariaWrites.length).toBe(0);
    });

    it('a repeated pass writes no data-insets attribute', () => {
        const sink = installTestDOM(CONFIG);
        installFrameCapture();

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);

        // `applyTabButtonStyles` calls `setInsets` once per tab button, once
        // per tool button and once for a lead widget on every pass — with the
        // computed insets almost always identical to the ones already stored.
        // The first pass is asserted non-zero so the filter below is provably
        // able to see the writes the later passes must not make (see
        // plans/implemented/component-setter-guards.md, behaviour 25).
        const firstPassStart = sink.writes.length;

        host.doLayout();
        drainFrames();

        expect(insetWritesSince(sink, firstPassStart).length).toBeGreaterThan(0);

        host.setHeight(310);
        host.doLayout();

        const start = sink.writes.length;

        host.setHeight(320);
        host.doLayout();

        expect(insetWritesSince(sink, start)).toEqual([]);
    });
});

/** The `data-insets` attribute values the sink recorded on `apply` patches since `from`. */
function insetWritesSince(recorder: { writes: Array<{ op: string; args: unknown[] }> }, from: number): string[] {
    const written: string[] = [];

    for (const write of recorder.writes.slice(from)) {
        if (write.op !== 'apply') {
            continue;
        }

        const setAttr = (write.args[1] as { setAttr?: Record<string, string> }).setAttr;

        if (setAttr && 'data-insets' in setAttr) {
            written.push(setAttr['data-insets']);
        }
    }

    return written;
}
