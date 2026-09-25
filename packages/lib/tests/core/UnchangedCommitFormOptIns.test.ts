// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for stage 3 of the unchanged-commit layout skip: the ten classes a
 * form's fields are built from — `Text` and `TextField` as themselves only,
 * `ComboBox`, `DateField`, `TimeField`, `NumberSpinner`, `Checkbox`, `Toggle`,
 * `Slider` and `FieldDecorator` — opt in, `LayoutManager.commitBounds` reads
 * "the rectangle changed" from the child's committed box before versus after
 * the write, and `Slider.doLayout` records the pass it ran. Case numbers E1 to
 * E13 refer to `## Expected Behaviour` in
 * `plans/implemented/unchanged-commit-opt-ins-forms.md`; E14 is in-engine only.
 *
 * E1, E2, E5, E7, E9, E11 and E13 pin the change: each fails on this tree
 * before it. E3, E4, E6, E8, E10 and E12 pin what must *stay* true once it
 * lands — a clamped child that really moves is still laid out, each field's own
 * writers still lay it out, and a web-font swap still re-measures through the
 * skip — and they pass before the change too, which is the point: they are the
 * regression half of the file. The plan's step-1 check lists E11 with them; it
 * is wrong, because E11's second clause needs the `Text` opt-in. E7's forced-off
 * arm likewise only passes once `Slider.doLayout` calls the base, since without
 * it a slider's children are never laid out at all. Both are recorded in the
 * plan's `## Implementation Notes`.
 *
 * The final case is not in the plan's list at all: the audit found that
 * rebinding or swapping a `ComboBox`'s hosted renderer changed a layout while
 * scheduling nothing, which the opt-in turned into a real geometry regression.
 * It pins the closure.
 *
 * A skip is code whose whole effect is that something does not happen, so a
 * case that only watches the scene settle proves nothing. Every case that
 * asserts a skip drives a pass the containers above the fields *must* run —
 * `grid.invalidateLayout()` — so the withheld pass is the field's own and not
 * an ancestor's skip hiding the subtree from the commit altogether.
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
import { LayoutManager } from '~/layout/LayoutManager';
import { VBox } from '~/layout/VBox';
import { LabeledGrid } from '~/component/container/LabeledGrid';
import { Text } from '~/component/input/Text';
import { TextField } from '~/component/input/TextField';
import { TextInput } from '~/component/input/TextInput';
import { TextArea } from '~/component/input/TextArea';
import { Label } from '~/component/input/Label';
import { Link } from '~/component/input/Link';
import { SelectableText } from '~/component/input/SelectableText';
import { PasswordField } from '~/component/input/PasswordField';
import { UsernameField } from '~/component/input/UsernameField';
import { ComboBox } from '~/component/input/ComboBox';
import { GlyphListItemRenderer } from '~/component/list/renderer/Glyph';
import { DateField } from '~/component/input/DateField';
import { TimeField } from '~/component/input/TimeField';
import { DateTimeField } from '~/component/input/DateTimeField';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { Checkbox } from '~/component/input/Checkbox';
import { RadioButton } from '~/component/input/RadioButton';
import { Toggle } from '~/component/input/Toggle';
import { Slider } from '~/component/input/Slider';
import { FieldDecorator } from '~/validation/FieldDecorator';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { DOM } from '~/core/DOM';
import { ThemeManager, ModernTheme } from '~/core/Theme';
import type { Theme } from '~/core/Theme';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

/** E2 to E4's host row: far wider than any field in it, so a stretch clamp bites. */
const ROW_WIDTH  = 400;
const ROW_HEIGHT = 200;

/** E3's displaced leaf: tall enough that removing it visibly moves the row below it. */
const LEAF_HEIGHT = 30;

/** E3's horizontal arm: any real transition works — this is the shortest one that forces `commitBounds`'s slow path. */
const MOVE_TRANSITION = 'left 1ms';

/** E4's out-of-band height: taller than any single-line control's own box. */
const OUT_OF_BAND_HEIGHT = 90;

/** The form scene's box — a full pane, so no field is compressed. */
const FORM_WIDTH  = 800;
const FORM_HEIGHT = 600;

