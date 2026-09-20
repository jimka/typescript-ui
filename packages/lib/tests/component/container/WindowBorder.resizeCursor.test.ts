// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Regression coverage: the layered-style-bag migration (commit cbb6fcf0)
// moved `setCursor` onto `writeStyle`, which only flushes immediately when
// `getElement()` already resolves. `WindowBorder.render()` used to call
// `setCursor` *after* `super.render()` — at that point the element has no
// live-DOM id match yet (a real `document.getElementById` needs a connected
// document) and `_element` isn't cached either (the outer `getElement(true)`
// caller only assigns it once `render()` returns), so the write silently
// deferred and, since nothing ever ran a second `applyStyle()` pass for the
// border, was dropped for good — the resize cursor never reached the
// stylesheet. Confirmed live in a real browser (no `#id` cursor rule, and
// `getComputedStyle(border).cursor === "default"` on every window edge).
//
// NOTE: this cannot be pinned red-before-fix with the offline harness —
// `ModelledDOMSource.getElementById` (TestDOM.ts) resolves through a flat
// `_byId` table indexed unconditionally by `setId`, with no notion of
// document connectivity, so the reentrant `getElement()` call this bug hinges
// on always "succeeds" offline even though it fails in a real, unattached
// DOM. The tests below pin the correct end state as an ongoing regression
// guard post-fix; the bug itself was root-caused and verified via a live
// browser (see debug skill's describe-then-verify escape hatch). See
// idSelector/ruleStyleWrites conventions in
// WindowBorder.classStateHoisting.test.ts / Component.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { WindowBorder, Direction } from '~/component/container/WindowBorder';
import { DOM } from '~/core/DOM';
import { installTestDOM, ruleStyleWrites, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

describe('WindowBorder resize cursor', () => {
    afterEach(() => DOM.reset());

    it('writes its direction-appropriate resize cursor to its own #id rule on first render', () => {
        const sink = installTestDOM(CONFIG);

        const border = new WindowBorder(Direction.NORTHWEST);
        border.getElement(true);

        const rows = ruleStyleWrites(sink as RecordingDOMSink)
            .filter((w) => w.selector === idSelector(border) && w.key === 'cursor');

        expect(rows.some((w) => w.value === 'nwse-resize')).toBe(true);
    });

    it('getCursor() also reports the resolved value (sanity check alongside the DOM write)', () => {
        installTestDOM(CONFIG);

        const border = new WindowBorder(Direction.EAST);
        border.getElement(true);

        expect(border.getCursor()).toBe('ew-resize');
    });

    // The constructor used to guard its assignment with `if (direction)`, which
    // reads an explicit `Direction.NORTH` — enum value `0` — as "not supplied".
    // The guard was compensating for a field initializer that already held
    // `Direction.NORTH`, so the falsy case resolved to the same value and the
    // bug was latent: like the cursor case above, it cannot be pinned red
    // before its fix. Removing both the guard and the initializer leaves the
    // constructor argument as the field's only writer, and this case is the
    // guard that the round-trip and the cursor it drives survive that removal
    // for every member — including the `0`-valued one whose correctness was
    // previously an accident.
    it.each([
        [Direction.NORTH,     'ns-resize'],
        [Direction.SOUTH,     'ns-resize'],
        [Direction.WEST,      'ew-resize'],
        [Direction.EAST,      'ew-resize'],
        [Direction.NORTHWEST, 'nwse-resize'],
        [Direction.SOUTHEAST, 'nwse-resize'],
        [Direction.SOUTHWEST, 'nesw-resize'],
        [Direction.NORTHEAST, 'nesw-resize'],
    ])('round-trips Direction %i and resolves its cursor to %s', (direction, cursor) => {
        installTestDOM(CONFIG);

        const border = new WindowBorder(direction);
        border.getElement(true);

        expect(border.getDirection()).toBe(direction);
        expect(border.getCursor()).toBe(cursor);
    });
});
