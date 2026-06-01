// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Size } from "~/primitive/Size.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { Component } from "~/core/Component.js";
import { ThemeManager } from "~/core/Theme.js";
import { Event } from "~/core/Event.js";
import { Animation } from "~/core/Animation.js";
import { Insets } from "~/primitive/Insets.js";
import { FillType } from "~/layout/FillType.js";
import { ButtonGroup } from "~/core/ButtonGroup.js";
import { RovingTabIndex } from "~/core/RovingTabIndex.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { TabCloseButton } from "~/component/button/TabCloseButton.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link Tab}.
 *
 * @category Layouts
 */
export type TabEvent = "tabclose";

/**
 * Tab-button width strategy for the {@link Tab} strip.
 *
 * - `"fill"` — tabs split the strip equally and stretch to fill it.
 * - `"content"` — each tab takes its own content width, capped at `tabMaxWidth`.
 * - `"equal"` — every tab takes the width of the widest tab, capped at
 *   `tabMaxWidth` (default).
 * - `"fixed"` — every tab takes `tabFixedWidth`.
 *
 * Every mode except `"fill"` leaves the strip full-width with the tabs
 * left-aligned and any leftover space empty.
 *
 * @category Layouts
 */
export type TabWidthMode = "fill" | "content" | "equal" | "fixed";

/**
 * Duration (ms) shared by the cross-tab content fade-in and the selection
 * indicator's slide. Matches `AnimatedDropdown`'s default so tabs and the
 * ComboBox caret animate at the same pace.
 */
const TAB_FADE_DURATION_MS = 120;

/** Side length (px) of the square close button overlaid on closeable tabs. */
const CLOSE_BUTTON_SIZE = 16;

/** Side length (px) of the ✕ glyph inside the close button (half the hit box). */
const CLOSE_GLYPH_SIZE = 8;

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
    };

    /** Tab-button width strategy; defaults to `"equal"`. */
    tabWidthMode?: TabWidthMode;

    /** Per-tab maximum width in px for `"content"` / `"equal"` modes; `null` (the default) leaves tabs uncapped. */
    tabMaxWidth?: number | null;

    /** Per-tab width in px for `"fixed"` mode; defaults to `120`. */
    tabFixedWidth?: number;

    /**
     * Whether the 1px strip under-border runs edge-to-edge. When omitted, follows
     * the active theme's `tab.underBorderFullWidth` (Modern `false`, Classic/Dark
     * `true`); setting it explicitly pins the value and stops it tracking the theme.
     */
    tabUnderBorderFullWidth?: boolean;
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
 * Bookkeeping record for one tab slot.
 *
 * @remarks `component` is `null` for entries registered via `addLazyTab` until the
 * first activation; on materialization, the factory runs and the produced component
 * is cached here. Eager entries (created by `createTab`) populate `component`
 * immediately and leave `factory` null. The component reference is stored on the
 * entry rather than looked up by index in `container.getComponents()` because lazy
 * tabs may materialize out of order — `Component.addComponent` always appends, so
 * indices between `tabs[]` and the container's component list do not stay aligned.
 *
 * `spinner` carries the placeholder Component that `Animation.materialize`
 * mounts into the container during the factory's two-rAF yield, so the
 * layout pass can surface it as the visible child while the build is in
 * flight.
 */
interface TabEntry {
    wrapper: Component;
    button: ToggleButton;
    closeButton?: TabCloseButton;
    component: Component | null;
    factory: (() => Component) | null;
    constraints?: LayoutConstraints;
    spinner: Component | null;
    state: TabEntryState;
}

/**
 * The single shared selection bar that slides under the active tab. Styles
 * itself entirely from theme tokens; {@link Tab} drives its horizontal position
 * and width via {@link slideTo} on each layout pass.
 *
 * @remarks Lives as a raw-appended overlay inside the tab toolbar's element
 * rather than a laid-out child, so the toolbar's `HBox` never allocates it a
 * tab-cell slot.
 */
class TabIndicator extends Component {
    private _barLeft: number = 0;

