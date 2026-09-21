import { buildForm } from '../builders/form.js';
import type { PanelBuild } from '../panels.js';

export const description = 'Form of n fields (default 64) cycling eight kinds (a TextField wrapped in a FieldDecorator that checks it on every change, a ComboBox over 20 options, DateField, TimeField, NumberSpinner, Checkbox, Toggle, Slider) in one two-column LabeledGrid, under a one-column LabeledGrid of eight TextFields, in a scrolling panel. Reproduces slice 28 F28.10 (a labelled grid of eight text fields asks 160 size hints per pass) under passes=header; slice 17 F17.1 (a closed picker field re-lays itself out on every settled parent pass: 8 apply, 10 doLayout, 125 size hints) under passes=date; slice 16 F16.3 (a ComboBox rewrites its caret glyph every layout pass: 7 apply per settled pass) under passes=combo; C23 (DateField accepts partial dates and flashes its border while typing) under type=date; and C40 (a Checkbox or Slider announcing action for a programmatic write, and a Checkbox for a click outside its box) under drive=update and click=root, read through the checkbox.action and slider.action counters under work=1. The flat partner of form-nested.';

/** 64 fields: eight of each kind, a long form that scrolls. */
export const defaultScale = 64;

/** One unchanged pass of the whole form, the size-report fan-out's unit. */
export const defaultDrive = 'passes';

/**
 * Builds the flat form.
 *
 * @param n - Fields.
 * @param params - `passes=`, `type=` and `click=` choose targets.
 * @returns The form.
 */
export function build(n: number, params: URLSearchParams): PanelBuild {
    return buildForm(n, 'flat', params, 'form-flat');
}
