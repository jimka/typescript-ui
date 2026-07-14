// Pins that a runtime `setTransition` reaches the element's rendered inline
// style, not just the cached field / CSS rule. `init`/`applyStyle` replays the
// cached transition as inline style, and inline beats an `#id` rule — so a
// transition declared at construction (replayed inline) would otherwise shadow
// every later `setTransition` (which wrote the rule). Regression guard for the
// Accordion toggle-animation snap that surfaced it.
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
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

afterEach(() => DOM.reset());

/** Collects every inline `transition` value written to an element via the sink. */
function inlineTransitionWrites(sink: { writes: Array<{ op: string; args: unknown[] }> }): Array<string | null> {
    return sink.writes
        .filter(w => w.op === 'apply')
        .map(w => (w.args[1] as { style?: Record<string, string | null> }).style?.transition)
        .filter((v): v is string | null => v !== undefined);
}

describe('Component.setTransition — runtime changes reach the rendered element', () => {
    it('a runtime setTransition after a construction-time transition writes the new value inline', () => {
        const sink = installTestDOM(CONFIG);
        const c = new Component({ transition: 'height 100ms ease' });
        c.getElement(true); // materialise + render (replays the construction transition inline)

        c.setTransition('opacity 200ms linear'); // runtime change — must reach the render path

        expect(inlineTransitionWrites(sink)).toContain('opacity 200ms linear');
        expect(c.getTransition()).toBe('opacity 200ms linear');
    });

    it('clearTransition removes the inline transition at runtime', () => {
        const sink = installTestDOM(CONFIG);
        const c = new Component({ transition: 'height 100ms ease' });
        c.getElement(true);

        c.clearTransition();

        expect(inlineTransitionWrites(sink)).toContain(null);
        expect(c.getTransition()).toBeNull();
    });
});
