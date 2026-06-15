// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Size } from "~/primitive/Size.js";
import { Insets } from "~/primitive/Insets.js";
import { Component } from "~/core/Component.js";
import { Window } from "~/core/Window.js";
import { TabWindow } from "~/core/TabWindow.js";
import { AbstractWindow } from "~/core/AbstractWindow.js";
import { ThemeManager } from "~/core/Theme.js";
import { Animation } from "~/core/Animation.js";
import { FillType } from "~/layout/FillType.js";
import { Fit } from "~/layout/Fit.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { tabDragRegistry } from "~/core/DragManager.js";
import { TabBar } from "~/component/container/TabBar.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link Tab}.
 *
 * `"tabclose"` fires when a tab is closed (carrying the removed content);
 * `"empty"` fires when the strip loses its last tab by any path — close,
 * tear-off, or re-dock — and carries no payload; `"detached"` fires when a tab
 * is torn off into a new floating window (carrying that window), the one
 * structural change that does *not* always empty the source strip.
 *
 * @category Layouts
 */
export type TabEvent = "tabclose" | "empty" | "detached";

/**
 * How a torn-off tab's floating window hosts its content.
 *
 * - `"strip"` (default) — the window hosts a one-tab reorderable strip; the
 *   tab re-docks onto another strip by dragging it out, and the emptied window
 *   closes itself.
 * - `"bare"` — the live content fills the window body directly; it re-docks by
 *   Ctrl-dragging the window header onto a strip.
 *
 * @category Layouts
 */
export type TabDetachWindowMode = "bare" | "strip";

// Default size of the floating window a torn-off tab opens into. A tab has no
// inherent window size, so we open at a comfortable working area rather than the
// content's current extent (which spans the full tab body and would spawn an
// oversized window); the user can resize from there.
const DETACH_WINDOW_WIDTH:  number = 480;
const DETACH_WINDOW_HEIGHT: number = 360;

/**
 * Tab-button width strategy for the {@link Tab} strip.
 *
 * - `"fill"` — tabs split the strip equally and stretch to fill it.
 * - `"content"` — each tab takes its own content width, capped at `maxWidth`.
 * - `"equal"` — every tab takes the width of the widest tab, capped at
 *   `maxWidth` (default).
 * - `"fixed"` — every tab takes `fixedWidth`.
 *
 * Every mode except `"fill"` leaves the strip full-width with the tabs
 * left-aligned and any leftover space empty.
 *
 * @category Layouts
 */
export type TabWidthMode = "fill" | "content" | "equal" | "fixed";

/**
 * Which edge of the content area the {@link Tab} strip sits on.
 *
 * - `"north"` — strip on top, content below (the default).
 * - `"south"` — strip on the bottom, content above.
 * - `"west"` — strip on the left (fixed width), content to the right.
 * - `"east"` — strip on the right, content to the left.
 *
 * @category Layouts
 */
export type TabSide = "north" | "south" | "west" | "east";

/**
 * Main-axis alignment of the tab-button group within the {@link Tab} strip.
 *
 * - `"start"` — tabs hug the strip's leading edge (left for north/south, top
 *   for west/east); the tool group, if any, sits at the trailing edge.
 * - `"end"` — tabs hug the trailing edge; the tool group sits at the leading
 *   edge.
 *
 * Alignment is a no-op in `"fill"` width mode (and in `"equal"` once it
 * collapses to fill), where the tabs span the whole strip.
 *
 * @category Layouts
 */
export type TabAlign = "start" | "end";

/**
 * Text orientation for tab buttons on the vertical sides (west/east). Ignored
 * for north/south, where tab text is always horizontal.
 *
 * - `"horizontal"` — buttons stack vertically but text stays upright.
 * - `"vertical-cw"` — text rotated 90° clockwise (`writing-mode: vertical-rl`).
 * - `"vertical-ccw"` — text rotated the other way (`writing-mode: vertical-lr`).
 *
 * @remarks Implemented with CSS `writing-mode` rather than `transform: rotate`
 * so the browser reports the rotated box through `getBoundingClientRect`,
 * keeping preferred-size measurement and hit-testing correct.
 *
 * @category Layouts
 */
export type TabOrientation = "horizontal" | "vertical-cw" | "vertical-ccw";

/**
 * Justification of the tab-button label along its reading direction. `"start"`
 * and `"end"` are flow-relative (the left/right edges on a horizontal strip,
 * the top/bottom edges on a rotated west/east strip), matching the `"start"` /
 * `"end"` vocabulary of {@link TabAlign}. Only visible when a tab cell is wider
 * than its content (the `"fill"`, `"equal"`, and `"fixed"` width modes pad cells
 * out; `"content"` mode hugs the text, so justification has no visible effect
 * there).
 *
 * @category Layouts
 */
export type TabTextAlign = "start" | "center" | "end";

/**
 * Duration (ms) of the cross-tab content fade-in. Matches `AnimatedDropdown`'s
 * default (and the strip indicator's slide, which {@link TabBar} keeps its own
 * copy of) so tabs and the ComboBox caret animate at the same pace.
 */
const TAB_FADE_DURATION_MS = 120;

/**
 * Construction-time options for {@link Tab}.
 *
 * @category Layouts
 */
export interface TabOptions extends LayoutManagerOptions {
    /**
     * Multi-event listener bag dispatched to {@link Tab.on} at construction
     * time.
     */
    listeners?: {
        tabclose?: (component: Component) => void;
        /** Fires after the last tab leaves the strip by any path (close, tear-off, re-dock). */
        empty?: () => void;
    };

    /** Tab-button width strategy; defaults to `"equal"`. */
    widthMode?: TabWidthMode;

    /** Per-tab maximum width in px for `"content"` / `"equal"` modes; `null` (the default) leaves tabs uncapped. */
    maxWidth?: number | null;

    /** Per-tab width in px for `"fixed"` mode; defaults to `120`. */
    fixedWidth?: number;

    /**
     * Whether the 1px strip under-border runs edge-to-edge. When omitted, follows
     * the active theme's `tab.underBorderFullWidth` (Modern `false`, Classic/Dark
     * `true`); setting it explicitly pins the value and stops it tracking the theme.
     */
    underBorderFullWidth?: boolean;

    /** Which edge the tab strip sits on; defaults to `"north"`. */
    side?: TabSide;

    /** Main-axis alignment of the tab-button group; defaults to `"start"`. */
    align?: TabAlign;

    /** Text orientation on the vertical sides; defaults to `"horizontal"`. */
    orientation?: TabOrientation;

    /**
     * Whether an overflowing strip scrolls (leading/trailing arrow buttons,
     * tabs kept at preferred size) instead of compressing the tabs to fit.
     * Defaults to `false`.
     */
    scrollable?: boolean;

    /** Tool buttons pinned at the far end of the strip, opposite the tabs. */
    tools?: Component[];

    /** Reduce tab-button insets for a denser strip. Defaults to `false`. */
    compact?: boolean;

    /** Enable within-strip header drag-reorder. Defaults to `false`. */
    reorderable?: boolean;

    /**
     * When true, the tab bar extends to the container's outer edges (ignoring
     * the container's content insets) while the tab content stays inset; the bar
     * absorbs the parent inset as its own inset so its chrome stays flush with the
     * content. Mirrors a Border NORTH region's `ignoreParentInsets`. Defaults to false.
     */
    barIgnoreParentInsets?: boolean;

