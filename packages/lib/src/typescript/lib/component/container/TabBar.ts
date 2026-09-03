// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Panel } from "~/core/Panel.js";
import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { TabButton } from "~/component/button/TabButton.js";
import { TabCloseButton } from "~/component/button/TabCloseButton.js";
import { Button } from "~/component/button/Button.js";
import { ScrollStrip } from "~/component/container/ScrollStrip.js";
import { Event } from "~/core/Event.js";
import { ThemeManager } from "~/core/Theme.js";
import { Insets } from "~/primitive/Insets.js";
import { ButtonGroup } from "~/overlay/ButtonGroup.js";
import { RovingTabIndex } from "~/core/RovingTabIndex.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { BoxLayout } from "~/layout/BoxLayout.js";
import { Menu } from "~/overlay/Menu.js";
import { Tooltip } from "~/overlay/Tooltip.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { computeBulkCloseIds } from "~/component/container/tabCloseTargets.js";
import type { BulkCloseScope } from "~/component/container/tabCloseTargets.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { DragManager, DragEventDetail, DragData, TabDragData, SPRING_RAISE_DELAY_MS } from "~/overlay/DragManager.js";
import { callable } from "~/core/Callable.js";
import type { TabWidthMode, TabSide, TabOrientation } from "~/layout/Tab.js";
import type { AxisPosition, AxisEnd } from "~/primitive/Axis.js";

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
 * the pre-measurement floor. Kept at the legacy `setPreferredSize({ width: 0, height: 30 })` seed
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
 * - `"reorder"(fromId, toIndex)` — an in-strip reorder committed; the owner
 *   re-derives its content order from {@link TabBar.getEntryIds}.
 * - `"tabclose"(id)` — a cell's ✕ was clicked; the owner removes the content.
 * - `"dockrequested"(componentId, slot)` — a foreign tab was dropped here; the
 *   owner resolves and docks the live content keyed by `componentId`.
 * - `"tabdragstart"(id)` — a cell's drag committed; the owner registers its live
 *   content so a foreign strip's drop can resolve it.
 * - `"tearoffrequested"(id, clientX, clientY, forceBare)` — a cell was released
 *   over empty space; the owner tears it off (only if its content is ready).
 * - `"detach"(id)` — a cell's drag was released onto a target; the owner drops
 *   the cell only if the content left its container (a within-strip reorder is a
 *   no-op for the owner).
 * - `"dockhover"()` — a foreign tab has dwelt over this strip long enough to
 *   spring-load a raise; the owner surfaces the strip's window so a backgrounded
 *   float can be aimed at.
 * - `"tabdblclick"(id)` — a cell's tab button was double-clicked; the owner
 *   re-emits it with the live content.
 *
 * @category Components
 */
export type TabBarEvent =
    "tabpressed" | "reorder" | "tabclose" | "dockrequested" | "tabdragstart" | "tearoffrequested" | "detach"
    | "dockhover" | "tabdblclick";

/**
 * Declares a strip tool that also surfaces in the tab context menu's `Tools`
 * submenu. Passed to {@link TabBar.addTool} (or the owning `Tab`'s `addTool`),
 * which builds both the strip {@link Button} and the menu row from this single
 * descriptor — so glyph, label, and action are declared exactly once.
 *
 * @category Components
 */
export interface TabToolDescriptor {
    /** Tooltip on the strip button and label on the menu row (required). */
    label: string;

    /** Optional registry glyph name for the button and menu row (matches {@link MenuItemConfig.glyph}). */
    glyph?: string;

