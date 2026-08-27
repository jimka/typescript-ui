// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpinButton } from '~/component/input/SpinButton';
import { TabButton } from '~/component/button/TabButton';
import { WindowHeader } from '~/component/container/WindowHeader';
import { ComboBox } from '~/component/input/ComboBox';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;
beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => DOM.reset());

function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

function declarationsFor(writes: RecordingDOMSink['writes'], selector: string): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const w of writes) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) continue;
        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) out[key] = styles[key];
    }
    return out;
}

/** Every DOM class token an `apply` write for `handle` carries via `addClass`. */
function addedClassesFor(writes: RecordingDOMSink['writes'], handle: Handle): readonly string[] {
    const out: string[] = [];
    for (const w of writes) {
        if (w.op !== 'apply' || w.args[0] !== handle) continue;
        const addClass = (w.args[1] as { addClass?: string[] }).addClass;
        if (Array.isArray(addClass)) out.push(...addClass);
    }
    return out;
}

/** Recorded `ensureStyleRule` ops for `selector` — a non-empty result means
 *  this capture window materialised the rule itself, rather than joining one
 *  that already existed. */
function ensureStyleRuleOpsFor(writes: RecordingDOMSink['writes'], selector: string): Array<{ op: string; args: unknown[] }> {
    return writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector);
}

describe('glyph-xs-ink trait: cross-class sharing between SpinButton and TabButton', () => {
    it("a TabButton's close-button glyph, rendered after a SpinButton has already rendered, writes no size declaration to its own #id rule", () => {
        new SpinButton('▲').getElement(true);

        // TabButton.buildCloseButton renders the close button eagerly inside
        // the outer TabButton's own constructor — capture the construction
        // itself, per TabButton.test.ts's own close-button test.
        const start  = sink.writes.length;
        const tab    = new TabButton('A', { closeable: true });
        const writes = sink.writes.slice(start);

        const glyph        = tab.getCloseButton()!.getGlyph()!;
        const declarations = declarationsFor(writes, idSelector(glyph));

        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-xs-ink')).toBe(true);

        // No `ensureStyleRule` op for the trait selector inside this capture
        // window — the rule already existed from the SpinButton's own render,
        // so TabButton is joining it, not independently materialising a
        // same-named-but-distinct rule of its own.
        expect(ensureStyleRuleOpsFor(writes, '.ts-ui-component.ts-ui-trait-glyph-xs-ink')).toHaveLength(0);

        // This glyph's own DOM class list carries the exact same trait token
        // the SpinButton's chevron already materialised the rule under —
        // proves genuine cross-class sharing (one shared rule, one shared
        // token), not two same-named-but-distinct traits each carrying its
        // own token and its own rule.
        expect(addedClassesFor(writes, glyph.getElement(true)!)).toContain('ts-ui-trait-glyph-xs-ink');
    });
});

describe('glyph-md-ink trait: cross-class sharing between WindowHeader and ComboBox', () => {
    it("a ComboBox's caret chevron, rendered after a WindowHeader has already rendered, writes no size declaration to its own #id rule", () => {
        new WindowHeader('Title').getElement(true);

        const combo = new ComboBox() as any;
        const glyph = combo._caret.getGlyph();

        const start = sink.writes.length;
        combo.getElement(true);
        const writes = sink.writes.slice(start);

        const declarations = declarationsFor(writes, idSelector(glyph));

        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-md-ink')).toBe(true);

        // No `ensureStyleRule` op for the trait selector inside this capture
        // window — the rule already existed from the WindowHeader's own
        // render, so ComboBox is joining it, not independently materialising
        // a same-named-but-distinct rule of its own.
        expect(ensureStyleRuleOpsFor(writes, '.ts-ui-component.ts-ui-trait-glyph-md-ink')).toHaveLength(0);

        // This glyph's own DOM class list carries the exact same trait token
        // the WindowHeader's title glyph already materialised the rule
        // under — proves genuine cross-class sharing (one shared rule, one
        // shared token), not two same-named-but-distinct traits each
        // carrying its own token and its own rule.
        expect(addedClassesFor(writes, glyph.getElement(true)!)).toContain('ts-ui-trait-glyph-md-ink');
    });
});
