// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for
// plans/implemented/text-lineheight-write-path-and-value-class-sharing.md:
// Text's numeric-pixel setLineHeight()/centerInHeight() now share one CSS
// rule per concrete class per resolved pixel value (`.ClassName.lh<value>`),
// via createStateStyleRule/ensureClassStateRule keyed by a value-derived
// suffix, instead of each instance writing its own #id declaration. The
// CSS-var/theme-revert path now also dedupes against the class-tier default
// through the reconciled write path. See the plan's Architecture Decisions
// for why this reuses the state-tier mechanism with a dynamically-computed
// suffix rather than a fixed named state.
//
// declarationsDuring/idSelector copied locally, matching
// TextClassStyleHoisting.test.ts's convention (see that file's header for
// why this is copied rather than imported — the `.ClassName`/state-rule
// registries in `core/ClassStyleRules.ts` are module state that survives
// `DOM.reset()` within one test file).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Text } from '~/component/input/Text';
import { SelectableText } from '~/component/input/SelectableText';
import { Label } from '~/component/input/Label';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule within `writes`,
 * flattened into one key/value map (last write per key wins, matching
 * cascade-within-a-rule semantics). Only `setRuleStyles` ops whose selector
 * (`args[0]`) matches are counted.
 */
function declarationsIn(
    writes: RecordingDOMSink['writes'],
    selector: string,
): Record<string, string | null> {
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

/** `declarationsIn`, capturing the writes `fn()` produces itself. */
function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    return declarationsIn(sink.writes.slice(start), selector);
}

/**
 * The `addClass`/`removeClass` patches from `apply` writes within `writes` —
 * the class-toggle side of `applyLineHeightValueClass`/`clearLineHeightValueClass`.
 * Mirrors `Checkbox.stateClassHoisting.test.ts`'s inline `toggleWrite` lookup,
 * generalised to collect every matching write instead of just the first.
 */
function classToggleWrites(
    writes: RecordingDOMSink['writes'],
): Array<{ removeClass?: string[]; addClass?: string[] }> {
    return writes
        .filter((w) => w.op === 'apply')
        .map((w) => w.args[1] as { removeClass?: string[]; addClass?: string[] })
        .filter((patch) => patch.addClass !== undefined || patch.removeClass !== undefined);
}

