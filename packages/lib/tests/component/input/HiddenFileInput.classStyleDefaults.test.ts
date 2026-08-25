// Coverage for HiddenFileInput's static `displayed: false` moving from an
// imperative constructor setter into a registered `_defaultOptions` class
// default, forwarded via `super()`'s `subclassDefaults` parameter — see
// plans/implemented/class-tier-default-hoists-batch.md.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { FileField } from '~/component/input/FileField';

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

describe('HiddenFileInput static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('a rendered FileField\'s hidden input carries no static display declaration on its own #id rule, and .HiddenFileInput exists', () => {
        const sink  = installTestDOM(CONFIG);
        const field = new FileField();
        const input = (field as any)._input;

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(input), () => field.getElement(true));

        // The negative (#id) assertion below would stay green even if the
        // value never reached the class tier at all (e.g. a typo'd
        // subclassDefaults key) — so also pin the positive half: what
        // .HiddenFileInput itself declares. Read from the same render pass
        // rather than a second declarationsDuring call, since the second
        // call would find the rule already materialised and emit nothing.
        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.HiddenFileInput') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.display).toBe('none');

        // `display` matches the class default, but nothing else on this
        // instance ever deviates from its own `#id` baseline — unlike
        // SelectableListRow's still-real `padding`, which forces that row's
        // `#id` rule to materialise and is why its own matching `border`
        // shows up there as an explicit `null`
        // (SelectableListRow.classStyleDefaults.test.ts). With no other real
        // declaration to force materialisation here, the whole batch is
        // dirty-only nulls, so `StyleTarget.hasQueuedDeclarations`
        // (core/StyleTarget.ts) never flushes the rule at all and `display`
        // is simply absent — the same `toBeUndefined()` shape that file's
        // `cursor` case uses for the analogous reason.
        expect(declarations.display).toBeUndefined();
        expect(_ruleCacheHas('.HiddenFileInput')).toBe(true);
        expect(input.isDisplayed()).toBe(false);
    });
});