    /**
     * How a torn-off tab's floating window hosts its content — a one-tab strip
     * (`"strip"`, the default) or the bare content (`"bare"`). Defaults to
     * `"strip"`. See {@link TabDetachWindowMode}.
     */
    detachWindowMode?: TabDetachWindowMode;

    /** Tab-label justification (strip-wide); defaults to `"center"`. */
    textAlign?: TabTextAlign;
}

/**
 * Lifecycle state of a tab slot.
 *
 * - `"ready"` — `component` is built and attached. `getVisibleComponent`
 *   returns it directly.
 * - `"lazy"` — `factory` is registered but has not run. First activation
 *   transitions to `"building"`.
 * - `"building"` — the materialize helper has mounted `spinner` into the
 *   container and queued the factory behind a two-rAF yield. `onReady`
 *   moves the entry to `"ready"`. Re-entering this state is suppressed
 *   so spam-clicks during a build do not start a second factory run.
 */
type TabEntryState = "lazy" | "building" | "ready";

/**
 * The content half of a tab slot — the lazy-load state machine and the live
 * content. The bar half (button, wrapper, close button, label, constraints)
 * lives in the {@link TabBar} cell keyed by the same stable `id`; the two halves
 * never reference each other directly, only through the shared id.
 *
 * @remarks `component` is `null` for entries registered via `addLazyTab` until
 * the first activation; on materialization, the factory runs and the produced
 * component is cached here. Eager entries (created by `createTab`) populate
 * `component` immediately and leave `factory` null. The component reference is
 * stored on the entry rather than looked up by index in
 * `container.getComponents()` because lazy tabs may materialize out of order —
 * `Component.addComponent` always appends, so indices between `_contents[]` and
 * the container's component list do not stay aligned.
 *
 * `spinner` carries the placeholder Component that `Animation.materialize`
 * mounts into the container during the factory's two-rAF yield, so the layout
 * pass can surface it as the visible child while the build is in flight.
 */
interface ContentEntry {
    id: string;
    component: Component | null;
    factory: (() => Component) | null;
    spinner: Component | null;
    state: TabEntryState;
}

/**
 * A layout manager that renders a row of tab buttons along one edge of the
 * container content area and shows exactly one child component at a time based on
 * the selected tab. Tab button labels resolve in priority order: the
 * per-placement `LayoutConstraints.name` override, then the component's intrinsic
 * [`name`](/api/core/classes/Component#getname), then its ID.
 *
 * `Tab` is the **content** manager: it owns the selected panel, lazy-load /
 * materialization, content swapping, tab tear-off into a floating
 * [`Window`](/api/core/classes/Window), and inter-strip docking. The **bar** —
 * the toolbar strip, the tab buttons, the selection indicator, the reorder bar,
 * the tool group, overflow scrolling, and tab drag-and-drop — is a composable
 * [`TabBar`](/api/component/container/classes/TabBar) it owns and reacts to: the
 * bar emits window-agnostic events and `Tab` performs the content / window work.
 *
 * @category Layouts
 */
class Tab extends LayoutManager {

    // The composable tab strip — the toolbar element, buttons, indicator, reorder
    // bar, tool group, overflow scroll, and tab DnD. `Tab` raw-appends its element
    // to the container and drives it through prepareStrip / stripThickness /
    // placeStrip each layout pass; the content panels stay the container's real
    // children, never enrolled in the bar.
    private _bar: TabBar = new TabBar();

    // Content records, keyed by the same stable id as the bar cells. Holds the
    // lazy-load state machine and the live content — never any bar/DOM state.
    private _contents: Array<ContentEntry> = [];

    private _selectedTabIndex: number = 0;
    // Last tab index that was faded in during a doLayout pass. Compared
    // against `_selectedTabIndex` so the cross-tab fade fires only on actual
    // selection changes (not on every relayout, e.g. window resize).
    private _lastFadedTabIndex: number = -1;
    private _listeners: ListenerBag<TabEvent> = new ListenerBag<TabEvent>();

    // When true, doLayout grows the bar to the container's outer edges and hands
    // it the absorbed parent inset as its own inset; the content stays inset.
    private _barIgnoreParentInsets: boolean = false;

    // How a torn-off tab's window hosts its content — consulted at tear-off time.
    private _detachWindowMode: TabDetachWindowMode = "strip";

    // Set only on the inner strip a `"strip"`-mode tear-off builds inside a
    // window, so that strip (and only it) closes its host window when emptied.
    private _closeHostWindowWhenEmpty: boolean = false;

    // Monotonic seed for the stable per-tab id that links a ContentEntry to its
    // TabBar cell. Unique within this strip — the only scope the link needs.
    private _idSeq: number = 0;

    // Re-lays out the content + strip on theme change (the bar tracks only its own
    // under-border default); torn down in detach.
    private _themeCleanup: (() => void) | null = null;