/** The sliders' range and start: a percentage at its midpoint, as `packages/qa/src/builders/form.ts` builds them. */
const SLIDER_MIN   = 0;
const SLIDER_MAX   = 100;
const SLIDER_VALUE = 50;

/** E6's writes: the range's top, a doubled range, and E8's value above the midpoint. */
const SLIDER_FULL        = 100;
const SLIDER_WIDENED_MAX = 200;
const SLIDER_RAISED      = 75;

/** E6's expected track thickness when vertical — `Slider`'s own `TRACK_THICKNESS`. */
const SLIDER_TRACK_THICKNESS = 4;

/** E8's writes: a value each field commits and shows. */
const LONGER_TEXT    = 'A much longer value than before';
const SPINNER_VALUE  = 42;
const E8_DATE        = new Date(2026, 8, 19);
const E8_DATE_TEXT   = '2026-09-19';

/** E8's expected thumb transform when a `Toggle` is on — `Toggle.applyValue`'s travel. */
const TOGGLE_ON_TRANSFORM = 'translateX(16px)';

/** E1's and E11's `Label`s: `Label` refuses an empty `forId`, so every case gives it one. */
const LABEL_FOR_ID = 'form-field-a';

/** E10's replacement label: long enough that the grid's title column must widen for it. */
const LONGER_LABEL = 'A very much longer label';

/** E13's theme font size: larger than `ModernTheme`'s, so the switch is a real metrics change. */
const LARGER_FONT_SIZE = '20px';

/**
 * The form scene's field titles: one per field kind, plus a ninth for the
 * undecorated text field. `I` is not a kind of its own — it is the shape
 * `packages/qa/src/builders/form.ts`'s *header* grid has, a plain `TextField`
 * with no decorator above it, and it is the only row where the `TextField`
 * opt-in itself decides anything: a decorated field is withheld by its
 * decorator's skip before its own gate is ever asked.
 */
const FIELD_TITLES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;

/** The combo boxes' two records: enough that `setValue` can pick the one not auto-selected. */
const COMBO_RECORDS = [
    { id: 'one', name: 'One' },
    { id: 'two', name: 'Two' },
] as const;

/**
 * The glyph-renderer case's two records: the first carries no glyph and the
 * second does, so rebinding the collapsed label from one to the other builds a
 * renderer child that did not exist on the settled pass.
 */
const GLYPH_RECORDS = [
    { id: 'plain', name: 'Plain', icon: '' },
    { id: 'iconed', name: 'Iconed', icon: 'unicode-arrow-up' },
] as const;

/** The combo boxes' model: an id key and the displayed name. */
const COMBO_MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/**
 * Builds a config whose baked font table is a private deep copy, so E12 can
 * widen the advances mid-run (modelling the real face swapping in) without
 * mutating the shared JSON module every other suite reads. Copied from
 * `tests/core/UnchangedCommitOptIns.test.ts`.
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
 * Doubles every per-character advance in the (cloned) baked font table, the
 * way a real face swapping in widens every measured label.
 *
 * @param config - The config whose cloned table to widen.
 */
