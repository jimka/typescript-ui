// @vitest-environment jsdom
//
// RadioButton checked-state + label + group-name coverage. All cases run on a
// bare (unmounted) radio button: setSelected updates state through the
// framework ListenerBag (no DOM event loop), the positional-text shim and the
// radioName back-compat field are pure option reads.
import { describe, it, expect } from 'vitest';
import { RadioButton } from '~/component/input/RadioButton';

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
