//
// Coverage for the single-line input min-height pin: every single-line input
// pins preferred and max height to the one-line box height `h` but, before
// this fix, never pinned a minimum, so `VBox`/`HBox` (which sum pure child
// minimums) collapsed a stack of fields to ~0 instead of one line per field.
// The fix pins min-height (Y-axis only) to `h` in each leaf, leaving
// min-width `0` so the field stays horizontally flexible.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TextField } from '~/component/input/TextField';
import { PasswordField } from '~/component/input/PasswordField';
import { UsernameField } from '~/component/input/UsernameField';
import { ComboBox } from '~/component/input/ComboBox';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { DateField } from '~/component/input/DateField';
import { AutoCompleteField } from '~/component/input/AutoCompleteField';
import { TextArea } from '~/component/input/TextArea';
import { Panel } from '~/core/Panel';
import { VBox } from '~/layout/VBox';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Util } from '~/core/Util';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

const SINGLE_LINE_INPUTS: [string, () => { getMinSize(): { width: number; height: number } | null; getPreferredSize(): { width: number; height: number } | null }][] = [
    ['TextField',         () => new TextField()],
    ['PasswordField',     () => new PasswordField()],
    ['UsernameField',     () => new UsernameField()],
    ['ComboBox',          () => new ComboBox()],
    ['NumberSpinner',     () => new NumberSpinner()],
    ['DateField',         () => new DateField()],
    ['AutoCompleteField', () => new AutoCompleteField()],
];

describe('Single-line input min-height pin', () => {
    for (const [name, make] of SINGLE_LINE_INPUTS) {
        it(`${name}: min-height equals preferred (one-line) height`, () => {
            const input = make();

            const min  = input.getMinSize();
            const pref = input.getPreferredSize();

            expect(min).not.toBeNull();
            expect(pref).not.toBeNull();
            expect(min!.height).toBeGreaterThan(0);
            expect(min!.height).toBe(pref!.height);
        });

        // NumberSpinner is excluded here: its inner SpinButton column is
        // itself fixed-size (`SpinButton.setMinSize({ width: 18, height: halfHeight })`),
        // so the manager already reports a non-zero content-derived min-width
        // unrelated to this fix. The height-only pin merges via `Math.max`
        // and never lowers that pre-existing floor — covered separately below.
        if (name === 'NumberSpinner') {
            continue;
        }

        it(`${name}: min-width stays 0 (horizontally flexible)`, () => {
            const input = make();

            expect(input.getMinSize()!.width).toBe(0);
        });
    }

    it("NumberSpinner: the height-only pin doesn't touch its composite min-width floor", () => {
        const spinner = new NumberSpinner();

        // Content-derived from the fixed-size SpinButton column, not from the
        // pin under test — merely asserts the pin didn't zero it out.
        expect(spinner.getMinSize()!.width).toBeGreaterThan(0);
    });
});

describe('VBox stack of single-line fields no longer collapses', () => {
    it('reports a min-height that accounts for every field', () => {
        const FIELD_COUNT = 3;

        const panel = new Panel();
        panel.setLayoutManager(new VBox());

        const fields = Array.from({ length: FIELD_COUNT }, () => new TextField());
        for (const field of fields) {
            panel.addComponent(field);
        }

        const perFieldMin = fields[0].getMinSize()!.height;
        const min         = panel.getMinSize()!;

        expect(perFieldMin).toBeGreaterThan(0);
        expect(min.height).toBeGreaterThanOrEqual(FIELD_COUNT * perFieldMin);
    });
});

describe('TextArea stays Y-resizable', () => {
    it('does not gain a one-line min-height floor', () => {
        const area = new TextArea();

        const min  = area.getMinSize()!;
        const pref = area.getPreferredSize()!;

        expect(min.height).toBeLessThan(pref.height);
    });
});

describe('Credential fields inherit setBorder\'s runtime height re-derivation', () => {
    // Before this plan, neither PasswordField nor UsernameField had a
    // `setBorder` override, so all three heights stayed stale after a border
    // change. Now both extend TextField and inherit its override. The class
    // default border resolves to 0px against this test fixture's empty
    // `themeVars`, and the new border contributes 2px top + 2px bottom, so
    // the recomputed height is exactly 4px more than the recorded one.
    const BORDER_WIDTH_DELTA_PX = 4;

    it('PasswordField: setBorder re-derives preferred/min/max height', () => {
        const field = new PasswordField();
        const before = field.getPreferredSize()!.height;

        field.setBorder('2px solid red');

        const expectedHeight = Util.singleLineBoxHeight(field.getInsets(), field.getPadding(), field.getBorderSize());
        expect(expectedHeight).toBe(before + BORDER_WIDTH_DELTA_PX);
        expect(field.getPreferredSize()!.height).toBe(expectedHeight);
        expect(field.getMinSize()!.height).toBe(expectedHeight);
        expect(field.getMaxSize()!.height).toBe(expectedHeight);
    });

    it('UsernameField: setBorder re-derives preferred/min/max height', () => {
        const field = new UsernameField();
        const before = field.getPreferredSize()!.height;

        field.setBorder('2px solid red');

        const expectedHeight = Util.singleLineBoxHeight(field.getInsets(), field.getPadding(), field.getBorderSize());
        expect(expectedHeight).toBe(before + BORDER_WIDTH_DELTA_PX);
        expect(field.getPreferredSize()!.height).toBe(expectedHeight);
        expect(field.getMinSize()!.height).toBe(expectedHeight);
        expect(field.getMaxSize()!.height).toBe(expectedHeight);
    });
});
