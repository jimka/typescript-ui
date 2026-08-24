// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/implemented/button-variant-chrome-dedup.md's
// MenuBarButton fix (Expected Behaviour row 7): the `:hover` highlight used
// to ride Button's `styleRules` bag, which always writes a per-instance
// `#id:hover` rule with no class-tier comparison. `MenuBarButton` now
// declares its own `ownStyleStates` — `[Button.ownStyleStates[0], { selector:
// ":hover", ... }]`, restating `.pressed` unchanged and supplying real
// `:hover` content — the same shape `TabButton`'s own hover fix used (see
// TabButton.stateClassHoisting.test.ts, whose `declarationsDuring`/
// `idSelector` helpers this file copies).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MenuBarButton } from '~/component/menubar/MenuBarButton';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

const NOOP = (): void => {};

beforeEach(() => { sink = installTestDOM(DOM_CONFIG); });
afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `ClassStyleRules.test.ts`.
 */
function declarationsDuring(
    recorder: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = recorder.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of recorder.writes.slice(start)) {
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

describe('MenuBarButton hover state-class hoisting', () => {
    it('row 7: a second MenuBarButton writes no backgroundColor to its own #id:hover:not(.pressed) rule; .MenuBarButton:hover:not(.pressed) carries the hover token', () => {
        const start = sink.writes.length;
        new MenuBarButton('File', NOOP, NOOP).getElement(true);
        const firstWrites = sink.writes.slice(start);

        const classDeclarations: Record<string, string | null> = {};
        for (const w of firstWrites) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.MenuBarButton:hover:not(.pressed)') {
                Object.assign(classDeclarations, w.args[1] as Record<string, string | null>);
            }
        }

        expect(classDeclarations.backgroundColor).toBe('var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))');
        expect(_ruleCacheHas('.MenuBarButton:hover:not(.pressed)')).toBe(true);

        const second = new MenuBarButton('Edit', NOOP, NOOP);
        const hoverDeclarations = declarationsDuring(sink, idSelector(second) + ':hover:not(.pressed)', () => second.getElement(true));

        expect(hoverDeclarations.backgroundColor).toBeUndefined();
    });
});
