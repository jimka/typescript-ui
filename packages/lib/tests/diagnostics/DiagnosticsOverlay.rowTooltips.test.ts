// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for the per-row hover explanations added to DiagnosticsOverlay
// (plans/implemented/diagnostics-overlay-row-explanations.md's `## Expected
// Behaviour` cases 8-10). Reuses DiagnosticsOverlay.test.ts's `CONFIG`,
// `currentInstance()` helper and `afterEach` teardown, plus the
// `(Tooltip as any).attachments` escape hatch from
// SplitGutter.tooltip.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiagnosticsOverlay } from '~/diagnostics/DiagnosticsOverlay';
import { Component } from '~/core/Component';
import { Diagnostics } from '~/core/Diagnostics';
import { Tooltip } from '~/overlay/Tooltip';
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

/** Reaches the private static instance slot, for teardown and identity checks. */
function currentInstance(): DiagnosticsOverlay | null {
    return (DiagnosticsOverlay as unknown as { instance: DiagnosticsOverlay | null }).instance;
}

/**
 * Recursively collects a component and every registered descendant,
 * adapted from DiagnosticsOverlay.test.ts's `collectIds` (which returns ids
 * rather than the components themselves).
 */
function collectComponents(c: Component): Component[] {
    const all = [c];

    for (const child of c.getComponents()) {
        all.push(...collectComponents(child));
    }

    return all;
}

function hasTooltip(id: string): boolean {
    return (Tooltip as any).attachments.has(id);
}

function tooltipText(id: string): string | undefined {
    return (Tooltip as any).attachments.get(id)?.text;
}

beforeEach(() => {
    installTestDOM(CONFIG);
    Diagnostics._reset();
});

afterEach(() => {
    currentInstance()?.dispose();
    DOM.reset();

    const timer = (Tooltip as any).showTimer;

    if (timer !== null) {
        clearTimeout(timer);
        (Tooltip as any).showTimer = null;
    }

    (Tooltip as any).instance = null;
    (Tooltip as any).watching = false;
    (Tooltip as any).activeElement = null;
});

describe('DiagnosticsOverlay row description tooltips', () => {
    it("8. every metric row's label and value carry a non-empty tooltip", () => {
        DiagnosticsOverlay.open();

        const instance = currentInstance()!;
        const allComponents = collectComponents(instance);

        // Metric rows pair a label Text with a value Text; the two Header rows
        // (Browser/Framework) are full-width and carry no description, so this
        // walks every component and asserts only on the ones a tooltip is
        // attached to — enumerating twelve label/value pairs precisely is
        // exactly what case 10 does for the Header exclusion instead.
        const withTooltip = allComponents.filter((c) => hasTooltip(c.getId()));

        // Twelve metric rows × 2 targets (label + value) = 24 attachments.
        expect(withTooltip.length).toBe(24);

        for (const c of withTooltip) {
            expect(tooltipText(c.getId())).toBeTruthy();
        }
    });

    it('9. dispose() detaches every attachment the overlay installed', () => {
        DiagnosticsOverlay.open();

        const instance = currentInstance()!;
        const ids = collectComponents(instance).map((c) => c.getId());

        instance.dispose();

        expect(ids.some((id) => hasTooltip(id))).toBe(false);
    });

    it('10. the two full-width Header rows carry no tooltip', () => {
        DiagnosticsOverlay.open();

        const instance = currentInstance()!;
        // Exact-class match, not `instanceof Header`: the window's own title
        // bar is a `WindowHeader`, which extends `Header` and would otherwise
        // be counted as a third match.
        const headers = collectComponents(instance).filter((c) => c.constructor.name === 'Header');

        expect(headers.length).toBe(2);

        for (const header of headers) {
            expect(hasTooltip(header.getId())).toBe(false);
        }
    });
});
