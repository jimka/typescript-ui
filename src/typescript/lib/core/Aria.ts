// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";

/**
 * Valid WAI-ARIA landmark and widget roles used by this framework.
 *
 * @category Core
 */
export type AriaRole =
    | 'grid'
    | 'rowgroup'
    | 'row'
    | 'gridcell'
    | 'columnheader'
    | 'tablist'
    | 'tab'
    | 'tabpanel'
    | 'tree'
    | 'treeitem'
    | 'group'
    | 'button'
    | 'region'
    | 'combobox'
    | 'listbox'
    | 'option'
    | 'menubar'
    | 'menuitem'
    | 'menu'
    | 'toolbar'
    | 'separator'
    | 'spinbutton'
    | 'progressbar'
    | 'status'
    | 'dialog'
    | 'checkbox'
    | 'radio'
    | 'slider'
    | 'switch';

/**
 * Valid values for the `aria-sort` attribute.
 *
 * @category Core
 */
export type AriaSort = 'none' | 'ascending' | 'descending';

/**
 * Valid values for the `aria-live` attribute, which controls how assistive
 * technology announces dynamic content updates.
 *
 * @category Core
 */
export type AriaLive = 'off' | 'polite' | 'assertive';

/**
 * Valid values for the `aria-orientation` attribute.
 *
 * @category Core
 */
export type AriaOrientation = 'horizontal' | 'vertical';

/**
 * Typed accessor for WAI-ARIA attributes on a {@link Component}.
 *
 * Obtained via {@link Component.getAria}. Each attribute has its own getter/setter
 * with a proper TypeScript type so that attribute names and values cannot be
 * misspelled. State is stored internally and flushed to the DOM element by
 * {@link applyToElement}, which {@link Component} calls during initialisation.
 *
 * @example
 * ```typescript
 * this.getAria().setRole("grid");
 * row.getAria().setSelected(true);
 * header.getAria().setSort("ascending");
 * ```
 *
 * @category Core
 */
export class Aria {

    private _component: Component;
    private _role: AriaRole | null = null;
    private _tabIndex: number | null = null;
    private _attributes: Map<string, string> = new Map();

    /**
     * @param component - The component this helper manages ARIA state for.
     */
    constructor(component: Component) {
        this._component = component;
    }

    /**
     * Sets the WAI-ARIA `role` attribute.
     *
     * @param role - The ARIA role to assign.
     */
    setRole(role: AriaRole): this {
        this._role = role;
        this._component.applyAriaAttribute("role", role);

        return this;
    }

    /**
     * Returns the current ARIA role, or null if none has been set.
     *
     * @returns The role, or null.
     */
    getRole(): AriaRole | null {
        return this._role;
    }

    /**
     * Sets the `tabindex` attribute, controlling keyboard focus order.
     *
     * @param value - 0 = focusable in document order, -1 = focusable by script only, null removes the attribute.
     */
    setTabIndex(value: number | null): this {
        this._tabIndex = value;
        this._component.applyAriaAttribute("tabindex", value !== null ? String(value) : null);

        return this;
    }

    /**
     * Returns the current tabindex, or null if not set.
     *
     * @returns The tabindex value, or null.
     */
    getTabIndex(): number | null {
        return this._tabIndex;
    }

    /**
     * Sets `aria-live`, controlling how assistive technology announces updates
     * to a region's contents.
     *
     * @param value - `'off'`, `'polite'`, or `'assertive'`.
     */
    setLive(value: AriaLive): this {
        this.setAttribute("live", value);

        return this;
    }

    /**
     * Returns the current `aria-live` value, or null if not set.
     *
     * @returns The live-region politeness, or null.
     */
    getLive(): AriaLive | null {
        return (this._attributes.get("live") as AriaLive) ?? null;
    }

    /**
     * Sets `aria-sort` on a column header.
     *
     * @param value - The sort direction.
     */
    setSort(value: AriaSort): this {
        this.setAttribute("sort", value);

        return this;
    }

    /**
     * Returns the current `aria-sort` value, or null if not set.
     *
     * @returns The sort direction, or null.
     */
    getSort(): AriaSort | null {
        return (this._attributes.get("sort") as AriaSort) ?? null;
    }

    /**
     * Sets `aria-selected`.
     *
     * @param value - Whether the element is selected.
     */
    setSelected(value: boolean): this {
        this.setAttribute("selected", String(value));

        return this;
    }