describe('Text numeric-pixel lineHeight value-class sharing', () => {
    it('row 1: two separate, already-rendered SelectableText instances resolving the same pixel value write no real lineHeight to their own #id rule (only an explicit removal, reconciling the prior default), and both carry the shared class', () => {
        const sink = DOM.sink as RecordingDOMSink;

        const a = new SelectableText('a');
        a.getElement(true);
        const b = new SelectableText('b');
        b.getElement(true);

        const writesA = (() => {
            const start = sink.writes.length;
            a.setLineHeight(18);
            return sink.writes.slice(start);
        })();
        // Entering numeric mode from the default additive rule (still active
        // at this point, since neither instance has touched lineHeight yet)
        // reconciles away whatever #id inherited from that mode — a `null`
        // removal, not a real value. See the CSS-var → numeric regression
        // test below for the case this reconcile exists to fix.
        expect(declarationsIn(writesA, idSelector(a)).lineHeight).toBeNull();
        expect(classToggleWrites(writesA)).toEqual([{ removeClass: [], addClass: ['lh18px'] }]);

        const writesB = (() => {
            const start = sink.writes.length;
            b.setLineHeight(18);
            return sink.writes.slice(start);
        })();
        expect(declarationsIn(writesB, idSelector(b)).lineHeight).toBeNull();
        expect(classToggleWrites(writesB)).toEqual([{ removeClass: [], addClass: ['lh18px'] }]);

        expect(_ruleCacheHas('.SelectableText.lh18px')).toBe(true);
    });

    it('row 2: setLineHeight(18) then setLineHeight(24) on a rendered SelectableText swaps the value-class token in one apply write; only the first (mode-entering) call reconciles #id, the second writes nothing further to it', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new SelectableText('x');
        t.getElement(true);

        const decl1 = declarationsDuring(sink, idSelector(t), () => t.setLineHeight(18));
        // First numeric call: entering numeric mode from the default additive
        // rule reconciles it away on #id (see row 1).
        expect(decl1.lineHeight).toBeNull();

        const start = sink.writes.length;
        t.setLineHeight(24);
        const writes = sink.writes.slice(start);

        // Second numeric call: already in numeric mode, so #id never carries
        // a real declaration to reconcile away — nothing queued for it.
        expect(declarationsIn(writes, idSelector(t)).lineHeight).toBeUndefined();
        expect(classToggleWrites(writes)).toEqual([{ removeClass: ['lh18px'], addClass: ['lh24px'] }]);

        expect(_ruleCacheHas('.SelectableText.lh24px')).toBe(true);
    });

    it("row 3: switching from numeric mode to CSS-var mode removes the value class and writes a real lineHeight declaration to #id", () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new SelectableText('x');
        t.getElement(true);
        t.setLineHeight(18);

        const start = sink.writes.length;
        t.setLineHeight('--my-var');
        const writes = sink.writes.slice(start);

        expect(classToggleWrites(writes)).toEqual([{ removeClass: ['lh18px'] }]);
        expect(declarationsIn(writes, idSelector(t)).lineHeight).toBe(
            'var(--my-var, calc(1em + var(--ts-ui-line-padding, 2px)))',
        );
    });

    it('switching from CSS-var mode back to numeric mode clears the stale real lineHeight declaration #id carried, so it cannot outrank the new shared value-class rule', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new SelectableText('x');
        t.getElement(true);
        // CSS-var mode writes a real declaration straight to #id (row 3).
        t.setLineHeight('--my-var');

        const start = sink.writes.length;
        t.setLineHeight(18);
        const writes = sink.writes.slice(start);

        expect(classToggleWrites(writes)).toEqual([{ removeClass: [], addClass: ['lh18px'] }]);
        // #id's prior var(...) declaration must be reconciled away (queued as
        // an explicit removal), not left in place — #id's (1,0,0) specificity
        // would otherwise permanently outrank the (0,2,0) .SelectableText.lh18px
        // rule applyLineHeightValueClass just pointed this instance at.
        expect(declarationsIn(writes, idSelector(t)).lineHeight).toBeNull();
    });

    it('row 4: centerInHeight(28) then centerInHeight(null) behaves like row 1, then reverts by removing the class and queuing a #id removal (the reverted value matches the class-tier default)', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x');
        t.getElement(true);

        const start1 = sink.writes.length;
        t.centerInHeight(28);
        const writes1 = sink.writes.slice(start1);
        // Entering numeric mode from the default additive rule, same as row 1.
        expect(declarationsIn(writes1, idSelector(t)).lineHeight).toBeNull();
        expect(classToggleWrites(writes1)).toEqual([{ removeClass: [], addClass: ['lh28px'] }]);

        const start2 = sink.writes.length;
        t.centerInHeight(null);
        const writes2 = sink.writes.slice(start2);

        expect(classToggleWrites(writes2)).toEqual([{ removeClass: ['lh28px'] }]);
        // #id already materialises regardless of this plan (the always-written
        // textOverflow declaration forces it), so the reverted value — which
        // matches the class-tier ADDITIVE_LINE_HEIGHT_RULE default — queues an
        // explicit removal rather than omitting the key.
        expect(declarationsIn(writes2, idSelector(t)).lineHeight).toBeNull();
    });

    it('row 5: a fresh Text, never touching lineHeight, queues a bare #id removal for it (materialised only because textOverflow forces #id to exist) rather than a real value', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x');

        const declarations = declarationsDuring(sink, idSelector(t), () => t.getElement(true));

        expect(declarations.lineHeight).toBeNull();
        expect(declarations.textOverflow).toBe('ellipsis');
    });

    it('row 6: setLineHeight before mount produces no apply write; the class is applied at render via the render() override', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new SelectableText('x');

        expect(t.getElement()).toBeFalsy();

        const start1 = sink.writes.length;
        t.setLineHeight(22);
        expect(classToggleWrites(sink.writes.slice(start1))).toEqual([]);

        const start2 = sink.writes.length;
        t.getElement(true);
        // Component.render()'s own base-class apply write (`ts-ui-component`,
        // `SelectableText`) lands in this same window — assert on the specific
        // value-class write rather than the full array.
        expect(classToggleWrites(sink.writes.slice(start2))).toContainEqual({ addClass: ['lh22px'] });
    });

    it('row 7: SelectableText and Label independently resolving the same pixel value get independent class rules, keyed by concrete constructor', () => {
        const st = new SelectableText('x');
        st.getElement(true);
        st.setLineHeight(22);

        const label = new Label('x', 'field-id');
        label.getElement(true);
        label.setLineHeight(22);

        expect(_ruleCacheHas('.SelectableText.lh22px')).toBe(true);
        expect(_ruleCacheHas('.Label.lh22px')).toBe(true);
    });
});
