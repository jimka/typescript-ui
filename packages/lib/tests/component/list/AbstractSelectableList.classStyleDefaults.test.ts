// Coverage for AbstractSelectableList's 100×100 minSize floor moving from an
// imperative constructor `setMinSize` call into a registered
// `_defaultAbstractSelectableListOptions` class default — see
// plans/implemented/abstractselectablelist-minsize-fallback-dedup.md.
// `minWidth`/`minHeight` are FRAMEWORK_BASELINE_KEYS, so a class-default-only
// value still queues an explicit `null` removal on the instance's own `#id`
// rule rather than being skipped outright (unlike padding/cursor/border in
// SelectableListRow.classStyleDefaults.test.ts, which go fully absent).
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _List } from '~/component/list/List';
import { _MultiSelectList } from '~/component/list/MultiSelectList';

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

describe('AbstractSelectableList minSize class-default hoisting', () => {
    afterEach(() => DOM.reset());

    // Runs FIRST in this file so its capture window sees the one-time
    // `.AbstractSelectableList` class-tier rule write (`ensureClassStyleRule`
    // is memoized per-ctor in module-level state that survives `DOM.reset()`
    // between tests, so the content is written to the sink only on the very
    // first construction+render of an `AbstractSelectableList` subclass
    // anywhere in this file). If a later test ran first, it would silently
    // consume that one-time write and this test would find nothing.
    it('the shared .AbstractSelectableList class rule carries the 100x100 floor exactly once, for every list', () => {
        const sink = installTestDOM(CONFIG);

        const start = sink.writes.length;
        const listA = new _List({ items: ['Apple'] });
        const listB = new _List({ items: ['Banana'] });
        const multi = new _MultiSelectList({ items: ['Cherry'] });
        listA.getElement(true);
        listB.getElement(true);
        multi.getElement(true);

        const classDeclarations: Record<string, string | null> = {};
        let classRuleWrites = 0;
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.AbstractSelectableList') {
                Object.assign(classDeclarations, w.args[1]);
                if (Object.prototype.hasOwnProperty.call(w.args[1] as Record<string, unknown>, 'minWidth')) {
                    classRuleWrites++;
                }
            }
        }

        expect(classDeclarations.minWidth).toBe('100px');
        expect(classDeclarations.minHeight).toBe('100px');
        expect(classRuleWrites).toBe(1);
    });

    it('default floor still resolves for MultiSelectList, without rendering', () => {
        const multi = new _MultiSelectList({});
        expect(multi.getMinSizeConstraint()).toEqual({ width: 100, height: 100 });
    });

    it('a runtime setMinSize still wins over the class default', () => {
        const list = new _List({});
        list.setMinSize({ width: 0, height: 0 });
        expect(list.getMinSizeConstraint()).toEqual({ width: 0, height: 0 });
    });

    it('a rendered list carries no real minWidth/minHeight declaration on its own #id rule', () => {
        const sink = installTestDOM(CONFIG);

        const list = new _List({ items: ['Apple'] });
        const declarations = declarationsDuring(sink, idSelector(list), () => list.getElement(true));

        expect(declarations.minWidth ?? null).toBeNull();
        expect(declarations.minHeight ?? null).toBeNull();
    });
});
