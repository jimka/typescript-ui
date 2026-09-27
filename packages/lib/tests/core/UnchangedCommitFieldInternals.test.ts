// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for stage 4 of the unchanged-commit layout skip: the eleven classes
 * a form control is built *from* — `PickerInput`, `PickerButton`,
 * `ComboBoxLabel`, `ComboBoxCaret`, `CheckboxBox`, `ToggleTrack`,
 * `SliderTrack`, `SliderThumb`, `NumberSpinnerField`, `SpinButtonUp` and
 * `SpinButtonDown` — opt in, and the two places a field hand-places a child
 * and then forced that child's pass (`AbstractPickerField.doLayout` and
 * `ComboBox.doLayout`) place through `Component.applyBounds` instead. Case
 * numbers E1 to E12 refer to `## Expected Behaviour` in
 * `plans/implemented/field-internals-unchanged-commit-opt-in.md`. E13, that
 * plan's `Row.doLayout` case, has no test: restoring the base call was found to
 * shrink any cell whose preferred size is not `null`, so that half of the plan
 * was reverted and `Row` is untouched — see the plan's *Why the `Row` half was
 * reverted*. E14 is in-engine only.
 *
 * E1, E2, E5, E7, E8 and E11 pin the change: each fails on this tree before it.
 * E3, E4, E6, E9, E10 and E12 pin what must *stay* true once it lands — a
 * resize still re-places both picker children, each control's own writes still
 * reach its parts, the renderer closure still places a rebound renderer, and a
 * settled form pass costs exactly what it cost before — and they pass before
 * the change too, which is the point: they are the regression half of the file.
 *
 * A skip is code whose whole effect is that something does not happen, so every
 * case that asserts one states the *count* it expects and compares it against
 * the shipped count the same drive produced before this change (10 calls for a
 * picker field's own pass, 5 for a combo box's, 11 for a number spinner's, and
 * 4 / 3 / 4 for a checkbox, toggle and slider). An assertion that only watched
 * a census come back empty would hold just as well if the pass never descended
 * at all, so each skip case is paired with a forced-off arm that drives the
 * same pass with the eleven gates stubbed to `false` and shows the subtree
 * really is reachable — at rectangles identical to the opted-in arm's.
 *
 * `afterEach` disposes every root the case built and restores `ModernTheme`,
 * because `ThemeManager.setTheme` fires every listener still registered in the
 * process (see `TextThemeReflow.test.ts` for why that makes theme cases
 * uniquely sensitive to cross-test pollution).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { Fit } from '~/layout/Fit';
import { VBox } from '~/layout/VBox';
import { LabeledGrid } from '~/component/container/LabeledGrid';
import { TextField } from '~/component/input/TextField';
import { TextInput } from '~/component/input/TextInput';
import { ComboBox } from '~/component/input/ComboBox';
import { GlyphListItemRenderer } from '~/component/list/renderer/Glyph';
import { DateField } from '~/component/input/DateField';
import { TimeField } from '~/component/input/TimeField';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { Checkbox } from '~/component/input/Checkbox';
import { Toggle } from '~/component/input/Toggle';
import { Slider } from '~/component/input/Slider';
import { Button } from '~/component/button/Button';
import { FieldDecorator } from '~/validation/FieldDecorator';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { DOM } from '~/core/DOM';
import { ThemeManager, ModernTheme } from '~/core/Theme';
import type { Theme } from '~/core/Theme';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

/** The form scene's box — a full pane, so no field is compressed. */
const FORM_WIDTH  = 800;
const FORM_HEIGHT = 600;

/** E3's narrowed root: wide enough that every field still holds its chrome. */
const NARROW_WIDTH = 600;

/** E6's scene height — one grid row is all it needs. */
const ROW_HEIGHT = 200;

/** The picker button's fixed column width — `AbstractPickerField`'s own `PICKER_BUTTON_WIDTH_PX`. */
const PICKER_BUTTON_WIDTH = 24;

/** The sliders' range and start: a percentage at its midpoint, as `packages/qa/src/builders/form.ts` builds them. */
const SLIDER_MIN   = 0;
const SLIDER_MAX   = 100;
const SLIDER_VALUE = 50;

/** E9's writes: a value above the midpoint, and a doubled range that pulls it back. */
const SLIDER_RAISED     = 75;
const SLIDER_WIDENED_MAX = 200;

/** E9's expected track thickness when vertical — `Slider`'s own `TRACK_THICKNESS`. */
const SLIDER_TRACK_THICKNESS = 4;

