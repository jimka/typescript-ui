// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "./LayoutManager.js";
import { AccordionConstraints } from "./AccordionConstraints.js";
import { AccordionHeader } from "../component/AccordionHeader.js";
import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { Position } from "../Position.js";
import { Size } from "../Size.js";

/**
 * Callback invoked when a section is opened or closed.
 *
 * @param index - Zero-based index of the toggled section.
 * @param open - True if the section is now open.
 *
 * @category Layouts
 */
export type SectionToggleCallback = (index: number, open: boolean) => void;

/**
 * Construction-time options for {@link Accordion}.
 *
 * @category Layouts
 */
export interface AccordionOptions extends LayoutManagerOptions {
    singleOpen?:        boolean;
    headerHeight?:      number;
    animationDuration?: number;
    onSectionToggle?:   SectionToggleCallback;
}

/**
 * A layout manager that stacks vertically collapsible sections, each with a
 * clickable header and an animated content panel.
 *
 * Sections are defined by child components added to the container via
 * `container.addComponent(content, new AccordionConstraints(...))`. The layout
 * manager owns internally-created {@link AccordionHeader} components and panel
 * wrapper elements; these are not visible through `container.getComponents()`.
 *
 * Animation uses a CSS `height` transition with `overflow: hidden` on the panel
 * wrapper so closing/opening animates smoothly without affecting the layout model.
 *
 * @example
 * ```typescript
 * const accordion = new Accordion();
 * accordion.setSingleOpen(true);
 *
 * const panel = new Component();
 * panel.setLayoutManager(new Accordion());
 *
 * const content1 = new Component();
 * panel.addComponent(content1, new AccordionConstraints('Section 1', true));
 *
 * const content2 = new Component();
 * panel.addComponent(content2, new AccordionConstraints('Section 2'));
 *
 * panel.setLayoutManager(accordion);
 * ```
 *
 * @category Layouts
 */
export class Accordion extends LayoutManager {

    private headers: AccordionHeader[] = [];
    private panelWrappers: Component[] = [];
    private openState: boolean[] = [];
    private _singleOpen: boolean = false;
    private _headerHeight: number = 28;
    private _animationDuration: number = 200;
    private onSectionToggleCallback: SectionToggleCallback | null = null;