    /**
     * Builds the indicator. Colour and the fade transition go through the
     * framework-tracked setters so they survive `applyStyle`'s inline-style
     * wipe; the token-driven bottom/height geometry is re-applied in the
     * `applyStyle` override below, which the base setters don't know about.
     */
    constructor() {
        super();

        this.setBackgroundColor("var(--ts-ui-tab-indicator-color, #1a73e8)");
        this.setTransition(`transform ${TAB_FADE_DURATION_MS}ms ease, width ${TAB_FADE_DURATION_MS}ms ease`);
        this.setPointerEvents("none");
        // Raw-appended before any tab wrapper exists, so it sits first in DOM
        // order; lift it above the opaque tab buttons that would otherwise
        // paint over its 2px sliver.
        this.setZIndex(2);
    }

    /**
     * Positions the bar over the active tab cell. `width` routes through the
     * tracked `setWidth` (replayed by `applyStyle`); the horizontal offset is
     * cached and written as a `transform` via {@link applyBarGeometry}.
     *
     * @param left - The active tab cell's left offset within the strip, in px.
     * @param width - The active tab cell's width, in px.
     *
     * @returns This indicator, for chaining.
     */
    slideTo(left: number, width: number): this {
        this._barLeft = left;
        this.setWidth(width);

        if (this.getElement()) {
            this.applyBarGeometry();
        }

        return this;
    }

    /**
     * Re-applies the token-driven bar geometry after the base re-render, which
     * strips inline styles and only replays the fields it tracks.
     *
     * @param element - The indicator's DOM element.
     *
     * @returns This indicator, for chaining.
     */
    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);
        this.applyBarGeometry();

        return this;
    }

    /**
     * Writes the absolute bottom-edge placement, token thickness, and current
     * horizontal transform — the styles the base `applyStyle` doesn't replay.
     *
     * @returns This indicator, for chaining.
     */
    private applyBarGeometry(): this {
        return this.setElementStyles({
            left     : "0",
            bottom   : "0",
            height   : "var(--ts-ui-tab-indicator-thickness, 2px)",
            transform: `translateX(${this._barLeft}px)`,
        });
    }
}

/**
 * A layout manager that renders a row of tab buttons above the container content area
 * and shows exactly one child component at a time based on the selected tab.
 * Tab button labels are taken from `LayoutConstraints.name` when available,
 * otherwise from the component's ID.
 *
 * @category Layouts
 */
class Tab extends LayoutManager {

    private _toolbar: Component = new Component();
    private _tabs: Array<TabEntry> = [];
    private _buttonGroup: ButtonGroup = new ButtonGroup();
    private _rovingTabIndex: RovingTabIndex = new RovingTabIndex();
    private _selectedTabIndex: number = 0;
    // Last tab index that was faded in during a doLayout pass. Compared
    // against `selectedTabIndex` so the cross-tab fade fires only on actual
    // selection changes (not on every relayout, e.g. window resize).
    private _lastFadedTabIndex: number = -1;
    private _listeners: ListenerBag<TabEvent> = new ListenerBag<TabEvent>();

    private _tabWidthMode: TabWidthMode = "equal";
    private _tabMaxWidth: number | null = null;
    private _tabFixedWidth: number = 120;
    private _underBorderFullWidth: boolean = true;
    private _underBorderFromTheme: boolean = true;
    private _themeCleanup: (() => void) | null = null;
    private _indicator: TabIndicator = new TabIndicator();

    /**
     * Creates a Tab layout manager with an empty toolbar.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TabOptions) {
        super();

        this._underBorderFullWidth = ThemeManager.getTheme().tab.underBorderFullWidth;

        this._toolbar.setLayoutManager(new HBox({ mode: "equal", spacing: 0 }));
        this._toolbar.setBackgroundColor("var(--ts-ui-tab-toolbar-bg, #eee)");
        this._toolbar.clearInsets();
        this.applyUnderBorder();
        this._toolbar.setPreferredSize(0, 30);

        // Follow the active theme's under-border default until a consumer pins
        // it explicitly. Torn down in detach().
        this._themeCleanup = ThemeManager.onThemeChange(() => {
            if (!this._underBorderFromTheme) {
                return;
            }

            this._underBorderFullWidth = ThemeManager.getTheme().tab.underBorderFullWidth;
            this.applyUnderBorder();
            this.getContainer()?.scheduleLayout();
        });

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies the current `_underBorderFullWidth` value to the toolbar: a
     * full-width 1px rule when set, no border when cleared.
     */
    private applyUnderBorder(): void {
        if (this._underBorderFullWidth) {
            this._toolbar.setBorder({ border: "1px solid var(--ts-ui-tab-toolbar-border, #e1e1e8)" });
        } else {
            this._toolbar.clearBorder();
        }
    }