function widenFont(config: ReturnType<typeof makeConfig>): void {
    for (const font of Object.values(config.fontMetrics.fonts) as Array<{ advance: Record<string, number> }>) {
        for (const ch of Object.keys(font.advance)) {
            font.advance[ch] *= 2;
        }
    }
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
 * Every component's visual rectangle in a subtree, as one string.
 *
 * @param component - The subtree root.
 * @returns The joined `x,y,width,height` of every component.
 */
function geometryOf(component: Component): string {
    return flatten(component)
        .map(c => `${visualX(c)},${visualY(c)},${c.getWidth()},${c.getHeight()}`)
        .join('|');
}

/** The ten prototypes this plan opts in — the list a forced-off arm stubs. */
function optedInPrototypes(): object[] {
    return [
        Text.prototype, TextField.prototype, ComboBox.prototype, DateField.prototype,
        TimeField.prototype, NumberSpinner.prototype, Checkbox.prototype, Toggle.prototype,
        Slider.prototype, FieldDecorator.prototype,
    ];
}

/**
 * Stubs the ten new opt-ins off, so a case can run its scene the way it ran
 * before this plan — the "forced off" arm.
 */
function forcedOff(): void {
    for (const prototype of optedInPrototypes()) {
        vi.spyOn(prototype as any, 'canSkipUnchangedLayout').mockReturnValue(false);
    }
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

/** E2 to E4's scene: a one-column grid whose field track is far wider than the field in it. */
interface CellScene {
    root:  Container;
    grid:  LabeledGrid;
    field: Component;
}

/**
 * E2 to E4's scene — a `Fit` root over a one-column `LabeledGrid` holding
 * `field`, settled.
 *
 * A stretched *grid cell* is the shape that exercises the commit rule, and it is
 * the shape a form has: the grid's field track takes the row's slack and hands
 * the field the whole of it, so a field with a size ceiling of its own is asked
 * for hundreds of pixels and commits its own few. A stretching `VBox` does not
 * reproduce it — `BoxLayout` bounds the cross-axis stretch by the child's own
 * maximum before committing, so its request already equals what the child can
 * hold.
 *
 * @param field - The grid's field.
 * @param above - Optional full-width leaf on a row above `field`, for E3.
 * @returns The root, the grid and the field.
 */
function makeCellScene(field: Component, above?: Component): CellScene {
    const root = makeRoot(new Fit(), ROW_WIDTH, ROW_HEIGHT);
    const grid = new LabeledGrid({ columns: 1 });

    root.addComponent(grid);

    if (above) {
        above.getElement(true);
        grid.addFullWidthRow(above);
    }

    grid.addField('Field', field);
    settle(root);

    return { root, grid, field };
}

/** The form scene's parts, where each case's target is found. */
interface FormScene {
    root:          Container;
    panel:         Panel;
    grid:          LabeledGrid;
    /** The decorated text field — withheld by its decorator, not by its own gate. */
    textField:     TextField;
    decorator:     FieldDecorator;
    /** The undecorated text field, whose own gate is what withholds it. */
    plainField:    TextField;
    comboBox:      ComboBox;
    dateField:     DateField;
    timeField:     TimeField;
    numberSpinner: NumberSpinner;
    checkbox:      Checkbox;
    toggle:        Toggle;
    slider:        Slider;
    /** The ten opted-in instances in the scene, one per opted-in class. */
    optedIn:       Component[];
}

/**
 * The form scene E7 and E9 to E13 share — a `Fit` root over a stretching
 * `VBox` `Panel` over a two-column `LabeledGrid` with one field of each kind,
 * the text field wrapped in a `FieldDecorator` as
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
    const decorator = new FieldDecorator(textField, grid);

    panel.addComponent(grid);
    root.addComponent(panel);

    const optedIn = [labelFor(grid, 0), plainField, comboBox, dateField, timeField,
        numberSpinner, checkbox, toggle, slider, decorator];

    return {
        root, panel, grid, textField, decorator, plainField, comboBox, dateField, timeField,
        numberSpinner, checkbox, toggle, slider, optedIn,
    };
}

/**
 * The plain `Text` `LabeledGrid.addField` built for the field at `index`. The
 * grid holds each row as a title/field pair in order, so the titles are its
 * even-indexed children.
 *
 * @param grid - The grid to read.
 * @param index - The field's index in the grid.
 * @returns The field's label.
 */
function labelFor(grid: LabeledGrid, index: number): Text {
    return grid.getComponents()[2 * index] as Text;
}

/**
 * A `ComboBox`'s label text. The collapsed control hosts a
 * `LabelListItemRenderer` whose `Text` is raw-appended rather than registered,
 * so neither is reachable through `getComponents()` — the `any` hop to the
 * label component is confined to this helper, the way `Slider.test.ts` confines
 * its own reach into a private child.
 *
 * @param comboBox - The combo box to read.
 * @returns The `Text` painting the selected entry.
 */
function comboLabelText(comboBox: ComboBox): Text {
    return (comboBox as any)._label._renderer.getLabel() as Text;
}

/**
 * A `ComboBox`'s hosted renderer and the two parts a glyph renderer paints, as
 * one geometry string. Every one of them is raw-appended rather than
 * registered, so `geometryOf` cannot see them; the `any` hop is confined here,
 * as in {@link comboLabelText}.
 *
 * @param comboBox - The combo box to read.
 * @returns The renderer's, icon's and label's `x,y,width,height`.
 */
function comboRendererGeometry(comboBox: ComboBox): string {
    const renderer = (comboBox as any)._label._renderer;
    const box = (c: Component | null | undefined): string =>
        c ? `${visualX(c)},${visualY(c)},${c.getWidth()},${c.getHeight()}` : 'none';

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
    it.each([
        ['a plain Text',           () => new Text('A'),                                  true],
        ['a plain TextField',      () => new TextField(),                                true],
        ['a ComboBox',             () => new ComboBox(),                                 true],
        ['a DateField',            () => new DateField(),                                true],
        ['a TimeField',            () => new TimeField(),                                true],
        ['a NumberSpinner',        () => new NumberSpinner(),                            true],
        ['a Checkbox',             () => new Checkbox(),                                 true],
        ['a Toggle',               () => new Toggle(),                                   true],
        ['a Slider',               () => new Slider(),                                   true],
        ['a Label',                () => new Label('A', LABEL_FOR_ID),                   false],
        ['a Link',                 () => new Link('A'),                                  false],
        ['a SelectableText',       () => new SelectableText('A'),                         false],
        ['a PasswordField',        () => new PasswordField(),                            false],
        ['a UsernameField',        () => new UsernameField(),                            false],
        ['a RadioButton',          () => new RadioButton(),                              false],
        ['a DateTimeField',        () => new DateTimeField(),                            false],
        ['a TextArea',             () => new TextArea(),                                 false],
        ['a consumer Text subclass', () => new (class LocalText extends Text {})('A'),   false],
    ] as const)('answers %s with %s', (_label, build, expected) => {
        install();

        const component = track(build() as Component);

        component.getElement(true);
        component.doLayout();
        flushFrame();

        expect(component.canSkipUnchangedCommit()).toBe(expected);
    });

    it('answers a FieldDecorator with true', () => {
        install();

        const grid  = track(new LabeledGrid({ columns: 1 }));
        const field = new TextField();

        grid.getElement(true);
        grid.addField('A', field);

        const decorator = new FieldDecorator(field, grid);

        decorator.getElement(true);
        decorator.doLayout();
        flushFrame();

        expect(decorator.canSkipUnchangedCommit()).toBe(true);
    });
});

describe('A clamped child that does not move is not laid out again (E2)', () => {
    /**
     * The width the grid asked `field` for on the pass `commits` recorded.
     *
     * @param commits - The `commitBounds` spy.
     * @param field - The child whose request to read.
     * @returns The requested width.
     */
    const requestedWidth = (commits: { mock: { calls: unknown[][] } }, field: Component): number => {
        const call = commits.mock.calls.find(args => args[0] === field);

        if (!call) {
            throw new Error('the grid never committed the field');
        }

        return call[3] as number;
    };

    it('withholds the checkbox pass and leaves every rectangle where the settled pass put it', () => {
        install();

        const checkbox = new Checkbox();

        checkbox.getElement(true);

        const { root, grid } = makeCellScene(checkbox);
        const first          = geometryOf(root);
        const commits        = vi.spyOn(LayoutManager.prototype as any, 'commitBounds');
        const layouts        = vi.spyOn(checkbox, 'doLayout');

        grid.invalidateLayout();
        root.doLayout();

        // The case only means anything while the clamp really bites: the grid
        // asks for the whole field track and the checkbox commits its own box,
        // so the request and the committed rectangle differ on every pass for
        // ever. That is what the request-based rule read as "changed".
        expect(requestedWidth(commits, checkbox)).toBeGreaterThan(checkbox.getWidth());
        expect(layouts).toHaveBeenCalledTimes(0);
        expect(geometryOf(root)).toBe(first);
    });

    it('lays the checkbox out once with the opt-ins off, at the same rectangles', () => {
        install();
        forcedOff();

        const checkbox = new Checkbox();

        checkbox.getElement(true);

        const { root, grid } = makeCellScene(checkbox);
        const first          = geometryOf(root);
        const commits        = vi.spyOn(LayoutManager.prototype as any, 'commitBounds');
        const layouts        = vi.spyOn(checkbox, 'doLayout');

        grid.invalidateLayout();
        root.doLayout();

        expect(requestedWidth(commits, checkbox)).toBeGreaterThan(checkbox.getWidth());
        expect(layouts).toHaveBeenCalledTimes(1);
        expect(geometryOf(root)).toBe(first);
    });
});

describe('A clamped child that moves is still laid out (E3)', () => {
    it('lays the checkbox out and moves it up when the row above it collapses', () => {
        install();

        const checkbox = new Checkbox();
        const leaf     = new Component({ preferredSize: { width: ROW_WIDTH, height: LEAF_HEIGHT } });

        checkbox.getElement(true);

        const { root } = makeCellScene(checkbox, leaf);
        const settledY = visualY(checkbox);

        // The plan's E3 says the checkbox lands at y 0 once the row above
        // collapses. In a grid host it lands at the grid's own top inset
        // instead, so the contract asserted here is the one that matters — the
        // box moved, and the clamped child was laid out for it.
        expect(settledY).toBeGreaterThanOrEqual(LEAF_HEIGHT);

        const layouts = vi.spyOn(checkbox, 'doLayout');

        leaf.setDisplayed(false);
        root.doLayout();
        flushFrame();

        expect(visualY(checkbox)).toBeLessThan(settledY);
        expect(layouts).toHaveBeenCalled();
    });
});

describe('A clamped child that moves sideways is still laid out (E3, horizontal)', () => {
    it('lays the checkbox out when the title track widens under it', () => {
        install();

        const checkbox = new Checkbox();

        checkbox.getElement(true);
        // A transition forces the slow path in `commitBounds`: a same-size move
        // with `canFastPath` false writes `setX` and zeroes the translate, so the
        // committed x before versus after the write is the *only* term of
        // `changed` that can catch the move. Without this the move commits
        // through the translate fast path and the translate terms catch it
        // instead, leaving the x term unguarded.
        checkbox.setTransition(MOVE_TRANSITION);

        const { root, grid } = makeCellScene(checkbox);
        const settledX       = visualX(checkbox);
        const settledWidth   = checkbox.getWidth();

        expect(checkbox.getTranslateX()).toBe(0);

        const layouts = vi.spyOn(checkbox, 'doLayout');

        labelFor(grid, 0).setText(LONGER_LABEL);
        flushFrame();

        expect(visualX(checkbox)).toBeGreaterThan(settledX);
        expect(checkbox.getWidth()).toBe(settledWidth);
        expect(checkbox.getTranslateX()).toBe(0);
        expect(layouts).toHaveBeenCalled();
    });
});

describe('A child resized out of band is laid out (E4)', () => {
    it('writes the settled height back and lays the text out', () => {
        install();

        const text = new Text('Notes');

        text.getElement(true);

        const { root, grid } = makeCellScene(text);
        const settled        = text.getHeight();

        expect(settled).not.toBe(OUT_OF_BAND_HEIGHT);

        text.setHeight(OUT_OF_BAND_HEIGHT);

        const layouts = vi.spyOn(text, 'doLayout');

        grid.invalidateLayout();
        root.doLayout();

        expect(text.getHeight()).toBe(settled);
        expect(layouts).toHaveBeenCalled();
    });
});

describe('Slider records the pass it ran (E5)', () => {
    it('leaves the slider clean and withholds its next pass, keeping the track and thumb placed', () => {
        install();

        const slider = new Slider({ min: SLIDER_MIN, max: SLIDER_MAX, value: SLIDER_VALUE });

        slider.getElement(true);

        const root = makeRoot(new Fit(), ROW_WIDTH, ROW_HEIGHT);

        root.addComponent(slider);
        settle(root);

        expect(slider.isLayoutDirty()).toBe(false);

        const first   = geometryOf(slider);
        const layouts = vi.spyOn(slider, 'doLayout');

        root.doLayout();

        expect(layouts).toHaveBeenCalledTimes(0);
        expect(geometryOf(slider)).toBe(first);
    });
});

describe('Slider drains a first-layout callback registered while detached (E5, drain arm)', () => {
    it('fires the callback on the first connected pass', () => {
        install();

        // The modelled source reports `isConnected` false unconditionally, so a
        // case that cares about attachment drives it explicitly, as
        // `tests/core/OnFirstLayout.test.ts` does.
        let connected = false;

        vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected);

        const slider = new Slider({ min: SLIDER_MIN, max: SLIDER_MAX, value: SLIDER_VALUE });

        slider.getElement(true);

        const ran = vi.fn();

        // Registered while detached, so it queues on the slider and waits for the
        // drain at the end of the *base* pass — the half `Slider.doLayout` used
        // to skip. A callback registered on a connected slider goes to the shared
        // after-layout queue instead and always fired, which is why this arm has
        // to detach first.
        slider.onFirstLayout(ran);
        flushFrame();

        expect(ran).not.toHaveBeenCalled();

        connected = true;

        const root = makeRoot(new Fit(), ROW_WIDTH, ROW_HEIGHT);

        root.addComponent(slider);
        settle(root);

        expect(ran).toHaveBeenCalledTimes(1);
    });
});

