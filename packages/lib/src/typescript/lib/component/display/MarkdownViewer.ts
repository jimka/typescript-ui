// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Anchor } from "~/layout/Anchor.js";
import { AnchorConstraints } from "~/layout/AnchorConstraints.js";
import { VBox } from "~/layout/VBox.js";
import { Insets } from "~/primitive/Insets.js";
import { FloatingPanel } from "~/component/container/FloatingPanel.js";
import { Button } from "~/component/button/Button.js";
import { Glyph } from "~/component/display/Glyph.js";
import { compress } from "~/glyphs/solid/compress.js";
import { expand } from "~/glyphs/solid/expand.js";
import { magnifying_glass_plus } from "~/glyphs/solid/magnifying_glass_plus.js";
import { magnifying_glass_minus } from "~/glyphs/solid/magnifying_glass_minus.js";
import { arrows_rotate } from "~/glyphs/solid/arrows_rotate.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Util } from "~/core/Util.js";
import { callable } from "~/core/Callable.js";
import { Markdown, extractMarkdownHeadings } from "~/component/display/Markdown.js";
import type { MarkdownLinkResolver } from "~/component/display/Markdown.js";
import { MarkdownMinimap } from "~/component/display/MarkdownMinimap.js";
import type { HeadingScrollSource } from "~/component/display/MarkdownMinimap.js";
import { HeadingScrollTracker } from "~/component/display/HeadingScrollTracker.js";
import type { Handle } from "~/core/DOM.js";

Glyph.register(compress, expand, magnifying_glass_plus, magnifying_glass_minus, arrows_rotate);

/**
 * Prose column width presets, in `ch` units — narrow / default / wide. `70`
 * matches the theme's own `--ts-ui-md-max-measure` default, so stepping back
 * to the middle preset reads the same as never having touched the control.
 */
const WIDTH_PRESETS_CH = [60, 70, 90];

/** Font-scale presets the zoom controls step through. */
const ZOOM_PRESETS = [0.85, 1.0, 1.15, 1.3];

/** Index into {@link WIDTH_PRESETS_CH} a freshly constructed viewer starts at. */
const DEFAULT_WIDTH_INDEX = 1;

/** Index into {@link ZOOM_PRESETS} a freshly constructed viewer starts at. */
const DEFAULT_ZOOM_INDEX = 1;

/**
 * Left margin kept on the internal `Markdown`'s own content box, so the
 * prose starts indented from the pane's edge the way text sits on a printed
 * page or in a word processor, rather than flush against it.
 */
const PROSE_LEFT_MARGIN_PX = 32;

/**
 * Construction-time options for {@link MarkdownViewer}.
 *
 * @category Components
 */
export interface MarkdownViewerOptions extends PanelOptions {
    /** The Markdown source string to render. */
    markdown?: string;

    /** Maps an authored link href to its rendered form; forwarded to the internal `Markdown`. */
    linkResolver?: MarkdownLinkResolver;

    /** Deepest heading depth the minimap shows. Default `3`, forwarded to the internal `MarkdownMinimap`. */
    maxHeadingDepth?: number;

    /** Whether the floating heading outline shows. Default `true`. */
    showMinimap?: boolean;

    /** Whether the floating width/zoom controls show. Default `true`. */
    showControls?: boolean;

    listeners?: {
        activeheadingchange?: (headingId: string | null) => void;
    };
}

const _defaultMarkdownViewerOptions: Partial<MarkdownViewerOptions> = {
    showMinimap:  true,
    showControls: true,
};

/**
 * The scrolling host `_markdown` renders into — `Panel` with `autoScroll`
 * already does everything this needs; the only reason for a subclass at all
 * is that `getScrollElement()` is `protected`, so `MarkdownViewer` (a
 * separate instance, not a subclass of this one) has no other way to reach
 * the element `HeadingScrollTracker` needs. File-local — not exported, an
 * implementation detail of `MarkdownViewer`'s own scroll wiring.
 */
class MarkdownContentPane extends Panel {
    getContentScrollElement(): Handle | undefined {
        return this.getScrollElement();
    }
}