    /**
     * Returns the current `aria-selected` value, or null if not set.
     *
     * @returns The selected state, or null.
     */
    getSelected(): boolean | null {
        const v = this._attributes.get("selected");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-hidden`.
     *
     * @param value - Whether the element is hidden from assistive technology.
     */
    setHidden(value: boolean): this {
        this.setAttribute("hidden", String(value));

        return this;
    }

    /**
     * Returns the current `aria-hidden` value, or null if not set.
     *
     * @returns The hidden state, or null.
     */
    getHidden(): boolean | null {
        const v = this._attributes.get("hidden");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-rowindex` (1-based position of a row within a grid).
     *
     * @param value - The 1-based row index.
     */
    setRowIndex(value: number): this {
        this.setAttribute("rowindex", String(value));

        return this;
    }

    /**
     * Returns the current `aria-rowindex`, or null if not set.
     *
     * @returns The row index, or null.
     */
    getRowIndex(): number | null {
        const v = this._attributes.get("rowindex");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-rowcount` (total number of rows in a grid, used for virtual scrolling).
     *
     * @param value - The total row count.
     */
    setRowCount(value: number): this {
        this.setAttribute("rowcount", String(value));

        return this;
    }

    /**
     * Returns the current `aria-rowcount`, or null if not set.
     *
     * @returns The row count, or null.
     */
    getRowCount(): number | null {
        const v = this._attributes.get("rowcount");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-expanded`.
     *
     * @param value - `true` if the element is expanded, `false` if collapsed, `null` to remove the attribute (e.g. for leaf nodes).
     */
    setExpanded(value: boolean | null): this {
        if (value !== null) {
            this.setAttribute("expanded", String(value));
        } else {
            this._attributes.delete("expanded");
            this._component.applyAriaAttribute("aria-expanded", null);
        }

        return this;
    }

    /**
     * Returns the current `aria-expanded` value, or null if not set.
     *
     * @returns The expanded state, or null.
     */
    getExpanded(): boolean | null {
        const v = this._attributes.get("expanded");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-level` (1-based nesting depth of a tree item).
     *
     * @param value - The 1-based level number.
     */
    setLevel(value: number): this {
        this.setAttribute("level", String(value));

        return this;
    }

    /**
     * Returns the current `aria-level`, or null if not set.
     *
     * @returns The level number, or null.
     */
    getLevel(): number | null {
        const v = this._attributes.get("level");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-labelledby` to the ID of the element that labels this one.
     *
     * @param id - The ID of the labelling element.
     */
    setLabelledBy(id: string): this {
        this.setAttribute("labelledby", id);

        return this;
    }

    /**
     * Returns the current `aria-labelledby` value, or null if not set.
     *
     * @returns The labelling element ID, or null.
     */
    getLabelledBy(): string | null {
        return this._attributes.get("labelledby") ?? null;
    }

    /**
     * Sets `aria-controls` to the ID of the element this one controls.
     *
     * @param id - The ID of the controlled element.
     */
    setControls(id: string): this {
        this.setAttribute("controls", id);

        return this;
    }

    /**
     * Returns the current `aria-controls` value, or null if not set.
     *
     * @returns The controlled element ID, or null.
     */
    getControls(): string | null {
        return this._attributes.get("controls") ?? null;
    }

    /**
     * Sets `aria-autocomplete`, describing the kind of inline completion the field offers.
     *
     * @param value - `'none'`, `'list'`, `'inline'`, or `'both'`.
     */
    setAutoComplete(value: 'none' | 'list' | 'inline' | 'both'): this {
        this.setAttribute("autocomplete", value);

        return this;
    }

    /**
     * Returns the current `aria-autocomplete` value, or null if not set.
     *
     * @returns The autocomplete hint, or null.
     */
    getAutoComplete(): string | null {
        return this._attributes.get("autocomplete") ?? null;
    }

    /**
     * Sets `aria-activedescendant` to the ID of the currently active descendant element.
     *
     * Pass an empty string to clear the attribute.
     *
     * @param id - The element ID of the active descendant, or `""` to clear.
     */
    setActiveDescendant(id: string): this {
        if (id === "") {
            this._attributes.delete("activedescendant");
            this._component.applyAriaAttribute("aria-activedescendant", null);
        } else {
            this.setAttribute("activedescendant", id);
        }

        return this;
    }

    /**
     * Returns the current `aria-activedescendant` value, or null if not set.
     *
     * @returns The active descendant ID, or null.
     */
    getActiveDescendant(): string | null {
        return this._attributes.get("activedescendant") ?? null;
    }

    /**
     * Sets `aria-colindex` (1-based column position of a cell within a grid row).
     *
     * @param value - The 1-based column index.
     */
    setColIndex(value: number): this {
        this.setAttribute("colindex", String(value));

        return this;
    }

    /**
     * Returns the current `aria-colindex`, or null if not set.
     *
     * @returns The column index, or null.
     */
    getColIndex(): number | null {
        const v = this._attributes.get("colindex");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-colcount` (total number of columns in a grid).
     *
     * @param value - The total column count.
     */
    setColCount(value: number): this {
        this.setAttribute("colcount", String(value));

        return this;
    }

    /**
     * Returns the current `aria-colcount`, or null if not set.
     *
     * @returns The column count, or null.
     */
    getColCount(): number | null {
        const v = this._attributes.get("colcount");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-setsize` (total number of items in the set this element belongs to).
     *
     * @param value - The total set size.
     */
    setSetSize(value: number): this {
        this.setAttribute("setsize", String(value));

        return this;
    }

    /**
     * Returns the current `aria-setsize`, or null if not set.
     *
     * @returns The set size, or null.
     */
    getSetSize(): number | null {
        const v = this._attributes.get("setsize");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-posinset` (1-based position of this element within its set).
     *
     * @param value - The 1-based position.
     */
    setPosInSet(value: number): this {
        this.setAttribute("posinset", String(value));

        return this;
    }

    /**
     * Returns the current `aria-posinset`, or null if not set.
     *
     * @returns The position in set, or null.
     */
    getPosInSet(): number | null {
        const v = this._attributes.get("posinset");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-pressed` on a toggle button.
     *
     * @param value - Whether the button is currently pressed.
     */
    setPressed(value: boolean): this {
        this.setAttribute("pressed", String(value));

        return this;
    }

    /**
     * Returns the current `aria-pressed` value, or null if not set.
     *
     * @returns The pressed state, or null.
     */
    getPressed(): boolean | null {
        const v = this._attributes.get("pressed");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-haspopup`, indicating the element opens a popup.
     *
     * @param value - The popup type, or `false` to indicate no popup.
     */
    setHasPopup(value: 'false' | 'true' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'): this {
        this.setAttribute("haspopup", value);

        return this;
    }

    /**
     * Returns the current `aria-haspopup` value, or null if not set.
     *
     * @returns The popup type string, or null.
     */
    getHasPopup(): string | null {
        return this._attributes.get("haspopup") ?? null;
    }

    /**
     * Sets `aria-disabled`.
     *
     * @param value - Whether the element is disabled.
     */
    setDisabled(value: boolean): this {
        this.setAttribute("disabled", String(value));

        return this;
    }

    /**
     * Returns the current `aria-disabled` value, or null if not set.
     *
     * @returns The disabled state, or null.
     */
    getDisabled(): boolean | null {
        const v = this._attributes.get("disabled");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-valuenow` (the current value of a range or spinbutton widget).
     *
     * @param value - The current numeric value.
     */
    setValueNow(value: number): this {
        this.setAttribute("valuenow", String(value));

        return this;
    }

    /**
     * Returns the current `aria-valuenow`, or null if not set.
     *
     * @returns The current value, or null.
     */
    getValueNow(): number | null {
        const v = this._attributes.get("valuenow");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets or clears `aria-valuemin` (the minimum value of a range or spinbutton widget).
     *
     * @param value - The minimum numeric value, or `null` to remove the attribute.
     */
    setValueMin(value: number | null): this {
        if (value === null) {
            this._attributes.delete("valuemin");
            this._component.applyAriaAttribute("aria-valuemin", null);
        } else {
            this.setAttribute("valuemin", String(value));
        }

        return this;
    }

    /**
     * Returns the current `aria-valuemin`, or null if not set.
     *
     * @returns The minimum value, or null.
     */
    getValueMin(): number | null {
        const v = this._attributes.get("valuemin");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets or clears `aria-valuemax` (the maximum value of a range or spinbutton widget).
     *
     * @param value - The maximum numeric value, or `null` to remove the attribute.
     */
    setValueMax(value: number | null): this {
        if (value === null) {
            this._attributes.delete("valuemax");
            this._component.applyAriaAttribute("aria-valuemax", null);
        } else {
            this.setAttribute("valuemax", String(value));
        }

        return this;
    }

    /**
     * Returns the current `aria-valuemax`, or null if not set.
     *
     * @returns The maximum value, or null.
     */
    getValueMax(): number | null {
        const v = this._attributes.get("valuemax");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-checked`. Accepts `"mixed"` for the indeterminate / tri-state
     * checkbox surface and a boolean for ordinary on/off widgets such as
     * `Checkbox` / `RadioButton` / `Toggle`.
     *
     * @param value - `true`, `false`, or `"mixed"`.
     */
    setChecked(value: boolean | "mixed"): this {
        this.setAttribute("checked", typeof value === "string" ? value : String(value));

        return this;
    }

    /**
     * Returns the current `aria-checked` value, or null if not set.
     *
     * @returns The checked state (boolean), `"mixed"`, or null.
     */
    getChecked(): boolean | "mixed" | null {
        const v = this._attributes.get("checked");

        if (v === undefined) {
            return null;
        }

        if (v === "mixed") {
            return "mixed";
        }

        return v === "true";
    }

    /**
     * Sets `aria-orientation`, used by slider, separator, scrollbar, and similar widgets.
     *
     * @param value - `"horizontal"` or `"vertical"`.
     */
    setOrientation(value: "horizontal" | "vertical"): this {
        this.setAttribute("orientation", value);

        return this;
    }

    /**
     * Returns the current `aria-orientation` value, or null if not set.
     *
     * @returns The orientation string, or null.
     */
    getOrientation(): "horizontal" | "vertical" | null {
        return (this._attributes.get("orientation") as "horizontal" | "vertical" | undefined) ?? null;
    }

    /**
     * Sets `aria-readonly`.
     *
     * @param value - Whether the element is read-only.
     */
    setReadOnly(value: boolean): this {
        this.setAttribute("readonly", String(value));

        return this;
    }

    /**
     * Returns the current `aria-readonly` value, or null if not set.
     *
     * @returns The read-only state, or null.
     */
    getReadOnly(): boolean | null {
        const v = this._attributes.get("readonly");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-label`, providing an accessible label for the element.
     *
     * @param value - The label text.
     */
    setLabel(value: string): this {
        this.setAttribute("label", value);

        return this;
    }

    /**
     * Returns the current `aria-label` value, or null if not set.
     *
     * @returns The label text, or null.
     */
    getLabel(): string | null {
        return this._attributes.get("label") ?? null;
    }

    /**
     * Sets `aria-orientation`, indicating whether a composite widget (toolbar,
     * separator, scrollbar, slider, tablist) is laid out horizontally or
     * vertically.
     *
     * @param value - `'horizontal'` or `'vertical'`.
     */
    setOrientation(value: AriaOrientation): this {
        this.setAttribute("orientation", value);

        return this;
    }

    /**
     * Returns the current `aria-orientation` value, or null if not set.
     *
     * @returns The orientation, or null.
     */
    getOrientation(): AriaOrientation | null {
        return (this._attributes.get("orientation") as AriaOrientation) ?? null;
    }

    /**
     * Flushes all stored ARIA state to the given DOM element.
     *
     * @remarks Called by {@link Component} during element initialisation, ensuring
     * attributes set before render are applied to the real DOM node.
     * @param element - The component's root DOM element.
     */
    applyToElement(element: HTMLElement): void {
        if (this._role !== null) {
            element.setAttribute("role", this._role);
        }

        if (this._tabIndex !== null) {
            element.setAttribute("tabindex", String(this._tabIndex));
        }

        for (const [name, value] of this._attributes) {
            element.setAttribute("aria-" + name, value);
        }
    }

    /**
     * Stores an aria-* attribute value locally and pushes it to the DOM if the element exists.
     *
     * @param name - The attribute name without the `aria-` prefix.
     * @param value - The string value to set.
     */
    private setAttribute(name: string, value: string): void {
        this._attributes.set(name, value);
        this._component.applyAriaAttribute("aria-" + name, value);
    }
}