describe("A slider's own writes still move the thumb (E6)", () => {
    it('moves the thumb for a value, back for a widened range, and swaps the track axes for a vertical orientation', () => {
        install();

        const slider = new Slider({ min: SLIDER_MIN, max: SLIDER_MAX, value: SLIDER_VALUE });

        slider.getElement(true);

        const root = makeRoot(new Fit(), ROW_WIDTH, ROW_HEIGHT);

        root.addComponent(slider);
        settle(root);

        const [track, thumb] = slider.getComponents();
        const midpointX      = visualX(thumb);

        slider.setValue(SLIDER_FULL);
        flushFrame();

        expect(visualX(thumb)).toBeGreaterThan(midpointX);

        const fullX = visualX(thumb);

        slider.setMax(SLIDER_WIDENED_MAX);
        flushFrame();

        expect(visualX(thumb)).toBeLessThan(fullX);

        slider.setOrientation('vertical');
        flushFrame();

        expect(track.getHeight()).toBe(slider.getContentBounds()!.height);
        expect(track.getWidth()).toBe(SLIDER_TRACK_THICKNESS);
    });
});

describe('A settled form pass stops at the fields (E7)', () => {
    it('lays out the root, the panel and the grid, and nothing inside the grid', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        const first   = geometryOf(scene.root);
        const inGrid  = flatten(scene.grid).filter(c => c !== scene.grid);
        const layouts = vi.spyOn(Component.prototype, 'doLayout');

        scene.grid.invalidateLayout();
        scene.root.doLayout();

        const laidOut = new Set(layouts.mock.contexts);

        expect(laidOut.has(scene.root)).toBe(true);
        expect(laidOut.has(scene.panel)).toBe(true);
        expect(laidOut.has(scene.grid)).toBe(true);
        expect(inGrid.filter(c => laidOut.has(c))).toEqual([]);
        expect(geometryOf(scene.root)).toBe(first);
    });

    it('lays out every component in the grid with the opt-ins off, at the same rectangles', () => {
        install();
        forcedOff();

        const scene = makeFormScene();

        settle(scene.root);

        const first   = geometryOf(scene.root);
        const inGrid  = flatten(scene.grid).filter(c => c !== scene.grid);
        const layouts = vi.spyOn(Component.prototype, 'doLayout');

        scene.grid.invalidateLayout();
        scene.root.doLayout();

        const laidOut = new Set(layouts.mock.contexts);

        expect(inGrid.filter(c => !laidOut.has(c))).toEqual([]);
        expect(geometryOf(scene.root)).toBe(first);
    });

    it('lands the same rectangles in both arms', () => {
        const settledGeometry = (off: boolean): string => {
            install();

            if (off) {
                forcedOff();
            }

            const scene = makeFormScene();

            settle(scene.root);
            scene.grid.invalidateLayout();
            scene.root.doLayout();
            flushFrame();

            return geometryOf(scene.root);
        };

        const optedIn = settledGeometry(false);

        for (const root of roots) {
            root.dispose();
        }

        roots = [];
        vi.restoreAllMocks();
        DOM.reset();

        expect(optedIn).toBe(settledGeometry(true));
    });
});