/**
 * A single-document Markdown viewer with a floating outline minimap and
 * width/zoom controls, both pinned over the prose.
 *
 * Wraps one `Markdown` instance in an `Anchor` layout, with the minimap
 * top-right and the controls bottom-right. Any consumer embedding one
 * `Markdown` instance gets both for free by using `MarkdownViewer` instead
 * of `Markdown` directly. Exposes the same `"activeheadingchange"` event
 * `DocsContent` exposes, computed from its own native scroll the same way —
 * both delegate to {@link HeadingScrollTracker}, the shared owner of that
 * technique — see {@link HeadingScrollSource}. `MarkdownMinimap` consumes
 * that event to highlight whichever heading is currently on screen without
 * depending on this class concretely.
 *
 * The viewer itself never scrolls: `_markdown` renders into an internal
 * {@link MarkdownContentPane} (a plain scrolling `Panel`, stretched to fill)
 * so the minimap and controls — anchored directly on this outer, non-scrolling
 * `Anchor` host, the same way `DocsShell` anchors its own floating panels
 * beside (not inside) the scrolling `DocsContent` — stay pinned over the
 * viewport instead of scrolling away with the prose.
 *
 * @category Components
 */
class MarkdownViewer extends Panel<MarkdownViewerOptions> implements HeadingScrollSource {

    private readonly _content: MarkdownContentPane;
    private readonly _markdown: Markdown;
    private readonly _minimap: MarkdownMinimap;
    private _controls!: FloatingPanel;
    private _narrowerBtn!: Button;
    private _widerBtn!: Button;
    private _zoomOutBtn!: Button;
    private _zoomInBtn!: Button;
    private _resetBtn!: Button;

    private _widthIndex: number = DEFAULT_WIDTH_INDEX;
    private _zoomIndex: number = DEFAULT_ZOOM_INDEX;

    private readonly _listeners: ListenerBag<"activeheadingchange"> = this.registerListenerBag(new ListenerBag<"activeheadingchange">());

    private readonly handleNativeScroll:  () => void            = () => this.onNativeScroll();
    private readonly handleMinimapSelect: (id: string) => void  = (id) => this.scrollToHeading(id);
    private readonly _onNarrower:         () => void            = () => this.stepWidth(-1);
    private readonly _onWider:            () => void            = () => this.stepWidth(1);
    private readonly _onZoomOut:          () => void            = () => this.stepZoom(-1);
    private readonly _onZoomIn:           () => void            = () => this.stepZoom(1);
    private readonly _onReset:            () => void            = () => this.resetViewerProperties();

    private readonly handleActiveHeadingChange: (headingId: string | null) => void =
        (id) => this.emit("activeheadingchange", id);

    private readonly _tracker: HeadingScrollTracker =
        new HeadingScrollTracker(this, this.handleActiveHeadingChange);

    constructor(options?: MarkdownViewerOptions, subclassDefaults?: Partial<MarkdownViewerOptions>) {
        super(options, {
            ..._defaultMarkdownViewerOptions,
            ...(subclassDefaults ?? {}),
            // Last, so a subclass default can't silently swap out the
            // Anchor every addComponent call below depends on. (A caller
            // passing its own `options.layoutManager` still wins, per
            // Component's own dispatch — the same pre-existing tradeoff
            // DiagramView's own Anchor-dependent constructor carries.)
            layoutManager: new Anchor(),
        } as Partial<MarkdownViewerOptions>);

        this._content = new MarkdownContentPane({ layoutManager: new Anchor(), autoScroll: "y", flush: true });

        const contentConstraints = new AnchorConstraints();
        contentConstraints.left   = 0;
        contentConstraints.right  = 0;
        contentConstraints.top    = 0;
        contentConstraints.bottom = 0;
        this.addComponent(this._content, contentConstraints);

        this._markdown = new Markdown(options?.markdown, {
            linkResolver: options?.linkResolver,
            padding:      new Insets(0, 0, 0, PROSE_LEFT_MARGIN_PX),
        });

        const markdownConstraints = new AnchorConstraints();
        markdownConstraints.left  = 0;
        markdownConstraints.right = 0;
        this._content.addComponent(this._markdown, markdownConstraints);

        const headings = extractMarkdownHeadings(options?.markdown ?? "");

        this._tracker.setHeadings(headings);

        this._minimap = new MarkdownMinimap({ scrollSource: this, maxHeadingDepth: options?.maxHeadingDepth, corner: "top-right" });
        this._minimap.setHeadings(headings);
        this._minimap.on("select", this.handleMinimapSelect);
        this.addComponent(this._minimap, this._minimap.getAnchorConstraints());

        this.buildControls();
        this.wireControlListeners();
        this.addComponent(this._controls, this._controls.getAnchorConstraints());

        Event.addSubtreeListener(this, "scroll", this.handleNativeScroll);

        this.setMinimapVisible(this._options.showMinimap ?? this._defaultOptions.showMinimap ?? true);
        this.setControlsVisible(this._options.showControls ?? this._defaultOptions.showControls ?? true);

        this.applyListeners(options?.listeners);
    }

