// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { AccordionConstraints } from "~/layout/AccordionConstraints.js";
import { COLLAPSE_EASING as ACCORDION_EASING } from "~/layout/CollapseSupport.js";
import { AccordionHeader, THEMED_HEADER_BG, THEMED_HEADER_BORDER, THEMED_HEADER_COLOR } from "~/component/container/AccordionHeader.js";
import { SplitGutter } from "~/component/container/SplitGutter.js";
import { Animation } from "~/core/Animation.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { LayoutSize, LayoutSizeUnit, toLayoutSizes, fromLayoutSizes, isRestorableSizes } from "~/layout/LayoutSizes.js";
import { Size, UNBOUNDED } from "~/primitive/Size.js";
import type { AxisEnd } from "~/primitive/Axis.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import { Util } from "~/core/Util.js";
import { chainRoom, distributeDragChain } from "~/core/DragChain.js";

/**
 * String-literal union of the events emitted by {@link Accordion}.
 *
 * @category Layouts
 */
export type AccordionEvent = "sectiontoggle" | "sectionresize";

/**
 * Header height in pixels used by {@link Accordion} compact mode. Tighter than
 * the default 28px so a stack of sections reads denser; applied only when the
 * consumer has not pinned an explicit header height via `setHeaderHeight`.
 */
const COMPACT_HEADER_HEIGHT: number = 22;

/**
 * Thickness (px) of a resizable-mode drag gutter. It overlays the bottom edge
 * of the upper open section's content and reserves NO layout budget, so the
 * open-content sizing math (`computeShrinkRatio`/`computeFill`/
 * `computeResizableHeights`) is unaffected by whether gutters are shown.
 */
const RESIZE_GUTTER_SIZE: number = 6;

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
 * Callback invoked once a completed resizable-gutter drag settles a
 * section's sizes.
 *
 * @param sizes - The open sections' sizes after the drag, in child order —
 *   the same array {@link Accordion.getSectionSizes} would return.
 *
 * @category Layouts
 */
