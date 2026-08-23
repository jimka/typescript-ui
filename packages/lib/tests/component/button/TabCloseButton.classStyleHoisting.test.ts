// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/implemented/button-variant-chrome-dedup.md's
// TabCloseButton fix (Expected Behaviour row 8): `TabButton.buildCloseButton()`
// used to call eight setters (`setBackgroundColor`/`setBackgroundImage`/
// `setHoverBackgroundColor`/`setHoverBackgroundImage`/`setHoverShadow`/
// `setBorderRadius`/`clearBorder`/`clearShadow`) with the same literal values
// on every close button it built, because none of those values lived in
// `_defaultTabCloseButtonOptions`. Moving the five resting values into that
// `ownClassStyleDefaults` bag and the three hover values into a new
// `ownStyleStates` `:hover` entry lets the construction-time cascade apply
// them, so `buildCloseButton()`'s imperative calls are deleted outright — see
// `TabButton.stateClassHoisting.test.ts` for the precedent this file's
// `declarationsDuring`/`idSelector` helpers are copied from.
//
// `TabCloseButton`'s `.pressed` chrome is unaffected (still Button's
// inherited generic raised look, not part of this plan's scope) — only
// resting and `:hover` are covered here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TabButton } from '~/component/button/TabButton';
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

beforeEach(() => { sink = installTestDOM(DOM_CONFIG); });
afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Flattens every `setRuleStyles` write to `selector` found in `writes` into
 * one key/value map (last write per key wins).
 */
function declarationsFor(writes: RecordingDOMSink['writes'], selector: string): Record<string, string | null> {
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

describe('TabCloseButton class-style hoisting', () => {
    it('row 8: a second closeable TabButton\'s close button writes no resting/hover declaration to its own rules; .TabCloseButton and .TabCloseButton:hover:not(.pressed) carry the flattened tokens', () => {
        const start = sink.writes.length;
        const first = new TabButton('Warmup', { closeable: true });
        first.getElement(true);
        const firstWrites = sink.writes.slice(start);

        const restingClassDeclarations = declarationsFor(firstWrites, '.TabCloseButton');
        const hoverClassDeclarations   = declarationsFor(firstWrites, '.TabCloseButton:hover:not(.pressed)');

        expect(restingClassDeclarations.backgroundColor).toBe('transparent');
        expect(restingClassDeclarations.backgroundImage).toBe('none');
        expect(restingClassDeclarations.borderRadius).toBe('3px');
        expect(restingClassDeclarations.borderTop).toBe('none');
        expect(restingClassDeclarations.borderRight).toBe('none');
        expect(restingClassDeclarations.borderBottom).toBe('none');
        expect(restingClassDeclarations.borderLeft).toBe('none');
        expect(restingClassDeclarations.boxShadow).toBe('none');

        expect(hoverClassDeclarations.backgroundColor).toBe('var(--ts-ui-tab-close-hover-bg, rgba(0, 0, 0, 0.12))');
        expect(hoverClassDeclarations.backgroundImage).toBe('none');
        expect(hoverClassDeclarations.boxShadow).toBe('none');

        expect(_ruleCacheHas('.TabCloseButton')).toBe(true);
        expect(_ruleCacheHas('.TabCloseButton:hover:not(.pressed)')).toBe(true);

        // `TabButton.buildCloseButton()` renders the close button eagerly
        // inside the TabButton constructor (it raw-appends the already-
        // rendered element onto the tab's own), so the capture window has to
        // wrap the *construction* itself — a `getElement(true)` called
        // afterward would be a no-op idempotent re-render that writes
        // nothing regardless of whether dedup actually happened, making the
        // assertion vacuous.
        const secondStart = sink.writes.length;
        const second = new TabButton('Second', { closeable: true });
        const secondWrites = sink.writes.slice(secondStart);
        const closeButton = second.getCloseButton()!;

        const restingSelector = idSelector(closeButton) + ':not(.pressed):not(:hover)';
        const restingInstanceDeclarations = declarationsFor(secondWrites, restingSelector);
        expect(restingInstanceDeclarations.backgroundColor).toBeUndefined();
        expect(restingInstanceDeclarations.backgroundImage).toBeUndefined();
        expect(restingInstanceDeclarations.borderRadius).toBeUndefined();
        expect(restingInstanceDeclarations.borderTop).toBeUndefined();
        expect(restingInstanceDeclarations.boxShadow).toBeUndefined();

        const hoverSelector = idSelector(closeButton) + ':hover:not(.pressed)';
        const hoverInstanceDeclarations = declarationsFor(secondWrites, hoverSelector);
        expect(hoverInstanceDeclarations.backgroundColor).toBeUndefined();
        expect(hoverInstanceDeclarations.backgroundImage).toBeUndefined();
        expect(hoverInstanceDeclarations.boxShadow).toBeUndefined();
    });
});
