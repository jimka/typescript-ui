// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/diagramnode-bordercolor-stylebag-longhand.md's
// Expected Behaviour rows 5-8: moving DiagramNode's `.selected` border
// colour off its own per-instance rule and onto the shared
// `.DiagramNode.selected` class-tier state rule. Rows 1-4 (the generic
// `borderColor` StyleBag mechanism) live in
// tests/core/BorderColorStyleBag.test.ts; rows 9-11 are cascade outcomes
// that need a browser (see the plan's `## Verification`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { _DiagramNode as DiagramNode } from '~/component/diagram/DiagramNode';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
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
afterEach(() => { DOM.reset(); });

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `RestingChromeIsolation.test.ts`.
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

describe('DiagramNode — .selected border-colour dedup', () => {
    it('row 5: two rendered nodes share one .DiagramNode.selected rule and neither gets its own #id.selected rule', () => {
        const a = new DiagramNode({ label: 'a' });
        const b = new DiagramNode({ label: 'b' });
        a.getElement(true);
        b.getElement(true);

        expect(_ruleCacheHas('.DiagramNode.selected')).toBe(true);
        expect(_ruleCacheHas(idSelector(a) + '.selected')).toBe(false);
        expect(_ruleCacheHas(idSelector(b) + '.selected')).toBe(false);
    });

    it('row 6: a rendered node\'s own #id rule carries no real borderColor declaration', () => {
        const node = new DiagramNode({ label: 'x' });

        const declarations = declarationsDuring(sink, idSelector(node), () => node.getElement(true));

        expect(declarations.borderColor).toBeUndefined();
    });

    it('row 7: setSelected(true) adds the selected DOM class and writes no CSS-rule declaration of its own', () => {
        const node = new DiagramNode({ label: 'x' });
        node.getElement(true);

        const start = sink.writes.length;
        node.setSelected(true);
        const writesSince = sink.writes.slice(start);
        const ruleWrites  = writesSince.filter((w) => w.op === 'setRuleStyles');
        const classWrites = writesSince.filter((w) => w.op === 'apply' && (w.args[1] as any)?.addClass?.includes('selected'));

        expect(ruleWrites).toHaveLength(0);
        expect(classWrites.length).toBeGreaterThan(0);
        expect(node.isSelected()).toBe(true);
    });

    it('row 8: a fresh node\'s resting border is unchanged', () => {
        const node = new DiagramNode({ label: 'x' });

        expect(node.getBorder()).toEqual({ border: '1px solid var(--ts-ui-border-color, rgb(180, 180, 180))' });
    });
});
