// The form `form-flat` and `form-nested` share: the same fields, in one
// labelled grid or in fieldsets beside an inspector. The two depths are the
// deep and shallow partners for the size-report groups (G05, G11), whose cost
// grows with nesting, so one builder makes both and only the containers differ.

import { Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { LabeledFieldSet, LabeledGrid } from '@jimka/typescript-ui/component/container';
import { Checkbox, ComboBox, DateField, NumberSpinner, Slider, TextField, TimeField, Toggle } from '@jimka/typescript-ui/component/input';
import { Table } from '@jimka/typescript-ui/component/table';
import type { CellType, ComboOption } from '@jimka/typescript-ui/component/table';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import type { AbstractStore, ModelRecord } from '@jimka/typescript-ui/data';
import { Split, VBox } from '@jimka/typescript-ui/layout';
import { FieldDecorator } from '@jimka/typescript-ui/validation';
import type { CallTarget, GeometryTarget, HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';
import { listItems } from './data.js';
import { elementFor, requireElement } from './dom.js';
import { choice } from './params.js';
import { TYPE_TEXT } from './shared.js';

/** A form's depth: every field in one grid, or fieldsets of eight beside an inspector. */
export type FormDepth = 'flat' | 'nested';

/** The field kinds, in the order the form cycles through them. */
const FIELD_KINDS = ['text', 'combo', 'date', 'time', 'number', 'checkbox', 'toggle', 'slider'] as const;

/** One field kind. */
export type FieldKind = typeof FIELD_KINDS[number];

/** What `passes` lays out: the whole form, the header grid, or the first field of one kind. */
const PASSES = ['form', 'header', 'date', 'combo'] as const;

/** What `type` types into: the first decorated text field, or the first date field. */
const TYPES = ['text', 'date'] as const;

/** What `click` clicks: the controls' own click surfaces, the first checkbox's element outside its box, or the first combo box. */
const CLICKS = ['toggle', 'root', 'combo'] as const;

/** Fields per fieldset in `form-nested`: one of each kind. */
const FIELDS_PER_GROUP = FIELD_KINDS.length;

/** Plain text fields in the header grid: F28.10's fixture, a one-column labelled grid of eight. */
const HEADER_FIELDS = 8;

/** Logical title/field columns in the fields' grids: two, a typical form's. */
const FIELD_COLUMNS = 2;

/** Options in the combo boxes' shared store: enough for the dropdown to scroll, F16.3's twenty. */
const COMBO_OPTIONS = 20;

/** The longest text the decorated fields accept: a short limit, so a run that types past it shows the error. */
const MAX_TEXT_CHARS = 20;

/** The decorated fields' error message. */
const TEXT_ERROR = `Required, ${MAX_TEXT_CHARS} characters at most`;

/** What `type=date` types: one full date, the ten characters C23 is read over. */
const DATE_TEXT = '2026-09-19';

/** Text one character past the decorated fields' limit: the shortest text that shows their error. */
const OVER_LIMIT_TEXT = 'x'.repeat(MAX_TEXT_CHARS + 1);

/** The one character C21's sequence types into the second decorated field; the field stays over its limit. */
const KEYSTROKE = 'x';

/** The tooltip's element, by the class the library gives each component's element; a page has one tooltip. */
const TOOLTIP_SELECTOR = '.Tooltip';

/** The `buttons` bitmask with no button held, fixed by the UI Events spec: a hover, not a drag. */
const NO_BUTTONS_HELD = 0;

// The sliders' range and start: a percentage at its midpoint, so a pan moves
// the thumb both ways without reaching either end.
const SLIDER_MIN = 0;
const SLIDER_MAX = 100;
const SLIDER_VALUE = 50;

/** How far `update` moves the slider off its start and back: one step at a `Slider`'s default step of 1, so the write stays on the step grid and always changes the value. */
const SLIDER_NUDGE = 1;

/**
 * What each `click=` mode clicks: a field kind, and the element inside that
 * field which takes the click — `null` for the field's own element. A toggle
 * toggles from its track and a checkbox from its box, never from their own
 * elements, so `toggle` clicks those surfaces; `root` clicks the checkbox's
 * own element on purpose, since that is where a click on a label lands.
 */
const CLICK_SURFACES: Record<typeof CLICKS[number], ReadonlyArray<readonly [FieldKind, string | null]>> = {
    toggle: [['toggle', '.ToggleTrack'], ['checkbox', '.CheckboxBox']],
    root: [['checkbox', null]],
    combo: [['combo', null]],
};

/** The inspector's preferred width: room for the property and value columns side by side. */
const INSPECTOR_WIDTH_PX = 320;

/** The inspector's preferred height: any value works, since the split fills the viewport; this one is a typical screen's. */
const INSPECTOR_HEIGHT_PX = 600;

/** Rows in the inspector: three of each cell kind it cycles through. */
const INSPECTOR_ROWS = 12;

/** The inspector's cell kinds, cycled per row, as `PropertyGridPanel`'s rows mix them. */
const INSPECTOR_KINDS: readonly CellType[] = ['boolean', 'combo', 'number', 'string'];

// The inspector's column widths: `PropertyGridPanel`'s, which fit the pane.
const PROPERTY_MIN_WIDTH_PX = 140;
const VALUE_MIN_WIDTH_PX = 160;

// The inspector's two combo option lists, `PropertyGridPanel`'s: `Owner`
// rows take the first, every other combo row the second.
const OWNER_OPTIONS: ComboOption[] = [{ value: 'alice', label: 'Alice' }, { value: 'bob', label: 'Bob' }];
const DATATYPE_OPTIONS: ComboOption[] = [{ value: 'string', label: 'String' }, { value: 'number', label: 'Number' }];

/** A decorated text field: the field, its decorator, and the check its `change` listener runs. */
interface DecoratedField {
    field: TextField;
    decorator: FieldDecorator;
    check: (value: string) => void;
}

/** A built form's parts, where its targets are found. */
interface FormParts {
    root: Component;
    scroller: Panel;
    header: LabeledGrid;
    inspector: Table | null;
    /** The first field of each kind the form holds; a kind past `n` is absent. */
    first: Partial<Record<FieldKind, Component>>;
    /** Every decorated text field, in form order; C21's `call` target uses the first two. */
    decorated: DecoratedField[];
}

/** The form's parameters, read in `build` so a bad value fails before mounting. */
interface FormChoices {
    type: typeof TYPES[number];
    click: typeof CLICKS[number];
}

/**
 * A change handler for one decorated text field: shows the error while the
 * value is empty or too long, and clears it otherwise — as an application's
 * required-field check does on every keystroke.
 *
 * @param decorator - The field's decorator.
 * @returns The handler.
 */
function requireShortText(decorator: FieldDecorator): (value: string) => void {
    return function checkShortText(value: string): void {
        if (value === '' || value.length > MAX_TEXT_CHARS) {
            decorator.showError(TEXT_ERROR);
        } else {
            decorator.clearError();
        }
    };
}

/**
 * One form field of `kind`.
 *
 * @param kind - The field's kind.
 * @param store - The combo boxes' shared store of options.
 * @returns The field.
 */
export function formField(kind: FieldKind, store: AbstractStore): Component {
    switch (kind) {
        case 'text':
            return TextField();
        case 'combo':
            return ComboBox({ store, displayField: 'name', valueField: 'id' });
        case 'date':
            return DateField();
        case 'time':
            return TimeField();
        case 'number':
            return NumberSpinner();
        case 'checkbox':
            return Checkbox();
        case 'toggle':
            return Toggle();
        case 'slider':
            return Slider({ min: SLIDER_MIN, max: SLIDER_MAX, value: SLIDER_VALUE });
    }
}

/**
 * Wraps a text field that sits in its grid in a `FieldDecorator`, and checks
 * its value on every change.
 *
 * @param field - The text field, already added to its grid.
 * @returns The decorated field.
 */
function decorate(field: TextField): DecoratedField {
    const decorator = FieldDecorator(field, field.getParentComponent()!);
    const check = requireShortText(decorator);

    field.on('change', check);

    return { field, decorator, check };
}

/**
 * Adds fields `from`…`to − 1` to `grid`, titled `Field <i+1>`, remembering
 * the first of each kind and decorating every text field.
 *
 * @param grid - The grid or fieldset the fields go in.
 * @param from - The first field's index.
 * @param to - One past the last field's index.
 * @param store - The combo boxes' store.
 * @param first - The first field of each kind; filled in.
 * @param decorated - The decorated text fields; filled in.
 */
function addFields(grid: LabeledGrid | LabeledFieldSet, from: number, to: number, store: AbstractStore, first: FormParts['first'], decorated: DecoratedField[]): void {
    for (let i = from; i < to; i++) {
        const kind = FIELD_KINDS[i % FIELD_KINDS.length];
        const field = formField(kind, store);

        grid.addField(`Field ${i + 1}`, field);
        first[kind] ??= field;

        if (kind === 'text') {
            decorated.push(decorate(field as TextField));
        }
    }
}

/**
 * The header: a one-column labelled grid of eight plain text fields, F28.10's
 * fixture.
 *
 * @returns The grid.
 */
function headerGrid(): LabeledGrid {
    const header = LabeledGrid({ columns: 1 });

    for (let k = 0; k < HEADER_FIELDS; k++) {
        header.addField(`Header ${k + 1}`, TextField());
    }

    return header;
}

/**
 * The fields' containers: one two-column grid of all `n` (flat), or
 * `⌈n / 8⌉` two-column fieldsets of eight (nested).
 *
 * @param n - Fields.
 * @param depth - The form's depth.
 * @param store - The combo boxes' store.
 * @param first - The first field of each kind; filled in.
 * @param decorated - The decorated text fields; filled in.
 * @returns The containers, in order.
 */
function fieldContainers(n: number, depth: FormDepth, store: AbstractStore, first: FormParts['first'], decorated: DecoratedField[]): Component[] {
    if (depth === 'flat') {
        const grid = LabeledGrid({ columns: FIELD_COLUMNS });

        addFields(grid, 0, n, store, first, decorated);

        return [grid];
    }

    return Array.from({ length: Math.ceil(n / FIELDS_PER_GROUP) }, (_, g) => {
        const group = LabeledFieldSet(`Group ${g + 1}`, { columns: FIELD_COLUMNS });

        addFields(group, g * FIELDS_PER_GROUP, Math.min((g + 1) * FIELDS_PER_GROUP, n), store, first, decorated);

        return group;
    });
}

/**
 * An inspector row's property name: its kind's word and its number; a combo
 * row alternates between `Owner` and `Data type`, choosing its option list.
 *
 * @param kind - The row's cell kind.
 * @param i - The row's index.
 * @returns The name.
 */
function propertyName(kind: CellType, i: number): string {
    switch (kind) {
        case 'boolean':
            return `Enabled ${i + 1}`;
        case 'combo':
            return Math.floor(i / INSPECTOR_KINDS.length) % 2 === 0 ? `Owner ${i + 1}` : `Data type ${i + 1}`;
        case 'number':
            return `Count ${i + 1}`;
        default:
            return `Name ${i + 1}`;
    }
}

/**
 * An inspector row's starting value, one of its kind's.
 *
 * @param kind - The row's cell kind.
 * @param property - The row's property name.
 * @param i - The row's index.
 * @returns The value.
 */
function propertyValue(kind: CellType, property: string, i: number): unknown {
    switch (kind) {
        case 'boolean':
            return i % 2 === 0;
        case 'combo':
            return comboOptions(property)[0].value;
        case 'number':
            return i;
        default:
            return `Value ${i + 1}`;
    }
}

/**
 * The option list for a combo row, by its property name.
 *
 * @param property - The row's property name.
 * @returns `OWNER_OPTIONS` for an `Owner` row, `DATATYPE_OPTIONS` otherwise.
 */
function comboOptions(property: string): ComboOption[] {
    return property.startsWith('Owner') ? OWNER_OPTIONS : DATATYPE_OPTIONS;
}

/**
 * The value column's cell kind for a row: the row's own `kind`.
 *
 * @param record - The row.
 * @returns Its cell kind.
 */
function rowCellType(record: ModelRecord): CellType {
    return record.get('kind') as CellType;
}

/**
 * The value column's combo options for a row.
 *
 * @param record - The row.
 * @returns Its option list.
 */
function rowCellValues(record: ModelRecord): ComboOption[] {
    return comboOptions(String(record.get('property')));
}

/**
 * `form-nested`'s inspector, as `PropertyGridPanel` builds its property grid:
 * a `Table` whose `value` column renders a different cell type per row.
 *
 * @returns The table.
 */
export function inspectorTable(): Table {
    const store = new MemoryStore(new Model([
        { name: 'property', type: 'string' },
        { name: 'value', type: 'auto' },
        { name: 'kind', type: 'string' },
    ]));

    store.loadData(Array.from({ length: INSPECTOR_ROWS }, (_, i) => {
        const kind = INSPECTOR_KINDS[i % INSPECTOR_KINDS.length];
        const property = propertyName(kind, i);

        return { property, value: propertyValue(kind, property, i), kind };
    }));

    const table = Table(store, {
        columns: [
            { field: 'property', minWidth: PROPERTY_MIN_WIDTH_PX, readOnly: true },
            { field: 'value', minWidth: VALUE_MIN_WIDTH_PX, cellType: rowCellType, cellValues: rowCellValues },
            { field: 'kind', hidden: true },
        ],
    });

    table.setPreferredSize({ width: INSPECTOR_WIDTH_PX, height: INSPECTOR_HEIGHT_PX });

    return table;
}

/**
 * The form's root: the scrolling form alone (flat), or beside the inspector
 * in a split (nested).
 *
 * @param scroller - The scrolling form.
 * @param inspector - The inspector, or `null` for a flat form.
 * @returns The root.
 */
function formRoot(scroller: Panel, inspector: Table | null): Component {
    if (!inspector) {
        return scroller;
    }

    return Panel({
        layoutManager: Split({ orientation: 'horizontal' }),
        components: [
            { component: scroller, constraints: { weight: 1 } },
            { component: inspector, constraints: { weight: 0 } },
        ],
    });
}

/**
 * The `passes` target for the `passes=` parameter.
 *
 * @param mode - What to lay out.
 * @param parts - The form's parts.
 * @returns The component, or `undefined` when the form holds no field of that kind.
 */
function passesTarget(mode: typeof PASSES[number], parts: FormParts): Component | undefined {
    switch (mode) {
        case 'form':
            return parts.root;
        case 'header':
            return parts.header;
        default:
            return parts.first[mode];
    }
}

/**
 * The `type` target for the `type=` parameter: a decorated text field's
 * `<input>`, which is the field's own element, or a date field's.
 *
 * @param tools - The harness tools.
 * @param parts - The form's parts.
 * @param mode - What to type into.
 * @param panel - The panel's id, for errors.
 * @returns `{ element, text }`, or `undefined` when the form holds no field of that kind.
 */
function typeTarget(tools: HarnessTools, parts: FormParts, mode: FormChoices['type'], panel: string): { element: HTMLElement; text: string } | undefined {
    const field = parts.first[mode];

    if (!field) {
        return undefined;
    }

    const element = elementFor(tools, field, panel);

    return mode === 'text' ? { element, text: TYPE_TEXT } : { element: requireElement(element, 'input', panel), text: DATE_TEXT };
}

/**
 * The `click` target for the `click=` parameter: for `toggle`, the first
 * toggle's track and the first checkbox's box, the surfaces each one toggles
 * from; for `root`, the first checkbox's own element, outside its box; for
 * `combo`, the first combo box.
 *
 * @param tools - The harness tools.
 * @param parts - The form's parts.
 * @param mode - What to click.
 * @param panel - The panel's id, for errors.
 * @returns `{ elements }`, or `undefined` when the form holds none of those fields.
 * @throws Error - When a field's click surface is missing from its element.
 */
function clickTarget(tools: HarnessTools, parts: FormParts, mode: FormChoices['click'], panel: string): { elements: HTMLElement[] } | undefined {
    const elements = CLICK_SURFACES[mode]
        .filter(([kind]) => parts.first[kind] !== undefined)
        .map(([kind, selector]) => {
            const element = elementFor(tools, parts.first[kind]!, panel);

            return selector === null ? element : requireElement(element, selector, panel);
        });

    return elements.length > 0 ? { elements } : undefined;
}

/**
 * Sets a decorated field's text and runs the check its `change` listener
 * runs — what one keystroke does, done through the field and its decorator
 * rather than through DOM events.
 *
 * @param entry - The decorated field.
 * @param text - The field's new text.
 */
function enterText(entry: DecoratedField, text: string): void {
    entry.field.setText(text);
    entry.check(text);
}

/**
 * Sends `element` a `mouseover` at its centre with no button held: the
 * event that arms a tooltip's hover delay.
 *
 * @param tools - The harness tools.
 * @param element - The element hovered.
 */
function hoverCentre(tools: HarnessTools, element: HTMLElement): void {
    const rect = element.getBoundingClientRect();

    tools.fireMouse('mouseover', element, rect.left + rect.width / 2, rect.top + rect.height / 2, { buttons: NO_BUTTONS_HELD });
}

/**
 * Whether a tooltip is on screen.
 *
 * @param tools - The harness tools, for `isPainted`.
 * @returns `true` when the tooltip's element exists and is painted.
 */
function tooltipOnScreen(tools: HarnessTools): boolean {
    const element = document.querySelector(TOOLTIP_SELECTOR);

    return element !== null && tools.isPainted(element);
}

/**
 * The `call` target: C21's sequence on the first two decorated text fields.
 * Unit 0 types both past their limit, so both show their error, then hovers
 * the first field. On the first later unit that finds the tooltip on screen,
 * one character is typed into the second field, whose error re-attaches its
 * own tooltip; nothing is typed after that.
 *
 * @param tools - The harness tools.
 * @param parts - The form's parts.
 * @param panel - The panel's id, for errors.
 * @returns The target, or `undefined` when the form holds fewer than two decorated fields.
 */
function tooltipOwnershipTarget(tools: HarnessTools, parts: FormParts, panel: string): CallTarget | undefined {
    const [owner, other] = parts.decorated;

    if (!owner || !other) {
        return undefined;
    }

    const fieldElement = elementFor(tools, owner.field, panel);
    let typed = false;

    return function stepTooltipOwnership(index: number): void {
        if (index === 0) {
            enterText(owner, OVER_LIMIT_TEXT);
            enterText(other, OVER_LIMIT_TEXT);
            hoverCentre(tools, fieldElement);

            return;
        }

        if (!typed && tooltipOnScreen(tools)) {
            enterText(other, other.field.getText() + KEYSTROKE);
            typed = true;
        }
    };
}

/**
 * The `update` target: one programmatic write per unit to the first checkbox
 * and the first slider — the checkbox flipped, the slider moved one step off
 * its start and back. Each write reads the control's current state rather
 * than the unit's index, so every unit is a real transition for both, even
 * after an earlier phase moved them.
 *
 * @param first - The first field of each kind.
 * @returns The target, or `undefined` when the form lacks a checkbox or a slider.
 */
function programmaticWrites(first: FormParts['first']): CallTarget | undefined {
    const checkbox = first.checkbox as Checkbox | undefined;
    const slider = first.slider as Slider | undefined;

    if (!checkbox || !slider) {
        return undefined;
    }

    return function writeCheckboxAndSlider(): void {
        checkbox.setSelected(!checkbox.isSelected());
        slider.setValue(slider.getValue() === SLIDER_VALUE ? SLIDER_VALUE + SLIDER_NUDGE : SLIDER_VALUE);
    };
}

/**
 * The form's work counters: one `checkbox.action` per `"action"` the first
 * checkbox delivers, and one `slider.action` per `"action"` the first slider
 * delivers.
 *
 * @param tools - The harness tools.
 * @param first - The first field of each kind.
 * @returns One note per control, saying what it counts or that the form lacks it.
 */
function countActions(tools: HarnessTools, first: FormParts['first']): string[] {
    const checkbox = first.checkbox as Checkbox | undefined;
    const slider = first.slider as Slider | undefined;
    const notes: string[] = [];

    if (checkbox) {
        checkbox.on('action', function countCheckboxAction(): void {
            tools.bumpWork('checkbox.action');
        });
        notes.push('counting checkbox.action on the first Checkbox');
    } else {
        notes.push('no Checkbox');
    }

    if (slider) {
        slider.on('action', function countSliderAction(): void {
            tools.bumpWork('slider.action');
        });
        notes.push('counting slider.action on the first Slider');
    } else {
        notes.push('no Slider');
    }

    return notes;
}

/**
 * The targets that need the mounted page. A driver whose field kind the form
 * does not hold — a slider needs at least eight fields — gets no target, so
 * a phase naming it fails the run's target check.
 *
 * @param tools - The harness tools.
 * @param parts - The form's parts.
 * @param choices - The parameters read in `build`.
 * @param panel - The panel's id, for errors.
 * @returns `hover`, `wheel`, and `type`, `click`, `pan` and `call` where their fields exist.
 */
function mountedTargets(tools: HarnessTools, parts: FormParts, choices: FormChoices, panel: string): Record<string, unknown> {
    const slider = parts.first.slider;

    const targets: Record<string, unknown> = {
        hover: { element: elementFor(tools, parts.header, panel), axis: 'y' },
        wheel: elementFor(tools, parts.scroller, panel),
        type: typeTarget(tools, parts, choices.type, panel),
        click: clickTarget(tools, parts, choices.click, panel),
        pan: slider ? { element: elementFor(tools, slider, panel), axis: 'x' } : undefined,
        call: tooltipOwnershipTarget(tools, parts, panel),
    };

    return Object.fromEntries(Object.entries(targets).filter(([, target]) => target !== undefined));
}

/**
 * Builds a form of `n` fields cycling eight kinds, under a header grid of
 * eight text fields, in a scrolling panel: in one two-column grid (flat), or
 * in fieldsets of eight beside an inspector table (nested). `click=` chooses
 * `toggle`, `root` or `combo`; a form holding a slider (`n` ≥ 8) also gets an
 * `update` target, one programmatic write per unit to the first checkbox and
 * slider, and under `work=1` counts each one's `"action"` deliveries.
 *
 * @param n - Fields.
 * @param depth - The form's depth.
 * @param params - The page's URL parameters: `passes=`, `type=` and `click=`.
 * @param panel - The panel's id, for errors.
 * @returns The form's build.
 * @throws Error - For an unknown `passes=`, `type=` or `click=` value.
 */
export function buildForm(n: number, depth: FormDepth, params: URLSearchParams, panel: string): PanelBuild {
    const passesMode = choice(params, 'passes', PASSES, panel);
    const choices: FormChoices = { type: choice(params, 'type', TYPES, panel), click: choice(params, 'click', CLICKS, panel) };
    const store = new MemoryStore(new Model([{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }]));

    store.loadData(listItems(COMBO_OPTIONS));

    const first: FormParts['first'] = {};
    const decorated: DecoratedField[] = [];
    const header = headerGrid();

    const scroller = Panel({
        autoScroll: 'y',
        layoutManager: VBox({ stretching: true }),
        components: [header, ...fieldContainers(n, depth, store, first, decorated)],
    });

    const inspector = depth === 'nested' ? inspectorTable() : null;
    const parts: FormParts = { root: formRoot(scroller, inspector), scroller, header, inspector, first, decorated };
    const geometry: Record<string, GeometryTarget> = { header, form: scroller, tooltip: TOOLTIP_SELECTOR };
    const targets: Record<string, unknown> = { resize: parts.root };
    const passes = passesTarget(passesMode, parts);
    const update = programmaticWrites(first);

    if (inspector) {
        geometry.inspector = inspector;
    }

    if (passes) {
        targets.passes = passes;
    }

    if (update) {
        targets.update = update;
    }

    return {
        root: parts.root,
        targets,
        afterMount: (tools: HarnessTools): Record<string, unknown> => mountedTargets(tools, parts, choices, panel),
        geometry,
        describe: () => ({ fields: n }),
        installWork: (tools: HarnessTools): string[] => countActions(tools, first),
    };
}