    constructor(options?: AccordionOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link AccordionOptions} bag, dispatching single-open mode,
     * header height, animation duration, and the toggle callback after the
     * inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AccordionOptions): void {
        super.applyOptions(options);

        if (options.headerHeight !== undefined) {
            this.setHeaderHeight(options.headerHeight);
        }

        if (options.animationDuration !== undefined) {
            this.setAnimationDuration(options.animationDuration);
        }

        if (options.onSectionToggle !== undefined) {
            this.setOnSectionToggle(options.onSectionToggle);
        }

        if (options.singleOpen !== undefined) {
            this.setSingleOpen(options.singleOpen);
        }
    }

    /**
     * Returns whether at most one section can be open at a time.
     *
     * @returns True if single-open mode is active.
     */
    isSingleOpen(): boolean {
        return this._singleOpen;
    }

    /**
     * Sets whether at most one section can be open at a time.
     * When switching to `true`, immediately closes all but the first open section.
     *
     * @param value - True to enforce single-open mode.
     */
    setSingleOpen(value: boolean): void {
        this._singleOpen = value;

        if (!value) {
            return;
        }

        let foundOpen = false;

        for (let i = 0; i < this.openState.length; i++) {
            if (!this.openState[i]) {
                continue;
            }

            if (foundOpen) {
                this.openState[i] = false;
                this.headers[i].setExpanded(false);
                this.headers[i].getAria().setExpanded(false);
                this.onSectionToggleCallback?.(i, false);
            } else {
                foundOpen = true;
            }
        }

        this.getContainer()?.scheduleLayout();
    }

    /**
     * Returns the height in pixels of each section header.
     *
     * @returns The header height.
     */
    getHeaderHeight(): number {
        return this._headerHeight;
    }

    /**
     * Sets the height of each section header in pixels.
     *
     * @param height - Height in pixels.
     */
    setHeaderHeight(height: number): void {
        this._headerHeight = height;
    }

    /**
     * Returns the CSS transition duration for open/close animation in milliseconds.
     *
     * @returns Duration in milliseconds.
     */
    getAnimationDuration(): number {
        return this._animationDuration;
    }

    /**
     * Sets the CSS transition duration for open/close animation.
     *
     * @param ms - Duration in milliseconds.
     */
    setAnimationDuration(ms: number): void {
        this._animationDuration = ms;
    }

    /**
     * Opens the section at the given index.
     *
     * @param index - Zero-based section index.
     */
    openSection(index: number): void {
        if (index < 0 || index >= this.openState.length) {
            return;
        }

        if (this._singleOpen) {
            for (let i = 0; i < this.openState.length; i++) {
                if (i !== index && this.openState[i]) {
                    this.openState[i] = false;
                    this.headers[i].setExpanded(false);
                    this.headers[i].getAria().setExpanded(false);
                    this.onSectionToggleCallback?.(i, false);
                }
            }
        }

        this.openState[index] = true;
        this.headers[index].setExpanded(true);
        this.headers[index].getAria().setExpanded(true);
        this.onSectionToggleCallback?.(index, true);
        this.getContainer()?.scheduleLayout();
    }

    /**
     * Closes the section at the given index.
     *
     * @param index - Zero-based section index.
     */
    closeSection(index: number): void {
        if (index < 0 || index >= this.openState.length) {
            return;
        }

        this.openState[index] = false;
        this.headers[index].setExpanded(false);
        this.headers[index].getAria().setExpanded(false);
        this.onSectionToggleCallback?.(index, false);
        this.getContainer()?.scheduleLayout();
    }

    /**
     * Returns whether the section at the given index is currently open.
     *
     * @param index - Zero-based section index.
     * @returns True if the section is open.
     */
    isSectionOpen(index: number): boolean {
        return this.openState[index] ?? false;
    }

    /**
     * Registers a callback invoked whenever a section is opened or closed.
     *
     * @param callback - The callback, or null to remove it.
     */
    setOnSectionToggle(callback: SectionToggleCallback | null): void {
        this.onSectionToggleCallback = callback;
    }

    /**
     * Attaches to a container. Section headers and panel wrappers are created
     * lazily in {@link doLayout} on first use.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component): void {
        super.attach(container);
    }

    /**
     * Detaches from the container, removing all header and panel wrapper elements
     * from the DOM and moving content elements back to the container.
     */
    detach(): void {
        const container = this.getContainer();

        for (let i = 0; i < this.headers.length; i++) {
            const components = container ? container.getComponents() : [];
            const component = components[i];

            if (component && container) {
                container.getElement().appendChild(component.getElement());
            }

            this.headers[i].getElement().remove();
            this.panelWrappers[i].getElement().remove();
        }

        this.headers = [];
        this.panelWrappers = [];
        this.openState = [];

        super.detach();
    }

    /**
     * Returns the preferred size: sum of all header heights plus the preferred
     * heights of all open sections.
     *
     * @returns The preferred size, or null if not attached.
     */
    getPreferredSize(): Size | null {
        const container = this.getContainer();

        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimiterSize();
        const components = container.getComponents();
        let totalHeight = perimeterSize.top + perimeterSize.bottom;
        let maxWidth = 0;

        for (let i = 0; i < components.length; i++) {
            totalHeight += this._headerHeight;

            // openState is populated lazily in doLayout; fall back to the
            // constraint's initiallyOpen flag so getPreferredSize() is correct
            // even before the first doLayout pass.
            const isOpen = i < this.openState.length
                ? this.openState[i]
                : ((this.getLayoutConstraints(components[i]) as AccordionConstraints | undefined)?.initiallyOpen ?? false);

            if (isOpen) {
                const preferred = components[i].getPreferredSize();

                if (preferred) {
                    totalHeight += preferred.height;

                    if (preferred.width > maxWidth) {
                        maxWidth = preferred.width;
                    }
                }
            }
        }

        return {
            width : maxWidth + perimeterSize.left + perimeterSize.right,
            height: totalHeight,
        };
    }

    /**
     * Returns the minimum size: sum of all header heights (headers are always visible).
     *
     * @returns The minimum size, or null if not attached.
     */
    getMinSize(): Size | null {
        const container = this.getContainer();

        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimiterSize();
        const componentCount = container.getComponents().length;

        return {
            width : perimeterSize.left + perimeterSize.right,
            height: componentCount * this._headerHeight + perimeterSize.top + perimeterSize.bottom,
        };
    }

    /**
     * Creates header and panel wrapper elements for a newly discovered content component,
     * appends them to the container's DOM, and reparents the content element into the wrapper.
     *
     * @param component - The content component for this section.
     * @param index - Zero-based section index.
     */
    private createSection(component: Component, index: number): void {
        const container = this.getContainer()!;
        const constraints = this.getLayoutConstraints(component) as AccordionConstraints | undefined;
        const label = constraints?.label ?? component.getId();
        const initiallyOpen = constraints?.initiallyOpen ?? false;

        const header = new AccordionHeader(label);

        header.setPosition(Position.ABSOLUTE);

        Event.addListener(header, 'click', () => this.onHeaderClicked(index));
        Event.addListener(header, 'keydown', (e: KeyboardEvent) => this.onHeaderKeyDown(e, index));

        const wrapper = new Component();

        wrapper.setPosition(Position.ABSOLUTE);
        wrapper.setOverflow('hidden');
        // Animation wrapper clips content via overflow:hidden — layout+paint containment scopes
        // reflow during the height transition without affecting the rest of the document.
        wrapper.setElementCSSRule("contain", "layout paint");

        // CSS transitions have no Component API setter; element.style is necessary here.
        wrapper.getElement(true).style.transition = `height ${this._animationDuration}ms ease`;

        container.getElement().appendChild(header.getElement(true));
        container.getElement().appendChild(wrapper.getElement(true));

        // Reparent content element into wrapper so overflow:hidden clips it during animation.
        wrapper.getElement().appendChild(component.getElement());

        this.openState.push(initiallyOpen);
        this.headers.push(header);
        this.panelWrappers.push(wrapper);

        header.setExpanded(initiallyOpen);
        header.getAria().setExpanded(initiallyOpen);
        header.getAria().setControls(wrapper.getId());

        wrapper.getAria().setRole('region');
        wrapper.getAria().setLabelledBy(header.getId());
    }

    /**
     * Creates sections for any new components, then positions all headers, panel
     * wrappers, and content components top-to-bottom within the container.
     */
    doLayout(): void {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        const components = container.getComponents();

        for (let i = this.headers.length; i < components.length; i++) {
            this.createSection(components[i], i);
        }

        const containerSize = container.getInnerSize();
        const insets = container.getInsets();
        const containerWidth = containerSize ? containerSize.width : 0;
        let y = insets.getTop();

        for (let i = 0; i < components.length; i++) {
            const component = components[i];
            const header = this.headers[i];
            const wrapper = this.panelWrappers[i];
            const isOpen = this.openState[i];

            header.setX(insets.getLeft());
            header.setY(y);
            header.setWidth(containerWidth);
            header.setHeight(this._headerHeight);
            header.doLayout();

            y += this._headerHeight;

            let panelHeight = 0;

            if (isOpen) {
                const preferred = component.getPreferredSize();
                panelHeight = preferred ? preferred.height : 100;
            }

            wrapper.setX(insets.getLeft());
            wrapper.setY(y);
            wrapper.setWidth(containerWidth);
            wrapper.setHeight(panelHeight);

            component.setX(0);
            component.setY(0);
            component.setWidth(containerWidth);
            component.setHeight(panelHeight);
            component.doLayout();

            y += panelHeight;
        }
    }

    /**
     * Handles ArrowDown, ArrowUp, Home, and End to move keyboard focus between headers.
     *
     * @param e - The keyboard event fired on a header.
     * @param index - Zero-based index of the header that received the event.
     */
    private onHeaderKeyDown(e: KeyboardEvent, index: number): void {
        const count = this.headers.length;

        if (count === 0) {
            return;
        }

        let target: number;

        switch (e.key) {
            case 'ArrowDown': target = (index + 1) % count; break;
            case 'ArrowUp':   target = (index - 1 + count) % count; break;
            case 'Home':      target = 0; break;
            case 'End':       target = count - 1; break;
            default:          return;
        }

        e.preventDefault();
        this.headers[target].focus();
    }

    /**
     * Handles a header click: toggles the open state, enforces single-open mode,
     * updates the indicator and ARIA, fires the callback, and re-runs layout.
     *
     * @param index - Zero-based index of the clicked header.
     */
    private onHeaderClicked(index: number): void {
        const wasOpen = this.openState[index];

        if (this._singleOpen && !wasOpen) {
            for (let i = 0; i < this.openState.length; i++) {
                if (i !== index && this.openState[i]) {
                    this.openState[i] = false;
                    this.headers[i].setExpanded(false);
                    this.headers[i].getAria().setExpanded(false);
                    this.onSectionToggleCallback?.(i, false);
                }
            }
        }

        const nowOpen = !wasOpen;

        this.openState[index] = nowOpen;
        this.headers[index].setExpanded(nowOpen);
        this.headers[index].getAria().setExpanded(nowOpen);
        this.onSectionToggleCallback?.(index, nowOpen);
        this.getContainer()?.scheduleLayout();
    }
}
