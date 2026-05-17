// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for time cell values.
 *
 * Renders as `<input type="time">`. The value is represented as a `Date`
 * whose time portion is meaningful; the date portion is normalized to 1970-01-01 local.
 */
class TimeEditor extends CellEditor<Date | null> {

    private _showSeconds: boolean;

    constructor(showSeconds: boolean = false) {
        super("input");
        this._showSeconds = showSeconds;

        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this.setBorderRadius('0');
        this.setBorder({ style: BorderStyle.SOLID, width: 0, color: 'transparent' });
        this.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this.setOutline('none');
    }

    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);
        element.setAttribute('type', 'time');
        if (this._showSeconds) element.setAttribute('step', '1');

        return this;
    }

    isEmpty(): boolean {
        const el = this.getElement() as HTMLInputElement | null;
        return !el?.value && !el?.validity.badInput;
    }

    getValue(): Date | null {
        const raw = (this.getElement() as HTMLInputElement | null)?.value ?? "";
        if (!raw) return null;
        const parts = raw.split(':').map(Number);
        return new Date(1970, 0, 1, parts[0], parts[1], parts[2] ?? 0);
    }

    setValue(value: Date | null): this {
        const el = this.getElement() as HTMLInputElement | null;
        if (el) el.value = value ? this.toInputString(value) : "";

        return this;
    }

    private toInputString(date: Date): string {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        if (this._showSeconds) {
            const s = String(date.getSeconds()).padStart(2, '0');
            return `${h}:${m}:${s}`;
        }
        return `${h}:${m}`;
    }
}

const TimeEditorCallable = callable(TimeEditor);
type TimeEditorCallable = TimeEditor;
export {
    TimeEditor         as _TimeEditor,
    TimeEditorCallable as TimeEditor
};
