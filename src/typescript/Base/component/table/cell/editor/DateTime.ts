// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "./CellEditor.js";
import { BorderStyle } from "../../../../BorderStyle.js";

/**
 * An in-place editor for date-time cell values.
 *
 * Renders as `<input type="datetime-local">`. Blur and keydown events reach the
 * parent {@link Cell} directly — no proxying needed.
 */
export class DateTimeEditor extends CellEditor<Date | null> {

    private showSeconds: boolean;

    constructor(showSeconds: boolean = false) {
        super("input");
        this.showSeconds = showSeconds;

        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this.setBorderRadius('0');
        this.setBorder({ style: BorderStyle.SOLID, width: 0, color: 'transparent' });
        this.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this.setOutline('none');
    }

    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);
        element.setAttribute('type', 'datetime-local');
        if (this.showSeconds) element.setAttribute('step', '1');

        return this;
    }

    isEmpty(): boolean {
        const el = this.getElement() as HTMLInputElement | null;
        return !el?.value && !el?.validity.badInput;
    }

    getValue(): Date | null {
        const raw = (this.getElement() as HTMLInputElement | null)?.value ?? "";
        if (!raw) return null;
        // datetime-local strings without a timezone offset are parsed as local time.
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }

    setValue(value: Date | null): this {
        const el = this.getElement() as HTMLInputElement | null;
        if (el) el.value = value ? this.toInputString(value) : "";

        return this;
    }

    private toInputString(date: Date): string {
        const y  = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, '0');
        const d  = String(date.getDate()).padStart(2, '0');
        const h  = String(date.getHours()).padStart(2, '0');
        const mi = String(date.getMinutes()).padStart(2, '0');
        if (this.showSeconds) {
            const s = String(date.getSeconds()).padStart(2, '0');
            return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
        }
        return `${y}-${mo}-${d}T${h}:${mi}`;
    }
}
