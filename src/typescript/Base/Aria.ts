// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";

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
    | 'separator'
    | 'spinbutton'
    | 'progressbar'
    | 'status';

/**
 * Valid values for the `aria-sort` attribute.
 *
 * @category Core
 */
export type AriaSort = 'none' | 'ascending' | 'descending';

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

    private component: Component;
    private role: AriaRole | null = null;
    private tabIndex: number | null = null;
    private attributes: Map<string, string> = new Map();

    /**
     * @param component - The component this helper manages ARIA state for.
     */
    constructor(component: Component) {
        this.component = component;
    }

    /**
     * Sets the WAI-ARIA `role` attribute.
     *
     * @param role - The ARIA role to assign.
     */
    setRole(role: AriaRole): void {
        this.role = role;
        this.component.setElementAttribute("role", role);
    }

    /**
     * Returns the current ARIA role, or null if none has been set.
     *
     * @returns The role, or null.
     */
    getRole(): AriaRole | null {
        return this.role;
    }

    /**
     * Sets the `tabindex` attribute, controlling keyboard focus order.
     *
     * @param value - 0 = focusable in document order, -1 = focusable by script only, null removes the attribute.
     */
    setTabIndex(value: number | null): void {
        this.tabIndex = value;

        if (value !== null) {
            this.component.setElementAttribute("tabindex", String(value));
        } else {
            this.component.removeElementAttribute("tabindex");
        }
    }

    /**
     * Returns the current tabindex, or null if not set.
     *
     * @returns The tabindex value, or null.
     */
    getTabIndex(): number | null {
        return this.tabIndex;
    }

    /**
     * Sets `aria-sort` on a column header.
     *
     * @param value - The sort direction.
     */
    setSort(value: AriaSort): void {
        this.setAttribute("sort", value);
    }

    /**
     * Returns the current `aria-sort` value, or null if not set.
     *
     * @returns The sort direction, or null.
     */
    getSort(): AriaSort | null {
        return (this.attributes.get("sort") as AriaSort) ?? null;
    }

    /**
     * Sets `aria-selected`.
     *
     * @param value - Whether the element is selected.
     */
    setSelected(value: boolean): void {
        this.setAttribute("selected", String(value));
    }

    /**
     * Returns the current `aria-selected` value, or null if not set.
     *
     * @returns The selected state, or null.
     */
    getSelected(): boolean | null {
        const v = this.attributes.get("selected");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-hidden`.
     *
     * @param value - Whether the element is hidden from assistive technology.
     */
    setHidden(value: boolean): void {
        this.setAttribute("hidden", String(value));
    }

    /**
     * Returns the current `aria-hidden` value, or null if not set.
     *
     * @returns The hidden state, or null.
     */
    getHidden(): boolean | null {
        const v = this.attributes.get("hidden");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-rowindex` (1-based position of a row within a grid).
     *
     * @param value - The 1-based row index.
     */
    setRowIndex(value: number): void {
        this.setAttribute("rowindex", String(value));
    }

    /**
     * Returns the current `aria-rowindex`, or null if not set.
     *
     * @returns The row index, or null.
     */
    getRowIndex(): number | null {
        const v = this.attributes.get("rowindex");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-rowcount` (total number of rows in a grid, used for virtual scrolling).
     *
     * @param value - The total row count.
     */
    setRowCount(value: number): void {
        this.setAttribute("rowcount", String(value));
    }

    /**
     * Returns the current `aria-rowcount`, or null if not set.
     *
     * @returns The row count, or null.
     */
    getRowCount(): number | null {
        const v = this.attributes.get("rowcount");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-expanded`.
     *
     * @param value - `true` if the element is expanded, `false` if collapsed, `null` to remove the attribute (e.g. for leaf nodes).
     */
    setExpanded(value: boolean | null): void {
        if (value !== null) {
            this.setAttribute("expanded", String(value));
        } else {
            this.attributes.delete("expanded");
            this.component.removeElementAttribute("aria-expanded");
        }
    }

    /**
     * Returns the current `aria-expanded` value, or null if not set.
     *
     * @returns The expanded state, or null.
     */
    getExpanded(): boolean | null {
        const v = this.attributes.get("expanded");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-level` (1-based nesting depth of a tree item).
     *
     * @param value - The 1-based level number.
     */
    setLevel(value: number): void {
        this.setAttribute("level", String(value));
    }

    /**
     * Returns the current `aria-level`, or null if not set.
     *
     * @returns The level number, or null.
     */
    getLevel(): number | null {
        const v = this.attributes.get("level");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-labelledby` to the ID of the element that labels this one.
     *
     * @param id - The ID of the labelling element.
     */
    setLabelledBy(id: string): void {
        this.setAttribute("labelledby", id);
    }

    /**
     * Returns the current `aria-labelledby` value, or null if not set.
     *
     * @returns The labelling element ID, or null.
     */
    getLabelledBy(): string | null {
        return this.attributes.get("labelledby") ?? null;
    }

    /**
     * Sets `aria-controls` to the ID of the element this one controls.
     *
     * @param id - The ID of the controlled element.
     */
    setControls(id: string): void {
        this.setAttribute("controls", id);
    }

    /**
     * Returns the current `aria-controls` value, or null if not set.
     *
     * @returns The controlled element ID, or null.
     */
    getControls(): string | null {
        return this.attributes.get("controls") ?? null;
    }

    /**
     * Sets `aria-autocomplete`, describing the kind of inline completion the field offers.
     *
     * @param value - `'none'`, `'list'`, `'inline'`, or `'both'`.
     */
    setAutoComplete(value: 'none' | 'list' | 'inline' | 'both'): void {
        this.setAttribute("autocomplete", value);
    }

    /**
     * Returns the current `aria-autocomplete` value, or null if not set.
     *
     * @returns The autocomplete hint, or null.
     */
    getAutoComplete(): string | null {
        return this.attributes.get("autocomplete") ?? null;
    }

    /**
     * Sets `aria-activedescendant` to the ID of the currently active descendant element.
     *
     * Pass an empty string to clear the attribute.
     *
     * @param id - The element ID of the active descendant, or `""` to clear.
     */
    setActiveDescendant(id: string): void {
        if (id === "") {
            this.attributes.delete("activedescendant");
            this.component.removeElementAttribute("aria-activedescendant");
        } else {
            this.setAttribute("activedescendant", id);
        }
    }

    /**
     * Returns the current `aria-activedescendant` value, or null if not set.
     *
     * @returns The active descendant ID, or null.
     */
    getActiveDescendant(): string | null {
        return this.attributes.get("activedescendant") ?? null;
    }

    /**
     * Sets `aria-colindex` (1-based column position of a cell within a grid row).
     *
     * @param value - The 1-based column index.
     */
    setColIndex(value: number): void {
        this.setAttribute("colindex", String(value));
    }

    /**
     * Returns the current `aria-colindex`, or null if not set.
     *
     * @returns The column index, or null.
     */
    getColIndex(): number | null {
        const v = this.attributes.get("colindex");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-colcount` (total number of columns in a grid).
     *
     * @param value - The total column count.
     */
    setColCount(value: number): void {
        this.setAttribute("colcount", String(value));
    }

    /**
     * Returns the current `aria-colcount`, or null if not set.
     *
     * @returns The column count, or null.
     */
    getColCount(): number | null {
        const v = this.attributes.get("colcount");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-setsize` (total number of items in the set this element belongs to).
     *
     * @param value - The total set size.
     */
    setSetSize(value: number): void {
        this.setAttribute("setsize", String(value));
    }

    /**
     * Returns the current `aria-setsize`, or null if not set.
     *
     * @returns The set size, or null.
     */
    getSetSize(): number | null {
        const v = this.attributes.get("setsize");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-posinset` (1-based position of this element within its set).
     *
     * @param value - The 1-based position.
     */
    setPosInSet(value: number): void {
        this.setAttribute("posinset", String(value));
    }

    /**
     * Returns the current `aria-posinset`, or null if not set.
     *
     * @returns The position in set, or null.
     */
    getPosInSet(): number | null {
        const v = this.attributes.get("posinset");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-pressed` on a toggle button.
     *
     * @param value - Whether the button is currently pressed.
     */
    setPressed(value: boolean): void {
        this.setAttribute("pressed", String(value));
    }

    /**
     * Returns the current `aria-pressed` value, or null if not set.
     *
     * @returns The pressed state, or null.
     */
    getPressed(): boolean | null {
        const v = this.attributes.get("pressed");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-haspopup`, indicating the element opens a popup.
     *
     * @param value - The popup type, or `false` to indicate no popup.
     */
    setHasPopup(value: 'false' | 'true' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'): void {
        this.setAttribute("haspopup", value);
    }

    /**
     * Returns the current `aria-haspopup` value, or null if not set.
     *
     * @returns The popup type string, or null.
     */
    getHasPopup(): string | null {
        return this.attributes.get("haspopup") ?? null;
    }

    /**
     * Sets `aria-disabled`.
     *
     * @param value - Whether the element is disabled.
     */
    setDisabled(value: boolean): void {
        this.setAttribute("disabled", String(value));
    }

    /**
     * Returns the current `aria-disabled` value, or null if not set.
     *
     * @returns The disabled state, or null.
     */
    getDisabled(): boolean | null {
        const v = this.attributes.get("disabled");

        return v !== undefined ? v === "true" : null;
    }

    /**
     * Sets `aria-valuenow` (the current value of a range or spinbutton widget).
     *
     * @param value - The current numeric value.
     */
    setValueNow(value: number): void {
        this.setAttribute("valuenow", String(value));
    }

    /**
     * Returns the current `aria-valuenow`, or null if not set.
     *
     * @returns The current value, or null.
     */
    getValueNow(): number | null {
        const v = this.attributes.get("valuenow");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets or clears `aria-valuemin` (the minimum value of a range or spinbutton widget).
     *
     * @param value - The minimum numeric value, or `null` to remove the attribute.
     */
    setValueMin(value: number | null): void {
        if (value === null) {
            this.attributes.delete("valuemin");
            this.component.removeElementAttribute("aria-valuemin");
        } else {
            this.setAttribute("valuemin", String(value));
        }
    }

    /**
     * Returns the current `aria-valuemin`, or null if not set.
     *
     * @returns The minimum value, or null.
     */
    getValueMin(): number | null {
        const v = this.attributes.get("valuemin");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets or clears `aria-valuemax` (the maximum value of a range or spinbutton widget).
     *
     * @param value - The maximum numeric value, or `null` to remove the attribute.
     */
    setValueMax(value: number | null): void {
        if (value === null) {
            this.attributes.delete("valuemax");
            this.component.removeElementAttribute("aria-valuemax");
        } else {
            this.setAttribute("valuemax", String(value));
        }
    }

    /**
     * Returns the current `aria-valuemax`, or null if not set.
     *
     * @returns The maximum value, or null.
     */
    getValueMax(): number | null {
        const v = this.attributes.get("valuemax");

        return v !== undefined ? Number(v) : null;
    }

    /**
     * Sets `aria-label`, providing an accessible label for the element.
     *
     * @param value - The label text.
     */
    setLabel(value: string): void {
        this.setAttribute("label", value);
    }

    /**
     * Returns the current `aria-label` value, or null if not set.
     *
     * @returns The label text, or null.
     */
    getLabel(): string | null {
        return this.attributes.get("label") ?? null;
    }

    /**
     * Flushes all stored ARIA state to the given DOM element.
     *
     * @remarks Called by {@link Component} during element initialisation, ensuring
     * attributes set before render are applied to the real DOM node.
     * @param element - The component's root DOM element.
     */
    applyToElement(element: HTMLElement): void {
        if (this.role !== null) {
            element.setAttribute("role", this.role);
        }

        if (this.tabIndex !== null) {
            element.setAttribute("tabindex", String(this.tabIndex));
        }

        for (const [name, value] of this.attributes) {
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
        this.attributes.set(name, value);
        this.component.setElementAttribute("aria-" + name, value);
    }
}
