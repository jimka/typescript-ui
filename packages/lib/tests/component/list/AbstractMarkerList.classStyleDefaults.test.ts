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

    // `.MarkerList` (construction-time, `ensureMarkerListClassRule`) and
    // `.BulletedList`/`.NumberedList` (render-time, hierarchy-aware
    // `ensureClassStyleRule`) are both memoized per-ctor in module-level
    // state (`_bags`/`_ruleCache`) that survives `DOM.reset()` between
    // tests, so each rule's content is written to the sink only on the very
    // first construction+render of that class anywhere in this file (see
    // `TextInputClassTier.test.ts`'s own file banner for the same
    // constraint). A single `new _BulletedList()` + `getElement(true)` pass
    // triggers both writes at once, so both are captured from the same
    // window below rather than in two separate tests, one of which would
    // otherwise find the rule already-materialised and silently empty.
    it('a rendered BulletedList carries no listStyleType/padding declaration on its own #id rule, and .MarkerList/.BulletedList carry them', () => {
        const sink = installTestDOM(CONFIG);

        // The shared .MarkerList rule materialises the moment the first
        // marker list is constructed (ensureMarkerListClassRule runs from
        // the constructor, not render), so the capture window has to start
        // before construction, not before getElement(true).
        const start = sink.writes.length;
        const list  = new _BulletedList();

        const declarations = declarationsDuring(sink, idSelector(list), () => list.getElement(true));

        const markerListDeclarations: Record<string, string | null> = {};
        const bulletedListDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op !== 'setRuleStyles') {
                continue;
            }
            if (w.args[0] === '.MarkerList') {
                Object.assign(markerListDeclarations, w.args[1]);
            } else if (w.args[0] === '.BulletedList') {
                Object.assign(bulletedListDeclarations, w.args[1]);
            }
        }
        expect(markerListDeclarations.listStyleType).toBe('none');
        expect(bulletedListDeclarations.padding).toBe('0px 0px 0px 25px');

        expect(declarations.listStyleType).toBeUndefined();
        expect(declarations.padding).toBeUndefined(); // BulletedList never calls setPadding itself
        expect(_ruleCacheHas('.MarkerList')).toBe(true);
        expect(_ruleCacheHas('.BulletedList')).toBe(true);
        expect(list.getPadding()?.getLeft()).toBe(25);
    });

    it('a rendered NumberedList shares the .MarkerList rule and carries no listStyleType/padding on its own #id rule, with .NumberedList carrying padding independently', () => {
        const sink = installTestDOM(CONFIG);
        const list = new _NumberedList();

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(list), () => list.getElement(true));

        // .MarkerList is already registered from the BulletedList case above
        // (module-level, idempotent), so no second .MarkerList write is
        // expected here — only .NumberedList's own first-time content write
        // is worth asserting positively; the negative (#id) half is worth
        // asserting per-class for both keys.
        const numberedListDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.NumberedList') {
                Object.assign(numberedListDeclarations, w.args[1]);
            }
        }
        expect(numberedListDeclarations.padding).toBe('0px 0px 0px 25px');

        expect(declarations.listStyleType).toBeUndefined();
        expect(declarations.padding).toBeUndefined();
        expect(_ruleCacheHas('.MarkerList')).toBe(true);
        expect(_ruleCacheHas('.NumberedList')).toBe(true);
        expect(list.getPadding()?.getLeft()).toBe(25);
    });
});
