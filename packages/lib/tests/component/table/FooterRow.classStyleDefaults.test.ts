// Coverage for FooterRow's static `border`/`backgroundColor`/`backgroundImage`
// moving from imperative constructor setters into a registered
// `ownClassStyleDefaults` class default — see
// plans/implemented/class-tier-default-hoists-batch.md.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { _FooterRow } from '~/component/table/Footer';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

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

describe('FooterRow static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('a rendered FooterRow carries no static border/backgroundColor/backgroundImage declaration on its own #id rule, and .FooterRow exists', () => {
        const sink   = installTestDOM(CONFIG);
        const footer = new _FooterRow();

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(footer), () => footer.getElement(true));

        // The negative (#id) assertions below would stay green even if the
        // value never reached the class tier at all (e.g. a typo'd
        // ownClassStyleDefaults key) — so also pin the positive half: what
        // .FooterRow itself declares. Read from the same render pass rather
        // than a second declarationsDuring call, since the second call
        // would find the rule already materialised and emit nothing.
        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.FooterRow') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.borderTop).toBe('1px solid var(--ts-ui-border-color, black)');
        expect(classDeclarations.backgroundColor).toBe(
            'var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))',
        );
        expect(classDeclarations.backgroundImage).toBe(
            'var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))',
        );

        // Every one of border/backgroundColor/backgroundImage matches the
        // class default, and FooterRow has no other per-instance deviation
        // to force its own `#id` rule to materialise — so the whole batch is
        // dirty-only nulls and `StyleTarget.hasQueuedDeclarations`
        // (core/StyleTarget.ts) never flushes the rule at all, leaving every
        // key absent rather than an explicit `null` (contrast
        // SelectableListRow.classStyleDefaults.test.ts's `border` case,
        // which stays real because that row's still-undeduped `padding`
        // keeps its `#id` rule alive).
        expect(declarations.borderTop).toBeUndefined();
        expect(declarations.borderRight).toBeUndefined();
        expect(declarations.borderBottom).toBeUndefined();
        expect(declarations.borderLeft).toBeUndefined();
        expect(declarations.backgroundColor).toBeUndefined();
        expect(declarations.backgroundImage).toBeUndefined();
        expect(_ruleCacheHas('.FooterRow')).toBe(true);
        expect(footer.getBorderSize().top).toBe(1);
    });
});
