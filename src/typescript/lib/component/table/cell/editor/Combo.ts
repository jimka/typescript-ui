// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { ComboBox } from "~/component/input/ComboBox.js";
import { Event } from "~/core/Event.js";
import { normalizeComboOptions } from "~/component/table/ColumnConfig.js";
import type { ComboOption } from "~/component/table/ColumnConfig.js";
import type { CustomListItem } from "~/component/list/AbstractCustomList.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for constrained-choice (combo-box) cell values.
 *
 * Wraps a [`ComboBox`](/api/component/input/classes/ComboBox) whose option
 * list is fixed to the column's declared values. The combo box keeps DOM
 * focus on its own surface and forwards keystrokes into its dropdown
 * without a focus shift, so a row click never blurs the editor — the edit
 * commits through the combo box's `"action"` event rather than a blur race.
 * Blur and keydown are proxied up to the parent cell so the standard
 * commit / cancel lifecycle (outside-click commit, Escape cancel) works.
 *
 * The editor stores the option *value* (the code round-tripped to the
 * record); an empty selection commits as `null`, mirroring the cell-stack
 * convention that "no value" is `null` and not `""`.
 *
 * @category Components
 */
class ComboEditor extends CellEditor<String | null> {

    private _combo: ComboBox;
    private _value: String | null = null;

    /**
     * @param options - The column's option set; each entry is a plain
     *   string (value === label) or a `{ value, label }` pair. Built into
     *   explicit `{ key, label }` dropdown items so the combo box's value
     *   is the option value, not its array index.
     */
    constructor(options: Array<ComboOption | string>) {
        super("div");

        const items: Array<CustomListItem> = normalizeComboOptions(options).map(
            option => ({ key: option.value, label: option.label }),
        );

        this._combo = new ComboBox({ dropdownAnimated: false });
        this._combo.setItems(items);

        // Strip the combo box's own chrome and apply the shared inset
        // editor border so the surface reads as a cell editor, matching
        // the text-input editors.
        this._combo.setBorder({ border: "0px solid transparent" });
        this._combo.setBorderRadius('0');
        this._combo.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');

        // A selection (mouse or keyboard) commits the edit. The combo box
        // keeps focus on its own surface, so there is no blur to race with.
        this._combo.on("action", () => this.onAction());

        // Proxy blur / keydown to the parent cell, mirroring the text
        // editors: blur drives the outside-click commit, keydown carries
        // Enter / Escape into `Cell.onKeyDown`.
        Event.addListener(this._combo, "blur", (evnt: UIEvent) => {
            Event.fireEvent(this, "blur", evnt);
        });
        Event.addListener(this._combo, "keydown", (evnt: KeyboardEvent) => {
            Event.fireEvent(this, "keydown", { detail: {
                key     : evnt.key     , code   : evnt.code   , keyCode: evnt.keyCode,
                shiftKey: evnt.shiftKey, ctrlKey: evnt.ctrlKey,
                altKey  : evnt.altKey  , metaKey: evnt.metaKey
            } });
        });

        this.addComponent(this._combo);
    }

    /**
     * Returns the cached option value, or `null` when nothing is selected.
     *
     * @returns The current option value, or `null`.
     */
    getValue(): String | null {
        return this._value;
    }

    /**
     * Selects the option whose value matches and caches it. `null` and
     * `undefined` clear the selection. A value outside the option set is
     * cached verbatim so the cell round-trips it unchanged.
     *
     * @param value - The option value to select, or `null`/`undefined` to
     *   clear the selection.
     */
    setValue(value: String | null): this {
        this._value = value ?? null;
        this._combo.setValue(this._value === null ? "" : String(this._value));

        return this;
    }

    /**
     * Focuses the combo box surface and pops its dropdown so a double-click
     * on the cell lands the user straight in the option list.
     *
     * @returns This component, for method chaining.
     */
    focus(): this {
        this._combo.focus();
        this._combo.openDropdown();

        return this;
    }

    /**
     * Caches the freshly-selected value and asks the active cell to commit.
     * An empty selection commits as `null`.
     */
    private onAction(): void {
        const selected = this._combo.getValue();

        this._value = selected ? selected : null;
        this.requestCommit();
    }
}

const ComboEditorCallable = callable(ComboEditor);
type ComboEditorCallable = ComboEditor;
export {
    ComboEditor         as _ComboEditor,
    ComboEditorCallable as ComboEditor
};
