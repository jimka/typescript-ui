// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// `FocusReveal.reveal` works through the revealers around a control in two
// passes. Cases B1–B9, P1–P3, S1–S2, O1 and W1–W7 of
// plans/implemented/nested-scroll-reveal.md, and the cases S3–S7, P4, O2,
// W8–W24, A1–A8, N1–N6, D1–D3 and H1–H3 the implementation and its reviews
// added.
//
// A *revealer* is a container registered with the broker. An *opener* reveals
// by changing state (a tab, a collapsed pane); a *scroller* reveals by
// scrolling, and is the one that implements `revealRect`. The open pass runs
// every opener outermost first, inside the `reveal` call. The scroll pass then
// runs every scroller innermost first: the broker measures the control once,
// hands that rectangle to the innermost scroller, and hands what each scroller
// returns to the next one out.
//
// The scroll pass waits while the geometry around the control is not settled:
// a layout pass is queued for a component around it, or an opener around it
// reports that it is still animating. It asks again after each layout flush,
// and scrolls regardless after 60 of them.
//
// The modelled DOM gives the cases their geometry as follows.
//
//   - An element's rectangle is composed from the sizes and positions the
//     library wrote, less each ancestor's recorded scroll offset. Every
//     panel's viewport is its whole box here: no scrollbar band is seeded and
//     the model has no border.
//   - Scroll offsets are NOT clamped, unlike in a browser, so a wrong target
//     shows as a wrong number.
//   - Connectedness is kept per element. The broker drops, for good, a
//     revealer whose element is rendered and not connected, so `mount` marks
//     the control and every panel around it connected.
//   - An animation frame never runs by itself. `requestAnimationFrame` is
//     captured and the captured callbacks are run by hand: one layout flush
//     is one captured callback.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Panel } from '~/core/Panel';
import type { PanelOptions } from '~/core/Panel';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle, Rect } from '~/core/DOM';
import { FocusReveal } from '~/core/FocusReveal';
import type { FocusRevealer } from '~/core/FocusReveal';
import { FocusHistory } from '~/core/FocusHistory';
import { Event } from '~/core/Event';
import { LayerManager, type DismissableLayer } from '~/core/LayerManager';
import { Absolute } from '~/layout/Absolute';
import { installTestDOM, makeEvent, setConnected, setRenderedVisible, setScrollExtent, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The mounted root panel's box.
const ROOT_WIDTH  = 300;
const ROOT_HEIGHT = 200;

// How many layout flushes the scroll pass waits before it scrolls regardless.
// Mirrors `MAX_SETTLE_FLUSHES` in `core/FocusReveal.ts`, which the module does
// not export: one flush per animation frame, so one second at 60 Hz.
const MAX_SETTLE_FLUSHES = 60;

/** The two styles a scrolling `Panel` draws its scrollbar in. */
type ScrollbarStyle = 'overlay' | 'native';

const STYLES: readonly ScrollbarStyle[] = ['overlay', 'native'];

/** A registered test double, with its `revealDescendant` as a mock. */
type RevealerDouble = FocusRevealer & { revealDescendant: ReturnType<typeof vi.fn> };

let frames: FrameRequestCallback[];
let built: Component[];
let doubles: FocusRevealer[];

/** Runs the animation frames captured so far, once: one layout flush. */
function flushFrame(): void {
    const pending = frames;

    frames = [];

    for (const callback of pending) {
        callback(0);
    }
}

/** Runs every captured animation frame, including those a frame schedules. */
function drainFrames(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard++) {
        flushFrame();
    }
}

/** The element of the panel that really scrolls. */
function scroller(panel: Panel): Handle {
    return (panel as any).getScrollElement();
}

/** How many writes the sink has recorded so far: the mark `scrollWrites` counts from. */
function writeMark(): number {
    return (DOM.sink as RecordingDOMSink).writes.length;
}

/**
 * How many scroll-offset writes the sink recorded after `from`.
 *
 * @param from - A mark taken with {@link writeMark}.
 * @returns The number of `apply` writes carrying `scrollTop` or `scrollLeft`.
 */
function scrollWrites(from: number): number {
    return (DOM.sink as RecordingDOMSink).writes.slice(from).filter(write => {
        const patch = write.args[1] as { scrollTop?: number; scrollLeft?: number } | undefined;

        return write.op === 'apply' && (patch?.scrollTop !== undefined || patch?.scrollLeft !== undefined);
    }).length;
}

/**
 * Each panel's vertical offset, after asserting that the panel's remembered
 * offset and the scrolling element's own agree.
 *
 * @param panels - The panels to read, outermost first by convention.
 * @returns One `scrollTop` per panel.
 */
function tops(...panels: Panel[]): number[] {
    return panels.map(panel => {
        expect(DOM.source.getScrollTop(scroller(panel))).toBe(panel.getScrollTop());

        return panel.getScrollTop();
    });
}

/**
 * A rectangle from its four edges.
 *
 * @param left - The left edge.
 * @param top - The top edge.
 * @param right - The right edge.
 * @param bottom - The bottom edge.
 * @returns The rectangle, with all eight fields.
 */
function rect(left: number, top: number, right: number, bottom: number): Rect {
    return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * A rectangle's four edges.
 *
 * @param r - The rectangle.
 * @returns `[left, top, right, bottom]`.
 */
function edges(r: Rect): number[] {
    return [r.left, r.top, r.right, r.bottom];
}

/**
 * The root panel of a fixture, not yet mounted.
 *
 * @param options - `Panel` options on top of an `Absolute` layout and no insets.
 * @returns The panel.
 */
function root(options: PanelOptions): Panel {
    return new Panel({ layoutManager: new Absolute(), flush: true, ...options });
}

/**
 * A scrolling panel of a fixed size placed at (`x`, `y`) in its parent's
 * content, for nesting.
 *
 * @param options - `Panel` options on top of an `Absolute` layout and no insets.
 * @param x - The panel's left edge in its parent's content.
 * @param y - The panel's top edge in its parent's content.
 * @param width - The panel's width.
 * @param height - The panel's height.
 * @returns The panel.
 */
function child(options: PanelOptions, x: number, y: number, width: number, height: number): Panel {
    const panel = new Panel({ layoutManager: new Absolute(), flush: true, preferredSize: { width, height }, ...options });

    panel.setX(x);
    panel.setY(y);

    return panel;
}

/**
 * A plain component of a fixed size placed at (`x`, `y`): the control a case
 * reveals.
 *
 * @param x - The left edge in the parent's content.
 * @param y - The top edge in the parent's content.
 * @param width - The width.
 * @param height - The height.
 * @returns The component.
 */
function box(x: number, y: number, width: number, height: number): Component {
    const component = new Component({ preferredSize: { width, height } });

    component.setX(x);
    component.setY(y);

    return component;
}

/**
 * Mounts `rootPanel` at 300 × 200, lays it out, runs the frames that queues,
 * and marks every component under it connected.
 *
 * @param rootPanel - The outermost panel, disposed by the teardown.
 * @param inside - Every component under it that a case reveals or scrolls.
 */
function mount(rootPanel: Panel, ...inside: Component[]): void {
    built.push(rootPanel);

    setConnected(rootPanel.getElement(true)!, true);
    rootPanel.setWidth(ROOT_WIDTH);
    rootPanel.setHeight(ROOT_HEIGHT);
    rootPanel.doLayout();
    drainFrames();

    for (const component of inside) {
        setConnected(component.getElement()!, true);
    }
}

/**
 * Gives `panel` a scroll range: content `width` × `height`, seeded before the
 * panel's layout pass, which is where a panel learns whether it has anything
 * to scroll. A visible scrollbar then takes a band out of the viewport on the
 * other axis. Call it before {@link mount}.
 *
 * @param panel - The panel, not yet laid out.
 * @param width - The content's width.
 * @param height - The content's height.
 */
function giveRange(panel: Panel, width: number, height: number): void {
    panel.getElement(true);
    setScrollExtent(scroller(panel), { width, height });
}

/**
 * Dispatches an input event of the user's at the window, as a browser does on
 * its way to `target`.
 *
 * @param target - The element the event targets.
 * @param type - The event type.
 * @param init - Event fields, such as `key`.
 * @returns The event, so that a case can mark it cancelled by a widget.
 */
function userInput(target: Handle, type: string, init: Record<string, unknown> = {}): globalThis.Event {
    const event = makeEvent(target, type, init);

    DOM.sink.dispatchEvent(DOM.source.getWindow(), event);

    return event;
}

/**
 * Registers a revealer that only records: an opener, unless `extra` gives it
 * a `revealRect`.
 *
 * @param element - The element the double reports as its own.
 * @param extra - Optional members to add, such as `isRevealSettled`.
 * @returns The registered double.
 */
function double(element: Handle, extra: Partial<FocusRevealer> = {}): RevealerDouble {
    const revealer = { getRevealElement: () => element, revealDescendant: vi.fn(), ...extra } as RevealerDouble;

    FocusReveal.register(revealer);
    doubles.push(revealer);

    return revealer;
}

beforeEach(() => {
    installTestDOM(CONFIG);

    frames  = [];
    built   = [];
    doubles = [];

    // A reveal waits for a queued layout pass, and the modelled DOM never runs
    // an animation frame. Capture each one, so a case can run a flush by hand
    // and the teardown can drain what is left.
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);

        return frames.length;
    });
});