/**
 * E4's writes: a date the inner input shows, and a glyph swap the button's own
 * pass must not be needed for.
 *
 * The plan names `xmark`, which `Glyph`'s registry does not hold — it starts
 * empty but for four `unicode-*` entries, and each glyph a control needs is
 * registered by the module that needs it. `clock` is registered by `TimeField`,
 * which this scene builds, so it is the swap that reaches `setGlyphName` at all.
 */
const E4_DATE      = new Date(2026, 8, 19);
const E4_DATE_TEXT = '2026-09-19';
const E4_GLYPH     = 'clock';

/** E10's expected thumb transform when a `Toggle` is on — `Toggle.applyValue`'s travel. */
const TOGGLE_ON_TRANSFORM = 'translateX(16px)';

/** E11's theme font size: larger than `ModernTheme`'s, so the switch is a real metrics change. */
const LARGER_FONT_SIZE = '20px';

/**
 * The form scene's field titles: one per field kind, plus a ninth for the
 * undecorated text field — stage 3's `FIELD_TITLES` unchanged, so this file's
 * scene is the same scene.
 */
const FIELD_TITLES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;

/** The combo boxes' two records: enough that a rebind can pick the one not auto-selected. */
const COMBO_RECORDS = [
    { id: 'one', name: 'One' },
    { id: 'two', name: 'Two' },
] as const;

/**
 * E6's two records: the first carries no glyph and the second does, so
 * rebinding the collapsed label from one to the other builds a renderer child
 * that did not exist on the settled pass.
 */
const GLYPH_RECORDS = [
    { id: 'plain', name: 'Plain', icon: '' },
    { id: 'iconed', name: 'Iconed', icon: 'unicode-arrow-up' },
] as const;

/** The combo boxes' model: an id key and the displayed name. */
const COMBO_MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/**
 * The shipped census of one settled `DateField.doLayout()` — the ten calls this
 * stage removes nine of. Asserted in the forced-off arm so the opted-in arm's
 * `{ DateField: 1 }` is measured against a live non-zero baseline rather than
 * against nothing: a census that came back empty because the pass never
 * descended would satisfy the opted-in expectation on its own.
 */
const PICKER_SHIPPED_NAMES = ['PickerInput', 'PickerButton', 'Component', 'ButtonIconGlyph', 'ButtonLabelText'] as const;
const PICKER_SHIPPED_TOTAL = 10;

/** As {@link PICKER_SHIPPED_NAMES}, for a settled `ComboBox.doLayout()`'s five calls. */
const COMBO_SHIPPED_NAMES = ['ComboBoxLabel', 'ComboBoxCaret', 'ComboBoxCaretGlyph'] as const;
const COMBO_SHIPPED_TOTAL = 5;

/** As {@link PICKER_SHIPPED_NAMES}, for a settled `NumberSpinner.doLayout()`'s eleven calls. */
const SPINNER_SHIPPED_NAMES = ['NumberSpinnerField', 'SpinButtonUp', 'SpinButtonDown', 'ButtonIconGlyph', 'ButtonLabelText'] as const;
const SPINNER_SHIPPED_TOTAL = 11;

/** As {@link PICKER_SHIPPED_NAMES}, for the three controls E8 drives. */
const CHECKBOX_SHIPPED_TOTAL = 4;
const TOGGLE_SHIPPED_TOTAL   = 3;
const SLIDER_SHIPPED_TOTAL   = 4;

/**
 * Builds a config whose baked font table is a private deep copy, so a case can
 * widen the advances mid-run without mutating the shared JSON module every
 * other suite reads. Copied from `tests/core/UnchangedCommitFormOptIns.test.ts`.
 *
 * @returns The modelled-DOM config.
 */
function makeConfig() {
    return {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { width: 1280, height: 800 },
        scrollBarWidth:  15,
        fontMetrics:     structuredClone(fontMetrics),
        themeVars:       {},
    };
}

/**
 * A `ModernTheme` clone at a larger font size, built the way
 * `tests/component/table/HeaderThemeReflow.test.ts` builds `paddedTheme`.
 *
 * @returns The cloned theme.
 */
function largerFontTheme(): Theme {
    return {
        ...ModernTheme,
        font: { ...ModernTheme.font, size: LARGER_FONT_SIZE },
    };
}

let frames: FrameRequestCallback[] = [];
let roots: Component[] = [];

/**
 * Installs the modelled DOM with a frame-capturing `requestAnimationFrame`.
 * The offline sink never runs a frame of its own, so every scheduled pass in
 * this file is driven explicitly through {@link flushFrame}.
 *
 * @param config - Optional config; a fresh cloned font table by default.
 */
function install(config: ReturnType<typeof makeConfig> = makeConfig()): void {
    installTestDOM(config);

    frames = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
}

