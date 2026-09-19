import { buildForm } from '../builders/form.js';
import type { PanelBuild } from '../panels.js';

export const description = 'form-flat\'s header and fields, the fields in LabeledFieldSets of eight (two columns each) in a scrolling panel, beside an inspector Table whose value column takes a cell type per row, as PropertyGridPanel\'s does, in a Split. The same figures as form-flat: slice 28 F28.10 under passes=header, slice 17 F17.1 under passes=date, slice 16 F16.3 under passes=combo, C23 under type=date. The nested partner of form-flat, for the size-report groups whose cost grows with depth.';

/** 64 fields: eight fieldsets of one field of each kind. */
export const defaultScale = 64;

/** One unchanged pass of the whole form, the size-report fan-out's unit. */
export const defaultDrive = 'passes';

/**
 * Builds the nested form.
 *
 * @param n - Fields.
 * @param params - `passes=`, `type=` and `click=` choose targets.
 * @returns The form.
 */
export function build(n: number, params: URLSearchParams): PanelBuild {
    return buildForm(n, 'nested', params, 'form-nested');
}
