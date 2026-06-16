// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Panel } from "~/core/Panel.js";
import { Component } from "~/core/Component.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { Button } from "~/component/button/Button.js";
import { TabCloseButton } from "~/component/button/TabCloseButton.js";
import { Event } from "~/core/Event.js";
import { ThemeManager } from "~/core/Theme.js";
import { Insets } from "~/primitive/Insets.js";
import { ButtonGroup } from "~/core/ButtonGroup.js";
import { RovingTabIndex } from "~/core/RovingTabIndex.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { BoxLayout } from "~/layout/BoxLayout.js";
import { Menu } from "~/core/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { Glyph } from "~/component/display/Glyph.js";
import { angle_left } from "~/glyphs/solid/angle_left.js";
import { angle_right } from "~/glyphs/solid/angle_right.js";
import { angle_up } from "~/glyphs/solid/angle_up.js";
import { angle_down } from "~/glyphs/solid/angle_down.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { DragManager, DragEventDetail, DragData, TabDragData } from "~/core/DragManager.js";
import { callable } from "~/core/Callable.js";
import type { TabWidthMode, TabSide, TabAlign, TabOrientation, TabTextAlign } from "~/layout/Tab.js";

// Register the overflow scroll-arrow glyphs so the arrows render regardless of
// which glyphs the consumer has imported (mirrors TabCloseButton's xmark seed).
Glyph.register(angle_left, angle_right, angle_up, angle_down);

/**
 * Duration (ms) of the selection indicator's slide. Matches `AnimatedDropdown`'s
 * default so the bar's indicator and the ComboBox caret animate at the same pace
 * (and the owning `Tab`'s cross-tab content fade, which keeps its own copy).
 */
const TAB_FADE_DURATION_MS = 120;

/**
 * Minimum strip thickness (px) on the cross axis — the *floor* `stripThickness`
 * falls back to before any tab has reported a preferred size (an empty or
 * pre-first-layout strip). Once buttons measure, the strip grows past this to fit
 * the font (see {@link TabBar.stripThickness}); this is no longer the value, only
 * the pre-measurement floor. Kept at the legacy `setPreferredSize(0, 30)` seed
 * the top-only strip was tuned against so an unmeasured strip looks unchanged.
 * Reduced to `STRIP_THICKNESS_COMPACT` when the strip is `compact`.
 */
const STRIP_THICKNESS = 30;

/** Reduced cross-axis strip thickness floor (px) used when the strip is `compact`. */
const STRIP_THICKNESS_COMPACT = 24;

/**
 * Extra main-axis gap (px) between the leading widget's box and the first tab,
 * folded into the reserved lead extent (never into the widget's own box). Small
 * because the leading widget already carries the same tool inset as the trailing
 * controls (its box has a main-axis pad of its own), and the first tab carries
 * its tab inset — so the boxes nearly butt, with their own insets supplying most
 * of the breathing room and this knob adding a hair of separation.
 */
const LEAD_GLYPH_GAP = 4;

/**
 * Main-axis length (px) of each overflow scroll-arrow button — square against
 * the strip thickness. Wide enough to be an easy click target, matching the
 * default tab height.
 */
const SCROLL_ARROW_SIZE = 24;

/**
 * Floor (px) for the per-overflow-arrow-click scroll step, used only before a
 * tab has measured. {@link TabBar.scrollStepExtent} derives the live step from
 * the first tab's predicted extent so a click pages by ≈ one tab at any font
 * size; this kicks in when no tab has a preferred size yet (the predicted extent
 * is 0). Kept at the legacy fixed step so a pre-measurement click still nudges.
 */
const SCROLL_ARROW_STEP = 80;

/**
 * String-literal union of the framework-custom events a {@link TabBar} emits to
 * its content owner. The bar interprets each DOM gesture into a window-agnostic
 * intent and the owner (typically a [`Tab`](/api/layout/classes/Tab)) reacts; the bar itself never
 * touches the content, a `Window`, or a `Tab`.
 *
 * - `"tabpressed"(id)` — a cell was activated; the owner swaps content / runs lazy-load.
 * - `"reordered"(fromId, toIndex)` — an in-strip reorder committed; the owner
 *   re-derives its content order from {@link TabBar.getEntryIds}.
 * - `"tabclose"(id)` — a cell's ✕ was clicked; the owner removes the content.
 * - `"dockrequested"(componentId, slot)` — a foreign tab was dropped here; the
 *   owner resolves and docks the live content keyed by `componentId`.
 * - `"tabdragstart"(id)` — a cell's drag committed; the owner registers its live
 *   content so a foreign strip's drop can resolve it.
 * - `"tearoffrequested"(id, clientX, clientY, forceBare)` — a cell was released
 *   over empty space; the owner tears it off (only if its content is ready).
 * - `"detached"(id)` — a cell's drag was released onto a target; the owner drops
 *   the cell only if the content left its container (a within-strip reorder is a
 *   no-op for the owner).
 *
 * @category Components
 */
export type TabBarEvent =
    "tabpressed" | "reordered" | "tabclose" | "dockrequested" | "tabdragstart" | "tearoffrequested" | "detached";

/**
 * Construction-time options for {@link TabBar} — the bar-only subset of the
 * owning `Tab`'s options (no content / tear-off / lazy-load fields).
 *
 * @category Components
 */
export interface TabBarOptions extends ContainerOptions {
    /** Multi-event listener bag dispatched to {@link TabBar.on} at construction time. */
    listeners?: {
        tabpressed?:       (id: string) => void;
        reordered?:        (fromId: string, toIndex: number) => void;
        tabclose?:         (id: string) => void;
        dockrequested?:    (componentId: string, slot: number) => void;
        tabdragstart?:     (id: string) => void;
        tearoffrequested?: (id: string, clientX: number, clientY: number, forceBare: boolean) => void;
        detached?:         (id: string) => void;
    };

    /** Tab-button width strategy; defaults to `"equal"`. */
    widthMode?: TabWidthMode;

    /** Per-tab maximum width in px for `"content"` / `"equal"` modes; `null` (the default) leaves tabs uncapped. */
    maxWidth?: number | null;

    /** Per-tab width in px for `"fixed"` mode; defaults to `120`. */
    fixedWidth?: number;

    /**
     * Whether the 1px strip under-border runs edge-to-edge. When omitted, follows
     * the active theme's `tab.underBorderFullWidth`; setting it explicitly pins
     * the value and stops it tracking the theme.
     */
    underBorderFullWidth?: boolean;

    /** Which edge the tab strip sits on; defaults to `"north"`. */
    side?: TabSide;

    /** Main-axis alignment of the tab-button group; defaults to `"start"`. */
    align?: TabAlign;

    /** Text orientation on the vertical sides; defaults to `"horizontal"`. */
    orientation?: TabOrientation;

    /**
     * Whether an overflowing strip scrolls (leading/trailing arrow buttons, tabs
     * kept at preferred size) instead of compressing the tabs to fit. Defaults to
     * `false`.
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
 * Bookkeeping record for one bar cell — the bar half of the old `TabEntry`. Holds
 * everything the bar needs to render the cell, run its DnD, and report which cell
 * was acted on. Carries **no** content reference: the owner keys its own content
 * record by the same stable `id`, and `contentId` is a plain string (the live
 * content's component id, `""` until it materializes) the bar puts on the drag
 * payload so a foreign strip can resolve the content.
 */
interface BarEntry {
    id: string;
    wrapper: Component;
    button: ToggleButton;
    closeButton?: TabCloseButton;
    /** The cell's display label — the same `name` the button was built with. */
    name: string;
    constraints?: LayoutConstraints;
    /**
     * The wrapper's `contextmenu` subtree listener, retained so {@link TabBar.removeBarEntry}
     * can remove it. Subtree listeners are keyed by component id in a module-level
     * map (see {@link Event.addSubtreeListener}); removing the wrapper's element
     * does not purge that map, so the listener must be torn down explicitly or it
     * (and the entry it closes over) leaks across open/close churn.
     */
    contextMenuListener: (e: MouseEvent) => void;
    /** The live content's component id, supplied by the owner via {@link TabBar.setEntryContentId}; `""` until set. */
    contentId: string;
}

/**
 * The single shared selection bar that slides along the active tab. Styles
 * itself entirely from theme tokens; {@link TabBar} drives its position and
 * extent via {@link slideTo} on each layout pass.
 *
 * @remarks Lives as a raw-appended overlay inside the tab clip frame's element
 * rather than a laid-out child, so the box never allocates it a tab-cell slot.
 * The bar pins to the strip's *inner* edge (bottom for north, top for south,
 * right for west, left for east) and slides along the strip's main axis (X for
 * north/south, Y for west/east).
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
 * {@link TabIndicator} it is a raw-appended overlay inside the clip frame element
 * (so the box never allocates it a cell) and is driven entirely by {@link TabBar}.
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
 * The faint full-strip wash shown while a tab-header drag hovers the strip — the
 * "you can drop a tab here" affordance, the strip's counterpart to the
 * [`DropZoneOverlay`](/api/core/classes/DropZoneOverlay) root tint a
 * [`DockRegion`](/api/layout/classes/DockRegion) paints over a region. It shares
 * the dock's drop-zone token so the whole-target droppable cue reads the same
 * blue everywhere; the precise insertion position is the brighter
 * {@link TabReorderBar} drawn above it (`z-index` 1 vs 2). Pure affordance — no
 * pointer events, hidden until a drag positions it.
 */
class TabDropTint extends Component {

    /** Builds the wash: faint drop-zone blue, below the reorder bar, hidden. */
    constructor() {
        super();

        this.setBackgroundColor("var(--ts-ui-drag-dropzone-bg)");
        this.setPointerEvents("none");
        this.setZIndex(1);
        this.setVisible(false);
    }

    /**
     * Sizes the wash to cover `strip` (the clip viewport it is parented in) and
     * shows it.
     *
     * @param strip - The clip frame whose visible box the wash should cover.
     *
     * @returns This wash, for chaining.
     */
    showOver(strip: Component): this {
        this.setX(0);
        this.setY(0);
        this.setWidth(strip.getWidth());
        this.setHeight(strip.getHeight());
        this.setVisible(true);

        return this;
    }

    /** Hides the wash (drag left the strip, or the drop completed). */
    hide(): this {
        this.setVisible(false);

        return this;
    }
}

/**
 * A standalone, window-agnostic tab **strip** — the toolbar element, the tab
 * buttons, the selection indicator, the reorder bar, the tool group, overflow
 * scrolling, and all tab drag-and-drop — with **no** content machinery. It is
 * the bar half extracted from the [`Tab`](/api/layout/classes/Tab) layout
 * manager, which now composes one and reacts to its events.
 *
 * `TabBar` owns one DOM element (the strip toolbar) and renders the cells the
 * owner registers through {@link createBarEntry}. It interprets each DOM gesture
 * (click, drag, drop, right-click, arrow key) into a window-agnostic
 * {@link TabBarEvent} the owner reacts to — the bar never touches content, a
 * `Window`, or a `Tab`, so it is a pure dependency sink. The strip is positioned
 * by its owner through {@link prepareStrip} → {@link stripThickness} →
 * {@link placeStrip} each layout pass.
 *
 * Extends [`Container`](/api/core/classes/Container) (not a bare `Component`) so
 * the strip fills its allocated edge: `clampsToContentSize()` is `false` (defined
 * on `Container`), so `setWidth` / `setHeight` accept the full container extent
 * instead of shrinking to the tab buttons' content max.
 *
 * @category Components
 */
class TabBar extends Container<TabBarOptions> {