/** Runs every captured frame callback, including any a callback re-queues. */
function flushFrame(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard += 1) {
        const pending = frames;

        frames = [];

        for (const cb of pending) {
            cb(0);
        }
    }
}

/**
 * Records a root for disposal in `afterEach`.
 *
 * @param root - The root to track.
 * @returns The same root.
 */
function track<T extends Component>(root: T): T {
    roots.push(root);

    return root;
}

/** Disposes everything a first arm built, so a second arm can install its own DOM. */
function teardownArm(): void {
    for (const root of roots) {
        root.dispose();
    }

    roots = [];
    vi.restoreAllMocks();
    DOM.reset();
}

/**
 * Every component in a subtree, the root included, in pre-order.
 *
 * @param component - The subtree root.
 * @returns The components.
 */
function flatten(component: Component): Component[] {
    return [component, ...component.getComponents().flatMap(flatten)];
}

/**
 * A component's *visual* left edge: a size-stable move commits through the
 * translate fast path, which leaves `getX()` at its old value, so every
 * position this file asserts on folds the leftover translate back in.
 *
 * @param component - The component to read.
 * @returns The visual x.
 */
function visualX(component: Component): number {
    return component.getX() + component.getTranslateX();
}

/**
 * A component's *visual* top edge — {@link visualX}'s other axis.
 *
 * @param component - The component to read.
 * @returns The visual y.
 */
function visualY(component: Component): number {
    return component.getY() + component.getTranslateY();
}

/**
 * One component's visual rectangle.
 *
 * @param component - The component to read.
 * @returns Its `x,y,width,height`.
 */
function boxOf(component: Component): string {
    return `${visualX(component)},${visualY(component)},${component.getWidth()},${component.getHeight()}`;
}

/**
 * Every component's visual rectangle in a subtree, as one string.
 *
 * A combo box's digest carries the literal `NaN,NaN,14,14` of
 * `ComboBoxCaretGlyph`, whose x and y no setter has ever assigned. That is
 * unchanged by this stage and compares equal as a string — see the plan's
 * `[^nan-glyph]`.
 *
 * @param component - The subtree root.
 * @returns The joined `x,y,width,height` of every component.
 */
function geometryOf(component: Component): string {
    return flatten(component).map(boxOf).join('|');
}

/**
 * A rendered, inset-free `Container` of the given box, laid out by `manager`.
 *
 * @param manager - The root's layout manager.
 * @param width - The root's width.
 * @param height - The root's height.
 * @returns The root.
 */
function makeRoot(manager: Fit, width: number, height: number): Container {
    const root = track(new Container({ layoutManager: manager }));

    root.getElement(true);
    root.clearInsets();
    root.setWidth(width);
    root.setHeight(height);

    return root;
}

/**
 * Lays a scene out until it is settled — four passes, as the plan's "settled"
 * means, so a first-layout drain and a relayed preferred size are both spent.
 *
 * @param root - The scene root.
 */
function settle(root: Component): void {
    for (let pass = 0; pass < 4; pass += 1) {
        root.doLayout();
        flushFrame();
    }
}

/** The form scene's parts, where each case's target is found. */
interface FormScene {
    root:          Container;
    panel:         Panel;
    grid:          LabeledGrid;
    comboBox:      ComboBox;
    dateField:     DateField;
    timeField:     TimeField;
    numberSpinner: NumberSpinner;
    checkbox:      Checkbox;
    toggle:        Toggle;
    slider:        Slider;
}

/**
 * The form scene every case shares — stage 3's `makeFormScene()` unchanged: a
 * `Fit` root over a stretching `VBox` `Panel` over a two-column `LabeledGrid`
 * with one field of each kind, the text field wrapped in a `FieldDecorator` as
 * `packages/qa/src/builders/form.ts`'s `decorate` does. Not settled: the caller
 * settles it, so a case can install its spies against a chosen pass.
 *
 * @returns The scene.
 */
