//
// SortPriorityBadge visibility-predicate coverage. The badge mints a child
// element through DOM.sink at construction, so the offline DOM harness is
// installed. Visibility is asserted via the tri-state isVisible(); the badge
// always writes a concrete boolean through setVisible, so isVisible() returns
// true/false (never the inherit-null) after construction or setPriority.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { SortPriorityBadge } from '~/component/table/cell/SortPriorityBadge';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('SortPriorityBadge visibility predicate (value != null && value >= 2)', () => {
    it('a fresh badge has null priority and is hidden', () => {
        const badge = new SortPriorityBadge();

        expect(badge.getPriority()).toBe(null);
        expect(badge.isVisible()).toBe(false);
    });

    it('priority null / 0 / 1 keep the badge hidden', () => {
        // CONTRACT (JSDoc): "stays hidden for priority null, 0, and 1 — the
        // leading sort needs no number".
        const badge = new SortPriorityBadge();

        badge.setPriority(null);
        expect(badge.isVisible()).toBe(false);

        badge.setPriority(0);
        expect(badge.isVisible()).toBe(false);

        badge.setPriority(1);
        expect(badge.isVisible()).toBe(false);
    });

    it('priority 2 and above make the badge visible', () => {
        const badge = new SortPriorityBadge();

        badge.setPriority(2);
        expect(badge.isVisible()).toBe(true);
        expect(badge.getPriority()).toBe(2);

        badge.setPriority(5);
        expect(badge.isVisible()).toBe(true);
        expect(badge.getPriority()).toBe(5);
    });

    it('clearPriority hides the badge and clears the value', () => {
        const badge = new SortPriorityBadge();

        badge.setPriority(3);
        expect(badge.isVisible()).toBe(true);

        badge.clearPriority();
        expect(badge.getPriority()).toBe(null);
        expect(badge.isVisible()).toBe(false);
    });

    it('the priority constructor option is honoured immediately', () => {
        expect(new SortPriorityBadge({ priority: 3 }).isVisible()).toBe(true);
        expect(new SortPriorityBadge({ priority: 1 }).isVisible()).toBe(false);
    });

    it('setPriority round-trips through getPriority', () => {
        const badge = new SortPriorityBadge();

        badge.setPriority(5);
        expect(badge.getPriority()).toBe(5);
    });
});
