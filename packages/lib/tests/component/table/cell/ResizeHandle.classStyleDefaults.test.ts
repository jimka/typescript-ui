// Coverage for ResizeHandle's static `cursor`/`backgroundImage` moving from
// imperative constructor setters into a registered `_defaultResizeHandleOptions`
// class default — see plans/implemented/delegate-class-style-defaults-followups.md
// row 3. The pre-existing hand-rolled `.ResizeHandle` class rule (position,
// top, right, width, height, z-index — see `ensureResizeHandleClassRule`) is a
// second, separate `StyleRule` sharing the same selector name; CSS allows
// multiple rules per selector, and the two never declare the same property, so
// both apply without conflict.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { ResizeHandle } from '~/component/table/cell/ResizeHandle';

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

describe('ResizeHandle static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('row 3: a rendered handle carries no static cursor/backgroundImage declaration on its own #id rule, and the shared .ResizeHandle class rule exists once rendered', () => {
        const sink = installTestDOM(CONFIG);

        const handle = new ResizeHandle();
        const declarations = declarationsDuring(sink, idSelector(handle), () => handle.getElement(true));

        expect(declarations.cursor).toBeUndefined();
        expect(declarations.backgroundImage).toBeUndefined();
        expect(_ruleCacheHas('.ResizeHandle')).toBe(true);
    });
});