function makeFormScene(): FormScene {
    const root  = makeRoot(new Fit(), FORM_WIDTH, FORM_HEIGHT);
    const panel = new Panel({ layoutManager: new VBox({ stretching: true }) });
    const grid  = new LabeledGrid({ columns: 2 });

    const store = new MemoryStore(COMBO_MODEL, COMBO_RECORDS as unknown as object[]);

    store.loadData(COMBO_RECORDS as unknown as object[]);

    const textField     = new TextField();
    const comboBox      = new ComboBox({ store, displayField: 'name', valueField: 'id' });
    const dateField     = new DateField();
    const timeField     = new TimeField();
    const numberSpinner = new NumberSpinner();
    const checkbox      = new Checkbox();
    const toggle        = new Toggle();
    const slider        = new Slider({ min: SLIDER_MIN, max: SLIDER_MAX, value: SLIDER_VALUE });
    const plainField    = new TextField();

    const fields = [textField, comboBox, dateField, timeField, numberSpinner, checkbox,
        toggle, slider, plainField];

    fields.forEach((field, index) => grid.addField(FIELD_TITLES[index], field));

    // The decorator replaces the field in its parent and re-adds it as its own
    // child, so it must be built after the field is in the grid.
    new FieldDecorator(textField, grid);

    panel.addComponent(grid);
    root.addComponent(panel);

    return { root, panel, grid, comboBox, dateField, timeField, numberSpinner, checkbox, toggle, slider };
}

/**
 * The eleven instances this stage opts in, plus the five inner parts it
 * deliberately leaves out, reached by index through the controls that own them
 * — the addressing the plan's *Addendum: The field subtrees* describes. Nine of
 * the eleven classes are file-local and cannot be imported, so an instance is
 * the only handle a test has on them.
 *
 * @param scene - The form scene to read.
 * @returns The instances, by role.
 */
function internalsOf(scene: FormScene) {
    const [pickerInput, pickerButton] = scene.dateField.getComponents();
    const [comboLabel, comboCaret]    = scene.comboBox.getComponents();
    const [checkboxBox]               = scene.checkbox.getComponents();
    const [toggleTrack]               = scene.toggle.getComponents();
    const [sliderTrack, sliderThumb]  = scene.slider.getComponents();
    const [spinnerField, spinColumn]  = scene.numberSpinner.getComponents();
    const [spinUp, spinDown]          = spinColumn.getComponents();

    return {
        /** The eleven that opt in, one instance each. */
        optedIn: [pickerInput, pickerButton, comboLabel, comboCaret, checkboxBox, toggleTrack,
            sliderTrack, sliderThumb, spinnerField, spinUp, spinDown],
        /** The five parts that keep the default gate — see the plan's *Non-Goals*. */
        leftOut: [comboCaret.getComponents()[0], checkboxBox.getComponents()[0],
            checkboxBox.getComponents()[1], toggleTrack.getComponents()[0],
            sliderTrack.getComponents()[0], pickerButton.getComponents()[0]],
        pickerInput, pickerButton, comboLabel, comboCaret, checkboxBox, toggleTrack,
        sliderTrack, sliderThumb, spinnerField, spinColumn, spinUp, spinDown,
    };
}

/**
 * The eleven prototypes a forced-off arm stubs. None of the nine file-local
 * classes is importable, so each prototype is reached through a throwaway
 * instance built and disposed here — the same hop `internalsOf` makes, on a
 * control that never joins a scene.
 *
 * @returns The prototypes.
 */
function internalPrototypes(): object[] {
    const controls = [new DateField(), new ComboBox(), new Checkbox(), new Toggle(),
        new Slider(), new NumberSpinner()];
    const [dateField, comboBox, checkbox, toggle, slider, numberSpinner] = controls;

    const prototypes = [
        ...dateField.getComponents(),
        ...comboBox.getComponents(),
        checkbox.getComponents()[0],
        toggle.getComponents()[0],
        ...slider.getComponents(),
        numberSpinner.getComponents()[0],
        ...numberSpinner.getComponents()[1].getComponents(),
    ].map(component => Object.getPrototypeOf(component) as object);

    controls.forEach(control => control.dispose());

    return prototypes;
}

/**
 * Stubs the eleven new opt-ins off, so a case can run its scene the way it ran
 * before this plan — the "forced off" arm.
 */
function forcedOff(): void {
    for (const prototype of internalPrototypes()) {
        vi.spyOn(prototype as any, 'canSkipUnchangedLayout').mockReturnValue(false);
    }
}

/**
 * Counts every `doLayout` call `spy` recorded whose receiver lies inside
 * `subtree`, by constructor name.
 *
 * Every override in these subtrees calls `super.doLayout()` exactly once, so a
 * spy on the base method sees one call per real pass even for a class that
 * overrides it.
 *
 * @param spy - A spy on `Component.prototype.doLayout`.
 * @param subtree - The subtree whose calls to count.
 * @returns The per-class call counts.
 */
function censusOf(spy: { mock: { contexts: unknown[] } }, subtree: Component): Record<string, number> {
    const members = new Set<unknown>(flatten(subtree));
    const census: Record<string, number> = {};

    for (const context of spy.mock.contexts) {
        if (!members.has(context)) {
            continue;
        }

        const name = (context as Component).constructor.name;

        census[name] = (census[name] ?? 0) + 1;
    }

    return census;
}

