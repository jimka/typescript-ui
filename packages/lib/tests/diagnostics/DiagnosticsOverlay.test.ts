// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for DiagnosticsOverlay's static-singleton lifecycle, mirroring
// Tooltip's shape (plans/implemented/debug-diagnostics-overlay.md's
// `## Architecture Decisions`). Cases are numbered to match the plan's
// `## Expected Behaviour` "Overlay — unit-testable except the rendered
// readout" list (20-25); row 26 (the rendered numbers and their formatting)
// is manual-verify only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiagnosticsOverlay } from '~/diagnostics/DiagnosticsOverlay';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Component } from '~/core/Component';
import { Diagnostics } from '~/core/Diagnostics';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

/**
 * Recursively collects a component's own id plus every registered
 * descendant's id, copied from tests/overlay/Notification.styleRuleDisposal.test.ts.
 */
function collectIds(c: Component): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    return ids;
}

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

beforeEach(() => {
    installTestDOM(CONFIG);
    Diagnostics._reset();
});

afterEach(() => {
    // A bare dispose() bypasses the close animation entirely (Component.dispose
    // calls destructor() directly), guaranteeing a clean singleton slot for the
    // next test regardless of whether that test's own close() animation ran.
    currentInstance()?.dispose();
    DOM.reset();
});

describe('DiagnosticsOverlay.open', () => {
    it('20. is idempotent', () => {
        DiagnosticsOverlay.open();
        DiagnosticsOverlay.open();

        const matching = AbstractWindow.getOpenWindows().filter((w) => w instanceof DiagnosticsOverlay);

        expect(matching.length).toBe(1);
    });
});

describe('DiagnosticsOverlay.isOpen', () => {
    it('21. tracks the lifecycle, not only after the close animation finishes', () => {
        expect(DiagnosticsOverlay.isOpen()).toBe(false);

        DiagnosticsOverlay.open();
        expect(DiagnosticsOverlay.isOpen()).toBe(true);

        DiagnosticsOverlay.close();
        expect(DiagnosticsOverlay.isOpen()).toBe(false);
    });
});

describe('DiagnosticsOverlay.toggle', () => {
    it('22. alternates between open and closed', () => {
        expect(DiagnosticsOverlay.isOpen()).toBe(false);

        DiagnosticsOverlay.toggle();
        expect(DiagnosticsOverlay.isOpen()).toBe(true);

        DiagnosticsOverlay.toggle();
        expect(DiagnosticsOverlay.isOpen()).toBe(false);
    });
});

describe('DiagnosticsOverlay.close', () => {
    it('23. stops the sampler', () => {
        DiagnosticsOverlay.open();
        expect(Diagnostics.isTimingEnabled()).toBe(true);

        DiagnosticsOverlay.close();
        expect(Diagnostics.isTimingEnabled()).toBe(false);
    });
});

describe('DiagnosticsOverlay — style-rule disposal on close', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('24. open-then-close leaks no stylesheet rules', () => {
        DiagnosticsOverlay.open();

        const instance = currentInstance()!;
        const ids       = collectIds(instance);

        expect(_ruleCacheKeys().some((key) => ids.some((id) => key.includes(id)))).toBe(true);

        DiagnosticsOverlay.close();

        // No transitionend fires offline; play()'s setTimeout fallback is what
        // guarantees the close animation's onComplete (-> destructor()) runs —
        // mirrors tests/core/ComponentDispose.test.ts's Animation.materialize case.
        vi.advanceTimersByTime(300);

        const leaked = _ruleCacheKeys().filter((key) => ids.some((id) => key.includes(id)));

        expect(leaked).toEqual([]);
    });
});

describe('DiagnosticsOverlay — direct dispose()', () => {
    it('25. clears the static slot, so a following open() builds a fresh window', () => {
        DiagnosticsOverlay.open();
        const first = currentInstance();

        first?.dispose();

        expect(DiagnosticsOverlay.isOpen()).toBe(false);

        DiagnosticsOverlay.open();
        const second = currentInstance();

        expect(second).not.toBe(first);
    });
});

// Case 19 (the "Show style audit" button) lives in its own file,
// DiagnosticsOverlay.styleAuditButton.test.ts — driven via a real `.click()`,
// which needs to be the only test in its file for the reason documented
// there.
