// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { AccordionConstraints } from "~/layout/AccordionConstraints.js";
import { AccordionHeader } from "~/component/container/AccordionHeader.js";
import { Animation } from "~/core/Animation.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Position } from "~/primitive/Position.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

/**
 * Symmetric easing curve, shared between the panel wrapper height transition,
 * the headers'/wrappers' `top` transitions, and the indicator transform
 * transition so the open and close animations are exact time-reverses of each
 * other. Encoded as a module-private constant — motion personality belongs to
 * the layout, not the theme.
 *
 * The Material "standard" curve `cubic-bezier(0.4, 0, 0.2, 1)` was rejected
 * because it's asymmetric — `easing(0.5) ≈ 0.77`, so a close shrinks ~77% of
 * the way in the first half of the duration and crawls through the final 23%
 * for the second half. The visual weight lands at large sizes first, which
 * reads as "content vanished, then nothing happened." A symmetric curve has
 * `easing(t) + easing(1 - t) = 1`, so the close mirrors the open frame-for-frame.
 *
 * `scaleY` was rejected as the animated property: the wrapper participates
 * in document flow and siblings need to reflow as it grows. `height` with
 * `contain: layout paint` scopes the reflow cost and produces the correct
 * layout-tracking motion.
 */
const ACCORDION_EASING: string = "cubic-bezier(0.4, 0, 0.6, 1)";

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
class Accordion extends LayoutManager {