/**
 * The total number of `doLayout` calls a census holds.
 *
 * @param census - The census to sum.
 * @returns The call count.
 */
function totalOf(census: Record<string, number>): number {
    return Object.values(census).reduce((sum, count) => sum + count, 0);
}

/**
 * Drives one settled control's own pass and returns what it cost, with the
 * subtree's geometry before and after.
 *
 * @param control - The control whose own pass to drive.
 * @returns The census and the two geometry digests.
 */
function ownPass(control: Component): { census: Record<string, number>; before: string; after: string } {
    const before  = geometryOf(control);
    const layouts = vi.spyOn(Component.prototype, 'doLayout');

    control.doLayout();

    const census = censusOf(layouts, control);

    layouts.mockRestore();

    return { census, before, after: geometryOf(control) };
}

/**
 * A settled form scene's control, and what its own pass costs — the shape E2,
 * E5, E7 and E8 share.
 *
 * @param off - Whether to force the eleven opt-ins off first.
 * @param pick - Picks the control to drive out of the scene.
 * @returns The pass's census and geometry.
 */
function settledOwnPass(off: boolean, pick: (scene: FormScene) => Component): ReturnType<typeof ownPass> {
    install();

    if (off) {
        forcedOff();
    }

    const scene = makeFormScene();

    settle(scene.root);

    return ownPass(pick(scene));
}

/**
 * The inner text input of a field that registers it as its first child —
 * `DateField` and `TimeField`'s `PickerInput`, `NumberSpinner`'s
 * `NumberSpinnerField`.
 *
 * @param field - The field to read.
 * @returns The inner input.
 */
function innerInput(field: Component): TextInput {
    return field.getComponents()[0] as TextInput;
}

/**
 * A `ComboBox`'s hosted renderer and the two parts a glyph renderer paints, as
 * one geometry string. Every one of them is raw-appended rather than
 * registered, so `geometryOf` cannot see them; the `any` hop is confined here,
 * the way `Slider.test.ts` confines its own reach into a private child.
 *
 * @param comboBox - The combo box to read.
 * @returns The renderer's, icon's and label's `x,y,width,height`.
 */
function comboRendererGeometry(comboBox: ComboBox): string {
    const renderer = (comboBox as any)._label._renderer;
    const box = (c: Component | null | undefined): string => (c ? boxOf(c) : 'none');

    return `${box(renderer)}#${box(renderer._icon)}#${box(renderer._label)}`;
}

/**
 * Whether a glyph renderer's icon child is reachable at all. The `any` hop in
 * {@link comboRendererGeometry} renders a field it cannot find as the literal
 * `'none'`, which both arms would agree on after a rename — so a case asserts
 * this first and only then compares the two arms' geometry.
 *
 * @param comboBox - The combo box to read.
 * @returns `true` when the renderer's icon child is present.
 */
function comboIconFound(comboBox: ComboBox): boolean {
    return (comboBox as any)._label._renderer._icon instanceof Component;
}

afterEach(() => {
    flushFrame();

    for (const root of roots) {
        root.dispose();
    }

    roots = [];
    // Theme state is module-level; restore it even if an assertion above threw
    // — and before `DOM.reset()`, because the restore itself goes through the
    // sink the modelled DOM installed.
    ThemeManager.setTheme(ModernTheme);
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Who opts in (E1)', () => {
    /**
     * The settled form scene's internals, with each instance's class name
     * asserted. Nine of the eleven classes are unimportable, so every case
     * addresses them by index — a silent change to a control's child order
     * would otherwise leave every case in this file testing the wrong object.
     *
     * @returns The scene's internals.
     */
    const settledInternals = () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        return internalsOf(scene);
    };

    it('reaches each of the eleven internals at the index the plan names', () => {
        const internals = settledInternals();

        expect(internals.optedIn.map(c => c.constructor.name)).toEqual([
            'PickerInput', 'PickerButton', 'ComboBoxLabel', 'ComboBoxCaret', 'CheckboxBox',
            'ToggleTrack', 'SliderTrack', 'SliderThumb', 'NumberSpinnerField',
            'SpinButtonUp', 'SpinButtonDown',
        ]);
        expect(internals.leftOut.map(c => c.constructor.name)).toEqual([
            'ComboBoxCaretGlyph', 'CheckboxCheckGlyph', 'CheckboxDash', 'ToggleThumb',
            'SliderActiveTrack', 'Component',
        ]);
        expect(internals.spinColumn.constructor.name).toBe('Component');
    });

    it('answers every one of the eleven with true', () => {
        const internals = settledInternals();

        expect(internals.optedIn.filter(c => !c.canSkipUnchangedCommit())).toEqual([]);
    });

    it('answers the five parts it leaves out, and the button content row, with false', () => {
        const internals = settledInternals();

        expect(internals.leftOut.filter(c => c.canSkipUnchangedCommit())).toEqual([]);
    });
});

