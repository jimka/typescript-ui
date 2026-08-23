// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for DiagnosticsOverlay's "Show style audit" button
// (plans/in-progress/diagnostics-overlay-style-audit-window.md, Expected
// Behaviour row 19). Kept in its own file, and this its only test, so a real
// `.click()` stays reliable: `Event`'s window-level base listener is
// installed once per event type and never re-armed on a later
// `installTestDOM()` swap — see MenuButton.test.ts's header comment and
// DiagnosticsOverlay.rowTooltips.test.ts's own single-purpose-file shape for
// the same constraint. A native click here — rather than reaching in for the
// bound handler field — is what actually proves the button's `on("action",
// …)` wiring fires `StyleAuditOverlay.open()`, not just that the handler
// works when called directly.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiagnosticsOverlay } from '~/diagnostics/DiagnosticsOverlay';
import { StyleAuditOverlay } from '~/diagnostics/StyleAuditOverlay';
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

/** Reaches DiagnosticsOverlay's private static instance slot. */
function currentInstance(): DiagnosticsOverlay | null {
    return (DiagnosticsOverlay as unknown as { instance: DiagnosticsOverlay | null }).instance;
}

/** Reaches StyleAuditOverlay's private static instance slot, for teardown. */
function currentStyleAuditInstance(): StyleAuditOverlay | null {
    return (StyleAuditOverlay as unknown as { instance: StyleAuditOverlay | null }).instance;
}

beforeEach(() => installTestDOM(CONFIG));

afterEach(() => {
    currentInstance()?.dispose();
    currentStyleAuditInstance()?.dispose();
    DOM.reset();
});

describe('DiagnosticsOverlay — "Show style audit" button (native click)', () => {
    it('19. clicking it calls StyleAuditOverlay.open()', () => {
        DiagnosticsOverlay.open();

        const button = (currentInstance() as unknown as { _styleAuditButton: { click(): void } })._styleAuditButton;

        expect(StyleAuditOverlay.isOpen()).toBe(false);

        button.click();

        expect(StyleAuditOverlay.isOpen()).toBe(true);
    });
});
