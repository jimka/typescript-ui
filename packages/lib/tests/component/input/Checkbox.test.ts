//
// Checkbox checked-state coverage. Most cases run on a bare (unmounted)
// checkbox: setSelected guards its synthetic `click` behind `if
// (this.getElement())`, so unmounted it only console.warns and the state flip
// still happens. The one mount-requiring case asserts the `on("action")`
// synthetic-click fan-out and uses the TestDOM ritual copied from
// tests/component/layout/Tab.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Checkbox } from '~/component/input/Checkbox';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
import fontMetrics from '../../dom/font-metrics.test-font.json';

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

describe('Checkbox value/selected aliasing', () => {
    it('aliases the value option onto selected when selected is absent', () => {
        expect(new Checkbox({ value: true }).isSelected()).toBe(true);
    });

    it('lets an explicit selected win over value', () => {
        expect(new Checkbox({ value: true, selected: false }).isSelected()).toBe(false);
    });

    it('mirrors getValue/setValue onto isSelected/setSelected', () => {
        const cb = new Checkbox();
        expect(cb.getValue()).toBe(false);

        cb.setValue(true);
        expect(cb.isSelected()).toBe(true);
        expect(cb.getValue()).toBe(true);
    });
});

describe('Checkbox setSelected transitions', () => {
    afterEach(() => vi.restoreAllMocks());

    it('flips state and warns (no synthetic click) when unmounted', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cb   = new Checkbox();

        cb.setSelected(true);

        expect(cb.isSelected()).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('fires change exactly once across a flip and a redundant set', () => {
        // Silence the unmounted-setSelected console.warn; not asserted here.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cb = new Checkbox();

        let changes = 0;
        cb.on('change', () => {
            changes += 1;
        });

        cb.setSelected(true);
        cb.setSelected(true); // no-op guard: already selected, not indeterminate.

        expect(cb.isSelected()).toBe(true);
        expect(changes).toBe(1);
    });
});

describe('Checkbox indeterminate force-out', () => {
    afterEach(() => vi.restoreAllMocks());

    it('enters the mixed state via setIndeterminate', () => {
        const cb = new Checkbox();
        cb.setIndeterminate(true);

        expect(cb.isIndeterminate()).toBe(true);
    });

    it('clears indeterminate and lands selected on a subsequent setSelected(true)', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const cb = new Checkbox();
        cb.setIndeterminate(true);
        cb.setSelected(true);

        expect(cb.isIndeterminate()).toBe(false);
        expect(cb.isSelected()).toBe(true);
    });
});

describe('Checkbox label round-trip', () => {
    it('reads back a label and clears it with null', () => {
        const cb = new Checkbox({ label: 'Accept' });
        expect(cb.getLabel()).toBe('Accept');

        cb.setLabel(null);
        expect(cb.getLabel()).toBe(null);
    });
});

describe('Checkbox notifyChange fan-out (binding)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('fires both change (with value) and binding (no args) on a transition', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const cb = new Checkbox();

        let changeValue: boolean | null = null;
        let bindings = 0;
        cb.on('change', (v: boolean) => {
            changeValue = v;
        });
        cb.on('binding', () => {
            bindings += 1;
        });

        cb.setSelected(true);

        expect(changeValue).toBe(true);
        expect(bindings).toBe(1);
    });
});