describe("A settled picker field's own pass reaches nothing below it (E2)", () => {
    it.each([
        ['a DateField', (scene: FormScene) => scene.dateField as Component, 'DateField'],
        ['a TimeField', (scene: FormScene) => scene.timeField as Component, 'TimeField'],
    ] as const)('lays out %s alone, and leaves every rectangle in its subtree where it was', (_label, pick, name) => {
        const { census, before, after } = settledOwnPass(false, pick);

        expect(census).toEqual({ [name]: 1 });
        expect(after).toBe(before);
    });

    it('lays out all five classes below a DateField with the opt-ins off, at the same rectangles', () => {
        const optedIn = settledOwnPass(false, scene => scene.dateField);

        teardownArm();

        const off = settledOwnPass(true, scene => scene.dateField);

        // The shipped drive: without this arm the opted-in census above would be
        // satisfied by a pass that never descended into the field at all.
        expect(PICKER_SHIPPED_NAMES.filter(cls => !off.census[cls])).toEqual([]);
        expect(totalOf(off.census)).toBeGreaterThanOrEqual(PICKER_SHIPPED_TOTAL);
        expect(off.after).toBe(off.before);
        expect(off.before).toBe(optedIn.before);
    });
});

describe('A picker field still tracks a resize (E3)', () => {
    it('narrows the input, slides the button left by the same amount, and lays both out', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        const input   = innerInput(scene.dateField);
        const button  = scene.dateField.getComponents()[1];
        const settled = geometryOf(scene.root);

        const inputWidthBefore = input.getWidth();
        const buttonXBefore    = visualX(button);
        const layouts          = vi.spyOn(Component.prototype, 'doLayout');

        scene.root.setWidth(NARROW_WIDTH);
        scene.root.doLayout();
        flushFrame();

        const census = censusOf(layouts, scene.dateField);

        layouts.mockRestore();

        const narrowed = inputWidthBefore - input.getWidth();

        expect(narrowed).toBeGreaterThan(0);
        expect(buttonXBefore - visualX(button)).toBe(narrowed);
        expect(button.getWidth()).toBe(PICKER_BUTTON_WIDTH);
        // This is the case the `applyBounds` conversion must not withhold: both
        // rectangles moved, so both children owe a pass.
        expect(census.PickerInput).toBeGreaterThanOrEqual(1);
        expect(census.PickerButton).toBeGreaterThanOrEqual(1);

        scene.root.setWidth(FORM_WIDTH);
        scene.root.doLayout();
        flushFrame();

        expect(geometryOf(scene.root)).toBe(settled);
    });
});

describe("A picker field's own writes still show (E4)", () => {
    it('writes the value into the inner input and keeps the swapped glyph inside the button', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        scene.dateField.setValue(E4_DATE);
        flushFrame();

        expect(innerInput(scene.dateField).getText()).toBe(E4_DATE_TEXT);

        const button     = scene.dateField.getComponents()[1] as Button;
        const contentRow = button.getComponents()[0];
        const glyph      = contentRow.getComponents()[0];
        const glyphBox   = boxOf(glyph);

        expect(glyphBox).not.toContain('NaN');

        button.setGlyph(E4_GLYPH);
        flushFrame();

        // The glyph's size does not depend on its name, so the swap must leave
        // the rectangle exactly where it was — and inside the button's own box.
        expect(boxOf(glyph)).toBe(glyphBox);
        expect(glyph.getWidth()).toBeLessThanOrEqual(button.getWidth());
        expect(glyph.getHeight()).toBeLessThanOrEqual(button.getHeight());
    });
});

describe("A settled combo box's own pass reaches nothing below it (E5)", () => {
    it('lays the ComboBox out alone, and leaves every rectangle in its subtree where it was', () => {
        const { census, before, after } = settledOwnPass(false, scene => scene.comboBox);

        expect(census).toEqual({ ComboBox: 1 });
        expect(after).toBe(before);
    });

    it('lays the label, the caret and its glyph out with the opt-ins off, at the same rectangles', () => {
        const optedIn = settledOwnPass(false, scene => scene.comboBox);

        teardownArm();

        const off = settledOwnPass(true, scene => scene.comboBox);

        expect(COMBO_SHIPPED_NAMES.filter(cls => !off.census[cls])).toEqual([]);
        expect(totalOf(off.census)).toBeGreaterThanOrEqual(COMBO_SHIPPED_TOTAL);
        expect(off.after).toBe(off.before);
        expect(off.before).toBe(optedIn.before);
    });
});

