// Coverage for SelectableListRow's static `cursor`/`border` moving from
// imperative constructor setters into a registered
// `_defaultSelectableListRowOptions` class default — see
// plans/implemented/delegate-class-style-defaults-followups.md row 5.
// `setPadding` stays imperative (padding is not a `StyleBag`
// member — see the plan's `## Non-Goals`), so it is not asserted here.
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

    it('row 5: a rendered row carries no static cursor/border declaration on its own #id rule, the shared .SelectableListRow class rule exists, and getBorderSize still reports the 1px bottom separator', () => {
        const sink = installTestDOM(CONFIG);

        const list = new _List({ items: ['Apple', 'Banana'] });
        const row  = (list as any)._rowPool[0];

        const declarations = declarationsDuring(sink, idSelector(row), () => list.getElement(true));

        // cursor fully dedupes (no declaration on #id at all). border is
        // always-dispatched through the real setBorder() setter at
        // construction (Component.applyChromeOptions — see the plan's
        // ## Architecture Decisions), which materialises #id regardless, so
        // its now-matching value surfaces as an explicit removal in the same
        // batch rather than being skipped in silence — the net rendered CSS
        // (no declaration on #id, .SelectableListRow supplies the value) is
        // unchanged.
        expect(declarations.cursor).toBeUndefined();
        expect(declarations.borderTop).toBeNull();
        expect(declarations.borderRight).toBeNull();
        expect(declarations.borderBottom).toBeNull();
        expect(declarations.borderLeft).toBeNull();
        expect(_ruleCacheHas('.SelectableListRow')).toBe(true);
        expect(row.getBorderSize().bottom).toBe(1);
    });
});
