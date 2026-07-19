import { describe, it, expect, afterEach } from 'vitest';
import { Body } from '~/core/Body';
import { Component } from '~/core/Component';
import { Fit } from '~/layout/Fit';
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

describe('Body.init', () => {
    afterEach(() => DOM.reset());

    it('applies the options bag to the singleton and returns it', () => {
        installTestDOM(CONFIG);

        const fit   = new Fit();
        const child = new Component({});

        const body = Body.init({ layoutManager: fit, components: [child] });

        // init is the one-call entry point: it returns the same singleton
        // getInstance() hands out, with the supplied layout + children applied.
        expect(body).toBe(Body.getInstance());
        expect(body.getLayoutManager()).toBe(fit);
        expect(body.getComponents()).toContain(child);
    });
});