describe('The renderer closure still reaches the label (E6)', () => {
    /**
     * A combo box of two records, the first with no glyph and the second with
     * one, under a one-column grid — the scene where rebinding the label builds
     * a renderer child that did not exist before.
     *
     * @param off - Whether to force the eleven opt-ins off.
     * @returns The root, the grid and the combo box.
     */
    const glyphComboScene = (off: boolean): { root: Container; grid: LabeledGrid; comboBox: ComboBox } => {
        install();

        if (off) {
            forcedOff();
        }

        const root  = makeRoot(new Fit(), FORM_WIDTH, ROW_HEIGHT);
        const grid  = new LabeledGrid({ columns: 1 });
        const model = new Model([{ name: 'id' }, { name: 'name' }, { name: 'icon' }], 'id');
        const store = new MemoryStore(model, GLYPH_RECORDS as unknown as object[]);

        store.loadData(GLYPH_RECORDS as unknown as object[]);

        const comboBox = new ComboBox({
            store,
            displayField:    'name',
            valueField:      'id',
            glyphField:      'icon',
            rendererFactory: () => new GlyphListItemRenderer(),
        });

        grid.addField('A', comboBox);
        root.addComponent(grid);
        settle(root);

        return { root, grid, comboBox };
    };

    /**
     * The renderer geometry `write` leaves behind, once the scene has settled
     * and the grid has been forced to run one more pass.
     *
     * The forced grid pass is the contract, not extra driving: `ComboBoxLabel`
     * closes its rebind with `invalidateLayout()`, which promises that the next
     * pass reaching the field places the renderer and that no skipping ancestor
     * — now including the opted-in label itself — withholds it.
     *
     * @param off - Whether to force the eleven opt-ins off.
     * @param write - The write to make on the settled combo box.
     * @returns The renderer geometry.
     */
    const geometryAfter = (off: boolean, write: (comboBox: ComboBox) => void): string => {
        const { root, grid, comboBox } = glyphComboScene(off);

        write(comboBox);
        flushFrame();
        grid.invalidateLayout();
        root.doLayout();
        flushFrame();

        // The write's whole point is that it builds an icon child the settled
        // pass did not have; if the reach into it ever stops resolving, both
        // arms would read the same sentinel and the comparison below would hold
        // while asserting nothing.
        expect(comboIconFound(comboBox)).toBe(true);

        return comboRendererGeometry(comboBox);
    };

    it.each([
        ['rebinding the label to an item that carries a glyph', (comboBox: ComboBox) => comboBox.setSelectedIndex(1)],
        // The selection moves to the iconed record first, so the brand-new
        // renderer the swap installs has to build an icon of its own — which is
        // what makes its never-assigned NaN box observable.
        ['swapping the renderer factory', (comboBox: ComboBox) => {
            comboBox.setSelectedIndex(1);
            comboBox.setRendererFactory(() => new GlyphListItemRenderer());
        }],
    ] as const)('lands the same renderer geometry in both arms after %s', (_label, write) => {
        const optedIn = geometryAfter(false, write);

        teardownArm();

        expect(optedIn).toBe(geometryAfter(true, write));
        expect(optedIn).not.toContain('NaN');
    });
});

describe("A settled number spinner's own pass stops at its spin column (E7)", () => {
    it('lays out the spinner and the spin column only, and moves nothing', () => {
        const { census, before, after } = settledOwnPass(false, scene => scene.numberSpinner);

        expect(census).toEqual({ NumberSpinner: 1, Component: 1 });
        expect(after).toBe(before);
    });

    it('lays out the field and both spin buttons with the opt-ins off, at the same rectangles', () => {
        const optedIn = settledOwnPass(false, scene => scene.numberSpinner);

        teardownArm();

        const off = settledOwnPass(true, scene => scene.numberSpinner);

        expect(SPINNER_SHIPPED_NAMES.filter(cls => !off.census[cls])).toEqual([]);
        expect(totalOf(off.census)).toBeGreaterThanOrEqual(SPINNER_SHIPPED_TOTAL);
        expect(off.after).toBe(off.before);
        expect(off.before).toBe(optedIn.before);
    });
});