describe("Each field's own content change still lays it out (E8)", () => {
    it('shows every write in the field that took it', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        scene.textField.setText(LONGER_TEXT);
        flushFrame();

        expect(DOM.source.getValue(scene.textField.getElement()!)).toBe(LONGER_TEXT);

        scene.comboBox.setValue(COMBO_RECORDS[1].id);
        flushFrame();

        expect(comboLabelText(scene.comboBox).getText()).toBe(COMBO_RECORDS[1].name);

        scene.dateField.setValue(E8_DATE);
        flushFrame();

        expect(innerInput(scene.dateField).getText()).toBe(E8_DATE_TEXT);

        scene.numberSpinner.setValue(SPINNER_VALUE);
        flushFrame();

        expect(innerInput(scene.numberSpinner).getText()).toBe(String(SPINNER_VALUE));

        const [checkboxBox]  = scene.checkbox.getComponents();
        const [checkGlyph]   = checkboxBox.getComponents();

        expect(checkGlyph.getOpacity()).toBe(0);

        scene.checkbox.setSelected(true);
        flushFrame();

        expect(scene.checkbox.isSelected()).toBe(true);
        expect(checkGlyph.getOpacity()).toBe(1);

        const [toggleTrack] = scene.toggle.getComponents();
        const [toggleThumb] = toggleTrack.getComponents();

        scene.toggle.setValue(true);
        flushFrame();

        expect(toggleThumb.getTransform()).toBe(TOGGLE_ON_TRANSFORM);

        const [, sliderThumb] = scene.slider.getComponents();
        const thumbX          = visualX(sliderThumb);

        scene.slider.setValue(SLIDER_RAISED);
        flushFrame();

        expect(visualX(sliderThumb)).toBeGreaterThan(thumbX);
    });
});