    /**
     * Lays out `Markdown` / the minimap / the controls as usual, then
     * re-hugs the minimap and the controls against `_markdown`'s freshly
     * committed geometry — `FloatingPanel.placeNextTo` needs calling after
     * every pass that can move either this viewer's own width or
     * `_markdown`'s rendered width (see its own doc comment for why it's an
     * owner-driven call rather than a `FloatingPanel`-internal `doLayout`
     * override).
     *
     * @returns This viewer, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        // Guards against the super() cascade's own options dispatch (e.g.
        // setLayoutManager) triggering a layout pass before this constructor
        // has reached the point of assigning _minimap/_controls/_markdown.
        this._minimap?.placeNextTo(this._markdown ?? null);
        this._controls?.placeNextTo(this._markdown ?? null);

        return this;
    }

    /**
     * Dispatches `showMinimap` / `showControls`; every other option either
     * routes to the internal `Markdown` (constructor-only) or is inherited
     * from `Panel`.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This viewer, for method chaining.
     */
    protected applyOptions(options: MarkdownViewerOptions): this {
        super.applyOptions(options);

        // Cached only: the minimap/controls don't exist yet during the
        // super() cascade. The constructor dispatches
        // setMinimapVisible/setControlsVisible itself once they're built —
        // mirrors DiagramView's own `controls` option.
        if (options.showMinimap !== undefined) {
            this._options.showMinimap = options.showMinimap;
        }

        if (options.showControls !== undefined) {
            this._options.showControls = options.showControls;
        }

        return this;
    }

    /**
     * Read-only escape hatch; change content via {@link setMarkdown}, not by
     * calling `getMarkdown().setMarkdown(...)` directly — that would desync
     * the minimap.
     *
     * @returns The internal `Markdown` instance.
     */
    getMarkdown(): Markdown {
        return this._markdown;
    }

    /**
     * Replaces the rendered source, recomputes headings, and refreshes the minimap.
     *
     * @param markdown - The new Markdown source string.
     * @returns This viewer, for method chaining.
     */
    setMarkdown(markdown: string): this {
        this._markdown.setMarkdown(markdown);

        const headings = extractMarkdownHeadings(markdown);

        this._tracker.setHeadings(headings);
        this._minimap.setHeadings(headings);

        return this;
    }

    /**
     * Whether the floating heading-outline minimap shows.
     *
     * @returns `true` when the minimap is visible.
     */
    isMinimapVisible(): boolean {
        return this._options.showMinimap ?? this._defaultOptions.showMinimap ?? true;
    }

    /**
     * Shows or hides the floating heading-outline minimap.
     *
     * @param value - Whether the minimap is visible.
     * @returns This viewer, for method chaining.
     */
    setMinimapVisible(value: boolean): this {
        this._options.showMinimap = value;
        this._minimap.setVisible(value);

        return this;
    }

    /**
     * Whether the floating width/zoom control cluster shows.
     *
     * @returns `true` when the control cluster is visible.
     */
    isControlsVisible(): boolean {
        return this._options.showControls ?? this._defaultOptions.showControls ?? true;
    }

    /**
     * Shows or hides the floating width/zoom control cluster.
     *
     * @param value - Whether the control cluster is visible.
     * @returns This viewer, for method chaining.
     */
    setControlsVisible(value: boolean): this {
        this._options.showControls = value;
        this._controls.setVisible(value);

        return this;
    }

