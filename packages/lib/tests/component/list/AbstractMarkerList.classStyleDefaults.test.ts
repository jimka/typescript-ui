// Coverage for AbstractMarkerList's static `list-style-type: none` moving
// from a raw per-#id `setElementCSSRule` bypass into a shared, module-level
// `.MarkerList` class rule — a Style Audit dedup finding
// (`diagnostics/StyleAudit.ts`). `listStyleType` is not a `StyleBag`/
// `ComponentOptions` field, so this can't route through the ordinary
// `ownClassStyleDefaults`/`_defaultOptions` class-tier mechanism; the fix
// mirrors `PanelOverlayScroller` (core/Panel.ts) / `HeaderCellGlyph`
// (component/table/cell/Header.ts)'s shared-class-rule pattern instead.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { _BulletedList } from '~/component/list/BulletedList';
import { _NumberedList } from '~/component/list/NumberedList';

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
 * flattened into one key/value map. Copied from `ToolBar.classStyleDefaults.test.ts`.
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

describe('AbstractMarkerList static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('a rendered BulletedList carries no listStyleType declaration on its own #id rule, and .MarkerList carries it', () => {
        const sink = installTestDOM(CONFIG);

        // The shared .MarkerList rule materialises the moment the first
        // marker list is constructed (ensureMarkerListClassRule runs from
        // the constructor, not render), so the capture window has to start
        // before construction, not before getElement(true).
        const start = sink.writes.length;
        const list  = new _BulletedList();

        const declarations = declarationsDuring(sink, idSelector(list), () => list.getElement(true));

        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.MarkerList') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.listStyleType).toBe('none');

        expect(declarations.listStyleType).toBeUndefined();
        expect(_ruleCacheHas('.MarkerList')).toBe(true);
    });

    it('a rendered NumberedList shares the same .MarkerList rule and also carries no listStyleType on its own #id rule', () => {
        const sink = installTestDOM(CONFIG);
        const list = new _NumberedList();

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(list), () => list.getElement(true));

        // The rule is already registered from the BulletedList case above
        // (module-level, idempotent), so no second .MarkerList write is
        // expected here — only the negative (#id) half is worth asserting
        // per-class.
        expect(declarations.listStyleType).toBeUndefined();
        expect(_ruleCacheHas('.MarkerList')).toBe(true);
    });
});
