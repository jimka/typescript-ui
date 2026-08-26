// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/text-width-value-class-dedup.md: ListItemMarkerText's
// shared marker-column minimum now routes through Component.setValueStyleState
// (a per-class, per-value `.ListItemMarkerText.minsz<w>x<h>` rule) instead of
// each marker writing its own `min-width`/`min-height` to its own `#id` rule.
// A list of N items previously produced N byte-identical `#id` declarations —
// see the plan's Overview for the Style Audit finding this fixes.
//
// CONFIG/idSelector copied verbatim from
// AbstractMarkerList.classStyleDefaults.test.ts, per the plan's Ordered
// Implementation Steps (declarationsDuring is adapted rather than copied
// verbatim — see declarationsIn below). Rows 1-6 of the plan's Expected
// Behaviour table are covered here; rows 7-8 need a live browser (see the
// plan's Verification section).
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import type { Component } from '~/core/Component';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { _NumberedList } from '~/component/list/NumberedList';
import { _ListItem } from '~/component/list/ListItem';

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

/**
 * Declarations written to `selector`'s stylesheet rule anywhere in `writes`,
 * flattened into one key/value map. Adapted from the `declarationsDuring`
 * helper in `AbstractMarkerList.classStyleDefaults.test.ts` to scan an
 * already-captured write log rather than drive one `fn()` call itself —
 * needed to check several markers' `#id` rules from a single shared
 * build+layout pass.
 */
function declarationsIn(
    writes: RecordingDOMSink['writes'],
    selector: string,
): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const w of writes) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
            continue;
        }

        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[key] = styles[key];
        }
    }

    return out;
}

/** The `addClass`/`removeClass` patches an `apply` write to `handle` carries. */
function classToggleWritesFor(
    writes: RecordingDOMSink['writes'],
    handle: number,
): Array<{ removeClass?: string[]; addClass?: string[] }> {
    return writes
        .filter((w) => w.op === 'apply' && w.args[0] === handle)
        .map((w) => w.args[1] as { removeClass?: string[]; addClass?: string[] })
        .filter((patch) => patch.addClass !== undefined || patch.removeClass !== undefined);
}

/** The value-class token a marker sharing column width `w` should carry —
 *  mirrors `setValueStyleState`'s own sanitizer. */
function markerToken(w: number): string {
    return 'minsz' + String(w).replace(/[^a-zA-Z0-9]/g, '_') + 'x0';
}

/** Hosts a NumberedList with one item per label, sized so doLayout resolves geometry. */
function hostList(labels: string[]): _NumberedList {
    const list = new _NumberedList();
    list.getElement(true);

    for (const label of labels) {
        list.addComponent(new _ListItem(label.toLowerCase(), label));
    }

    list.setWidth(300);
    list.setHeight(400);

    return list;
}

/** An item's marker component — position 0 among its children.
 *  `ListItemMarkerText` is module-private and cannot be imported directly. */
function markerOf(item: _ListItem): Component {
    return (item.getComponents() as Component[])[0];
}

describe('ListItemMarkerText minSize value-class dedup', () => {
    afterEach(() => DOM.reset());

    // Row 1.
    it('shares one .ListItemMarkerText.minsz<W>x0 rule and writes no real minWidth/minHeight to any marker #id rule', () => {
        const sink = installTestDOM(CONFIG);
        const list = hostList(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']);

        list.doLayout();

        const W = list.getMarkerColumnWidth();
        expect(W).toBeGreaterThan(0);

        for (const item of list.getComponents() as _ListItem[]) {
            const decl = declarationsIn(sink.writes, idSelector(markerOf(item)));
            expect(decl.minWidth).toBeFalsy();
            expect(decl.minHeight).toBeFalsy();
        }

        expect(_ruleCacheHas('.ListItemMarkerText.' + markerToken(W))).toBe(true);
    });

    // Row 2.
    it('every marker carries the identical minsz<W>x0 DOM class token', () => {
        const sink = installTestDOM(CONFIG);
        const list = hostList(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']);

        list.doLayout();

        const token = markerToken(list.getMarkerColumnWidth());

        for (const item of list.getComponents() as _ListItem[]) {
            const marker  = markerOf(item);
            const handle  = marker.getElement(true);
            const applied = classToggleWritesFor(sink.writes, handle).flatMap((t) => t.addClass ?? []);
            expect(applied).toContain(token);
        }
    });

    // Row 3.
    it('swaps the value-class token in one apply write when the column width changes on a rendered marker', () => {
        const sink   = installTestDOM(CONFIG);
        const item   = new _ListItem('a', 'Alpha');
        const marker = markerOf(item);
        marker.getElement(true);

        item.setMarkerColumnWidth(12);

        const start = sink.writes.length;
        item.setMarkerColumnWidth(14);
        const writes = sink.writes.slice(start);

        const handle  = marker.getElement(true);
        const toggles = classToggleWritesFor(writes, handle);
        expect(toggles).toEqual([{ removeClass: ['minsz12x0'], addClass: ['minsz14x0'] }]);

        expect(_ruleCacheHas('.ListItemMarkerText.minsz12x0')).toBe(true);
        expect(_ruleCacheHas('.ListItemMarkerText.minsz14x0')).toBe(true);

        const decl = declarationsIn(sink.writes, idSelector(marker));
        expect(decl.minWidth).toBeFalsy();
        expect(decl.minHeight).toBeFalsy();
    });

    // Row 4.
    it('adds no class before render, then applies it via the render() override', () => {
        const sink   = installTestDOM(CONFIG);
        const item   = new _ListItem('a', 'Alpha');
        const marker = markerOf(item);

        expect(marker.getElement()).toBeFalsy();

        const start1 = sink.writes.length;
        item.setMarkerColumnWidth(12);
        expect(sink.writes.slice(start1).some((w) => w.op === 'apply')).toBe(false);

        const start2 = sink.writes.length;
        const handle = marker.getElement(true);
        const applied = classToggleWritesFor(sink.writes.slice(start2), handle).flatMap((t) => t.addClass ?? []);
        expect(applied).toContain('minsz12x0');
    });

    // Row 5.
    it('keeps size getters resolving the constraint from the instance layer', () => {
        installTestDOM(CONFIG);
        const item   = new _ListItem('a', 'Alpha');
        const marker = markerOf(item);

        item.setMarkerColumnWidth(12);

        expect(marker.getMinSizeConstraint()).toEqual({ width: 12, height: 0 });
        expect(marker.getMinSize()).toEqual({ width: 12, height: 0 });
    });

    // Row 6.
    it('two lists whose widest markers measure the same width share one rule; no second rule is created', () => {
        const sink  = installTestDOM(CONFIG);
        const listA = hostList(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']);
        listA.doLayout();

        const W        = listA.getMarkerColumnWidth();
        const selector = '.ListItemMarkerText.' + markerToken(W);
        expect(_ruleCacheHas(selector)).toBe(true);

        const start = sink.writes.length;
        const listB = hostList(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']);
        listB.doLayout();
        const writes = sink.writes.slice(start);

        expect(listB.getMarkerColumnWidth()).toBe(W);
        // The rule already exists from listA — a second, identical-value
        // caller must never re-materialise it (ensureClassStateRule's
        // first-caller-wins cache).
        expect(writes.some((w) => w.op === 'setRuleStyles' && w.args[0] === selector)).toBe(false);
    });
});
