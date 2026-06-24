import { describe, it, expect, afterEach, vi } from 'vitest';
import { ButtonGroup } from '~/overlay/ButtonGroup';
import { ToggleButton } from '~/component/button/ToggleButton';
import { RadioButton } from '~/component/input/RadioButton';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Bracket-accesses the private updateButtonStates — the exact method the
 *  (offline-undispatchable) `on("action")` listener calls. */
function selectVia(group: ButtonGroup, button: ToggleButton): void {
    (group as any).updateButtonStates(button);
}

describe('ButtonGroup selection model', () => {
    afterEach(() => DOM.reset());

    it('the else branch (already-selected initiator) deselects every sibling', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const c = new ToggleButton('C');
        const group = new ButtonGroup({ buttons: [a, b, c] });

        // Mirror the real action flow: the button toggles itself selected before
        // updateButtonStates runs, so the initiator is already selected and the
        // mutual-exclusivity (else) branch deselects the rest.
        b.setSelected(true);
        selectVia(group, b);

        expect(b.isSelected()).toBe(true);
        expect(a.isSelected()).toBe(false);
        expect(c.isSelected()).toBe(false);
    });

    it('the !isSelected branch only selects the initiator (siblings untouched)', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });

        // a starts selected; invoking updateButtonStates on the *unselected* b
        // hits the `!isSelected` true branch, which only selects b — it does NOT
        // deselect a in this branch (that is the documented two-branch split).
        a.setSelected(true);
        selectVia(group, b);

        expect(b.isSelected()).toBe(true);
        expect(a.isSelected()).toBe(true);
    });

    it('selection fires once with the initiator', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });
        const onSelection = vi.fn();

        group.on('selection', onSelection);

        b.setSelected(true);
        selectVia(group, b);

        expect(onSelection).toHaveBeenCalledOnce();
        expect(onSelection).toHaveBeenCalledWith(b);
    });

    it('re-selecting the already-selected initiator keeps siblings deselected', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });

        b.setSelected(true);
        selectVia(group, b);
        selectVia(group, b);            // re-run on the already-selected initiator

        expect(b.isSelected()).toBe(true);
        expect(a.isSelected()).toBe(false);
    });

    it('addButtons flattens nested arrays and getButtons returns them all', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const c = new ToggleButton('C');
        const d = new ToggleButton('D');
        const group = new ButtonGroup();

        group.addButtons(a, [b, c], d);

        expect(group.getButtons()).toHaveLength(4);
        expect(group.getButtons()).toEqual([a, b, c, d]);
    });

    it('removeButton drops the member', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const b = new ToggleButton('B');
        const group = new ButtonGroup({ buttons: [a, b] });

        group.removeButton(a);

        expect(group.getButtons()).toEqual([b]);
    });

    it('removeButton of a non-member is a no-op', () => {
        installTestDOM(CONFIG);

        const a = new ToggleButton('A');
        const stray = new ToggleButton('S');
        const group = new ButtonGroup({ buttons: [a] });

        expect(() => group.removeButton(stray)).not.toThrow();
        expect(group.getButtons()).toEqual([a]);
    });

    it('RadioButton members receive the shared radioName (the group id)', () => {
        installTestDOM(CONFIG);

        const r1 = new RadioButton('One');
        const r2 = new RadioButton('Two');
        const group = new ButtonGroup({ buttons: [r1, r2] });

        const groupId = (group as any)._groupId as string;

        expect(r1.getRadioName()).toBe(groupId);
        expect(r2.getRadioName()).toBe(groupId);
    });
});