    /**
     * Applies a {@link TabOptions} bag, dispatching the close callback
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TabOptions): void {
        super.applyOptions(options);

        if (options.listeners?.tabclose !== undefined) {
            this.on("tabclose", options.listeners.tabclose);
        }

        if (options.tabWidthMode !== undefined) {
            this.setTabWidthMode(options.tabWidthMode);
        }

        if (options.tabMaxWidth !== undefined) {
            this.setTabMaxWidth(options.tabMaxWidth);
        }

        if (options.tabFixedWidth !== undefined) {
            this.setTabFixedWidth(options.tabFixedWidth);
        }

        if (options.tabUnderBorderFullWidth !== undefined) {
            this.setTabUnderBorderFullWidth(options.tabUnderBorderFullWidth);
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
    setTabWidthMode(mode: TabWidthMode): this {
        this._tabWidthMode = mode;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-button width strategy.
     *
     * @returns The active {@link TabWidthMode}.
     */
    getTabWidthMode(): TabWidthMode {
        return this._tabWidthMode;
    }

    /**
     * Sets the per-tab width cap used by the `"content"` and `"equal"` width
     * modes, then re-lays out the strip.
     *
     * @param px - The maximum width per tab in px, or `null` to remove the cap.
     *
     * @returns This layout manager, for chaining.
     */
    setTabMaxWidth(px: number | null): this {
        this._tabMaxWidth = px;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current per-tab maximum width.
     *
     * @returns The cap in px, or `null` when tabs are uncapped.
     */
    getTabMaxWidth(): number | null {
        return this._tabMaxWidth;
    }

    /**
     * Sets the per-tab width used by the `"fixed"` width mode, then re-lays out
     * the strip.
     *
     * @param px - The fixed width per tab in px.
     *
     * @returns This layout manager, for chaining.
     */
    setTabFixedWidth(px: number): this {
        this._tabFixedWidth = px;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the per-tab width used by the `"fixed"` width mode.
     *
     * @returns The fixed width in px.
     */
    getTabFixedWidth(): number {
        return this._tabFixedWidth;
    }

    /**
     * Applies the active {@link TabWidthMode} to the toolbar layout and every
     * tab wrapper. Called from `doLayout` before the toolbar lays out so the
     * widths are in place when the strip positions its tabs.
     *
     * @remarks `"fill"` uses the toolbar's `equal` HBox (tabs stretch to share
     * the strip). Every other mode switches to `preferred` (tabs left-aligned,
     * leftover empty) and pins each wrapper's width: `"content"` caps the
     * natural width at `tabMaxWidth`; `"equal"` and `"fixed"` clamp min and max
     * to a single uniform width so every tab matches. `"equal"` additionally
     * collapses to `"fill"` when its uniform width would overflow `available`,
     * so the tabs shrink to share the strip rather than spilling past it.
     *
     * @param available - The strip's inner content width (px) the tabs must fit within.
     */
    private applyTabWidths(available: number): void {
        const hbox = this._toolbar.getLayoutManager() as HBox;

        if (this._tabWidthMode === "fill") {
            hbox.setMode("equal");

            for (const entry of this._tabs) {
                entry.wrapper.setMinSize(0, 0);
                entry.wrapper.setMaxSize(Number.MAX_VALUE, Number.MAX_VALUE);
            }

            return;
        }

        hbox.setMode("preferred");

        if (this._tabWidthMode === "content") {
            const cap = this._tabMaxWidth ?? Number.MAX_VALUE;

            for (const entry of this._tabs) {
                entry.wrapper.setMinSize(0, 0);
                entry.wrapper.setMaxSize(cap, Number.MAX_VALUE);
            }

            return;
        }

        // "equal" / "fixed": pin every wrapper to a single uniform width.
        let width: number;

        if (this._tabWidthMode === "fixed") {
            width = this._tabFixedWidth;
        } else {
            let widest = 0;

            for (const entry of this._tabs) {
                const preferred = entry.button.getPreferredSize();

                if (preferred) {
                    widest = Math.max(widest, preferred.width);
                }
            }

            width = Math.min(widest, this._tabMaxWidth ?? Number.MAX_VALUE);
        }

        // Pre-measurement guard: fall back to natural widths until the tab
        // buttons have reported a real preferred size.
        if (width <= 0) {
            for (const entry of this._tabs) {
                entry.wrapper.setMinSize(0, 0);
                entry.wrapper.setMaxSize(Number.MAX_VALUE, Number.MAX_VALUE);
            }

            return;
        }

        // "equal" shrinks to fit: when the uniform width can't fit the strip,
        // collapse to fill so the tabs share the available width instead of
        // overflowing. "fixed" stays rigid (overflow is the consumer's intent).
        if (this._tabWidthMode === "equal" && this._tabs.length > 0 && width * this._tabs.length > available) {
            hbox.setMode("equal");

            for (const entry of this._tabs) {
                entry.wrapper.setMinSize(0, 0);
                entry.wrapper.setMaxSize(Number.MAX_VALUE, Number.MAX_VALUE);
            }

            return;
        }

        for (const entry of this._tabs) {
            entry.wrapper.setMinSize(width, 0);
            entry.wrapper.setMaxSize(width, Number.MAX_VALUE);
        }
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
    setTabUnderBorderFullWidth(full: boolean): this {
        this._underBorderFromTheme = false;
        this._underBorderFullWidth = full;

        this.applyUnderBorder();

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether the strip's under-border runs edge-to-edge.
     *
     * @returns `true` when the full-width under-border is drawn.
     */
    isTabUnderBorderFullWidth(): boolean {
        return this._underBorderFullWidth;
    }

    /**
     * Updates the selected tab index, syncs the roving tabindex, and triggers a re-layout when a tab button is clicked.
     *
     * @param tab - The tab button component that was pressed.
     */
    onTabPressed(tab: Component): void {
        const idx = this._tabs.findIndex(entry => entry.button === tab);

        if (idx >= 0) {
            this._selectedTabIndex = idx;
            this._rovingTabIndex.moveTo(idx);

            const entry = this._tabs[idx];
            if (entry.state === "lazy") {
                this.materializeAsync(idx);
            }
        }

        this.getContainer()?.scheduleLayout();
    }

    /**
     * Attaches to a container and appends the tab toolbar element to it.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component): this {
        super.attach(container);

        let element = this._toolbar.getElement(true);
        container.getElement(true).appendChild(element);

        // Raw-append the selection indicator as an overlay inside the toolbar
        // element. Going through `addComponent` would enrol it in the toolbar's
        // `HBox`, which would then allocate it a tab-cell slot and shrink the
        // real buttons; the indicator must be positioned manually instead.
        element.appendChild(this._indicator.getElement(true));

        this._toolbar.getAria().setRole("tablist");

        Event.addSubtreeListener(this._toolbar, "keydown", (e: KeyboardEvent) => this.onToolbarKeyDown(e));

        return this;
    }

    /**
     * Detaches from the container and removes the tab toolbar element from the DOM.
     */
    detach(): this {
        super.detach();

        if (this._themeCleanup) {
            this._themeCleanup();
            this._themeCleanup = null;
        }

        this._toolbar.getElement().remove();

        return this;
    }

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

        const entry = this._tabs[this._selectedTabIndex];
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
     * Returns the preferred size: the visible component's preferred size plus the toolbar height.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or visible component.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getPreferredSize();
        if (!size) {
            return null;
        }

        let toolbarSize = this._toolbar.getPreferredSize();
        if (!toolbarSize) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + toolbarSize.height + outerHeight
        };
    }

    /**
     * Returns the minimum size: the visible component's minimum size plus the toolbar minimum height.
     *
     * @returns The minimum `{width, height}`, or `null` if there is no container or visible component.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getMinSize();
        if (!size) {
            return null;
        }

        let toolbarSize = this._toolbar.getMinSize();
        if (!toolbarSize) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + toolbarSize.height + outerHeight
        };
    }

    /**
     * Returns the maximum size: the visible component's maximum size plus the toolbar maximum height.
     *
     * @returns The maximum `{width, height}`, or `null` if there is no container or visible component.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getMaxSize();
        if (!size) {
            return null;
        }

        let toolbarSize = this._toolbar.getMaxSize();
        if (!toolbarSize) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + toolbarSize.height + outerHeight
        };
    }

    /**
     * Builds the toolbar wrapper, toggle button, and optional close button for one
     * tab slot, registers them with the button group / roving tab index, and pushes
     * the entry onto `this.tabs`. The component-side ARIA wiring is left to the
     * caller because the content component may not exist yet (lazy entries).
     *
     * @param name - The visible label for the tab button.
     * @param constraints - Optional layout constraints; `constraints.closeable` adds a close button.
     * @returns The newly-registered tab entry with `component` and `factory` set to `null`.
     */
    private buildTabEntry(name: string, constraints?: LayoutConstraints): TabEntry {
        let tabButton = new ToggleButton(name);

        // Unselected fill. ToggleButton inherits Button's `--ts-ui-button-bg`
        // gradient on `background-image`, which otherwise paints over the tab
        // colour below and makes `--ts-ui-tab-button-bg` invisible. Route the
        // same tab token through the image layer so a colour value drops out
        // (invalid as an image) and a gradient value wins — killing the
        // gradient bleed-through.
        tabButton.setBackgroundColor("var(--ts-ui-tab-button-bg, #b8b8c3)");
        tabButton.setBackgroundImage("var(--ts-ui-tab-button-bg, #b8b8c3)");
        tabButton.setBorder({
            borderTop:    "var(--ts-ui-tab-button-border-top,    var(--ts-ui-tab-button-border, none))",
            borderRight:  "var(--ts-ui-tab-button-border-right,  var(--ts-ui-tab-button-border, none))",
            borderBottom: "var(--ts-ui-tab-button-border-bottom, var(--ts-ui-tab-button-border, none))",
            borderLeft:   "var(--ts-ui-tab-button-border-left,   var(--ts-ui-tab-button-border, none))",
        });
        tabButton.clearBorderRadius();
        tabButton.clearShadow();

        // Hover state.
        tabButton.setHoverBackgroundColor("var(--ts-ui-tab-button-hover-bg, #c4c4cf)");
        tabButton.setHoverBackgroundImage("var(--ts-ui-tab-button-hover-bg, #c4c4cf)");
        tabButton.setHoverShadow("none");
        tabButton.setHoverBorder({
            borderTop:    "var(--ts-ui-tab-button-hover-border-top,    var(--ts-ui-tab-button-hover-border, none))",
            borderRight:  "var(--ts-ui-tab-button-hover-border-right,  var(--ts-ui-tab-button-hover-border, none))",
            borderBottom: "var(--ts-ui-tab-button-hover-border-bottom, var(--ts-ui-tab-button-hover-border, none))",
            borderLeft:   "var(--ts-ui-tab-button-hover-border-left,   var(--ts-ui-tab-button-hover-border, none))",
        });

        // Selected (active) state.
        tabButton.setSelectedBackgroundColor("var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))");
        tabButton.setSelectedBackgroundImage("var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))");
        tabButton.setSelectedShadow("none");
        tabButton.setSelectedBorder({
            borderTop:    "var(--ts-ui-tab-button-selected-border-top,    var(--ts-ui-tab-button-selected-border, none))",
            borderRight:  "var(--ts-ui-tab-button-selected-border-right,  var(--ts-ui-tab-button-selected-border, none))",
            borderBottom: "var(--ts-ui-tab-button-selected-border-bottom, var(--ts-ui-tab-button-selected-border, none))",
            borderLeft:   "var(--ts-ui-tab-button-selected-border-left,   var(--ts-ui-tab-button-selected-border, none))",
        });

        // Reserve room on the right for the overlaid close button on closeable
        // tabs so a long label doesn't run under the ✕.
        const rightInset = constraints?.closeable ? CLOSE_BUTTON_SIZE + 4 : 4;
        tabButton.setInsets(new Insets(0, rightInset, 0, 4));
        tabButton.getText().setInsets(new Insets(0, 4, 0, 4));

        tabButton.on("action", () => this.onTabPressed(tabButton));

        // The tab button fills the whole cell (Fit) so its per-state background
        // spans the full width; the close button is overlaid on top at the
        // right rather than placed as a sibling, so the tab reads as one
        // surface with a ✕ in its corner instead of two abutting buttons.
        const wrapper = new Component();
        wrapper.setLayoutManager(new Fit());
        wrapper.setBackgroundColor("transparent");
        wrapper.clearBorder();
        wrapper.clearShadow();
        wrapper.setInsets(new Insets(0, 0, 0, 0));

        wrapper.addComponent(tabButton);

        let closeButton: TabCloseButton | undefined;

        if (constraints?.closeable) {
            closeButton = new TabCloseButton();

            // Transparent so the tab's own background shows through; a faint
            // rounded tint on hover gives the ✕ its affordance.
            closeButton.setBackgroundColor("transparent");
            closeButton.setBackgroundImage("none");
            closeButton.setHoverBackgroundColor("var(--ts-ui-tab-close-hover-bg, rgba(0, 0, 0, 0.12))");
            closeButton.setHoverBackgroundImage("none");
            closeButton.setHoverShadow("none");
            closeButton.setBorderRadius("3px");
            closeButton.clearBorder();
            closeButton.clearShadow();
            closeButton.setZIndex(1);

            // Shrink the ✕ glyph to half the hit box, centred — the 16px button
            // stays the click target while the mark itself reads lighter.
            const glyph = closeButton.getGlyph();

            if (glyph) {
                glyph.setPreferredSize(CLOSE_GLYPH_SIZE, CLOSE_GLYPH_SIZE);
                glyph.setMinSize(CLOSE_GLYPH_SIZE, CLOSE_GLYPH_SIZE);
                glyph.setMaxSize(CLOSE_GLYPH_SIZE, CLOSE_GLYPH_SIZE);
            }

            // Overlay it inside the cell rather than enrolling it in the Fit
            // layout (which would stretch it over the whole tab); `doLayout`
            // pins it to the right edge.
            wrapper.getElement(true).appendChild(closeButton.getElement(true));
        }

        const entry: TabEntry = {
            wrapper,
            button: tabButton,
            closeButton,
            component: null,
            factory: null,
            constraints,
            spinner: null,
            state: "lazy"
        };

        if (closeButton) {
            closeButton.on("action", () => this.closeTab(entry));
        }

        this._tabs.push(entry);

        const isSelected = this._tabs.length - 1 === this._selectedTabIndex;

        if (isSelected) {
            tabButton.setSelected(true);
        }

        this._buttonGroup.addButton(tabButton);
        this._rovingTabIndex.add(tabButton);
        this._toolbar.addComponent(wrapper);

        tabButton.getAria().setRole("tab");
        tabButton.getAria().setSelected(isSelected);

        return entry;
    }

    /**
     * Wires the component-side ARIA so the panel is announced as the tabpanel
     * controlled by the tab button.
     *
     * @param entry - The tab entry whose button labels and controls the component.
     * @param component - The content component to attach ARIA roles to.
     */
    private wireComponentAria(entry: TabEntry, component: Component): void {
        entry.button.getAria().setControls(component.getId());

        component.getAria().setRole("tabpanel");
        component.getAria().setTabIndex(-1);
        component.getAria().setLabelledBy(entry.button.getId());
    }

    /**
     * Creates a tab entry for a component and adds it to the toolbar.
     *
     * @param component - The content component for which a tab entry should be created.
     *
     * @remarks The button label is taken from `LayoutConstraints.name` when available;
     * otherwise the component's ID is used. When `constraints.closeable` is true, a
     * [`TabCloseButton`](/api/component/button/classes/TabCloseButton) is appended to the wrapper after the toggle button.
     */
    createTab(component: Component): void {
        let constraints = this.getLayoutConstraints(component);
        let name: string;

        if (constraints && constraints.name) {
            name = constraints.name;
        } else {
            name = component.getId();
        }

        const entry = this.buildTabEntry(name, constraints);

        entry.component = component;
        entry.factory = null;
        entry.state = "ready";

        this.wireComponentAria(entry, component);
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
        const entry = this.buildTabEntry(name, constraints);

        entry.factory   = factory;
        entry.component = null;
        entry.state     = "lazy";
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
     * @param idx - Zero-based index into `this.tabs`.
     *
     * @remarks Replaces the previous synchronous `materialize` path. Layout-
     * sizing queries (`getPreferredSize` / `getMinSize` / `getMaxSize`) no
     * longer trigger factory invocations — they observe the spinner placeholder
     * until the build completes.
     */
    private materializeAsync(idx: number): void {
        const entry = this._tabs[idx];
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

                this.wireComponentAria(entry, component);
                container.scheduleLayout();
            }
        });
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * width is `max(toolbar.preferredWidth, visibleChild.minWidth)`; height
     * is `toolbar.preferredHeight + visibleChild.minHeight`. Used by
     * `doLayout` to inflate the content area's working size when the host
     * has opted into `setOverflowing`; the toolbar's geometry is unaffected.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const toolbarSize = this._toolbar.getPreferredSize();
        const toolbarW = toolbarSize ? toolbarSize.width  : 0;
        const toolbarH = toolbarSize ? toolbarSize.height : 0;

        const visible = this.getVisibleComponent() ?? container.getComponents()[0];
        const childMin = visible?.getMinSize();
        const childMinW = childMin ? childMin.width  : 0;
        const childMinH = childMin ? childMin.height : 0;

        return {
            width:  Math.max(toolbarW, childMinW),
            height: toolbarH + childMinH,
        };
    }

