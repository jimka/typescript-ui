// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Checkbox } from "~/component/input/Checkbox.js";
import { AbstractBooleanInput } from "~/component/input/AbstractBooleanInput.js";
import {
    AbstractBooleanMenuRow,
    AbstractBooleanMenuRowOptions
} from "~/component/container/AbstractBooleanMenuRow.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link CheckboxMenuRow}.
 *
 * @category Components
 */
export interface CheckboxMenuRowOptions extends AbstractBooleanMenuRowOptions {}

/**
 * A [`Menu`](/api/overlay/classes/Menu) row hosting a real
 * [`Checkbox`](/api/component/input/classes/Checkbox), for a multi-select menu.
 *
 * Built via `{ row: () => new CheckboxMenuRow({ text, checked }) }` on a
 * `MenuItemConfig`. Toggles on a click anywhere in the row or on Enter (via
 * {@link activate}) and leaves the menu open — unlike a plain `MenuItem`,
 * activating it never closes the panel. `isNavigable()` reports `true`, so
 * the menu's roving arrow-key highlight lands on it like any other row.
 *
 * @category Components
 */
class CheckboxMenuRow extends AbstractBooleanMenuRow<CheckboxMenuRowOptions> {

    private _checkbox: Checkbox;

    /**
     * Constructs a CheckboxMenuRow.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: CheckboxMenuRowOptions, subclassDefaults?: Partial<CheckboxMenuRowOptions>) {
        super(options, subclassDefaults);

        // `text` / `checked` are read from the raw constructor argument, not
        // `this._options`: neither field has a matching setter for
        // `applyOptions` to dispatch through (there is no live `setText`, and
        // `setChecked` writes straight to `_checkbox`, which cannot exist yet
        // during the `super()` cascade), so `this._options` is never
        // populated for them — `_checkbox` itself is the state cache for
        // `checked` from this point on.
        this._checkbox = new Checkbox({
            label:    options?.text ?? "",
            selected: options?.checked ?? false,
            enabled:  options?.enabled ?? true,
        });

        this.installControl();
    }

    protected getControl(): AbstractBooleanInput {
        return this._checkbox;
    }

    protected applyActivation(): void {
        this.setChecked(!this.isChecked());
    }
}

const CheckboxMenuRowCallable = callable(CheckboxMenuRow);
type CheckboxMenuRowCallable = CheckboxMenuRow;
export {
    CheckboxMenuRow         as _CheckboxMenuRow,
    CheckboxMenuRowCallable as CheckboxMenuRow
};
