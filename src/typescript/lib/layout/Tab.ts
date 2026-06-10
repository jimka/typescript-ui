// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Size } from "~/primitive/Size.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { Component } from "~/core/Component.js";
import { Panel } from "~/core/Panel.js";
import { ThemeManager } from "~/core/Theme.js";
import { Event } from "~/core/Event.js";
import { Animation } from "~/core/Animation.js";
import { Insets } from "~/primitive/Insets.js";
import { FillType } from "~/layout/FillType.js";
import { ButtonGroup } from "~/core/ButtonGroup.js";
import { RovingTabIndex } from "~/core/RovingTabIndex.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { BoxLayout } from "~/layout/BoxLayout.js";
import { Button } from "~/component/button/Button.js";
import { TabCloseButton } from "~/component/button/TabCloseButton.js";
import { Menu } from "~/core/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";
import { Glyph } from "~/component/display/Glyph.js";
import { angle_left } from "~/glyphs/solid/angle_left.js";
import { angle_right } from "~/glyphs/solid/angle_right.js";
import { angle_up } from "~/glyphs/solid/angle_up.js";
import { angle_down } from "~/glyphs/solid/angle_down.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { DragManager, DragEventDetail } from "~/core/DragManager.js";
import { callable } from "~/core/Callable.js";

// Register the overflow scroll-arrow glyphs so the arrows render regardless of
// which glyphs the consumer has imported (mirrors TabCloseButton's xmark seed).
Glyph.register(angle_left, angle_right, angle_up, angle_down);

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
 * Breathing room (px) added to each tab button's insets on top of the close-
 * button reservation. The historic value the strip was tuned against; reduced
 * to {@link TAB_BUTTON_INSET_COMPACT} when the strip is `compact`.
 */
const TAB_BUTTON_INSET = 4;

/** Reduced per-tab breathing room (px) used when the strip is `compact`. */
const TAB_BUTTON_INSET_COMPACT = 2;

/**
 * Strip thickness (px) on the cross axis — the toolbar's height for north/south
 * and its width for west/east. Matches the legacy `setPreferredSize(0, 30)`
 * seed the top-only strip was tuned against. Reduced to
 * {@link STRIP_THICKNESS_COMPACT} when the strip is `compact`.
 */
const STRIP_THICKNESS = 30;

/** Reduced cross-axis strip thickness (px) used when the strip is `compact`. */
const STRIP_THICKNESS_COMPACT = 24;

/**
 * Main-axis length (px) of each overflow scroll-arrow button — square against
 * the strip thickness. Wide enough to be an easy click target, matching the
 * default tab height.
 */
const SCROLL_ARROW_SIZE = 24;

/**
 * Pixels the strip scrolls per overflow-arrow click. One roughly-tab-width
 * nudge so repeated clicks page through the tabs without overshooting.
 */
const SCROLL_ARROW_STEP = 80;

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
    /**
     * The tab's display label — the same `name` the button was built with.
     * Held here so the context menu (and any other entry-level consumer) reads
     * the real label regardless of load state, rather than falling back to a
     * component id (loaded) or empty string (lazy) when `constraints.name` is
     * unset.
     */
    name: string;
    spinner: Component | null;
    state: TabEntryState;
    /**
     * The wrapper's `contextmenu` subtree listener, retained so `closeTab` can
     * remove it. Subtree listeners are keyed by component id in a module-level
     * map (see {@link Event.addSubtreeListener}); removing the wrapper's element
     * does not purge that map, so the listener must be torn down explicitly or
     * it (and the entry it closes over) leaks across open/close churn.
     */
    contextMenuListener: (e: MouseEvent) => void;
}

/**
 * The single shared selection bar that slides along the active tab. Styles
 * itself entirely from theme tokens; {@link Tab} drives its position and extent
 * via {@link slideTo} on each layout pass.
 *
 * @remarks Lives as a raw-appended overlay inside the tab toolbar's element
 * rather than a laid-out child, so the toolbar's box never allocates it a
 * tab-cell slot. The bar pins to the strip's *inner* edge (bottom for north,
 * top for south, right for west, left for east) and slides along the strip's
 * main axis (X for north/south, Y for west/east).
 */
class TabIndicator extends Component {
    private _mainPos: number = 0;
    private _mainExtent: number = 0;
    private _side: TabSide = "north";

    /**
     * Builds the indicator. Colour and the slide transition go through the
     * framework-tracked setters so they survive `applyStyle`'s inline-style
     * wipe; the token-driven edge geometry is re-applied in the `applyStyle`
     * override below, which the base setters don't know about.
     */
    constructor() {
        super();

        this.setBackgroundColor("var(--ts-ui-tab-indicator-color, #1a73e8)");
        this.setTransition(`transform ${TAB_FADE_DURATION_MS}ms ease, width ${TAB_FADE_DURATION_MS}ms ease, height ${TAB_FADE_DURATION_MS}ms ease`);
        this.setPointerEvents("none");
        // Raw-appended before any tab wrapper exists, so it sits first in DOM
        // order; lift it above the opaque tab buttons that would otherwise
        // paint over its 2px sliver.
        this.setZIndex(2);
    }

    /**
     * Positions the bar over the active tab cell along the strip's main axis.
     *
     * @param mainPos - The active cell's main-axis offset within the strip (X
     *   for north/south, Y for west/east), in px.
     * @param mainExtent - The active cell's main-axis extent (width for
     *   north/south, height for west/east), in px.
     * @param side - The active {@link TabSide}, selecting the pinned inner edge.
     *
     * @returns This indicator, for chaining.
     */
    slideTo(mainPos: number, mainExtent: number, side: TabSide): this {
        this._mainPos = mainPos;
        this._mainExtent = mainExtent;
        this._side = side;

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
     * Writes the inner-edge placement, token thickness, main-axis extent, and
     * current slide transform — the styles the base `applyStyle` doesn't replay.
     * North/south draw a horizontal bar on the bottom/top edge sized by `width`
     * and slid with `translateX`; west/east draw a vertical bar on the right/left
     * edge sized by `height` and slid with `translateY`.
     *
     * @returns This indicator, for chaining.
     */
    private applyBarGeometry(): this {
        const thickness = "var(--ts-ui-tab-indicator-thickness, 2px)";
        const vertical = this._side === "west" || this._side === "east";

        if (vertical) {
            return this.setElementStyles({
                top      : "0",
                bottom   : "auto",
                left     : this._side === "east" ? "0" : "auto",
                right    : this._side === "west" ? "0" : "auto",
                width    : thickness,
                height   : this._mainExtent + "px",
                transform: `translateY(${this._mainPos}px)`,
            });
        }

        return this.setElementStyles({
            left     : "0",
            right    : "auto",
            top      : this._side === "south" ? "0" : "auto",
            bottom   : this._side === "north" ? "0" : "auto",
            width    : this._mainExtent + "px",
            height   : thickness,
            transform: `translateX(${this._mainPos}px)`,
        });
    }
}

/**
 * The insertion rule shown during a within-strip tab drag-reorder. Like
 * {@link TabIndicator} it is a raw-appended overlay inside the toolbar element
 * (so the box never allocates it a cell) and is driven entirely by {@link Tab}.
 * Unlike the indicator it is main-axis-aware: a thin vertical rule for
 * north/south strips, a thin horizontal rule for west/east strips.
 *
 * @remarks Geometry is written through the framework-tracked `setX` / `setY` /
 * `setWidth` / `setHeight` / `setVisible` setters, all of which the base
 * `applyStyle` replays, so no custom replay override is needed.
 */
class TabReorderBar extends Component {

    /** Insertion-rule thickness (px) along the strip's main axis. */
    private static readonly THICKNESS = 2;

    /**
     * Builds the rule: the shared drag-reorder colour, no pointer events, lifted
     * above the opaque tab buttons, hidden until a drag positions it.
     */
    constructor() {
        super();

        this.setBackgroundColor("var(--ts-ui-drag-reorder-color, #1a73e8)");
        this.setPointerEvents("none");
        this.setZIndex(2);
        this.setVisible(false);
    }

    /**
     * Positions the rule at a slot boundary and shows it.
     *
     * @param mainCoord - The boundary's leading-edge offset on the strip's main
     *   axis (X for north/south, Y for west/east), in px.
     * @param crossExtent - The strip's cross-axis thickness the rule spans, in px.
     * @param vertical - `true` for west/east strips (a horizontal rule), `false`
     *   for north/south strips (a vertical rule).
     *
     * @returns This reorder bar, for chaining.
     */
    placeAt(mainCoord: number, crossExtent: number, vertical: boolean): this {
        if (vertical) {
            this.setX(0);
            this.setY(mainCoord);
            this.setWidth(crossExtent);
            this.setHeight(TabReorderBar.THICKNESS);
        } else {
            this.setX(mainCoord);
            this.setY(0);
            this.setWidth(TabReorderBar.THICKNESS);
            this.setHeight(crossExtent);
        }

        this.setVisible(true);

        return this;
    }