afterEach(() => {
    drainFrames();

    vi.restoreAllMocks();

    for (const revealer of doubles) {
        FocusReveal.unregister(revealer);
    }

    // A scrolling panel stays in the reveal registry until it is disposed, and
    // the next test's fresh handle table reuses its element's number.
    for (const component of built) {
        component.dispose();
    }

    DOM.reset();
});

for (const style of STYLES) {
    /**
     * The default fixture: a 300 × 200 page holding a 250 × 120 panel 600 px
     * down, which holds a 40 × 30 control 500 px down.
     *
     * @param targetBox - The control, when a case needs another one.
     * @returns The two panels and the control, mounted.
     */
    function nest(targetBox: Component = box(10, 500, 40, 30)): { outer: Panel; inner: Panel; target: Component } {
        const outer = root({ autoScroll: 'y', scrollbarStyle: style });
        const inner = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 600, 250, 120);

        inner.addComponent(targetBox);
        outer.addComponent(inner);
        mount(outer, inner, targetBox);

        return { outer, inner, target: targetBox };
    }

    describe(`FocusReveal.reveal through nested panels (${style})`, () => {
        it('B1: one call brings the control into view of both panels, innermost first', () => {
            const { outer, inner, target } = nest();

            expect(FocusReveal.reveal(target.getElement()!)).toBe(true);

            // Inner: the control's end, 530, goes to the viewport's end:
            // 530 − 120. That draws the control at 690–720 of the page, whose
            // end then goes to the page's: 720 − 200.
            expect(tops(outer, inner)).toEqual([520, 410]);

            const mark = writeMark();

            FocusReveal.reveal(target.getElement()!);

            expect(scrollWrites(mark)).toBe(0);
        });

        it('B2: three panels inside one another each scroll once', () => {
            const outer  = root({ autoScroll: 'y', scrollbarStyle: style });
            const mid    = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 600, 250, 150);
            const inner  = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 400, 200, 100);
            const target = box(10, 300, 40, 30);

            inner.addComponent(target);
            mid.addComponent(inner);
            outer.addComponent(mid);
            mount(outer, mid, inner, target);

            FocusReveal.reveal(target.getElement()!);

            // Inner: 330 − 100. Middle: the control is then drawn at 470–500
            // of its content, so 500 − 150. Page: 600 + 150 − 200.
            expect(tops(outer, mid, inner)).toEqual([550, 350, 230]);
        });

        it('B3: a control taller than the inner viewport makes the page show that viewport', () => {
            const { outer, inner, target } = nest(box(10, 500, 40, 300));

            FocusReveal.reveal(target.getElement()!);

            // The inner panel puts the control's start on its own start edge
            // (500) and shows 120 px of it. The page is handed those 120 px,
            // 600–720, not the control's whole 300 px, which would take it to
            // 600.
            expect(tops(outer, inner)).toEqual([520, 500]);
        });

        it('B4: a control the inner panel clips sideways does not move the page sideways', () => {
            const outer  = root({ autoScroll: 'auto', scrollbarStyle: style });
            const inner  = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 600, 250, 120);
            const target = box(400, 500, 40, 30);

            inner.addComponent(target);
            outer.addComponent(inner);
            mount(outer, inner, target);

            FocusReveal.reveal(target.getElement()!);

            expect(tops(outer, inner)).toEqual([520, 410]);
            expect(outer.getScrollLeft()).toBe(0);
            expect(inner.getScrollLeft()).toBe(0);
        });

        it('B5: a control already in view of both panels scrolls nothing', () => {
            const outer  = root({ autoScroll: 'y', scrollbarStyle: style });
            const inner  = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 20, 250, 120);
            const target = box(10, 40, 40, 30);

            inner.addComponent(target);
            outer.addComponent(inner);
            mount(outer, inner, target);

            const mark = writeMark();

            FocusReveal.reveal(target.getElement()!);

            expect(scrollWrites(mark)).toBe(0);
        });

        it('B6: a control that is not rendered scrolls nothing', () => {
            const { outer, inner, target } = nest();

            outer.setScrollTop(300);
            setRenderedVisible(target.getElement()!, false);

            const mark = writeMark();

            expect(FocusReveal.reveal(target.getElement()!)).toBe(true);
            expect(scrollWrites(mark)).toBe(0);
            expect(tops(outer, inner)).toEqual([300, 0]);
        });

        it('B7: revealing a scrolling panel itself does not ask that panel to scroll', () => {
            const outer = root({ autoScroll: 'y', scrollbarStyle: style });
            const inner = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 600, 250, 120);

            inner.addComponent(box(10, 500, 40, 30));
            outer.addComponent(inner);
            mount(outer, inner);
            inner.setScrollTop(77);

            const own = vi.spyOn(inner, 'revealRect');

            FocusReveal.reveal(inner.getElement()!);

            expect(own).not.toHaveBeenCalled();

            // The page shows the inner panel's whole box: 600 + 120 − 200.
            expect(tops(outer, inner)).toEqual([520, 77]);
        });

        it('B8: a page scrolled past the control comes back to show all of it', () => {
            const { outer, inner, target } = nest();

            outer.setScrollTop(800);

            FocusReveal.reveal(target.getElement()!);

            // The control is drawn at 690–720 of the page, above the 800 the
            // page was at: its start goes to the page's start edge.
            expect(tops(outer, inner)).toEqual([690, 410]);
        });

        it('B9: an axis the inner panel does not scroll is left to the page', () => {
            const outer  = root({ autoScroll: 'auto', scrollbarStyle: style });
            const inner  = child({ autoScroll: 'y', scrollbarStyle: style }, 400, 600, 250, 120);
            const target = box(10, 500, 40, 30);

            inner.addComponent(target);
            outer.addComponent(inner);
            mount(outer, inner, target);

            FocusReveal.reveal(target.getElement()!);

            expect(tops(outer, inner)).toEqual([520, 410]);
            expect(inner.getScrollLeft()).toBe(0);

            // The control spans 410–450 across the page: 450 − 300.
            expect(outer.getScrollLeft()).toBe(150);
        });
    });

    describe(`Panel.revealRect, revealSpan and revealDescendant (${style})`, () => {
        it('P1: revealRect scrolls the least distance and returns what the viewport then shows', () => {
            const panel = root({ autoScroll: 'auto', scrollbarStyle: style });

            mount(panel);

            // 540 − 200: the rectangle ends flush with the bottom edge.
            expect(edges(panel.revealRect(rect(50, 500, 90, 540)))).toEqual([50, 160, 90, 200]);
            expect(tops(panel)).toEqual([340]);

            // Already in view: handed back as it is, and nothing moves.
            expect(edges(panel.revealRect(rect(50, 20, 90, 60)))).toEqual([50, 20, 90, 60]);
            expect(tops(panel)).toEqual([340]);

            // Taller than the viewport and cut at the end: its start goes to
            // the start edge (340 + 50), and what shows is the whole viewport.
            expect(edges(panel.revealRect(rect(50, 50, 90, 550)))).toEqual([50, 0, 90, 200]);
            expect(tops(panel)).toEqual([390]);
        });

        it('P2: an axis argument limits the reveal to that axis', () => {
            const panel = root({ autoScroll: 'auto', scrollbarStyle: style });

            mount(panel);

            // Down only: the rectangle stays right of the viewport, so what
            // shows of it is the viewport's right edge, with no width.
            expect(edges(panel.revealRect(rect(500, 500, 540, 540), 'y'))).toEqual([300, 160, 300, 200]);
            expect(panel.getScrollLeft()).toBe(0);
            expect(tops(panel)).toEqual([340]);

            // Sideways only: 540 − 300.
            expect(edges(panel.revealRect(rect(500, 160, 540, 200), 'x'))).toEqual([260, 160, 300, 200]);
            expect(panel.getScrollLeft()).toBe(240);
            expect(tops(panel)).toEqual([340]);
        });

        it('P3: a hidden panel moves nothing and hands the rectangle on untouched', () => {
            const panel = root({ autoScroll: 'auto', scrollbarStyle: style });

            mount(panel);
            panel.setScrollTop(120);
            panel.setDisplayed(false);

            // A browser reads 0 for the offsets of an element under
            // `display: none`. Re-reading them here would lose the 120.
            DOM.sink.apply(scroller(panel), { scrollTop: 0 });

            const mark = writeMark();

            expect(edges(panel.revealRect(rect(50, 500, 90, 540)))).toEqual([50, 500, 90, 540]);
            expect(scrollWrites(mark)).toBe(0);
            expect(panel.getScrollTop()).toBe(120);
        });

        it('S1: revealSpan continues outward, along its own axis only', () => {
            const outer = root({ autoScroll: 'auto', scrollbarStyle: style });
            const inner = child({ autoScroll: 'y', scrollbarStyle: style }, 400, 600, 250, 120);

            // Content past the page both ways, so the page could scroll
            // either way; each scrollbar takes its band out of the viewport.
            giveRange(outer, 900, 2000);
            outer.addComponent(inner);
            mount(outer, inner);

            const band = style === 'overlay' ? 12 : CONFIG.scrollBarWidth;

            expect(outer.getScrollViewportRect()!.height).toBe(ROOT_HEIGHT - band);

            inner.revealSpan('y', 500, 530);

            // Inner: 530 − 120. The span is then at the inner panel's bottom
            // edge, 720 of the page, which goes to the viewport's bottom edge.
            expect(tops(outer, inner)).toEqual([720 - (ROOT_HEIGHT - band), 410]);

            // The inner panel is cut at the page's right edge. A reveal along
            // "y" still never moves the page sideways.
            expect(outer.getScrollLeft()).toBe(0);

            const mark = writeMark();

            inner.revealSpan('y', 420, 450);

            expect(scrollWrites(mark)).toBe(0);

            inner.revealSpan('y', 100, 130);

            // The span is then at the inner panel's top edge, 600 of the page,
            // which already shows it.
            expect(tops(outer, inner)).toEqual([720 - (ROOT_HEIGHT - band), 100]);
        });

        it('S3: revealSpan on a panel the page has not laid out yet runs that layout first, in the call', () => {
            const outer = root({ autoScroll: 'y', scrollbarStyle: style });
            const inner = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 600, 250, 120);

            giveRange(outer, ROOT_WIDTH, 2000);
            mount(outer);
            outer.setScrollTop(100);

            // Added after the page's layout pass: the panel has an element
            // and a position, and no size yet.
            outer.addComponent(inner);
            setConnected(inner.getElement(true)!, true);

            const asked = vi.spyOn(outer, 'revealRect');

            inner.revealSpan('y', 500, 530);

            // The queued layout pass has run: the panel, now 120 px high,
            // scrolled the span into its own viewport (530 − 120), and the
            // page was asked once, for the span at the panel's bottom edge:
            // 600 + 120 − 200.
            expect(asked).toHaveBeenCalledTimes(1);
            expect(tops(outer, inner)).toEqual([520, 410]);

            const mark = writeMark();

            drainFrames();

            expect(scrollWrites(mark)).toBe(0);
        });

        it('S6: revealSpan with around false scrolls the panel and asks nothing around it', () => {
            const outer = root({ autoScroll: 'y', scrollbarStyle: style });
            const inner = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 600, 250, 120);

            giveRange(outer, ROOT_WIDTH, 2000);
            outer.addComponent(inner);
            mount(outer, inner);

            const asked = vi.spyOn(outer, 'revealRect');
            const rects = vi.spyOn(DOM.source, 'getElementRect');

            expect(inner.revealSpan('y', 500, 530, false)).toBe(inner);

            // One rectangle: the panel's own, to scroll its own span.
            expect(tops(outer, inner)).toEqual([0, 410]);
            expect(asked).not.toHaveBeenCalled();
            expect(rects).toHaveBeenCalledTimes(1);
        });

        it('S4: revealSpan with nothing to scroll around the panel measures the panel once and asks nothing else', () => {
            const outer = root({ autoScroll: 'y', scrollbarStyle: style });
            const inner = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 20, 250, 120);

            // The page's content fits: it has no scroll range.
            outer.addComponent(inner);
            mount(outer, inner);

            const asked = vi.spyOn(outer, 'revealRect');
            const rects = vi.spyOn(DOM.source, 'getElementRect');

            inner.revealSpan('y', 500, 530);

            expect(tops(outer, inner)).toEqual([0, 410]);
            expect(asked).not.toHaveBeenCalled();
            expect(rects).toHaveBeenCalledTimes(1);
        });

        it('S7: on settled geometry revealSpan measures the panel once and the page once', () => {
            const outer = root({ autoScroll: 'y', scrollbarStyle: style });
            const inner = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 600, 250, 120);

            giveRange(outer, ROOT_WIDTH, 2000);
            outer.addComponent(inner);
            mount(outer, inner);

            const rects = vi.spyOn(DOM.source, 'getElementRect');

            inner.revealSpan('y', 500, 530);

            // No layout pass was run, so the panel is not revealed in a
            // second time: its viewport is read once, then the page's.
            expect(tops(outer, inner)).toEqual([520, 410]);
            expect(rects).toHaveBeenCalledTimes(2);
        });

        it('S7b: a page that was queued and has been laid out directly since counts as settled', () => {
            const outer = root({ autoScroll: 'y', scrollbarStyle: style });
            const inner = child({ autoScroll: 'y', scrollbarStyle: style }, 0, 600, 250, 120);

            giveRange(outer, ROOT_WIDTH, 2000);
            outer.addComponent(inner);
            mount(outer, inner);
            outer.scheduleLayout();
            outer.doLayout();

            const laidOut = vi.spyOn(outer, 'doLayout');
            const rects   = vi.spyOn(DOM.source, 'getElementRect');

            inner.revealSpan('y', 500, 530);

            // As S7: no pass is run, and the panel is not revealed in twice.
            expect(tops(outer, inner)).toEqual([520, 410]);
            expect(laidOut).not.toHaveBeenCalled();
            expect(rects).toHaveBeenCalledTimes(2);
        });

        it('P4: hasScrollRange says, without measuring, whether the panel has anything to scroll along an axis', () => {
            const fits  = root({ autoScroll: 'auto', scrollbarStyle: style });
            const tall  = root({ autoScroll: 'auto', scrollbarStyle: style });
            const fixed = root({ autoScroll: 'y', scrollbarStyle: style });

            giveRange(tall, ROOT_WIDTH - 40, 2000);
            giveRange(fixed, 900, ROOT_HEIGHT - 40);
            mount(fits);
            mount(tall);
            mount(fixed);

            const rects = vi.spyOn(DOM.source, 'getElementRect');

            expect([fits.hasScrollRange('x'), fits.hasScrollRange('y'), fits.hasScrollRange()]).toEqual([false, false, false]);
            expect([tall.hasScrollRange('x'), tall.hasScrollRange('y'), tall.hasScrollRange()]).toEqual([false, true, true]);

            // Content wider than the panel, on an axis its mode does not scroll.
            expect([fixed.hasScrollRange('x'), fixed.hasScrollRange('y'), fixed.hasScrollRange()]).toEqual([false, false, false]);
            expect(rects).not.toHaveBeenCalled();

            // A panel that stops scrolling has no range, whatever it last measured.
            tall.setAutoScroll('none');

            expect([tall.hasScrollRange('y'), tall.hasScrollRange()]).toEqual([false, false]);
        });

        it('S2: revealDescendant scrolls the panel it is called on and nothing around it', () => {
            const { outer, inner, target } = nest();

            inner.revealDescendant(target.getElement()!);

            expect(tops(outer, inner)).toEqual([0, 410]);
        });
    });
}