    /** Invoked by both the strip button's action and the menu row — the same reference. */
    action: () => void;
}

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
        reorder?:          (fromId: string, toIndex: number) => void;
        tabclose?:         (id: string) => void;
        dockrequested?:    (componentId: string, slot: number) => void;
        tabdragstart?:     (id: string) => void;
        tearoffrequested?: (id: string, clientX: number, clientY: number, forceBare: boolean) => void;
        detach?:           (id: string) => void;
        dockhover?:        () => void;
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
    align?: AxisEnd;

    /** Text orientation on the vertical sides; defaults to `"horizontal"`. */
    orientation?: TabOrientation;

    /**
     * Whether an overflowing strip scrolls (leading/trailing arrow buttons, tabs
     * kept at preferred size) instead of compressing the tabs to fit. Defaults to
     * `false`.
     */
    scrollable?: boolean;

    /**
     * Tools pinned at the far end of the strip, opposite the tabs. A plain
     * {@link Component} is a bare strip tool; a {@link TabToolDescriptor} also
     * surfaces in the context menu's `Tools` submenu.
     */
    tools?: (Component | TabToolDescriptor)[];

    /** Reduce tab-button insets for a denser strip. Defaults to `false`. */
    compact?: boolean;

    /** Enable within-strip header drag-reorder. Defaults to `false`. */
    reorderable?: boolean;

    /** Tab-label justification (strip-wide); defaults to `"center"`. */
    textAlign?: AxisPosition;
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
    button: TabButton;
    closeButton?: TabCloseButton;
    /** The cell's display label — the same `name` the button was built with. */
    name: string;
    constraints?: LayoutConstraints;
    /**
     * The button's `contextmenu` subtree listener. Retained on the entry so it
     * can be registered via {@link Event.addSubtreeListener} at construction —
     * removal needs no reference of its own, since {@link TabBar.removeBarEntry}
     * disposes the button and disposal purges every registration it holds.
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
    applyStyle(element: Handle): this {
        super.applyStyle(element);
        this.applyBarGeometry();

        return this;
    }

    /**
     * Writes the inner-edge placement, token thickness, and main-axis extent —
     * the token-driven box styles the base `applyStyle` doesn't replay — and
     * slides the bar along the main axis through {@link Component.setTranslate}.
     * The translate goes through the framework-tracked transform channel (so
     * `getTranslateX` / `getTranslateY` report the slide and the base
     * `applyStyle` replays it), while the box edges are re-applied here on every
     * re-render. North/south draw a horizontal bar on the bottom/top edge sized
     * by `width` and slid with `translateX`; west/east draw a vertical bar on
     * the right/left edge sized by `height` and slid with `translateY`.
     *
     * @returns This indicator, for chaining.
     */
    private applyBarGeometry(): this {
        const thickness = "var(--ts-ui-tab-indicator-thickness, 2px)";
        const vertical = this._side === "west" || this._side === "east";

        if (vertical) {
            this.setTranslate(0, this._mainPos);

            return this.setElementStyles({
                top      : "0",
                bottom   : "auto",
                left     : this._side === "east" ? "0" : "auto",
                right    : this._side === "west" ? "0" : "auto",
                width    : thickness,
                height   : this._mainExtent + "px",
            });
        }

        this.setTranslate(this._mainPos, 0);

        return this.setElementStyles({
            left     : "0",
            right    : "auto",
            top      : this._side === "south" ? "0" : "auto",
            bottom   : this._side === "north" ? "0" : "auto",
            width    : this._mainExtent + "px",
            height   : thickness,
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
 * [`DropZoneOverlay`](/api/overlay/classes/DropZoneOverlay) root tint a
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

const _defaultTabBarOptions: Partial<TabBarOptions> = {
    backgroundColor: "var(--ts-ui-tab-toolbar-bg, #eee)",
    // Seeds the bar's own preferred size with the floor; the owning `Tab`
    // sizes the strip from `stripThickness()` directly (never from this
    // self-report), so this is only the bar's pre-layout self-size, kept at
    // the floor so it matches the unmeasured strip.
    preferredSize: { width: 0, height: STRIP_THICKNESS },
};

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

    // Clips the tab region and owns its overflow chrome. A ScrollStrip whose own
    // element is the clip frame: it holds the tab wrappers (its box children) plus
    // the raw-appended selection indicator and reorder bar, and owns the paging
    // arrows in the gutters it reserves on overflow. Positioned to span the whole
    // tab band; overflow:hidden clips a scrolled tab — and its overlaid ✕ — at the
    // region edge instead of bleeding over the tool buttons.
    private _tabClip: ScrollStrip = new ScrollStrip({ scrollable: false });
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
    private _listeners: ListenerBag<TabBarEvent> = this.registerListenerBag(new ListenerBag<TabBarEvent>());

    private _widthMode: TabWidthMode = "equal";
    private _maxWidth: number | null = null;
    private _fixedWidth: number = 120;
    private _underBorderFullWidth: boolean = true;
    private _underBorderFromTheme: boolean = true;
    private _indicator: TabIndicator = new TabIndicator();

    private _side: TabSide = "north";
    private _align: AxisEnd = "start";
    private _orientation: TabOrientation = "horizontal";
    private _scrollable: boolean = false;
    private _compact: boolean = false;
    private _textAlign: AxisPosition = "center";

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
    // Maps each descriptor-built tool button to its descriptor, so `openTabMenu`
    // can list only the tools that opted into a menu row (plain-Component tools
    // are absent) and `removeTool` can drop the row when its tool is removed.
    // `_tools` stays the ordering source of truth; this is keyed lookup only.
    private _toolMenuItems: Map<Component, TabToolDescriptor> = new Map();
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

    // Pending spring-loaded host-window raise while a foreign tab dwells over the
    // strip; armed once per dwell in onDragOver and cleared the moment the cursor
    // leaves or drops. Fires "dockhover" so the owner raises the strip's window.
    private _springRaiseTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Creates a tab strip with an empty toolbar.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: TabBarOptions, subclassDefaults?: Partial<TabBarOptions>) {
        super(options, { ..._defaultTabBarOptions, ...(subclassDefaults ?? {}) });

        // This bar's element is the strip toolbar (was Tab._toolbar). Configure
        // it, then build the raw-appended chrome overlays. The base options were
        // already dispatched by the Container/Component super cascade; the bar-only
        // options are dispatched at the end of this body once the sub-components
        // exist (so a `tools` / `listeners` option has somewhere to land).
        this.setLayoutManager(new HBox({ mode: "equal", spacing: 0, stretching: true }));
        this._underBorderFullWidth = ThemeManager.getTheme().tab.underBorderFullWidth;
        this.applyUnderBorder(options);
        this.getAria().setRole("tablist");

        // The tab wrappers live in the clip frame (its box lays them out), not on
        // the strip directly. The ScrollStrip already configures its own
        // transparent, overflow:hidden clip and box; here the strip themes the
        // paging arrows to the toolbar surface and supplies the per-click step as
        // one tab's live extent (so a click pages by a tab at any font size).
        // Hand-positioned in `layoutChrome`, so it is raw-appended (not a box child).
        this._tabClip.setArrowBackground("var(--ts-ui-tab-toolbar-bg, #eee)");
        this._tabClip.setStepProvider(() => this.scrollStepExtent());

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
        // explicitly. Released by the base class's dispose(). The owner
        // re-lays-out the strip on theme change (it owns the band geometry);
        // this only tracks the border.
        this.subscribeTheme(() => {
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
            // Dispatch each element with an explicit `instanceof Component` branch:
            // TypeScript overload resolution rejects a `Component | TabToolDescriptor`
            // union passed against the two separate non-union `addTool` signatures,
            // so each arm passes a narrowed type that matches one overload.
            for (const tool of options.tools) {
                if (tool instanceof Component) {
                    this.addTool(tool);
                } else {
                    this.addTool(tool);
                }
            }
        }

        this.applyListeners(options?.listeners);
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
        this._tabClip.setArrowBackground(color);

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
    protected init(element?: Handle): this {
        super.init(element);

        const host = element ?? this.getElement(true)!;

        // The clip frame (which holds the tab wrappers) and the tool group are
        // raw-appended overlays — positioned manually in `layoutChrome` rather
        // than enrolled in a box. The selection indicator and reorder bar go
        // *inside* the clip frame so they share the wrappers' coordinate space
        // (and clip / scroll with them) rather than the strip's.
        DOM.sink.appendChild(host, this._tabClip.getElement(true)!);
        DOM.sink.appendChild(host, this._toolGroup.getElement(true)!);
        DOM.sink.appendChild(host, this._leadGroup.getElement(true)!);

        const clip = this._tabClip.getClipElement(true)!;
        DOM.sink.appendChild(clip, this._indicator.getElement(true)!);
        DOM.sink.appendChild(clip, this._dropTint.getElement(true)!);
        DOM.sink.appendChild(clip, this._reorderBar.getElement(true)!);

        Event.addSubtreeListener(this, "keydown", this.onToolbarKeyDown);
        Event.addSubtreeListener(this, "dblclick", this.onTabDoubleClick);

        // The reorder option may have been set during construction before the
        // strip element existed; perform the deferred install now.
        if (this._reorderable) {
            this.installTabDnD();
        }

        return this;
    }

    /**
     * Tears down all drag wiring and the raw-appended chrome overlays (see
     * `init()`), then defers to the base class for the theme subscription,
     * the element, and everything else. Called by the owner when it detaches.
     *
     * @remarks `_tabClip` / `_toolGroup` / `_leadGroup` / `_indicator` /
     * `_dropTint` / `_reorderBar` are appended straight to the strip element
     * rather than registered via `addComponent` (mirroring `WindowBorder`'s
     * strips), so the base class's recursive teardown cannot reach them —
     * they, and everything they in turn hold (tab cells, tool buttons, the
     * lead widget), must be disposed explicitly here. `_contextMenu` is in
     * the same position for a different reason: it is a LayerManager-mounted
     * `Menu`, never a registered child of anything (see Menu.ts's class
     * comment), so it needs the same explicit call.
     */
    protected destructor(): void {
        this.teardownTabDnD();
        this.clearSpringRaise();
        this._moveTriggerTeardown?.();
        this._moveTriggerTeardown = null;

        this._tabClip.dispose();
        this._toolGroup.dispose();
        this._leadGroup.dispose();
        this._indicator.dispose();
        this._dropTint.dispose();
        this._reorderBar.dispose();
        this._contextMenu.dispose();

        super.destructor();
    }

    /**
     * Applies the current `_underBorderFullWidth` value to the strip: a full-width
     * 1px rule when set, no border when cleared. A caller-supplied `border`
     * option wins over both — see the deviation note in
     * `plans/implemented/option-setter-clobbering-audit.md`'s Implementation
     * Notes: the theme-driven `_underBorderFullWidth` default (false in the
     * shipped Modern/Dark themes) would otherwise still clobber a construction-
     * time override via the early-return `clearBorder()` branch below, even
     * after folding `options?.border` into the full-width branch alone.
     *
     * @param options - The construction options, when called from the
     *   constructor; omitted for every runtime recompute (theme change,
     *   `setUnderBorderFullWidth`, `setSide`), which always re-derive the
     *   theme-token border.
     */
    private applyUnderBorder(options?: TabBarOptions): void {
        if (options?.border !== undefined) {
            this.setBorder(options.border);

            return;
        }

        if (!this._underBorderFullWidth) {
            this.clearBorder();

            return;
        }

        const rule = "1px solid var(--ts-ui-tab-toolbar-border, #e1e1e8)";

        // The under-border is the single rule between the strip and the content
        // area, so it sits on the strip's *inner* edge — the one adjacent to the
        // content: bottom for north, top for south, right for west, left for
        // east. The other three edges stay borderless. (`options?.border` is
        // guaranteed undefined here — the early return above already handled it.)
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
        this._tabClip.resetScroll();

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
     * @param align - The [`AxisEnd`](/api/primitive/type-aliases/AxisEnd) to apply.
     *
     * @returns This tab strip, for method chaining.
     */
    setAlign(align: AxisEnd): this {
        this._align = align;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-button-group alignment.
     *
     * @returns The active [`AxisEnd`](/api/primitive/type-aliases/AxisEnd).
     */
    getAlign(): AxisEnd {
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
     * @param align - The [`AxisPosition`](/api/primitive/type-aliases/AxisPosition) to apply.
     *
     * @returns This tab strip, for method chaining.
     */
    setTextAlign(align: AxisPosition): this {
        this._textAlign = align;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the current tab-label justification.
     *
     * @returns The active [`AxisPosition`](/api/primitive/type-aliases/AxisPosition).
     */
    getTextAlign(): AxisPosition {
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
        this._tabClip.setScrollable(value);

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
     * Adds a tool at the far end of the strip, opposite the tab buttons.
     *
     * Two forms: a plain {@link Component} is added as a bare strip tool with no
     * context-menu entry (the original behaviour); a {@link TabToolDescriptor}
     * has its strip {@link Button} and its `Tools`-submenu row built from the one
     * descriptor, so glyph, label, and action are declared exactly once. The two
     * are told apart by `instanceof Component` — a descriptor is a plain object.
     *
     * @param button - The tool component to add (no menu row).
     *
     * @returns This tab strip, for method chaining.
     */
    addTool(button: Component): this;

    /**
     * @param descriptor - Declares a tool that also appears in the context menu's
     *   `Tools` submenu; the strip button and menu row are built internally.
     */
    addTool(descriptor: TabToolDescriptor): this;

    addTool(arg: Component | TabToolDescriptor): this {
        const button = arg instanceof Component ? arg : this.buildDescriptorTool(arg);

        this._tools.push(button);
        this._toolGroup.addComponent(button);

        this.scheduleLayout();

        return this;
    }

    /**
     * Builds the flat strip {@link Button} for a descriptor tool — glyph from the
     * descriptor, `label` as its tooltip, `action` as its press handler — and
     * registers its menu row in {@link _toolMenuItems} so {@link openTabMenu}
     * lists it. The button's press and the menu row invoke the same `action`
     * reference, so the two can never diverge.
     *
     * @param descriptor - The tool descriptor to build a strip button for.
     *
     * @returns The built, flat, tooltip'd tool button.
     */
    private buildDescriptorTool(descriptor: TabToolDescriptor): Button {
        const button = new Button({ glyph: descriptor.glyph });

        button.setFlat(true);
        Tooltip.attach(button, descriptor.label);
        button.on("action", descriptor.action);
        this._toolMenuItems.set(button, descriptor);

        return button;
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
        this._toolMenuItems.delete(button);
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
     * The hosting group stays transparent and pointer-transparent, so a widget
     * that leaves pointer events untouched is decorative by default (a press on
     * it falls through to the empty-area window-move trigger). A widget that
     * opts back into pointer events (e.g. the window-menu-triggering leading
     * glyph) handles its own presses and is vetoed from the move and
     * double-click triggers by `isBarChromeTarget`.
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
     * Returns the cell whose tab button contains `target`, or `null` when the
     * target lands outside every tab button.
     */
    private entryForTarget(target: EventTarget | null): BarEntry | null {
        if (!DOM.source.isNode(target)) {
            return null;
        }

        const targetHandle = DOM.source.intern(target);

        for (const entry of this._entries) {
            const buttonEl = entry.button.getElement();

            if (buttonEl && DOM.source.contains(buttonEl, targetHandle)) {
                return entry;
            }
        }

        return null;
    }

    /**
     * Returns whether an event target lands on the bar's interactive chrome —
     * a tab wrapper, the tool group, the leading widget, or an overflow
     * scroll-arrow button — as opposed to the draggable blank area. The tab
     * clip is deliberately NOT treated as chrome: it spans the whole tab band
     * and its blank remainder between the last tab and the fixed chrome IS
     * the empty bar area, so vetoing it would swallow every empty-area
     * gesture.
     *
     * @param target - The event target to test.
     *
     * @returns `true` when the target is interactive bar chrome.
     */
    private isBarChromeTarget(target: EventTarget | null): boolean {
        if (this.entryForTarget(target) !== null) {
            return true;
        }

        if (!DOM.source.isNode(target)) {
            return false;
        }

        const targetHandle = DOM.source.intern(target);

        const toolGroupEl = this._toolGroup.getElement();

        if (toolGroupEl && DOM.source.contains(toolGroupEl, targetHandle)) {
            return true;
        }

        const leadWidgetEl = this._leadWidget?.getElement();

        if (leadWidgetEl && DOM.source.contains(leadWidgetEl, targetHandle)) {
            return true;
        }

        if (this._tabClip.containsArrow(target)) {
            return true;
        }

        return false;
    }

    /**
     * Subtree `dblclick` handler: emits `"tabdblclick"` for the cell the gesture
     * landed on. A double-click on the strip's blank area or its fixed chrome
     * resolves to no cell and emits nothing.
     */
    private onTabDoubleClick(e: MouseEvent): void {
        const entry = this.entryForTarget(e.target);

        if (entry) {
            this.emit("tabdblclick", entry.id);
        }
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
     * Replaces the display label of the cell with `id`, updating the strip
     * button's text and re-laying out the strip. No-op for an unknown id.
     *
     * @param id - The cell id to rename.
     * @param name - The new display label.
     *
     * @returns This tab strip, for method chaining.
     */
    setEntryName(id: string, name: string): this {
        const entry = this.entryById(id);

        if (entry) {
            entry.name = name;
            entry.button.setText(name);
            this.scheduleLayout();
        }

        return this;
    }

    /**
     * Replaces the leading icon of the cell with `id`, updating the strip
     * button and re-laying out the strip. No-op for an unknown id.
     *
     * @param id - The cell id whose icon to replace.
     * @param glyph - Registry glyph name to display.
     *
     * @returns This tab strip, for method chaining.
     *
     * @remarks
     * View-only: this bar never touches a container's `LayoutConstraints`,
     * so the change does not survive a tear-off, a re-dock, or a saved
     * layout the way [`Tab.setTabGlyph`](/api/layout/classes/Tab#settabglyph)
     * does. Reach for this method only when `Tab.setTabGlyph` can't — a lazy
     * cell whose content hasn't materialised yet, addressed here by its
     * owner-minted id instead.
     */
    setEntryGlyph(id: string, glyph: string): this {
        const entry = this.entryById(id);

        if (entry) {
            entry.button.setGlyph(glyph);
            this.scheduleLayout();
        }

        return this;
    }

    /**
     * Removes the leading icon of the cell with `id`, updating the strip
     * button and re-laying out the strip. No-op for an unknown id.
     *
     * @param id - The cell id whose icon to remove.
     *
     * @returns This tab strip, for method chaining.
     *
     * @remarks
     * View-only, like {@link setEntryGlyph}: this bar never touches a
     * container's `LayoutConstraints`, so the removal does not survive a
     * tear-off, a re-dock, or a saved layout the way
     * [`Tab.clearTabGlyph`](/api/layout/classes/Tab#cleartabglyph) does.
     */
    clearEntryGlyph(id: string): this {
        const entry = this.entryById(id);

        if (entry) {
            entry.button.clearGlyph();
            this.scheduleLayout();
        }

        return this;
    }

    /**
     * Returns the registry glyph name on the cell with `id`.
     *
     * @param id - The cell id to query.
     *
     * @returns The glyph name, or `null` when the cell has none or the id is unknown.
     */
    getEntryGlyph(id: string): string | null {
        return this.entryById(id)?.button.getGlyph()?.getGlyphName() ?? null;
    }

    /**
     * Italicises (or un-italicises) the label of the cell with `id`, updating
     * the strip button and re-laying out the strip. No-op for an unknown id.
     *
     * @param id - The cell id whose label style to change.
     * @param italic - True to italicise the label, false to restore it upright.
     *
     * @returns This tab strip, for method chaining.
     *
     * @remarks
     * View-only: this bar never touches a container's `LayoutConstraints`, so
     * the change does not survive a tear-off, a re-dock, or a saved layout.
     * Reach for this method only when [`Tab.setTabItalic`](/api/layout/classes/Tab#settabitalic)
     * can't — a lazy cell whose content hasn't materialised yet, addressed
     * here by its owner-minted id instead.
     */
    setEntryItalic(id: string, italic: boolean): this {
        const entry = this.entryById(id);

        if (entry) {
            entry.button.setFontStyle(italic ? "italic" : "normal");
            this.scheduleLayout();
        }

        return this;
    }

    /**
     * Reports whether the cell with `id` is currently italicised.
     *
     * @param id - The cell id to query.
     *
     * @returns True when the cell's label is italic; false for an unknown id.
     */
    isEntryItalic(id: string): boolean {
        return this.entryById(id)?.button.getFontStyle() === "italic";
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
     * Marks the cell with `id` as busy (or not), showing the tab button's
     * loading overlay. No-op for an unknown id.
     *
     * @param id - The cell id whose busy state changed.
     * @param busy - True while the cell's content is loading.
     *
     * @returns This tab strip, for method chaining.
     */
    setEntryBusy(id: string, busy: boolean): this {
        this.entryById(id)?.button.setBusy(busy);

        return this;
    }

    /**
     * Reports whether the cell with `id` is marked busy.
     *
     * @param id - The cell id to query.
     *
     * @returns True when the cell is busy; false for an unknown id.
     */
    isEntryBusy(id: string): boolean {
        return this.entryById(id)?.button.isBusy() ?? false;
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
     * Builds the [`TabButton`](/api/component/button/classes/TabButton) (which
     * owns the per-tab styling and the optional overlaid close button) for one
     * cell, registers it with the
     * button group / roving tab index, and pushes the cell onto the strip.
     * The first cell created becomes the active one (matching
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
        // The TabButton owns the per-tab fill/hover/selected styling and, when
        // closeable, the overlaid ✕ — collapsing the styling replay and the Fit
        // wrapper that used to live here. It is itself the box child: it carries
        // its own background (so there is no transparent wrapper to stretch a
        // button across) and hosts the close overlay on its own element.
        let tabButton = new TabButton(name, {
            glyph:     constraints?.glyph ?? undefined,
            closeable: constraints?.closeable,
        });

        tabButton.setInsets(this.computeTabButtonInsets(constraints));

        if (constraints?.tooltip) {
            Tooltip.attach(tabButton, constraints.tooltip);
        }

        tabButton.on("action", () => this.onTabPressed(tabButton));

        const closeButton = tabButton.getCloseButton() ?? undefined;

        // Subtree listener so a right-click on the label, the glyph, or the
        // close ✕ all reach one handler that opens the tab context menu. Named
        // and stored on the entry so `removeBarEntry` can remove it (the closure
        // over `entry`, resolved at call time, is safe because right-clicks only
        // fire after the entry is fully built).
        // `preventDefault` is applied by the registration's `prevent: true` floor.
        const onContextMenu = (e: MouseEvent): void => {
            this.openTabMenu(entry, e.clientX, e.clientY);
        };

        const entry: BarEntry = {
            id,
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

        Event.addSubtreeListener(tabButton, "contextmenu", { prevent: true, handler: onContextMenu });

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
        this._tabClip.addItem(tabButton);

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
     * group, roving tab index, tab button, context-menu listener). Leaves the owner
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
        this._tabClip.removeItem(entry.button);

        // The tooltip attachment is keyed by the button's id in a static map and
        // holds a reference to it; detach so a removed tab does not leak (a no-op
        // when no tooltip was attached).
        Tooltip.detach(entry.button);

        if (this._activeId === id) {
            this._activeId = null;
        }

        // Both callers (`Tab.closeEntry`, `Tab.removeEntryKeepingContent`) mint a
        // fresh cell at wherever the tab ends up next — a close's destination is
        // nowhere, a tear-off/re-dock's is a new strip — so the button itself is
        // never reused and is destroyed on both paths.
        entry.button.dispose();

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
        this._tabClip.moveItem(entry.button, dest);

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
     * Opens the shared context menu for a right-clicked tab. The layout is a
     * `Switch to` submenu (every tab, the active one inert) · the single `Close`
     * for the clicked tab · the four bulk closes (`Close others`, then the
     * before/after pair — `Close all to the left` / `... to the right` on a
     * horizontal strip, `Close all above` / `... below` on a vertical one — then
     * `Close all`) · and, only when a tool supplied a {@link TabToolDescriptor}, a
     * trailing `Tools` submenu. Every close reuses the `"tabclose"` emit and
     * switching reuses {@link setActiveEntry}, so no activation or close logic is
     * duplicated.
     *
     * @param entry - The cell that was right-clicked.
     * @param x - Horizontal viewport coordinate of the click.
     * @param y - Vertical viewport coordinate of the click.
     */
    private openTabMenu(entry: BarEntry, x: number, y: number): void {
        const activeEntry = this.activeEntry();
        const ids         = this.getEntryIds();
        const clickedIdx  = ids.indexOf(entry.id);
        const closeable   = (id: string): boolean => this.isEntryCloseable(id);

        // The per-tab switch items move into their own submenu; disable only the
        // tab that's already showing (switching to it is a no-op).
        const switchItems: MenuItemConfig[] = this._entries.map(t => ({
            text:    t.name,
            enabled: t !== activeEntry,
            action:  () => this.setActiveEntry(t.id),
        }));

        // On a vertical strip (west/east) the tabs run top-to-bottom, so the
        // "before"/"after" scopes read as above/below rather than left/right.
        const vertical    = this._side === "west" || this._side === "east";
        const beforeLabel = vertical ? "Close all above" : "Close all to the left";
        const afterLabel  = vertical ? "Close all below" : "Close all to the right";

        const configs: MenuItemConfig[] = [
            { text: "Switch to", submenu: { label: "Switch to", items: switchItems } },
            { separator: true },
            {
                text:    "Close",
                enabled: entry.constraints?.closeable === true,
                action:  () => this.emit("tabclose", entry.id),
            },
            this.bulkCloseItem("Close others", ids, clickedIdx, closeable, "others"),
            this.bulkCloseItem(beforeLabel,    ids, clickedIdx, closeable, "left"),
            this.bulkCloseItem(afterLabel,     ids, clickedIdx, closeable, "right"),
            this.bulkCloseItem("Close all",    ids, clickedIdx, closeable, "all"),
        ];

        // Trailing `Tools` submenu, only when at least one tool opted in with a
        // descriptor. Iterate `_tools` so the rows keep strip order.
        const toolItems: MenuItemConfig[] = this._tools
            .filter(tool => this._toolMenuItems.has(tool))
            .map(tool => {
                const descriptor = this._toolMenuItems.get(tool)!;

                return { text: descriptor.label, glyph: descriptor.glyph, action: descriptor.action };
            });

        if (toolItems.length > 0) {
            configs.push({ separator: true });
            configs.push({ text: "Tools", submenu: { label: "Tools", items: toolItems } });
        }

        this._contextMenu.show(x, y, configs);
    }

    /**
     * Builds one bulk-close menu row: computes its closeable target ids up front
     * (a stable snapshot, so the action closure never re-reads the live `_entries`
     * that each `"tabclose"` emit mutates) and disables the row when that set is
     * empty.
     *
     * @param text - The row label.
     * @param ids - The tab ids in strip order.
     * @param clickedIdx - The right-clicked tab's index within `ids`.
     * @param closeable - Predicate reporting whether a tab id is closeable.
     * @param scope - Which tabs, relative to the clicked one, the row closes.
     *
     * @returns The menu-item config for the bulk-close row.
     */
    private bulkCloseItem(
        text: string,
        ids: readonly string[],
        clickedIdx: number,
        closeable: (id: string) => boolean,
        scope: BulkCloseScope,
    ): MenuItemConfig {
        const targets = computeBulkCloseIds(ids, clickedIdx, closeable, scope);

        return {
            text,
            enabled: targets.length > 0,
            action:  () => {
                for (const id of targets) {
                    this.emit("tabclose", id);
                }
            },
        };
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
     * compact); a **closeable** tab additionally reserves the resolved
     * `scale.tabClose` close-button box on the edge where
     * {@link positionCloseButtons} pins the ✕ — the right for upright text
     * (north/south and west/east horizontal), the bottom or top for rotated
     * cw / ccw text. A non-closeable tab reserves nothing there, so its label
     * justification (see {@link setTextAlign}) has the whole box to work with;
     * a closeable tab justifies its label within the rect left beside the close
     * button's fixed slot. Both the reservation and the pad scale with the base,
     * while only the pad additionally shrinks in the dense strip, so the glyph
     * keeps its clearance.
     *
     * @param constraints - The tab's layout constraints; `constraints.closeable`
     *   adds the close-button reservation.
     *
     * @returns The insets to apply to the tab button.
     */
    private computeTabButtonInsets(constraints?: LayoutConstraints): Insets {
        const scale = ThemeManager.getResolvedScale();
        const pad = this._compact ? Math.round(scale.tabButtonInset / 2) : scale.tabButtonInset;
        // Reserve the close-button gutter only on a tab that actually has a close
        // button. A non-closeable tab keeps its whole box so label justification
        // uses the full width; a closeable tab justifies its label within the
        // rect left beside the close button's fixed slot.
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
            wrapper.setMinSize({ width: 0, height: min });
            wrapper.setMaxSize({ width: Number.MAX_VALUE, height: max });
        } else {
            wrapper.setMinSize({ width: min, height: 0 });
            wrapper.setMaxSize({ width: max, height: Number.MAX_VALUE });
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
        const box = this._tabClip.getContentBox() as BoxLayout;
        const overflow = this._scrollable;

        // Scroll-on-overflow: keep tabs at their width-mode extent and let the
        // strip's own overflow carry the surplus, rather than compressing to fit.
        if (overflow) {
            box.setMode("preferred");
            box.setOverflowing(!this.isVertical(), this.isVertical());

            for (const entry of this._entries) {
                const extent = this.tabModeExtent(entry.button);

                if (extent > 0) {
                    this.clampWrapperMain(entry.button, extent, extent);
                } else {
                    // "fill" / pre-measurement: keep each tab's own preferred
                    // extent. Rotated text floors to the derived main extent (the
                    // box would otherwise read the un-rotated size and clip).
                    const floor = this.isRotatedText() ? this.buttonMainExtent(entry.button) : 0;
                    this.clampWrapperMain(entry.button, floor, Number.MAX_VALUE);
                }
            }

            return;
        }

        box.setOverflowing(false, false);

        if (this._widthMode === "fill") {
            box.setMode("equal");

            for (const entry of this._entries) {
                this.clampWrapperMain(entry.button, 0, Number.MAX_VALUE);
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
                    this.clampWrapperMain(entry.button, extent, extent);
                } else {
                    this.clampWrapperMain(entry.button, 0, cap);
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
                this.clampWrapperMain(entry.button, 0, Number.MAX_VALUE);
            }

            return;
        }

        // "equal" shrinks to fit: when the uniform extent can't fit the strip,
        // collapse to fill so the tabs share the available space instead of
        // overflowing. "fixed" stays rigid (overflow is the consumer's intent).
        if (this._widthMode === "equal" && this._entries.length > 0 && extent * this._entries.length > available) {
            box.setMode("equal");

            for (const entry of this._entries) {
                this.clampWrapperMain(entry.button, 0, Number.MAX_VALUE);
            }

            return;
        }

        for (const entry of this._entries) {
            this.clampWrapperMain(entry.button, extent, extent);
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

        this._tabClip.setOrientation(wantVertical ? "vertical" : "horizontal");

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
     * Positions and sizes the strip's clip-frame band to span the whole tab band —
     * the strip region net of the tool group and the leading glyph slot, *including*
     * the scroll-arrow gutters at each end. The strip then sizes its own inner clip
     * to the band minus the gutters and places its arrows into them (see
     * {@link ScrollStrip.layoutContent}), so this only resolves the band rectangle.
     *
     * @param toolExtent - The tool group's main-axis extent in px.
     * @param leadExtent - The leading glyph's reserved main-axis extent in px (0 when no leading glyph).
     * @param thickness - The strip's cross-axis thickness in px.
     * @param mainInner - The strip's main-axis inner extent in px.
     * @param crossLead - The bar's leading cross-axis inset (0 unless the bar absorbed a parent inset).
     * @param mainLead - The bar's leading main-axis inset (0 unless the bar absorbed a parent inset).
     */
    private positionClipFrame(toolExtent: number, leadExtent: number, thickness: number, mainInner: number, crossLead: number, mainLead: number): void {
        const toolsLead = this._align === "end";
        const leadChrome = leadExtent + (toolsLead ? toolExtent : 0);
        const trailChrome = toolsLead ? 0 : toolExtent;
        const mainSize = mainInner - leadChrome - trailChrome;

        if (this.isVertical()) {
            this._tabClip.setX(crossLead);
            this._tabClip.setY(leadChrome + mainLead);
            this._tabClip.setWidth(thickness);
            this._tabClip.setHeight(mainSize);
        } else {
            this._tabClip.setX(leadChrome + mainLead);
            this._tabClip.setY(crossLead);
            this._tabClip.setWidth(mainSize);
            this._tabClip.setHeight(thickness);
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
        const wrapper = this.activeEntry()?.button;

        if (!wrapper) {
            return;
        }

        const vertical = this.isVertical();
        const mainExtent = vertical ? wrapper.getHeight() : wrapper.getWidth();

        if (mainExtent <= 0) {
            return;
        }

        // `layoutContent()` (just above, in the caller) can have placed `wrapper`
        // through LayoutManager.commitBounds's size-stable fast path, which
        // leaves getX()/getY() at the pre-move value and carries the move via
        // translate — fold it back in, or the indicator detaches from the tab
        // after any same-width reorder.
        const mainPos = vertical
            ? wrapper.getY() + wrapper.getTranslateY()
            : wrapper.getX() + wrapper.getTranslateX();

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
        const glyphSize = scale.glyphXs;

        for (const entry of this._entries) {
            const closeButton = entry.closeButton;

            if (!closeButton || entry.button.getWidth() <= 0) {
                continue;
            }

            closeButton.setWidth(closeSize);
            closeButton.setHeight(closeSize);
            closeButton.pinGlyphSize(glyphSize);

            if (rotated) {
                // Centre the ✕ across the strip thickness and pin it to the end
                // of the reading flow: the bottom for clockwise (top-to-bottom)
                // text, the top for counter-clockwise (bottom-to-top).
                closeButton.setX(Math.round((entry.button.getWidth() - closeSize) / 2));
                closeButton.setY(this._orientation === "vertical-ccw"
                    ? 2
                    : entry.button.getHeight() - closeSize - 2);
            } else {
                closeButton.setX(entry.button.getWidth() - closeSize - 2);
                closeButton.setY(Math.round((entry.button.getHeight() - closeSize) / 2));
            }
        }
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
     * When a scroll-into-view was requested (enabling scrolling, a side switch, or
     * a `compact` toggle), asks the clip frame to bring the selected tab fully into
     * view from the *laid-out* DOM rects. Runs after the clip frame's layout;
     * one-shot, so it never fights the user's own scrolling.
     */
    private revealSelectedIfRequested(): void {
        if (!this._scrollToSelected) {
            return;
        }

        this._scrollToSelected = false;

        if (!this._scrollable) {
            return;
        }

        const wrapperElement = this.activeEntry()?.button.getElement();

        if (wrapperElement) {
            this._tabClip.revealItem(wrapperElement);
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
     * frame band to the tab region (between the tool group and the leading slot),
     * applies the width mode, then has the strip lay its inner clip and overflow
     * arrows within the band, reveals the selected tab, and positions the tool
     * group, indicator, and close overlays.
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

        // Place the clip-frame band between the tool slot and the leading glyph
        // slot. A scrollable strip that overflows reserves a scroll-arrow gutter at
        // each end (held by the strip inside the band); an "end"-align leading gap
        // trailing-aligns the tabs. The strip lays its inner clip + arrows within
        // the band so the tabs scroll, clipped, between the fixed arrows.
        const arrowReserve = this._tabClip.arrowReserve(this.predictTabsExtent(), mainInner - toolExtent - leadExtent);
        const available = mainInner - toolExtent - leadExtent - 2 * arrowReserve;
        const endGap = this.endAlignGap(available);
        this.positionClipFrame(toolExtent, leadExtent, thickness, mainInner, crossLead, mainLead);

        // Set the tab width mode/clamps before the strip runs its inner box, then
        // let the strip size its clip to the band minus the gutters, lay out the
        // tabs, place the arrows, and resync its cached scroll offset. The resync
        // matters because `applyTabWidths` can lay the content out narrower than the
        // current offset (e.g. compact while scrolled to the end), so the browser
        // clamps the native scroll on its own and `revealSelectedIfRequested` would
        // otherwise add its live-rect delta to a stale base and under-scroll.
        this.applyTabWidths(available);
        this._tabClip.layoutContent(arrowReserve, endGap);

        // Scroll-into-view moves the clip's native scroll against the now-laid-out
        // wrapper rects — a prediction before the box runs can't see a same-pass
        // width change. No relayout: native scroll shifts the content.
        this.revealSelectedIfRequested();

        this.positionToolGroup(mainInner, toolExtent, thickness, crossLead, mainLead);
        this.positionLeadGroup(thickness, crossLead, mainLead);
        this.positionIndicator();
        this.positionCloseButtons();
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
        // Chrome entries (transient, e.g. a Dock start-page placeholder) are inert:
        // never a drag source, so they cannot be reordered, torn off, or dropped
        // elsewhere. Both wiring paths (createBarEntry and installTabDnD) route
        // through here, so this one guard covers them.
        if (entry.constraints?.transient) {
            return () => {};
        }

        return DragManager.makeDragSource(entry.button, {
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

                if (closeElement && DOM.source.isNode(target) && DOM.source.contains(closeElement, DOM.source.intern(target))) {
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

                // Spring-load a host-window raise only for a foreign dock — a
                // within-strip reorder is already in the frontmost window, so its
                // raise would be a needless re-stamp.
                if (detail.dragData["sourceTabId"] !== this.stripId()) {
                    this.scheduleSpringRaise();
                }

                return null;
            },
            onDragLeave: (): void => {
                this.clearSpringRaise();
                this.hideDropAffordance();
            },
            onDrop: (detail: DragEventDetail): void => {
                this.clearSpringRaise();
                this.dropTabHeader(detail);
            },
        });
    }

    /**
     * Arms the spring-loaded host-window raise if one is not already pending, so a
     * foreign tab dwelling over the strip surfaces its window after
     * {@link SPRING_RAISE_DELAY_MS}. Idempotent across the repeated `onDragOver`
     * calls a single hover produces. Fires `"dockhover"` (gated on the drag still
     * being live) for the owner to act on — the bar itself never touches a window.
     */
    private scheduleSpringRaise(): void {
        if (this._springRaiseTimer !== null) {
            return;
        }

        this._springRaiseTimer = setTimeout(() => {
            this._springRaiseTimer = null;

            if (DragManager.isDragging()) {
                this.emit("dockhover");
            }
        }, SPRING_RAISE_DELAY_MS);
    }

    /**
     * Cancels a pending spring-loaded raise — the cursor left or dropped before the
     * dwell elapsed.
     */
    private clearSpringRaise(): void {
        if (this._springRaiseTimer !== null) {
            clearTimeout(this._springRaiseTimer);
            this._springRaiseTimer = null;
        }
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
     * `"detach"`. The owner applies the content guards (whether the cell is
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

        this.emit("detach", entry.id);
    }

    /**
     * Computes the insertion slot from the cursor's main-axis position, caches it
     * in `_dragInsertIndex`, and places the insertion bar at the slot boundary.
     *
     * @param detail - The drag event detail (carries the viewport cursor).
     */
    private updateReorderSlot(detail: DragEventDetail): void {
        const element = this._tabClip.getClipElement();

        if (!element) {
            return;
        }

        const rect = DOM.source.getElementRect(element);
        const vertical = this.isVertical();

        // The clip frame scrolls its content natively, but `rect` is the border
        // box, which ignores that scroll. The wrappers' getX()/getY() are in the
        // scrolled content space, so add the scroll offset to land the cursor in
        // the same space — otherwise a scrolled strip maps it to the wrong slot.
        const cursorMain = (vertical ? detail.clientY - rect.top : detail.clientX - rect.left)
            + this._tabClip.mainScroll();

        let insertIndex = this._entries.length;

        for (let i = 0; i < this._entries.length; i++) {
            const wrapper = this._entries[i].button;
            // Fold in the translate offset a same-width relayout may have left on
            // `wrapper` via commitBounds's fast path — see positionIndicator.
            const start = vertical
                ? wrapper.getY() + wrapper.getTranslateY()
                : wrapper.getX() + wrapper.getTranslateX();
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
        // Both branches fold in the translate offset a same-width relayout may
        // have left on `wrapper` via commitBounds's fast path — see
        // positionIndicator.
        if (insertIndex < this._entries.length) {
            const wrapper = this._entries[insertIndex].button;

            return vertical ? wrapper.getY() + wrapper.getTranslateY() : wrapper.getX() + wrapper.getTranslateX();
        }

        if (this._entries.length > 0) {
            const wrapper = this._entries[this._entries.length - 1].button;

            return vertical
                ? wrapper.getY() + wrapper.getTranslateY() + wrapper.getHeight()
                : wrapper.getX() + wrapper.getTranslateX() + wrapper.getWidth();
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

        const fromIdx = this._entries.findIndex(entry => entry.button.getId() === detail.sourceId);

        if (fromIdx < 0 || this._dragInsertIndex < 0) {
            return;
        }

        this.reorderTab(fromIdx, this._dragInsertIndex);
        this._dragInsertIndex = -1;
    }

    /**
     * Moves a cell from `fromIdx` to the insertion slot `toIdx`, reorders the
     * wrapper among the clip frame's children, and emits `"reorder"` so the
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

        this._tabClip.moveItem(entry.button, dest);

        this.emit("reorder", fromId, dest);
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
    private onToolbarKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
            return;
        }

        const tabCount = this._entries.length;

        if (tabCount === 0) {
            return;
        }

        const activeIdx = this._entries.findIndex(entry => entry.id === this._activeId);
        const base = activeIdx >= 0 ? activeIdx : 0;

        const newIdx = e.key === 'ArrowRight'
            ? (base + 1) % tabCount
            : (base - 1 + tabCount) % tabCount;

        const newTab = this._entries[newIdx].button;

        this._entries.forEach(entry => entry.button.setSelected(false));
        newTab.setSelected(true);

        this.onTabPressed(newTab);

        return { prevent: true };
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
    on(event: "reorder",        listener: (fromId: string, toIndex: number) => void): this;
    on(event: "tabclose",         listener: (id: string) => void): this;
    on(event: "dockrequested",    listener: (componentId: string, slot: number) => void): this;
    on(event: "tabdragstart",     listener: (id: string) => void): this;
    on(event: "tearoffrequested", listener: (id: string, clientX: number, clientY: number, forceBare: boolean) => void): this;
    on(event: "detach",         listener: (id: string) => void): this;
    on(event: "dockhover",        listener: () => void): this;
    on(event: "tabdblclick",      listener: (id: string) => void): this;
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
    protected emit(event: "reorder",        fromId: string, toIndex: number): void;
    protected emit(event: "tabclose",         id: string): void;
    protected emit(event: "dockrequested",    componentId: string, slot: number): void;
    protected emit(event: "tabdragstart",     id: string): void;
    protected emit(event: "tearoffrequested", id: string, clientX: number, clientY: number, forceBare: boolean): void;
    protected emit(event: "detach",         id: string): void;
    protected emit(event: "dockhover"): void;
    protected emit(event: "tabdblclick",      id: string): void;
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