    /**
     * Hides the insertion rule (drag left the strip, or the drop completed).
     *
     * @returns This reorder bar, for chaining.
     */
    hide(): this {
        this.setVisible(false);

        return this;
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

    // A Panel (not a bare Component) so the strip fills its allocated edge:
    // Panel.clampsToContentSize() is false, so setWidth/setHeight accept the
    // full container extent instead of shrinking to the tab buttons' content max.
    private _toolbar: Panel = new Panel();
    // Clips the tab region. Holds the tab wrappers (its box children), the
    // selection indicator, and the reorder bar; positioned to the scrollable tab
    // region between the chrome (tool group + arrows) and set to overflow:hidden,
    // so a scrolled tab — and its overlaid ✕ — is clipped at the region edge
    // instead of bleeding over the tool buttons. The chrome lives on `_toolbar`,
    // outside this frame.
    private _clipFrame: Panel = new Panel();
    private _tabs: Array<TabEntry> = [];
    private _buttonGroup: ButtonGroup = new ButtonGroup();
    // The strip owns the clip frame's native scroll explicitly (arrow clicks and
    // `revealSelectedIfRequested` are the only writers). Focus the active tab
    // without the browser also scrolling its `overflow:hidden` clip frame into
    // view, so that single scroll path stays authoritative — `revealSelectedIfRequested`
    // brings a programmatically-selected tab into view either way.
    private _rovingTabIndex: RovingTabIndex = new RovingTabIndex({ preventScroll: true });
    private _selectedTabIndex: number = 0;
    // Last tab index that was faded in during a doLayout pass. Compared
    // against `selectedTabIndex` so the cross-tab fade fires only on actual
    // selection changes (not on every relayout, e.g. window resize).
    private _lastFadedTabIndex: number = -1;
    private _listeners: ListenerBag<TabEvent> = new ListenerBag<TabEvent>();

    private _widthMode: TabWidthMode = "equal";
    private _maxWidth: number | null = null;
    private _fixedWidth: number = 120;
    private _underBorderFullWidth: boolean = true;
    private _underBorderFromTheme: boolean = true;
    private _themeCleanup: (() => void) | null = null;
    private _indicator: TabIndicator = new TabIndicator();

    private _side: TabSide = "north";
    private _align: TabAlign = "start";
    private _orientation: TabOrientation = "horizontal";
    private _scrollable: boolean = false;
    private _compact: boolean = false;
    private _textAlign: TabTextAlign = "center";

    // Shared rebuild-mode context menu reused across right-clicks, mirroring
    // Table's column-header menu. Rebuild-mode menus only attach to the DOM
    // during `show()` and self-dismiss on outside mousedown / `hide()`, so no
    // detach teardown is needed.
    private _contextMenu: Menu = new Menu();

    // Tool buttons pinned at the far end of the strip. Held in a hand-positioned
    // overlay (its own inner box) raw-appended to the toolbar element next to
    // the indicator, rather than enrolled as toolbar box children — so the tab
    // wrappers stay the toolbar's only box children and their indices line up
    // 1:1 with `_tabs` for the reorder/indicator/close-button math.
    private _tools: Component[] = [];
    // Also a Panel so it fills its reserved slot rather than clamping to the
    // tool buttons' content max (same reason as `_toolbar`).
    private _toolGroup: Panel = new Panel();

    // Overflow "arrows" chrome: leading/trailing scroll buttons, hidden when the
    // strip fits. Built lazily the first time `scrollable` is enabled.
    private _scrollLeadButton: Button | null = null;
    private _scrollTrailButton: Button | null = null;
    // Scroll position for a scrollable strip is the clip frame element's own
    // native `scrollLeft`/`scrollTop` — a single source of truth read/written
    // through `clipScroll`/`setClipScroll`. The content frame (installed by the
    // box layout when overflowing) gives the host the scroll extent; the arrows
    // and `revealSelectedIfRequested` just move that native offset.
    // One-shot: scroll the selected tab into view on the next layout. Set when
    // scrolling first becomes active (enabling `scrollable`, or a side switch
    // while scrollable), so the selected tab isn't left clipped off-screen.
    private _scrollToSelected: boolean = false;

    // Within-strip drag-reorder wiring (see installTabDnD / teardownTabDnD).
    private _reorderable: boolean = false;
    private _reorderBar: TabReorderBar = new TabReorderBar();
    private _dndTeardowns: Array<() => void> = [];
    private _dragMouseTarget: EventTarget | null = null;
    private _dragInsertIndex: number = -1;

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
        this._toolbar.setPreferredSize(0, STRIP_THICKNESS);

        // The tab wrappers live in the clip frame (its box lays them out), not on
        // the toolbar directly. Transparent so the toolbar's strip background and
        // under-border show through; overflow:hidden clips scrolled tabs (and
        // their close overlays) at the tab-region edge. Hand-positioned in
        // `doLayout`, so it is raw-appended (not a toolbar box child).
        this._clipFrame.setLayoutManager(new HBox({ mode: "equal", spacing: 0 }));
        this._clipFrame.setBackgroundColor("transparent");
        this._clipFrame.clearInsets();
        this._clipFrame.setOverflow("hidden");

        // The tool group is a hand-positioned overlay (not a toolbar box child);
        // it runs its own box to lay its buttons out along the strip's main axis,
        // stretching them across the strip thickness (the box's cross axis).
        this._toolGroup.setLayoutManager(new HBox({ spacing: 0, stretching: true }));
        // Opaque strip background (not transparent) so scrolled tabs slide behind
        // the tool group rather than showing through it.
        this._toolGroup.setBackgroundColor("var(--ts-ui-tab-toolbar-bg, #eee)");
        this._toolGroup.clearInsets();
        // Lift the tool group above the tab wrappers (which are appended later in
        // DOM order) so its buttons stay clickable in their reserved slot.
        this._toolGroup.setZIndex(1);

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
        if (!this._underBorderFullWidth) {
            this._toolbar.clearBorder();

            return;
        }

        const rule = "1px solid var(--ts-ui-tab-toolbar-border, #e1e1e8)";

        // The under-border is the single rule between the strip and the content
        // area, so it sits on the strip's *inner* edge — the one adjacent to the
        // content: bottom for north, top for south, right for west, left for
        // east. The other three edges stay borderless.
        this._toolbar.setBorder({
            borderTop:    this._side === "south" ? rule : "none",
            borderBottom: this._side === "north" ? rule : "none",
            borderLeft:   this._side === "east"  ? rule : "none",
            borderRight:  this._side === "west"  ? rule : "none",
        });
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
        this._widthMode = mode;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-button width strategy.
     *
     * @returns The active {@link TabWidthMode}.
     */
    getWidthMode(): TabWidthMode {
        return this._widthMode;
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
        this._maxWidth = px;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current per-tab maximum width.
     *
     * @returns The cap in px, or `null` when tabs are uncapped.
     */
    getMaxWidth(): number | null {
        return this._maxWidth;
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
        this._fixedWidth = px;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the per-tab width used by the `"fixed"` width mode.
     *
     * @returns The fixed width in px.
     */
    getFixedWidth(): number {
        return this._fixedWidth;
    }

    /**
     * Derives a tab button's insets from the current `_compact` flag. The label
     * gets two `pad` units of breathing room per side (`pad` shrinks when
     * compact); closeable tabs additionally reserve {@link CLOSE_BUTTON_SIZE} on
     * the edge where {@link positionCloseButtons} pins the ✕ — the right for
     * upright text (north/south and west/east horizontal), the bottom or top for
     * rotated cw / ccw text — so the label never runs under it. The
     * close reservation is fixed; only the breathing pad shrinks, so the glyph
     * keeps its clearance even in the dense strip.
     *
     * @param constraints - The tab's layout constraints; `constraints.closeable`
     *   adds the close-button reservation.
     *
     * @returns The insets to apply to the tab button.
     */
    private computeTabButtonInsets(constraints?: LayoutConstraints): Insets {
        const pad = this._compact ? TAB_BUTTON_INSET_COMPACT : TAB_BUTTON_INSET;
        const closeReserve = constraints?.closeable ? CLOSE_BUTTON_SIZE : 0;

        if (this.isRotatedText()) {
            // Rotated label runs along the cell, ending where it stops reading:
            // the bottom for clockwise (top-to-bottom) text, the top for
            // counter-clockwise (bottom-to-top). Reserve the ✕ clearance there.
            return this._orientation === "vertical-ccw"
                ? new Insets(closeReserve + pad * 2, pad * 2, pad * 2, pad * 2)
                : new Insets(pad * 2, pad * 2, closeReserve + pad * 2, pad * 2);
        }

        if (this.isVertical()) {
            // West/east upright text: ✕ to the right of the label, with vertical
            // breathing so the stacked tabs aren't cramped.
            return new Insets(pad * 2, closeReserve + pad * 2, pad * 2, pad * 2);
        }

        // North/south: ✕ to the right; the strip thickness supplies the cross-
        // axis (vertical) room, so no top/bottom inset.
        return new Insets(0, closeReserve + pad * 2, 0, pad * 2);
    }

    /**
     * Derives a tool button's insets from the current `_compact` flag — the same
     * breathing pad as the tab buttons (no close reservation), so tools shrink in
     * lockstep when the strip goes compact. The cross-axis inset is zeroed (the
     * strip thickness supplies that dimension and the stretching tool group fills
     * the button to it), so only the main-axis pad — and thus the tool's width on
     * north/south, height on west/east — tightens in compact mode.
     *
     * @returns The insets to apply to each tool button.
     */
    private computeToolButtonInsets(): Insets {
        const pad = this._compact ? TAB_BUTTON_INSET_COMPACT : TAB_BUTTON_INSET;

        if (this.isVertical()) {
            return new Insets(pad * 2, 0, pad * 2, 0);
        }

        return new Insets(0, pad * 2, 0, pad * 2);
    }

    /**
     * Clamps a wrapper's extent on the strip's *main* axis (width for
     * north/south, height for west/east) to `[min, max]`, leaving the cross axis
     * unbounded so the box stretches it to the strip thickness.
     *
     * @param wrapper - The tab wrapper to clamp.
     * @param min - The main-axis minimum in px.
     * @param max - The main-axis maximum in px (`Number.MAX_VALUE` for unbounded).
     */
    private clampWrapperMain(wrapper: Component, min: number, max: number): void {
        if (this.isVertical()) {
            wrapper.setMinSize(0, min);
            wrapper.setMaxSize(Number.MAX_VALUE, max);
        } else {
            wrapper.setMinSize(min, 0);
            wrapper.setMaxSize(max, Number.MAX_VALUE);
        }
    }

    /**
     * Reports whether the strip paints rotated text — a west/east side with a
     * `vertical-cw` / `vertical-ccw` orientation (rendered via `sideways-rl` /
     * `sideways-lr`). Used to place the ✕ along the cell and pin the rotated
     * label's natural extent.
     *
     * @returns `true` for west/east with a vertical text orientation.
     */
    private isRotatedText(): boolean {
        return this.isVertical() && this._orientation !== "horizontal";
    }

    /**
     * Reads a tab button's preferred extent on the strip's **main** axis (width
     * for north/south, height for west/east). The button's preferred size already
     * reflects the rotated text run — rotated labels report a tall, narrow size —
     * so the main axis is simply the vertical strip's height or the horizontal
     * strip's width, with no per-orientation swap here.
     *
     * @param button - The tab button to measure.
     *
     * @returns The main-axis extent in px, or 0 before the button has reported a
     *   preferred size.
     */
    private buttonMainExtent(button: ToggleButton): number {
        const preferred = button.getPreferredSize();

        if (!preferred) {
            return 0;
        }

        return this.isVertical() ? preferred.height : preferred.width;
    }

    /**
     * Reads a tab button's preferred extent on the strip's **cross** axis (the
     * strip's thickness contribution) — the complement of
     * {@link buttonMainExtent}.
     *
     * @param button - The tab button to measure.
     *
     * @returns The cross-axis extent in px, or 0 before measurement.
     */
    private buttonCrossExtent(button: ToggleButton): number {
        const preferred = button.getPreferredSize();

        if (!preferred) {
            return 0;
        }

        return this.isVertical() ? preferred.width : preferred.height;
    }

    /**
     * Computes the strip's thickness (px) on its cross axis. North/south keep the
     * base {@link STRIP_THICKNESS} seed (the smaller {@link STRIP_THICKNESS_COMPACT}
     * when `compact`); west/east grow from that seed to the widest button (or tool)
     * cross extent so horizontal-text vertical strips fit their longest label,
     * never shrinking below it. In `"fixed"` width mode with *upright* text the
     * vertical strip's thickness is instead pinned to `fixedWidth` — there the
     * fixed "width" is the bar's thickness (the horizontal text run). Rotated text
     * reads along the main axis, so fixed sizes its height and the thickness stays
     * content-derived.
     *
     * @returns The strip thickness in px.
     */
    private stripThickness(): number {
        const base = this._compact ? STRIP_THICKNESS_COMPACT : STRIP_THICKNESS;

        if (!this.isVertical()) {
            return base;
        }

        if (this._widthMode === "fixed" && !this.isRotatedText()) {
            return Math.max(base, this._fixedWidth);
        }

        let maxCross = base;

        for (const entry of this._tabs) {
            maxCross = Math.max(maxCross, this.buttonCrossExtent(entry.button));
        }

        const toolSize = this._tools.length > 0 ? this._toolGroup.getPreferredSize() : null;

        if (toolSize) {
            maxCross = Math.max(maxCross, toolSize.width);
        }

        return maxCross;
    }

    /**
     * Resolves a tab's fixed target extent on the strip's main axis for the
     * active {@link TabWidthMode}, or `0` when the mode imposes none (`"fill"`,
     * or before the buttons have reported a preferred size). `"equal"` and
     * `"fixed"` return one uniform value across all tabs; `"content"` returns the
     * per-tab natural extent capped at `maxWidth`. Shared by the overflow and
     * non-overflow paths so a strip keeps its width-mode sizing when overflow
     * scrolling is enabled instead of collapsing to raw content width.
     *
     * @param button - The tab button to measure (used only by `"content"`).
     *
     * @returns The target main-axis extent in px, or `0` for no fixed target.
     */
    private tabModeExtent(button: ToggleButton): number {
        switch (this._widthMode) {
            case "fixed":
                // Fixed sizes the extent in the text's reading direction. For
                // upright text on west/east that direction is the bar *thickness*
                // (handled in `stripThickness`), so the main axis stays content-
                // sized (return 0). North/south and rotated (vertical) text read
                // along the main axis, so they pin the main extent.
                return (this.isVertical() && !this.isRotatedText()) ? 0 : this._fixedWidth;
            case "equal": {
                let widest = 0;

                for (const entry of this._tabs) {
                    widest = Math.max(widest, this.buttonMainExtent(entry.button));
                }

                return Math.min(widest, this._maxWidth ?? Number.MAX_VALUE);
            }
            case "content":
                return Math.min(this.buttonMainExtent(button), this._maxWidth ?? Number.MAX_VALUE);
            default:
                return 0;
        }
    }

    /**
     * Applies the active {@link TabWidthMode} to the toolbar box and every tab
     * wrapper, generalised to the strip's main axis (width for north/south,
     * height for west/east). Called from `doLayout` before the toolbar lays out.
     *
     * @remarks When `scrollable` is set the `"equal"`→`"fill"` collapse
     * is skipped: the box is switched to `"preferred"` and marked overflowing on
     * the main axis so buttons keep their preferred extent and the strip scrolls
     * instead of compressing. Otherwise `"fill"` uses the box's `equal` mode
     * (tabs share the strip); `"content"` caps the natural extent at
     * `maxWidth`; `"equal"`/`"fixed"` pin every wrapper to one uniform extent,
     * with `"equal"` collapsing to fill when that extent would overflow.
     *
     * @param available - The strip's inner main-axis extent (px) the tabs must
     *   fit within (already net of the tool-group reservation).
     */
    private applyTabWidths(available: number): void {
        const box = this._clipFrame.getLayoutManager() as BoxLayout;
        const overflow = this._scrollable;

        // Scroll-on-overflow: keep tabs at their width-mode extent and let the
        // strip's own overflow carry the surplus, rather than compressing to fit.
        // The strip scrolls instead of collapsing, so the `"equal"`→`"fill"`
        // shrink is skipped — but the width mode's sizing is still honoured, so a
        // strip doesn't snap to raw content width the moment overflow is enabled.
        if (overflow) {
            box.setMode("preferred");
            box.setOverflowing(!this.isVertical(), this.isVertical());

            for (const entry of this._tabs) {
                const extent = this.tabModeExtent(entry.button);

                if (extent > 0) {
                    this.clampWrapperMain(entry.wrapper, extent, extent);
                } else {
                    // "fill" / pre-measurement: keep each tab's own preferred
                    // extent. Rotated text floors to the derived main extent (the
                    // box would otherwise read the un-rotated size and clip).
                    const floor = this.isRotatedText() ? this.buttonMainExtent(entry.button) : 0;
                    this.clampWrapperMain(entry.wrapper, floor, Number.MAX_VALUE);
                }
            }

            return;
        }

        box.setOverflowing(false, false);

        if (this._widthMode === "fill") {
            box.setMode("equal");

            for (const entry of this._tabs) {
                this.clampWrapperMain(entry.wrapper, 0, Number.MAX_VALUE);
            }

            return;
        }

        box.setMode("preferred");

        if (this._widthMode === "content") {
            const cap = this._maxWidth ?? Number.MAX_VALUE;

            for (const entry of this._tabs) {
                // Rotated text: pin each wrapper to its derived natural main
                // extent (capped), since the box can't read the rotated extent
                // from the analytic preferred size. Upright text lets the box use
                // the wrapper's preferred main extent, capped at `cap`.
                if (this.isRotatedText()) {
                    const extent = Math.min(this.buttonMainExtent(entry.button), cap);
                    this.clampWrapperMain(entry.wrapper, extent, extent);
                } else {
                    this.clampWrapperMain(entry.wrapper, 0, cap);
                }
            }

            return;
        }

        // "equal" / "fixed": pin every wrapper to a single uniform extent.
        const extent = this._tabs.length > 0 ? this.tabModeExtent(this._tabs[0].button) : 0;

        // Pre-measurement guard: fall back to natural extents until the tab
        // buttons have reported a real preferred size.
        if (extent <= 0) {
            for (const entry of this._tabs) {
                this.clampWrapperMain(entry.wrapper, 0, Number.MAX_VALUE);
            }

            return;
        }

        // "equal" shrinks to fit: when the uniform extent can't fit the strip,
        // collapse to fill so the tabs share the available space instead of
        // overflowing. "fixed" stays rigid (overflow is the consumer's intent).
        if (this._widthMode === "equal" && this._tabs.length > 0 && extent * this._tabs.length > available) {
            box.setMode("equal");

            for (const entry of this._tabs) {
                this.clampWrapperMain(entry.wrapper, 0, Number.MAX_VALUE);
            }

            return;
        }

        for (const entry of this._tabs) {
            this.clampWrapperMain(entry.wrapper, extent, extent);
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
    setUnderBorderFullWidth(full: boolean): this {
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
    isUnderBorderFullWidth(): boolean {
        return this._underBorderFullWidth;
    }

    /**
     * Selects which edge of the content area the tab strip sits on and re-lays
     * out. Caches the value only — the orientation swap and placement happen in
     * the next `doLayout` (this may run during `super()` before the toolbar
     * element exists).
     *
     * @param side - The {@link TabSide} to place the strip on.
     *
     * @returns This layout manager, for chaining.
     */
    setSide(side: TabSide): this {
        this._side = side;

        // The scroll axis flips with the side, so start the new side unscrolled,
        // then bring the selected tab into view if the new axis is scrollable.
        this._clipFrame.setScrollLeft(0);
        this._clipFrame.setScrollTop(0);

        if (this._scrollable) {
            this._scrollToSelected = true;
        }

        this.applyUnderBorder();

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the edge the tab strip currently sits on.
     *
     * @returns The active {@link TabSide}.
     */
    getSide(): TabSide {
        return this._side;
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
        this._align = align;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-button-group alignment.
     *
     * @returns The active {@link TabAlign}.
     */
    getAlign(): TabAlign {
        return this._align;
    }

    /**
     * Sets the tab-button text orientation for the vertical sides and re-lays
     * out. Caches the value only; `doLayout` re-applies the `writing-mode` to
     * every tab button each pass (no DOM work in the setter — the buttons may
     * not exist when `applyOptions` runs during `super()`).
     *
     * @param orientation - The {@link TabOrientation} to apply.
     *
     * @returns This layout manager, for chaining.
     */
    setOrientation(orientation: TabOrientation): this {
        this._orientation = orientation;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current vertical-side tab text orientation.
     *
     * @returns The active {@link TabOrientation}.
     */
    getOrientation(): TabOrientation {
        return this._orientation;
    }

    /**
     * Sets the strip-wide tab-label justification and re-lays out. Caches the
     * value only; `doLayout` re-applies the `text-align` to every tab button
     * each pass (no DOM work in the setter — the buttons may not exist when
     * `applyOptions` runs during `super()`).
     *
     * @param align - The {@link TabTextAlign} to apply.
     *
     * @returns This layout manager, for chaining.
     */
    setTextAlign(align: TabTextAlign): this {
        this._textAlign = align;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-label justification.
     *
     * @returns The active {@link TabTextAlign}.
     */
    getTextAlign(): TabTextAlign {
        return this._textAlign;
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
        // Enabling from a non-scrolling state: reveal the selected tab on the next
        // layout rather than starting at offset 0 (it may be off-screen).
        if (value && !this._scrollable) {
            this._scrollToSelected = true;
        }

        this._scrollable = value;

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether an overflowing strip scrolls instead of compressing.
     *
     * @returns `true` when the strip scrolls on overflow.
     */
    isScrollable(): boolean {
        return this._scrollable;
    }

    /**
     * Toggles reduced tab-button insets (a denser strip) and re-lays out.
     * Caches the value only; `doLayout` re-derives every button's insets from
     * `_compact` each pass, so this must not touch the DOM (the buttons may not
     * exist when `applyOptions` runs during `super()`).
     *
     * @param value - `true` for compact insets, `false` for the default.
     *
     * @returns This layout manager, for chaining.
     */
    setCompact(value: boolean): this {
        this._compact = value;

        // Compact changes every tab's width, which can leave the selected tab
        // partly clipped at the current scroll offset; nudge it back into view
        // (a no-op when it already fits, so the scroll position is otherwise kept).
        if (this._scrollable) {
            this._scrollToSelected = true;
        }

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Returns whether the strip uses reduced (compact) tab-button insets.
     *
     * @returns `true` when compact.
     */
    isCompact(): boolean {
        return this._compact;
    }

    /**
     * Enables or disables within-strip drag-reorder of tab headers. Unlike the
     * pure-placement setters this one installs / tears down the drag sources and
     * the toolbar drop target — but only when the toolbar element already exists
     * (it is created in `attach`). When called during `super()` it just caches
     * the flag; `attach` performs the install if `_reorderable` is set.
     *
     * @param value - `true` to enable header drag-reorder.
     *
     * @returns This layout manager, for chaining.
     */
    setReorderable(value: boolean): this {
        if (this._reorderable === value) {
            return this;
        }

        this._reorderable = value;

        if (!this._toolbar.getElement()) {
            return this;
        }

        if (value) {
            this.installTabDnD();
        } else {
            this.teardownTabDnD();
        }

        return this;
    }

    /**
     * Returns whether within-strip header drag-reorder is enabled.
     *
     * @returns `true` when reorderable.
     */
    isReorderable(): boolean {
        return this._reorderable;
    }

    /**
     * Adds a tool button at the far end of the strip, opposite the tab buttons.
     *
     * @param button - The tool component to add.
     *
     * @returns This layout manager, for chaining.
     */
    addTool(button: Component): this {
        this._tools.push(button);
        this._toolGroup.addComponent(button);

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
        const idx = this._tools.indexOf(button);

        if (idx < 0) {
            return this;
        }

        this._tools.splice(idx, 1);
        this._toolGroup.removeComponent(button);

        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * Reports whether the strip is on a vertical side (west/east), where the
     * toolbar stacks tabs in a `VBox` and the main axis is Y.
     *
     * @returns `true` for west/east, `false` for north/south.
     */
    private isVertical(): boolean {
        return this._side === "west" || this._side === "east";
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

            // Bring the newly-selected tab into view on the next pass. A
            // left-click targets an already-visible tab (a no-op reveal), but a
            // programmatic switch — the context menu or keyboard arrow nav — can
            // select a tab scrolled out of the strip's visible range.
            if (this._scrollable) {
                this._scrollToSelected = true;
            }

            const entry = this._tabs[idx];
            if (entry.state === "lazy") {
                this.materializeAsync(idx);
            }
        }

        this.getContainer()?.scheduleLayout();
    }

    /**
     * Opens the shared context menu for a right-clicked tab. Lists every tab
     * (click to switch, the currently-active tab shown inert) followed by a
     * `Close` action gated on the tab's `closeable` constraint. Reuses the
     * manager's own {@link onTabPressed} / `closeTab`, so no activation or
     * close logic is duplicated.
     *
     * @param entry - The tab entry that was right-clicked.
     * @param x - Horizontal viewport coordinate of the click.
     * @param y - Vertical viewport coordinate of the click.
     */
    private openTabMenu(entry: TabEntry, x: number, y: number): void {
        const activeEntry = this._tabs[this._selectedTabIndex];

        const configs: MenuItemConfig[] = this._tabs.map(t => ({
            text:    t.name,
            // Disable only the tab that's already showing — switching to it is a
            // no-op — so a right-click on any other tab can still switch to it.
            enabled: t !== activeEntry,
            // A real left-click drives the button's selected state through the
            // ButtonGroup; a programmatic switch must set it explicitly, exactly
            // as `onToolbarKeyDown` / `selectNextTab` do, or the target tab's
            // content and indicator move but its button never looks pressed.
            action:  () => {
                this._tabs.forEach(e => e.button.setSelected(false));
                t.button.setSelected(true);
                this.onTabPressed(t.button);
            },
        }));

        configs.push({ separator: true });
        configs.push({
            text:    "Close",
            enabled: entry.constraints?.closeable === true,
            action:  () => this.closeTab(entry),
        });

        this._contextMenu.show(x, y, configs);
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

        // The clip frame (which holds the tab wrappers) and the tool group are
        // raw-appended overlays on the toolbar — positioned manually in `doLayout`
        // rather than enrolled in the toolbar's box. The selection indicator and
        // reorder bar go *inside* the clip frame so they share the wrappers'
        // coordinate space (and clip with them) rather than the toolbar's.
        element.appendChild(this._clipFrame.getElement(true));
        element.appendChild(this._toolGroup.getElement(true));

        const clip = this._clipFrame.getElement(true);
        clip.appendChild(this._indicator.getElement(true));
        clip.appendChild(this._reorderBar.getElement(true));

        this._toolbar.getAria().setRole("tablist");

        Event.addSubtreeListener(this._toolbar, "keydown", (e: KeyboardEvent) => this.onToolbarKeyDown(e));

        // The reorder option may have been set during `super()` before the
        // toolbar element existed; perform the deferred install now.
        if (this._reorderable) {
            this.installTabDnD();
        }

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

        this.teardownTabDnD();

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
        const thickness = this.stripThickness();

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

        tabButton.setInsets(this.computeTabButtonInsets(constraints));

        if (constraints?.glyph) {
            tabButton.setGlyph(constraints.glyph);
        }

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

        // Subtree listener so a right-click on the label, the glyph, or the
        // close ✕ all reach one handler that opens the tab context menu. Named
        // and stored on the entry so `closeTab` can remove it (the closure over
        // `entry`, resolved at call time, is safe because right-clicks only
        // fire after the entry is fully built).
        const onContextMenu = (e: MouseEvent): void => {
            e.preventDefault();
            this.openTabMenu(entry, e.clientX, e.clientY);
        };

        const entry: TabEntry = {
            wrapper,
            button: tabButton,
            closeButton,
            component: null,
            factory: null,
            constraints,
            name,
            spinner: null,
            state: "lazy",
            contextMenuListener: onContextMenu
        };

        if (closeButton) {
            closeButton.on("action", () => this.closeTab(entry));
        }

        Event.addSubtreeListener(wrapper, "contextmenu", onContextMenu);

        this._tabs.push(entry);

        const isSelected = this._tabs.length - 1 === this._selectedTabIndex;

        if (isSelected) {
            tabButton.setSelected(true);
        }

        this._buttonGroup.addButton(tabButton);
        this._rovingTabIndex.add(tabButton);
        this._clipFrame.addComponent(wrapper);

        tabButton.getAria().setRole("tab");
        tabButton.getAria().setSelected(isSelected);

        // A tab added while reorder is live (and the strip is attached) needs its
        // own drag source; tabs added before `attach` are wired by installTabDnD.
        if (this._reorderable && this._toolbar.getElement()) {
            this._dndTeardowns.push(this.makeTabDragSource(entry));
        }

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
     * Swaps the toolbar's inner box (and the tool group's) between `HBox` and
     * `VBox` to match the current side, only when the orientation actually
     * differs. North/south stack tabs in an `HBox`; west/east in a `VBox`. Both
     * stretch on the cross axis so wrappers fill the strip thickness.
     */
    private syncToolbarOrientation(): void {
        const wantVertical = this.isVertical();

        if ((this._clipFrame.getLayoutManager() instanceof VBox) !== wantVertical) {
            this._clipFrame.setLayoutManager(wantVertical
                ? new VBox({ spacing: 0, stretching: true })
                : new HBox({ spacing: 0, stretching: true }));
        }

        if ((this._toolGroup.getLayoutManager() instanceof VBox) !== wantVertical) {
            this._toolGroup.setLayoutManager(wantVertical
                ? new VBox({ spacing: 0, stretching: true })
                : new HBox({ spacing: 0, stretching: true }));
        }
    }

    /**
     * Reads the tool group's preferred extent along the strip's main axis (width
     * for north/south, height for west/east).
     *
     * @returns The tool-group main extent in px, or 0 when there are no tools.
     */
    private toolGroupMainExtent(): number {
        const pref = this._toolGroup.getPreferredSize();

        if (!pref) {
            return 0;
        }

        return this.isVertical() ? pref.height : pref.width;
    }

    /**
     * Predicts the strip's combined main-axis tab extent before layout, used to
     * decide whether the "arrows" overflow chrome (and its gutter reservation) is
     * needed. Mirrors {@link applyTabWidths}: each tab is summed at its width-mode
     * extent ({@link tabModeExtent}) when the mode imposes one, else its own
     * preferred extent — so the prediction matches the width the tabs are actually
     * laid out at, not their raw content width.
     *
     * @returns The predicted combined main-axis extent of all tabs in px.
     */
    private predictTabsExtent(): number {
        let total = 0;

        for (const entry of this._tabs) {
            total += this.predictedTabExtent(entry.button);
        }

        return total;
    }

    /**
     * Predicts one tab's main-axis extent before layout — its width-mode extent
     * ({@link tabModeExtent}) when the mode imposes one, else its own preferred
     * extent. The per-tab unit summed by {@link predictTabsExtent}, used pre-layout
     * to decide whether the strip overflows (and so reserves the arrow gutters).
     *
     * @param button - The tab button to measure.
     *
     * @returns The predicted main-axis extent in px.
     */
    private predictedTabExtent(button: ToggleButton): number {
        const extent = this.tabModeExtent(button);

        return extent > 0 ? extent : this.buttonMainExtent(button);
    }

    /**
     * Returns the scroll-arrow gutter (px) reserved at *each* end of the tab
     * region: {@link SCROLL_ARROW_SIZE} when a scrollable strip is overflowing,
     * else 0.
     *
     * @param mainInner - The strip's main-axis inner extent in px.
     * @param toolExtent - The reserved tool-group main extent in px.
     *
     * @returns The per-end arrow gutter in px.
     */
    private computeArrowReserve(mainInner: number, toolExtent: number): number {
        if (!this._scrollable) {
            return 0;
        }

        // `+ 1` slop so a strip that exactly fits doesn't flicker the arrows.
        return this.predictTabsExtent() > mainInner - toolExtent + 1 ? SCROLL_ARROW_SIZE : 0;
    }

    /**
     * Positions and sizes the clip frame to the scrollable tab region — the strip
     * band between the fixed chrome: the tool group at the end opposite the tabs
     * (leading for `"end"` alignment, trailing otherwise) and a scroll-arrow
     * gutter at each end when `arrowReserve` is non-zero. The frame's
     * overflow:hidden then clips any tab (and its ✕ overlay) that scrolls past the
     * region edge — and carries the strip's scroll natively via `scrollLeft`/
     * `scrollTop`. The leading inset is just the `"end"`-align gap, which
     * trailing-aligns the tabs and survives an independent clip-frame relayout.
     *
     * @param toolExtent - The tool group's main-axis extent in px.
     * @param arrowReserve - The per-end scroll-arrow gutter in px (0 when no arrows).
     * @param endGap - The leading gap that trailing-aligns `"end"` tabs (0 otherwise).
     * @param thickness - The strip's cross-axis thickness in px.
     * @param mainInner - The strip's main-axis inner extent in px.
     */
    private positionClipFrame(toolExtent: number, arrowReserve: number, endGap: number, thickness: number, mainInner: number): void {
        const toolsLead = this._align === "end";
        const leadChrome = (toolsLead ? toolExtent : 0) + arrowReserve;
        const trailChrome = (toolsLead ? 0 : toolExtent) + arrowReserve;
        const mainSize = mainInner - leadChrome - trailChrome;
        const leadInset = endGap;

        if (this.isVertical()) {
            this._clipFrame.setX(0);
            this._clipFrame.setY(leadChrome);
            this._clipFrame.setWidth(thickness);
            this._clipFrame.setHeight(mainSize);
            this._clipFrame.setInsets(new Insets(leadInset, 0, 0, 0));
        } else {
            this._clipFrame.setX(leadChrome);
            this._clipFrame.setY(0);
            this._clipFrame.setWidth(mainSize);
            this._clipFrame.setHeight(thickness);
            this._clipFrame.setInsets(new Insets(0, 0, 0, leadInset));
        }
    }

    /**
     * Re-derives every tab button's insets from `_compact` and applies the
     * `writing-mode` for the current orientation (cleared on horizontal sides),
     * and tightens the tool buttons' insets to match, so `setCompact` /
     * `setOrientation` take effect on the next pass without the setters
     * touching the DOM. Run before the width pass so the insets feed the buttons'
     * measured extents.
     */
    private applyTabButtonStyles(): void {
        // `sideways-rl`/`sideways-lr` rotate the whole run a quarter turn in
        // opposite directions — clockwise (reads top-to-bottom) and
        // counter-clockwise (reads bottom-to-top). The `vertical-rl`/`vertical-lr`
        // pair only differs in line-stacking, which is invisible on a one-line
        // label, so both used to look identical.
        const writingMode = this._orientation === "vertical-cw" ? "sideways-rl"
            : this._orientation === "vertical-ccw" ? "sideways-lr"
            : null;

        for (const entry of this._tabs) {
            entry.button.setInsets(this.computeTabButtonInsets(entry.constraints));

            // Writing mode before text-align: the label justification maps to a
            // content anchor along the reading axis, so the button must already
            // know its orientation when setTextAlign resolves the anchor.
            if (this.isVertical() && writingMode) {
                entry.button.setWritingMode(writingMode);
            } else {
                entry.button.clearWritingMode();
            }

            entry.button.setTextAlign(this._textAlign);
        }

        const toolInsets = this.computeToolButtonInsets();

        for (const tool of this._tools) {
            tool.setInsets(toolInsets);
        }
    }

    /**
     * Computes the leading gap (px) that pushes `"end"`-aligned tabs to the
     * trailing edge of their region. Folded into the clip frame's leading inset
     * (see {@link positionClipFrame}) so the inner box lays the tabs out at the
     * trailing edge natively — surviving any independent relayout, unlike a
     * post-layout wrapper shift. Zero for `"start"` alignment, `"fill"` width mode
     * (where the tabs already span the strip), and whenever the tabs fill or
     * overflow the region.
     *
     * @param available - The strip's inner main-axis extent net of tool and arrow
     *   reservations (px) — the region the tabs occupy.
     *
     * @returns The leading gap in px, clamped to `0`.
     */
    private endAlignGap(available: number): number {
        if (this._align !== "end" || this._widthMode === "fill" || this._tabs.length === 0) {
            return 0;
        }

        return Math.max(0, available - this.predictTabsExtent());
    }

    /**
     * Places the tool-group overlay in its reserved slot (the strip end opposite
     * the tabs) and lays out its buttons, or hides it when there are no tools.
     *
     * @param mainInner - The strip's main-axis inner extent in px.
     * @param toolExtent - The tool-group main extent in px.
     * @param thickness - The strip's cross-axis thickness in px.
     */
    private positionToolGroup(mainInner: number, toolExtent: number, thickness: number): void {
        if (this._tools.length === 0 || toolExtent <= 0) {
            this._toolGroup.setVisible(false);

            return;
        }

        this._toolGroup.setVisible(true);

        const mainPos = this._align === "end" ? 0 : mainInner - toolExtent;

        if (this.isVertical()) {
            this._toolGroup.setX(0);
            this._toolGroup.setY(mainPos);
            this._toolGroup.setWidth(thickness);
            this._toolGroup.setHeight(toolExtent);
        } else {
            this._toolGroup.setX(mainPos);
            this._toolGroup.setY(0);
            this._toolGroup.setWidth(toolExtent);
            this._toolGroup.setHeight(thickness);
        }

        this._toolGroup.doLayout();
    }

    /**
     * Slides the selection indicator over the active tab cell along the strip's
     * main axis, pinned to the strip's inner edge per side.
     */
    private positionIndicator(): void {
        const wrapper = this._tabs[this._selectedTabIndex]?.wrapper;

        if (!wrapper) {
            return;
        }

        const vertical = this.isVertical();
        const mainExtent = vertical ? wrapper.getHeight() : wrapper.getWidth();

        if (mainExtent <= 0) {
            return;
        }

        const mainPos = vertical ? wrapper.getY() : wrapper.getX();

        this._indicator.slideTo(mainPos, mainExtent, this._side);
    }

    /**
     * Pins each closeable tab's overlaid ✕ to the end of its label's reading
     * flow: the right edge (vertically centred) for upright text — north/south
     * and west/east horizontal orientation — and, for rotated text (horizontally
     * centred), the bottom edge for clockwise (top-to-bottom) or the top edge for
     * counter-clockwise (bottom-to-top).
     */
    private positionCloseButtons(): void {
        const rotated = this.isRotatedText();

        for (const entry of this._tabs) {
            const closeButton = entry.closeButton;

            if (!closeButton || entry.wrapper.getWidth() <= 0) {
                continue;
            }

            closeButton.setWidth(CLOSE_BUTTON_SIZE);
            closeButton.setHeight(CLOSE_BUTTON_SIZE);

            if (rotated) {
                // Centre the ✕ across the strip thickness and pin it to the end
                // of the reading flow: the bottom for clockwise (top-to-bottom)
                // text, the top for counter-clockwise (bottom-to-top).
                closeButton.setX(Math.round((entry.wrapper.getWidth() - CLOSE_BUTTON_SIZE) / 2));
                closeButton.setY(this._orientation === "vertical-ccw"
                    ? 2
                    : entry.wrapper.getHeight() - CLOSE_BUTTON_SIZE - 2);
            } else {
                closeButton.setX(entry.wrapper.getWidth() - CLOSE_BUTTON_SIZE - 2);
                closeButton.setY(Math.round((entry.wrapper.getHeight() - CLOSE_BUTTON_SIZE) / 2));
            }
        }
    }

    /**
     * Applies the overflow chrome to the toolbar: the toolbar always clips, and a
     * scrollable strip additionally shows the leading/trailing scroll buttons
     * while overflowing.
     *
     * @param mainInner - The strip's main-axis inner extent in px.
     * @param toolExtent - The reserved tool-group main extent in px.
     * @param thickness - The strip's cross-axis thickness in px.
     * @param arrowReserve - The per-end scroll-arrow gutter in px (0 when not overflowing).
     */
    private layoutOverflowChrome(mainInner: number, toolExtent: number, thickness: number, arrowReserve: number): void {
        this._toolbar.setOverflow("hidden");

        if (this._scrollable && arrowReserve > 0) {
            this.layoutOverflowArrows(mainInner, toolExtent, thickness, arrowReserve);
        } else {
            this.hideOverflowArrows();
        }
    }

    /**
     * Lazily builds the two scroll-arrow buttons and raw-appends them to the
     * toolbar element next to the other overlays.
     */
    private ensureScrollArrows(): void {
        if (this._scrollLeadButton && this._scrollTrailButton) {
            return;
        }

        const lead = new Button({ glyph: "angle-left" });
        const trail = new Button({ glyph: "angle-right" });

        for (const button of [lead, trail]) {
            button.setBackgroundColor("var(--ts-ui-tab-toolbar-bg, #eee)");
            button.setBackgroundImage("none");
            button.clearBorder();
            button.clearShadow();
            button.setBorderRadius("0");
            // Drop the default button insets so the glyph fits the narrow gutter.
            button.clearInsets();
            // Above the tab wrappers so the arrows stay clickable at the strip
            // ends; the indicator (z 2) sits below, the arrows above it.
            button.setZIndex(3);
        }

        lead.on("action", () => this.scrollStrip(-SCROLL_ARROW_STEP));
        trail.on("action", () => this.scrollStrip(SCROLL_ARROW_STEP));

        const element = this._toolbar.getElement(true);
        element.appendChild(lead.getElement(true));
        element.appendChild(trail.getElement(true));

        this._scrollLeadButton = lead;
        this._scrollTrailButton = trail;
    }

    /**
     * Shows and positions the scroll arrows in their reserved gutters — fixed in
     * place, spanning the strip thickness — and disables (rather than hides) each
     * at its scroll limit, so the chrome stays put while the tabs scroll between
     * them. Called only when overflowing (`arrowReserve > 0`).
     *
     * @param mainInner - The strip's main-axis inner extent in px.
     * @param toolExtent - The reserved tool-group main extent in px.
     * @param thickness - The strip's cross-axis thickness in px.
     * @param arrowReserve - The per-end arrow gutter (the arrows' main-axis size) in px.
     */
    private layoutOverflowArrows(mainInner: number, toolExtent: number, thickness: number, arrowReserve: number): void {
        this.ensureScrollArrows();

        const lead = this._scrollLeadButton as Button;
        const trail = this._scrollTrailButton as Button;
        const vertical = this.isVertical();

        lead.setGlyph(vertical ? "angle-up" : "angle-left");
        trail.setGlyph(vertical ? "angle-down" : "angle-right");

        lead.setVisible(true);
        trail.setVisible(true);

        // Disable (not hide) each arrow at its scroll limit so the chrome layout
        // never shifts and the first/last tab stays fully in view. Derived from
        // the live native scroll position.
        this.refreshScrollArrows();

        // The arrows sit in the gutters at the ends of the tab region, which
        // excludes the tool-group slot: tools trail the tabs in `"start"`
        // alignment and lead them in `"end"` alignment.
        const toolsLead = this._align === "end";
        const leadPos = toolsLead ? toolExtent : 0;
        const trailPos = (toolsLead ? mainInner : mainInner - toolExtent) - arrowReserve;

        for (const button of [lead, trail]) {
            if (vertical) {
                // Pin the main-axis (height) to the gutter; fill the thickness.
                button.setMinSize(0, arrowReserve);
                button.setMaxSize(Number.MAX_VALUE, arrowReserve);
                button.setX(0);
                button.setWidth(thickness);
                button.setHeight(arrowReserve);
            } else {
                button.setMinSize(arrowReserve, 0);
                button.setMaxSize(arrowReserve, Number.MAX_VALUE);
                button.setY(0);
                button.setHeight(thickness);
                button.setWidth(arrowReserve);
            }
        }

        if (vertical) {
            lead.setY(leadPos);
            trail.setY(trailPos);
        } else {
            lead.setX(leadPos);
            trail.setX(trailPos);
        }
    }

    /**
     * Hides the scroll arrows if they have been built.
     */
    private hideOverflowArrows(): void {
        this._scrollLeadButton?.setVisible(false);
        this._scrollTrailButton?.setVisible(false);
    }

    /**
     * Reads the clip frame's native scroll offset on the strip's main axis — the
     * single source of truth for the scroll position.
     *
     * @returns The current main-axis scroll offset in px (0 when no element).
     */
    private clipScroll(): number {
        return this.isVertical()
            ? this._clipFrame.getScrollTop()
            : this._clipFrame.getScrollLeft();
    }

    /**
     * Returns the clip frame's maximum native scroll offset on the main axis (the
     * overflow past the viewport), derived live from the laid-out content frame.
     *
     * @returns The last-page scroll offset in px (0 when nothing overflows).
     */
    private clipScrollMax(): number {
        return this.isVertical()
            ? this._clipFrame.getMaxScrollTop()
            : this._clipFrame.getMaxScrollLeft();
    }

    /**
     * Writes the clip frame's native main-axis scroll offset. The browser clamps
     * to the scrollable range; the cross axis is left untouched.
     *
     * @param value - The desired main-axis scroll offset in px.
     */
    private setClipScroll(value: number): void {
        if (this.isVertical()) {
            this._clipFrame.setScrollTop(value);
        } else {
            this._clipFrame.setScrollLeft(value);
        }
    }

    /**
     * Re-derives the overflow arrows' enabled state from the live native scroll
     * position: the leading arrow is dead at the start, the trailing arrow at the
     * last page. Called wherever the scroll moves (arrow click, reveal, layout).
     */
    private refreshScrollArrows(): void {
        const lead = this._scrollLeadButton;
        const trail = this._scrollTrailButton;

        if (!lead || !trail) {
            return;
        }

        const scroll = this.clipScroll();

        lead.setEnabled(scroll > 0);
        // 1px slop so a strip scrolled flush to the end still disables cleanly
        // despite sub-pixel rounding in scrollWidth/clientWidth.
        trail.setEnabled(scroll < this.clipScrollMax() - 1);
    }

    /**
     * Scrolls the strip along the main axis by `delta` px (used by the overflow
     * arrow buttons) through the clip frame's native scroll, then refreshes the
     * arrows. No relayout: native scroll moves the wrappers, indicator, and
     * reorder bar (all children of the clip frame) together for free.
     *
     * @param delta - Signed pixel amount to scroll (negative = toward the start).
     */
    private scrollStrip(delta: number): void {
        this.setClipScroll(this.clipScroll() + delta);
        this.refreshScrollArrows();
    }

    /**
     * When a scroll-into-view was requested (enabling scrolling, a side switch, or
     * a `compact` toggle), nudges the native scroll the minimum amount needed to
     * bring the selected tab fully within the visible region, measured from the
     * *laid-out* DOM rects — so it is accurate even when the same pass changed the
     * tab widths (which a pre-layout prediction can't see). Runs after
     * `clipFrame.doLayout`; one-shot, so it never fights the user's own scrolling.
     */
    private revealSelectedIfRequested(): void {
        if (!this._scrollToSelected) {
            return;
        }

        this._scrollToSelected = false;

        if (!this._scrollable) {
            return;
        }

        const selected = this._tabs[this._selectedTabIndex];
        const clipElement = this._clipFrame.getElement();
        const wrapperElement = selected?.wrapper.getElement();

        if (!clipElement || !wrapperElement) {
            return;
        }

        const vertical = this.isVertical();
        const clip = clipElement.getBoundingClientRect();
        const wrap = wrapperElement.getBoundingClientRect();

        const clipStart = vertical ? clip.top : clip.left;
        const clipEnd = vertical ? clip.bottom : clip.right;
        const wrapStart = vertical ? wrap.top : wrap.left;
        const wrapEnd = vertical ? wrap.bottom : wrap.right;

        let delta = 0;

        if (wrapStart < clipStart) {
            delta = wrapStart - clipStart;
        } else if (wrapEnd > clipEnd) {
            delta = wrapEnd - clipEnd;
        }

        // `getBoundingClientRect` already reflects the current scroll, so `delta`
        // is the screen-space correction; apply it to the native offset.
        if (delta !== 0) {
            this.setClipScroll(this.clipScroll() + delta);
        }
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

        const thickness = this.stripThickness();

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

        this.syncToolbarOrientation();
        this.applyTabButtonStyles();

        const cs = containerSize ?? { width: 0, height: 0 };
        const baseX = containerInsets.getLeft();
        const baseY = containerInsets.getTop();
        const thickness = this.stripThickness();

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

        switch (this._side) {
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

        this._toolbar.setX(toolbarX);
        this._toolbar.setY(toolbarY);
        this._toolbar.setWidth(toolbarW);
        this._toolbar.setHeight(toolbarH);

        // Size the clip frame to the tab region (between the chrome), then size
        // the tabs in that space.
        const toolExtent = this._tools.length > 0 ? this.toolGroupMainExtent() : 0;
        const mainInner = this.isVertical() ? toolbarH : toolbarW;

        // Place the clip frame between the tool slot and — when a scrollable strip
        // is overflowing — a scroll-arrow gutter at each end, so the tabs lay out
        // (and scroll, clipped) strictly within it rather than behind the chrome.
        // An "end"-align leading gap is folded in as a frame inset too, so the box
        // trailing-aligns the tabs natively — surviving an independent relayout
        // that a post-layout wrapper shift would not.
        const arrowReserve = this.computeArrowReserve(mainInner, toolExtent);
        const available = mainInner - toolExtent - 2 * arrowReserve;
        const endGap = this.endAlignGap(available);
        this.positionClipFrame(toolExtent, arrowReserve, endGap, thickness, mainInner);

        this.applyTabWidths(available);
        this._clipFrame.doLayout();

        // Scroll-into-view (enabling scrolling, side switch, compact toggle) moves
        // the clip frame's native scroll against the now-laid-out wrapper rects —
        // a prediction before the box runs can't see a same-pass width change. No
        // relayout: native scroll shifts the content without re-running the box.
        this.revealSelectedIfRequested();

        this.positionToolGroup(mainInner, toolExtent, thickness);
        this.positionIndicator();
        this.positionCloseButtons();
        this.layoutOverflowChrome(mainInner, toolExtent, thickness, arrowReserve);

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
     * Installs the within-strip drag-reorder wiring: one toolbar-wide mousedown
     * capture (so a press on a ✕ can veto the drag), a drag source per tab
     * wrapper, and a single toolbar drop target. Idempotent — clears any prior
     * wiring first. Called from `attach` (when `_reorderable`) and from
     * `setReorderable(true)`.
     */
    private installTabDnD(): void {
        this.teardownTabDnD();

        // One subtree mousedown capture records the pressed element so
        // `onDragStart` can veto a drag that began on a close button
        // (DragEventDetail carries no DOM target).
        const recordMouseTarget = (e: MouseEvent): void => {
            this._dragMouseTarget = e.target;
        };

        Event.addSubtreeListener(this._toolbar, "mousedown", recordMouseTarget);
        this._dndTeardowns.push(() => Event.removeSubtreeListener(this._toolbar, "mousedown", recordMouseTarget));

        for (const entry of this._tabs) {
            this._dndTeardowns.push(this.makeTabDragSource(entry));
        }

        this._dndTeardowns.push(this.makeTabDropTarget());
    }

    /**
     * Registers a drag source on one tab wrapper, vetoing the gesture when the
     * press began inside that tab's close button.
     *
     * @param entry - The tab entry whose wrapper becomes a drag source.
     *
     * @returns The source teardown closure.
     */
    private makeTabDragSource(entry: TabEntry): () => void {
        return DragManager.makeDragSource(entry.wrapper, {
            dragData: { tabReorder: true },
            onDragStart: (): boolean | void => {
                const target = this._dragMouseTarget;
                this._dragMouseTarget = null;

                const closeElement = entry.closeButton?.getElement();

                if (closeElement && target instanceof Node && closeElement.contains(target)) {
                    return false;
                }
            },
        });
    }

    /**
     * Registers the single toolbar drop target that drives the insertion bar and
     * commits the reorder. `onDragOver` returns `null` to suppress the drag
     * manager's own horizontal reorder indicator in favour of the main-axis
     * {@link TabReorderBar}.
     *
     * @returns The target teardown closure.
     */
    private makeTabDropTarget(): () => void {
        return DragManager.makeDropTarget(this._clipFrame, {
            // Host the validity tint in the (non-scrolling) toolbar layer, over
            // the clip frame's box, so it overlays the visible tab viewport and
            // stays put while the tabs scroll inside the clip frame.
            feedbackHost: this._toolbar,
            accepts: (detail: DragEventDetail): boolean => this.isTabReorderDrag(detail),
            onDragOver: (detail: DragEventDetail): number | null => {
                this.updateReorderSlot(detail);

                return null;
            },
            onDragLeave: (): void => {
                this._reorderBar.hide();
            },
            onDrop: (detail: DragEventDetail): void => {
                this.dropReorder(detail);
            },
        });
    }

    /**
     * Tests whether a drag is a header reorder originating from this strip.
     *
     * @param detail - The drag event detail.
     *
     * @returns `true` when the drag carries the reorder marker and its source is
     *   one of this strip's tab wrappers.
     */
    private isTabReorderDrag(detail: DragEventDetail): boolean {
        return detail.dragData["tabReorder"] === true
            && this._tabs.some(entry => entry.wrapper.getId() === detail.sourceId);
    }

    /**
     * Computes the insertion slot from the cursor's main-axis position, caches it
     * in `_dragInsertIndex`, and places the insertion bar at the slot boundary.
     *
     * @param detail - The drag event detail (carries the viewport cursor).
     */
    private updateReorderSlot(detail: DragEventDetail): void {
        const element = this._clipFrame.getElement();

        if (!element) {
            return;
        }

        const rect = element.getBoundingClientRect();
        const vertical = this.isVertical();

        // The clip frame scrolls its content natively, but `rect` is the border
        // box, which ignores that scroll. The wrappers' getX()/getY() are in the
        // scrolled content space, so add the scroll offset to land the cursor in
        // the same space — otherwise a scrolled strip maps it to the wrong slot.
        const cursorMain = (vertical ? detail.clientY - rect.top : detail.clientX - rect.left)
            + this.clipScroll();

        let insertIndex = this._tabs.length;

        for (let i = 0; i < this._tabs.length; i++) {
            const wrapper = this._tabs[i].wrapper;
            const start = vertical ? wrapper.getY() : wrapper.getX();
            const extent = vertical ? wrapper.getHeight() : wrapper.getWidth();

            if (cursorMain < start + extent / 2) {
                insertIndex = i;

                break;
            }
        }

        this._dragInsertIndex = insertIndex;

        const boundary = this.slotBoundary(insertIndex, vertical);
        const thickness = vertical ? this._clipFrame.getWidth() : this._clipFrame.getHeight();

        this._reorderBar.placeAt(boundary, thickness, vertical);
    }

    /**
     * Resolves the main-axis coordinate of a slot boundary: the leading edge of
     * the wrapper at `insertIndex`, or the trailing edge of the last wrapper for
     * an append.
     *
     * @param insertIndex - The slot index in `[0, tabs.length]`.
     * @param vertical - Whether the strip's main axis is Y.
     *
     * @returns The boundary's main-axis coordinate in px.
     */
    private slotBoundary(insertIndex: number, vertical: boolean): number {
        if (insertIndex < this._tabs.length) {
            const wrapper = this._tabs[insertIndex].wrapper;

            return vertical ? wrapper.getY() : wrapper.getX();
        }

        if (this._tabs.length > 0) {
            const wrapper = this._tabs[this._tabs.length - 1].wrapper;

            return vertical ? wrapper.getY() + wrapper.getHeight() : wrapper.getX() + wrapper.getWidth();
        }

        return 0;
    }

    /**
     * Commits a header reorder drop: hides the bar, maps the drag source back to
     * its tab, and moves it to the cached insertion slot.
     *
     * @param detail - The drag event detail (carries the source id).
     */
    private dropReorder(detail: DragEventDetail): void {
        this._reorderBar.hide();

        const fromIdx = this._tabs.findIndex(entry => entry.wrapper.getId() === detail.sourceId);

        if (fromIdx < 0 || this._dragInsertIndex < 0) {
            return;
        }

        this.reorderTab(fromIdx, this._dragInsertIndex);
        this._dragInsertIndex = -1;
    }

    /**
     * Moves a tab from `fromIdx` to the insertion slot `toIdx`, keeping the
     * formerly-selected tab selected by identity. Reorders the wrapper among the
     * toolbar's children via `moveComponent`.
     *
     * @param fromIdx - The dragged tab's current index.
     * @param toIdx - The insertion slot in `[0, tabs.length]`.
     */
    private reorderTab(fromIdx: number, toIdx: number): void {
        if (fromIdx < 0 || fromIdx >= this._tabs.length) {
            return;
        }

        // An insertion slot past the source collapses by one once the source is
        // spliced out; clamp into the post-removal index range.
        let dest = toIdx > fromIdx ? toIdx - 1 : toIdx;
        dest = Math.max(0, Math.min(dest, this._tabs.length - 1));

        if (dest === fromIdx) {
            return;
        }

        const entry = this._tabs[fromIdx];
        const selectedEntry = this._tabs[this._selectedTabIndex];

        this._tabs.splice(fromIdx, 1);
        this._tabs.splice(dest, 0, entry);

        this._clipFrame.moveComponent(entry.wrapper, dest);

        const newSelected = this._tabs.indexOf(selectedEntry);

        if (newSelected >= 0) {
            this._selectedTabIndex = newSelected;
        }

        this.getContainer()?.scheduleLayout();
    }

    /**
     * Tears down all drag sources, the drop target, and the mousedown capture,
     * and hides the insertion bar. Called from `detach` and `setReorderable(false)`.
     */
    private teardownTabDnD(): void {
        for (const teardown of this._dndTeardowns) {
            teardown();
        }

        this._dndTeardowns = [];
        this._reorderBar.hide();
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

        // Capture before the splice mutates the array: only a closed *active*
        // tab forces a selection move; closing a background tab keeps it.
        const wasSelected = this._selectedTabIndex === entryIndex;

        const contentComponent = entry.component;

        this._buttonGroup.removeButton(entry.button);
        this._rovingTabIndex.remove(entry.button);
        this._tabs.splice(entryIndex, 1);
        this._clipFrame.removeComponent(entry.wrapper);

        // Removing the wrapper's element does not purge the module-level subtree
        // listener map (keyed by component id), so the contextmenu listener —
        // and the entry it closes over — must be torn down explicitly.
        Event.removeSubtreeListener(entry.wrapper, "contextmenu", entry.contextMenuListener);

        if (contentComponent) {
            container.removeComponent(contentComponent);
        }

        if (contentComponent) {
            this.emit("tabclose", contentComponent);
        }

        this.selectNextTab(entryIndex, wasSelected);
        this.getContainer()?.scheduleLayout();
    }

    /**
     * Re-selects after the tab at `closedIndex` has been spliced out. When the
     * closed tab was the active one, falls back to its left neighbour;
     * otherwise the active tab stays selected and only its stored index shifts
     * left when the removed tab sat to its left.
     *
     * @param closedIndex - The pre-splice index of the removed tab.
     * @param closedWasSelected - Whether the removed tab was the active one.
     */
    private selectNextTab(closedIndex: number, closedWasSelected: boolean): void {
        const count = this._tabs.length;

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