    on(event: "activeheadingchange", listener: (headingId: string | null) => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    off(event: "activeheadingchange", listener: (headingId: string | null) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    protected emit(event: "activeheadingchange", headingId: string | null): void {
        this._listeners.fire(event, headingId);
    }

    /** Builds the corner-pinned width-narrower/wider, zoom-out/in, and reset control cluster. */
    private buildControls(): void {
        this._narrowerBtn = this.makeControlButton("compress", "Narrower");
        this._widerBtn    = this.makeControlButton("expand", "Wider");
        this._zoomOutBtn  = this.makeControlButton("magnifying-glass-minus", "Zoom out");
        this._zoomInBtn   = this.makeControlButton("magnifying-glass-plus", "Zoom in");
        this._resetBtn    = this.makeControlButton("arrows-rotate", "Reset");

        this._controls = new FloatingPanel({ corner: "bottom-right", layoutManager: new VBox({ spacing: 4 }) });
        this._controls.addComponent(this._narrowerBtn);
        this._controls.addComponent(this._widerBtn);
        this._controls.addComponent(this._zoomOutBtn);
        this._controls.addComponent(this._zoomInBtn);
        this._controls.addComponent(this._resetBtn);
    }

    /**
     * Builds a glyph-only control button with an accessible label, mirroring
     * `DiagramView`'s own control-cluster buttons.
     *
     * @param glyph - The glyph name to show.
     * @param label - The accessible name (drives `aria-label` and the tooltip).
     * @returns The configured button.
     */
    private makeControlButton(glyph: string, label: string): Button {
        return new Button({ glyph, text: label, showText: false });
    }

    /** Wires the control cluster's buttons to their viewer-property step methods. */
    private wireControlListeners(): void {
        this._narrowerBtn.on("action", this._onNarrower);
        this._widerBtn.on("action", this._onWider);
        this._zoomOutBtn.on("action", this._onZoomOut);
        this._zoomInBtn.on("action", this._onZoomIn);
        this._resetBtn.on("action", this._onReset);
    }

    /**
     * Moves `_widthIndex` by one step, clamped to `WIDTH_PRESETS_CH`'s bounds,
     * and applies the resulting preset to the internal `Markdown`.
     *
     * @param direction - `1` for wider, `-1` for narrower.
     */
    private stepWidth(direction: 1 | -1): void {
        this._widthIndex = Util.clamp(this._widthIndex + direction, 0, WIDTH_PRESETS_CH.length - 1);
        this._markdown.setMaxMeasure(WIDTH_PRESETS_CH[this._widthIndex] + "ch");
        // setMaxMeasure writes a CSS rule directly and schedules no layout of
        // its own, so the minimap/controls hug would otherwise go stale
        // against the prose's new rendered width — see FloatingPanel.placeNextTo.
        this._minimap.placeNextTo(this._markdown);
        this._controls.placeNextTo(this._markdown);
    }

    /**
     * Moves `_zoomIndex` by one step, clamped to `ZOOM_PRESETS`'s bounds, and
     * applies the resulting preset to the internal `Markdown`.
     *
     * @param direction - `1` for zoom in, `-1` for zoom out.
     */
    private stepZoom(direction: 1 | -1): void {
        this._zoomIndex = Util.clamp(this._zoomIndex + direction, 0, ZOOM_PRESETS.length - 1);
        this._markdown.setFontScale(ZOOM_PRESETS[this._zoomIndex]);
        // setFontScale can also change the prose's rendered width (ch-based
        // maxMeasure scales with font size) — see stepWidth's own comment.
        this._minimap.placeNextTo(this._markdown);
        this._controls.placeNextTo(this._markdown);
    }

    /**
     * Resets both viewer properties to their default index and clears their
     * overrides entirely (`setMaxMeasure(null)` / `setFontScale(1)`) rather
     * than re-applying the default preset, so a live theme change afterward
     * still takes effect.
     */
    private resetViewerProperties(): void {
        this._widthIndex = DEFAULT_WIDTH_INDEX;
        this._zoomIndex  = DEFAULT_ZOOM_INDEX;
        this._markdown.setMaxMeasure(null);
        this._markdown.setFontScale(1);
        this._minimap.placeNextTo(this._markdown);
        this._controls.placeNextTo(this._markdown);
    }

    /**
     * Computes the active heading from the current native scroll position and
     * emits `"activeheadingchange"` only when it differs from the previous
     * tick. Delegates to {@link HeadingScrollTracker}, the shared
     * implementation `DocsContent` also delegates to.
     */
    private onNativeScroll(): void {
        const scrollElement = this._content.getContentScrollElement();

        if (scrollElement) {
            this._tracker.trackScroll(scrollElement);
        }
    }

    /**
     * Scrolls this viewer so `id`'s heading sits at the pane's own top edge.
     * Delegates to {@link HeadingScrollTracker}, the shared implementation
     * `DocsContent` also delegates to.
     *
     * @param id - The heading id to scroll to.
     */
    private scrollToHeading(id: string): void {
        const scrollElement = this._content.getContentScrollElement();

        if (scrollElement) {
            this._tracker.scrollToHeading(scrollElement, id);
        }
    }

    /**
     * The prose's scroll offset — delegates to the internal {@link
     * MarkdownContentPane} that actually scrolls; this outer viewer never does
     * (see the class doc for why).
     *
     * @returns The cached `scrollTop` in pixels.
     */
    getScrollTop(): number {
        return this._content.getScrollTop();
    }

    /**
     * Scrolls the prose to the given offset — delegates to the internal
     * {@link MarkdownContentPane}; see {@link getScrollTop}.
     *
     * @param value - The new `scrollTop` in pixels.
     * @returns This viewer, for method chaining.
     */
    setScrollTop(value: number): this {
        this._content.setScrollTop(value);

        return this;
    }
}

const MarkdownViewerCallable = callable(MarkdownViewer);
type MarkdownViewerCallable = MarkdownViewer;
export {
    MarkdownViewer         as _MarkdownViewer,
    MarkdownViewerCallable as MarkdownViewer,
};