describe('Checkbox action fan-out (mounted)', () => {
    afterEach(() => DOM.reset());

    it('dispatches a synthetic click on a programmatic setSelected once mounted', () => {
        // The offline RecordingDOMSink records DOM writes but runs no event
        // loop, so a real `on("action")` callback cannot be invoked here
        // (mirrors tests/unit/core/Event.test.ts, which asserts the recorded
        // dispatchEvent write rather than listener invocation). The `action`
        // listener is wired through `click`, so the contract under test —
        // "a mounted setSelected synthesizes the click" — is the recorded
        // dispatchEvent("click") write that the action path rides on.
        const sink = installTestDOM(CONFIG);

        const host = new Container({});
        const cb   = new Checkbox();
        host.addComponent(cb);
        // Realise the element so setSelected's synthetic Event.fireEvent("click")
        // dispatches to a mounted node instead of console-warning.
        host.getElement(true);
        cb.getElement(true);
        // Drain construction-time pending layouts on the host subtree while the
        // elements are valid, then pause both. The module-level pending-layout
        // set outlives this file, so an undrained component would flush on a
        // later file's real rAF after this DOM was reset — a stray "DOM handle
        // not registered" error. Draining + pausing keeps the queue clean.
        host.flushLayout();
        host.pauseLayout();
        cb.flushLayout();
        cb.pauseLayout();

        cb.setSelected(true);

        expect(cb.isSelected()).toBe(true);
        expect(sink.writes.some((w: any) => w.op === 'dispatchEvent' && w.args[0] === 'click')).toBe(true);
    });
});

describe('Checkbox delegate static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('row 1: a rendered _box carries no static size/cursor declaration on its own #id rule', () => {
        const sink = installTestDOM(CONFIG);
        const cb   = new Checkbox() as any;
        const box  = cb._box;

        const declarations = declarationsDuring(sink, idSelector(box), () => cb.getElement(true));

        // `_box`'s backgroundColor/border/borderRadius are now all class
        // defaults, so nothing on a default-styled `_box` deviates from
        // `.CheckboxBox` at all — `#id` never materialises, and every key
        // here (including size) is an absent write, not an explicit removal.
        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        // cursor is untouched by that plan — still skip-based — so a match
        // still leaves no trace at all.
        expect(declarations.cursor).toBeUndefined();
    });

    it('row 2: a rendered _check carries no static color declaration on its own #id rule', () => {
        // Size (minWidth/minHeight/maxWidth/maxHeight) is deliberately not
        // asserted here — see CheckboxCheckGlyph's doc comment: Glyph.applyOptions
        // always re-pins minSize/maxSize via a real setter call when a preferred
        // size resolves, so size can never dedupe onto the class rule for a
        // Glyph delegate and stays an imperative, per-instance #id write.
        const sink  = installTestDOM(CONFIG);
        const cb    = new Checkbox() as any;
        const check = cb._check;

        const declarations = declarationsDuring(sink, idSelector(check), () => cb.getElement(true));

        // CheckboxCheckGlyph defaults foregroundColor, and #id already
        // materialises regardless (Glyph's preferredSize-driven minSize/maxSize
        // setter calls always write real, per-instance values — see the doc
        // comment above). Since
        // plans/implemented/reconciled-write-path-widening.md, a `color` that
        // matches that class default now surfaces in the same batch as an
        // explicit removal instead of being skipped in silence; the net
        // rendered CSS (no declaration on #id, `.CheckboxCheckGlyph` supplies
        // the value) is unchanged.
        expect(declarations.color).toBeNull();
    });

    it('row 3: a rendered _dash carries no static size/backgroundColor declaration on its own #id rule', () => {
        const sink = installTestDOM(CONFIG);
        const cb   = new Checkbox() as any;
        const dash = cb._dash;

        const declarations = declarationsDuring(sink, idSelector(dash), () => cb.getElement(true));

        // No minHeight check: _dash never had a registered minSize, before or after.
        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(declarations.backgroundColor).toBeUndefined();
    });

    it('row 4: the shared .CheckboxBox/.CheckboxCheckGlyph/.CheckboxDash class rules exist once Checkboxes have rendered', () => {
        installTestDOM(CONFIG);

        new Checkbox().getElement(true);
        new Checkbox().getElement(true);

        expect(_ruleCacheHas('.CheckboxBox')).toBe(true);
        expect(_ruleCacheHas('.CheckboxCheckGlyph')).toBe(true);
        expect(_ruleCacheHas('.CheckboxDash')).toBe(true);
    });
});