    /**
     * Creates tab buttons for new components, hides all but the selected child,
     * and positions the toolbar and the visible component.
     *
     * @remarks Tab buttons are created lazily: only components that do not yet have
     * a corresponding button receive one. The toolbar is positioned at the top of the
     * container and the visible component occupies the remaining space beneath it.
     */
    doLayout(): void {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let containerSize = container.getInnerSize();
        let containerInsets = container.getContentInsets();

        // Catch the tab strip up to any container child that no tab entry owns
        // yet — the bare-`Panel` eager path, where a consumer called
        // `addComponent` directly and expects a tab to appear.
        // `Animation.materialize` also injects children (the built lazy panels
        // and the transient spinner), but each of those is referenced by an
        // existing entry's `component`/`spinner`, so the ownership test skips
        // them and they never become phantom UUID-labelled tabs.
        let owned = new Set<Component>();
        for (let entry of this._tabs) {
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
        // selections route through onTabPressed.
        const initialEntry = this._tabs[this._selectedTabIndex];
        if (initialEntry && initialEntry.state === "lazy") {
            this.materializeAsync(this._selectedTabIndex);
        }

        for (let idx in components) {
            let component = components[idx];
            component.setVisible(false);
            component.getAria().setHidden(true);
        }

        for (let i = 0; i < this._tabs.length; i++) {
            this._tabs[i].button.getAria().setSelected(i === this._selectedTabIndex);
        }

        let component = this.getVisibleComponent();

        if (!component && components.length > 0) {
            component = components[0];
        }

        let toolbarSize = this._toolbar.getPreferredSize();
        let toolbarHeight = toolbarSize ? toolbarSize.height : 0;

        this._toolbar.setX(containerInsets.getLeft());
        this._toolbar.setY(containerInsets.getTop());
        this._toolbar.setWidth(containerSize ? containerSize.width : 0);
        this._toolbar.setHeight(toolbarHeight);

        // Inner width available to the tab strip: toolbar width minus its own
        // horizontal border (the under-border, when present, draws all four sides).
        const toolbarBorder = this._toolbar.getBorderSize();
        const available     = (containerSize ? containerSize.width : 0) - toolbarBorder.left - toolbarBorder.right;

        this.applyTabWidths(available);
        this._toolbar.doLayout();

        // Slide the selection bar over the active tab cell. The HBox has just
        // positioned every wrapper, so the active wrapper's left/width are
        // valid; guard against the pre-render pass where the cell has no width.
        const activeWrapper = this._tabs[this._selectedTabIndex]?.wrapper;

        if (activeWrapper && activeWrapper.getWidth() > 0) {
            this._indicator.slideTo(activeWrapper.getX(), activeWrapper.getWidth());
        }

        // Pin each close button to the right edge of its (now-sized) tab cell,
        // vertically centred. It overlays the tab button rather than sharing a
        // layout row, so it is positioned by hand here.
        for (const entry of this._tabs) {
            const closeButton = entry.closeButton;

            if (closeButton && entry.wrapper.getWidth() > 0) {
                closeButton.setWidth(CLOSE_BUTTON_SIZE);
                closeButton.setHeight(CLOSE_BUTTON_SIZE);
                closeButton.setX(entry.wrapper.getWidth() - CLOSE_BUTTON_SIZE - 2);
                closeButton.setY(Math.round((entry.wrapper.getHeight() - CLOSE_BUTTON_SIZE) / 2));
            }
        }

        if (!component) {
            return;
        }

        component.setVisible(true);
        component.getAria().setHidden(false);

        // Universal scroll: only the content area honours the overflow flags;
        // the toolbar always renders at the container's original width so its
        // own internal `ToolBar` overflow mechanism stays in charge of long
        // tab lists (see plan's Non-Goals).
        let contentWidth  = containerSize ? containerSize.width                 : 0;
        let contentHeight = containerSize ? containerSize.height - toolbarHeight : 0;

        if (containerSize && (this.isOverflowingX() || this.isOverflowingY())) {
            const totalMin = this.computeTotalMinSize();
            if (this.isOverflowingX()) {
                contentWidth  = Math.max(contentWidth,  totalMin.width);
            }
            if (this.isOverflowingY()) {
                // totalMin.height already includes toolbarH; subtract it to
                // get the content-area's own minimum.
                contentHeight = Math.max(contentHeight, totalMin.height - toolbarHeight);
            }
        }

        this.placeComponent(
            component,
            containerInsets.getLeft(),
            containerInsets.getTop() + toolbarHeight,
            contentWidth,
            contentHeight,
            FillType.BOTH
        );

        // Fade the newly-visible child in only when the selection actually
        // changed since the last layout AND the entry is fully built — for a
        // lazy tab still mid-build, the spinner placeholder is what's on
        // screen and `Animation.materialize` runs the content fade itself.
        const selectedEntry = this._tabs[this._selectedTabIndex];
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
     * Registers a listener for one of this tab layout's events.
     *
     * @param event - `"tabclose"` fires after a tab is closed, receiving
     *   the content component that was removed.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tab layout, for method chaining.
     */
    on(event: "tabclose", listener: (component: Component) => void): this;
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
    protected emit(event: TabEvent,   ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Removes a tab entry and its associated content component, then selects the next tab.
     *
     * @param entry - The tab entry to close.
     */
    private closeTab(entry: TabEntry): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const entryIndex = this._tabs.indexOf(entry);
        if (entryIndex < 0) {
            return;
        }

        const contentComponent = entry.component;

        this._buttonGroup.removeButton(entry.button);
        this._rovingTabIndex.remove(entry.button);
        this._tabs.splice(entryIndex, 1);
        this._toolbar.removeComponent(entry.wrapper);

        if (contentComponent) {
            container.removeComponent(contentComponent);
        }

        if (contentComponent) {
            this.emit("tabclose", contentComponent);
        }

        this.selectNextTab(entryIndex);
        this.getContainer()?.scheduleLayout();
    }

    /**
     * Selects an appropriate tab after the tab at `closedIndex` has been removed.
     *
     * @param closedIndex - The index that was just spliced out.
     */
    private selectNextTab(closedIndex: number): void {
        const count = this._tabs.length;

        if (count === 0) {
            this._selectedTabIndex = 0;

            return;
        }

        const newIndex = closedIndex > 0 ? closedIndex - 1 : 0;
        this._selectedTabIndex = newIndex;

        this._tabs.forEach(e => e.button.setSelected(false));
        this._tabs[newIndex].button.setSelected(true);
    }

    /**
     * Handles ArrowLeft / ArrowRight to move tab focus and activate the adjacent tab.
     *
     * @param e - The keyboard event fired on the toolbar element.
     */
    private onToolbarKeyDown(e: KeyboardEvent): void {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
            return;
        }

        const tabCount = this._tabs.length;

        if (tabCount === 0) {
            return;
        }

        e.preventDefault();

        const newIdx = e.key === 'ArrowRight'
            ? (this._selectedTabIndex + 1) % tabCount
            : (this._selectedTabIndex - 1 + tabCount) % tabCount;

        const newTab = this._tabs[newIdx].button;

        this._tabs.forEach(entry => entry.button.setSelected(false));
        newTab.setSelected(true);

        this.onTabPressed(newTab);
    }
}

const TabCallable = callable(Tab);
type TabCallable = Tab;
export {
    Tab         as _Tab,
    TabCallable as Tab
};
