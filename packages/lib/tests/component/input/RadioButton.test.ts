//
// RadioButton checked-state + label + group-name coverage. All cases run on a
// bare (unmounted) radio button: setSelected updates state through the
// framework ListenerBag (no DOM event loop), the positional-text shim and the
// radioName back-compat field are pure option reads.
import { describe, it, expect, afterEach } from 'vitest';
import { RadioButton } from '~/component/input/RadioButton';
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

describe('RadioButton positional text label', () => {
    it('uses the positional text arg as the label when no label/text option is present', () => {
        expect(new RadioButton('Hello').getLabel()).toBe('Hello');
    });

    it('lets an explicit label option win over the positional text arg', () => {
        expect(new RadioButton('Positional', { label: 'Option' }).getLabel()).toBe('Option');
    });

    it('falls back to the text option as the label when label is absent', () => {
        expect(new RadioButton(undefined, { text: 'FromText' }).getLabel()).toBe('FromText');
    });
});

describe('RadioButton selected transitions', () => {
    it('selects via setSelected(true)', () => {
        const rb = new RadioButton();
        rb.setSelected(true);

        expect(rb.isSelected()).toBe(true);
    });

    it('programmatically deselects a selected radio via setSelected(false)', () => {
        const rb = new RadioButton(undefined, { selected: true });
        rb.setSelected(false);

        expect(rb.isSelected()).toBe(false);
    });

    it('treats a repeated setSelected(false) on an unselected radio as a no-op', () => {
        const rb = new RadioButton();

        let changes = 0;
        rb.on('change', () => {
            changes += 1;
        });

        rb.setSelected(false);
        rb.setSelected(false);

        expect(rb.isSelected()).toBe(false);
        expect(changes).toBe(0);
    });

    it('fires change once on a real transition', () => {
        const rb = new RadioButton();

        let changes = 0;
        rb.on('change', () => {
            changes += 1;
        });

        rb.setSelected(true);
        rb.setSelected(true); // no-op: already selected.

        expect(changes).toBe(1);
    });
});

describe('RadioButton value/selected aliasing', () => {
    it('aliases the value option onto selected when selected is absent', () => {
        expect(new RadioButton(undefined, { value: true }).isSelected()).toBe(true);
    });

    it('mirrors getValue/setValue onto isSelected/setSelected', () => {
        const rb = new RadioButton();
        expect(rb.getValue()).toBe(false);

        rb.setValue(true);
        expect(rb.isSelected()).toBe(true);
    });
});

describe('RadioButton group-name shim', () => {
    it('defaults the radio name to null', () => {
        expect(new RadioButton().getRadioName()).toBe(null);
    });

    it('round-trips the radio name through setRadioName and clears it', () => {
        const rb = new RadioButton();
        rb.setRadioName('group-a');
        expect(rb.getRadioName()).toBe('group-a');

        rb.clearRadioName();
        expect(rb.getRadioName()).toBe(null);
    });
});

describe('RadioButton label round-trip', () => {
    it('reads back a label and clears it with null', () => {
        const rb = new RadioButton(undefined, { label: 'Choice' });
        expect(rb.getLabel()).toBe('Choice');

        rb.setLabel(null);
        expect(rb.getLabel()).toBe(null);
    });
});

describe('RadioButton delegate static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('row 7: a rendered _ring carries no static size/cursor declaration on its own #id rule', () => {
        const sink = installTestDOM(CONFIG);
        const rb   = new RadioButton() as any;
        const ring = rb._ring;

        const declarations = declarationsDuring(sink, idSelector(ring), () => rb.getElement(true));

        // `_ring`'s real backgroundColor/border/borderRadius force #id to
        // materialise regardless, so since
        // plans/implemented/reconciled-write-path-widening.md, minWidth/
        // minHeight/maxWidth/maxHeight — which match RadioButtonRing's own
        // class defaults — surface as explicit removals in the same batch
        // rather than being skipped in silence; the net rendered CSS (no
        // declaration on #id, the class rule supplies the value) is unchanged.
        expect(declarations.minWidth).toBeNull();
        expect(declarations.minHeight).toBeNull();
        expect(declarations.maxWidth).toBeNull();
        expect(declarations.maxHeight).toBeNull();
        // cursor is untouched by that plan — still skip-based — so a match
        // still leaves no trace at all.
        expect(declarations.cursor).toBeUndefined();
    });

    it('row 8: a rendered _dot writes nothing to its own #id rule', () => {
        // plans/glyph-preferredsize-reconciled-write-path.md closes the size
        // gap too: RadioButtonDot now defaults minSize/maxSize as well as
        // foregroundColor, so color and every size key reconcile to removals
        // in the same batch and a rule with no real declaration never
        // materialises.
        const sink = installTestDOM(CONFIG);
        const rb   = new RadioButton() as any;
        const dot  = rb._dot;

        const declarations = declarationsDuring(sink, idSelector(dot), () => rb.getElement(true));

        expect(declarations).toEqual({});
    });

    it('row 9: the shared .RadioButtonRing/.RadioButtonDot class rules exist once RadioButtons have rendered', () => {
        installTestDOM(CONFIG);

        new RadioButton().getElement(true);
        new RadioButton().getElement(true);

        expect(_ruleCacheHas('.RadioButtonRing')).toBe(true);
        expect(_ruleCacheHas('.RadioButtonDot')).toBe(true);
    });
});
