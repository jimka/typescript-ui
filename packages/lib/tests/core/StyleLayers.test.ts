// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the layer-stack primitive introduced by
// plans/layered-style-bag.md, Stage 1 — Expected Behaviour rows 2-3 (row 1,
// the group layer, was removed — see plan style-group-removal.md). The
// instance layer (rows 4-8) and meta-class layers (rows 9-13) arrive in
// later stages, with their own test files.
//
// Conventions mirrored from `ClassHierarchyCascade.test.ts`: a uniquely
// named local `Component` subclass per test (the module-level registries in
// `core/ClassStyleRules.ts` survive `DOM.reset()` within one test file).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import type { StyleLayer } from '~/core/ClassStyleRules';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/** Exposes the protected `styleLayers()` scan (and its `matchesLowerTier`
 *  consumer) for direct inspection from a test. */
class LayerProbe extends Component {
    exposeLayers(): ReadonlyArray<StyleLayer> {
        return this.styleLayers();
    }

    exposeMatch(key: string, value: string | null): boolean {
        return this.matchesLowerTier(key, value);
    }
}

describe('Component style layer stack (Stage 1)', () => {
    it('row 2: a key declared by no layer matches nothing', () => {
        class ProbeRow2 extends LayerProbe {}

        const c = new ProbeRow2({});
        c.getElement(true);

        // 'fontFamily' is not one of the fifteen hoistable keys any layer
        // resolves in Stage 1, regardless of the tested value.
        expect(c.exposeMatch('fontFamily', null)).toBe(false);
        expect(c.exposeMatch('fontFamily', 'Arial')).toBe(false);

        for (const layer of c.exposeLayers()) {
            expect('fontFamily' in layer.resolved).toBe(false);
        }
    });

    it('row 3: styleLayers() returns exactly the instance and class layers', () => {
        class ProbeRow3 extends LayerProbe {}

        const c = new ProbeRow3({});
        c.getElement(true);

        // "exactly the class layer" was the Stage 1 (pre-instance-layer)
        // shape — see this file's Expected Behaviour row 3, which the plan
        // itself marks "before Stage 2". Stage 2 pushes the instance layer
        // onto the front unconditionally; this component's own instance
        // layer declares no cursor (no setCursor call), so the class
        // layer's default still supplies it.
        const layers = c.exposeLayers();
        expect(layers.length).toBe(2);
        expect(layers[1].resolved.cursor).toBe('default');
    });
});
