// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The three field types whose cells render a `Date` as locale-formatted text.
 *
 * @category Data
 */
export type TemporalFieldType = 'date' | 'time' | 'datetime';

/**
 * Formats `value` exactly as a cell of this variant displays it — the same
 * `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` calls the
 * `Date` / `Time` / `DateTime` cell renderers use, so a substring filter over
 * a temporal column can match what the cell actually shows.
 *
 * @param type - The temporal field type, selecting which native formatter runs.
 * @param showSeconds - Whether to include seconds; ignored for `'date'`.
 * @param value - The value to format.
 * @returns The locale-formatted display text.
 *
 * @internal — not re-exported from the package barrel.
 */
export function temporalDisplayText(type: TemporalFieldType, showSeconds: boolean, value: Date): string {
    switch (type) {
        case 'date':
            return value.toLocaleDateString();

        case 'time':
            return value.toLocaleTimeString(undefined, showSeconds
                ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
                : { hour: '2-digit', minute: '2-digit' });

        case 'datetime':
            return value.toLocaleString(undefined, showSeconds
                ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
                : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
}