    /**
     * Creates a Tab layout manager with an empty strip.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TabOptions) {
        super();

        // A theme change can change tab-button metrics (and thus the strip
        // thickness), so re-lay out the whole strip+content; the bar separately
        // refreshes its under-border default.
        this._themeCleanup = ThemeManager.onThemeChange(() => {
            this.getContainer()?.scheduleLayout();
        });

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link TabOptions} bag, dispatching the close callback and the
     * strip configuration after the inherited LayoutManager defaults. The strip
     * setters forward to the owned {@link TabBar}.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TabOptions): void {
        super.applyOptions(options);

        if (options.listeners?.tabclose !== undefined) {
            this.on("tabclose", options.listeners.tabclose);
        }

        if (options.listeners?.empty !== undefined) {
            this.on("empty", options.listeners.empty);
        }

        if (options.widthMode !== undefined) {
            this.setWidthMode(options.widthMode);
        }

        if (options.maxWidth !== undefined) {
            this.setMaxWidth(options.maxWidth);
        }

        if (options.fixedWidth !== undefined) {
            this.setFixedWidth(options.fixedWidth);
        }

        if (options.underBorderFullWidth !== undefined) {
            this.setUnderBorderFullWidth(options.underBorderFullWidth);
        }

        if (options.side !== undefined) {
            this.setSide(options.side);
        }

        if (options.align !== undefined) {
            this.setAlign(options.align);
        }

        if (options.orientation !== undefined) {
            this.setOrientation(options.orientation);
        }

        if (options.scrollable !== undefined) {
            this.setScrollable(options.scrollable);
        }

        if (options.compact !== undefined) {
            this.setCompact(options.compact);
        }

        if (options.reorderable !== undefined) {
            this.setReorderable(options.reorderable);
        }

        if (options.barIgnoreParentInsets !== undefined) {
            this.setBarIgnoreParentInsets(options.barIgnoreParentInsets);
        }

        if (options.detachWindowMode !== undefined) {
            this.setDetachWindowMode(options.detachWindowMode);
        }

        if (options.textAlign !== undefined) {
            this.setTextAlign(options.textAlign);
        }

        if (options.tools !== undefined) {
            for (const tool of options.tools) {
                this.addTool(tool);
            }
        }
    }

    /**
     * Selects the tab-button width strategy (see {@link TabWidthMode}) and
     * re-lays out the strip.
     *
     * @param mode - The width strategy to apply.
     *
     * @returns This layout manager, for chaining.
     */
    setWidthMode(mode: TabWidthMode): this {
        this._bar.setWidthMode(mode);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-button width strategy.
     *
     * @returns The active {@link TabWidthMode}.
     */
    getWidthMode(): TabWidthMode {
        return this._bar.getWidthMode();
    }

    /**
     * Sets the per-tab width cap used by the `"content"` and `"equal"` width
     * modes, then re-lays out the strip.
     *
     * @param px - The maximum width per tab in px, or `null` to remove the cap.
     *
     * @returns This layout manager, for chaining.
     */
    setMaxWidth(px: number | null): this {
        this._bar.setMaxWidth(px);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current per-tab maximum width.
     *
     * @returns The cap in px, or `null` when tabs are uncapped.
     */
    getMaxWidth(): number | null {
        return this._bar.getMaxWidth();
    }

    /**
     * Sets the per-tab width used by the `"fixed"` width mode, then re-lays out
     * the strip.
     *
     * @param px - The fixed width per tab in px.
     *
     * @returns This layout manager, for chaining.
     */
    setFixedWidth(px: number): this {
        this._bar.setFixedWidth(px);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the per-tab width used by the `"fixed"` width mode.
     *
     * @returns The fixed width in px.
     */
    getFixedWidth(): number {
        return this._bar.getFixedWidth();
    }

    /**
     * Toggles the edge-to-edge 1px rule under the tab strip. Pins the value for
     * this instance, so it no longer follows the active theme's
     * `tab.underBorderFullWidth` default on theme changes.
     *
     * @param full - `true` to draw the strip's full-width under-border, `false` to remove it.
     *
     * @returns This layout manager, for chaining.
     */
    setUnderBorderFullWidth(full: boolean): this {
        this._bar.setUnderBorderFullWidth(full);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether the strip's under-border runs edge-to-edge.
     *
     * @returns `true` when the full-width under-border is drawn.
     */
    isUnderBorderFullWidth(): boolean {
        return this._bar.isUnderBorderFullWidth();
    }

    /**
     * Selects which edge of the content area the tab strip sits on and re-lays
     * out.
     *
     * @param side - The {@link TabSide} to place the strip on.
     *
     * @returns This layout manager, for chaining.
     */
    setSide(side: TabSide): this {
        this._bar.setSide(side);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the edge the tab strip currently sits on.
     *
     * @returns The active {@link TabSide}.
     */
    getSide(): TabSide {
        return this._bar.getSide();
    }

    /**
     * Sets the main-axis alignment of the tab-button group within the strip and
     * re-lays out.
     *
     * @param align - The {@link TabAlign} to apply.
     *
     * @returns This layout manager, for chaining.
     */
    setAlign(align: TabAlign): this {
        this._bar.setAlign(align);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-button-group alignment.
     *
     * @returns The active {@link TabAlign}.
     */
    getAlign(): TabAlign {
        return this._bar.getAlign();
    }

    /**
     * Sets the tab-button text orientation for the vertical sides and re-lays
     * out.
     *
     * @param orientation - The {@link TabOrientation} to apply.
     *
     * @returns This layout manager, for chaining.
     */
    setOrientation(orientation: TabOrientation): this {
        this._bar.setOrientation(orientation);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current vertical-side tab text orientation.
     *
     * @returns The active {@link TabOrientation}.
     */
    getOrientation(): TabOrientation {
        return this._bar.getOrientation();
    }

    /**
     * Sets the strip-wide tab-label justification and re-lays out.
     *
     * @param align - The {@link TabTextAlign} to apply.
     *
     * @returns This layout manager, for chaining.
     */
    setTextAlign(align: TabTextAlign): this {
        this._bar.setTextAlign(align);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-label justification.
     *
     * @returns The active {@link TabTextAlign}.
     */
    getTextAlign(): TabTextAlign {
        return this._bar.getTextAlign();
    }

    /**
     * Sets whether an overflowing strip scrolls (leading/trailing arrow buttons,
     * tabs kept at preferred size) instead of compressing the tabs to fit, and
     * re-lays out.
     *
     * @param value - `true` to scroll on overflow, `false` to compress.
     *
     * @returns This layout manager, for chaining.
     */
    setScrollable(value: boolean): this {
        this._bar.setScrollable(value);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether an overflowing strip scrolls instead of compressing.
     *
     * @returns `true` when the strip scrolls on overflow.
     */
    isScrollable(): boolean {
        return this._bar.isScrollable();
    }

    /**
     * Toggles reduced tab-button insets (a denser strip) and re-lays out.
     *
     * @param value - `true` for compact insets, `false` for the default.
     *
     * @returns This layout manager, for chaining.
     */
    setCompact(value: boolean): this {
        this._bar.setCompact(value);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether the strip uses reduced (compact) tab-button insets.
     *
     * @returns `true` when compact.
     */
    isCompact(): boolean {
        return this._bar.isCompact();
    }

    /**
     * Enables or disables within-strip drag-reorder of tab headers. Forwards to
     * the strip, which installs / tears down the drag wiring.
     *
     * @param value - `true` to enable header drag-reorder.
     *
     * @returns This layout manager, for chaining.
     */
    setReorderable(value: boolean): this {
        this._bar.setReorderable(value);

        return this;
    }

    /**
     * Returns whether within-strip header drag-reorder is enabled.
     *
     * @returns `true` when reorderable.
     */
    isReorderable(): boolean {
        return this._bar.isReorderable();
    }

    /**
     * Toggles whether the tab bar extends to the container's outer edges,
     * absorbing the container's content inset as the bar's own inset while the
     * content stays inset, then re-lays out.
     *
     * @param value - `true` to grow the bar to the outer edges, `false` to keep it inset.
     *
     * @returns This layout manager, for chaining.
     */
    setBarIgnoreParentInsets(value: boolean): this {
        this._barIgnoreParentInsets = value;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether the tab bar extends to the container's outer edges.
     *
     * @returns `true` when the bar ignores the container's content insets.
     */
    isBarIgnoreParentInsets(): boolean {
        return this._barIgnoreParentInsets;
    }

    /**
     * Sets how a torn-off tab's floating window hosts its content. The mode is
     * consulted at the next tear-off, so this just caches the value — no layout
     * work, unlike {@link setReorderable}.
     *
     * @param mode - `"strip"` for a one-tab strip in the window, `"bare"` for the content directly.
     *
     * @returns This layout manager, for chaining.
     */
    setDetachWindowMode(mode: TabDetachWindowMode): this {
        this._detachWindowMode = mode;

        return this;
    }

    /**
     * Returns the tear-off window content mode.
     *
     * @returns The active {@link TabDetachWindowMode}.
     */
    getDetachWindowMode(): TabDetachWindowMode {
        return this._detachWindowMode;
    }

    /**
     * Flags this strip to close its host {@link AbstractWindow} once it empties
     * (its last tab is dragged out or closed). Set by a host window that builds a
     * `Tab` as its own layout manager — the same flag the auto-created tear-off
     * strip carries — so `hostWindow`/`closeHostWindowIfEmpty` resolve and
     * close that window. Caches the value; no layout work, like
     * {@link setDetachWindowMode}.
     *
     * @param value - True to close the host window when the strip empties.
     *
     * @returns This layout manager, for chaining.
     */
    setCloseHostWindowWhenEmpty(value: boolean): this {
        this._closeHostWindowWhenEmpty = value;

        return this;
    }

    /**
     * Adds a tool button at the far end of the strip, opposite the tab buttons.
     *
     * @param button - The tool component to add.
     *
     * @returns This layout manager, for chaining.
     */
    addTool(button: Component): this {
        this._bar.addTool(button);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Removes a previously-added tool button.
     *
     * @param button - The tool component to remove.
     *
     * @returns This layout manager, for chaining.
     */
    removeTool(button: Component): this {
        this._bar.removeTool(button);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Sets or clears the bar's always-leading widget, forwarding to
     * {@link TabBar.setLeadingWidget}. Passing `null` clears the leading slot.
     *
     * @param widget - The widget to host in the leading slot, or `null` to clear it.
     *
     * @returns This layout manager, for chaining.
     */
    setBarLeadingWidget(widget: Component | null): this {
        this._bar.setLeadingWidget(widget);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Recolors every opaque toolbar surface of the bar, forwarding to
     * {@link TabBar.setBarSurfaceColor}. A recolor only — it does not relayout.
     *
     * @param color - A CSS color string applied to every toolbar surface.
     *
     * @returns This layout manager, for chaining.
     */
    setBarBackgroundColor(color: string): this {
        this._bar.setBarSurfaceColor(color);

        return this;
    }

    /**
     * Installs empty-bar-area window-chrome gestures on the underlying strip,
     * forwarding to {@link TabBar.installMoveTrigger}. A press on the bar's blank
     * area (not on a tab, a tool, or a scroll arrow) invokes `onEmptyPress`; an
     * optional `onEmptyDoubleClick` fires on a double-click of the same area. A
     * host {@link AbstractWindow} uses these to move and maximize from the bar.
     * Mirrors the {@link Tab.addTool} forwarding idiom.
     *
     * @param onEmptyPress - Callback invoked with the originating `mousedown`
     *   when an empty bar area is pressed.
     * @param onEmptyDoubleClick - Optional callback invoked on a double-click of
     *   the empty bar area.
     *
     * @returns This layout manager, for chaining.
     */
    installBarMoveTrigger(onEmptyPress: (e: MouseEvent) => void, onEmptyDoubleClick?: (e: MouseEvent) => void): this {
        this._bar.installMoveTrigger(onEmptyPress, onEmptyDoubleClick);

        return this;
    }

    /**
     * Mints the next stable per-tab id linking a {@link ContentEntry} to its
     * {@link TabBar} cell.
     *
     * @returns A new id unique within this strip.
     */
    private mintId(): string {
        return "tab-" + (this._idSeq++);
    }

    /**
     * Attaches to a container and raw-appends the tab strip element to it, then
     * subscribes to the strip's window-agnostic events.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component): this {
        super.attach(container);

        container.getElement(true).appendChild(this._bar.getElement(true));

        this._bar.on("tabpressed",       this._onBarTabPressed);
        this._bar.on("reordered",        this._onBarReordered);
        this._bar.on("tabclose",         this._onBarTabClose);
        this._bar.on("dockrequested",    this._onBarDockRequested);
        this._bar.on("tabdragstart",     this._onBarTabDragStart);
        this._bar.on("tearoffrequested", this._onBarTearOffRequested);
        this._bar.on("detached",         this._onBarDetached);

        return this;
    }

    /**
     * Detaches from the container: unsubscribes from the strip, tears the strip
     * down, removes the theme subscription, and removes the strip element.
     */
    detach(): this {
        super.detach();

        if (this._themeCleanup) {
            this._themeCleanup();
            this._themeCleanup = null;
        }

        this._bar.off("tabpressed",       this._onBarTabPressed);
        this._bar.off("reordered",        this._onBarReordered);
        this._bar.off("tabclose",         this._onBarTabClose);
        this._bar.off("dockrequested",    this._onBarDockRequested);
        this._bar.off("tabdragstart",     this._onBarTabDragStart);
        this._bar.off("tearoffrequested", this._onBarTearOffRequested);
        this._bar.off("detached",         this._onBarDetached);

        this._bar.dispose();

        return this;
    }

    /**
     * Strip `"tabpressed"` handler: a cell was activated. Points the active
     * content index at the cell's content, kicks its lazy-load, and re-lays out.
     * The bar already synced its own button group, roving focus, and indicator
     * intent before emitting.
     *
     * @param id - The activated cell id.
     */
    private _onBarTabPressed = (id: string): void => {
        const idx = this._contents.findIndex(entry => entry.id === id);

        if (idx >= 0) {
            this._selectedTabIndex = idx;

            const entry = this._contents[idx];

            if (entry.state === "lazy") {
                this.materializeAsync(idx);
            }
        }

        this.getContainer()?.scheduleLayout();
    };

    /**
     * Strip `"reordered"` handler: an in-strip reorder committed. Re-derives the
     * content order from the strip's new id order, keeping the selected content
     * selected by identity, then re-lays out.
     *
     * @param _fromId - The reordered cell id (the order is re-derived, so this is informational).
     * @param _toIndex - The destination slot (informational).
     */
    private _onBarReordered = (_fromId: string, _toIndex: number): void => {
        const order = this._bar.getEntryIds();
        const active = this._contents[this._selectedTabIndex] ?? null;

        this._contents.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

        if (active) {
            const newIndex = this._contents.indexOf(active);

            if (newIndex >= 0) {
                this._selectedTabIndex = newIndex;
            }
        }

        this.getContainer()?.scheduleLayout();
    };

    /**
     * Strip `"tabclose"` handler: a cell's ✕ was clicked. Removes the cell and its
     * content component, emits the public `"tabclose"`, then selects the next tab.
     *
     * @param id - The cell id to close.
     */
    private _onBarTabClose = (id: string): void => {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const idx = this._contents.findIndex(entry => entry.id === id);
        if (idx < 0) {
            return;
        }

        // Capture before the splice mutates the array: only a closed *active* tab
        // forces a selection move; closing a background tab keeps it.
        const wasSelected = this._selectedTabIndex === idx;
        const content = this._contents[idx].component;

        this._bar.removeBarEntry(id);
        this._contents.splice(idx, 1);

        if (content) {
            container.removeComponent(content);
        }

        if (content) {
            this.emit("tabclose", content);
        }

        this.selectNextContent(idx, wasSelected);
        this.getContainer()?.scheduleLayout();
        this.syncHostWindowCloseable();
        this.closeHostWindowIfEmpty();

        if (this._contents.length === 0) {
            this.emit("empty");
        }
    };

    /**
     * Strip `"dockrequested"` handler: a foreign tab was dropped here. Resolves the
     * live content from the shared registry and docks it as a new tab.
     *
     * @param componentId - The dragged content component's id.
     * @param slot - The strip insertion slot the bar computed.
     */
    private _onBarDockRequested = (componentId: string, slot: number): void => {
        const content = tabDragRegistry.get(componentId);

        if (content) {
            this.dockComponent(content, slot);

            // A panel docked into this strip should bring the strip's host window
            // (if any) to the front and focus it — a no-op for an in-document
            // strip, which has no host window.
            this.hostWindow()?.bringToFront();
        }
    };

    /**
     * Strip `"tabdragstart"` handler: a cell's drag committed. Registers the cell's
     * live content (if ready) in the shared registry so a foreign strip's drop can
     * resolve it from the id-only drag data.
     *
     * @param id - The dragged cell id.
     */
    private _onBarTabDragStart = (id: string): void => {
        const entry = this._contents.find(e => e.id === id);

        if (entry && entry.state === "ready" && entry.component) {
            tabDragRegistry.set(entry.component.getId(), entry.component);
        }
    };

    /**
     * Strip `"tearoffrequested"` handler: a cell was released over empty space.
     * Clears the registry entry and — when the content is ready — tears it off into
     * a floating window.
     *
     * @param id - The dragged cell id.
     * @param clientX - Viewport X of the release point.
     * @param clientY - Viewport Y of the release point.
     * @param forceBare - When `true`, open a bare window regardless of the detach mode.
     */
    private _onBarTearOffRequested = (id: string, clientX: number, clientY: number, forceBare: boolean): void => {
        const entry = this._contents.find(e => e.id === id);

        if (!entry) {
            return;
        }

        if (entry.component) {
            tabDragRegistry.delete(entry.component.getId());
        }

        if (entry.state !== "ready" || !entry.component) {
            return;
        }

        this.detachTabToWindow(id, entry.component, clientX, clientY, forceBare);
    };

    /**
     * Strip `"detached"` handler: a cell's drag was released onto a target. Clears
     * the registry entry; if the content actually moved out of this container (a
     * dock into another strip, not a within-strip reorder), drops its cell.
     *
     * @param id - The dragged cell id.
     */
    private _onBarDetached = (id: string): void => {
        const entry = this._contents.find(e => e.id === id);

        if (!entry) {
            return;
        }

        const content = entry.component;

        if (content) {
            tabDragRegistry.delete(content.getId());
        }

        if (entry.state !== "ready" || !content) {
            return;
        }

        // Docked into another strip moves the content out of this container; a
        // within-strip reorder leaves it here. Only the former orphans the cell.
        const stillMine = this.getContainer()?.getComponents().includes(content) ?? false;

        if (!stillMine) {
            this.removeEntryKeepingContent(id);
        }
    };

    /**
     * Returns the child component at the currently selected tab index, materializing
     * a lazily-registered panel on first access.
     *
     * @returns The visible component, or `null` if no entry is registered at the selected index or the container is not attached.
     */
    getVisibleComponent(): Component | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        const entry = this._contents[this._selectedTabIndex];
        if (entry) {
            // While a build is in flight the spinner stays the visible child
            // even though `component` may already be captured (see
            // `materializeAsync`): the built component fades in over the
            // spinner via opacity, so the spinner must hold the slot until
            // `onReady` flips the entry to "ready".
            if (entry.state === "building" && entry.spinner) {
                return entry.spinner;
            }

            if (entry.component) {
                return entry.component;
            }

            return null;
        }

        return container.getComponents()[this._selectedTabIndex] ?? null;
    }

    /**
     * Returns the preferred size: the visible component's preferred size plus the
     * strip thickness on the strip's axis.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or visible component.
     */
    getPreferredSize(): Size | null {
        return this.composeSize(this.getVisibleComponent()?.getPreferredSize());
    }

    /**
     * Returns the minimum size: the visible component's minimum size plus the
     * strip thickness on the strip's axis.
     *
     * @returns The minimum `{width, height}`, or `null` if there is no container or visible component.
     */
    getMinSize(): Size | null {
        return this.composeSize(this.getVisibleComponent()?.getMinSize());
    }

    /**
     * Returns the maximum size: the visible component's maximum size plus the
     * strip thickness on the strip's axis.
     *
     * @returns The maximum `{width, height}`, or `null` if there is no container or visible component.
     */
    getMaxSize(): Size | null {
        return this.composeSize(this.getVisibleComponent()?.getMaxSize());
    }

    /**
     * Reports whether the strip sits on a vertical side (west/east), where it
     * occupies width rather than height.
     *
     * @returns `true` for west/east, `false` for north/south.
     */
    private isVertical(): boolean {
        const side = this._bar.getSide();

        return side === "west" || side === "east";
    }

    /**
     * Adds the strip thickness and the container perimeter to a visible-content
     * size, on the axis the strip occupies for the current side: height for
     * north/south, width for west/east.
     *
     * @param content - The visible component's preferred/min/max size, or
     *   `null`/`undefined` when unavailable.
     *
     * @returns The composed size, or `null` when there is no container or content.
     */
    private composeSize(content: Size | null | undefined): Size | null {
        const container = this.getContainer();

        if (!container || !content) {
            return null;
        }

        const perimiter = container.getPerimiterSize();
        const outerWidth = perimiter.left + perimiter.right;
        const outerHeight = perimiter.top + perimiter.bottom;
        const thickness = this._bar.stripThickness();

        if (this.isVertical()) {
            return {
                width:  content.width + thickness + outerWidth,
                height: content.height + outerHeight,
            };
        }

        return {
            width:  content.width + outerWidth,
            height: content.height + thickness + outerHeight,
        };
    }

    /**
     * Creates a content record and a strip cell for a component.
     *
     * @param component - The content component for which a tab should be created.
     *
     * @remarks The button label resolves in priority order: the per-placement
     * `LayoutConstraints.name` override, then the component's intrinsic
     * [`name`](/api/core/classes/Component#getname), then its ID as a last
     * resort. When `constraints.closeable` is true, a close button is added to the
     * cell.
     */
    createTab(component: Component): void {
        let constraints = this.getLayoutConstraints(component);
        const name = constraints?.name ?? component.getName() ?? component.getId();
        const id = this.mintId();

        this._bar.createBarEntry(id, name, constraints);
        this._contents.push({
            id,
            component,
            factory: null,
            spinner: null,
            state: "ready",
        });

        this.wireComponentAria(id, component);

        // A tab added to a tear-off window's strip may be non-closeable; keep the
        // host window's close button in step.
        this.syncHostWindowCloseable();
    }

    /**
     * Wires the cross-seam ARIA so the panel is announced as the tabpanel
     * controlled by its tab button: the bar sets the button's `aria-controls` to
     * the content id (through {@link TabBar.setEntryContentId}, which also records
     * the drag content id), and `Tab` points the content's `aria-labelledby` back
     * at the button.
     *
     * @param id - The cell id whose content became available.
     * @param component - The content component to attach ARIA roles to.
     */
    private wireComponentAria(id: string, component: Component): void {
        this._bar.setEntryContentId(id, component.getId());

        component.getAria().setRole("tabpanel");
        component.getAria().setTabIndex(-1);
        component.getAria().setLabelledBy(this._bar.getEntryButtonId(id));
    }

    /**
     * Registers a tab whose content component is built on first activation rather
     * than at registration time. The tab button is created immediately so the tab
     * strip renders fully on first paint; the factory runs only when the tab is
     * first selected (or laid out as the initial tab).
     *
     * @param factory - A zero-argument function that produces the content component on first activation.
     * @param name - The visible label for the tab button.
     * @param constraints - Optional layout constraints; forwarded to `container.addComponent` when the component is materialized.
     *
     * @remarks Materialization is asynchronous: on first activation the tab
     * strip selects the new tab immediately, a centred `ProgressSpinner` is
     * mounted into the container, and the factory runs after a two-rAF yield
     * via [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize)
     * so the spinner reaches the screen before the main-thread build cost is
     * incurred. The materialized component fades in over the spinner.
     *
     * Layout-sizing queries (`getPreferredSize` / `getMinSize` / `getMaxSize`)
     * do not trigger factory invocations — they observe the spinner placeholder
     * until the build completes.
     *
     * Mixing direct `container.addComponent(c, {...})` calls with lazy entries
     * is supported: `doLayout` creates a tab for every container child that no
     * existing entry already owns (through its `component`/`spinner`), so an
     * eager directly-added child still gets its own tab no matter how many lazy
     * panels have materialized. Materialize-injected children are entry-owned,
     * so they are never re-tabbed.
     *
     * @example
     * ```typescript
     * const layout = new Tab();
     * body.setLayoutManager(layout);
     * layout.addLazyTab(() => new HeavyPanel(), "Heavy");
     * ```
     */
    addLazyTab(factory: () => Component, name: string, constraints?: LayoutConstraints): void {
        const id = this.mintId();

        this._bar.createBarEntry(id, name, constraints);
        this._contents.push({
            id,
            component: null,
            factory,
            spinner: null,
            state: "lazy",
        });
    }

    /**
     * Builds the spinner placeholder for a tab entry: a fixed-size
     * `ProgressSpinner` wrapped in a [`Fit`](/api/layout/classes/Fit) layout
     * configured with `FillType.NONE` so the spinner sits at its preferred
     * size in the geometric centre of the container's content area. The
     * diameter (24 px) matches `TablePanel`'s store-loading spinner so a
     * slow lazy panel and a slow data load look identical.
     *
     * @returns A Component owning a single `ProgressSpinner` child.
     */
    private createSpinnerWrap(): Component {
        const wrap = new Component();
        wrap.setLayoutManager(new Fit({ fill: FillType.NONE }));
        wrap.addComponent(new ProgressSpinner(24));

        return wrap;
    }

    /**
     * Mounts a spinner into the container, yields two animation frames so it
     * reaches the screen, then runs the entry's factory and fades the built
     * component in over the spinner. Re-entry while a build is in flight is
     * suppressed via the entry's `state` field.
     *
     * @param idx - Zero-based index into `this._contents`.
     *
     * @remarks Replaces the previous synchronous `materialize` path. Layout-
     * sizing queries (`getPreferredSize` / `getMinSize` / `getMaxSize`) no
     * longer trigger factory invocations — they observe the spinner placeholder
     * until the build completes.
     */
    private materializeAsync(idx: number): void {
        const entry = this._contents[idx];
        if (!entry || entry.state !== "lazy") {
            return;
        }

        const factory = entry.factory;
        if (!factory) {
            return;
        }

        const container = this.getContainer();
        if (!container) {
            return;
        }

        const spinner = this.createSpinnerWrap();
        entry.spinner = spinner;
        entry.state   = "building";

        Animation.materialize({
            host:             container,
            factory:          () => {
                const component = factory();

                // Capture the built component on the entry the instant it
                // exists — before `Animation.materialize` attaches it to the
                // container and schedules the layout that would otherwise see
                // an entry-unowned child and mint a phantom UUID tab for it.
                // `onReady` re-asserts this once the fade completes.
                entry.component = component;

                return component;
            },
            spinnerComponent: spinner,
            onReady:          (component) => {
                entry.component = component;
                entry.factory   = null;
                entry.spinner   = null;
                entry.state     = "ready";

                this.wireComponentAria(entry.id, component);
                container.scheduleLayout();
            }
        });
    }

    /**
     * Computes the tab strip's working content size on the strip's axis: the
     * visible child's min size plus the strip thickness on the side the strip
     * occupies. Used to inflate the content area when the host opts into scroll.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const thickness = this._bar.stripThickness();

        const visible = this.getVisibleComponent() ?? container.getComponents()[0];
        const childMin = visible?.getMinSize();
        const childMinW = childMin ? childMin.width  : 0;
        const childMinH = childMin ? childMin.height : 0;

        if (this.isVertical()) {
            return { width: thickness + childMinW, height: childMinH };
        }

        return { width: childMinW, height: thickness + childMinH };
    }

    /**
     * Creates tab buttons for new components, hides all but the selected child,
     * positions the strip, and places the visible component.
     *
     * @remarks Tab buttons are created lazily: only components that do not yet have
     * a corresponding entry receive one. The strip occupies a thickness-deep band
     * on the chosen edge; the visible component occupies the remaining space.
     */
    doLayout(): void {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let containerSize = container.getInnerSize();
        let containerInsets = container.getContentInsets();

        // Catch the tab strip up to any container child that no content entry owns
        // yet — the bare-`Panel` eager path, where a consumer called
        // `addComponent` directly and expects a tab to appear.
        // `Animation.materialize` also injects children (the built lazy panels
        // and the transient spinner), but each of those is referenced by an
        // existing entry's `component`/`spinner`, so the ownership test skips
        // them and they never become phantom UUID-labelled tabs.
        let owned = new Set<Component>();
        for (let entry of this._contents) {
            if (entry.component) {
                owned.add(entry.component);
            }

            if (entry.spinner) {
                owned.add(entry.spinner);
            }
        }

        for (let component of components) {
            if (!owned.has(component)) {
                this.createTab(component);
            }
        }

        // The initial tab is never explicitly clicked, so its factory has to
        // be kicked off the first time we lay the container out. Subsequent
        // selections route through the strip's "tabpressed" event.
        const initialEntry = this._contents[this._selectedTabIndex];
        if (initialEntry && initialEntry.state === "lazy") {
            this.materializeAsync(this._selectedTabIndex);
        }

        for (let idx in components) {
            let component = components[idx];
            component.setVisible(false);
            component.getAria().setHidden(true);
        }

        let component = this.getVisibleComponent();

        if (!component && components.length > 0) {
            component = components[0];
        }

        // Prepare the strip for measurement (box orientation, button styles, ARIA)
        // before reading its thickness, then position it.
        this._bar.prepareStrip();

        const cs = containerSize ?? { width: 0, height: 0 };
        const baseX = containerInsets.getLeft();
        const baseY = containerInsets.getTop();
        const thickness = this._bar.stripThickness();

        // Toolbar + content rectangles per side: the strip occupies a
        // `thickness`-deep band on the chosen edge; the content fills the rest.
        let toolbarX = baseX;
        let toolbarY = baseY;
        let toolbarW = cs.width;
        let toolbarH = thickness;
        let contentX = baseX;
        let contentY = baseY;
        let contentW = cs.width;
        let contentH = cs.height;

        switch (this._bar.getSide()) {
            case "north":
                contentY = baseY + thickness;
                contentH = cs.height - thickness;
                break;

            case "south":
                toolbarY = baseY + cs.height - thickness;
                contentH = cs.height - thickness;
                break;

            case "west":
                toolbarW = thickness;
                toolbarH = cs.height;
                contentX = baseX + thickness;
                contentW = cs.width - thickness;
                break;

            case "east":
                toolbarX = baseX + cs.width - thickness;
                toolbarW = thickness;
                toolbarH = cs.height;
                contentW = cs.width - thickness;
                break;
        }

        // When the bar ignores the parent insets, grow its rect to the
        // container's outer edges and hand it the absorbed parent inset as its
        // own inset (the content-facing edge stays 0), so `layoutChrome` keeps
        // its chrome flush with the content. The content rects are untouched.
        // When false, the bar's insets stay cleared to zero so `layoutChrome`'s
        // per-side offsets are all 0 — the original layout byte-for-byte.
        if (this._barIgnoreParentInsets) {
            const L = containerInsets.getLeft();
            const T = containerInsets.getTop();
            const R = containerInsets.getRight();
            const B = containerInsets.getBottom();

            switch (this._bar.getSide()) {
                case "north":
                    toolbarX = 0;
                    toolbarY = 0;
                    toolbarW = cs.width + L + R;
                    toolbarH = thickness + T;
                    this._bar.setInsets(new Insets(T, R, 0, L));
                    break;

                case "south":
                    toolbarX = 0;
                    toolbarY = baseY + cs.height - thickness;
                    toolbarW = cs.width + L + R;
                    toolbarH = thickness + B;
                    this._bar.setInsets(new Insets(0, R, B, L));
                    break;

                case "west":
                    toolbarX = 0;
                    toolbarY = 0;
                    toolbarW = thickness + L;
                    toolbarH = cs.height + T + B;
                    this._bar.setInsets(new Insets(T, 0, B, L));
                    break;

                case "east":
                    toolbarX = baseX + cs.width - thickness;
                    toolbarY = 0;
                    toolbarW = thickness + R;
                    toolbarH = cs.height + T + B;
                    this._bar.setInsets(new Insets(T, R, B, 0));
                    break;
            }
        } else {
            this._bar.clearInsets();
        }

        this._bar.placeStrip(toolbarX, toolbarY, toolbarW, toolbarH);

        if (!component) {
            return;
        }

        component.setVisible(true);
        component.getAria().setHidden(false);

        // Universal scroll: the content area honours the host's overflow flags
        // (Panel.setAutoScroll) independently of the tab strip's own overflow.
        let contentWidth  = contentW;
        let contentHeight = contentH;

        if (this.isOverflowingX() || this.isOverflowingY()) {
            const childMin = component.getMinSize();

            if (childMin) {
                if (this.isOverflowingX()) {
                    contentWidth = Math.max(contentWidth, childMin.width);
                }

                if (this.isOverflowingY()) {
                    contentHeight = Math.max(contentHeight, childMin.height);
                }
            }
        }

        this.placeComponent(
            component,
            contentX,
            contentY,
            contentWidth,
            contentHeight,
            FillType.BOTH
        );

        // Fade the newly-visible child in only when the selection actually
        // changed since the last layout AND the entry is fully built — for a
        // lazy tab still mid-build, the spinner placeholder is what's on
        // screen and `Animation.materialize` runs the content fade itself.
        const selectedEntry = this._contents[this._selectedTabIndex];
        const isReady       = selectedEntry?.state === "ready";

        if (isReady && this._lastFadedTabIndex !== this._selectedTabIndex) {
            this._lastFadedTabIndex = this._selectedTabIndex;

            const el = component.getElement();
            if (el) {
                Animation.play(el, {
                    from:       { opacity: "0" },
                    to:         { opacity: "1" },
                    durationMs: TAB_FADE_DURATION_MS,
                    properties: ["opacity"],
                });
            }
        }
    }

    /**
     * Returns the zero-based index of the currently active tab. Captures the
     * active selection for serialization.
     *
     * @returns The active tab index.
     */
    getActiveTabIndex(): number {
        return this._selectedTabIndex;
    }

    /**
     * Returns the display label of the currently active tab, or `null` when the
     * strip is empty. A read-only accessor over the bar's active cell, used by a
     * host {@link AbstractWindow} to derive its title from the active tab.
     *
     * @returns The active tab's label, or `null` when there is no active tab.
     */
    getActiveTabLabel(): string | null {
        const id = this._bar.getActiveEntryId();

        return id === null ? null : this._bar.getEntryName(id);
    }

    /**
     * Activates the tab at the given index programmatically — clamped to the
     * valid range — driving the same selection sync a click does through the
     * strip: the button group's pressed state, the roving tabindex, lazy
     * materialization of the target, and a re-layout. Used by layout restore to
     * reinstate the saved active tab.
     *
     * @param index - Zero-based tab index; clamped to `[0, tabCount - 1]`.
     * @returns This layout manager, for method chaining.
     */
    setActiveTabIndex(index: number): this {
        if (this._contents.length === 0) {
            return this;
        }

        const clamped = Math.max(0, Math.min(index, this._contents.length - 1));

        // Drive the selection through the strip, which sets the button group,
        // roving focus, and indicator intent, then emits "tabpressed" — handled
        // by _onBarTabPressed, which moves the active content index and kicks
        // lazy materialization.
        this._bar.setActiveEntry(this._contents[clamped].id);

        return this;
    }

    /**
     * Docks a live content component dragged from another strip (or torn off into
     * a window) into this strip as a new, selected tab at `slot`. The content is
     * re-homed with [`moveComponent`](/api/core/classes/Component#movecomponent),
     * which carries its original layout constraints, so {@link createTab}
     * reproduces the tab faithfully (label, closeable, glyph).
     *
     * @param content - The live content component to dock.
     * @param slot - The strip insertion slot the bar computed.
     */
    private dockComponent(content: Component, slot: number): void {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        container.moveComponent(content, slot);
        this.createTab(content);

        // createTab appends the entry; move it to the drop slot so it lands where
        // the insertion bar showed rather than at the end of the strip.
        const appendedIndex = this._contents.length - 1;
        const dest = Math.max(0, Math.min(slot, appendedIndex));

        if (dest !== appendedIndex) {
            const entry = this._contents[appendedIndex];

            this._contents.splice(appendedIndex, 1);
            this._contents.splice(dest, 0, entry);
            this._bar.moveBarEntry(entry.id, dest);
        }

        this.setActiveTabIndex(dest);
        container.scheduleLayout();
    }

    /**
     * Removes a tab while leaving its content component alone — the teardown the
     * close path performs minus the `container.removeComponent` (the content has
     * been moved elsewhere, not destroyed) and minus the `tabclose` emit (the tab
     * is relocated, not closed).
     *
     * @param id - The cell id to remove.
     */
    private removeEntryKeepingContent(id: string): void {
        const idx = this._contents.findIndex(entry => entry.id === id);

        if (idx < 0) {
            return;
        }

        const wasSelected = this._selectedTabIndex === idx;

        this._bar.removeBarEntry(id);
        this._contents.splice(idx, 1);

        this.selectNextContent(idx, wasSelected);
        this.getContainer()?.scheduleLayout();
        this.syncHostWindowCloseable();
        this.closeHostWindowIfEmpty();

        if (this._contents.length === 0) {
            this.emit("empty");
        }
    }

    /**
     * Tears a tab off the strip into a floating {@link Window} hosting its live
     * content, opened at the release point. The content is re-parented with
     * [`moveComponent`](/api/core/classes/Component#movecomponent) — not closed —
     * so its state survives, and the now-empty strip cell is removed without
     * emitting `tabclose`.
     *
     * @param id - The cell id being torn off.
     * @param content - The live content component to host.
     * @param clientX - Viewport X of the release point.
     * @param clientY - Viewport Y of the release point.
     * @param forceBare - When `true`, a bare window is opened regardless of `detachWindowMode` (Shift held during the drag).
     */
    private detachTabToWindow(id: string, content: Component, clientX: number, clientY: number, forceBare: boolean): void {
        // Holding Shift forces a bare window regardless of mode.
        const useStrip = !forceBare && this._detachWindowMode === "strip";

        // The window inherits the tab's closeable state: a non-closeable tab's
        // window has no close button, so the user can only re-dock it (never
        // destroy the content via the title-bar X), honouring the tab's contract.
        // A strip-mode tear-off is a headerless TabWindow whose interior IS a
        // Tab; a bare tear-off is an ordinary header Window.
        const win: AbstractWindow = useStrip
            ? new TabWindow({ closeable: this._bar.isEntryCloseable(id) })
            : new Window(this._bar.getEntryName(id), { closeable: this._bar.isEntryCloseable(id) });

        win.setX(clientX);
        win.setY(clientY);
        win.setSize({ width: DETACH_WINDOW_WIDTH, height: DETACH_WINDOW_HEIGHT });

        // Keep the window on-screen when released past the viewport edge — size is
        // set first since the clamp depends on it.
        win.clampPositionToViewport();

        // Position/size set before show() so the window does not flash at its
        // default spot first.
        if (useStrip) {
            // The TabWindow builds the bar entry and reflects title + closeable;
            // it already closes itself when its last tab leaves.
            this.fillWindowWithStrip(win as TabWindow, content);
        } else {
            // Bare: the live content fills the window body (Border CENTER).
            win.moveComponent(content);
            win.show();
        }

        this.removeEntryKeepingContent(id);

        // Activate the torn-off window last. Removing the source entry re-selects
        // a neighbour in the source strip and leaves the source window raised, but
        // the tear-off's result is the new window, so it should end up focused and
        // frontmost.
        win.bringToFront();

        // Announce the tear-off so a tree owner can fold the new window into its
        // model. `removeEntryKeepingContent` already fired `"empty"` when this was
        // the strip's last tab, but a tear-off that leaves siblings behind fires
        // nothing else — this is the signal that covers that case.
        this.emit("detached", win);
    }

    /**
     * Populates a headerless {@link TabWindow} with `content` as its single tab
     * and shows it — the `"strip"` tear-off mode. The `TabWindow` *is* the strip
     * (its interior is a {@link Tab}), so there is no inner nesting; it also owns
     * the close-when-empty wiring, so the float disappears once its tab leaves.
     *
     * @param win - The freshly-constructed (not yet shown) host window.
     * @param content - The live content to host in the strip's single tab.
     */
    private fillWindowWithStrip(win: TabWindow, content: Component): void {
        win.createTab(content);
        win.show();
    }

    /**
     * The {@link Window} this strip lives in, but only for the auto-created
     * one-tab strip a `"strip"`-mode tear-off builds (which sets
     * `_closeHostWindowWhenEmpty`). A general strip that merely sits inside a
     * window returns `null`, so the host-window helpers are cheap no-ops for it.
     *
     * @returns The owning tear-off window, or `null`.
     */
    private hostWindow(): AbstractWindow | null {
        if (!this._closeHostWindowWhenEmpty) {
            return null;
        }

        let ancestor: Component | null = this.getContainer();

        while (ancestor && !(ancestor instanceof AbstractWindow)) {
            ancestor = ancestor.getParentComponent();
        }

        return ancestor instanceof AbstractWindow ? ancestor : null;
    }

    /**
     * Closes this strip's host window once it has emptied (its last tab was
     * dragged out or closed).
     */
    private closeHostWindowIfEmpty(): void {
        if (this._contents.length > 0) {
            return;
        }

        this.hostWindow()?.requestClose();
    }

    /**
     * Keeps the host window's close button in step with the strip's contents: it
     * is closeable only while *every* tab is closeable, so a non-closeable tab
     * docked into the window disables the title-bar close (the window X would
     * otherwise destroy that tab's content). A no-op outside a tear-off window.
     */
    private syncHostWindowCloseable(): void {
        const win = this.hostWindow();

        if (!win) {
            return;
        }

        win.setCloseable(this._bar.getEntryIds().every(id => this._bar.isEntryCloseable(id)));
    }

    /**
     * Re-selects after the tab at `closedIndex` has been spliced out. When the
     * closed tab was the active one, falls back to its left neighbour (driving the
     * strip's visual selection); otherwise the active tab stays selected and only
     * its stored index shifts left when the removed tab sat to its left.
     *
     * @param closedIndex - The pre-splice index of the removed tab.
     * @param closedWasSelected - Whether the removed tab was the active one.
     */
    private selectNextContent(closedIndex: number, closedWasSelected: boolean): void {
        const count = this._contents.length;

        if (count === 0) {
            this._selectedTabIndex = 0;

            return;
        }

        if (!closedWasSelected) {
            // The active tab survives; its button keeps its selected state and
            // only its index moves when the closed tab was to its left.
            if (this._selectedTabIndex > closedIndex) {
                this._selectedTabIndex -= 1;
            }

            return;
        }

        const newIndex = closedIndex > 0 ? closedIndex - 1 : 0;
        this._selectedTabIndex = newIndex;

        this._bar.setActiveVisual(this._contents[newIndex].id);
    }

    /**
     * Registers a listener for the `"tabclose"` event, which fires after a tab
     * is closed, receiving the content component that was removed.
     *
     * @param event - The `"tabclose"` event.
     * @param listener - The callback to invoke when a tab is closed.
     *
     * @returns This tab layout, for method chaining.
     */
    on(event: "tabclose", listener: (component: Component) => void): this;
    /**
     * Registers a listener for the `"empty"` event, which fires after the strip
     * loses its last tab by any path (close, tear-off, or re-dock). It carries
     * no payload — a passive announcement; the subscriber decides what to do.
     *
     * @param event - The `"empty"` event.
     * @param listener - The zero-argument callback to invoke when the strip empties.
     *
     * @returns This tab layout, for method chaining.
     */
    on(event: "empty", listener: () => void): this;
    /**
     * Registers a listener for the `"detached"` event, which fires after a tab is
     * torn off into a new floating window, carrying that window. Unlike `"empty"`,
     * it fires whether or not the tear-off left the source strip empty — so a
     * tree owner such as [`Dock`](/api/core/classes/Dock) can react to *every*
     * tear-off, not just the ones that drain the strip.
     *
     * @param event - The `"detached"` event.
     * @param listener - Invoked with the torn-off window.
     *
     * @returns This tab layout, for method chaining.
     */
    on(event: "detached", listener: (window: AbstractWindow) => void): this;
    on(event: TabEvent,   listener: Function): this {
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
     * @returns This tab layout, for method chaining.
     */
    off(event: TabEvent, listener: Function): this {
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
    protected emit(event: "tabclose", component: Component): void;
    protected emit(event: "empty"): void;
    protected emit(event: "detached", window: AbstractWindow): void;
    protected emit(event: TabEvent,   ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }
}

const TabCallable = callable(Tab);
type TabCallable = Tab;
export {
    Tab         as _Tab,
    TabCallable as Tab
};
