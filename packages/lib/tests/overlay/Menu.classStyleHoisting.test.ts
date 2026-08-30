// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the StyleAudit residue sweep in
// plans/split-accordion-panel-scroll-convergence.md: Menu's `borderRadius` —
// identical between persistent (MenuBar dropdown) and rebuild (context-menu)
// chrome — moves onto a resting-tier `ownClassStyleDefaults`, shared by every
// Menu instance regardless of mode; persistent mode's own
// backgroundColor/border/shadow move onto a `.persistent` `ownStyleStates`
// entry, so a second persistent Menu dedupes onto `.Menu.persistent` instead
// of repeating them on its own `#id.persistent` rule. Same shape and helpers
// as `tests/component/container/AccordionHeader.classStyleHoisting.test.ts`,
// recreated locally per that file's own module-cache-per-file caveat.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { Menu } from '~/overlay/Menu';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

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

describe('Menu class-tier chrome dedup', () => {
    it('borderRadius is a shared resting default; a second persistent menu writes no backgroundColor/border/shadow to its own rules', () => {
        const sink = DOM.sink as RecordingDOMSink;

        let first!: Menu;
        const primedWrites = writesDuring(sink, () => {
            first = new Menu([{ text: 'A', action: () => {} }], () => {});
            first.getElement(true);
        });

        const restingDeclarations = declarationsFor(primedWrites, '.Menu');
        expect(restingDeclarations.borderRadius).toBe('var(--ts-ui-border-radius, 4px)');

        const persistentDeclarations = declarationsFor(primedWrites, '.Menu.persistent');
        expect(persistentDeclarations.backgroundColor).toBe('var(--ts-ui-menu-bar-panel-bg, rgb(255, 255, 255))');
        expect(persistentDeclarations.borderTop).toBe('1px solid var(--ts-ui-menu-bar-panel-border, rgb(200, 200, 200))');
        expect(persistentDeclarations.boxShadow).toBe('var(--ts-ui-menu-bar-panel-shadow, 2px 4px 8px rgba(0, 0, 0, 0.15))');

        let second!: Menu;
        const secondWrites = writesDuring(sink, () => {
            second = new Menu([{ text: 'B', action: () => {} }], () => {});
            second.getElement(true);
        });

        const idPersistentDeclarations = declarationsFor(secondWrites, idSelector(second) + '.persistent');
        expect(idPersistentDeclarations.backgroundColor).toBeUndefined();
        expect(idPersistentDeclarations.borderTop).toBeUndefined();
        expect(idPersistentDeclarations.boxShadow).toBeUndefined();

        // borderRadius is never repeated on any instance's own #id rule —
        // it's a plain resting default, not part of any state bag, so it
        // carries no isolation guard to check.
        expect(sink.writes.some(w =>
            w.op === 'setRuleStyles'
            && (w.args[0] as string).startsWith(idSelector(second))
            && (w.args[1] as Record<string, unknown>).borderRadius !== undefined
        )).toBe(false);
    });

    it('a rebuild-mode menu shares the same resting borderRadius as persistent mode', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // Prime .Menu with a persistent instance first.
        new Menu([{ text: 'A', action: () => {} }], () => {}).getElement(true);

        let rebuild!: Menu;
        const rebuildWrites = writesDuring(sink, () => {
            rebuild = new Menu();
            rebuild.getElement(true);
        });

        // A rebuild-mode instance never sets .persistent, so no state write
        // for it should appear — but it still inherits the shared resting
        // .Menu rule with no #id-level borderRadius write of its own.
        expect(rebuildWrites.some(w =>
            w.op === 'setRuleStyles'
            && (w.args[0] as string).startsWith(idSelector(rebuild))
            && (w.args[1] as Record<string, unknown>).borderRadius !== undefined
        )).toBe(false);
    });

    it('a persistent menu caches its border spec for getBorderSize(), even though the border is painted only by the shared .persistent class rule', () => {
        // Regression test: `applyPersistentChrome` used to call `setBorder`,
        // which both wrote the per-instance CSS and cached `_border` for
        // `getBorderSize()`'s layout math. Hoisting the border onto the
        // shared `.persistent` `ownStyleStates` rule dropped the `setBorder`
        // call entirely, leaving `getBorderSize()` reporting a zero-width
        // border while the CSS still painted a real 1px one — so the layout
        // manager handed items 2px more room (height and width) than the
        // rendered border-box actually offered, and that overflow tripped
        // the menu's `overflow-y: auto` scrollbar even when the items would
        // otherwise fit exactly.
        const menu = new Menu([{ text: 'A', action: () => {} }], () => {});
        menu.getElement(true);

        expect(menu.getBorderSize()).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
    });
});
