// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { RadioButton } from "~/component/input/RadioButton.js";
import { AbstractBooleanInput } from "~/component/input/AbstractBooleanInput.js";
import {
    AbstractBooleanMenuRow,
    AbstractBooleanMenuRowOptions
} from "~/component/container/AbstractBooleanMenuRow.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link RadioMenuRow}.
 *
 * @category Components
 */
export interface RadioMenuRowOptions extends AbstractBooleanMenuRowOptions {}

/**
 * A [`Menu`](/api/overlay/classes/Menu) row hosting a real
 * [`RadioButton`](/api/component/input/classes/RadioButton), for a single-choice menu.
 *
 * Built via `{ row: () => new RadioMenuRow({ text, checked }) }` on a
 * `MenuItemConfig`. Selects on a click anywhere in the row or on Enter (via
 * {@link activate}) and leaves the menu open — unlike a plain `MenuItem`,
 * activating it never closes the panel. `isNavigable()` reports `true`, so
 * the menu's roving arrow-key highlight lands on it like any other row.
 *
 * @category Components
 */
class RadioMenuRow extends AbstractBooleanMenuRow<RadioMenuRowOptions> {

    private _radio: RadioButton;

    /**
     * Constructs a RadioMenuRow.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: RadioMenuRowOptions, subclassDefaults?: Partial<RadioMenuRowOptions>) {
        super(options, subclassDefaults);

        // `text` / `checked` are read from the raw constructor argument, not
        // `this._options`: neither field has a matching setter for
        // `applyOptions` to dispatch through (there is no live `setText`, and
        // `setChecked` writes straight to `_radio`, which cannot exist yet
        // during the `super()` cascade), so `this._options` is never
        // populated for them — `_radio` itself is the state cache for
        // `checked` from this point on.
        this._radio = new RadioButton(options?.text ?? "", {
            selected: options?.checked ?? false,
            enabled:  options?.enabled ?? true,
        });

        this.installControl();
    }

    protected getControl(): AbstractBooleanInput {
        return this._radio;
    }

    /**
     * Selecting is one-way — a click on an already-selected row leaves it
     * selected, matching `RadioButton`'s own activation rule — so a group of
     * rows is deselected by whoever owns the group, not by the row itself.
     */
    protected applyActivation(): void {
        this.setChecked(true);
    }
}

const RadioMenuRowCallable = callable(RadioMenuRow);
type RadioMenuRowCallable = RadioMenuRow;
export {
    RadioMenuRow         as _RadioMenuRow,
    RadioMenuRowCallable as RadioMenuRow
};
