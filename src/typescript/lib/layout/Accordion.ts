// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { AccordionConstraints } from "~/layout/AccordionConstraints.js";
import { AccordionHeader } from "~/component/container/AccordionHeader.js";
import { Animation } from "~/core/Animation.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Size } from "~/primitive/Size.js";
import type { AxisEnd } from "~/primitive/Axis.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";

/**
 * String-literal union of the events emitted by {@link Accordion}.
 *
 * @category Layouts
 */
export type AccordionEvent = "sectiontoggle";

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
 * Header height in pixels used by {@link Accordion} compact mode. Tighter than
 * the default 28px so a stack of sections reads denser; applied only when the
 * consumer has not pinned an explicit header height via `setHeaderHeight`.
 */
const COMPACT_HEADER_HEIGHT: number = 22;

/**
 * Themed-mode CSS values for the accordion theme tokens, with fallbacks
 * mirroring the default light theme. Applied to each header only when `themed`
 * is on, so an un-themed accordion stays chromeless. The header border is a
 * single bottom divider (not a four-side box): stacked headers then read as a
 * flat list whose dividers never double, so no separate `flat`/collapse option
 * is needed — the look is driven entirely by the `accordion.header.border` token.
 */
const THEMED_HEADER_BG:     string = "var(--ts-ui-accordion-header-bg, rgb(243,244,246))";
const THEMED_HEADER_BORDER: string = "var(--ts-ui-accordion-header-border, 1px solid rgb(214,217,222))";
const THEMED_HEADER_COLOR:  string = "var(--ts-ui-accordion-header-color, inherit)";

/**
 * All-around border drawn on the accordion's own container when `themed`, from
 * the `accordion.border` token — boxes the whole stack while the header borders
 * remain single bottom dividers between sections. The token carries the full CSS
 * border shorthand (width, style, colour), so a theme controls all three; the
 * fallback applies only when the variable is undefined.
 */
