// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { BorderStyle } from "~/BorderStyle.js";
import { callable } from "~/Callable.js";

/**
 * An in-place editor for date cell values.
 *
 * Renders directly as `<input type="date">` by passing the tag through to
 * {@link CellEditor}. This avoids the TextField inheritance chain, which forces
 * type="text" after render. Blur and keydown events reach the parent {@link Cell}
 * directly — no proxying needed.
 */
class DateEditor extends CellEditor<Date | null> {

    constructor() {
        super("input");

        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this.setBorderRadius('0');
        this.setBorder({ style: BorderStyle.SOLID, width: 0, color: 'transparent' });
        this.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this.setOutline('none');
    }

    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);
        element.setAttribute('type', 'date');

        return this;
    }

    isEmpty(): boolean {
        const el = this.getElement() as HTMLInputElement | null;
        // badInput is true when the user has partially filled the date (value is ""
        // but the field is not blank). Only treat the field as empty when there is
        // genuinely no input, so partial dates revert instead of committing null.
        return !el?.value && !el?.validity.badInput;
    }

    getValue(): Date | null {
        const raw = (this.getElement() as HTMLInputElement | null)?.value ?? "";
        if (!raw) return null;
        // Parse as local midnight to avoid UTC-offset day shifts.
        const d = new Date(raw + 'T00:00:00');
        return isNaN(d.getTime()) ? null : d;
    }

    setValue(value: Date | null): this {
        const el = this.getElement() as HTMLInputElement | null;
        if (el) el.value = value ? this.toInputString(value) : "";

        return this;
    }

    private toInputString(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
}

const DateEditorCallable = callable(DateEditor);
type DateEditorCallable = DateEditor;
export {
    DateEditor         as _DateEditor,
    DateEditorCallable as DateEditor
};