describe('FocusReveal.reveal: the order of the two passes', () => {
    /**
     * The default fixture, with the library's default scrollbar style.
     *
     * @returns The two panels and the control, mounted.
     */
    function nest(): { outer: Panel; inner: Panel; target: Component } {
        const outer  = root({ autoScroll: 'y' });
        const inner  = child({ autoScroll: 'y' }, 0, 600, 250, 120);
        const target = box(10, 500, 40, 30);

        inner.addComponent(target);
        outer.addComponent(inner);
        mount(outer, inner, target);

        return { outer, inner, target };
    }

    it('O1: every opener acts before any scroller, outermost first', () => {
        const { outer, inner, target } = nest();
        const record: string[] = [];
        const outside = double(outer.getElement()!);
        const between = double(inner.getElement()!);

        outside.revealDescendant.mockImplementation(() => {
            record.push('outside:' + tops(outer, inner).join(','));
        });

        between.revealDescendant.mockImplementation(() => {
            record.push('between:' + tops(outer, inner).join(','));
        });

        FocusReveal.reveal(target.getElement()!);

        expect(record).toEqual(['outside:0,0', 'between:0,0']);
        expect(tops(outer, inner)).toEqual([520, 410]);
    });

    it('O2: an opener is handed the control, and a scroller is not asked through revealDescendant', () => {
        const { outer, inner, target } = nest();
        const opener        = double(outer.getElement()!);
        const outerDescends = vi.spyOn(outer, 'revealDescendant');
        const innerDescends = vi.spyOn(inner, 'revealDescendant');

        FocusReveal.reveal(target.getElement()!);

        expect(opener.revealDescendant).toHaveBeenCalledTimes(1);
        expect(opener.revealDescendant).toHaveBeenCalledWith(target.getElement());
        expect(outerDescends).not.toHaveBeenCalled();
        expect(innerDescends).not.toHaveBeenCalled();
    });
});

