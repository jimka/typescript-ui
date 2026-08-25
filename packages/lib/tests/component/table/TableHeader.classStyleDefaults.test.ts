// Coverage for TableHeader's static `border`/`backgroundColor`/`backgroundImage`
// moving from imperative constructor setters into a registered
// `ownClassStyleDefaults` class default — see
// plans/implemented/class-tier-default-hoists-batch.md.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { _TableHeader } from '~/component/table/Header';
import { Model } from '~/data/Model';
import { MemoryStore } from '~/data/MemoryStore';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const MODEL = new Model([{ name: 'a', type: 'string', order: 0 }], 'a');

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `SelectableListRow.classStyleDefaults.test.ts`.
 */
function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of sink.writes.slice(start)) {
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

describe('TableHeader static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('a rendered TableHeader carries no static border/backgroundColor/backgroundImage declaration on its own #id rule, and .TableHeader exists', () => {
        const sink   = installTestDOM(CONFIG);
        const header = new _TableHeader(MODEL, new MemoryStore(MODEL, []));

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(header), () => header.getElement(true));

        // The negative (#id) assertions below would stay green even if the
        // value never reached the class tier at all (e.g. a typo'd
        // ownClassStyleDefaults key) — so also pin the positive half: what
        // .TableHeader itself declares. Read from the same render pass
        // rather than a second declarationsDuring call, since the second
        // call would find the rule already materialised and emit nothing.
        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.TableHeader') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        const tableHeaderBg =
            'var(--ts-ui-table-header-bg, var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))))';
        expect(classDeclarations.borderBottom).toBe('1px solid var(--ts-ui-table-header-border, black)');
        expect(classDeclarations.backgroundColor).toBe(tableHeaderBg);
        expect(classDeclarations.backgroundImage).toBe(tableHeaderBg);

        // Every one of border/backgroundColor/backgroundImage matches the
        // class default (as does `setOverflow("hidden")`, already the
        // framework baseline — see the plan's `## Non-Goals`), and
        // TableHeader has no other per-instance deviation to force its own
        // `#id` rule to materialise — so the whole batch is dirty-only nulls
        // and `StyleTarget.hasQueuedDeclarations` (core/StyleTarget.ts)
        // never flushes the rule at all, leaving every key absent rather
        // than an explicit `null` (see FooterRow.classStyleDefaults.test.ts
        // for the same shape, and SelectableListRow.classStyleDefaults.test.ts
        // for the contrasting case where a still-undeduped value keeps the
        // rule alive).
        expect(declarations.borderTop).toBeUndefined();
        expect(declarations.borderRight).toBeUndefined();
        expect(declarations.borderBottom).toBeUndefined();
        expect(declarations.borderLeft).toBeUndefined();
        expect(declarations.backgroundColor).toBeUndefined();
        expect(declarations.backgroundImage).toBeUndefined();
        expect(_ruleCacheHas('.TableHeader')).toBe(true);
    });
});