const THEMED_BORDER:        string = "var(--ts-ui-accordion-border, 1px solid rgb(214,217,222))";

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
    chevronSide?:       AxisEnd;
    toolsVisibility?:   "always" | "hover";
    compact?:           boolean;
    chevronGlyph?:      string;
    spacing?:           number;
    themed?:            boolean;
    fillHeight?:        boolean;
    /**
     * Multi-event listener bag dispatched to {@link Accordion.on} at
     * construction time.
     */
    listeners?: {
        sectiontoggle?: SectionToggleCallback;
    };
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
    private _headerHeightExplicit: boolean = false;
    private _compact: boolean = false;
    private _animationDuration: number = 200;
    private _chevronSide: AxisEnd = "end";
    private _chevronGlyph: string | null = null;
    private _spacing: number = 0;
    private _themed: boolean = true;
    private _fillHeight: boolean = false;
    private _tools: Component[] = [];
    private _toolsVisibility: "always" | "hover" = "hover";
    private _hoveredHeader: number = -1;
    private _listeners: ListenerBag<AccordionEvent> = new ListenerBag<AccordionEvent>();

    constructor(options?: AccordionOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
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

        if (options.chevronSide !== undefined) {
            this.setChevronSide(options.chevronSide);
        }

        if (options.toolsVisibility !== undefined) {
            this.setToolsVisibility(options.toolsVisibility);
        }

        if (options.compact !== undefined) {
            this.setCompact(options.compact);
        }

        if (options.chevronGlyph !== undefined) {
            this.setChevronGlyph(options.chevronGlyph);
        }

        if (options.spacing !== undefined) {
            this.setSpacing(options.spacing);
        }

        if (options.themed !== undefined) {
            this.setThemed(options.themed);
        }

        if (options.fillHeight !== undefined) {
            this.setFillHeight(options.fillHeight);
        }

        if (options.listeners !== undefined) {
            const listeners = options.listeners;

            for (const event of Object.keys(listeners) as Array<keyof typeof listeners>) {
                const listener = listeners[event];

                if (listener !== undefined) {
                    this.on(event, listener);
                }
            }
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
                this.primeWrapper(i);
                this._openState[i] = false;
                this._headers[i].setExpanded(false);
                this.emit("sectiontoggle", i, false);
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
     * Sets the height of each section header in pixels. Marks the height as
     * explicitly set, so {@link setCompact} no longer overrides it with the
     * compact default.
     *
     * @param height - Height in pixels.
     */
    setHeaderHeight(height: number): this {
        this._headerHeight = height;
        this._headerHeightExplicit = true;

        return this;
    }

    /**
     * Returns the header height actually used for layout: the compact default
     * when {@link isCompact} is on and no explicit height was set, otherwise the
     * configured {@link getHeaderHeight}.
     *
     * @returns The effective header height in pixels.
     */
    private effectiveHeaderHeight(): number {
        return this._compact && !this._headerHeightExplicit
            ? COMPACT_HEADER_HEIGHT
            : this._headerHeight;
    }

    /**
     * Returns whether compact (denser) mode is active.
     *
     * @returns True if compact mode is on.
     */
    isCompact(): boolean {
        return this._compact;
    }

    /**
     * Sets compact (denser) mode: a smaller default header height (unless an
     * explicit height was set) plus tighter header padding and a smaller
     * chevron. Applies to existing headers immediately.
     *
     * @param value - True to enable compact mode.
     *
     * @returns This layout manager, for chaining.
     */
    setCompact(value: boolean): this {
        this._compact = value;

        for (const header of this._headers) {
            header.setCompact(value);
        }

        this.getContainer()?.scheduleLayout();

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
     * Returns which end of each header the chevron sits at.
     *
     * @returns `"start"` or `"end"`.
     */
    getChevronSide(): AxisEnd {
        return this._chevronSide;
    }

    /**
     * Sets which end of each header the chevron sits at. The section label
     * always stays left-aligned; only the chevron moves. Applies to existing
     * headers immediately and to headers created afterwards.
     *
     * @param side - `"start"` or `"end"`.
     *
     * @returns This layout manager, for chaining.
     */
    setChevronSide(side: AxisEnd): this {
        this._chevronSide = side;

        for (const header of this._headers) {
            header.setChevronSide(side);
        }

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the chevron character, or `null` when the default is used.
     *
     * @returns The configured chevron character, or `null`.
     */
    getChevronGlyph(): string | null {
        return this._chevronGlyph;
    }

    /**
     * Sets the character drawn as each header's expand/collapse chevron, in
     * place of the default `"▶"`. The character rotates 90° when a section
     * expands, so a single rotatable glyph covers both states. Applies to
     * existing headers immediately.
     *
     * @param glyph - The chevron character.
     *
     * @returns This layout manager, for chaining.
     */
    setChevronGlyph(glyph: string): this {
        this._chevronGlyph = glyph;

        for (const header of this._headers) {
            header.setChevronGlyph(glyph);
        }

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the vertical gap inserted between sections.
     *
     * @returns The inter-section spacing in pixels.
     */
    getSpacing(): number {
        return this._spacing;
    }

    /**
     * Sets the vertical gap inserted between sections (never before the first or
     * after the last). Default `0` keeps the sections contiguous.
     *
     * @param spacing - Inter-section gap in pixels.
     *
     * @returns This layout manager, for chaining.
     */
    setSpacing(spacing: number): this {
        this._spacing = spacing;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether fill mode is on.
     *
     * @returns True if the bottommost open section absorbs leftover height.
     */
    isFillHeight(): boolean {
        return this._fillHeight;
    }

    /**
     * Sets fill mode. When on, the bottommost open section grows to fill the
     * container's leftover height (IDE/dock-panel style) instead of every open
     * section sitting at its preferred height — only meaningful when the host
     * stretches the accordion beyond its preferred height. No effect when the
     * content already overflows.
     *
     * @param value - True to enable fill.
     *
     * @returns This layout manager, for chaining.
     */
    setFillHeight(value: boolean): this {
        this._fillHeight = value;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether themed mode is on.
     *
     * @returns True if headers/panels paint the accordion theme tokens.
     */
    isThemed(): boolean {
        return this._themed;
    }

    /**
     * Sets themed mode. When on, each header paints the accordion theme tokens
     * (background, bottom-divider border, text colour) and the container draws
     * an all-around border; when off, headers stay chromeless and the container
     * border is cleared. Applies to existing sections immediately.
     *
     * @param value - True to paint the accordion theme tokens.
     *
     * @returns This layout manager, for chaining.
     */
    setThemed(value: boolean): this {
        this._themed = value;

        this.applyContainerTheming();

        for (let i = 0; i < this._headers.length; i++) {
            this.applySectionTheming(i);
        }

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Applies (or clears) the all-around border on the accordion's container per
     * the themed state. Idempotent — `setBorder`/`clearBorder` cache, so the
     * repeated call from `doLayout` is cheap.
     */
    private applyContainerTheming(): void {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        if (this._themed) {
            container.setBorder({ border: THEMED_BORDER });
        } else {
            container.clearBorder();
        }
    }

    /**
     * Applies (or clears) the themed background/border/text styling for the
     * header at `index`. The themed border is a single bottom divider, so
     * stacked headers read as a flat list whose dividers never double — there is
     * no separate flat/collapse mode. Idempotent — the underlying setters cache,
     * so re-applying the same state is cheap.
     *
     * @param index - Zero-based section index.
     */
    private applySectionTheming(index: number): void {
        const header = this._headers[index];

        if (!header) {
            return;
        }

        if (!this._themed) {
            header.clearBackground();
            header.clearForegroundColor();
            header.clearBorder();

            return;
        }

        // `background` (not `background-color`) so a gradient token value paints;
        // the token may also be a flat colour, which the shorthand handles too.
        header.setBackground(THEMED_HEADER_BG);
        header.setForegroundColor(THEMED_HEADER_COLOR);
        // Bottom-only divider — collapses naturally with no per-index logic.
        header.setBorder({ border: "none", borderBottom: THEMED_HEADER_BORDER });
    }

    /**
     * Returns when per-section tools are shown.
     *
     * @returns `"always"` or `"hover"`.
     */
    getToolsVisibility(): "always" | "hover" {
        return this._toolsVisibility;
    }

    /**
     * Sets when per-section tools are shown. `"hover"` (the default) reveals a
     * header's tools only while it is hovered; `"always"` keeps them visible.
     * Global tools (see {@link addTool}) always follow hover regardless of this
     * setting, since a single global instance can only sit in the hovered header.
     *
     * @param mode - `"always"` or `"hover"`.
     *
     * @returns This layout manager, for chaining.
     */
    setToolsVisibility(mode: "always" | "hover"): this {
        this._toolsVisibility = mode;

        // Re-apply the resting state to every header; a subsequent hover
        // corrects the currently-hovered one.
        for (const header of this._headers) {
            header.setToolsRevealed(mode === "always");
        }

        return this;
    }

    /**
     * Registers a global tool shown on whichever header is currently hovered.
     * A single `Component` is one DOM node, so a global tool cannot appear on
     * every header at once — it is re-parented into the hovered header and
     * therefore follows hover/active visibility. Mirrors `Tab.addTool`.
     *
     * @param button - The tool component to register globally.
     *
     * @returns This layout manager, for chaining.
     */
    addTool(button: Component): this {
        if (this._tools.includes(button)) {
            return this;
        }

        this._tools.push(button);

        // If a header is hovered right now, show the new tool there immediately.
        if (this._hoveredHeader !== -1) {
            this._headers[this._hoveredHeader]?.addTool(button);
        }

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Removes a previously-registered global tool.
     *
     * @param button - The tool component to remove.
     *
     * @returns This layout manager, for chaining.
     */
    removeTool(button: Component): this {
        const index = this._tools.indexOf(button);

        if (index === -1) {
            return this;
        }

        this._tools.splice(index, 1);

        if (this._hoveredHeader !== -1) {
            this._headers[this._hoveredHeader]?.removeTool(button);
        }

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Adds the global tools to the header at `index` and, in hover mode, reveals
     * its tool group. Called when the pointer enters a header.
     *
     * @param index - The header being entered.
     */
    private revealHeaderTools(index: number): void {
        const header = this._headers[index];

        if (!header) {
            return;
        }

        for (const tool of this._tools) {
            header.addTool(tool);
        }

        if (this._toolsVisibility === "hover") {
            header.setToolsRevealed(true);
        }
    }

    /**
     * Removes the global tools from the header at `index` and, in hover mode,
     * hides its tool group again. Called when the pointer leaves a header.
     *
     * @param index - The header being left.
     */
    private hideHeaderTools(index: number): void {
        const header = this._headers[index];

        if (!header) {
            return;
        }

        for (const tool of this._tools) {
            header.removeTool(tool);
        }

        if (this._toolsVisibility === "hover") {
            header.setToolsRevealed(false);
        }
    }

    /**
     * Handles the pointer entering a header (filtered to genuine enters, not
     * moves between the header's own descendants): relocates the global tools
     * onto it and reveals its tools, moving them off the previously hovered
     * header first.
     *
     * @param index - The header receiving the pointer.
     * @param e - The originating `mouseover` event.
     */
    private onHeaderHoverEnter(index: number, e: MouseEvent): void {
        const element = this._headers[index]?.getElement();

        if (element && DOM.source.isNode(e.relatedTarget) && DOM.source.contains(element, DOM.source.intern(e.relatedTarget))) {
            return;
        }

        if (this._hoveredHeader === index) {
            return;
        }

        if (this._hoveredHeader !== -1) {
            this.hideHeaderTools(this._hoveredHeader);
        }

        this._hoveredHeader = index;
        this.revealHeaderTools(index);
    }

    /**
     * Handles the pointer leaving a header (filtered to genuine exits): removes
     * the global tools and hides the tools again.
     *
     * @param index - The header losing the pointer.
     * @param e - The originating `mouseout` event.
     */
    private onHeaderHoverLeave(index: number, e: MouseEvent): void {
        const element = this._headers[index]?.getElement();

        if (element && DOM.source.isNode(e.relatedTarget) && DOM.source.contains(element, DOM.source.intern(e.relatedTarget))) {
            return;
        }

        if (this._hoveredHeader !== index) {
            return;
        }

        this.hideHeaderTools(index);
        this._hoveredHeader = -1;
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
                    this.emit("sectiontoggle", i, false);
                }
            }
        }

        this.primeWrapper(index);
        this._openState[index] = true;
        this._headers[index].setExpanded(true);
        this.emit("sectiontoggle", index, true);
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
        this.emit("sectiontoggle", index, false);
        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Opens every section. In single-open mode only one section may be open at
     * a time, so this opens the first section (a deterministic choice — the
     * topmost becomes the visible one) rather than leaving whichever section
     * `openSection` happened to settle on last.
     *
     * @returns This layout manager, for chaining.
     */
    expandAll(): this {
        if (this._singleOpen) {
            this.openSection(0);

            return this;
        }

        for (let i = 0; i < this._openState.length; i++) {
            this.openSection(i);
        }

        return this;
    }

    /**
     * Closes every section.
     *
     * @returns This layout manager, for chaining.
     */
    collapseAll(): this {
        for (let i = 0; i < this._openState.length; i++) {
            this.closeSection(i);
        }

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
     * Registers a listener for one of this accordion's events.
     *
     * @param event - `"sectiontoggle"` fires whenever a section is opened or
     *   closed, receiving the zero-based section index and whether it is
     *   now open.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This accordion, for method chaining.
     */
    on(event: "sectiontoggle", listener: SectionToggleCallback): this;
    on(event: AccordionEvent,  listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This accordion, for method chaining.
     */
    off(event: AccordionEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "sectiontoggle", index: number, open: boolean): void;
    protected emit(event: AccordionEvent,  ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
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
                DOM.sink.appendChild(container.getElement()!, component.getElement()!);
            }

            DOM.sink.removeElement(this._headers[i].getElement()!);
            DOM.sink.removeElement(this._panelWrappers[i].getElement()!);
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
        let displayedSoFar = 0;

        for (let i = 0; i < components.length; i++) {
            // A non-displayed section contributes neither its header nor its
            // (possibly open) content height to the stack.
            if (!components[i].isDisplayed()) {
                continue;
            }

            // Inter-section gap between displayed sections (see doLayout).
            if (displayedSoFar > 0) {
                totalHeight += this._spacing;
            }

            displayedSoFar += 1;
            totalHeight += this.effectiveHeaderHeight();

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
     * Returns the minimum size: every header height (headers are always
     * visible) plus the minimum heights of all open sections. Mirrors
     * {@link getPreferredSize} but reads each open section's `getMinSize`
     * rather than its preferred size, so a host can tell how far the accordion
     * is genuinely allowed to shrink — the headers plus the open content's own
     * floor — instead of assuming the open content can collapse to nothing.
     *
     * @returns The minimum size, or null if not attached.
     */
    getMinSize(): Size | null {
        const container = this.getContainer();

        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimiterSize();
        const components = container.getComponents();
        let totalHeight = perimeterSize.top + perimeterSize.bottom;
        let maxWidth = 0;
        let displayedSoFar = 0;

        for (let i = 0; i < components.length; i++) {
            // A non-displayed section contributes neither its header nor its
            // (possibly open) content height to the stack.
            if (!components[i].isDisplayed()) {
                continue;
            }

            // Inter-section gap between displayed sections (see doLayout).
            if (displayedSoFar > 0) {
                totalHeight += this._spacing;
            }

            displayedSoFar += 1;
            totalHeight += this.effectiveHeaderHeight();

            // openState is populated lazily in doLayout; fall back to the
            // constraint's initiallyOpen flag so getMinSize() is correct even
            // before the first doLayout pass (matches getPreferredSize).
            const isOpen = i < this._openState.length
                ? this._openState[i]
                : ((this.getLayoutConstraints(components[i]) as AccordionConstraints | undefined)?.initiallyOpen ?? false);

            if (isOpen) {
                const min = components[i].getMinSize();

                if (min) {
                    totalHeight += min.height;

                    if (min.width > maxWidth) {
                        maxWidth = min.width;
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

        const header = new AccordionHeader(label, { chevronSide: this._chevronSide, glyph: constraints?.glyph ?? undefined, compact: this._compact, chevronGlyph: this._chevronGlyph ?? undefined });

        header.setAnimationTiming(this._animationDuration, ACCORDION_EASING);

        // Headers slide vertically with the panels opening or closing above them
        // — without animating `top`, headers below a toggled section snap to
        // their final position while the panel height transitions, which reads
        // as broken motion.
        header.setTransition(this.buildHeaderTransition());

        const title = header.getTitleButton();

        // The title button is the toggle + focus target; its `action` covers the
        // label/glyph area. A click listener on the header element covers the
        // chevron (pointer-events:none, so it falls through to the header) and
        // the padding gaps. Tools carry their own ids, so neither exact-target
        // listener fires for a tool click — toggling stays structural.
        title.on("action", () => this.onHeaderClicked(index));
        Event.addListener(header, 'click', () => this.onHeaderClicked(index));
        Event.addListener(title, 'keydown', (e: KeyboardEvent) => this.onHeaderKeyDown(e, index));

        // Hover drives tool visibility: per-section tools reveal on hover (in
        // hover mode) and the single global tool set re-parents onto the hovered
        // header. Subtree listeners catch hover anywhere in the header; the
        // handlers filter intra-header moves via relatedTarget.
        Event.addSubtreeListener(header, 'mouseover', (e: MouseEvent) => this.onHeaderHoverEnter(index, e));
        Event.addSubtreeListener(header, 'mouseout', (e: MouseEvent) => this.onHeaderHoverLeave(index, e));

        const wrapper = new Component();

        wrapper.setOverflow('hidden');
        // Animation wrapper clips content via overflow:hidden — layout+paint containment scopes
        // reflow during the height transition without affecting the rest of the document.
        wrapper.setContain("layout paint");

        // `height` animates this wrapper's own grow/shrink; `top` animates wrappers
        // below a toggled section so they slide with the headers instead of jumping.
        wrapper.setTransition(this.buildWrapperTransition());

        DOM.sink.appendChild(container.getElement()!, header.getElement(true)!);
        DOM.sink.appendChild(container.getElement()!, wrapper.getElement(true)!);

        // Reparent content element into wrapper so overflow:hidden clips it during animation.
        DOM.sink.appendChild(wrapper.getElement()!, component.getElement()!);

        // The content animates its own height in lockstep with the wrapper.
        // Without this the content height is written instantly (see doLayout), so
        // an open section that must *shrink* — e.g. a fill-mode sibling giving
        // back its leftover height when a lower section opens — snaps to its final
        // height while only the wrapper's `overflow: hidden` clip animates, which
        // reads as the panel above the toggled one jumping. `primeWrapper`
        // suppresses this transition under reduced motion alongside the wrapper's.
        component.setTransition(this.buildContentTransition());

        this._openState.push(initiallyOpen);
        this._headers.push(header);
        this._panelWrappers.push(wrapper);

        header.setExpanded(initiallyOpen);
        title.getAria().setControls(wrapper.getId());

        wrapper.getAria().setRole('region');
        wrapper.getAria().setLabelledBy(title.getId());

        for (const tool of constraints?.tools ?? []) {
            header.addTool(tool);
        }

        // In hover mode a header's tools stay hidden until the pointer enters.
        if (this._toolsVisibility === "hover") {
            header.setToolsRevealed(false);
        }

        this.applySectionTheming(index);
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
            if (!component.isDisplayed()) {
                continue;
            }

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

        // Apply the themed container border (idempotent) so it takes effect even
        // when `themed` defaults on and `setThemed` was never called explicitly.
        this.applyContainerTheming();

        const containerSize = container.getInnerSize();
        const insets = container.getContentInsets();
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

        // Shrink-to-fit along the vertical axis: when the open sections'
        // preferred heights overflow the container, shrink each toward its min
        // so the accordion fits — see computeShrinkRatio for the full policy.
        const shrinkRatio = this.computeShrinkRatio(components, containerSize);

        // Fill mode: the bottommost open section grows to absorb the container's
        // leftover height (underflow). It is the counterpart to shrink: when the
        // content overflows, shrinkRatio > 0 and the leftover is <= 0, so fill
        // is a no-op and the two policies never both apply.
        const { fillTarget, fillLeftover } = this.computeFill(components, containerSize, shrinkRatio);

        let y = insets.getTop();
        let displayedSoFar = 0;

        for (let i = 0; i < components.length; i++) {
            const component = components[i];
            const header = this._headers[i];
            const wrapper = this._panelWrappers[i];
            const isOpen = this._openState[i];

            // A non-displayed section drops out of the stack entirely: hide its
            // header and panel wrapper and don't advance the cursor, so the
            // sections below slide up to reclaim the space. Re-showing restores
            // both (setDisplayed is a no-op when already in the target state).
            if (!component.isDisplayed()) {
                header.setDisplayed(false);
                wrapper.setDisplayed(false);

                continue;
            }

            header.setDisplayed(true);
            wrapper.setDisplayed(true);

            // Inter-section gap: before every displayed section except the
            // first, so the gap never leads or trails the stack.
            if (displayedSoFar > 0) {
                y += this._spacing;
            }

            displayedSoFar += 1;

            header.setX(insets.getLeft());
            header.setY(y);
            header.setWidth(containerWidth);
            header.setHeight(this.effectiveHeaderHeight());
            header.doLayout();

            y += this.effectiveHeaderHeight();

            // Open sections take their preferred height, shrunk toward their min
            // by the container-driven ratio so the accordion fits its host.
            // Closed sections keep their content at preferred height so the
            // wrapper's `overflow: hidden` does the clipping during the close
            // animation — if the content collapsed to 0 instantly while the
            // wrapper transitions N → 0, the close would read as the content
            // vanishing followed by an empty wrapper sliding shut.
            const preferred = component.getPreferredSize();
            const contentPref = preferred ? preferred.height : 100;
            let openHeight = this.openContentHeight(component, shrinkRatio);

            // Fill mode: the bottommost open section absorbs the leftover height.
            if (i === fillTarget) {
                openHeight += fillLeftover;
            }

            const panelHeight   = isOpen ? openHeight  : 0;
            const contentHeight = isOpen ? openHeight  : contentPref;

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
     * Computes the vertical shrink ratio applied to every open section's
     * content so the accordion fits its container, mirroring VBox's
     * preferred-mode shrink. Headers are fixed and never shrink; only open
     * sections contribute shrinkable content.
     *
     * Three cases:
     *   1. The open sections already fit (`preferred <= budget`) → ratio `0`,
     *      so every section renders at its preferred height.
     *   2. They overflow but fit at their combined minimum
     *      (`min <= budget < preferred`) → ratio
     *      `(preferred - budget) / (preferred - min)`, clamped to `[0, 1]`, so
     *      each section shrinks proportionally from preferred toward its min.
     *   3. They overflow even at the combined minimum (`budget < min`) →
     *      ratio `0`, falling back to preferred and letting the host clip. A
     *      layout crammed below every section's min reads worse than a clean
     *      overflow, so the manager declines to shrink past min.
     *
     * @param components - The container's content components, section-ordered.
     * @param containerSize - The container's inner size; `null` short-circuits
     *   to `0` (no shrink) since the budget is unknown.
     * @returns The shrink ratio in `[0, 1]`.
     */
    private computeShrinkRatio(components: Component[], containerSize: Size | null): number {
        if (!containerSize) {
            return 0;
        }

        let headerTotal = 0;
        let openPreferred = 0;
        let openMin = 0;
        let displayedSoFar = 0;

        for (let i = 0; i < components.length; i++) {
            // A non-displayed section shows neither its header nor its content,
            // so it contributes nothing to the height budget.
            if (!components[i].isDisplayed()) {
                continue;
            }

            // The inter-section gap is fixed (non-shrinkable) budget, like the
            // headers — count it between displayed sections (see doLayout).
            if (displayedSoFar > 0) {
                headerTotal += this._spacing;
            }

            displayedSoFar += 1;
            headerTotal += this.effectiveHeaderHeight();

            if (!this._openState[i]) {
                continue;
            }

            const pref = components[i].getPreferredSize();
            const min = components[i].getMinSize();

            openPreferred += pref ? pref.height : 100;
            openMin += min ? min.height : 0;
        }

        const totalPreferred = headerTotal + openPreferred;
        const totalMin = headerTotal + openMin;
        const budget = containerSize.height;

        if (totalPreferred <= budget || totalMin > budget) {
            return 0;
        }

        const shrinkable = totalPreferred - totalMin;

        return shrinkable > 0 ? (totalPreferred - budget) / shrinkable : 0;
    }

    /**
     * The height an open section's content renders at: its preferred height
     * shrunk toward its minimum by `shrinkRatio`. Falls back to 100px when the
     * section reports no preferred height.
     *
     * @param component - The section content component.
     * @param shrinkRatio - The container-driven shrink ratio in `[0, 1]`.
     * @returns The content height in pixels.
     */
    private openContentHeight(component: Component, shrinkRatio: number): number {
        const preferred = component.getPreferredSize();
        const contentPref = preferred ? preferred.height : 100;
        const min = component.getMinSize();
        const contentMin = min ? min.height : 0;

        return contentPref - shrinkRatio * (contentPref - contentMin);
    }

    /**
     * Computes fill placement: the index of the bottommost open displayed
     * section (the fill target) and the leftover height it should absorb. Only
     * active when `fill` is on and the content underflows the container; on
     * overflow the leftover is `<= 0` so fill yields nothing (shrink handles it).
     *
     * @param components - The container's child components.
     * @param containerSize - The container's inner size, or null.
     * @param shrinkRatio - The shrink ratio applied to open content.
     * @returns The fill target index (`-1` if none) and the leftover height.
     */
    private computeFill(components: Component[], containerSize: Size | null, shrinkRatio: number): { fillTarget: number; fillLeftover: number } {
        if (!this._fillHeight || !containerSize) {
            return { fillTarget: -1, fillLeftover: 0 };
        }

        let used = 0;
        let displayed = 0;
        let fillTarget = -1;

        for (let i = 0; i < components.length; i++) {
            if (!components[i].isDisplayed()) {
                continue;
            }

            if (displayed > 0) {
                used += this._spacing;
            }

            displayed += 1;
            used += this.effectiveHeaderHeight();

            if (this._openState[i]) {
                used += this.openContentHeight(components[i], shrinkRatio);
                fillTarget = i;
            }
        }

        const leftover = containerSize.height - used;

        return {
            fillTarget,
            fillLeftover: fillTarget !== -1 && leftover > 0 ? leftover : 0,
        };
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
        this._headers[target].getTitleButton().focus();
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
                    this.emit("sectiontoggle", i, false);
                }
            }
        }

        const nowOpen = !wasOpen;

        this.primeWrapper(index);
        this._openState[index] = nowOpen;
        this._headers[index].setExpanded(nowOpen);
        this.emit("sectiontoggle", index, nowOpen);
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
            // + wrapper below it, plus each open section's content height, so all
            // of those transitions need suppressing for the upcoming doLayout
            // writes to land instantly.
            const components = this.getContainer()?.getComponents() ?? [];

            for (let i = 0; i < this._headers.length; i++) {
                this._headers[i].setTransition("none");
                this._panelWrappers[i].setTransition("none");
                components[i]?.setTransition("none");
            }

            DOM.sink.requestAnimationFrame(() => {
                for (let i = 0; i < this._headers.length; i++) {
                    this._headers[i].setTransition(this.buildHeaderTransition());
                    this._panelWrappers[i].setTransition(this.buildWrapperTransition());
                    components[i]?.setTransition(this.buildContentTransition());
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

    /**
     * Builds the `height`-only transition applied to every section's content
     * component so it grows and shrinks in lockstep with its wrapper. The content
     * sits at `top: 0` inside the wrapper, so only its height ever animates.
     * Centralised so `createSection` and `primeWrapper`'s reduced-motion restore
     * path stay in sync.
     */
    private buildContentTransition(): string {
        return `height ${this._animationDuration}ms ${ACCORDION_EASING}`;
    }
}

const AccordionCallable = callable(Accordion);
type AccordionCallable = Accordion;
export {
    Accordion         as _Accordion,
    AccordionCallable as Accordion
};
