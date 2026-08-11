// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { StringRenderer } from "~/component/table/cell/renderer/String.js";
import { NumberRenderer } from "~/component/table/cell/renderer/Number.js";
import { DateRenderer } from "~/component/table/cell/renderer/Date.js";
import { TimeRenderer } from "~/component/table/cell/renderer/Time.js";
import { DateTimeRenderer } from "~/component/table/cell/renderer/DateTime.js";
import { GlyphRenderer } from "~/component/table/cell/renderer/Glyph.js";
import { ComboRenderer } from "~/component/table/cell/renderer/Combo.js";
import type { CellType, ComboOption } from "~/component/table/ColumnConfig.js";

/**
 * Builds the renderer that draws a cell of this variant. The shared factory
 * behind {@link DynamicCell.buildRenderer} and {@link CellTextResolver} — one
 * authority for "which renderer draws this variant".
 *
 * @param type - The built-in variant to construct a renderer for.
 * @param showSeconds - Forwarded to `time`/`datetime` renderers.
 * @param numberAlign - Text alignment for a `number` renderer. Defaults to
 *   `"right"`; {@link DynamicCell} passes `"left"` explicitly, since its
 *   number row sits alongside left-aligned rows of other types in the same
 *   column.
 * @returns A freshly constructed renderer for `type`. `glyph` and any
 *   unrecognised variant fall back to a {@link StringRenderer}.
 *
 * @internal
 */
export function buildCellRenderer(
    type:         CellType,
    showSeconds:  boolean,
    numberAlign:  "left" | "right" = "right",
): CellRenderer<any> {
    switch (type) {
        case 'number':
            return new NumberRenderer(numberAlign);
        case 'date':
            return new DateRenderer();
        case 'time':
            return new TimeRenderer(showSeconds);
        case 'datetime':
            return new DateTimeRenderer(showSeconds);
        case 'combo':
            return new ComboRenderer([]);
        case 'glyph':
            return new GlyphRenderer();
        default:
            return new StringRenderer(); // 'string' | 'auto'
    }
}

/**
 * Owner-held pool of unmounted renderers used to format values off-screen —
 * the small pool {@link Table} and {@link TableHeader} format non-cell values
 * (export, filter-build, quick search) through. Mirrors
 * [`CellEditorPool`](/api/component/table/classes/CellEditorPool): a keyed
 * cache of at most one renderer per variant, lazily built, disposed by its
 * owner.
 *
 * @category Components
 * @internal
 */
export class CellTextResolver {

    private _renderers    : Map<string, CellRenderer<any>>      = new Map();
    private _comboOptions : Array<ComboOption | string> | null  = null;

    /**
     * Formats `value` the way the matching cell renderer would display it.
     *
     * @param type - The variant to format against.
     * @param showSeconds - Forwarded to a `time`/`datetime` variant's renderer.
     * @param values - The combo option list; consulted (and cached) only when
     *   `type` is `'combo'`.
     * @param value - The raw value to format.
     * @returns The display text {@link CellRenderer.getDisplayText} would
     *   report for this value.
     */
    text(
        type:        CellType,
        showSeconds: boolean,
        values:      Array<ComboOption | string> | undefined,
        value:       any,
    ): string {
        const key      = showSeconds ? `${type}:seconds` : type;
        let   renderer = this._renderers.get(key);

        if (!renderer) {
            renderer = buildCellRenderer(type, showSeconds);
            // Never parented, never rendered: keep its Text writes from
            // enqueuing a layout pass for a component nothing will lay out.
            renderer.pauseLayout();
            this._renderers.set(key, renderer);
        }

        if (type === 'combo' && values && values !== this._comboOptions) {
            (renderer as ComboRenderer).setOptions(values);
            this._comboOptions = values;
        }

        renderer.setValue(value);

        return renderer.getDisplayText();
    }

    /**
     * Disposes every renderer this resolver has lazily constructed.
     */
    dispose(): void {
        for (const renderer of this._renderers.values()) {
            renderer.dispose();
        }

        this._renderers.clear();
        this._comboOptions = null;
    }
}
