// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/button-flat-chrome-dedup.md's TableHeaderMenuButton fix
// (Expected Behaviour row 9): the column-menu button built inside
// `TableHeader`'s constructor is now a real, declared-chrome Button subclass
// (module-private `TableHeaderMenuButton` in Header.ts) instead of a bare
// `Button({ flat: true, ... })` with a dozen imperative overrides, so its
// resting/pressed/hover chrome dedupes onto shared `.TableHeaderMenuButton`
// class rules the same way `WindowControlButton`'s own chrome already does —
// see WindowControlButton.classStyleHoisting.test.ts, whose declarationsFor/
// idSelector helpers and warmup-then-second-instance shape this file copies.
// The Table/MemoryStore/Model preamble is copied from HeaderMenuButton.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { _ruleCacheHas } from '~/core/StyleTarget';

// Literal tokens mirrored from Header.ts's own module constants — not
// exported, so restated here rather than imported (same approach
// Button.flatStateClassHoisting.test.ts takes for Button's own tokens).
const TABLE_HEADER_BG        = "var(--ts-ui-table-header-bg, var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))))";
const MENU_BUTTON_DIVIDER_SHADOW = "inset 1px 0 0 0 var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))";
const MENU_BUTTON_HOVER_BG   = "var(--ts-ui-button-hover-bg, rgb(252, 252, 252))";
const MENU_BUTTON_PRESSED_BG = "var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))";

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const TABLE_MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
]);

/** A one-string-column table over an empty, unloaded store — no record data is needed to exercise the header's menu button. */
function makeTable(): InstanceType<typeof Table> {
    return new Table(new MemoryStore(TABLE_MODEL, []));
}

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Flattens every `setRuleStyles` write to `selector` found in `writes` into
 * one key/value map (last write per key wins). Copied from
 * WindowControlButton.classStyleHoisting.test.ts.
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

describe('TableHeaderMenuButton chrome hoisting', () => {
    it('row 9: a second menu button writes no resting/pressed/hover declaration of its own; .TableHeaderMenuButton carries the header chrome', () => {
        const start        = sink.writes.length;
        const first        = makeTable().getHeader().getMenuButton();
        first.getElement(true);
        const firstWrites  = sink.writes.slice(start);

        const restingClassDeclarations = declarationsFor(firstWrites, '.TableHeaderMenuButton');
        expect(restingClassDeclarations.borderTop).toBe('none');
        expect(restingClassDeclarations.borderRight).toBe('none');
        expect(restingClassDeclarations.borderBottom).toBe('none');
        expect(restingClassDeclarations.borderLeft).toBe('none');
        expect(restingClassDeclarations.backgroundColor).toBe(TABLE_HEADER_BG);
        expect(restingClassDeclarations.backgroundImage).toBe(TABLE_HEADER_BG);
        expect(restingClassDeclarations.boxShadow).toBe(MENU_BUTTON_DIVIDER_SHADOW);

        // `backgroundColor` is absent from both extracts below: MENU_BUTTON_PRESSED_BG
        // / MENU_BUTTON_HOVER_BG are byte-identical to Button's own base
        // `pressedBackgroundColor` / `hoverBackgroundColor` defaults (see the
        // plan's Architecture Decisions), so the per-level merge dedupes the
        // restatement — `.Button.pressed` / `.Button:hover:not(.pressed)`
        // (same specificity, inserted first) already supply that one property
        // for real, and `backgroundImage`, which genuinely differs from
        // Button's own `none` default, is declared here for real.
        const pressedClassDeclarations = declarationsFor(firstWrites, '.TableHeaderMenuButton.pressed');
        expect(pressedClassDeclarations.backgroundColor).toBeUndefined();
        expect(pressedClassDeclarations.backgroundImage).toBe(MENU_BUTTON_PRESSED_BG);
        expect(pressedClassDeclarations.boxShadow).toBe(MENU_BUTTON_DIVIDER_SHADOW);

        const hoverClassDeclarations = declarationsFor(firstWrites, '.TableHeaderMenuButton:hover:not(.pressed)');
        expect(hoverClassDeclarations.backgroundColor).toBeUndefined();
        expect(hoverClassDeclarations.backgroundImage).toBe(MENU_BUTTON_HOVER_BG);
        expect(hoverClassDeclarations.boxShadow).toBe(MENU_BUTTON_DIVIDER_SHADOW);

        expect(_ruleCacheHas('.TableHeaderMenuButton')).toBe(true);
        expect(_ruleCacheHas('.TableHeaderMenuButton.pressed')).toBe(true);
        expect(_ruleCacheHas('.TableHeaderMenuButton:hover:not(.pressed)')).toBe(true);

        // A second menu button, rendered after the first warmed the class
        // rules, writes no real declaration to its own resting
        // (`:not(.pressed):not(:hover)`-guarded), `.pressed`, or
        // `:hover:not(.pressed)` rule.
        const secondStart  = sink.writes.length;
        const second       = makeTable().getHeader().getMenuButton();
        second.getElement(true);
        const secondWrites = sink.writes.slice(secondStart);

        const secondResting = declarationsFor(secondWrites, idSelector(second) + ':not(.pressed):not(:hover)');
        expect(secondResting.backgroundColor).toBeUndefined();
        expect(secondResting.backgroundImage).toBeUndefined();
        expect(secondResting.borderTop).toBeUndefined();
        expect(secondResting.boxShadow).toBeUndefined();

        const secondPressed = declarationsFor(secondWrites, idSelector(second) + '.pressed');
        expect(secondPressed.backgroundColor).toBeUndefined();
        expect(secondPressed.backgroundImage).toBeUndefined();
        expect(secondPressed.boxShadow).toBeUndefined();

        const secondHover = declarationsFor(secondWrites, idSelector(second) + ':hover:not(.pressed)');
        expect(secondHover.backgroundColor).toBeUndefined();
        expect(secondHover.backgroundImage).toBeUndefined();
        expect(secondHover.boxShadow).toBeUndefined();
    });
});
