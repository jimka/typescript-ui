// Coverage for ToolBar's static horizontal/default `border` moving from an
// imperative constructor setter into a registered `ownClassStyleDefaults`
// class default — see plans/implemented/class-tier-default-hoists-batch.md.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { ToolBar } from '~/component/menubar/ToolBar';

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

describe('ToolBar static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('a horizontal ToolBar carries no static border declaration on its own #id rule, and .ToolBar exists', () => {
        const sink = installTestDOM(CONFIG);
        const bar  = new ToolBar();

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(bar), () => bar.getElement(true));

        // The negative (#id) assertions below would stay green even if
        // ownClassStyleDefaults dropped a field entirely (this is exactly
        // what happened: a first draft declared only `{ border: {...} }`,
        // which — because declaring ownClassStyleDefaults at all flips
        // chainParticipates(ToolBar) to true and stops the class rule from
        // consulting _defaultOptions — silently dropped backgroundColor and
        // overflow out of .ToolBar, and every #id-only assertion here still
        // passed). So also pin the positive half: what .ToolBar itself
        // declares. Read from the same render pass rather than a second
        // declarationsDuring call, since the second call would find the
        // rule already materialised and emit nothing.
        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.ToolBar') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.borderBottom).toBe('1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))');
        expect(classDeclarations.backgroundColor).toBe('var(--ts-ui-toolbar-bg, rgb(245, 245, 245))');
        expect(classDeclarations.overflowX).toBe('clip');
        expect(classDeclarations.overflowY).toBe('clip');

        // `border` matches the class default, and `backgroundColor` (the
        // bar's only other configured chrome) never reaches the instance
        // layer at all — `_defaultToolBarOptions.backgroundColor` only
        // dispatches through `Component.applyOptions`'s ordinary
        // `options.backgroundColor !== undefined` gate, which a plain
        // `new ToolBar()` never satisfies (unlike `border`, which
        // `applyChromeOptions` always-dispatches from the class default).
        // With nothing left to force materialisation, the whole batch is
        // dirty-only nulls and `StyleTarget.hasQueuedDeclarations`
        // (core/StyleTarget.ts) never flushes the rule at all, leaving every
        // key absent rather than an explicit `null` (see
        // FooterRow.classStyleDefaults.test.ts for the same shape). The
        // vertical case below keeps a real `borderRight`, which does force
        // materialisation.
        expect(declarations.borderTop).toBeUndefined();
        expect(declarations.borderRight).toBeUndefined();
        expect(declarations.borderBottom).toBeUndefined();
        expect(declarations.borderLeft).toBeUndefined();
        expect(_ruleCacheHas('.ToolBar')).toBe(true);
    });

    it('a vertical ToolBar keeps a real borderRight and clears the class tier\'s borderBottom explicitly', () => {
        const sink = installTestDOM(CONFIG);
        const bar  = new ToolBar({ orientation: 'vertical' });

        const declarations = declarationsDuring(sink, idSelector(bar), () => bar.getElement(true));

        expect(declarations.borderRight).toBe('1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))');
        expect(declarations.borderBottom).toBe('none');
        expect(declarations.borderTop).toBeNull();
        expect(declarations.borderLeft).toBeNull();
    });
});