    // Clips the tab region. Holds the tab wrappers (its box children), the
    // selection indicator, and the reorder bar; positioned to the scrollable tab
    // region between the chrome (tool group + arrows) and set to overflow:hidden,
    // so a scrolled tab — and its overlaid ✕ — is clipped at the region edge
    // instead of bleeding over the tool buttons. The chrome lives on the strip
    // element (this), outside this frame.
    private _tabClip: Panel = new Panel();
    private _entries: Array<BarEntry> = [];
    private _buttonGroup: ButtonGroup = new ButtonGroup();
    // The strip owns the clip frame's native scroll explicitly (arrow clicks and
    // `revealSelectedIfRequested` are the only writers). Focus the active tab
    // without the browser also scrolling its `overflow:hidden` clip frame into
    // view, so that single scroll path stays authoritative.
    private _rovingTabIndex: RovingTabIndex = new RovingTabIndex({ preventScroll: true });
    // The active cell's id (the bar tracks selection by id, not index, so it
    // stays correct across reorder/dock/close — see the class docs). `null` until
    // the first cell is created.
    private _activeId: string | null = null;
    private _listeners: ListenerBag<TabBarEvent> = new ListenerBag<TabBarEvent>();

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
    // overlay (its own inner box) raw-appended to the strip element next to the
    // indicator, rather than enrolled as box children — so the tab wrappers stay
    // the clip frame's only box children and their indices line up 1:1 with
    // `_entries` for the reorder/indicator/close-button math.
    private _tools: Component[] = [];
    // Also a Panel so it fills its reserved slot rather than clamping to the tool
    // buttons' content max (same reason as the strip itself).
    private _toolGroup: Panel = new Panel();

    // Leading-slot group pinned at the start of the strip, align-independent —
    // unlike `_toolGroup`, which flips ends with `_align`. A stretching HBox/VBox
    // overlay that mirrors `_toolGroup` exactly, so the hosted widget is stretched
    // across the strip thickness and its glyph auto-syncs to the strip line-height
    // the same way a trailing tool's does (a bare raw-appended widget would skip
    // that stretch-and-sync and end up smaller than the controls). Transparent and
    // pointer-transparent: the hosted widget is decorative and presses fall through
    // to the empty-area window-move trigger.
    private _leadGroup: Panel = new Panel();
    // The single caller-supplied widget hosted in `_leadGroup`, or null until
    // `setLeadingWidget` is first called. Tracked separately so the extent/position
    // helpers can short-circuit to a no-op when the slot is empty.
    private _leadWidget: Component | null = null;

    // Overflow "arrows" chrome: leading/trailing scroll buttons, hidden when the
    // strip fits. Built lazily the first time `scrollable` is enabled.
    private _scrollLeadButton: Button | null = null;
    private _scrollTrailButton: Button | null = null;
    // One-shot: scroll the selected tab into view on the next layout. Set when
    // scrolling first becomes active (enabling `scrollable`, or a side switch
    // while scrollable), so the selected tab isn't left clipped off-screen.
    private _scrollToSelected: boolean = false;

    // Within-strip drag-reorder wiring (see installTabDnD / teardownTabDnD).
    private _reorderable: boolean = false;
    private _reorderBar: TabReorderBar = new TabReorderBar();
    private _dropTint: TabDropTint = new TabDropTint();
    private _dndTeardowns: Array<() => void> = [];
    private _dragMouseTarget: EventTarget | null = null;

    // Teardown for the empty-bar-area window-move trigger (see installMoveTrigger).
    // Kept OUT of `_dndTeardowns` because that array is swept by teardownTabDnD on
    // every reorder/first-render install — which would kill the gesture. Drained
    // only by dispose().
    private _moveTriggerTeardown: (() => void) | null = null;

    // Whether Shift was held at the press that began a tab drag — captured at
    // mousedown (the drag callbacks get no key state) and read at tear-off so the
    // owner can force a bare detach window regardless of its detach mode.
    private _dragShiftHeld: boolean = false;
    private _dragInsertIndex: number = -1;