describe("A decorator's error state needs no pass (E9)", () => {
    it('moves nothing, stays skippable, and withholds both passes on the next grid pass', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        const fieldBox = `${visualX(scene.textField)},${visualY(scene.textField)},${scene.textField.getWidth()},${scene.textField.getHeight()}`;

        const boxOf = (component: Component): string =>
            `${visualX(component)},${visualY(component)},${component.getWidth()},${component.getHeight()}`;

        scene.decorator.showError('Required');
        flushFrame();

        expect(scene.decorator.getOutline()).not.toBeNull();
        expect(scene.decorator.canSkipUnchangedCommit()).toBe(true);
        // Checked here as well as after `clearError`: an outline that took
        // layout space would move the field and a `clearError` that moved it
        // back would hide it from an end-to-end comparison alone.
        expect(boxOf(scene.textField)).toBe(fieldBox);

        scene.decorator.clearError();
        flushFrame();

        expect(scene.decorator.getOutline()).toBeNull();
        expect(scene.decorator.canSkipUnchangedCommit()).toBe(true);
        expect(boxOf(scene.textField)).toBe(fieldBox);

        const decoratorLayouts = vi.spyOn(scene.decorator, 'doLayout');
        const fieldLayouts     = vi.spyOn(scene.textField, 'doLayout');

        scene.grid.invalidateLayout();
        scene.root.doLayout();

        expect(decoratorLayouts).toHaveBeenCalledTimes(0);
        expect(fieldLayouts).toHaveBeenCalledTimes(0);
    });
});