describe('FocusReveal.reveal: waiting for the geometry to settle', () => {
    /**
     * The default fixture, with the library's default scrollbar style.
     *
     * @returns The two panels and the control, mounted.
     */
    function nest(): { outer: Panel; inner: Panel; target: Component } {
        const outer  = root({ autoScroll: 'y' });
        const inner  = child({ autoScroll: 'y' }, 0, 600, 250, 120);
        const target = box(10, 500, 40, 30);

        inner.addComponent(target);
        outer.addComponent(inner);
        mount(outer, inner, target);

        return { outer, inner, target };
    }

    it('W1: waits while an opener is not settled, then scrolls once', () => {
        const { outer, inner, target } = nest();
        let settled = false;

        double(outer.getElement()!, { isRevealSettled: () => settled });

        const mark = writeMark();

        expect(FocusReveal.reveal(target.getElement()!)).toBe(true);
        expect(scrollWrites(mark)).toBe(0);

        flushFrame();
        flushFrame();

        expect(scrollWrites(mark)).toBe(0);

        settled = true;
        flushFrame();

        expect(tops(outer, inner)).toEqual([520, 410]);

        const after = writeMark();

        flushFrame();
        flushFrame();

        expect(scrollWrites(after)).toBe(0);
    });

    it('W2: an opener that never settles is waited for 60 flushes, and no longer', () => {
        const { outer, inner, target } = nest();

        double(outer.getElement()!, { isRevealSettled: () => false });

        const mark = writeMark();

        FocusReveal.reveal(target.getElement()!);

        for (let flush = 0; flush < MAX_SETTLE_FLUSHES - 1; flush++) {
            flushFrame();
        }

        expect(scrollWrites(mark)).toBe(0);

        flushFrame();

        expect(tops(outer, inner)).toEqual([520, 410]);

        // The pass is over: it does not ask for a frame of its own again.
        const after = writeMark();

        drainFrames();

        expect(scrollWrites(after)).toBe(0);
        expect(frames).toHaveLength(0);
    });

    it('W3: waits for a layout pass queued around the control', () => {
        const { outer, inner, target } = nest();

        inner.scheduleLayout();

        const mark = writeMark();

        FocusReveal.reveal(target.getElement()!);

        expect(scrollWrites(mark)).toBe(0);

        flushFrame();

        expect(tops(outer, inner)).toEqual([520, 410]);
    });

    it('W4: a layout pass queued beside the control does not delay the scroll', () => {
        const { outer, inner, target } = nest();
        const aside = box(0, 0, 10, 10);

        outer.addComponent(aside);
        outer.doLayout();
        drainFrames();
        aside.scheduleLayout();

        FocusReveal.reveal(target.getElement()!);

        expect(tops(outer, inner)).toEqual([520, 410]);
    });

    it('W11: a queued panel that has been laid out directly since does not delay the scroll', () => {
        const { outer, inner, target } = nest();

        // What `Tab.revealDescendant` leaves behind: it queues its container
        // and then lays it out itself, so the queued pass is no longer owed.
        inner.scheduleLayout();
        inner.doLayout();

        FocusReveal.reveal(target.getElement()!);

        expect(tops(outer, inner)).toEqual([520, 410]);
    });

    it('W5: a newer reveal withdraws the one that is still waiting', () => {
        const { outer, inner, target } = nest();
        const other = box(10, 0, 40, 30);
        let settled = false;

        inner.addComponent(other);
        inner.doLayout();
        drainFrames();
        setConnected(other.getElement()!, true);
        double(outer.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(target.getElement()!);

        settled = true;
        inner.setScrollTop(200);
        FocusReveal.reveal(other.getElement()!);

        // `other` is at the top of the inner panel: 0 there, and the page
        // shows it flush with its bottom edge, 600 + 30 − 200.
        expect(tops(outer, inner)).toEqual([430, 0]);

        const mark = writeMark();

        flushFrame();
        flushFrame();

        expect(scrollWrites(mark)).toBe(0);
    });

    it('W6: a control that has left the document while the scroll waited scrolls nothing', () => {
        const { outer, inner, target } = nest();
        let settled = false;

        double(outer.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(target.getElement()!);
        setConnected(target.getElement()!, false);
        settled = true;

        const mark = writeMark();

        flushFrame();

        expect(scrollWrites(mark)).toBe(0);
        expect(tops(outer, inner)).toEqual([0, 0]);
    });

    it('W7: a panel\'s own revealSpan scrolls at once and leaves the waiting reveal in place', () => {
        const outer  = root({ autoScroll: 'y' });
        const inner  = child({ autoScroll: 'y' }, 0, 600, 250, 120);
        const target = box(10, 500, 40, 30);
        let settled  = false;

        giveRange(outer, ROOT_WIDTH, 2000);
        inner.addComponent(target);
        outer.addComponent(inner);
        mount(outer, inner, target);
        double(outer.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(target.getElement()!);
        inner.revealSpan('y', 200, 230);

        // Inner: 230 − 120. The span is then at the inner panel's bottom
        // edge, 720 of the page: 720 − 200.
        expect(tops(outer, inner)).toEqual([520, 110]);

        settled = true;
        flushFrame();

        expect(tops(outer, inner)).toEqual([520, 410]);
    });

    it('W8: an opener that leaves the registry while it animates no longer holds the scroll back', () => {
        const { outer, inner, target } = nest();
        const opener = double(outer.getElement()!, { isRevealSettled: () => false });
        const mark   = writeMark();

        FocusReveal.reveal(target.getElement()!);
        flushFrame();

        expect(scrollWrites(mark)).toBe(0);

        // What `detach()` does when the opener's container is disposed or
        // given another layout manager mid-animation.
        FocusReveal.unregister(opener);
        flushFrame();

        expect(tops(outer, inner)).toEqual([520, 410]);
    });

    it('W9: a control disposed while the scroll waited scrolls nothing and reports no failure', () => {
        const { outer, inner, target } = nest();
        const element  = target.getElement()!;
        const failures = vi.spyOn(console, 'error').mockImplementation(() => {});
        let settled = false;

        double(outer.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(element);

        // Disposing releases the handle. Every read of a released handle but
        // `isRegistered` throws in a browser. The modelled DOM still reads
        // such a handle as connected, so mirror the browser for the one read
        // the pass makes first. Everything else in the fixture is connected.
        target.dispose();
        vi.spyOn(DOM.source, 'isConnected').mockImplementation(handle => {
            if (!DOM.source.isRegistered(handle)) {
                throw new Error(`DOM handle ${handle} is not registered (released or never minted).`);
            }

            return true;
        });

        settled = true;

        const mark = writeMark();

        flushFrame();

        expect(failures).not.toHaveBeenCalled();
        expect(scrollWrites(mark)).toBe(0);
        expect(tops(outer, inner)).toEqual([0, 0]);
    });

    it('W10: a panel hidden while the scroll waited keeps its offsets, and the wait ends', () => {
        const { outer, inner, target } = nest();
        let settled = false;

        double(outer.getElement()!, { isRevealSettled: () => settled });
        inner.setScrollTop(77);

        FocusReveal.reveal(target.getElement()!);

        // What a `Tab` or a `Card` does to the page it turns away from. The
        // browser then reads 0 for the hidden panel's offsets.
        inner.setDisplayed(false);
        setRenderedVisible(inner.getElement()!, false);
        DOM.sink.apply(scroller(inner), { scrollTop: 0 });
        settled = true;

        const mark = writeMark();

        drainFrames();

        expect(scrollWrites(mark)).toBe(0);
        expect(inner.getScrollTop()).toBe(77);
        expect(outer.getScrollTop()).toBe(0);
        expect(frames).toHaveLength(0);
    });
});

describe('FocusReveal.reveal: a scroll that is waiting stands down', () => {
    /**
     * A 300 × 200 page holding a 40 × 30 control 900 px down and another one
     * 2500 px down, with an opener around the page that reports unsettled
     * until `settle()` is called. The reveal of the first control is waiting.
     *
     * @returns The page, the two controls' elements, and `settle`.
     */
    function waiting(): { outer: Panel; target: Handle; other: Handle; settle: () => void } {
        const outer  = root({ autoScroll: 'y' });
        const target = box(10, 900, 40, 30);
        const other  = box(10, 2500, 40, 30);
        let settled  = false;

        outer.addComponent(target);
        outer.addComponent(other);
        mount(outer, target, other);
        double(outer.getElement()!, { isRevealSettled: () => settled });

        expect(FocusReveal.reveal(target.getElement()!)).toBe(true);

        return { outer, target: target.getElement()!, other: other.getElement()!, settle: () => { settled = true; } };
    }

    it('W12: behind a modal layer that opened meanwhile, nothing scrolls', () => {
        const { outer, settle } = waiting();
        const modalElement = DOM.sink.createElement('div');

        setConnected(modalElement, true);

        const modal: DismissableLayer = {
            getLayerElement: () => modalElement,
            getDismissMode:  () => 'modal',
            requestClose:    () => {},
        };

        LayerManager.register(modal);

        const mark = writeMark();

        try {
            settle();
            drainFrames();

            expect(scrollWrites(mark)).toBe(0);
            expect(tops(outer)).toEqual([0]);
            expect(frames).toHaveLength(0);
        } finally {
            LayerManager.unregister(modal);
        }
    });

    it('W13: when focus was on the control and has moved to another one, nothing scrolls', () => {
        const { outer, target, other, settle } = waiting();

        DOM.sink.focus(target);
        flushFrame();

        // A click on another control: the browser focuses it and scrolls it
        // into view by itself.
        DOM.sink.focus(other);
        DOM.sink.apply(scroller(outer), { scrollTop: 2330 });
        flushFrame();

        settle();
        drainFrames();

        expect(DOM.source.getActiveElement()).toBe(other);
        expect(DOM.source.getScrollTop(scroller(outer))).toBe(2330);
    });

    it('W14: a reveal whose control never takes focus still scrolls', () => {
        const { outer, other, settle } = waiting();

        // Focus is somewhere else all along: the caller revealed the control
        // without focusing it.
        DOM.sink.focus(other);
        flushFrame();
        flushFrame();

        settle();
        drainFrames();

        // 930 − 200.
        expect(tops(outer)).toEqual([730]);
    });

    it('W15: a wheel on a panel the scroll would move withdraws it; a wheel elsewhere does not', () => {
        const { outer, target, settle } = waiting();
        const elsewhere = DOM.sink.createElement('div');

        setConnected(elsewhere, true);
        flushFrame();

        userInput(elsewhere, 'wheel');
        flushFrame();

        const mark = writeMark();

        // Still waiting: the wheel was over something the scroll would not move.
        userInput(target, 'wheel');
        settle();
        drainFrames();

        expect(scrollWrites(mark)).toBe(0);
        expect(tops(outer)).toEqual([0]);
    });

    it('W15b: with the wheel elsewhere only, the scroll still lands', () => {
        const { outer, settle } = waiting();
        const elsewhere = DOM.sink.createElement('div');

        setConnected(elsewhere, true);
        flushFrame();
        userInput(elsewhere, 'wheel');
        settle();
        drainFrames();

        expect(tops(outer)).toEqual([730]);
    });

    it('W16: a pointer press or a touch move on such a panel withdraws it', () => {
        for (const type of ['pointerdown', 'touchmove']) {
            const { outer, settle } = waiting();

            flushFrame();
            userInput(scroller(outer), type);
            settle();
            drainFrames();

            expect(tops(outer)).toEqual([0]);
        }
    });

    it('W17: a key that scrolls, pressed inside such a panel, withdraws it; another key does not', () => {
        // The four arrows, the two paging keys, Home, End, and the space
        // bar, which pages a panel down when nothing takes it.
        for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']) {
            const scrolling = waiting();

            flushFrame();
            userInput(scrolling.target, 'keydown', { key });
            scrolling.settle();
            drainFrames();

            expect(tops(scrolling.outer)).toEqual([0]);
        }

        // A letter scrolls nothing, and a key held with Ctrl, Alt or Meta is
        // a shortcut, not a scroll.
        for (const init of [{ key: 'a' }, { key: 'PageDown', ctrlKey: true }, { key: 'PageDown', altKey: true }, { key: 'PageDown', metaKey: true }]) {
            const other = waiting();

            flushFrame();
            userInput(other.target, 'keydown', init);
            other.settle();
            drainFrames();

            expect(tops(other.outer)).toEqual([730]);
        }
    });

    it('W17b: a scrolling key that a widget cancelled, or that a text field or a button takes, does not withdraw it', () => {
        const cancelled = waiting();

        flushFrame();

        const key = userInput(cancelled.target, 'keydown', { key: 'ArrowDown' });

        // A list or a slider handled the key and cancelled it.
        (key as unknown as { defaultPrevented: boolean }).defaultPrevented = true;
        cancelled.settle();
        drainFrames();

        expect(tops(cancelled.outer)).toEqual([730]);

        const typed = waiting();

        flushFrame();

        // The modelled DOM has no selector engine: say that the target is a
        // control that takes such keys, as a text field or a button is.
        const matches = vi.spyOn(DOM.source, 'matches').mockReturnValue(true);

        userInput(typed.target, 'keydown', { key: ' ' });
        userInput(typed.target, 'keydown', { key: 'ArrowLeft' });
        typed.settle();
        drainFrames();

        expect(tops(typed.outer)).toEqual([730]);

        // Every kind of control that takes such keys is named.
        const selector = matches.mock.calls[0][1].split(',').map(part => part.trim());

        expect(selector).toEqual(['input', 'textarea', 'select', 'button', 'a[href]', '[contenteditable]:not([contenteditable="false"])']);
    });

    it('W19: a pass that throws when it scrolls gives up the slot and its listeners', () => {
        const { outer, settle } = waiting();
        const failures = vi.spyOn(console, 'error').mockImplementation(() => {});
        const removed  = vi.spyOn(Event, 'removeViewportListener');
        const broken   = vi.spyOn(outer, 'revealRect').mockImplementation(() => {
            throw new Error('a revealer that throws');
        });

        flushFrame();
        settle();
        flushFrame();

        // The layout flush reports the throw and goes on.
        expect(broken).toHaveBeenCalledTimes(1);
        expect(failures).toHaveBeenCalledTimes(1);

        // The four input listeners are gone, and nothing is left queued.
        expect(removed.mock.calls.map(call => call[1]).sort()).toEqual(['keydown', 'pointerdown', 'touchmove', 'wheel']);
        expect(frames).toHaveLength(0);
    });

    it('W20: a revealSpan that has nothing to scroll around it leaves a waiting reveal in place', () => {
        const { outer, settle } = waiting();
        const page = root({ autoScroll: 'y' });
        const log  = child({ autoScroll: 'y' }, 0, 20, 100, 50);

        // Another page, whose content fits, holding a panel of its own.
        page.addComponent(log);
        mount(page, log);
        page.scheduleLayout();

        log.revealSpan('y', 400, 420);

        settle();
        drainFrames();

        expect(tops(page, log)).toEqual([0, 370]);
        expect(tops(outer)).toEqual([730]);
    });

    it('W13b: focus inside the revealed element counts as focus on it', () => {
        const outer = root({ autoScroll: 'y' });
        const group = box(10, 900, 100, 60);
        const other = box(10, 2500, 40, 30);
        const field = DOM.sink.createElement('div');
        let settled = false;

        outer.addComponent(group);
        outer.addComponent(other);
        mount(outer, group, other);
        DOM.sink.appendChild(group.getElement()!, field);
        setConnected(field, true);
        double(outer.getElement()!, { isRevealSettled: () => settled });

        // A group is revealed and a control inside it takes focus.
        FocusReveal.reveal(group.getElement()!);
        DOM.sink.focus(field);
        flushFrame();

        // Focus leaves the group: the scroll that was waiting is withdrawn.
        DOM.sink.focus(other.getElement()!);
        flushFrame();
        settled = true;
        drainFrames();

        expect(tops(outer)).toEqual([0]);
    });

    it('W13c: focus that was on the control at the call and has left by the first flush withdraws the scroll', () => {
        const outer  = root({ autoScroll: 'y' });
        const target = box(10, 900, 40, 30);
        const other  = box(10, 2500, 40, 30);
        let settled  = false;

        outer.addComponent(target);
        outer.addComponent(other);
        mount(outer, target, other);
        double(outer.getElement()!, { isRevealSettled: () => settled });

        // The control already holds focus when it is revealed.
        DOM.sink.focus(target.getElement()!);
        FocusReveal.reveal(target.getElement()!);

        // The user moves on before the first layout flush.
        DOM.sink.focus(other.getElement()!);
        flushFrame();
        settled = true;
        drainFrames();

        expect(tops(outer)).toEqual([0]);
    });

    it('W22: nothing scrolls for a control that an opener around it still hides when the wait is over', () => {
        const outer  = root({ autoScroll: 'y' });
        const target = box(10, 900, 40, 30);
        let settled  = false;

        outer.addComponent(target);
        mount(outer, target);

        // An opener whose open did not take, or that the user closed again
        // while it animated.
        double(outer.getElement()!, { isRevealSettled: () => settled, hidesDescendant: () => true });

        FocusReveal.reveal(target.getElement()!);
        settled = true;
        drainFrames();

        expect(tops(outer)).toEqual([0]);
    });

    it('W23: a reveal into a panel added in the same task scrolls after the first flush that finds no layout queued', () => {
        const outer  = root({ autoScroll: 'y' });
        const inner  = child({ autoScroll: 'y' }, 0, 900, 200, 100);
        const target = box(0, 700, 50, 20);

        mount(outer);

        // Added and revealed in one task, as a drawer or a lazily built page
        // does. The page's layout pass is queued, and laying the new panel
        // out queues one more, for its scrollbar.
        inner.addComponent(target);
        outer.addComponent(inner);
        setConnected(inner.getElement(true)!, true);
        setConnected(target.getElement(true)!, true);
        setScrollExtent(scroller(inner), { width: 200, height: 1500 });

        FocusReveal.reveal(target.getElement()!);

        const afterEachFlush: number[][] = [];

        for (let flush = 0; flush < 6 && frames.length > 0; flush++) {
            flushFrame();
            afterEachFlush.push(tops(outer, inner));
        }

        // Inner: 720 − 100. Page: 900 + 100 − 200. Not after the first
        // flush, which still found a layout queued, and bounded by the 60.
        expect(afterEachFlush).toEqual([[0, 0], [800, 620]]);
    });

    it('A1: afterReveal runs its callback at once when no scroll is waiting', () => {
        const outer  = root({ autoScroll: 'y' });
        const target = box(10, 900, 40, 30);
        const seen: number[] = [];

        outer.addComponent(target);
        mount(outer, target);

        FocusReveal.afterReveal(() => seen.push(-1));
        FocusReveal.reveal(target.getElement()!);
        FocusReveal.afterReveal(() => seen.push(outer.getScrollTop()));

        // The reveal scrolled inside the call: 930 − 200.
        expect(seen).toEqual([-1, 730]);
    });

    it('A2: afterReveal runs its callback once, when the waiting scroll has run', () => {
        const { outer, settle } = waiting();
        const seen: number[] = [];

        FocusReveal.afterReveal(() => seen.push(outer.getScrollTop()));
        flushFrame();

        expect(seen).toEqual([]);

        settle();
        drainFrames();
        drainFrames();

        expect(seen).toEqual([730]);
    });

    it('A3: afterReveal also runs its callback when the waiting scroll is withdrawn', () => {
        const { outer, other, settle } = waiting();
        const seen: string[] = [];

        FocusReveal.afterReveal(() => seen.push('first'));

        // A newer reveal withdraws the one that waits. Its own scroll waits
        // too, for the same opener.
        FocusReveal.reveal(other);
        FocusReveal.afterReveal(() => seen.push('second'));

        expect(seen).toEqual(['first']);
        expect(tops(outer)).toEqual([0]);

        settle();
        drainFrames();

        // 2530 − 200.
        expect(seen).toEqual(['first', 'second']);
        expect(tops(outer)).toEqual([2330]);
    });

    it('A4: a callback that asks for the next reveal leaves that reveal waiting in its place', () => {
        const outer  = root({ autoScroll: 'y' });
        const target = box(10, 900, 40, 30);
        const other  = box(10, 2500, 40, 30);
        const seen: string[] = [];
        let settled  = false;

        outer.addComponent(target);
        outer.addComponent(other);
        mount(outer, target, other);
        double(outer.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(target.getElement()!);
        FocusReveal.afterReveal(() => {
            seen.push('first');

            // The opener starts to move again, so the next reveal waits.
            settled = false;
            FocusReveal.reveal(other.getElement()!);
            FocusReveal.afterReveal(() => seen.push('second'));
        });

        settled = true;
        flushFrame();

        // 930 − 200.
        expect(seen).toEqual(['first']);
        expect(tops(outer)).toEqual([730]);

        settled = true;
        drainFrames();

        // 2530 − 200.
        expect(seen).toEqual(['first', 'second']);
        expect(tops(outer)).toEqual([2330]);
    });

    /**
     * A page with three inner panels, each holding one control far down, and
     * an opener around the page that is settled when the case says so.
     *
     * @returns The inner panels, the controls' elements, and the settle switch.
     */
    function threePanels(): { panels: Panel[]; a: Handle; b: Handle; c: Handle; settle: () => void } {
        const outer  = root({ autoScroll: 'y' });
        const panels = [300, 900, 1500].map(top => child({ autoScroll: 'y' }, 0, top, 250, 100));
        const boxes  = panels.map(() => box(10, 400, 40, 30));
        let settled  = false;

        panels.forEach((panel, index) => {
            panel.addComponent(boxes[index]);
            outer.addComponent(panel);
        });
        mount(outer, ...panels, ...boxes);
        double(outer.getElement()!, { isRevealSettled: () => settled });

        const [a, b, c] = boxes.map(control => control.getElement()!);

        return { panels, a, b, c, settle: () => { settled = true; } };
    }

    it('W5b: a newer reveal that scrolls inside the call withdraws the one that is still waiting', () => {
        const outer   = root({ autoScroll: 'y' });
        const first   = child({ autoScroll: 'y' }, 0, 900, 250, 100);
        const second  = child({ autoScroll: 'y' }, 0, 1500, 250, 100);
        const waits   = box(10, 400, 40, 30);
        const atOnce  = box(10, 400, 40, 30);
        const seen: string[] = [];
        let settled   = false;

        first.addComponent(waits);
        second.addComponent(atOnce);
        outer.addComponent(first);
        outer.addComponent(second);
        mount(outer, first, second, waits, atOnce);

        // Only the first panel sits in something that is still opening.
        double(first.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(waits.getElement()!);
        FocusReveal.afterReveal(() => seen.push('first over'));
        FocusReveal.reveal(atOnce.getElement()!);

        // 430 − 100, inside the call; and the earlier pass has been told.
        expect(second.getScrollTop()).toBe(330);
        expect(seen).toEqual(['first over']);

        settled = true;
        drainFrames();

        expect(first.getScrollTop()).toBe(0);
        expect(frames).toHaveLength(0);
    });

    it('A5: a callback that reveals, run because a newer reveal ended its pass, leaves one pass waiting and loses no callback', () => {
        const { panels, a, b, c, settle } = threePanels();
        const seen: string[] = [];

        FocusReveal.reveal(a);
        FocusReveal.afterReveal(() => {
            seen.push('a over');
            FocusReveal.reveal(b);
            FocusReveal.afterReveal(() => seen.push('b over'));
        });

        // The user's next move. It ends the pass of `a`, whose callback asks
        // for `b` from inside this call: `b` is then the latest reveal.
        FocusReveal.reveal(c);
        FocusReveal.afterReveal(() => seen.push('latest over'));

        expect(seen).toEqual(['a over']);

        settle();
        drainFrames();

        // One pass ran, for `b`: 430 − 100 in its panel. Nothing scrolled
        // for `a` or for `c`, and every callback ran once.
        expect(seen).toEqual(['a over', 'b over', 'latest over']);
        expect(panels.map(panel => panel.getScrollTop())).toEqual([0, 330, 0]);
        expect(frames).toHaveLength(0);
    });

    it('A6: a callback that throws is reported, and neither the reveal that ended its pass nor the next callback is lost', () => {
        const { panels, a, c, settle } = threePanels();
        const seen: string[] = [];
        const reported = vi.spyOn(console, 'error').mockImplementation(() => {});

        FocusReveal.reveal(a);
        FocusReveal.afterReveal(() => {
            throw new Error('a consumer callback');
        });
        FocusReveal.afterReveal(() => seen.push('second'));

        expect(FocusReveal.reveal(c)).toBe(true);

        expect(seen).toEqual(['second']);
        expect(reported).toHaveBeenCalledTimes(1);
        expect(reported.mock.calls[0][0]).toContain('afterReveal callback threw');

        settle();
        drainFrames();

        expect(panels.map(panel => panel.getScrollTop())).toEqual([0, 0, 330]);
    });

    it('A7: a reveal asked for by an opener while another reveal opens it is replaced by that reveal', () => {
        const outer    = root({ autoScroll: 'y' });
        const first    = child({ autoScroll: 'y' }, 0, 900, 250, 100);
        const second   = child({ autoScroll: 'y' }, 0, 1500, 250, 100);
        const inFirst  = box(10, 400, 40, 30);
        const inSecond = box(10, 400, 40, 30);
        const seen: string[] = [];
        let settled    = false;
        let nested     = false;

        first.addComponent(inFirst);
        second.addComponent(inSecond);
        outer.addComponent(first);
        outer.addComponent(second);
        mount(outer, first, second, inFirst, inSecond);

        // An opener around the page whose opening notifies a listener, and
        // the listener reveals another control, once.
        double(outer.getElement()!, {
            revealDescendant: () => {
                if (!nested) {
                    nested = true;
                    FocusReveal.reveal(inFirst.getElement()!);
                    FocusReveal.afterReveal(() => seen.push('nested over'));
                }
            },
        });

        // The first panel sits in something that is still opening, so the
        // nested reveal has to wait. The second panel does not.
        double(first.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(inSecond.getElement()!);

        // The outer reveal scrolled inside the call: 430 − 100. The nested
        // one was taken out before that, and has been told.
        expect(second.getScrollTop()).toBe(330);
        expect(seen).toEqual(['nested over']);

        settled = true;
        drainFrames();

        expect(first.getScrollTop()).toBe(0);
        expect(frames).toHaveLength(0);
    });

    it('A8: a pass that finds the slot taken when it parks takes the other pass out first', () => {
        const outer   = root({ autoScroll: 'y' });
        const first   = child({ autoScroll: 'y' }, 0, 900, 250, 100);
        const second  = child({ autoScroll: 'y' }, 0, 1500, 250, 100);
        const inFirst = box(10, 400, 40, 30);
        const inSecond = box(10, 400, 40, 30);
        const seen: string[] = [];
        let settled   = false;
        let asked     = false;

        first.addComponent(inFirst);
        second.addComponent(inSecond);
        outer.addComponent(first);
        outer.addComponent(second);
        mount(outer, first, second, inFirst, inSecond);

        // A revealer of a consumer's that asks for a reveal from inside the
        // question a pass puts to it before it parks.
        double(outer.getElement()!, {
            isRevealSettled: () => {
                if (!asked) {
                    asked = true;
                    FocusReveal.reveal(inFirst.getElement()!);
                    FocusReveal.afterReveal(() => seen.push('inner over'));
                }

                return settled;
            },
        });

        FocusReveal.reveal(inSecond.getElement()!);

        expect(seen).toEqual(['inner over']);

        settled = true;
        drainFrames();

        expect([first.getScrollTop(), second.getScrollTop()]).toEqual([0, 330]);
        expect(frames).toHaveLength(0);
    });

    it('W24: input that arrives after the control was disposed is ignored', () => {
        const outer  = root({ autoScroll: 'y' });
        const target = box(10, 900, 40, 30);
        let settled  = false;

        outer.addComponent(target);
        mount(outer, target);
        double(outer.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(target.getElement()!);
        flushFrame();

        // Disposed since the last flush. Every read of a released handle but
        // `isRegistered` throws in a browser; mirror that for the one read
        // the input test would make.
        target.dispose();
        vi.spyOn(DOM.source, 'contains').mockImplementation((_container, inner) => {
            const released = inner !== null && !DOM.source.isRegistered(inner);

            if (released) {
                throw new Error(`DOM handle ${inner} is not registered (released or never minted).`);
            }

            return true;
        });

        expect(() => userInput(outer.getElement()!, 'wheel')).not.toThrow();

        settled = true;
        drainFrames();

        expect(tops(outer)).toEqual([0]);
    });

    it('W18: input in the task that made the reveal does not count', () => {
        const { outer, target, settle } = waiting();

        // The key press that asked for the reveal is still on its way through
        // the page, and so is a wheel tick that came with it.
        userInput(target, 'keydown', { key: 'PageDown' });
        userInput(target, 'wheel');
        settle();
        drainFrames();

        expect(tops(outer)).toEqual([730]);
    });
});

describe('FocusReveal.revealRectAround measures only when a panel is about to move', () => {
    it('N1: a reveal along an axis that no panel around the component scrolls is not measured', () => {
        const outer = root({ autoScroll: 'y' });
        const inner = child({ autoScroll: 'auto' }, 0, 600, 250, 120);

        // The page scrolls up and down, and has somewhere to go.
        giveRange(outer, ROOT_WIDTH, 2000);
        outer.addComponent(inner);
        mount(outer, inner);

        const measure = vi.fn((_relaidOut: boolean) => rect(0, 600, 250, 630));

        FocusReveal.revealRectAround(inner, measure, 'x');

        expect(measure).not.toHaveBeenCalled();
        expect(tops(outer)).toEqual([0]);

        // Along the axis it scrolls, it is measured, and told that no layout
        // pass had to be run first. 630 − 200.
        FocusReveal.revealRectAround(inner, measure, 'y');

        expect(measure.mock.calls).toEqual([[false]]);
        expect(tops(outer)).toEqual([430]);
    });
});

describe('FocusReveal.revealRectAround through panels inside one another', () => {
    it('N2: for a component that has not rendered, nothing is asked and nothing is measured', () => {
        const outer   = root({ autoScroll: 'y' });
        const pending = box(10, 900, 40, 30);
        const measure = vi.fn(() => rect(10, 900, 50, 930));

        // Built and not rendered: neither has an element.
        built.push(outer);
        outer.addComponent(pending);

        const asked = vi.spyOn(outer, 'hasScrollRange');

        expect(pending.getElement()).toBeFalsy();

        FocusReveal.revealRectAround(pending, measure);

        expect(asked).not.toHaveBeenCalled();
        expect(measure).not.toHaveBeenCalled();
    });

    it('N5: a measure that returns null scrolls nothing', () => {
        const outer = root({ autoScroll: 'y' });
        const inner = child({ autoScroll: 'y' }, 0, 600, 250, 120);

        giveRange(outer, ROOT_WIDTH, 2000);
        outer.addComponent(inner);
        mount(outer, inner);

        const asked = vi.spyOn(outer, 'revealRect');

        // What a component answers when the row it was about to show is gone.
        expect(() => FocusReveal.revealRectAround(inner, () => null, 'y')).not.toThrow();

        expect(asked).not.toHaveBeenCalled();
        expect(tops(outer)).toEqual([0]);
    });

    it('N6: a scroller that cannot say whether it has a scroll range is taken to have one', () => {
        const outer   = root({ autoScroll: 'y' });
        const inner   = child({ autoScroll: 'y' }, 0, 600, 250, 120);
        const measure = vi.fn((_relaidOut: boolean) => rect(0, 600, 250, 630));

        // The page's content fits, so `Panel.hasScrollRange` answers `false`.
        outer.addComponent(inner);
        mount(outer, inner);

        FocusReveal.revealRectAround(inner, measure, 'y');

        expect(measure).not.toHaveBeenCalled();

        // A revealer of a consumer's that implements `revealRect` alone.
        (outer as unknown as { hasScrollRange: unknown }).hasScrollRange = undefined;

        FocusReveal.revealRectAround(inner, measure, 'y');

        expect(measure).toHaveBeenCalledTimes(1);
    });

    it('N3: the panels above the component scroll innermost first', () => {
        const outer  = root({ autoScroll: 'y' });
        const middle = child({ autoScroll: 'y' }, 0, 600, 250, 150);
        const inner  = child({ autoScroll: 'y' }, 0, 500, 200, 100);

        giveRange(outer, ROOT_WIDTH, 3000);
        giveRange(middle, 250, 2000);
        outer.addComponent(middle);
        middle.addComponent(inner);
        mount(outer, middle, inner);

        inner.revealSpan('y', 400, 430);

        // The span ends 430 px down the inner panel, which is 100 high: 330.
        // It is then at the inner panel's bottom edge, 600 down the middle
        // one, which is 150 high: 450. That edge is 750 down the page, which
        // is 200 high: 550. Outermost first, the page would go to 1000.
        expect(tops(outer, middle, inner)).toEqual([550, 450, 330]);
    });

    it('N4: an explicit revealSpan behind a modal layer is carried out as asked', () => {
        const outer = root({ autoScroll: 'y' });
        const inner = child({ autoScroll: 'y' }, 0, 600, 250, 120);
        const modalElement = DOM.sink.createElement('div');

        giveRange(outer, ROOT_WIDTH, 2000);
        outer.addComponent(inner);
        mount(outer, inner);
        setConnected(modalElement, true);

        const modal: DismissableLayer = {
            getLayerElement: () => modalElement,
            getDismissMode:  () => 'modal',
            requestClose:    () => {},
        };

        LayerManager.register(modal);

        try {
            // No key reaches a component behind a modal layer, so this path
            // has no modal test: a call from code says what it wants.
            inner.revealSpan('y', 500, 530);

            expect(tops(outer, inner)).toEqual([520, 410]);
        } finally {
            LayerManager.unregister(modal);
        }
    });
});

describe('FocusReveal: a revealer that is detached for a while stays registered', () => {
    // The public `FocusReveal.containing` drops, for good, a revealer whose
    // element is rendered and not connected. A closed `Drawer`, a hidden
    // `Popover` and a removed view are in exactly that state until they are
    // shown again, and nothing registers their panels a second time. So the
    // two callers this plan adds, which run far more often than a reveal
    // does, must walk the registry without dropping anything.

    /**
     * A second mounted page beside the fixture's: a 300 × 200 scrolling panel
     * holding a 40 × 30 control 500 px down.
     *
     * @returns The page and its control.
     */
    function sidePage(): { side: Panel; control: Component } {
        const side    = root({ autoScroll: 'y' });
        const control = box(10, 500, 40, 30);

        side.addComponent(control);
        mount(side, control);

        return { side, control };
    }

    /**
     * The default fixture, with the library's default scrollbar style.
     *
     * @returns The two panels and the control, mounted.
     */
    function nest(): { outer: Panel; inner: Panel; target: Component } {
        const outer  = root({ autoScroll: 'y' });
        const inner  = child({ autoScroll: 'y' }, 0, 600, 250, 120);
        const target = box(10, 500, 40, 30);

        inner.addComponent(target);
        outer.addComponent(inner);
        mount(outer, inner, target);

        return { outer, inner, target };
    }

    it('D1: a row reveal elsewhere does not drop a detached panel from the registry', () => {
        const { side, control } = sidePage();
        const outer = root({ autoScroll: 'y' });
        const inner = child({ autoScroll: 'y' }, 0, 600, 250, 120);

        giveRange(outer, ROOT_WIDTH, 2000);
        outer.addComponent(inner);
        mount(outer, inner);

        // What closing a `Drawer` does to its content: the element leaves the
        // document and the component keeps it.
        setConnected(side.getElement()!, false);
        setConnected(control.getElement()!, false);

        inner.revealSpan('y', 500, 530);

        expect(tops(outer, inner)).toEqual([520, 410]);

        // Shown again. The page still answers a reveal: 530 − 200.
        setConnected(side.getElement()!, true);
        setConnected(control.getElement()!, true);

        expect(FocusReveal.reveal(control.getElement()!)).toBe(true);
        expect(tops(side)).toEqual([330]);
    });

    it('D2: a scroll pass that is waiting does not drop a detached panel from the registry', () => {
        const { side, control }        = sidePage();
        const { outer, inner, target } = nest();
        let settled = false;

        double(outer.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(target.getElement()!);

        // Detached while the pass waits, and walked past on two flushes.
        setConnected(side.getElement()!, false);
        setConnected(control.getElement()!, false);
        flushFrame();
        settled = true;
        flushFrame();

        expect(tops(outer, inner)).toEqual([520, 410]);

        setConnected(side.getElement()!, true);
        setConnected(control.getElement()!, true);

        expect(FocusReveal.reveal(control.getElement()!)).toBe(true);
        expect(tops(side)).toEqual([330]);
    });

    it('D3: input during a waiting scroll pass does not drop a detached panel from the registry', () => {
        const { side, control }        = sidePage();
        const { outer, inner, target } = nest();
        const elsewhere = DOM.sink.createElement('div');
        let settled = false;

        setConnected(elsewhere, true);
        double(outer.getElement()!, { isRevealSettled: () => settled });

        FocusReveal.reveal(target.getElement()!);

        // Input is watched from the first flush on.
        flushFrame();
        setConnected(side.getElement()!, false);
        setConnected(control.getElement()!, false);

        // Each watched event asks which panels the pass would scroll.
        userInput(elsewhere, 'wheel');
        userInput(elsewhere, 'keydown', { key: 'PageDown' });

        settled = true;
        flushFrame();

        expect(tops(outer, inner)).toEqual([520, 410]);

        setConnected(side.getElement()!, true);
        setConnected(control.getElement()!, true);

        expect(FocusReveal.reveal(control.getElement()!)).toBe(true);
        expect(tops(side)).toEqual([330]);
    });
});

describe('FocusHistory walks back through nested panels', () => {
    /**
     * Models a user moving real focus to `handle`: makes it the active
     * element and dispatches the `focusin` a browser fires for the move.
     *
     * @param handle - The element taking focus.
     */
    function focusIn(handle: Handle): void {
        DOM.sink.focus(handle);
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(handle, 'focusin'));
    }

    /**
     * The default fixture with a second control at the top of the page, and a
     * trail of two stops: the nested control, then the one at the top.
     *
     * @returns The two panels and the two controls' elements.
     */
    function trail(): { outer: Panel; inner: Panel; deep: Handle; top: Handle } {
        const outer  = root({ autoScroll: 'y' });
        const inner  = child({ autoScroll: 'y' }, 0, 600, 250, 120);
        const target = box(10, 500, 40, 30);
        const first  = box(10, 0, 40, 30);

        inner.addComponent(target);
        outer.addComponent(inner);
        outer.addComponent(first);
        mount(outer, inner, target, first);

        FocusHistory.enable();
        focusIn(target.getElement()!);
        focusIn(first.getElement()!);

        return { outer, inner, deep: target.getElement()!, top: first.getElement()! };
    }

    afterEach(() => {
        FocusHistory.disable();
        FocusHistory.clear();
    });

    it('H1: back() focuses the stop and scrolls both panels to it in one step', () => {
        const { outer, inner, deep } = trail();

        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(deep);
        expect(tops(outer, inner)).toEqual([520, 410]);
    });

    it('H2: back() focuses at once when the scroll has to wait for a layout pass', () => {
        const { outer, inner, deep } = trail();

        inner.scheduleLayout();

        const mark = writeMark();

        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(deep);
        expect(scrollWrites(mark)).toBe(0);

        flushFrame();

        expect(tops(outer, inner)).toEqual([520, 410]);
    });

    it('H3: back() under a modal layer moves nothing and leaves no scroll waiting', () => {
        const { outer, inner, top } = trail();
        const modalElement = DOM.sink.createElement('div');

        setConnected(modalElement, true);

        const modal: DismissableLayer = {
            getLayerElement: () => modalElement,
            getDismissMode:  () => 'modal',
            requestClose:    () => {},
        };

        LayerManager.register(modal);
        inner.scheduleLayout();

        const mark = writeMark();

        try {
            expect(FocusHistory.back()).toBe(false);
            expect(DOM.source.getActiveElement()).toBe(top);

            drainFrames();

            expect(scrollWrites(mark)).toBe(0);
            expect(tops(outer, inner)).toEqual([0, 0]);
        } finally {
            LayerManager.unregister(modal);
        }
    });
});
