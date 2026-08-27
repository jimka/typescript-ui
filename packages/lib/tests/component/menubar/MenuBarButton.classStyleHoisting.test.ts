// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/menubarbutton-chromeless-migration.md's
// Expected Behaviour rows 1-4: MenuBarButton drops `chromeless: true` in
// favour of real, declared resting + pressed + hover chrome, so a second
// instance dedupes onto the shared `.MenuBarButton`/`.MenuBarButton.pressed`/
// `.MenuBarButton:hover:not(.pressed)` class rules instead of repeating every
// declaration on its own `#id`/`#id.pressed`/`#id:hover` rule.
//
// `declarationsFor`/`writesDuring`/`idSelector` are copied from
// PickerButton.classStyleHoisting.test.ts. `MenuBarButton` is a single
// shared class, so `.MenuBarButton`/`.MenuBarButton.pressed`/
// `.MenuBarButton:hover:not(.pressed)` are only ever materialised once
// across this whole test file (the `core/ClassStyleRules.ts` registry is
// module state that survives `DOM.reset()` between tests) — the first test
// below primes all three from one instance's construction and render, then
// a second instance exercises the dedup.
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

const NOOP = (): void => {};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

type RecordedWrite = RecordingDOMSink['writes'][number];

/** Every sink op recorded while `fn()` ran. */
function writesDuring(sink: RecordingDOMSink, fn: () => void): RecordedWrite[] {
    const start = sink.writes.length;
    fn();

    return sink.writes.slice(start);
}

/**
 * Declarations written to `selector`'s stylesheet rule across `writes`,
 * flattened into one key/value map (last write per key wins, matching
 * cascade-within-a-rule semantics). Only `setRuleStyles` ops whose selector
 * (`args[0]`) matches are counted.
 */
function declarationsFor(writes: readonly RecordedWrite[], selector: string): Record<string, string | null> {
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

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

describe('MenuBarButton class-tier chrome dedup', () => {
    it('rows 1-4: the priming instance materialises the shared resting + pressed + hover class rules; a second instance writes to none of its own #id rules', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // `.MenuBarButton` (resting), `.MenuBarButton.pressed`, and
        // `.MenuBarButton:hover:not(.pressed)` are all materialised together,
        // on this first instance's construction and render — capture the
        // whole window, then split by selector.
        const primedWrites = writesDuring(sink, () => {
            new MenuBarButton('File', NOOP, NOOP).getElement(true);
        });

        // Row 2: assert individual keys rather than the whole rule body — the
        // same rule also carries the class's padding, which is not part of
        // this change.
        const restingDeclarations = declarationsFor(primedWrites, '.MenuBarButton');
        expect(restingDeclarations.backgroundColor).toBe('var(--ts-ui-menu-bar-btn-bg, transparent)');
        expect(restingDeclarations.color).toBe('var(--ts-ui-menu-bar-btn-fg, inherit)');
        expect(restingDeclarations.backgroundImage).toBe('none');
        expect(restingDeclarations.boxShadow).toBe('none');
        expect(restingDeclarations.borderTop).toBe('none');
        expect(restingDeclarations.borderRight).toBe('none');
        expect(restingDeclarations.borderBottom).toBe('none');
        expect(restingDeclarations.borderLeft).toBe('none');
        expect(restingDeclarations.borderRadius).toBeUndefined();

        // Row 3.
        const pressedDeclarations = declarationsFor(primedWrites, '.MenuBarButton.pressed');
        expect(pressedDeclarations.color).toBe('var(--ts-ui-menu-bar-btn-fg, inherit)');
        expect(pressedDeclarations.backgroundColor).toBe('var(--ts-ui-menu-bar-btn-bg, transparent)');
        expect(pressedDeclarations.backgroundImage).toBe('none');
        expect(pressedDeclarations.boxShadow).toBe('none');

        // Row 4 — the `background-color` half is already covered by
        // MenuBarButton.hoverClassHoisting.test.ts; the two new keys belong here.
        const hoverDeclarations = declarationsFor(primedWrites, '.MenuBarButton:hover:not(.pressed)');
        expect(hoverDeclarations.backgroundColor).toBe('var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))');
        expect(hoverDeclarations.backgroundImage).toBe('none');
        expect(hoverDeclarations.boxShadow).toBe('none');
        expect(_ruleCacheHas('.MenuBarButton:hover:not(.pressed)')).toBe(true);

        // A second instance, constructed (and rendered) after the rules
        // above are primed, writes no real declaration to its own resting,
        // #id.pressed, or #id:hover rules — its id isn't known until
        // construction, so filter the captured window after the fact.
        let second!: MenuBarButton;
        const secondWrites = writesDuring(sink, () => {
            second = new MenuBarButton('Edit', NOOP, NOOP);
            second.getElement(true);
        });

        // Row 1: the resting write is isolated onto
        // `#id:not(.pressed):not(:hover)` (see `restingGuardSuffix` /
        // `isRestingChromeIsolated` in Component.ts): backgroundColor /
        // backgroundImage / boxShadow are also part of MenuBarButton's own
        // `.pressed`/`:hover` state bags, so a bare `#id` write would tie in
        // specificity against the shared `.MenuBarButton.pressed` rule.
        const idDeclarations = declarationsFor(secondWrites, idSelector(second) + ':not(.pressed):not(:hover)');
        expect(idDeclarations.backgroundColor).toBeUndefined();
        expect(idDeclarations.backgroundImage).toBeUndefined();
        expect(idDeclarations.boxShadow).toBeUndefined();
        expect(idDeclarations.borderTop).toBeUndefined();
        expect(idDeclarations.borderRight).toBeUndefined();
        expect(idDeclarations.borderBottom).toBeUndefined();
        expect(idDeclarations.borderLeft).toBeUndefined();

        const idDeclarationsBare = declarationsFor(secondWrites, idSelector(second));
        expect(idDeclarationsBare.borderRadius).toBeUndefined();

        const pressedIdDeclarations = declarationsFor(secondWrites, idSelector(second) + '.pressed');
        expect(pressedIdDeclarations.color).toBeUndefined();
        expect(pressedIdDeclarations.backgroundColor).toBeUndefined();
        expect(pressedIdDeclarations.backgroundImage).toBeUndefined();
        expect(pressedIdDeclarations.boxShadow).toBeUndefined();

        const hoverIdDeclarations = declarationsFor(secondWrites, idSelector(second) + ':hover:not(.pressed)');
        expect(hoverIdDeclarations.backgroundColor).toBeUndefined();
        expect(hoverIdDeclarations.backgroundImage).toBeUndefined();
        expect(hoverIdDeclarations.boxShadow).toBeUndefined();
    });
});