    private _headers: AccordionHeader[] = [];
    private _panelWrappers: Component[] = [];
    private _openState: boolean[] = [];
    private _singleOpen: boolean = false;
    private _headerHeight: number = 28;
    private _animationDuration: number = 200;
    private _onSectionToggleCallback: SectionToggleCallback | null = null;

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
    setSingleOpen(value: boolean): this {
        this._singleOpen = value;

        if (!value) {
            return this;
        }

        let foundOpen = false;

        for (let i = 0; i < this._openState.length; i++) {
            if (!this._openState[i]) {
                continue;
            }

            if (foundOpen) {
                this._openState[i] = false;
                this._headers[i].setExpanded(false);
                this._headers[i].getAria().setExpanded(false);
                this._onSectionToggleCallback?.(i, false);
            } else {
                foundOpen = true;
            }
        }

        this.getContainer()?.scheduleLayout();

        return this;
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
    setHeaderHeight(height: number): this {
        this._headerHeight = height;

        return this;
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
    setAnimationDuration(ms: number): this {
        this._animationDuration = ms;

        return this;
    }

    /**
     * Opens the section at the given index.
     *
     * @param index - Zero-based section index.
     */
    openSection(index: number): this {
        if (index < 0 || index >= this._openState.length) {
            return this;
        }

        if (this._singleOpen) {
            for (let i = 0; i < this._openState.length; i++) {
                if (i !== index && this._openState[i]) {
                    this.primeWrapper(i);
                    this._openState[i] = false;
                    this._headers[i].setExpanded(false);
                    this._headers[i].getAria().setExpanded(false);
                    this._onSectionToggleCallback?.(i, false);
                }
            }
        }

        this.primeWrapper(index);
        this._openState[index] = true;
        this._headers[index].setExpanded(true);
        this._headers[index].getAria().setExpanded(true);
        this._onSectionToggleCallback?.(index, true);
        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Closes the section at the given index.
     *
     * @param index - Zero-based section index.
     */
    closeSection(index: number): this {
        if (index < 0 || index >= this._openState.length) {
            return this;
        }

        this.primeWrapper(index);
        this._openState[index] = false;
        this._headers[index].setExpanded(false);
        this._headers[index].getAria().setExpanded(false);
        this._onSectionToggleCallback?.(index, false);
        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether the section at the given index is currently open.
     *
     * @param index - Zero-based section index.
     * @returns True if the section is open.
     */
    isSectionOpen(index: number): boolean {
        return this._openState[index] ?? false;
    }

    /**
     * Registers a callback invoked whenever a section is opened or closed.
     *
     * @param callback - The callback, or null to remove it.
     */
    setOnSectionToggle(callback: SectionToggleCallback | null): this {
        this._onSectionToggleCallback = callback;

        return this;
    }

    /**
     * Attaches to a container. Section headers and panel wrappers are created
     * lazily in {@link doLayout} on first use.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component): this {
        super.attach(container);

        return this;
    }

    /**
     * Detaches from the container, removing all header and panel wrapper elements
     * from the DOM and moving content elements back to the container.
     */
    detach(): this {
        const container = this.getContainer();

        for (let i = 0; i < this._headers.length; i++) {
            const components = container ? container.getComponents() : [];
            const component = components[i];

            if (component && container) {
                container.getElement().appendChild(component.getElement());
            }

            this._headers[i].getElement().remove();
            this._panelWrappers[i].getElement().remove();
        }

        this._headers = [];
        this._panelWrappers = [];
        this._openState = [];

        super.detach();

        return this;
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
            const isOpen = i < this._openState.length
                ? this._openState[i]
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
        header.setAnimationTiming(this._animationDuration, ACCORDION_EASING);

        // Headers slide vertically with the panels opening or closing above them
        // — without animating `top`, headers below a toggled section snap to
        // their final position while the panel height transitions, which reads
        // as broken motion.
        header.setTransition(this.buildHeaderTransition());

        Event.addListener(header, 'click', () => this.onHeaderClicked(index));
        Event.addListener(header, 'keydown', (e: KeyboardEvent) => this.onHeaderKeyDown(e, index));

        const wrapper = new Component();

        wrapper.setPosition(Position.ABSOLUTE);
        wrapper.setOverflow('hidden');
        // Animation wrapper clips content via overflow:hidden — layout+paint containment scopes
        // reflow during the height transition without affecting the rest of the document.
        wrapper.setContain("layout paint");

        // `height` animates this wrapper's own grow/shrink; `top` animates wrappers
        // below a toggled section so they slide with the headers instead of jumping.
        wrapper.setTransition(this.buildWrapperTransition());

        container.getElement().appendChild(header.getElement(true));
        container.getElement().appendChild(wrapper.getElement(true));

        // Reparent content element into wrapper so overflow:hidden clips it during animation.
        wrapper.getElement().appendChild(component.getElement());

        this._openState.push(initiallyOpen);
        this._headers.push(header);
        this._panelWrappers.push(wrapper);

        header.setExpanded(initiallyOpen);
        header.getAria().setExpanded(initiallyOpen);
        header.getAria().setControls(wrapper.getId());

        wrapper.getAria().setRole('region');
        wrapper.getAria().setLabelledBy(header.getId());
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * width is `max(children.minWidth)` (sections stack vertically so width
     * is shared); height is N/A because Accordion intentionally ignores the
     * Y-axis overflow flag — the height animation conflicts with letting
     * sections overflow vertically. Used by `doLayout` to inflate the
     * working width when the host has opted into X-axis `setOverflowing`.
     *
     * @returns The total min-size; the height field is always `0` (unused).
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        let maxWidth = 0;

        for (const component of container.getComponents()) {
            const min = component.getMinSize();
            if (min) {
                maxWidth = Math.max(maxWidth, min.width);
            }
        }

        return { width: maxWidth, height: 0 };
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

        for (let i = this._headers.length; i < components.length; i++) {
            this.createSection(components[i], i);
        }

        const containerSize = container.getInnerSize();
        const insets = container.getInsets();
        let containerWidth = containerSize ? containerSize.width : 0;

        // Universal scroll, X-axis only: Accordion stacks sections vertically
        // and animates each section's height, so honouring vertical overflow
        // would conflict with the height animation (see plan's Architecture
        // Decisions). Only inflate the working width when the host has marked
        // X as overflowing.
        if (this.isOverflowingX()) {
            const totalMin = this.computeTotalMinSize();
            containerWidth = Math.max(containerWidth, totalMin.width);
        }

        let y = insets.getTop();

        for (let i = 0; i < components.length; i++) {
            const component = components[i];
            const header = this._headers[i];
            const wrapper = this._panelWrappers[i];
            const isOpen = this._openState[i];

            header.setX(insets.getLeft());
            header.setY(y);
            header.setWidth(containerWidth);
            header.setHeight(this._headerHeight);
            header.doLayout();

            y += this._headerHeight;

            // The content keeps its preferred height in both open and closed
            // states so the wrapper's `overflow: hidden` does the clipping during
            // the close animation. If the content collapses to 0 instantly while
            // the wrapper transitions N → 0, the close reads as the content
            // vanishing followed by an empty wrapper sliding shut.
            const preferred = component.getPreferredSize();
            const contentHeight = preferred ? preferred.height : 100;
            const panelHeight = isOpen ? contentHeight : 0;

            wrapper.setX(insets.getLeft());
            wrapper.setY(y);
            wrapper.setWidth(containerWidth);
            wrapper.setHeight(panelHeight);

            component.setX(0);
            component.setY(0);
            component.setWidth(containerWidth);
            component.setHeight(contentHeight);
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
        const count = this._headers.length;

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
        this._headers[target].focus();
    }

    /**
     * Handles a header click: toggles the open state, enforces single-open mode,
     * updates the indicator and ARIA, fires the callback, and re-runs layout.
     *
     * @param index - Zero-based index of the clicked header.
     */
    private onHeaderClicked(index: number): void {
        const wasOpen = this._openState[index];

        if (this._singleOpen && !wasOpen) {
            for (let i = 0; i < this._openState.length; i++) {
                if (i !== index && this._openState[i]) {
                    this.primeWrapper(i);
                    this._openState[i] = false;
                    this._headers[i].setExpanded(false);
                    this._headers[i].getAria().setExpanded(false);
                    this._onSectionToggleCallback?.(i, false);
                }
            }
        }

        const nowOpen = !wasOpen;

        this.primeWrapper(index);
        this._openState[index] = nowOpen;
        this._headers[index].setExpanded(nowOpen);
        this._headers[index].getAria().setExpanded(nowOpen);
        this._onSectionToggleCallback?.(index, nowOpen);
        this.getContainer()?.scheduleLayout();
    }

    /**
     * Pre-promotes the panel wrapper to its own compositor layer for the
     * duration of the active toggle so the first transition frame doesn't
     * pay a layer-creation cost, then schedules the layer's release on
     * `transitionend` (filtered to `height`) with a `setTimeout` fallback
     * for the cases where `transitionend` never fires — toggling a section
     * whose height didn't change, tab-switch mid-transition, …
     *
     * Under `prefers-reduced-motion: reduce` the will-change hint is skipped
     * entirely, and the inline `transition` on every header and panel wrapper
     * is set to `"none"` so the upcoming `doLayout` writes — wrapper height,
     * plus the `top` of every header and wrapper below the toggled section —
     * land instantly. Transitions are restored on the next frame so subsequent
     * toggles animate normally.
     *
     * Mirrors the `transitionend`-with-fallback pattern in
     * [`Animation.play`](/api/core/namespaces/Animation/functions/play) so
     * the bookkeeping stays in one shape across the framework.
     *
     * @param index - Zero-based index of the section whose wrapper to prime.
     */
    private primeWrapper(index: number): void {
        const wrapper = this._panelWrappers[index];

        if (Animation.isReducedMotion()) {
            // A toggle moves this wrapper's height AND the top of every header
            // + wrapper below it, so all of those transitions need suppressing
            // for the upcoming doLayout writes to land instantly.
            for (let i = 0; i < this._headers.length; i++) {
                this._headers[i].setTransition("none");
                this._panelWrappers[i].setTransition("none");
            }

            requestAnimationFrame(() => {
                for (let i = 0; i < this._headers.length; i++) {
                    this._headers[i].setTransition(this.buildHeaderTransition());
                    this._panelWrappers[i].setTransition(this.buildWrapperTransition());
                }
            });

            return;
        }

        // Give the container's own height the same transition so the outer
        // layout's instant resize (triggered when the parent re-queries our
        // `getPreferredSize` after the open state flips) animates in lockstep
        // with the wrappers and headers inside. Without this, the container
        // (which defaults to `overflow: hidden`) snaps to the closed size and
        // clips the still-animating sections — they vanish for ~75% of the
        // duration and pop back in near the end. Cleared on cleanup so
        // unrelated height changes (window resize, etc.) stay instant.
        const container = this.getContainer();

        container?.setTransition(`height ${this._animationDuration}ms ${ACCORDION_EASING}`);

        wrapper.setWillChange("height");

        Animation.afterTransition({
            component:        wrapper,
            property:         "height",
            durationMs:       this._animationDuration,
            fallbackBufferMs: 40,
            onComplete:       () => {
                wrapper.setWillChange(null);
                container?.setTransition(null);
            },
        });
    }

    /**
     * Builds the `top`-only transition shorthand applied to every header.
     * Centralised so `createSection` and `primeWrapper`'s reduced-motion
     * restore path stay in sync.
     */
    private buildHeaderTransition(): string {
        return `top ${this._animationDuration}ms ${ACCORDION_EASING}`;
    }

    /**
     * Builds the multi-property transition shorthand applied to every panel
     * wrapper — `height` animates the wrapper's own grow/shrink, `top`
     * animates the wrappers below a toggled section so they slide with the
     * headers instead of jumping.
     */
    private buildWrapperTransition(): string {
        return `height ${this._animationDuration}ms ${ACCORDION_EASING}, top ${this._animationDuration}ms ${ACCORDION_EASING}`;
    }
}

const AccordionCallable = callable(Accordion);
type AccordionCallable = Accordion;
export {
    Accordion         as _Accordion,
    AccordionCallable as Accordion
};