describe('A settled checkbox, toggle and slider reach nothing below them (E8)', () => {
    it.each([
        ['a Checkbox', CHECKBOX_SHIPPED_TOTAL, 'Checkbox', (scene: FormScene) => scene.checkbox as Component],
        ['a Toggle',   TOGGLE_SHIPPED_TOTAL,   'Toggle',   (scene: FormScene) => scene.toggle   as Component],
        ['a Slider',   SLIDER_SHIPPED_TOTAL,   'Slider',   (scene: FormScene) => scene.slider   as Component],
    ] as const)('lays out %s alone, where the same pass cost %d calls before', (_label, shipped, name, pick) => {
        const optedIn = settledOwnPass(false, pick);

        expect(optedIn.census).toEqual({ [name]: 1 });
        expect(optedIn.after).toBe(optedIn.before);

        teardownArm();

        const off = settledOwnPass(true, pick);

        expect(totalOf(off.census)).toBe(shipped);
        expect(off.after).toBe(off.before);
        expect(off.before).toBe(optedIn.before);
    });
});

describe("A slider's own writes still move its parts (E9)", () => {
    it('moves the thumb for a value, back for a widened range, and swaps the track axes for a vertical orientation', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        const [sliderTrack, sliderThumb] = scene.slider.getComponents();
        const [activeTrack]              = sliderTrack.getComponents();

        const midpointX    = visualX(sliderThumb);
        const midpointFill = activeTrack.getWidth();

        scene.slider.setValue(SLIDER_RAISED);
        flushFrame();

        expect(visualX(sliderThumb)).toBeGreaterThan(midpointX);
        expect(activeTrack.getWidth()).toBeGreaterThan(midpointFill);

        const raisedX    = visualX(sliderThumb);
        const raisedFill = activeTrack.getWidth();

        scene.slider.setMax(SLIDER_WIDENED_MAX);
        flushFrame();

        expect(visualX(sliderThumb)).toBeLessThan(raisedX);
        expect(activeTrack.getWidth()).toBeLessThan(raisedFill);

        scene.slider.setOrientation('vertical');
        flushFrame();

        expect(sliderTrack.getHeight()).toBe(scene.slider.getContentBounds()!.height);
        expect(sliderTrack.getWidth()).toBe(SLIDER_TRACK_THICKNESS);
    });
});

describe("A toggle's and a checkbox's value write still show (E10)", () => {
    it('travels the thumb and fades the check glyph in', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        const [toggleTrack] = scene.toggle.getComponents();
        const [toggleThumb] = toggleTrack.getComponents();

        scene.toggle.setValue(true);
        flushFrame();

        expect(toggleThumb.getTransform()).toBe(TOGGLE_ON_TRANSFORM);

        const [checkboxBox] = scene.checkbox.getComponents();
        const [checkGlyph]  = checkboxBox.getComponents();

        expect(checkGlyph.getOpacity()).toBe(0);

        scene.checkbox.setSelected(true);
        flushFrame();

        expect(checkGlyph.getOpacity()).toBe(1);
    });
});

describe('A theme switch lays every opted-in internal out once (E11)', () => {
    it('lays all eleven out during the switch, then withholds each on the controls next own pass', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        const internals = internalsOf(scene);
        const controls  = [scene.dateField, scene.timeField, scene.comboBox, scene.numberSpinner,
            scene.checkbox, scene.toggle, scene.slider];
        const layouts   = internals.optedIn.map(component => vi.spyOn(component, 'doLayout'));

        ThemeManager.setTheme(largerFontTheme());
        flushFrame();

        expect(layouts.filter(spy => spy.mock.calls.length === 0)).toEqual([]);

        layouts.forEach(spy => spy.mockClear());

        // The plan drives the second half with `root.doLayout()`, which cannot
        // reach an internal at all: every control above them opted in at stage 3
        // and is settled by now, so that pass stops at the grid whatever these
        // eleven gates answer. Driving each control's *own* pass is what puts
        // the eleven gates on the path — see the plan's `## Implementation
        // Notes`.
        controls.forEach(control => control.doLayout());

        expect(layouts.filter(spy => spy.mock.calls.length > 0)).toEqual([]);
    });
});

describe('A settled form pass is unchanged (E12)', () => {
    it('lays out the root, the panel and the grid, and nothing inside the grid', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        const first   = geometryOf(scene.root);
        const inGrid  = flatten(scene.grid).filter(component => component !== scene.grid);
        const layouts = vi.spyOn(Component.prototype, 'doLayout');

        scene.grid.invalidateLayout();
        scene.root.doLayout();

        const laidOut = new Set<unknown>(layouts.mock.contexts);

        expect(laidOut.has(scene.root)).toBe(true);
        expect(laidOut.has(scene.panel)).toBe(true);
        expect(laidOut.has(scene.grid)).toBe(true);
        expect(inGrid.filter(component => laidOut.has(component))).toEqual([]);
        expect(geometryOf(scene.root)).toBe(first);
    });
});