    /**
     * Creates a tab strip with an empty toolbar.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TabBarOptions) {
        super(options);

        // This bar's element is the strip toolbar (was Tab._toolbar). Configure
        // it, then build the raw-appended chrome overlays. The base options were
        // already dispatched by the Container/Component super cascade; the bar-only
        // options are dispatched at the end of this body once the sub-components
        // exist (so a `tools` / `listeners` option has somewhere to land).
        this.setLayoutManager(new HBox({ mode: "equal", spacing: 0 }));
        this.setBackgroundColor("var(--ts-ui-tab-toolbar-bg, #eee)");
        this._underBorderFullWidth = ThemeManager.getTheme().tab.underBorderFullWidth;
        this.applyUnderBorder();
        // Seeds the bar's own preferred size with the floor; the owning `Tab`
        // sizes the strip from `stripThickness()` directly (never from this
        // self-report), so this is only the bar's pre-layout self-size, kept at
        // the floor so it matches the unmeasured strip.
        this.setPreferredSize(0, STRIP_THICKNESS);
        this.getAria().setRole("tablist");

        // The tab wrappers live in the clip frame (its box lays them out), not on
        // the strip directly. Transparent so the strip background and under-border
        // show through; overflow:hidden clips scrolled tabs (and their close
        // overlays) at the tab-region edge. Hand-positioned in `layoutChrome`, so
        // it is raw-appended (not a strip box child).
        this._tabClip.setLayoutManager(new HBox({ mode: "equal", spacing: 0 }));
        this._tabClip.setBackgroundColor("transparent");
        this._tabClip.clearInsets();
        this._tabClip.setOverflow("hidden");

        // The tool group is a hand-positioned overlay (not a strip box child); it
        // runs its own box to lay its buttons out along the strip's main axis,
        // stretching them across the strip thickness (the box's cross axis).
        this._toolGroup.setLayoutManager(new HBox({ spacing: 0, stretching: true }));
        // Opaque strip background (not transparent) so scrolled tabs slide behind
        // the tool group rather than showing through it.
        this._toolGroup.setBackgroundColor("var(--ts-ui-tab-toolbar-bg, #eee)");
        this._toolGroup.clearInsets();
        // Lift the tool group above the tab wrappers (which are appended later in
        // DOM order) so its buttons stay clickable in their reserved slot.
        this._toolGroup.setZIndex(1);

        // The leading group mirrors the tool group at the opposite (start) end:
        // its own stretching box lays the hosted widget out across the strip
        // thickness so the widget's glyph syncs to the strip line-height exactly
        // like a trailing tool, making it a true size/inset peer of the controls.
        // Transparent (the strip start sits before the scrollable tab clip, so no
        // tab ever slides behind it) and pointer-transparent (decorative — presses
        // fall through to the empty-area window-move trigger).
        this._leadGroup.setLayoutManager(new HBox({ spacing: 0, stretching: true }));
        this._leadGroup.setBackgroundColor("transparent");
        this._leadGroup.clearInsets();
        this._leadGroup.setZIndex(1);
        this._leadGroup.setPointerEvents("none");

        // Follow the active theme's under-border default until a consumer pins it
        // explicitly. Torn down in dispose(). The owner re-lays-out the strip on
        // theme change (it owns the band geometry); this only tracks the border.
        this._themeCleanup = ThemeManager.onThemeChange(() => {
            if (!this._underBorderFromTheme) {
                return;
            }

            this._underBorderFullWidth = ThemeManager.getTheme().tab.underBorderFullWidth;
            this.applyUnderBorder();
        });

        this.dispatchBarOptions(options);
    }

    /**
     * Dispatches the bar-only options through their typed setters once the strip
     * sub-components exist. Run from the constructor body (not `applyOptions`,
     * which fires inside the Panel/Component `super()` cascade before the clip
     * frame, tool group, and listener bag are constructed).
     *
     * @param options - The construction options, or `undefined`.
     */
    private dispatchBarOptions(options?: TabBarOptions): void {
        if (!options) {
            return;
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

        if (options.listeners) {
            const l = options.listeners;

            if (l.tabpressed)       this.on("tabpressed", l.tabpressed);
            if (l.reordered)        this.on("reordered", l.reordered);
            if (l.tabclose)         this.on("tabclose", l.tabclose);
            if (l.dockrequested)    this.on("dockrequested", l.dockrequested);
            if (l.tabdragstart)     this.on("tabdragstart", l.tabdragstart);
            if (l.tearoffrequested) this.on("tearoffrequested", l.tearoffrequested);
            if (l.detached)         this.on("detached", l.detached);
        }
    }

    /**
     * Recolors every opaque toolbar surface of the bar — the strip Panel itself,
     * the tool-group overlay, and (when built) the two scroll-arrow buttons — so a
     * focus-state swap paints the whole bar uniformly. A recolor only; it does not
     * relayout.
     *
     * @param color - A CSS color string applied to every toolbar surface.
     *
     * @returns This tab strip, for method chaining.
     */
    setBarSurfaceColor(color: string): this {
        this.setBackgroundColor(color);
        this._toolGroup.setBackgroundColor(color);
        this._scrollLeadButton?.setBackgroundColor(color);
        this._scrollTrailButton?.setBackgroundColor(color);

        return this;
    }

    /**
     * Raw-appends the chrome overlays (clip frame, tool group, indicator, reorder
     * bar) into the strip element, wires the toolbar keyboard handler, and
     * performs the deferred drag-reorder install. Runs once, at first render —
     * the strip element exists by then, unlike during construction.
     *
     * @param element - Optional. The element to initialise; falls back to `getElement()`.
     *
     * @returns This tab strip, for method chaining.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const host = element ?? this.getElement(true);

        // The clip frame (which holds the tab wrappers) and the tool group are
        // raw-appended overlays — positioned manually in `layoutChrome` rather
        // than enrolled in a box. The selection indicator and reorder bar go
        // *inside* the clip frame so they share the wrappers' coordinate space
        // (and clip / scroll with them) rather than the strip's.
        host.appendChild(this._tabClip.getElement(true));
        host.appendChild(this._toolGroup.getElement(true));
        host.appendChild(this._leadGroup.getElement(true));

        const clip = this._tabClip.getElement(true);
        clip.appendChild(this._indicator.getElement(true));
        clip.appendChild(this._dropTint.getElement(true));
        clip.appendChild(this._reorderBar.getElement(true));

        Event.addSubtreeListener(this, "keydown", (e: KeyboardEvent) => this.onToolbarKeyDown(e));

        // The reorder option may have been set during construction before the
        // strip element existed; perform the deferred install now.
        if (this._reorderable) {
            this.installTabDnD();
        }

        return this;
    }

    /**
     * Tears the strip down: removes the theme subscription and all drag wiring,
     * then removes the element from the DOM. Called by the owner when it detaches.
     *
     * @returns This tab strip, for method chaining.
     */
    dispose(): this {
        if (this._themeCleanup) {
            this._themeCleanup();
            this._themeCleanup = null;
        }

        this.teardownTabDnD();
        this._moveTriggerTeardown?.();
        this._moveTriggerTeardown = null;
        this.getElement()?.remove();

        return this;
    }

    /**
     * Applies the current `_underBorderFullWidth` value to the strip: a full-width
     * 1px rule when set, no border when cleared.
     */
    private applyUnderBorder(): void {
        if (!this._underBorderFullWidth) {
            this.clearBorder();

            return;
        }

        const rule = "1px solid var(--ts-ui-tab-toolbar-border, #e1e1e8)";

        // The under-border is the single rule between the strip and the content
        // area, so it sits on the strip's *inner* edge — the one adjacent to the
        // content: bottom for north, top for south, right for west, left for
        // east. The other three edges stay borderless.
        this.setBorder({
            borderTop:    this._side === "south" ? rule : "none",
            borderBottom: this._side === "north" ? rule : "none",
            borderLeft:   this._side === "east"  ? rule : "none",
            borderRight:  this._side === "west"  ? rule : "none",
        });
    }

    /**
     * Selects the tab-button width strategy and re-lays out the strip.
     *
     * @param mode - The width strategy to apply.
     *
     * @returns This tab strip, for method chaining.
     */
    setWidthMode(mode: TabWidthMode): this {
        this._widthMode = mode;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-button width strategy.
     *
     * @returns The active [`TabWidthMode`](/api/layout/type-aliases/TabWidthMode).
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
     * @returns This tab strip, for method chaining.
     */
    setMaxWidth(px: number | null): this {
        this._maxWidth = px;

        this.scheduleLayout();

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
     * @returns This tab strip, for method chaining.
     */
    setFixedWidth(px: number): this {
        this._fixedWidth = px;

        this.scheduleLayout();

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
     * Toggles the edge-to-edge 1px rule under the tab strip. Pins the value for
     * this instance, so it no longer follows the active theme's
     * `tab.underBorderFullWidth` default on theme changes.
     *
     * @param full - `true` to draw the strip's full-width under-border, `false` to remove it.
     *
     * @returns This tab strip, for method chaining.
     */
    setUnderBorderFullWidth(full: boolean): this {
        this._underBorderFromTheme = false;
        this._underBorderFullWidth = full;

        this.applyUnderBorder();

        this.scheduleLayout();

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
     * out. Caches the value and resets the scroll; the orientation swap and
     * placement happen in the next layout pass.
     *
     * @param side - The [`TabSide`](/api/layout/type-aliases/TabSide) to place the strip on.
     *
     * @returns This tab strip, for method chaining.
     */
    setSide(side: TabSide): this {
        this._side = side;

        // The scroll axis flips with the side, so start the new side unscrolled,
        // then bring the selected tab into view if the new axis is scrollable.
        this._tabClip.setScrollLeft(0);
        this._tabClip.setScrollTop(0);

        if (this._scrollable) {
            this._scrollToSelected = true;
        }

        this.applyUnderBorder();

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the edge the tab strip currently sits on.
     *
     * @returns The active [`TabSide`](/api/layout/type-aliases/TabSide).
     */
    getSide(): TabSide {
        return this._side;
    }

    /**
     * Sets the main-axis alignment of the tab-button group within the strip and
     * re-lays out.
     *
     * @param align - The [`TabAlign`](/api/layout/type-aliases/TabAlign) to apply.
     *
     * @returns This tab strip, for method chaining.
     */
    setAlign(align: TabAlign): this {
        this._align = align;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-button-group alignment.
     *
     * @returns The active [`TabAlign`](/api/layout/type-aliases/TabAlign).
     */
    getAlign(): TabAlign {
        return this._align;
    }

    /**
     * Sets the tab-button text orientation for the vertical sides and re-lays
     * out. Caches the value only; the layout pass re-applies the `writing-mode`
     * to every tab button.
     *
     * @param orientation - The [`TabOrientation`](/api/layout/type-aliases/TabOrientation) to apply.
     *
     * @returns This tab strip, for method chaining.
     */
    setOrientation(orientation: TabOrientation): this {
        this._orientation = orientation;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the current vertical-side tab text orientation.
     *
     * @returns The active [`TabOrientation`](/api/layout/type-aliases/TabOrientation).
     */
    getOrientation(): TabOrientation {
        return this._orientation;
    }

    /**
     * Sets the strip-wide tab-label justification and re-lays out. Caches the
     * value only; the layout pass re-applies the `text-align` to every tab button.
     *
     * @param align - The [`TabTextAlign`](/api/layout/type-aliases/TabTextAlign) to apply.
     *
     * @returns This tab strip, for method chaining.
     */
    setTextAlign(align: TabTextAlign): this {
        this._textAlign = align;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-label justification.
     *
     * @returns The active [`TabTextAlign`](/api/layout/type-aliases/TabTextAlign).
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
     * @returns This tab strip, for method chaining.
     */
    setScrollable(value: boolean): this {
        // Enabling from a non-scrolling state: reveal the selected tab on the next
        // layout rather than starting at offset 0 (it may be off-screen).
        if (value && !this._scrollable) {
            this._scrollToSelected = true;
        }

        this._scrollable = value;

        this.scheduleLayout();

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
     * Toggles reduced tab-button insets (a denser strip) and re-lays out. Caches
     * the value only; the layout pass re-derives every button's insets.
     *
     * @param value - `true` for compact insets, `false` for the default.
     *
     * @returns This tab strip, for method chaining.
     */
    setCompact(value: boolean): this {
        this._compact = value;

        // Compact changes every tab's width, which can leave the selected tab
        // partly clipped at the current scroll offset; nudge it back into view
        // (a no-op when it already fits, so the scroll position is otherwise kept).
        if (this._scrollable) {
            this._scrollToSelected = true;
        }

        this.scheduleLayout();

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
     * the drop target — but only when the strip element already exists (created at
     * first render). When called during construction it just caches the flag;
     * `init` performs the install if `_reorderable` is set.
     *
     * @param value - `true` to enable header drag-reorder.
     *
     * @returns This tab strip, for method chaining.
     */
    setReorderable(value: boolean): this {
        if (this._reorderable === value) {
            return this;
        }

        this._reorderable = value;

        if (!this.getElement()) {
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
     * @returns This tab strip, for method chaining.
     */
    addTool(button: Component): this {
        this._tools.push(button);
        this._toolGroup.addComponent(button);

        this.scheduleLayout();

        return this;
    }

    /**
     * Removes a previously-added tool button.
     *
     * @param button - The tool component to remove.
     *
     * @returns This tab strip, for method chaining.
     */
    removeTool(button: Component): this {
        const idx = this._tools.indexOf(button);

        if (idx < 0) {
            return this;
        }

        this._tools.splice(idx, 1);
        this._toolGroup.removeComponent(button);

        this.scheduleLayout();

        return this;
    }

    /**
     * Sets or clears the caller-supplied widget hosted in the leading slot (the
     * strip start, independent of `_align`). Removes any previous widget from the
     * leading group, then adds the new one as the group's child so the group's
     * stretching box lays it out across the strip thickness — the same treatment a
     * trailing tool gets. Passing `null` clears the slot.
     *
     * @param widget - The widget to host in the leading slot, or `null` to clear it.
     *
     * @returns This tab strip, for method chaining.
     *
     * @remarks
     * The hosting group is transparent and pointer-transparent, so the caller's
     * widget is decorative by default (a press on it falls through to the
     * empty-area window-move trigger). The widget is deliberately outside the
     * {@link setBarSurfaceColor} / `isBarChromeTarget` chrome set.
     */
    setLeadingWidget(widget: Component | null): this {
        if (this._leadWidget) {
            this._leadGroup.removeComponent(this._leadWidget);
        }

        this._leadWidget = widget;

        if (widget) {
            this._leadGroup.addComponent(widget);
        }

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the current leading widget, or `null` when none is set.
     *
     * @returns The leading {@link Component}, or `null`.
     */
    getLeadingWidget(): Component | null {
        return this._leadWidget;
    }

    /**
     * Returns whether an event target lands on the bar's interactive chrome —
     * a tab wrapper, the tool group, or an overflow scroll-arrow button — as
     * opposed to the draggable blank area. The tab clip is deliberately NOT
     * treated as chrome: it spans the whole tab band and its blank remainder
     * between the last tab and the fixed chrome IS the empty bar area, so
     * vetoing it would swallow every empty-area gesture.
     *
     * @param target - The event target to test.
     *
     * @returns `true` when the target is interactive bar chrome.
     */
    private isBarChromeTarget(target: EventTarget | null): boolean {
        if (!(target instanceof Node)) {
            return false;
        }

        for (const entry of this._entries) {
            const wrapperEl = entry.wrapper.getElement();

            if (wrapperEl && wrapperEl.contains(target)) {
                return true;
            }
        }

        const toolGroupEl = this._toolGroup.getElement();

        if (toolGroupEl && toolGroupEl.contains(target)) {
            return true;
        }

        const leadArrowEl = this._scrollLeadButton?.getElement() ?? null;

        if (leadArrowEl && leadArrowEl.contains(target)) {
            return true;
        }

        const trailArrowEl = this._scrollTrailButton?.getElement() ?? null;

        if (trailArrowEl && trailArrowEl.contains(target)) {
            return true;
        }

        return false;
    }

    /**
     * Installs window-chrome gestures on the strip's blank area: a subtree
     * `mousedown` invoking `onEmptyPress` (to start a window move) and, when
     * `onEmptyDoubleClick` is given, a subtree `dblclick` invoking it (to toggle
     * maximize). Both fire only for a press/click on the bar's empty area — not
     * on a tab wrapper, the tool group, or a scroll-arrow button (see
     * `isBarChromeTarget`) — so a host window can drive move and
     * maximize from the bar's blank space. Shift-modified presses are skipped on
     * the move trigger (reserved for re-dock gestures).
     *
     * Idempotent: any previously-installed trigger is torn down first. The
     * teardown lives in `_moveTriggerTeardown` (never `_dndTeardowns`, which
     * is swept on reorder / first-render install) and is drained only by
     * {@link dispose}.
     *
     * @param onEmptyPress - Callback invoked with the originating `mousedown`
     *   when an empty bar area is pressed.
     * @param onEmptyDoubleClick - Optional callback invoked with the originating
     *   `dblclick` when an empty bar area is double-clicked.
     *
     * @returns This tab strip, for method chaining.
     */
    installMoveTrigger(onEmptyPress: (e: MouseEvent) => void, onEmptyDoubleClick?: (e: MouseEvent) => void): this {
        this._moveTriggerTeardown?.();
        this._moveTriggerTeardown = null;

        // Inline-closure handlers (deliberate named-listener deviation, matching
        // the local recordMouseTarget precedent in installTabDnD): they capture
        // the callbacks and read the per-event veto neighbourhood live.
        const onBarMouseDown = (e: MouseEvent): void => {
            // Shift+press is a re-dock gesture, not a window move.
            if (e.shiftKey || this.isBarChromeTarget(e.target)) {
                return;
            }

            onEmptyPress(e);
        };

        Event.addSubtreeListener(this, "mousedown", onBarMouseDown);

        const teardowns: Array<() => void> = [
            (): void => Event.removeSubtreeListener(this, "mousedown", onBarMouseDown),
        ];

        if (onEmptyDoubleClick) {
            const onBarDoubleClick = (e: MouseEvent): void => {
                if (this.isBarChromeTarget(e.target)) {
                    return;
                }

                onEmptyDoubleClick(e);
            };

            Event.addSubtreeListener(this, "dblclick", onBarDoubleClick);
            teardowns.push((): void => Event.removeSubtreeListener(this, "dblclick", onBarDoubleClick));
        }

        this._moveTriggerTeardown = (): void => {
            for (const teardown of teardowns) {
                teardown();
            }
        };

        return this;
    }

    /**
     * Returns the cell ids in current strip order.
     *
     * @returns A copy of the ordered cell ids.
     */
    getEntryIds(): string[] {
        return this._entries.map(entry => entry.id);
    }

    /**
     * Returns the active cell's id, or `null` when the strip is empty.
     *
     * @returns The active cell id, or `null`.
     */
    getActiveEntryId(): string | null {
        return this._activeId;
    }

    /**
     * Reports whether the cell with `id` is closeable (its constraints carry
     * `closeable: true`).
     *
     * @param id - The cell id to query.
     *
     * @returns `true` when the cell is closeable; `false` for an unknown id.
     */
    isEntryCloseable(id: string): boolean {
        return this.entryById(id)?.constraints?.closeable === true;
    }

    /**
     * Returns the display label of the cell with `id`.
     *
     * @param id - The cell id to query.
     *
     * @returns The cell's label, or `""` for an unknown id.
     */
    getEntryName(id: string): string {
        return this.entryById(id)?.name ?? "";
    }

    /**
     * Records the live content's component id on the cell with `id`. The id feeds
     * the drag payload (so a foreign strip can resolve the content from the shared
     * registry) and the cell button's ARIA `aria-controls` (so the button is
     * announced as controlling its panel) — both reference the same component id.
     * The owner pushes this when the content materializes.
     *
     * @param id - The cell id whose content became available.
     * @param contentId - The content component's id.
     *
     * @returns This tab strip, for method chaining.
     */
    setEntryContentId(id: string, contentId: string): this {
        const entry = this.entryById(id);

        if (entry) {
            entry.contentId = contentId;
            entry.button.getAria().setControls(contentId);
        }

        return this;
    }

    /**
     * Returns the id of the cell's tab button — the owner reads it to set the
     * content panel's ARIA `aria-labelledby` back to the button.
     *
     * @param id - The cell id to query.
     *
     * @returns The tab button's component id, or `""` for an unknown id.
     */
    getEntryButtonId(id: string): string {
        return this.entryById(id)?.button.getId() ?? "";
    }

    /**
     * Returns the cell record for `id`, or `null` when no cell carries it.
     *
     * @param id - The cell id to look up.
     *
     * @returns The matching {@link BarEntry}, or `null`.
     */
    private entryById(id: string): BarEntry | null {
        return this._entries.find(entry => entry.id === id) ?? null;
    }

    /**
     * Returns the active cell record, or `null` when the strip is empty.
     *
     * @returns The active {@link BarEntry}, or `null`.
     */
    private activeEntry(): BarEntry | null {
        return this._activeId === null ? null : this.entryById(this._activeId);
    }

    /**
     * Builds the wrapper, toggle button, and optional close button for one cell,
     * registers them with the button group / roving tab index, and pushes the
     * cell onto the strip. The first cell created becomes the active one (matching
     * the legacy index-0 default); the owner re-selects later via
     * {@link setActiveEntry}.
     *
     * @param id - The owner-minted stable id linking this cell to its content.
     * @param name - The visible label for the tab button.
     * @param constraints - Optional layout constraints; `constraints.closeable` adds a close button.
     *
     * @returns This tab strip, for method chaining.
     */
    createBarEntry(id: string, name: string, constraints?: LayoutConstraints): this {
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

            // Shrink the ✕ glyph to roughly half the close-button hit box,
            // centred — the button stays the click target while the mark reads
            // lighter. Pin it (Glyph.setPreferredSize locks min/max too) so the
            // line-height sync never re-tracks the glyph to the title line height;
            // positionCloseButtons re-pins it to the base-scaled size each layout.
            closeButton.pinGlyphSize(ThemeManager.getResolvedScale().tabCloseGlyph);

            // Overlay it inside the cell rather than enrolling it in the Fit
            // layout (which would stretch it over the whole tab); `layoutChrome`
            // pins it to the right edge.
            wrapper.getElement(true).appendChild(closeButton.getElement(true));
        }

        // Subtree listener so a right-click on the label, the glyph, or the
        // close ✕ all reach one handler that opens the tab context menu. Named
        // and stored on the entry so `removeBarEntry` can remove it (the closure
        // over `entry`, resolved at call time, is safe because right-clicks only
        // fire after the entry is fully built).
        const onContextMenu = (e: MouseEvent): void => {
            e.preventDefault();
            this.openTabMenu(entry, e.clientX, e.clientY);
        };

        const entry: BarEntry = {
            id,
            wrapper,
            button: tabButton,
            closeButton,
            name,
            constraints,
            contextMenuListener: onContextMenu,
            contentId: "",
        };

        if (closeButton) {
            closeButton.on("action", () => this.emit("tabclose", id));
        }

        Event.addSubtreeListener(wrapper, "contextmenu", onContextMenu);

        this._entries.push(entry);

        // The first cell becomes active (the legacy index-0 default); thereafter
        // a cell joins inactive and the owner re-selects via setActiveEntry.
        const isSelected = this._activeId === null;

        if (isSelected) {
            tabButton.setSelected(true);
            this._activeId = id;
        }

        this._buttonGroup.addButton(tabButton);
        this._rovingTabIndex.add(tabButton);
        this._tabClip.addComponent(wrapper);

        tabButton.getAria().setRole("tab");
        tabButton.getAria().setSelected(isSelected);

        // A tab added while reorder is live (and the strip is rendered) needs its
        // own drag source; tabs added before render are wired by installTabDnD.
        if (this._reorderable && this.getElement()) {
            this._dndTeardowns.push(this.makeTabDragSource(entry));
        }

        return this;
    }

    /**
     * Removes the cell with `id` from the strip — the bar-side teardown (button
     * group, roving tab index, wrapper, context-menu listener). Leaves the owner
     * to drop its content record. No-op for an unknown id.
     *
     * @param id - The cell id to remove.
     *
     * @returns This tab strip, for method chaining.
     */
    removeBarEntry(id: string): this {
        const idx = this._entries.findIndex(entry => entry.id === id);

        if (idx < 0) {
            return this;
        }

        const entry = this._entries[idx];

        this._buttonGroup.removeButton(entry.button);
        this._rovingTabIndex.remove(entry.button);
        this._entries.splice(idx, 1);
        this._tabClip.removeComponent(entry.wrapper);

        // Subtree listeners are keyed by component id in a module-level map;
        // removing the wrapper's element does not purge it, so tear it down or it
        // (and the entry it closes over) leaks.
        Event.removeSubtreeListener(entry.wrapper, "contextmenu", entry.contextMenuListener);

        if (this._activeId === id) {
            this._activeId = null;
        }

        return this;
    }

    /**
     * Moves the cell with `id` to `toIndex` (clamped into range), keeping the
     * wrapper order in step. Used by the owner's dock path to land a freshly-added
     * cell at the drop slot.
     *
     * @param id - The cell id to move.
     * @param toIndex - The destination slot.
     *
     * @returns This tab strip, for method chaining.
     */
    moveBarEntry(id: string, toIndex: number): this {
        const from = this._entries.findIndex(entry => entry.id === id);

        if (from < 0) {
            return this;
        }

        const dest = Math.max(0, Math.min(toIndex, this._entries.length - 1));

        if (dest === from) {
            return this;
        }

        const entry = this._entries.splice(from, 1)[0];

        this._entries.splice(dest, 0, entry);
        this._tabClip.moveComponent(entry.wrapper, dest);

        return this;
    }

    /**
     * Activates the cell with `id` programmatically — the same selection sync a
     * click drives: the button group's pressed state, the roving tab index, the
     * indicator intent, and a `"tabpressed"` emit. No-op for an unknown id.
     *
     * @param id - The cell id to activate.
     *
     * @returns This tab strip, for method chaining.
     */
    setActiveEntry(id: string): this {
        const idx = this._entries.findIndex(entry => entry.id === id);

        if (idx < 0) {
            return this;
        }

        // Mirror the explicit button-group sync a programmatic switch needs: a
        // left-click drives the pressed state through the group, but a
        // programmatic activation must set it by hand or the target's content
        // moves while its button never looks pressed.
        this._entries.forEach(entry => entry.button.setSelected(false));
        this._entries[idx].button.setSelected(true);

        this.onTabPressed(this._entries[idx].button);

        return this;
    }

    /**
     * Re-selects the cell with `id` **visually only** — the button pressed state
     * and the active id, with no roving-focus move and no `"tabpressed"` emit.
     * Used by the owner to reinstate selection after a close, where the content
     * swap is the owner's own concern and re-firing selection would be wrong.
     *
     * @param id - The cell id to mark active.
     *
     * @returns This tab strip, for method chaining.
     */
    setActiveVisual(id: string): this {
        const idx = this._entries.findIndex(entry => entry.id === id);

        if (idx < 0) {
            return this;
        }

        this._entries.forEach(entry => entry.button.setSelected(false));
        this._entries[idx].button.setSelected(true);
        this._activeId = id;

        return this;
    }

    /**
     * Opens the shared context menu for a right-clicked tab. Lists every tab
     * (click to switch, the currently-active tab shown inert) followed by a
     * `Close` action gated on the tab's `closeable` constraint. Reuses the strip's
     * own {@link setActiveEntry} and the `"tabclose"` emit, so no activation or
     * close logic is duplicated.
     *
     * @param entry - The cell that was right-clicked.
     * @param x - Horizontal viewport coordinate of the click.
     * @param y - Vertical viewport coordinate of the click.
     */
    private openTabMenu(entry: BarEntry, x: number, y: number): void {
        const activeEntry = this.activeEntry();

        const configs: MenuItemConfig[] = this._entries.map(t => ({
            text:    t.name,
            // Disable only the tab that's already showing — switching to it is a
            // no-op — so a right-click on any other tab can still switch to it.
            enabled: t !== activeEntry,
            action:  () => this.setActiveEntry(t.id),
        }));

        configs.push({ separator: true });
        configs.push({
            text:    "Close",
            enabled: entry.constraints?.closeable === true,
            action:  () => this.emit("tabclose", entry.id),
        });

        this._contextMenu.show(x, y, configs);
    }

    /**
     * Updates the active cell, syncs the roving tab index and scroll-into-view
     * intent, and emits `"tabpressed"` when a tab button is activated. The owner's
     * `"tabpressed"` handler performs the content swap and re-lays out.
     *
     * @param button - The tab button component that was pressed.
     */
    private onTabPressed(button: Component): void {
        const idx = this._entries.findIndex(entry => entry.button === button);

        if (idx >= 0) {
            this._activeId = this._entries[idx].id;
            this._rovingTabIndex.moveTo(idx);

            // Bring the newly-selected tab into view on the next pass. A
            // left-click targets an already-visible tab (a no-op reveal), but a
            // programmatic switch — the context menu or keyboard arrow nav — can
            // select a tab scrolled out of the strip's visible range.
            if (this._scrollable) {
                this._scrollToSelected = true;
            }

            this.emit("tabpressed", this._entries[idx].id);
        }
    }

    /**
     * Derives a tab button's insets from the current `_compact` flag and the
     * active theme's resolved scale. The label gets two `pad` units of breathing
     * room per side (`pad` is the resolved `scale.tabButtonInset`, halved when
     * compact); closeable tabs additionally reserve the resolved `scale.tabClose`
     * close-button box on the edge where {@link positionCloseButtons} pins the ✕ —
     * the right for upright text (north/south and west/east horizontal), the
     * bottom or top for rotated cw / ccw text — so the label never runs under it.
     * Both the reservation and the pad scale with the base, while only the pad
     * additionally shrinks in the dense strip, so the glyph keeps its clearance.
     *
     * @param constraints - The tab's layout constraints; `constraints.closeable`
     *   adds the close-button reservation.
     *
     * @returns The insets to apply to the tab button.
     */
    private computeTabButtonInsets(constraints?: LayoutConstraints): Insets {
        const scale = ThemeManager.getResolvedScale();
        const pad = this._compact ? Math.round(scale.tabButtonInset / 2) : scale.tabButtonInset;
        const closeReserve = constraints?.closeable ? scale.tabClose : 0;

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
     * the button to it), so only the main-axis pad tightens in compact mode.
     *
     * @returns The insets to apply to each tool button.
     */
    private computeToolButtonInsets(): Insets {
        const inset = ThemeManager.getResolvedScale().tabButtonInset;
        const pad = this._compact ? Math.round(inset / 2) : inset;

        if (this.isVertical()) {
            return new Insets(pad * 2, 0, pad * 2, 0);
        }

        return new Insets(0, pad * 2, 0, pad * 2);
    }

    /**
     * Clamps a wrapper's extent on the strip's *main* axis (width for north/south,
     * height for west/east) to `[min, max]`, leaving the cross axis unbounded so
     * the box stretches it to the strip thickness.
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
     * `vertical-cw` / `vertical-ccw` orientation.
     *
     * @returns `true` for west/east with a vertical text orientation.
     */
    private isRotatedText(): boolean {
        return this.isVertical() && this._orientation !== "horizontal";
    }

    /**
     * Reads a tab button's preferred extent on the strip's **main** axis (width
     * for north/south, height for west/east).
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
     * strip's thickness contribution) — the complement of {@link buttonMainExtent}.
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
     * Computes the strip's thickness (px) on its cross axis, derived from the
     * *measured* tab buttons so the strip grows with the label's font.
     * `STRIP_THICKNESS` / `STRIP_THICKNESS_COMPACT` act as the floor used before
     * any tab has reported a preferred size (an empty or pre-first-layout strip),
     * never as the value itself.
     *
     * North/south grow the floor to the tallest button's content height plus
     * `stripChrome` (the vertical breathing the strip supplies, since the
     * north/south tab button carries no top/bottom inset — see
     * `computeTabButtonInsets`). West/east grow the floor to the widest
     * button (or tool) cross extent, which already bakes its breathing into the
     * button's left/right insets, so no chrome is added there. In `"fixed"` width
     * mode with *upright* text the vertical strip's thickness is instead pinned to
     * `fixedWidth`. Rotated text reads along the main axis, so fixed sizes its
     * height and the thickness stays content-derived.
     *
     * @returns The strip thickness in px.
     */
    stripThickness(): number {
        const base = this._compact ? STRIP_THICKNESS_COMPACT : STRIP_THICKNESS;

        if (!this.isVertical()) {
            let maxCross = base;

            for (const entry of this._entries) {
                maxCross = Math.max(maxCross, this.buttonCrossExtent(entry.button) + this.stripChrome());
            }

            return maxCross;
        }

        if (this._widthMode === "fixed" && !this.isRotatedText()) {
            return Math.max(base, this._fixedWidth);
        }

        let maxCross = base;

        for (const entry of this._entries) {
            maxCross = Math.max(maxCross, this.buttonCrossExtent(entry.button));
        }

        const toolSize = this._tools.length > 0 ? this._toolGroup.getPreferredSize() : null;

        if (toolSize) {
            maxCross = Math.max(maxCross, toolSize.width);
        }

        return maxCross;
    }

    /**
     * The vertical breathing (px) the north/south strip adds around a tab
     * button's content box. The north/south tab button carries *zero* top/bottom
     * inset (see `computeTabButtonInsets`: the strip supplies the cross-axis
     * room), so the band that keeps the label off the strip edges must come from
     * the strip itself. It mirrors the west/east model, where the same `pad * 2`
     * per cross-side lives inside the button's insets instead — so a north/south
     * strip and a west/east strip give a label the same clearance, and the chrome
     * scales with the base and shrinks in lockstep with `compact` exactly as the
     * insets do.
     *
     * @returns The combined top+bottom chrome in px (`pad * 2` per side).
     */
    private stripChrome(): number {
        const inset = ThemeManager.getResolvedScale().tabButtonInset;
        const pad = this._compact ? Math.round(inset / 2) : inset;

        return pad * 2 * 2;
    }

    /**
     * Resolves a tab's fixed target extent on the strip's main axis for the active
     * width mode, or `0` when the mode imposes none (`"fill"`, or before the
     * buttons have reported a preferred size). `"equal"` and `"fixed"` return one
     * uniform value across all tabs; `"content"` returns the per-tab natural extent
     * capped at `maxWidth`.
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

                for (const entry of this._entries) {
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
     * Applies the active width mode to the clip frame box and every tab wrapper,
     * generalised to the strip's main axis (width for north/south, height for
     * west/east). Called from `layoutChrome` before the box lays out.
     *
     * @remarks When `scrollable` is set the `"equal"`→`"fill"` collapse is skipped:
     * the box is switched to `"preferred"` and marked overflowing on the main axis
     * so buttons keep their preferred extent and the strip scrolls instead of
     * compressing.
     *
     * @param available - The strip's inner main-axis extent (px) the tabs must fit
     *   within (already net of the tool-group reservation).
     */
    private applyTabWidths(available: number): void {
        const box = this._tabClip.getLayoutManager() as BoxLayout;
        const overflow = this._scrollable;

        // Scroll-on-overflow: keep tabs at their width-mode extent and let the
        // strip's own overflow carry the surplus, rather than compressing to fit.
        if (overflow) {
            box.setMode("preferred");
            box.setOverflowing(!this.isVertical(), this.isVertical());

            for (const entry of this._entries) {
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

            for (const entry of this._entries) {
                this.clampWrapperMain(entry.wrapper, 0, Number.MAX_VALUE);
            }

            return;
        }

        box.setMode("preferred");

        if (this._widthMode === "content") {
            const cap = this._maxWidth ?? Number.MAX_VALUE;

            for (const entry of this._entries) {
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
        const extent = this._entries.length > 0 ? this.tabModeExtent(this._entries[0].button) : 0;

        // Pre-measurement guard: fall back to natural extents until the tab
        // buttons have reported a real preferred size.
        if (extent <= 0) {
            for (const entry of this._entries) {
                this.clampWrapperMain(entry.wrapper, 0, Number.MAX_VALUE);
            }

            return;
        }

        // "equal" shrinks to fit: when the uniform extent can't fit the strip,
        // collapse to fill so the tabs share the available space instead of
        // overflowing. "fixed" stays rigid (overflow is the consumer's intent).
        if (this._widthMode === "equal" && this._entries.length > 0 && extent * this._entries.length > available) {
            box.setMode("equal");

            for (const entry of this._entries) {
                this.clampWrapperMain(entry.wrapper, 0, Number.MAX_VALUE);
            }

            return;
        }

        for (const entry of this._entries) {
            this.clampWrapperMain(entry.wrapper, extent, extent);
        }
    }

    /**
     * Reports whether the strip is on a vertical side (west/east), where the clip
     * frame stacks tabs in a `VBox` and the main axis is Y.
     *
     * @returns `true` for west/east, `false` for north/south.
     */
    private isVertical(): boolean {
        return this._side === "west" || this._side === "east";
    }

    /**
     * Swaps the clip frame's inner box (and the tool group's) between `HBox` and
     * `VBox` to match the current side, only when the orientation actually
     * differs. North/south stack tabs in an `HBox`; west/east in a `VBox`.
     */
    private syncToolbarOrientation(): void {
        const wantVertical = this.isVertical();

        if ((this._tabClip.getLayoutManager() instanceof VBox) !== wantVertical) {
            this._tabClip.setLayoutManager(wantVertical
                ? new VBox({ spacing: 0, stretching: true })
                : new HBox({ spacing: 0, stretching: true }));
        }

        if ((this._toolGroup.getLayoutManager() instanceof VBox) !== wantVertical) {
            this._toolGroup.setLayoutManager(wantVertical
                ? new VBox({ spacing: 0, stretching: true })
                : new HBox({ spacing: 0, stretching: true }));
        }

        if ((this._leadGroup.getLayoutManager() instanceof VBox) !== wantVertical) {
            this._leadGroup.setLayoutManager(wantVertical
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
     * Reads the leading group's reserved main-axis extent — its preferred
     * main-axis size plus the {@link LEAD_GLYPH_GAP} before the first tab. The
     * group's preferred size reflects the hosted widget stretched and glyph-synced
     * like a trailing tool, so the slot is a true main-axis peer of the tool group.
     *
     * @returns The reserved lead extent in px, or 0 when no leading widget is set.
     */
    private leadWidgetMainExtent(): number {
        if (!this._leadWidget) {
            return 0;
        }

        const pref = this._leadGroup.getPreferredSize();

        if (!pref) {
            return 0;
        }

        return (this.isVertical() ? pref.height : pref.width) + LEAD_GLYPH_GAP;
    }

    /**
     * Predicts the strip's combined main-axis tab extent before layout, used to
     * decide whether the "arrows" overflow chrome (and its gutter reservation) is
     * needed.
     *
     * @returns The predicted combined main-axis extent of all tabs in px.
     */
    private predictTabsExtent(): number {
        let total = 0;

        for (const entry of this._entries) {
            total += this.predictedTabExtent(entry.button);
        }

        return total;
    }

    /**
     * Predicts one tab's main-axis extent before layout — its width-mode extent
     * when the mode imposes one, else its own preferred extent.
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
     * band between the fixed chrome (tool group + scroll-arrow gutters). The
     * frame's overflow:hidden then clips any tab (and its ✕ overlay) that scrolls
     * past the region edge. The leading inset is the `"end"`-align gap, which
     * trailing-aligns the tabs and survives an independent clip-frame relayout.
     *
     * @param toolExtent - The tool group's main-axis extent in px.
     * @param leadExtent - The leading glyph's reserved main-axis extent in px (0 when no leading glyph).
     * @param arrowReserve - The per-end scroll-arrow gutter in px (0 when no arrows).
     * @param endGap - The leading gap that trailing-aligns `"end"` tabs (0 otherwise).
     * @param thickness - The strip's cross-axis thickness in px.
     * @param mainInner - The strip's main-axis inner extent in px.
     * @param crossLead - The bar's leading cross-axis inset (0 unless the bar absorbed a parent inset).
     * @param mainLead - The bar's leading main-axis inset (0 unless the bar absorbed a parent inset).
     */
    private positionClipFrame(toolExtent: number, leadExtent: number, arrowReserve: number, endGap: number, thickness: number, mainInner: number, crossLead: number, mainLead: number): void {
        const toolsLead = this._align === "end";
        const leadChrome = leadExtent + (toolsLead ? toolExtent : 0) + arrowReserve;
        const trailChrome = (toolsLead ? 0 : toolExtent) + arrowReserve;
        const mainSize = mainInner - leadChrome - trailChrome;
        const leadInset = endGap;

        if (this.isVertical()) {
            this._tabClip.setX(crossLead);
            this._tabClip.setY(leadChrome + mainLead);
            this._tabClip.setWidth(thickness);
            this._tabClip.setHeight(mainSize);
            this._tabClip.setInsets(new Insets(leadInset, 0, 0, 0));
        } else {
            this._tabClip.setX(leadChrome + mainLead);
            this._tabClip.setY(crossLead);
            this._tabClip.setWidth(mainSize);
            this._tabClip.setHeight(thickness);
            this._tabClip.setInsets(new Insets(0, 0, 0, leadInset));
        }
    }

    /**
     * Re-derives every tab button's insets from `_compact` and applies the
     * `writing-mode` for the current orientation (cleared on horizontal sides),
     * and tightens the tool buttons' insets — and the leading widget's, a
     * tool-peer at the opposite end — to match, so `setCompact` /
     * `setOrientation` take effect on the next pass without the setters touching
     * the DOM. Run before the width pass so the insets feed the buttons' measured
     * extents.
     */
    private applyTabButtonStyles(): void {
        // `sideways-rl`/`sideways-lr` rotate the whole run a quarter turn in
        // opposite directions — clockwise (reads top-to-bottom) and
        // counter-clockwise (reads bottom-to-top).
        const writingMode = this._orientation === "vertical-cw" ? "sideways-rl"
            : this._orientation === "vertical-ccw" ? "sideways-lr"
            : null;

        for (const entry of this._entries) {
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

        // The leading widget is a tool-peer at the opposite end, so it shares the
        // tool inset policy (cross-axis zeroed, main-axis pad) — without it the
        // widget keeps its own constructed insets and lays out a few px off the
        // trailing controls' box, breaking the symmetric edge inset.
        if (this._leadWidget) {
            this._leadWidget.setInsets(toolInsets);
        }
    }

    /**
     * Computes the leading gap (px) that pushes `"end"`-aligned tabs to the
     * trailing edge of their region. Folded into the clip frame's leading inset
     * (see {@link positionClipFrame}) so the inner box lays the tabs out at the
     * trailing edge natively. Zero for `"start"` alignment, `"fill"` width mode,
     * and whenever the tabs fill or overflow the region.
     *
     * @param available - The strip's inner main-axis extent net of tool and arrow
     *   reservations (px) — the region the tabs occupy.
     *
     * @returns The leading gap in px, clamped to `0`.
     */
    private endAlignGap(available: number): number {
        if (this._align !== "end" || this._widthMode === "fill" || this._entries.length === 0) {
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
     * @param crossLead - The bar's leading cross-axis inset (0 unless the bar absorbed a parent inset).
     * @param mainLead - The bar's leading main-axis inset (0 unless the bar absorbed a parent inset).
     */
    private positionToolGroup(mainInner: number, toolExtent: number, thickness: number, crossLead: number, mainLead: number): void {
        if (this._tools.length === 0 || toolExtent <= 0) {
            this._toolGroup.setVisible(false);

            return;
        }

        this._toolGroup.setVisible(true);

        const mainPos = (this._align === "end" ? 0 : mainInner - toolExtent) + mainLead;

        if (this.isVertical()) {
            this._toolGroup.setX(crossLead);
            this._toolGroup.setY(mainPos);
            this._toolGroup.setWidth(thickness);
            this._toolGroup.setHeight(toolExtent);
        } else {
            this._toolGroup.setX(mainPos);
            this._toolGroup.setY(crossLead);
            this._toolGroup.setWidth(toolExtent);
            this._toolGroup.setHeight(thickness);
        }

        this._toolGroup.doLayout();
    }

    /**
     * Places the leading group in its reserved slot at the strip's start (main
     * origin `mainLead`), sized to the strip thickness on the cross axis so it
     * mirrors the tool group at the opposite end, then lays out the hosted widget.
     * The group's stretching box stretches the widget across the thickness (so its
     * glyph syncs to the strip line-height like a trailing tool) and the widget
     * centres within that box, so its ink v-centres in the thickness and h-centres
     * in a box the same size as a control's — a true peer. Hides the group when no
     * leading widget is set.
     *
     * @param thickness - The strip's cross-axis thickness in px.
     * @param crossLead - The bar's leading cross-axis inset (0 unless the bar absorbed a parent inset).
     * @param mainLead - The bar's leading main-axis inset (0 unless the bar absorbed a parent inset).
     */
    private positionLeadGroup(thickness: number, crossLead: number, mainLead: number): void {
        // The group's preferred main size — its own box extent, excluding the
        // trailing LEAD_GLYPH_GAP that leadWidgetMainExtent folds in for the tabs.
        const pref = this._leadWidget ? this._leadGroup.getPreferredSize() : null;
        const mainExtent = pref ? (this.isVertical() ? pref.height : pref.width) : 0;

        if (mainExtent <= 0) {
            this._leadGroup.setVisible(false);

            return;
        }

        this._leadGroup.setVisible(true);

        if (this.isVertical()) {
            this._leadGroup.setX(crossLead);
            this._leadGroup.setY(mainLead);
            this._leadGroup.setWidth(thickness);
            this._leadGroup.setHeight(mainExtent);
        } else {
            this._leadGroup.setX(mainLead);
            this._leadGroup.setY(crossLead);
            this._leadGroup.setWidth(mainExtent);
            this._leadGroup.setHeight(thickness);
        }

        this._leadGroup.doLayout();
    }

    /**
     * Slides the selection indicator over the active tab cell along the strip's
     * main axis, pinned to the strip's inner edge per side.
     */
    private positionIndicator(): void {
        const wrapper = this.activeEntry()?.wrapper;

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
     * Pins each closeable tab's overlaid ✕ to the end of its label's reading flow:
     * the right edge (vertically centred) for upright text — north/south and
     * west/east horizontal orientation — and, for rotated text (horizontally
     * centred), the bottom edge for clockwise or the top edge for counter-clockwise.
     */
    private positionCloseButtons(): void {
        const rotated = this.isRotatedText();

        // Read the resolved close-button box and ✕ ink, then size and re-pin every
        // button — re-pinning here is what lets an existing ✕ follow a base-size
        // change, since the entry-creation pin only sets the initial size. Both
        // setters no-op when the value is unchanged, so a same-scale pass costs
        // nothing.
        const scale = ThemeManager.getResolvedScale();
        const closeSize = scale.tabClose;
        const glyphSize = scale.tabCloseGlyph;

        for (const entry of this._entries) {
            const closeButton = entry.closeButton;

            if (!closeButton || entry.wrapper.getWidth() <= 0) {
                continue;
            }

            closeButton.setWidth(closeSize);
            closeButton.setHeight(closeSize);
            closeButton.pinGlyphSize(glyphSize);

            if (rotated) {
                // Centre the ✕ across the strip thickness and pin it to the end
                // of the reading flow: the bottom for clockwise (top-to-bottom)
                // text, the top for counter-clockwise (bottom-to-top).
                closeButton.setX(Math.round((entry.wrapper.getWidth() - closeSize) / 2));
                closeButton.setY(this._orientation === "vertical-ccw"
                    ? 2
                    : entry.wrapper.getHeight() - closeSize - 2);
            } else {
                closeButton.setX(entry.wrapper.getWidth() - closeSize - 2);
                closeButton.setY(Math.round((entry.wrapper.getHeight() - closeSize) / 2));
            }
        }
    }

    /**
     * Applies the overflow chrome to the strip: the strip always clips, and a
     * scrollable strip additionally shows the leading/trailing scroll buttons
     * while overflowing.
     *
     * @param mainInner - The strip's main-axis inner extent in px.
     * @param toolExtent - The reserved tool-group main extent in px.
     * @param leadExtent - The leading glyph's reserved main-axis extent in px (0 when no leading glyph).
     * @param thickness - The strip's cross-axis thickness in px.
     * @param arrowReserve - The per-end scroll-arrow gutter in px (0 when not overflowing).
     * @param crossLead - The bar's leading cross-axis inset (0 unless the bar absorbed a parent inset).
     * @param mainLead - The bar's leading main-axis inset (0 unless the bar absorbed a parent inset).
     */
    private layoutOverflowChrome(mainInner: number, toolExtent: number, leadExtent: number, thickness: number, arrowReserve: number, crossLead: number, mainLead: number): void {
        this.setOverflow("hidden");

        if (this._scrollable && arrowReserve > 0) {
            this.layoutOverflowArrows(mainInner, toolExtent, leadExtent, thickness, arrowReserve, crossLead, mainLead);
        } else {
            this.hideOverflowArrows();
        }
    }

    /**
     * Lazily builds the two scroll-arrow buttons and raw-appends them to the strip
     * element next to the other overlays.
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

        lead.on("action", this.scrollLeadClicked);
        trail.on("action", this.scrollTrailClicked);

        const element = this.getElement(true);
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
     * @param leadExtent - The leading glyph's reserved main-axis extent in px (0 when no leading glyph).
     * @param thickness - The strip's cross-axis thickness in px.
     * @param arrowReserve - The per-end arrow gutter (the arrows' main-axis size) in px.
     * @param crossLead - The bar's leading cross-axis inset (0 unless the bar absorbed a parent inset).
     * @param mainLead - The bar's leading main-axis inset (0 unless the bar absorbed a parent inset).
     */
    private layoutOverflowArrows(mainInner: number, toolExtent: number, leadExtent: number, thickness: number, arrowReserve: number, crossLead: number, mainLead: number): void {
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
        const leadPos = leadExtent + (toolsLead ? toolExtent : 0) + mainLead;
        const trailPos = (toolsLead ? mainInner : mainInner - toolExtent) - arrowReserve + mainLead;

        for (const button of [lead, trail]) {
            if (vertical) {
                // Pin the main-axis (height) to the gutter; fill the thickness.
                button.setMinSize(0, arrowReserve);
                button.setMaxSize(Number.MAX_VALUE, arrowReserve);
                button.setX(crossLead);
                button.setWidth(thickness);
                button.setHeight(arrowReserve);
            } else {
                button.setMinSize(arrowReserve, 0);
                button.setMaxSize(arrowReserve, Number.MAX_VALUE);
                button.setY(crossLead);
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
            ? this._tabClip.getScrollTop()
            : this._tabClip.getScrollLeft();
    }

    /**
     * Returns the clip frame's maximum native scroll offset on the main axis,
     * derived live from the laid-out content frame.
     *
     * @returns The last-page scroll offset in px (0 when nothing overflows).
     */
    private clipScrollMax(): number {
        return this.isVertical()
            ? this._tabClip.getMaxScrollTop()
            : this._tabClip.getMaxScrollLeft();
    }

    /**
     * Writes the clip frame's native main-axis scroll offset. The browser clamps
     * to the scrollable range; the cross axis is left untouched.
     *
     * @param value - The desired main-axis scroll offset in px.
     */
    private setClipScroll(value: number): void {
        if (this.isVertical()) {
            this._tabClip.setScrollTop(value);
        } else {
            this._tabClip.setScrollLeft(value);
        }
    }

    /**
     * Re-derives the overflow arrows' enabled state from the live native scroll
     * position: the leading arrow is dead at the start, the trailing arrow at the
     * last page.
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
     * Pixels to scroll per overflow-arrow click ≈ one tab, so a click pages by a
     * tab at any font size. Derived from the first tab's predicted main-axis
     * extent (which collapses width-mode sizing and raw content width into the
     * laid-out width); falls back to the {@link SCROLL_ARROW_STEP} floor before
     * any tab has measured (`predictedTabExtent` returns 0, which `|| ` floors).
     *
     * @returns The per-click scroll step in px.
     */
    private scrollStepExtent(): number {
        return this._entries.length > 0
            ? this.predictedTabExtent(this._entries[0].button) || SCROLL_ARROW_STEP
            : SCROLL_ARROW_STEP;
    }

    /**
     * Handles a leading overflow-arrow click: scrolls one tab toward the start.
     * Resolves the step at click time so it tracks the current font.
     */
    private scrollLeadClicked = (): void => {
        this.scrollStrip(-this.scrollStepExtent());
    };

    /**
     * Handles a trailing overflow-arrow click: scrolls one tab toward the end.
     * Resolves the step at click time so it tracks the current font.
     */
    private scrollTrailClicked = (): void => {
        this.scrollStrip(this.scrollStepExtent());
    };

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
     * *laid-out* DOM rects. Runs after `clipFrame.doLayout`; one-shot, so it never
     * fights the user's own scrolling.
     */
    private revealSelectedIfRequested(): void {
        if (!this._scrollToSelected) {
            return;
        }

        this._scrollToSelected = false;

        if (!this._scrollable) {
            return;
        }

        const selected = this.activeEntry();
        const clipElement = this._tabClip.getElement();
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
     * Prepares the strip for the owner's measurement pass: swaps the clip-frame /
     * tool-group box orientation to the current side, re-derives the tab/tool
     * button styles (insets, writing-mode, text-align), and syncs each button's
     * ARIA `selected` state. Must be called **before** {@link stripThickness} and
     * {@link placeStrip} each pass, because the button styles feed the measured
     * extents that the thickness reads.
     *
     * @returns This tab strip, for method chaining.
     */
    prepareStrip(): this {
        this.syncToolbarOrientation();
        this.applyTabButtonStyles();

        for (const entry of this._entries) {
            entry.button.getAria().setSelected(entry.id === this._activeId);
        }

        return this;
    }

    /**
     * Positions the strip at the rectangle the owner computed and lays out its
     * internal chrome (clip frame, tool group, indicator, close overlays, scroll
     * arrows) within it. The owner derives the rectangle from
     * {@link stripThickness} (call {@link prepareStrip} first).
     *
     * @param x - The strip's left in container coordinates.
     * @param y - The strip's top in container coordinates.
     * @param width - The strip's width in px.
     * @param height - The strip's height in px.
     *
     * @returns This tab strip, for method chaining.
     */
    placeStrip(x: number, y: number, width: number, height: number): this {
        this.setX(x);
        this.setY(y);
        this.setWidth(width);
        this.setHeight(height);

        this.layoutChrome(width, height);

        return this;
    }

    /**
     * Lays out the strip's internal chrome within the given box: sizes the clip
     * frame to the tab region (between the tool group and any scroll-arrow
     * gutters), applies the width mode, runs the clip frame box, reveals the
     * selected tab, then positions the tool group, indicator, close overlays, and
     * overflow arrows.
     *
     * @param width - The strip's box width in px (== outer width).
     * @param height - The strip's box height in px.
     */
    private layoutChrome(width: number, height: number): void {
        // The bar may carry per-side insets (the parent inset it absorbed when
        // `barIgnoreParentInsets` grew it to the container's outer edge). Derive
        // the leading offsets from the bar's own content frame so the
        // hand-positioned chrome lands within it; with zero insets (the default)
        // every offset is 0 and this reduces to the original placement.
        const ci = this.getContentInsets();
        const vertical = this.isVertical();
        const crossLead = vertical ? ci.getLeft() : ci.getTop();
        const mainLead = vertical ? ci.getTop() : ci.getLeft();
        const mainTrail = vertical ? ci.getBottom() : ci.getRight();

        const toolExtent = this._tools.length > 0 ? this.toolGroupMainExtent() : 0;
        const thickness = this.stripThickness();
        // Always reserved at the leading (start) edge, independent of `_align`; 0
        // when no leading widget is set, so every `+ leadExtent` reduces to `+ 0`
        // and the default path is byte-for-byte unchanged.
        const leadExtent = this.leadWidgetMainExtent();
        const mainOuter = vertical ? height : width;
        const mainInner = mainOuter - mainLead - mainTrail;

        // Place the clip frame between the tool slot, the leading glyph slot, and —
        // when a scrollable strip is overflowing — a scroll-arrow gutter at each
        // end, so the tabs lay out (and scroll, clipped) strictly within it rather
        // than behind the chrome. An "end"-align leading gap is folded in as a
        // frame inset too, so the box trailing-aligns the tabs natively.
        const arrowReserve = this.computeArrowReserve(mainInner, toolExtent + leadExtent);
        const available = mainInner - toolExtent - leadExtent - 2 * arrowReserve;
        const endGap = this.endAlignGap(available);
        this.positionClipFrame(toolExtent, leadExtent, arrowReserve, endGap, thickness, mainInner, crossLead, mainLead);

        this.applyTabWidths(available);
        this._tabClip.doLayout();

        // `applyTabWidths` can lay the content out narrower than the current
        // scroll offset (e.g. switching to `compact` while scrolled to the end);
        // the browser then clamps the clip's native scroll on its own, behind the
        // cached scroll API's back, leaving `clipScroll()` stale. Resync the cache
        // from the DOM before the reveal reads it, or `revealSelectedIfRequested`
        // would add its live-rect delta to a stale base and under-scroll.
        this._tabClip.syncScrollOffsets();

        // Scroll-into-view moves the clip frame's native scroll against the
        // now-laid-out wrapper rects — a prediction before the box runs can't see
        // a same-pass width change. No relayout: native scroll shifts the content.
        this.revealSelectedIfRequested();

        this.positionToolGroup(mainInner, toolExtent, thickness, crossLead, mainLead);
        this.positionLeadGroup(thickness, crossLead, mainLead);
        this.positionIndicator();
        this.positionCloseButtons();
        this.layoutOverflowChrome(mainInner, toolExtent, leadExtent, thickness, arrowReserve, crossLead, mainLead);
    }

    /**
     * Installs the within-strip drag-reorder wiring: one strip-wide mousedown
     * capture (so a press on a ✕ can veto the drag), a drag source per tab
     * wrapper, and a single drop target. Idempotent — clears any prior wiring
     * first. Called from `init` (when `_reorderable`) and from
     * {@link setReorderable}.
     */
    private installTabDnD(): void {
        this.teardownTabDnD();

        // One subtree mousedown capture records the pressed element so
        // `onDragStart` can veto a drag that began on a close button
        // (DragEventDetail carries no DOM target), plus the Shift state so a
        // tear-off can force a bare window.
        const recordMouseTarget = (e: MouseEvent): void => {
            this._dragMouseTarget = e.target;
            this._dragShiftHeld = e.shiftKey;
        };

        Event.addSubtreeListener(this, "mousedown", recordMouseTarget);
        this._dndTeardowns.push(() => Event.removeSubtreeListener(this, "mousedown", recordMouseTarget));

        for (const entry of this._entries) {
            this._dndTeardowns.push(this.makeTabDragSource(entry));
        }

        this._dndTeardowns.push(this.makeTabDropTarget());
    }

    /**
     * Registers a drag source on one tab wrapper, vetoing the gesture when the
     * press began inside that tab's close button. On commit it emits
     * `"tabdragstart"` so the owner can register the live content in the shared
     * drag registry, then routes the release through {@link onTabDragEnd}.
     *
     * @param entry - The cell whose wrapper becomes a drag source.
     *
     * @returns The source teardown closure.
     */
    private makeTabDragSource(entry: BarEntry): () => void {
        return DragManager.makeDragSource(entry.wrapper, {
            dragData: (): DragData => {
                const data: TabDragData = {
                    tabDrag:     true,
                    sourceTabId: this.stripId(),
                    componentId: entry.contentId,
                    label:       entry.name,
                };

                // Spread to an anonymous object literal: a typed interface value
                // is not assignable to DragData's index signature, but a literal is.
                return { ...data };
            },
            onDragStart: (): boolean | void => {
                const target = this._dragMouseTarget;
                this._dragMouseTarget = null;

                const closeElement = entry.closeButton?.getElement();

                if (closeElement && target instanceof Node && closeElement.contains(target)) {
                    return false;
                }

                // The owner registers its live content (if ready) in the shared
                // registry so a foreign strip's drop can resolve it from the
                // id-only drag data.
                this.emit("tabdragstart", entry.id);
            },
            onDragEnd: (detail: DragEventDetail, dropped: boolean): void => this.onTabDragEnd(entry, detail, dropped),
        });
    }

    /**
     * Registers the single drop target on the clip frame that drives the insertion
     * bar and commits the reorder. `onDragOver` returns `null` to suppress the drag
     * manager's own horizontal reorder indicator in favour of the main-axis
     * {@link TabReorderBar}.
     *
     * Feedback follows the framework's drag-and-drop colour convention: blue marks
     * where the drop lands, the green/red wash marks whole-target validity. So
     * `suppressValidityTint` turns off the manager's whole-strip green wash, and
     * the strip paints the two blue cues a dock region uses instead — a faint
     * {@link TabDropTint} "droppable here" wash over the whole strip plus the
     * brighter {@link TabReorderBar} marking the precise insertion slot.
     *
     * @returns The target teardown closure.
     */
    private makeTabDropTarget(): () => void {
        return DragManager.makeDropTarget(this._tabClip, {
            suppressValidityTint: true,
            accepts: (detail: DragEventDetail): boolean => this.isTabHeaderDrag(detail),
            onDragOver: (detail: DragEventDetail): number | null => {
                this._dropTint.showOver(this._tabClip);
                this.updateReorderSlot(detail);

                return null;
            },
            onDragLeave: (): void => {
                this.hideDropAffordance();
            },
            onDrop: (detail: DragEventDetail): void => {
                this.dropTabHeader(detail);
            },
        });
    }

    /**
     * Clears both drag-over cues — the faint {@link TabDropTint} wash and the
     * {@link TabReorderBar} insertion rule — when a drag leaves the strip or a
     * drop completes. The two are shown together in `onDragOver`, so they are
     * hidden together.
     */
    private hideDropAffordance(): void {
        this._reorderBar.hide();
        this._dropTint.hide();
    }

    /**
     * Tests whether a drag is a tab-header drag — either a within-strip reorder or
     * a dock from another strip.
     *
     * @param detail - The drag event detail.
     *
     * @returns `true` when the drag carries the tab-header marker.
     */
    private isTabHeaderDrag(detail: DragEventDetail): boolean {
        return detail.dragData["tabDrag"] === true;
    }

    /**
     * Routes a tab-header drop: a drag from this strip reorders within it; a drag
     * from another strip emits `"dockrequested"` so the owner docks the live
     * content here as a new tab at the slot {@link updateReorderSlot} computed.
     *
     * @param detail - The drag event detail (carries the source strip id and the dragged component id).
     */
    private dropTabHeader(detail: DragEventDetail): void {
        if (detail.dragData["sourceTabId"] === this.stripId()) {
            this.dropReorder(detail);

            return;
        }

        this.emit("dockrequested", detail.dragData["componentId"] as string, this._dragInsertIndex);

        this.hideDropAffordance();
        this._dragInsertIndex = -1;
    }

    /**
     * The strip's stable identity, stamped into {@link TabDragData.sourceTabId} and
     * compared by {@link dropTabHeader} to tell a within-strip reorder from a dock
     * from elsewhere. Uses the strip's own id — one per strip, stable for its
     * lifetime.
     *
     * @returns The strip component's id.
     */
    private stripId(): string {
        return this.getId();
    }

    /**
     * Source-side end of a header gesture. A release over empty space emits
     * `"tearoffrequested"`; a release a target consumed (`dropped`) emits
     * `"detached"`. The owner applies the content guards (whether the cell is
     * ready, whether its content actually left this container) and acts.
     *
     * @param entry - The dragged cell.
     * @param detail - The drag event detail (carries the release point).
     * @param dropped - `true` when the release landed on a registered drop target;
     *   `false` only on a release over empty space, which tears the tab off.
     */
    private onTabDragEnd(entry: BarEntry, detail: DragEventDetail, dropped: boolean): void {
        if (!dropped) {
            this.emit("tearoffrequested", entry.id, detail.clientX, detail.clientY, this._dragShiftHeld);

            return;
        }

        this.emit("detached", entry.id);
    }

    /**
     * Computes the insertion slot from the cursor's main-axis position, caches it
     * in `_dragInsertIndex`, and places the insertion bar at the slot boundary.
     *
     * @param detail - The drag event detail (carries the viewport cursor).
     */
    private updateReorderSlot(detail: DragEventDetail): void {
        const element = this._tabClip.getElement();

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

        let insertIndex = this._entries.length;

        for (let i = 0; i < this._entries.length; i++) {
            const wrapper = this._entries[i].wrapper;
            const start = vertical ? wrapper.getY() : wrapper.getX();
            const extent = vertical ? wrapper.getHeight() : wrapper.getWidth();

            if (cursorMain < start + extent / 2) {
                insertIndex = i;

                break;
            }
        }

        this._dragInsertIndex = insertIndex;

        const boundary = this.slotBoundary(insertIndex, vertical);
        const thickness = vertical ? this._tabClip.getWidth() : this._tabClip.getHeight();

        this._reorderBar.placeAt(boundary, thickness, vertical);
    }

    /**
     * Resolves the main-axis coordinate of a slot boundary: the leading edge of
     * the wrapper at `insertIndex`, or the trailing edge of the last wrapper for an
     * append.
     *
     * @param insertIndex - The slot index in `[0, entries.length]`.
     * @param vertical - Whether the strip's main axis is Y.
     *
     * @returns The boundary's main-axis coordinate in px.
     */
    private slotBoundary(insertIndex: number, vertical: boolean): number {
        if (insertIndex < this._entries.length) {
            const wrapper = this._entries[insertIndex].wrapper;

            return vertical ? wrapper.getY() : wrapper.getX();
        }

        if (this._entries.length > 0) {
            const wrapper = this._entries[this._entries.length - 1].wrapper;

            return vertical ? wrapper.getY() + wrapper.getHeight() : wrapper.getX() + wrapper.getWidth();
        }

        return 0;
    }

    /**
     * Commits a header reorder drop: hides the bar, maps the drag source back to
     * its cell, and moves it to the cached insertion slot.
     *
     * @param detail - The drag event detail (carries the source id).
     */
    private dropReorder(detail: DragEventDetail): void {
        this.hideDropAffordance();

        const fromIdx = this._entries.findIndex(entry => entry.wrapper.getId() === detail.sourceId);

        if (fromIdx < 0 || this._dragInsertIndex < 0) {
            return;
        }

        this.reorderTab(fromIdx, this._dragInsertIndex);
        this._dragInsertIndex = -1;
    }

    /**
     * Moves a cell from `fromIdx` to the insertion slot `toIdx`, reorders the
     * wrapper among the clip frame's children, and emits `"reordered"` so the
     * owner re-derives its content order. The active cell (tracked by id) stays
     * active across the move.
     *
     * @param fromIdx - The dragged cell's current index.
     * @param toIdx - The insertion slot in `[0, entries.length]`.
     */
    private reorderTab(fromIdx: number, toIdx: number): void {
        if (fromIdx < 0 || fromIdx >= this._entries.length) {
            return;
        }

        // An insertion slot past the source collapses by one once the source is
        // spliced out; clamp into the post-removal index range.
        let dest = toIdx > fromIdx ? toIdx - 1 : toIdx;
        dest = Math.max(0, Math.min(dest, this._entries.length - 1));

        if (dest === fromIdx) {
            return;
        }

        const fromId = this._entries[fromIdx].id;
        const entry = this._entries[fromIdx];

        this._entries.splice(fromIdx, 1);
        this._entries.splice(dest, 0, entry);

        this._tabClip.moveComponent(entry.wrapper, dest);

        this.emit("reordered", fromId, dest);
    }

    /**
     * Tears down all drag sources, the drop target, and the mousedown capture, and
     * hides the insertion bar. Called from {@link dispose} and {@link setReorderable}.
     */
    private teardownTabDnD(): void {
        for (const teardown of this._dndTeardowns) {
            teardown();
        }

        this._dndTeardowns = [];
        this.hideDropAffordance();
    }

    /**
     * Handles ArrowLeft / ArrowRight to move tab focus and activate the adjacent tab.
     *
     * @param e - The keyboard event fired on the strip element.
     */
    private onToolbarKeyDown(e: KeyboardEvent): void {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
            return;
        }

        const tabCount = this._entries.length;

        if (tabCount === 0) {
            return;
        }

        e.preventDefault();

        const activeIdx = this._entries.findIndex(entry => entry.id === this._activeId);
        const base = activeIdx >= 0 ? activeIdx : 0;

        const newIdx = e.key === 'ArrowRight'
            ? (base + 1) % tabCount
            : (base - 1 + tabCount) % tabCount;

        const newTab = this._entries[newIdx].button;

        this._entries.forEach(entry => entry.button.setSelected(false));
        newTab.setSelected(true);

        this.onTabPressed(newTab);
    }

    /**
     * Registers a listener for a {@link TabBarEvent}.
     *
     * @param event - The event to listen for.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tab strip, for method chaining.
     */
    on(event: "tabpressed",       listener: (id: string) => void): this;
    on(event: "reordered",        listener: (fromId: string, toIndex: number) => void): this;
    on(event: "tabclose",         listener: (id: string) => void): this;
    on(event: "dockrequested",    listener: (componentId: string, slot: number) => void): this;
    on(event: "tabdragstart",     listener: (id: string) => void): this;
    on(event: "tearoffrequested", listener: (id: string, clientX: number, clientY: number, forceBare: boolean) => void): this;
    on(event: "detached",         listener: (id: string) => void): this;
    on(event: TabBarEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference must
     * match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This tab strip, for method chaining.
     */
    off(event: TabBarEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in registration
     * order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "tabpressed",       id: string): void;
    protected emit(event: "reordered",        fromId: string, toIndex: number): void;
    protected emit(event: "tabclose",         id: string): void;
    protected emit(event: "dockrequested",    componentId: string, slot: number): void;
    protected emit(event: "tabdragstart",     id: string): void;
    protected emit(event: "tearoffrequested", id: string, clientX: number, clientY: number, forceBare: boolean): void;
    protected emit(event: "detached",         id: string): void;
    protected emit(event: TabBarEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }
}

const TabBarCallable = callable(TabBar);
type TabBarCallable = TabBar;
export {
    TabBar         as _TabBar,
    TabBarCallable as TabBar
};