export type SectionResizeCallback = (sizes: LayoutSize[]) => void;

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
     * Opts into draggable gutters between adjacent open sections, letting the
     * user trade height between them. See {@link Accordion.setResizable}.
     */
    resizable?:         boolean;
    /**
     * Section sizes to restore on the first resizable layout; discarded whole
     * when stale. Only meaningful with `resizable`.
     */
    sectionSizes?:      LayoutSize[];
    /**
     * Multi-event listener bag dispatched to {@link Accordion.on} at
     * construction time.
     */
    listeners?: {
        sectiontoggle?: SectionToggleCallback;
        sectionresize?: SectionResizeCallback;
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
    private _listeners: ListenerBag<AccordionEvent> = this.registerListenerBag(new ListenerBag<AccordionEvent>());
    private _resizable: boolean = false;
    // User-dragged (or fill-seeded) content heights per open section, absolute
    // px summing to the open budget when written. Keyed by Component
    // (reorder-safe, like Split._sizes); pruned each resizable layout for
    // removed components. A closed section keeps its entry frozen for reopen.
    private _resizeSizes: Map<Component, number> = new Map<Component, number>();
    // Sizes to restore on the first resizable layout that can resolve an open
    // budget, taken from the `sectionSizes` option (or a direct
    // `applySectionSizes` call before one is resolvable). Drained once,
    // mirroring `Split._pendingSizes`.
    private _pendingSectionSizes: LayoutSize[] | null = null;
    // The `openBudget / storedTotal` scale factor computeResizableHeights last
    // applied — i.e. `rendered height == _resizeSizes value * _resizeFactor`.
    // Only 1 when the open set's stored sizes already sum to the budget (the
    // common weight/fillHeight-seeded case); otherwise onGutterDrag needs
    // it to convert its rendered-pixel drag math back to _resizeSizes' stored
    // scale — writing rendered values directly would silently rescale the
    // whole open set (including untouched sections) on the next layout.
    // Applies to the weighted sections only; a resize-pinned section renders
    // at scale 1 (see `_resizePinned`).
    private _resizeFactor: number = 1;
    // The open sections `distributeWithinConstraints` last held at their
    // stored px (scale 1) instead of scaling by `_resizeFactor`. Read by
    // `onGutterDrag`, which must divide each dragged section's rendered
    // height by its own stored scale — `_resizeFactor` is no longer one
    // global scalar once a pin is held.
    private _resizePinned: Set<Component> = new Set<Component>();
    // Gutter pool, reused across layouts; one shown per adjacent open-section pair.
    private _resizeGutters: SplitGutter[] = [];
    // Rebuilt each layout: for gutter i, the two content components it resizes.
    private _gutterPairs: Array<{ upper: Component; lower: Component }> = [];
    // Drag state captured on gutter dragstart. The dragged pair (for the
    // reentrancy guard); the pointer coordinate at the previous move (the drag
    // is applied incrementally, frame by frame, so a reversed drag responds
    // closest-section-first); and — so the drag can chain across sections at
    // their min/max — every open section's index plus the dragged gutter's
    // position in that open list.
    private _dragUpper: Component | null = null;
    private _dragLower: Component | null = null;
    private _dragLastPointer: number = 0;
    private _dragOpenIndices: number[] = [];
    private _dragGutterUpperPos: number = 0;
    // Open/close toggle animations currently in flight. Transitions are off by
    // default (so resize and drag relayouts snap); a toggle enables them and the
    // global disable waits until this returns to zero — single-open mode primes
    // several sections at once, and the first to finish must not snap the rest.
    private _toggleAnimations: number = 0;

    // In-flight height transitions, keyed by section index and cancelled on
    // detach so their fallback timers cannot fire against released wrapper
    // element handles. Two channels, because a section can be mid-shrink from a
    // reflow while a toggle animation is separately in flight on the same index.
    private _shrinkAnimations:  Map<number, Animation.CancelHandle> = new Map();
    private _wrapperAnimations: Map<number, Animation.CancelHandle> = new Map();

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

        if (options.resizable !== undefined) {
            this.setResizable(options.resizable);
        }

        if (options.sectionSizes !== undefined) {
            this._pendingSectionSizes = options.sectionSizes.map(size => ({ ...size }));
        }

        if (options.listeners !== undefined) {
            const listeners = options.listeners;

            for (const event of Object.keys(listeners) as Array<keyof typeof listeners>) {
                const listener = listeners[event];

                // A union of two events' callback types no longer narrows to a
                // single `on` overload; the cast mirrors `Component.applyListeners`'
                // own `(this as any).on` — sound for the same reason: `event` and
                // `listener` are still a matched pair from the same options key.
                if (listener !== undefined) {
                    (this as any).on(event, listener);
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

        this.relayoutHost();

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

        this.relayoutHost();

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

        this.relayoutHost();

        return this;
    }

    /**
     * Returns whether fill mode is on.
     *
     * @returns True if open sections grow to absorb the container's leftover height.
     */
    isFillHeight(): boolean {
        return this._fillHeight;
    }

    /**
     * Sets fill mode. When on, every open section grows to absorb the
     * container's leftover height, sharing it in proportion to their
     * `weight` (unweighted sections count equally, so equal weights get
     * equal slices) and each capped at its own max — instead of every open
     * section sitting at its preferred height. Only meaningful when the host
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
     * Returns whether resizable mode is on.
     *
     * @returns True if draggable gutters appear between adjacent open sections.
     */
    isResizable(): boolean {
        return this._resizable;
    }

    /**
     * Sets resizable mode. When on, a draggable gutter appears between every
     * adjacent pair of open sections, letting the user trade height between
     * them; the split starts from the section's usual `weight`/`fillHeight`
     * distribution and is overridden by the drag from then on. No gutter
     * appears with fewer than two open sections, or under {@link setSingleOpen}
     * (which never has more than one section open).
     *
     * @param value - True to enable resizable mode.
     *
     * @returns This layout manager, for chaining.
     */
    setResizable(value: boolean): this {
        this._resizable = value;

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
     * Re-lays-out the host after a change to the accordion's own intrinsic
     * height — an open/close, or a header-metric change (compact, spacing,
     * single-open). `scheduleLayout` alone only re-fits the sections inside the
     * accordion's unchanged bounds; `notifyIntrinsicSizeChanged` additionally
     * tells the ancestors — notably a scrolling host — that the accordion's
     * preferred/min height moved, so they re-lay-out and refresh their
     * scrollbars instead of going stale until the next viewport resize.
     */
    private relayoutHost(): void {
        const container = this.getContainer();

        container?.scheduleLayout();
        container?.notifyIntrinsicSizeChanged();
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
        this.relayoutHost();

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
        this.relayoutHost();

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
     * Resolves each section's persisted unit: `"px"` for a resize-pinned
     * section (effective weight `0`, per {@link effectiveWeight}), `"ratio"`
     * otherwise. `effectiveWeight` is `accordion-resize-weight`'s definition
     * of a resize-pinned section — `weight` unset or `0`, with `fillHeight`
     * off — so this is verbatim the predicate the layout itself pins by.
     *
     * @param components - The container's current content components, in
     *   child order.
     * @returns One unit per section, in the same order.
     */
    private sectionSizeUnits(components: Component[]): LayoutSizeUnit[] {
        return components.map(component => (this.effectiveWeight(component) === 0 ? "px" : "ratio"));
    }

    /**
     * Returns the sections' content sizes in child order, one entry per
     * section (open or closed), for cross-session persistence: a
     * resize-pinned section (effective weight `0`) reports `px`, every other
     * section reports its `ratio` of the space the px sections leave.
     *
     * @remarks Reads `_resizeSizes` raw — never `getHeight()`, never
     * `× _resizeFactor`. A pinned section's stored value is already its px
     * (the pin block holds it at scale 1); `_resizeFactor` is one scalar
     * across the *free* set, so it cancels within that subset and a whole-set
     * read would need it, not a raw one; and a rendered height can be a
     * transient min/max clamp `distributeWithinConstraints` applied for this
     * pass only, which the stored value deliberately never carries forward.
     *
     * @returns One {@link LayoutSize} per section in child order; the
     *   pending `sectionSizes` when one is still undrained; `[]` when
     *   detached or the container has no sections.
     */
    getSectionSizes(): LayoutSize[] {
        const container = this.getContainer();

        if (!container) {
            return [];
        }

        const components = container.getComponents();

        if (components.length === 0) {
            return [];
        }

        const units = this.sectionSizeUnits(components);

        if (this._pendingSectionSizes !== null && isRestorableSizes(this._pendingSectionSizes, units)) {
            return this._pendingSectionSizes.map(size => ({ ...size }));
        }

        return toLayoutSizes(units, components.map(component => this._resizeSizes.get(component) ?? 0));
    }

    /**
     * Restores sizes captured by {@link getSectionSizes}, applied on the next
     * resizable layout that can resolve the open budget (the correct base
     * for a ratio entry). Discarded whole unless every entry's unit matches
     * the live section's weight (see the discard rule on {@link LayoutSize}).
     *
     * @param sizes - The persisted array to restore.
     * @returns This layout manager, for method chaining.
     */
    applySectionSizes(sizes: LayoutSize[]): this {
        // Deferred, not immediate: the correct base is `openBudget`, which only
        // `computeResizableHeights` can resolve. The option and this setter share
        // one drain, one base, and one discard rule.
        this._pendingSectionSizes = sizes.map(size => ({ ...size }));

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Registers a listener for one of this accordion's events.
     *
     * @param event - `"sectiontoggle"` fires whenever a section is opened or
     *   closed, receiving the zero-based section index and whether it is
     *   now open; `"sectionresize"` fires once a completed resizable-gutter
     *   drag settles a section's sizes, receiving the open sections' sizes
     *   in child order.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This accordion, for method chaining.
     */
    on(event: "sectiontoggle", listener: SectionToggleCallback): this;
    on(event: "sectionresize", listener: SectionResizeCallback): this;
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
    protected emit(event: "sectionresize", sizes: LayoutSize[]): void;
    protected emit(event: AccordionEvent,  ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Detaches from the container, moving each section's content element back
     * to the container and disposing every header and panel wrapper — they
     * are raw-appended to the container's element rather than registered as
     * children, so nothing else reaches their teardown.
     */
    detach(): this {
        const container = this.getContainer();

        for (const animation of this._shrinkAnimations.values()) {
            animation.cancel();
        }
        this._shrinkAnimations.clear();

        for (const animation of this._wrapperAnimations.values()) {
            animation.cancel();
        }
        this._wrapperAnimations.clear();

        // Those cancelled animations owned the toggle-cleanup branch, so run its
        // work here: without this a detach mid-toggle leaves the counter above
        // zero and the animated transitions installed, and a re-attached manager
        // would never reach the cleanup branch again.
        if (this._toggleAnimations > 0) {
            this._toggleAnimations = 0;
            this.setSectionTransitions(false);
            container?.setTransition(null);
        }

        // A detach mid-drag would otherwise leak the viewport listeners
        // registered in onGutterDragStart and strand the drag pair. `_dragUpper`
        // is non-null only while a drag is live (set alongside those listeners),
        // so end the drag first — and only then, so we never touch the viewport
        // map when no accordion drag is active.
        if (this._dragUpper) {
            this.onGutterDragEnd();
        }

        for (let i = 0; i < this._headers.length; i++) {
            const components = container ? container.getComponents() : [];
            const component = components[i];

            if (component && container) {
                DOM.sink.appendChild(container.getElement()!, component.getElement()!);
            }

            // Tools belong to the caller, not to this manager, and reach a
            // header from two places: `addTool` registers a global tool on
            // every header it is revealed on, and `createSection` registers
            // each `AccordionConstraints.tools` entry on its own header. Both
            // become children of the header's tool group, so both must be
            // released before the header is disposed — otherwise its dispose
            // recursion destroys a component the caller still holds and may
            // re-add elsewhere. This is the same protection the content
            // children get by being reparented above.
            const sectionTools = component
                ? ((this.getLayoutConstraints(component) as AccordionConstraints | undefined)?.tools ?? [])
                : [];

            for (const tool of [...this._tools, ...sectionTools]) {
                this._headers[i].removeTool(tool);
            }

            this._headers[i].dispose();
            this._panelWrappers[i].dispose();
        }

        this._headers = [];
        this._panelWrappers = [];
        this._openState = [];

        for (const gutter of this._resizeGutters) {
            DOM.sink.removeElement(gutter.getElement()!);
            gutter.dispose();
        }

        this._resizeGutters = [];
        this._resizeSizes.clear();
        this._gutterPairs = [];

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

        const perimeterSize = container.getPerimeterSize();
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

        const perimeterSize = container.getPerimeterSize();
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
     * The accordion's maximum size: deliberately unbounded on both axes. A
     * height-animated vertical stack whose open/closed section state and
     * in-flight animation make any static height ceiling meaningless — there is
     * no stable maximum to report. Returning unbounded directly is the honest
     * answer, and keeps the `min ≤ preferred ≤ max` invariant trivially
     * satisfied against the finite min/preferred reports above.
     *
     * @returns `{ width: UNBOUNDED, height: UNBOUNDED }`.
     */
    getMaxSize(): Size | null {
        return { width: UNBOUNDED, height: UNBOUNDED };
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

        // Transitions are off by default so resize and drag relayouts snap;
        // `primeWrapper` turns the header's `top` transition on only for the
        // duration of an open/close toggle (headers below a toggled section
        // slide with the panel height instead of snapping to their final spot).
        header.setTransition("none");

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

        // Off by default (relayouts snap); `primeWrapper` enables it for a
        // toggle. `height` animates this wrapper's own grow/shrink; `top`
        // animates wrappers below a toggled section so they slide with the
        // headers instead of jumping.
        wrapper.setTransition("none");

        DOM.sink.appendChild(container.getElement()!, header.getElement(true)!);
        DOM.sink.appendChild(container.getElement()!, wrapper.getElement(true)!);

        // Reparent content element into wrapper so overflow:hidden clips it during animation.
        DOM.sink.appendChild(wrapper.getElement()!, component.getElement()!);

        // Off by default (relayouts snap); `primeWrapper` enables it for a
        // toggle so the content animates its own height in lockstep with the
        // wrapper. Without it, an open section that must *shrink* during a toggle
        // — e.g. a fill-mode sibling giving back its leftover height when a lower
        // section opens — would snap to its final height while only the wrapper's
        // `overflow: hidden` clip animates, reading as the panel above jumping.
        component.setTransition("none");

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
     * Writes one section's header, wrapper, and content geometry and returns the
     * vertical cursor after it (the wrapper's bottom edge). Shared by
     * {@link doLayout}'s main loop and the lightweight drag path so their
     * geometry can never drift. Does not reflow the content — the caller decides
     * between an immediate and a shrink-deferred `component.doLayout()`.
     *
     * @param index - Section index into `_headers` / `_panelWrappers`.
     * @param component - The section's content component.
     * @param top - The header's top edge.
     * @param panelHeight - The wrapper height (0 for a closed section).
     * @param contentHeight - The content height (preferred height for a closed section).
     * @param width - The header/wrapper/content width.
     * @param left - The header/wrapper left edge.
     * @returns The vertical cursor after this section (its wrapper's bottom edge).
     */
    private placeSection(index: number, component: Component, top: number, panelHeight: number, contentHeight: number, width: number, left: number): number {
        const header = this._headers[index];
        const wrapper = this._panelWrappers[index];
        const headerHeight = this.effectiveHeaderHeight();

        header.setX(left);
        header.setY(top);
        header.setWidth(width);
        header.setHeight(headerHeight);
        header.doLayout();

        const wrapperTop = top + headerHeight;

        wrapper.setX(left);
        wrapper.setY(wrapperTop);
        wrapper.setWidth(width);
        wrapper.setHeight(panelHeight);

        component.setX(0);
        component.setY(0);
        component.setWidth(width);
        component.setHeight(contentHeight);

        return wrapperTop + panelHeight;
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

        // Nothing to build until the container has an element: `createSection`
        // below appends each header and wrapper straight onto it, so a premature
        // pass would dereference a null element. Such a pass is normal — see
        // `HBox.doLayout` — so return and let the next pass build the sections.
        if (!container.getElement()) {
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

        // Fill: open sections grow to absorb the container's leftover height
        // (underflow) — split across the sections by weight, with
        // setFillHeight opting every open section in at an equal default weight.
        // The counterpart to shrink: when the content
        // overflows, shrinkRatio > 0 and the leftover is <= 0, so the fill map is
        // empty and the two policies never both apply.
        const fills = this.computeFill(components, containerSize, shrinkRatio);

        // Resizable mode: open sections' content heights come from the
        // drag-backed distribution instead of `openContentHeight + fill`.
        // `null` when inactive (off, no size yet, or nothing open), in which
        // case the loop below falls back to the legacy formula unchanged.
        const resizeHeights = this.computeResizableHeights(components, containerSize, shrinkRatio, fills);

        this.layoutSections(
            components,
            containerWidth,
            insets.getLeft(),
            insets.getTop(),
            resizeHeights !== null,
            (i, isOpen): number => {
                // Open sections take the drag-backed resizable height, or fall
                // back to the preferred height shrunk toward min plus this
                // section's fill share. Closed sections keep their content at
                // preferred height so the wrapper's `overflow: hidden` clips it
                // during the close animation rather than collapsing instantly.
                if (isOpen) {
                    return resizeHeights?.get(i) ?? (this.openContentHeight(components[i], shrinkRatio) + (fills.get(i) ?? 0));
                }

                const preferred = components[i].getPreferredSize();

                // 100px fallback when a closed section reports no preferred size.
                return preferred ? preferred.height : 100;
            },
            true,
            true,
        );
    }

    /**
     * Places every displayed section's header, wrapper, and content top to
     * bottom, plus a resizable gutter between each adjacent open pair. Shared by
     * {@link doLayout} (the full pass) and {@link onGutterDrag} (the chained
     * live resize) so both writers produce identical geometry.
     *
     * @param components - The container's content components, section-ordered.
     * @param containerWidth - The width given to every header and wrapper.
     * @param left - The header/wrapper left edge (container inset).
     * @param top - The first displayed section's top edge (container inset).
     * @param resizable - Whether to place drag gutters between open pairs.
     * @param contentHeightFor - The content height for section `i`; `isOpen`
     *   selects an open section's live height versus a closed one's preferred
     *   (clipped) height.
     * @param animateShrink - Whether a section that shrinks defers its content
     *   reflow to the height transition (a toggle) instead of reflowing at once
     *   (a drag, where transitions are off).
     * @param reflowAll - Whether to reflow every section's content, or only the
     *   sections whose height actually changed (the drag's cheap path).
     */
    private layoutSections(components: Component[], containerWidth: number, left: number, top: number, resizable: boolean, contentHeightFor: (index: number, isOpen: boolean) => number, animateShrink: boolean, reflowAll: boolean): void {
        let y = top;
        let displayedSoFar = 0;

        // A gutter is placed between each consecutive pair of open sections,
        // overlaying the upper section's content bottom. `previousOpen*`
        // persists across closed sections, so a closed section between two open
        // ones does not get its own gutter — the handle stays at the upper open
        // section's content bottom.
        let previousOpenComponent: Component | null = null;
        let previousOpenBottom = 0;
        let placedGutterCount = 0;

        for (let i = 0; i < components.length; i++) {
            const component = components[i];
            const header = this._headers[i];
            const wrapper = this._panelWrappers[i];
            const isOpen = this._openState[i];

            // A non-displayed section drops out of the stack entirely: hide its
            // header and wrapper and don't advance the cursor, so the sections
            // below slide up to reclaim the space.
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

            const contentHeight = contentHeightFor(i, isOpen);
            const panelHeight = isOpen ? contentHeight : 0;

            if (isOpen && resizable && previousOpenComponent !== null) {
                this.placeGutter(placedGutterCount, previousOpenBottom, containerWidth, left);
                this._gutterPairs[placedGutterCount] = { upper: previousOpenComponent, lower: component };
                placedGutterCount += 1;
            }

            // A shrinking open section keeps its interior laid out at the current
            // (larger) height for the duration of the shrink — the wrapper's
            // overflow:hidden clip covers it — and reflows to the smaller height
            // only once the height transition ends, so a height-driven interior
            // (a Tree/Table scroll viewport) doesn't snap mid-animation. Growing,
            // closing, and reduced motion take the immediate path. Read the old
            // height before placeSection overwrites it.
            const oldHeight = component.getHeight();
            const shrinking = isOpen && animateShrink && !Animation.isReducedMotion() && contentHeight < oldHeight;

            const cursor = this.placeSection(i, component, y, panelHeight, contentHeight, containerWidth, left);

            if (reflowAll || contentHeight !== oldHeight) {
                if (shrinking) {
                    this._shrinkAnimations.get(i)?.cancel();
                    this._shrinkAnimations.set(i, Animation.afterTransition({
                        component:        wrapper,
                        property:         "height",
                        durationMs:       this._animationDuration,
                        fallbackBufferMs: 40,
                        onComplete:       () => {
                            this._shrinkAnimations.delete(i);
                            component.doLayout();
                        },
                    }));
                } else {
                    component.doLayout();
                }
            }

            if (isOpen && resizable) {
                previousOpenComponent = component;
                previousOpenBottom = cursor;
            }

            y = cursor;
        }

        // Gutters not placed this pass (resizable off, or a pair whose upper
        // section closed/dropped out) sit hidden in the pool for reuse.
        this._gutterPairs.length = placedGutterCount;

        for (let i = placedGutterCount; i < this._resizeGutters.length; i++) {
            this._resizeGutters[i].setVisible(false);
        }
    }

    /**
     * Returns the pooled resizable-mode gutter at `index`, creating and
     * appending it to the container's DOM on first use. Mirrors the lazy
     * gutter creation in `Split.doLayout`.
     *
     * The gutter's `top` transition is off by default so drags and resizes
     * snap; `primeWrapper` turns it on only for the duration of an open/close
     * toggle, so the boundary handle slides with the sections it sits between
     * during the animation but tracks the cursor instantly during a drag.
     *
     * @param index - The gutter's position in the pool (and in `_gutterPairs`).
     * @returns The gutter for this index.
     */
    private getOrCreateResizeGutter(index: number): SplitGutter {
        const existing = this._resizeGutters[index];

        if (existing) {
            return existing;
        }

        const container = this.getContainer()!;
        const gutter = new SplitGutter("vertical", { collapsible: false, expandedBackground: "transparent" });

        gutter.setTransition("none");
        gutter.on("dragstart", (position: number) => this.onGutterDragStart(index, position));
        gutter.on("drag", (position: number) => this.onGutterDrag(index, position));
        gutter.on("dragend", () => this.onGutterDragEnd());

        DOM.sink.appendChild(container.getElement()!, gutter.getElement(true)!);

        this._resizeGutters.push(gutter);

        return gutter;
    }

    /**
     * Positions and shows the pooled gutter at `index`, overlaying the upper
     * section's content bottom edge. Shared by {@link doLayout} and the
     * lightweight drag path; `_gutterPairs` bookkeeping stays with the caller.
     *
     * @param index - The gutter's pool index.
     * @param upperBottom - The upper section's content bottom edge.
     * @param width - The gutter width.
     * @param left - The gutter left edge.
     */
    private placeGutter(index: number, upperBottom: number, width: number, left: number): void {
        const gutter = this.getOrCreateResizeGutter(index);

        gutter.setX(left);
        gutter.setY(upperBottom - RESIZE_GUTTER_SIZE);
        gutter.setWidth(width);
        gutter.setHeight(RESIZE_GUTTER_SIZE);
        gutter.setVisible(true);
    }

    /**
     * Captures the drag origin when a resizable gutter's drag begins: the
     * absolute pointer coordinate and the current heights of the two adjacent
     * open sections. Mirrors {@link Split.onDragStart}. Transitions are already
     * off outside a toggle, so each {@link onGutterDrag} write lands instantly
     * without any per-drag suppression.
     *
     * @param gutterIndex - The dragged gutter's position in `_gutterPairs`.
     * @param position - The absolute pointer coordinate (`clientY`) at drag start.
     */
    private onGutterDragStart(gutterIndex: number, position: number): void {
        const pair = this._gutterPairs[gutterIndex];

        if (!pair) {
            return;
        }

        const components = this.getContainer()?.getComponents() ?? [];

        // Snapshot the open sections' indices so the drag can chain growth
        // outward from the gutter across sections already at their max.
        this._dragOpenIndices = [];

        for (let i = 0; i < components.length; i++) {
            if (components[i].isDisplayed() && this._openState[i]) {
                this._dragOpenIndices.push(i);
            }
        }

        this._dragGutterUpperPos = this._dragOpenIndices.indexOf(components.indexOf(pair.upper));

        if (this._dragGutterUpperPos === -1) {
            return;
        }

        this._dragUpper = pair.upper;
        this._dragLower = pair.lower;
        this._dragLastPointer = position;
    }

    /**
     * Resizes the open sections when a resizable gutter is dragged. The gutter
     * splits the open set into an upper group (the upper section and everything
     * above it) and a lower group (the lower section and below); dragging down
     * grows the upper group and shrinks the lower one, dragging up does the
     * reverse. **Both sides chain outward** from the gutter: the nearest section
     * absorbs the travel first, spilling to the next once it reaches its max
     * (on the growing side) or its min (on the shrinking side). So dragging
     * toward — or away from — a panel that sits against a maxed or minned
     * neighbour keeps resizing it, growing/shrinking the first free panel beyond
     * the pinned one (which merely slides) rather than stalling at the boundary.
     *
     * The open set's combined height is conserved, so this re-places every
     * displayed section through the shared {@link layoutSections} (no
     * `getPreferredSize`, reflowing only the sections whose height changed) so
     * the handle tracks the cursor. Each open section's drag-backed size is
     * written to `_resizeSizes` (in pre-factor stored units, see `_resizeFactor`)
     * so the next full layout reproduces the distribution.
     *
     * @param gutterIndex - The dragged gutter's position in `_gutterPairs`.
     * @param position - The absolute pointer coordinate (`clientY`) for this move.
     */
    private onGutterDrag(gutterIndex: number, position: number): void {
        const pair = this._gutterPairs[gutterIndex];
        const container = this.getContainer();

        if (!pair || pair.upper !== this._dragUpper || pair.lower !== this._dragLower || !container) {
            return;
        }

        const components = container.getComponents();
        const openIndices = this._dragOpenIndices;
        const upperPos = this._dragGutterUpperPos;

        // Applied incrementally: this frame's pointer travel is distributed on
        // top of the live heights, so a reversed drag responds nearest-first.
        // `_dragLastPointer` is advanced below by only the travel actually applied,
        // not the raw pointer position — see the note next to `delta`.
        const frameDelta = position - this._dragLastPointer;

        // Snapshot each open section's live height and bounds once — `getMinSize`
        // / `getMaxSize` recurse through the content's own layout, so reading them
        // per pointer move (not per lookup) keeps the drag cheap.
        const current = openIndices.map((ci): number => components[ci].getHeight());
        const mins = openIndices.map((ci): number => {
            const min = components[ci].getMinSize();

            return min ? min.height : 0;
        });
        const maxs = openIndices.map((ci): number => {
            const max = components[ci].getMaxSize();

            return max ? max.height : Number.POSITIVE_INFINITY;
        });

        // The two chains fanning out from the gutter, each ordered nearest-first.
        const upperGroup: number[] = [];
        const lowerGroup: number[] = [];

        for (let pos = upperPos; pos >= 0; pos--) {
            upperGroup.push(pos);
        }

        for (let pos = upperPos + 1; pos < openIndices.length; pos++) {
            lowerGroup.push(pos);
        }

        // Dragging down grows the upper group and shrinks the lower one; up reverses it.
        const growGroup   = frameDelta >= 0 ? upperGroup : lowerGroup;
        const shrinkGroup = frameDelta >= 0 ? lowerGroup : upperGroup;

        const growRoom = chainRoom(growGroup, current, 1, mins, maxs);
        const shrinkRoom = chainRoom(shrinkGroup, current, -1, mins, maxs);

        // This frame's boundary travel, capped by how much the growth chain can
        // still absorb and the shrink chain can still give up.
        const delta = Math.max(0, Math.min(Math.abs(frameDelta), growRoom, shrinkRoom));

        // Advance the tracked pointer only by the travel actually applied. When the
        // chain is fully maxed/minned, `delta` is 0 and the pointer stays put, so
        // dragging further past the limit accrues a dead zone the pointer must
        // retrace before the gutter moves again — keeping the cursor glued to the
        // handle on reversal instead of the handle jumping to a far-off cursor.
        // (Split/Border get this for free from their absolute origin+offset model.)
        this._dragLastPointer += Math.sign(frameDelta) * delta;

        const newHeights = current.slice();

        distributeDragChain(growGroup, current, delta, +1, mins, maxs, newHeights);
        distributeDragChain(shrinkGroup, current, delta, -1, mins, maxs, newHeights);

        const openHeightByIndex = new Map<number, number>();

        for (let pos = 0; pos < openIndices.length; pos++) {
            const component = components[openIndices[pos]];
            // A pinned section renders at its stored px (scale 1); every other open
            // section renders at stored × _resizeFactor. Dividing by the wrong one
            // silently rescales the whole open set on the next layout.
            const scale = this._resizePinned.has(component) ? 1 : this._resizeFactor;

            openHeightByIndex.set(openIndices[pos], newHeights[pos]);
            this._resizeSizes.set(component, newHeights[pos] / scale);
        }

        const insets = container.getContentInsets();
        const width = this._panelWrappers[openIndices[0]].getWidth();

        this.layoutSections(
            components,
            width,
            insets.getLeft(),
            insets.getTop(),
            true,
            (i, isOpen): number => (isOpen ? (openHeightByIndex.get(i) ?? components[i].getHeight()) : components[i].getHeight()),
            false,
            false,
        );
    }

    /**
     * Ends a resizable-gutter drag: removes the viewport listeners and clears
     * the captured drag pair. Transitions stay off (their default outside a
     * toggle), so there is nothing to restore. Fires `sectionresize` with the
     * post-drag sizes when a drag was actually live — including on the
     * `detach()` mid-drag path, which calls this before `_resizeSizes` is
     * cleared, so the emitted sizes still reflect the drag. Also callable
     * directly (with no argument) so `detach()` and tests can simulate a
     * drag end.
     *
     * @returns `true`, consuming the release that ends the gutter drag.
     */
    private onGutterDragEnd(): Event.ListenerResult {
        const wasDragging = this._dragUpper !== null;

        this._dragUpper = null;
        this._dragLower = null;

        if (wasDragging) {
            this.emit("sectionresize", this.getSectionSizes());
        }

        return true;
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
     * shrunk toward its minimum by `shrinkRatio`, then clamped to its merged
     * `[min, max]`. Falls back to 100px when the section reports no preferred
     * height.
     *
     * The clamp matters because `getPreferredSize` clamps only to a component's
     * *own* min/max constraints, not the merged {@link Component.getMinSize} /
     * {@link Component.getMaxSize} that fold in child-derived limits (e.g. a
     * Panel wrapping a fixed-row List, or a form whose fields floor its height).
     * Without it, a section whose preferred sits outside its real `[min, max]`
     * would render its wrapper past that bound while the content self-clamped
     * inside — and the drag-backed resizable path (which does respect the merged
     * bounds) then disagreed, making a resizable toggle resize the section.
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

        const shrunk = contentPref - shrinkRatio * (contentPref - contentMin);
        const max = component.getMaxSize();
        const capped = max ? Math.min(shrunk, max.height) : shrunk;

        return Math.max(capped, contentMin);
    }

    /**
     * Computes how much extra height each open section absorbs from the
     * container's leftover space, keyed by section index. Active only when the
     * open sections underflow the container (`leftover > 0`); on overflow the
     * leftover is `<= 0` so fill yields nothing and shrink handles the fit.
     *
     * Each open section's effective fill weight is its explicit `weight`
     * constraint, or — when {@link setFillHeight} is on — a default of `1` so
     * every unweighted open section shares the slack equally. The leftover is
     * then split across all sections with a positive effective weight in
     * proportion to those weights, each capped at its own max (a capped
     * section's surplus is re-shared among the rest; see
     * {@link distributeFillWithinMax}). So `setFillHeight` spreads the slack
     * across every open section (equal weights → equal slices) rather than
     * padding a single one, and per-section `weight` still targets or biases
     * specific sections. With neither, nothing fills and the slack stays as
     * trailing space.
     *
     * @param components - The container's child components.
     * @param containerSize - The container's inner size, or null.
     * @param shrinkRatio - The shrink ratio applied to open content.
     * @returns A map from section index to the extra height it absorbs; empty
     *   when nothing fills.
     */
    private computeFill(components: Component[], containerSize: Size | null, shrinkRatio: number): Map<number, number> {
        const fills = new Map<number, number>();

        if (!containerSize) {
            return fills;
        }

        let used = 0;
        let displayed = 0;
        const recipients: Array<{ index: number; weight: number; headroom: number }> = [];
        let weightTotal = 0;

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
                const contentHeight = this.openContentHeight(components[i], shrinkRatio);
                used += contentHeight;

                const weight = this.effectiveWeight(components[i]);

                if (weight > 0) {
                    recipients.push({ index: i, weight, headroom: this.fillHeadroom(components[i], contentHeight) });
                    weightTotal += weight;
                }
            }
        }

        const leftover = containerSize.height - used;

        if (leftover <= 0 || weightTotal <= 0) {
            return fills;
        }

        // Split the slack across the recipients by weight, each capped at its own
        // max so an open section is never padded past its maximum height; a
        // capped section's surplus is re-shared among the rest.
        return this.distributeFillWithinMax(recipients, leftover);
    }

    /**
     * Resolves an open section's effective weight — its explicit `weight`
     * constraint, or a default of `1` when {@link setFillHeight} is on so every
     * unweighted open section counts equally. `0` means unweighted: the section
     * takes no share of the container's leftover height, and in resizable mode it
     * holds its px across a container resize instead of rescaling with the rest.
     *
     * Reads the constraint as `?? 0`, matching the box managers — unlike `Split`,
     * where an unset weight falls through to a proportional fallback.
     *
     * @param component - The open section's content component.
     * @returns The effective weight; `0` when the section is unweighted.
     */
    private effectiveWeight(component: Component): number {
        const explicit = this.getLayoutConstraints(component)?.weight ?? 0;

        return explicit > 0 ? explicit : (this._fillHeight ? 1 : 0);
    }

    /**
     * The open sections that hold their stored px across a container resize —
     * those with an effective weight of `0`, so only the weighted sections absorb
     * the change. Returns empty (so the whole open set rescales proportionally, as
     * it always has) in the two cases where pinning cannot apply: no open section
     * is weighted, so there is nothing to absorb the change; or the pins alone
     * overrun the budget, where a pin must yield because geometry has to fill the
     * container — mirroring `Split.setPaneResizeWeight`'s contract that a pin holds
     * only while the container is large enough.
     *
     * @param components - The container's content components, section-ordered.
     * @param openIndices - Indices of the open sections.
     * @param openBudget - The height available to the open sections' content.
     * @returns The pinned sections' indices, or an empty array.
     */
    private resizePinnedSections(components: Component[], openIndices: number[], openBudget: number): number[] {
        const pinned: number[] = [];
        let flexible = 0;
        let pinnedTotal = 0;

        for (const i of openIndices) {
            if (this.effectiveWeight(components[i]) > 0) {
                flexible += 1;
            } else {
                pinned.push(i);
                pinnedTotal += this.clampSectionHeight(components[i], this._resizeSizes.get(components[i]) ?? 0);
            }
        }

        if (flexible === 0 || pinnedTotal > openBudget) {
            return [];
        }

        return pinned;
    }

    /**
     * Clamps a candidate content height to a section's `[min, max]`, so a pin is
     * held within the same bounds the proportional pass enforces.
     *
     * @param component - The open section's content component.
     * @param value - The candidate content height in px.
     * @returns The clamped content height.
     */
    private clampSectionHeight(component: Component, value: number): number {
        const min = component.getMinSize();
        const max = component.getMaxSize();

        return Util.clamp(value, min ? min.height : 0, max ? max.height : Number.POSITIVE_INFINITY);
    }

    /**
     * How much fill a section can still absorb before reaching its maximum
     * height — the gap between its max and the content height it already takes
     * without any fill. Unbounded when the section declares no max.
     *
     * @param component - The open section's content component.
     * @param contentHeight - The section's fill-free content height.
     * @returns The absorbable headroom in pixels, or `Infinity` when unbounded.
     */
    private fillHeadroom(component: Component, contentHeight: number): number {
        const max = component.getMaxSize();

        return max ? Math.max(0, max.height - contentHeight) : Number.POSITIVE_INFINITY;
    }

    /**
     * Splits `leftover` fill across the weighted recipients in proportion to
     * their weights, capping each at its remaining headroom (`max − content`)
     * and re-sharing a capped recipient's surplus among the rest. Mirrors
     * {@link distributeWithinConstraints} for the fill path so a weighted
     * section is never padded past its max; any surplus the remaining
     * recipients cannot absorb stays as slack.
     *
     * @param recipients - The weighted open sections: index, weight, headroom.
     * @param leftover - The container's leftover height to distribute.
     * @returns A map from section index to the extra height it absorbs.
     */
    private distributeFillWithinMax(recipients: Array<{ index: number; weight: number; headroom: number }>, leftover: number): Map<number, number> {
        const fills = new Map<number, number>();
        const free = new Set(recipients);
        let remaining = leftover;

        for (;;) {
            let freeWeight = 0;

            for (const r of free) {
                freeWeight += r.weight;
            }

            if (freeWeight <= 0) {
                break;
            }

            const perWeight = remaining / freeWeight;
            let capped = false;

            for (const r of free) {
                if (r.weight * perWeight > r.headroom) {
                    fills.set(r.index, r.headroom);
                    remaining -= r.headroom;
                    free.delete(r);
                    capped = true;

                    break;
                }
            }

            if (!capped) {
                for (const r of free) {
                    fills.set(r.index, r.weight * perWeight);
                }

                break;
            }

            if (free.size === 0) {
                break;
            }
        }

        return fills;
    }

    /**
     * Computes each open section's content height in resizable mode, keyed by
     * container index. Supersedes the `openContentHeight + fill` path when
     * active: a section with no stored size yet is seeded from what that
     * legacy path would have given it (so turning resizable on is visually
     * seamless), then every open section's stored size is rescaled by
     * `openBudget / storedTotal` so the set always fills the container without
     * rewriting the stored ratio — a drag ({@link onGutterDrag}) is the only
     * thing that changes the ratio itself. Also prunes `_resizeSizes` entries
     * for components no longer in `components`.
     *
     * @param components - The container's content components, section-ordered.
     * @param containerSize - The container's inner size; `null` short-circuits
     *   to `null` (caller falls back to the legacy path).
     * @param shrinkRatio - The container-driven shrink ratio, used only to seed
     *   a not-yet-stored section from the legacy formula.
     * @param fills - The legacy fill map, used only to seed a not-yet-stored
     *   section from the legacy formula.
     * @returns A map from container index to content height for every open
     *   section, or `null` when resizable mode is inactive, there is no
     *   container size, or no section is open (the caller keeps the legacy
     *   `openContentHeight + fill` path in all three cases).
     */
    private computeResizableHeights(components: Component[], containerSize: Size | null, shrinkRatio: number, fills: Map<number, number>): Map<number, number> | null {
        if (!this._resizable || !containerSize) {
            return null;
        }

        for (const stored of [...this._resizeSizes.keys()]) {
            if (!components.includes(stored)) {
                this._resizeSizes.delete(stored);
            }
        }

        let headerTotal = 0;
        let displayedSoFar = 0;
        const openIndices: number[] = [];

        for (let i = 0; i < components.length; i++) {
            if (!components[i].isDisplayed()) {
                continue;
            }

            if (displayedSoFar > 0) {
                headerTotal += this._spacing;
            }

            displayedSoFar += 1;
            headerTotal += this.effectiveHeaderHeight();

            if (this._openState[i]) {
                openIndices.push(i);
            }
        }

        if (openIndices.length === 0) {
            return null;
        }

        const openBudget = containerSize.height - headerTotal;

        this.applyPendingSectionSizes(components, openBudget);

        for (const i of openIndices) {
            const component = components[i];

            if (!this._resizeSizes.has(component)) {
                this._resizeSizes.set(component, this.openContentHeight(component, shrinkRatio) + (fills.get(i) ?? 0));
            }
        }

        return this.distributeWithinConstraints(components, openIndices, openBudget);
    }

    /**
     * Drains the `sectionSizes` option (or a pre-layout
     * {@link applySectionSizes} call) into `_resizeSizes` on the first
     * resizable layout that can resolve an open budget. Runs once: cleared
     * unconditionally so a stale array is not retried on every later layout.
     *
     * @param components - The container's content components, section-ordered.
     * @param openBudget - The height available to the open sections' content,
     *   the base {@link fromLayoutSizes} seeds the ratio entries against.
     */
    private applyPendingSectionSizes(components: Component[], openBudget: number): void {
        const pending = this._pendingSectionSizes;

        if (pending === null) {
            return;
        }

        this._pendingSectionSizes = null;

        const units = this.sectionSizeUnits(components);

        if (!isRestorableSizes(pending, units)) {
            return;
        }

        const stored = fromLayoutSizes(pending, openBudget);

        for (let idx = 0; idx < components.length; idx += 1) {
            // A zero-size section is *removed* rather than stored as 0, so it falls
            // back to the legacy `openContentHeight + fill` seed below instead of
            // taking a zero share of the budget.
            if (stored[idx] > 0) {
                this._resizeSizes.set(components[idx], stored[idx]);
            } else {
                this._resizeSizes.delete(components[idx]);
            }
        }
    }

    /**
     * Splits `openBudget` across the open sections in proportion to their
     * stored sizes, clamped to each section's `[min, max]` height. An unweighted
     * open section (effective weight `0`) is first held at its stored px and
     * removed from the budget, so only the weighted sections absorb a container
     * resize; the split falls back to rescaling the whole set when no section is
     * weighted or the pins overrun the budget. A section
     * whose proportional share would fall outside its bounds is pinned at the
     * violated bound and removed from the budget; the remaining sections then
     * re-share what is left, iterating until every free section fits. This
     * keeps the open heights summing to `openBudget` — so the stack neither
     * overflows the container (a min floor pushing content past the box) nor
     * leaves it under-filled — while never stretching a section past its max
     * or compressing it below its min. It generalises {@link onGutterDrag}'s
     * per-pair `[min, max]` clamp to the whole open set, so a full layout and a
     * drag agree on the constraints (a section rendered past its max otherwise
     * snapped down the instant its gutter was grabbed).
     *
     * When the constraints make an exact fill impossible — the mins already
     * exceed the budget, or the maxes cannot reach it — the pinned sizes stand:
     * the stack over- or under-fills, which the host clips/scrolls or leaves as
     * slack, matching the `getMinSize` contract.
     *
     * Also caches {@link _resizeFactor} — the stored→rendered scale of the
     * *unpinned* sections, which is the mapping a drag moves within.
     *
     * @param components - The container's content components, section-ordered.
     * @param openIndices - Indices of the open sections to distribute across.
     * @param openBudget - The height available to the open sections' content.
     * @returns A map from section index to its clamped content height.
     */
    private distributeWithinConstraints(components: Component[], openIndices: number[], openBudget: number): Map<number, number> {
        const heights = new Map<number, number>();
        const free = new Set<number>(openIndices);
        let remaining = openBudget;
        let freeFactor = 1;

        // Resize-pinned sections hold their stored px and leave the budget before the
        // proportional pass, so only the weighted sections absorb a container resize.
        // Empty unless the open set is mixed (some weighted, some not) — with no
        // weighted section the whole set rescales proportionally, exactly as before.
        this._resizePinned.clear();

        for (const i of this.resizePinnedSections(components, openIndices, openBudget)) {
            const height = this.clampSectionHeight(components[i], this._resizeSizes.get(components[i]) ?? 0);

            heights.set(i, height);
            remaining -= height;
            free.delete(i);
            this._resizePinned.add(components[i]);
        }

        // At most one section is pinned per pass, so this settles in at most
        // `openIndices.length` passes.
        for (;;) {
            let freeStored = 0;

            for (const i of free) {
                freeStored += this._resizeSizes.get(components[i]) ?? 0;
            }

            freeFactor = freeStored > 0 ? remaining / freeStored : 0;
            let pinned = false;

            for (const i of free) {
                const component = components[i];
                const share = (this._resizeSizes.get(component) ?? 0) * freeFactor;
                const min = component.getMinSize();
                const max = component.getMaxSize();
                const lo = min ? min.height : 0;
                const hi = max ? max.height : Number.POSITIVE_INFINITY;

                if (share < lo) {
                    heights.set(i, lo);
                    remaining -= lo;
                    free.delete(i);
                    pinned = true;

                    break;
                }

                if (share > hi) {
                    heights.set(i, hi);
                    remaining -= hi;
                    free.delete(i);
                    pinned = true;

                    break;
                }
            }

            if (!pinned) {
                for (const i of free) {
                    heights.set(i, (this._resizeSizes.get(components[i]) ?? 0) * freeFactor);
                }

                break;
            }

            if (free.size === 0) {
                break;
            }
        }

        // Cached for onGutterDrag, which converts its rendered-pixel drag math
        // back to the stored scale before writing into `_resizeSizes`.
        this._resizeFactor = freeFactor > 0 ? freeFactor : 1;

        return heights;
    }

    /**
     * Handles ArrowDown, ArrowUp, Home, and End to move keyboard focus between headers.
     *
     * @param e - The keyboard event fired on a header.
     * @param index - Zero-based index of the header that received the event.
     */
    private onHeaderKeyDown(e: KeyboardEvent, index: number): Event.ListenerResult {
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

        this._headers[target].getTitleButton().focus();

        return { prevent: true };
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
        this.relayoutHost();
    }

    /**
     * Pre-promotes the panel wrapper to its own compositor layer for the
     * duration of the active toggle so the first transition frame doesn't
     * pay a layer-creation cost, then schedules the layer's release on
     * `transitionend` (filtered to `height`) with a `setTimeout` fallback
     * for the cases where `transitionend` never fires — toggling a section
     * whose height didn't change, tab-switch mid-transition, …
     *
     * Transitions are off by default (so resize and drag relayouts snap), so a
     * toggle must turn them on before its `doLayout` writes land and off again
     * when the animation completes. Enabling covers every header, panel wrapper,
     * content component, and gutter (a toggle moves the wrapper's height, the
     * `top` of every header + wrapper below it, and each open section's content
     * height). The global disable is gated on the `_toggleAnimations` counter:
     * single-open mode primes several sections in one gesture, so the first
     * animation to finish must not snap the others still in flight — only the
     * last (`_toggleAnimations` back to zero) turns transitions off.
     *
     * Under `prefers-reduced-motion: reduce` transitions stay off (their
     * default) and nothing is enabled, so the toggle's writes land instantly.
     *
     * Mirrors the `transitionend`-with-fallback pattern in
     * [`Animation.play`](/api/core/namespaces/Animation/functions/play) so
     * the bookkeeping stays in one shape across the framework.
     *
     * @param index - Zero-based index of the section whose wrapper to prime.
     */
    private primeWrapper(index: number): void {
        // Reduced motion leaves transitions off (their default), so the toggle's
        // doLayout writes land instantly — there is nothing to prime.
        if (Animation.isReducedMotion()) {
            return;
        }

        const wrapper = this._panelWrappers[index];
        const container = this.getContainer();

        this.setSectionTransitions(true);

        // Give the container's own height the same transition so the outer
        // layout's resize (triggered when the parent re-queries our
        // `getPreferredSize` after the open state flips) animates in lockstep
        // with the wrappers and headers inside. Without this, the container
        // (which defaults to `overflow: hidden`) snaps to the closed size and
        // clips the still-animating sections — they vanish for ~75% of the
        // duration and pop back in near the end. Cleared on cleanup so
        // unrelated height changes (window resize, etc.) stay instant.
        container?.setTransition(`height ${this._animationDuration}ms ${ACCORDION_EASING}`);

        wrapper.setWillChange("height");

        // Commit the just-enabled transitions as the animation's "before" frame
        // *before* the toggle's geometry change lands. That change can run
        // synchronously in this same task (relayoutHost -> notifyIntrinsicSize-
        // Changed re-lays out the accordion), and a CSS transition enabled and
        // triggered in one task never animates — the browser only ever sees the
        // after-state. A single forced layout read flushes the transition style
        // as the pre-toggle snapshot so the upcoming height change animates from
        // it. (Transitions are off outside a toggle, so nothing else pays this.)
        const element = container?.getElement();

        if (element) {
            DOM.source.getElementRect(element);
        }

        // A re-toggle inside the animation duration replaces the in-flight
        // animation rather than racing it. Its onComplete will never run, so
        // the replacement inherits its slot in `_toggleAnimations` instead of
        // adding a second one — otherwise the counter never returns to zero and
        // the cleanup branch below is unreachable for the rest of the manager's
        // life. Completed animations delete themselves from the map, so a
        // non-null `get` here always means a genuinely in-flight animation.
        const inFlight = this._wrapperAnimations.get(index);

        if (inFlight) {
            inFlight.cancel();
            this._wrapperAnimations.delete(index);
        } else {
            this._toggleAnimations += 1;
        }

        this._wrapperAnimations.set(index, Animation.afterTransition({
            component:        wrapper,
            property:         "height",
            durationMs:       this._animationDuration,
            fallbackBufferMs: 40,
            onComplete:       () => {
                this._wrapperAnimations.delete(index);

                wrapper.setWillChange(null);
                this._toggleAnimations -= 1;

                // Only the last toggle to complete turns transitions back off,
                // so an earlier finisher can't snap sections still animating.
                if (this._toggleAnimations <= 0) {
                    this._toggleAnimations = 0;
                    this.setSectionTransitions(false);
                    container?.setTransition(null);

                    // Re-lay-out the host now that the geometry has settled. The
                    // toggle's own relayoutHost ran while this animation was
                    // still in flight, so every DOM measurement it took saw the
                    // pre-toggle extent: a scrolling host measured its scrollbar
                    // gutter against content that was mid-transition and still
                    // overflowing, and so kept reserving the gutter even though
                    // the bar disappears once the animation lands. Nothing else
                    // re-measures afterwards, so the stale reserve would linger
                    // until some unrelated layout — in practice, the next toggle
                    // — making the reclaim run one gesture behind.
                    this.relayoutHost();
                }
            },
        }));
    }

    /**
     * Installs or removes the open/close animation transitions on every header,
     * panel wrapper, content component, and resize gutter. Enabled by
     * `primeWrapper` for the duration of a toggle; off otherwise so resize and
     * drag relayouts snap to their final geometry.
     *
     * @param enabled - True to install the animated transitions, false to clear them.
     */
    private setSectionTransitions(enabled: boolean): void {
        const components = this.getContainer()?.getComponents() ?? [];

        for (let i = 0; i < this._headers.length; i++) {
            this._headers[i].setTransition(enabled ? this.buildHeaderTransition() : "none");
            this._panelWrappers[i].setTransition(enabled ? this.buildWrapperTransition() : "none");
            components[i]?.setTransition(enabled ? this.buildContentTransition() : "none");
        }

        for (const gutter of this._resizeGutters) {
            gutter.setTransition(enabled ? this.buildHeaderTransition() : "none");
        }
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
