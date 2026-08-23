// @vitest-environment jsdom
//
// Coverage for the diagnostics overlay's `DOMSource.countElements()` seam
// member (plans/implemented/debug-diagnostics-overlay.md, Expected Behaviour
// row 14) — against the REAL production source (the `jsdom` pragma keeps
// `tests/setup/node-setup.ts` from installing the modelled DOM, mirroring
// `tests/dom/fonts-ready.test.ts`), and against the modelled source via an
// explicit `installTestDOM`, the same combination that file's trailing
// `ModelledDOMSource.startFontLoad` describe uses.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM, ProductionDOMSource } from '~/core/DOM';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

describe('ProductionDOMSource.countElements', () => {
    it('returns a positive integer against a real document', () => {
        const probe = document.createElement('span');
        document.body.appendChild(probe);

        try {
            expect(new ProductionDOMSource().countElements()).toBeGreaterThan(0);
        } finally {
            document.body.removeChild(probe);
        }
    });
});

describe('ModelledDOMSource.countElements', () => {
    afterEach(() => DOM.reset());

    it('returns 0 — no selector engine offline', () => {
        installTestDOM({
            rootMountOffset: { x: 0, y: 0 },
            viewport:        { width: 1280, height: 800 },
            scrollBarWidth:  15,
            fontMetrics,
            themeVars:       {},
        });

        expect(DOM.source.countElements()).toBe(0);
    });
});