describe("A label's text change still re-flows the grid (E10)", () => {
    it('widens the label and moves every field right', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        const label       = labelFor(scene.grid, 0);
        const widthBefore = label.getWidth();
        // The decorator, not the text field: the field fills the decorator, so
        // its own x is 0 in every arm — the decorator is what the grid places.
        const fields      = [scene.decorator, scene.comboBox, scene.dateField, scene.timeField,
            scene.numberSpinner, scene.checkbox, scene.toggle, scene.slider, scene.plainField];
        const before      = fields.map(visualX);

        label.setText(LONGER_LABEL);
        flushFrame();

        expect(label.getWidth()).toBeGreaterThan(widthBefore);
        expect(fields.filter((field, index) => visualX(field) <= before[index])).toEqual([]);
    });
});

describe('A Text subclass inside the scene still lays out (E11)', () => {
    it('lays the Label out and leaves the plain labels skipped', () => {
        install();

        const scene   = makeFormScene();
        const section = new Label('Section', LABEL_FOR_ID);

        scene.grid.addFullWidthRow(section);
        settle(scene.root);

        const labels  = FIELD_TITLES.map((_title, index) => labelFor(scene.grid, index));
        const layouts = vi.spyOn(Component.prototype, 'doLayout');

        scene.grid.invalidateLayout();
        scene.root.doLayout();

        const laidOut = new Set(layouts.mock.contexts);

        expect(laidOut.has(section)).toBe(true);
        expect(labels.filter(label => laidOut.has(label))).toEqual([]);
    });
});

