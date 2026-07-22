// Teardown and re-entrancy coverage for the two layout managers that drive
// CSS transitions through Animation's fallback-timer helpers.
//
// Both cases here are ones where "cancel the outgoing handle" is NOT simply
// correct, and getting them wrong is silent: the completion callback these
// helpers run is the only trigger for cleanup that has no other owner — the
// Accordion's toggle counter, and the collapse's transition / will-change
// clearing. A cancel that suppresses that cleanup leaves the manager wedged
// rather than throwing, so it is pinned here.
//
// transitionend never fires offline, so every completion below is reached
// through the fallback timer, driven with vi.useFakeTimers().
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Accordion } from '~/layout/Accordion';
import { Split } from '~/layout/Split';
import { Border } from '~/layout/Border';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Placement } from '~/primitive/Placement';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import type { RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Accordion's default animation duration; its fallback lands 40 ms later. */
const ACCORDION_DURATION_MS = 200;

/** Past any fallback either manager arms (both are duration + 40). */
const PAST_FALLBACK_MS = 1000;

describe('collapse-animation teardown', () => {
    let sink: RecordingDOMSink;

    afterEach(() => {
        vi.useRealTimers();
        DOM.reset();
    });

    function install(): void {
        sink = installTestDOM(CONFIG);
        vi.useFakeTimers();
    }

    /** A host driven by `manager`, sized and with insets cleared. */
    function host(manager: Accordion | Split | Border, children: number): Container {
        const container = new Container({ layoutManager: manager });

        container.getElement(true);
        container.setWidth(400);
        container.setHeight(300);
        container.clearInsets();

        for (let i = 0; i < children; i += 1) {
            const child = new Component({ preferredSize: { width: 50, height: 50 } });

            child.getElement(true);
            if (manager instanceof Accordion) {
                container.addComponent(child, new AccordionConstraints(`S${i}`));
            } else {
                container.addComponent(child);
            }
        }

        // Sections / panes are built by the layout pass, not by addComponent.
        container.doLayout();

        return container;
    }

    /** The panel wrappers Accordion installs its height transition on. */
    function wrappers(accordion: Accordion): Component[] {
        return (accordion as unknown as { _panelWrappers: Component[] })._panelWrappers;
    }

    describe('Accordion', () => {
        it('turns section transitions back off after a section is re-toggled mid-animation', () => {
            install();

            const accordion = new Accordion();
            const container = host(accordion, 2);

            accordion.openSection(0);

            // Re-toggle the SAME section before its animation completes. The
            // replacement animation inherits the outgoing one's slot in the
            // toggle counter; counting it twice would strand the counter above
            // zero and make the cleanup below unreachable forever.
            vi.advanceTimersByTime(ACCORDION_DURATION_MS / 2);
            accordion.closeSection(0);

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            // The counter reached zero, so the animated transitions were torn
            // back down — the observable end of the toggle lifecycle.
            expect(wrappers(accordion).map(w => w.getTransition())).toEqual(['none', 'none']);

            container.dispose();
        });

        it('leaves transitions off when detached mid-toggle', () => {
            install();

            const accordion = new Accordion();
            const container = host(accordion, 2);

            accordion.openSection(0);

            const primed = wrappers(accordion);

            expect(primed.some(w => w.getTransition() !== 'none')).toBe(true);

            // Detach with the toggle still in flight: the cancelled animations
            // owned the cleanup, so detach has to run it instead.
            accordion.detach();

            expect(primed.map(w => w.getTransition())).toEqual(['none', 'none']);

            container.dispose();
        });

        it('arms no fallback that survives detach', () => {
            install();

            const accordion = new Accordion();
            const container = host(accordion, 2);

            accordion.openSection(0);
            accordion.detach();

            const mark = sink.writes.length;

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(sink.writes.slice(mark).filter(entry => entry.op === 'apply')).toEqual([]);

            container.dispose();
        });
    });

    describe('Split', () => {
        it('still clears the first pane\'s transition when a different pane is toggled', () => {
            install();

            const split = new Split({ orientation: 'horizontal' });
            const container = host(split, 3);
            const panes = container.getComponents();

            split.setPaneCollapsed(0, true);

            // A re-toggle stops the geometry animation but must leave the first
            // toggle's primed CSS transitions alone: their completion callback
            // is the only thing that clears `transition` and `will-change` on
            // the participants the new toggle does not touch.
            vi.advanceTimersByTime(50);
            split.setPaneCollapsed(2, true);

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(panes[0].getTransition()).toBeNull();
            expect(panes[0].getWillChange()).toBeNull();

            container.dispose();
        });

        it('clears the primed transitions when the manager is swapped out mid-collapse', () => {
            install();

            const split = new Split({ orientation: 'horizontal' });
            const container = host(split, 3);
            const panes = container.getComponents();

            split.setPaneCollapsed(0, true);

            expect(panes.some(p => p.getTransition() !== null)).toBe(true);

            // A manager swap leaves the panes mounted, so detach must settle the
            // primed transitions rather than abandon them — otherwise each keeps
            // a live transition and a permanent compositor layer.
            split.detach();

            expect(panes.map(p => p.getTransition())).toEqual([null, null, null]);
            expect(panes.map(p => p.getWillChange())).toEqual([null, null, null]);

            container.dispose();
        });

        it('arms no fallback that survives detach', () => {
            install();

            const split = new Split({ orientation: 'horizontal' });
            const container = host(split, 2);

            split.setPaneCollapsed(0, true);
            split.detach();

            const mark = sink.writes.length;

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(sink.writes.slice(mark).filter(entry => entry.op === 'apply')).toEqual([]);

            container.dispose();
        });

        it('abandons the primed transitions without touching a pane when disposed mid-collapse', () => {
            install();

            const split = new Split({ orientation: 'horizontal' });
            const container = host(split, 3);

            split.setPaneCollapsed(0, true);

            const mark = sink.writes.length;

            // dispose() destroys the children first and only then detaches the
            // manager, so `detach` finds an empty container: the participants'
            // handles are already released and settling them would write
            // through a released handle. It must abandon them silently.
            container.dispose();

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            const paneWrites = sink.writes
                .slice(mark)
                .filter(entry => entry.op === 'apply')
                .map(entry => (entry.args[1] as { style?: Record<string, string | null> }).style)
                .filter((style): style is Record<string, string | null> => style !== undefined)
                .filter(style => 'transition' in style || 'willChange' in style);

            expect(paneWrites).toEqual([]);
        });
    });

    describe('Border', () => {
        /** A Border host with one collapsible west region plus a centre. */
        function borderHost(border: Border): Container {
            const container = new Container({ layoutManager: border });

            container.getElement(true);
            container.setWidth(400);
            container.setHeight(300);
            container.clearInsets();

            for (const placement of [Placement.WEST, Placement.CENTER]) {
                const child = new Component({ preferredSize: { width: 80, height: 80 } });

                child.getElement(true);
                container.addComponent(child, Object.assign(new LayoutConstraints(), {
                    placement,
                    collapsible: placement === Placement.WEST,
                }));
            }

            container.doLayout();

            return container;
        }

        it('clears the collapsing flag when the manager is swapped out mid-collapse', () => {
            install();

            const border = new Border();
            const container = borderHost(border);

            border.setRegionCollapsed(Placement.WEST, true);
            border.detach();

            // The cancelled geometry animation's onIdle is the only place this
            // is reset; left set, every region of a re-attached Border takes the
            // unframed branch forever.
            expect((border as unknown as { _collapsing: boolean })._collapsing).toBe(false);

            container.dispose();
        });

        it('arms no fallback that survives detach', () => {
            install();

            const border = new Border();
            const container = borderHost(border);

            border.setRegionCollapsed(Placement.WEST, true);
            border.detach();

            const mark = sink.writes.length;

            vi.advanceTimersByTime(PAST_FALLBACK_MS);

            expect(sink.writes.slice(mark).filter(entry => entry.op === 'apply')).toEqual([]);

            container.dispose();
        });
    });
});
