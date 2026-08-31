// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { ComboBox } from "~/component/input/ComboBox.js";
import { Event } from "~/core/Event.js";
import { normalizeComboOptions } from "~/component/table/ColumnConfig.js";
import type { ComboOption } from "~/component/table/ColumnConfig.js";
import type { SelectableListItem } from "~/component/list/AbstractSelectableList.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for constrained-choice (combo-box) cell values.
 *
 * Wraps a [`ComboBox`](/api/component/input/classes/ComboBox) whose option
 * list is fixed to the column's declared values. The combo box keeps DOM
 * focus on its own surface and forwards keystrokes into its dropdown
 * without a focus shift, so a row click never blurs the editor. Both a
 * selection (`"action"`) and a genuine blur — focus leaving the editor
 * entirely, e.g. an outside click — commit the edit through the cell's
 * commit-request hook; keydown is proxied to the parent cell so Escape
 * cancels and Enter ends the edit.
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
     * @param optionList - The column's option set; each entry is a plain
     *   string (value === label) or a `{ value, label }` pair. Built into
     *   explicit `{ key, label }` dropdown items so the combo box's value
     *   is the option value, not its array index.
     */
    constructor(optionList: Array<ComboOption | string>) {
        super("div");

        const items: Array<SelectableListItem> = normalizeComboOptions(optionList).map(
            option => ({ key: option.value, label: option.label }),
        );

        this._combo = new ComboBox();
        this._combo.setItems(items);

        // Strip the combo box's own chrome and apply the shared inset
        // editor border so the surface reads as a cell editor, matching
        // the text-input editors.
        this._combo.setBorder({ border: "0px solid transparent" });
        this._combo.setBorderRadius('0');
        this._combo.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');

        // A selection (mouse or keyboard) commits the edit, and so does a
        // genuine blur: the combo box keeps DOM focus on its own surface
        // throughout the dropdown's lifetime (row clicks `preventDefault`
        // pointerdown), so a blur means focus left the editor entirely —
        // commit the current value. Both route through the cell's
        // commit-request hook directly rather than re-dispatching a blur
        // for the pool to re-interpret.
        this._combo.on("action", () => this.commitFromCombo());
        // Internal cell-editor wiring: listens on a privately-owned child;
        // see the cell-editor carve-out in ARCHITECTURE.md.
        Event.addListener(this._combo, "blur", () => this.commitFromCombo());

        // Proxy keydown to the parent cell so Escape cancels and Enter
        // ends the edit, mirroring the text editors' `Cell.onKeyDown` path.
        // Internal cell-editor wiring: listens on a privately-owned child;
        // see the cell-editor carve-out in ARCHITECTURE.md.
        Event.addListener(this._combo, "keydown", (evnt: KeyboardEvent) => {
            Event.fireEvent(this, "keydown", { detail: {
                key     : evnt.key     , code   : evnt.code   , keyCode: evnt.keyCode,
                shiftKey: evnt.shiftKey, ctrlKey: evnt.ctrlKey,
                altKey  : evnt.altKey  , metaKey: evnt.metaKey
            } });

            // Tab and PageUp/PageDown must not run their native default:
            // the parent cell's own navigate handler already moves editing
            // to the neighboring cell or page (driven by the re-fired
            // "keydown" above), so this listener — the real keydown target
            // — is the one place that can actually suppress the browser's
            // default behaviour for these keys.
            if (evnt.keyCode === 9 || evnt.keyCode === 33 || evnt.keyCode === 34) {
                return { prevent: true };
            }

            return;
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
     * @param preventScroll - Forwarded to the combo box's focus so a native
     *   focus-scroll doesn't desync the table body's own scroll model.
     * @returns This component, for method chaining.
     */
    focus(preventScroll: boolean = false): this {
        this._combo.focus(preventScroll);
        this._combo.openDropdown();

        return this;
    }

    /**
     * Rebuilds the dropdown's item list from a new option set, preserving
     * the currently selected value, so a shared editor can be reused across
     * rows whose combo options differ.
     *
     * @param optionList - The new option set; same shape as the constructor
     *   argument.
     * @returns This editor, for method chaining.
     */
    setOptions(optionList: Array<ComboOption | string>): this {
        const items: Array<SelectableListItem> = normalizeComboOptions(optionList).map(
            option => ({ key: option.value, label: option.label }),
        );

        this._combo.setItems(items);
        this._combo.setValue(this._value === null ? "" : String(this._value));

        return this;
    }

    /**
     * Caches the combo box's current value and asks the active cell to
     * commit. Shared by the selection (`"action"`) and blur paths; an empty
     * selection commits as `null`. Re-entrant-safe: once the cell has
     * committed it releases the editor, so a follow-on blur is a no-op.
     */
    private commitFromCombo(): void {
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