describe('A web-font swap re-measures through the skip (E12)', () => {
    it('lands every rectangle where the forced-off arm lands it, and moves at least one', () => {
        const swapped = (off: boolean): { geometry: string; before: string } => {
            const config = makeConfig();

            install(config);

            if (off) {
                forcedOff();
            }

            const scene = makeFormScene();

            settle(scene.root);

            const before = geometryOf(scene.root);

            widenFont(config);
            ThemeManager.setTheme(ThemeManager.getTheme());
            flushFrame();
            scene.root.doLayout();
            flushFrame();

            return { geometry: geometryOf(scene.root), before };
        };

        const optedIn = swapped(false);

        for (const root of roots) {
            root.dispose();
        }

        roots = [];
        vi.restoreAllMocks();
        DOM.reset();

        const off = swapped(true);

        expect(optedIn.geometry).toBe(off.geometry);
        expect(optedIn.geometry).not.toBe(optedIn.before);
    });
});

describe('A theme switch lays every opted-in component out once (E13)', () => {
    it('lays all ten out during the switch, then withholds each on the next grid pass', () => {
        install();

        const scene = makeFormScene();

        settle(scene.root);

        const layouts = scene.optedIn.map(component => vi.spyOn(component, 'doLayout'));

        ThemeManager.setTheme(largerFontTheme());
        flushFrame();

        expect(layouts.filter(spy => spy.mock.calls.length === 0)).toEqual([]);

        layouts.forEach(spy => spy.mockClear());

        scene.grid.invalidateLayout();
        scene.root.doLayout();

        expect(layouts.filter(spy => spy.mock.calls.length > 0)).toEqual([]);
    });
});

describe("A combo box's renderer rebind and swap still get placed (audit closure)", () => {
    /**
     * A combo box of two records, the first with no glyph and the second with
     * one, under a one-column grid — the scene where rebinding the label builds
     * a renderer child that did not exist before.
     *
     * @param off - Whether to force the ten opt-ins off.
     * @returns The root, the grid and the combo box.
     */
    const glyphComboScene = (off: boolean): { root: Container; grid: LabeledGrid; comboBox: ComboBox } => {
        install();

        if (off) {
            forcedOff();
        }

        const root = makeRoot(new Fit(), FORM_WIDTH, ROW_HEIGHT);
        const grid = new LabeledGrid({ columns: 1 });
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
     * withholds it. A closure that marked only the label, leaving the field free
     * to skip, fails both cases.
     *
     * @param off - Whether to force the ten opt-ins off.
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

        // Tear the first arm down before the second installs its own DOM; the
        // last arm leaves the modelled DOM in place for `afterEach`, which
        // restores the theme through it.
        for (const built of roots) {
            built.dispose();
        }

        roots = [];
        vi.restoreAllMocks();
        DOM.reset();

        expect(optedIn).toBe(geometryAfter(true, write));
        expect(optedIn).not.toContain('NaN');
    });
});
