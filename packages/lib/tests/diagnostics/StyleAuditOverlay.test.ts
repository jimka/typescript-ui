// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for StyleAuditOverlay's static-singleton lifecycle, mirroring
// DiagnosticsOverlay's own shape and test file
// (plans/in-progress/diagnostics-overlay-style-audit-window.md's `##
// Architecture Decisions` → "The window is a static-only singleton, mirroring
// DiagnosticsOverlay"). Cases are numbered to match the plan's `## Expected
// Behaviour` "StyleAuditOverlay — unit-testable except the rendered table"
// list (13-18); the exact column widths and cell content of row 22 remain
// manual-verify only, but the coarser "does the table actually get the
// window's height" half of that case is pinned automatically below (an
// audit round found the embedded `StyleAuditView` was never given a layout
// weight, collapsing the table to ~100px regardless of the 520px window).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StyleAuditOverlay } from '~/diagnostics/StyleAuditOverlay';
import { DiagnosticsOverlay } from '~/diagnostics/DiagnosticsOverlay';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Component } from '~/core/Component';
import { Table } from '~/component/table/Table';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

/**
 * Recursively collects a component's own id plus every registered
 * descendant's id, copied from tests/diagnostics/DiagnosticsOverlay.test.ts.
 */
function collectIds(c: Component): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    return ids;
}

/** Recursively finds the first descendant for which `predicate` returns true, depth-first. */
function findDescendant(root: Component, predicate: (c: Component) => boolean): Component | null {
    for (const child of root.getComponents()) {
        if (predicate(child)) {
            return child;
        }

        const found = findDescendant(child, predicate);
        if (found) {
            return found;
        }
    }

    return null;
}

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Reaches the private static instance slot, for teardown and identity checks. */
function currentInstance(): StyleAuditOverlay | null {
    return (StyleAuditOverlay as unknown as { instance: StyleAuditOverlay | null }).instance;
}

/** Reaches DiagnosticsOverlay's private static instance slot. */
function currentDiagnosticsInstance(): DiagnosticsOverlay | null {
    return (DiagnosticsOverlay as unknown as { instance: DiagnosticsOverlay | null }).instance;
}

beforeEach(() => {
    installTestDOM(CONFIG);
});

afterEach(() => {
    // A bare dispose() bypasses the close animation entirely (Component.dispose
    // calls destructor() directly), guaranteeing a clean singleton slot for the
    // next test regardless of whether that test's own close() animation ran.
    currentInstance()?.dispose();
    currentDiagnosticsInstance()?.dispose();
    DOM.reset();
});

describe('StyleAuditOverlay.open', () => {
    it('13. is idempotent', () => {
        StyleAuditOverlay.open();
        StyleAuditOverlay.open();

        const matching = AbstractWindow.getOpenWindows().filter((w) => w instanceof StyleAuditOverlay);

        expect(matching.length).toBe(1);
    });
});

describe('StyleAuditOverlay.isOpen', () => {
    it('14. tracks the lifecycle', () => {
        expect(StyleAuditOverlay.isOpen()).toBe(false);

        StyleAuditOverlay.open();
        expect(StyleAuditOverlay.isOpen()).toBe(true);

        StyleAuditOverlay.close();
        expect(StyleAuditOverlay.isOpen()).toBe(false);
    });
});

describe('StyleAuditOverlay.toggle', () => {
    it('15. alternates between open and closed', () => {
        expect(StyleAuditOverlay.isOpen()).toBe(false);

        StyleAuditOverlay.toggle();
        expect(StyleAuditOverlay.isOpen()).toBe(true);

        StyleAuditOverlay.toggle();
        expect(StyleAuditOverlay.isOpen()).toBe(false);
    });
});

describe('StyleAuditOverlay — style-rule disposal on close', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('16. open-then-close leaks no stylesheet rules', () => {
        StyleAuditOverlay.open();

        const instance = currentInstance()!;
        const ids       = collectIds(instance);

        expect(_ruleCacheKeys().some((key) => ids.some((id) => key.includes(id)))).toBe(true);

        StyleAuditOverlay.close();

        // No transitionend fires offline; play()'s setTimeout fallback is what
        // guarantees the close animation's onComplete (-> destructor()) runs —
        // mirrors DiagnosticsOverlay.test.ts's equivalent case.
        vi.advanceTimersByTime(300);

        const leaked = _ruleCacheKeys().filter((key) => ids.some((id) => key.includes(id)));

        expect(leaked).toEqual([]);
    });
});

describe('StyleAuditOverlay — direct dispose()', () => {
    it('17. clears the static slot, so a following open() builds a fresh window', () => {
        StyleAuditOverlay.open();
        const first = currentInstance();

        first?.dispose();

        expect(StyleAuditOverlay.isOpen()).toBe(false);

        StyleAuditOverlay.open();
        const second = currentInstance();

        expect(second).not.toBe(first);
    });
});

describe('StyleAuditOverlay and DiagnosticsOverlay — independence', () => {
    it('18. opening one does not close or otherwise affect the other', () => {
        DiagnosticsOverlay.open();
        expect(DiagnosticsOverlay.isOpen()).toBe(true);

        StyleAuditOverlay.open();

        expect(DiagnosticsOverlay.isOpen()).toBe(true);
        expect(StyleAuditOverlay.isOpen()).toBe(true);

        StyleAuditOverlay.close();

        expect(DiagnosticsOverlay.isOpen()).toBe(true);
        expect(StyleAuditOverlay.isOpen()).toBe(false);
    });
});

describe('StyleAuditOverlay — embedded StyleAuditView layout', () => {
    it("22 (partial). the results Table receives the window's available height, not StyleAuditView's own preferred height", () => {
        StyleAuditOverlay.open();

        const instance = currentInstance()!;
        instance.flushLayout();

        const table = findDescendant(instance, (c) => c instanceof Table);

        expect(table).not.toBeNull();
        // The window is 520px tall. Without a layout weight carrying the
        // body's spare height down into StyleAuditView, the table collapses
        // to its own preferred size — about 3 rows, ~100px — regardless of
        // the window's height. A real fix keeps it well above that floor.
        expect(table!.getHeight()).toBeGreaterThan(300);
    });
});
