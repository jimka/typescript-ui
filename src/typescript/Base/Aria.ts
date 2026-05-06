// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";

/**
 * Valid WAI-ARIA landmark and widget roles used by this framework.
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
    | 'region';

/**
 * Valid values for the `aria-sort` attribute.
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
     * Flushes all stored ARIA state to the given DOM element.
     *
     * @remarks Called by {@link Component.init} when the element is first created, ensuring
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
