// Coverage for SelectableListRow's static `cursor`/`border`/`padding` moving
// from imperative constructor setters into a registered
// `_defaultSelectableListRowOptions` class default — see
// plans/implemented/delegate-class-style-defaults-followups.md row 5 for
// `cursor`/`border`, and plans/implemented/selectablelistrow-padding-resolvedeclarations-dedup.md
// for `padding`. `setPadding` stays imperative (the constructor always calls
// it); `ClassStyleRules.ts`'s `resolveDeclarations` now gains a matching
// `padding` case, so the class-tier default dedupes against the instance's
// own value. Before this fix, `padding`'s real value was the one thing that
// forced the row's own `#id` rule to materialise at all (there being no
// class-tier value yet to match against), so `border`'s already-matching
// entries rode along as explicit `null` removals in the same batch. Now that
// `padding` matches too, nothing in the batch is real any more, so the whole
// `#id` rule never materialises (`StyleTarget.hasQueuedDeclarations`) —
// `border`'s entries go from an explicit removal to simply absent, same as
// `cursor`.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { _List } from '~/component/list/List';

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
 * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
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

describe('SelectableListRow static style hoisting', () => {
    afterEach(() => DOM.reset());

    // Runs FIRST in this file so its capture window sees the one-time
    // `.SelectableListRow` class-tier rule write (`ensureClassStyleRule` is
    // memoized per-ctor in module-level state — `_bags`/`_ruleCache` — that
    // survives `DOM.reset()` between tests, so the content is written to the
    // sink only on the very first construction+render of a
    // `SelectableListRow` anywhere in this file; see
    // `TextInputClassTier.test.ts`'s own file banner for the same rule).
    // `row 5` below also constructs+renders a row, so if it ran first it
    // would silently consume that one-time write and this test would find
    // nothing.
    it('a rendered row carries no real padding declaration on its own #id rule, and .SelectableListRow carries it', () => {
        const sink = installTestDOM(CONFIG);

        const start = sink.writes.length;
        const list  = new _List({ items: ['Apple', 'Banana'] });
        const row   = (list as any)._rowPool[0];

        const declarations = declarationsDuring(sink, idSelector(row), () => list.getElement(true));

        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.SelectableListRow') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.padding).toBe('0px 8px 0px 8px');

        // The row's constructor always calls setPadding(), so padding is
        // always a key in `this._instanceStyle` (`writeStyle({ padding })`,
        // Component.ts:2265) — `flushStyleBag`'s per-key loop
        // (Component.ts:5362) therefore always takes the `declaredByInstance`
        // branch for it, and once the class tier's resolved value matches,
        // `matchesLower` is true. Unlike `border` (which still forced a real
        // #id write before this plan, since padding was the only real value
        // left in the batch), padding matching now leaves nothing real in
        // the row's whole resolved batch, so the `#id` rule never
        // materialises at all (`StyleTarget.hasQueuedDeclarations`) and the
        // key is simply absent — see `row 5` below for the same absence on
        // `border`/`cursor`.
        expect(declarations.padding).toBeUndefined();
        expect(_ruleCacheHas('.SelectableListRow')).toBe(true);
        expect(row.getPadding()?.getLeft()).toBe(8); // ROW_PADDING_X_PX
    });

    it('row 5: a rendered row carries no static cursor/border/padding declaration on its own #id rule, the shared .SelectableListRow class rule exists, and getBorderSize still reports the 1px bottom separator', () => {
        const sink = installTestDOM(CONFIG);

        const list = new _List({ items: ['Apple', 'Banana'] });
        const row  = (list as any)._rowPool[0];

        const declarations = declarationsDuring(sink, idSelector(row), () => list.getElement(true));

        // cursor, border, and (as of this plan) padding all now fully
        // dedupe onto .SelectableListRow — with nothing real left in the
        // row's own resolved batch, the #id rule never materialises at all
        // (StyleTarget.hasQueuedDeclarations), so every one of these keys is
        // absent (`undefined`), not an explicit `null` removal. The net
        // rendered CSS (no declaration on #id, .SelectableListRow supplies
        // every value) is unchanged.
        expect(declarations.cursor).toBeUndefined();
        expect(declarations.borderTop).toBeUndefined();
        expect(declarations.borderRight).toBeUndefined();
        expect(declarations.borderBottom).toBeUndefined();
        expect(declarations.borderLeft).toBeUndefined();
        expect(declarations.padding).toBeUndefined();
        expect(_ruleCacheHas('.SelectableListRow')).toBe(true);
        expect(row.getBorderSize().bottom).toBe(1);
    });
});
