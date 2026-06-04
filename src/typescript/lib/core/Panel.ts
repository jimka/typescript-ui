// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component";
import { Insets } from "~/primitive/Insets";
import { LayoutManager } from "~/layout/LayoutManager.js";
import { Util } from "~/core/Util.js";
import { Event } from "~/core/Event.js";
import { InlineStyle } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";

/**
 * Depth in pixels of each scroll-edge fade gradient.
 *
 * Fixed framework-side rather than themed, for the same reason the keyboard
 * focus indicator fixes its `2px` width (see `Theme.indicator.focus`): the
 * colour is the only part a theme needs to vary, and a constant keeps the
 * overlay's four-layer gradient geometry simple. `12px` reads as a soft edge
 * cue without masking a meaningful strip of content.
 */
const SCROLL_SHADOW_EXTENT_PX = 12;

/**
 * Per-edge on/off state for a panel's scroll shadows. Cached so the per-scroll
 * update only writes a custom property when an edge actually crosses its
 * threshold, never on every scroll frame.
 */
type ScrollShadowEdges = { top: boolean; bottom: boolean; left: boolean; right: boolean };

/**
 * Selects the per-axis scroll behaviour for a {@link Panel}.
 *
 * - `"none"` — never scroll; oversized children clip (the default).
 * - `"auto"` — scrollbars appear on either axis only when content overflows.
 * - `"x"`    — horizontal scrollbar on overflow; vertical overflow clips.
 * - `"y"`    — vertical scrollbar on overflow; horizontal overflow clips.
 * - `"both"` — both scrollbars are always shown (`overflow: scroll`).
 *
 * @remarks For every value except `"none"` the panel measures the native
 * scrollbar gutter after each `doLayout` pass and subtracts it from
 * `getInnerSize` when a scrollbar is actually visible, so layout managers
 * naturally lay out children within the post-gutter content area instead of
 * letting them spill behind the scrollbar (which the browser would otherwise
 * resolve by adding the opposite-axis scrollbar — the classic V→H cascade).
 * A scrollbar transition triggers a one-frame re-layout via `scheduleLayout`.
 *
 * @category Core
 */
export type AutoScrollMode = "none" | "auto" | "x" | "y" | "both";

/**
 * Construction-time options for {@link Panel}.
 *
 * @remarks `insets` is inherited from {@link ComponentOptions} but defaults to
 * `(4, 4, 4, 4)` for `Panel` (Component itself defaults to zero insets). Pass
 * an explicit `insets` to override.
 *
 * @category Core
 */
export interface PanelOptions extends ComponentOptions {
    tag?:        string;

    /**
     * Construction-time shortcut for [`Panel.setAutoScroll`](/api/core/classes/Panel#setautoscroll). Defaults to
     * `"none"` (oversized children clip, matching the inherited `Component`
     * `overflow: hidden` behaviour).
     */
    autoScroll?: AutoScrollMode;

    /**
     * When `true` (the default), an `autoScroll` panel paints a fading edge
     * shadow on each side where hidden content can still be scrolled into
     * view — a cue that the content continues past the viewport border rather
     * than ending there. Set `false` to suppress the shadows. Ignored while
     * `autoScroll === "none"` (a non-scrolling panel never shows them).
     */
    scrollShadows?: boolean;
}

/**
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade in `Component`'s constructor dispatches `setInsets` once with the
 * final value, so a caller-supplied `insets` wins over the panel default.
 */
const _defaultPanelOptions: Partial<PanelOptions> = {
    tag:    "div",
    insets: new Insets(4, 4, 4, 4),
};

/**
 * A [`Component`](/api/core/classes/Component) subclass that applies a default 4-pixel inset on all sides.
 *
 * Use `Panel` as the base class for grouped UI containers where children
 * should not sit flush against the outer edge. Plain [`Component`](/api/core/classes/Component) defaults
 * to zero insets to keep leaf widgets pixel-predictable; `Panel` opts into
 * the visual breathing room that grouped layouts typically want.
 *
 * `Panel` also exposes `setAutoScroll` to opt the container into native
 * browser scrolling when its children overflow the allocated rect.
 *
 * @category Core
 */
class Panel<TOptions extends PanelOptions = PanelOptions> extends Component<TOptions> {

    // `declare` rather than initialiser to dodge the class-field super-cascade
    // trap: a `= "none"` initialiser runs *after* super() returns, which
    // overwrites whatever `setAutoScroll(opts.autoScroll)` had already
    // written during the super-time cascade. `applyOptions` below always
    // dispatches `setAutoScroll`, so the field gets seeded there.
    declare private _autoScroll:      AutoScrollMode;
    declare private _scrollbarGutter: { right: number; bottom: number };

    // Scroll-shadow state. `_scrollShadows`, `_shadowOverlay` and `_shadowScrollHandler`
    // are written by `setScrollShadows` / `setAutoScroll` during the super-time
    // options cascade, so they are `declare`d (no initialiser) and seeded in
    // `applyOptions` to dodge the class-field super-cascade trap — an
    // initialiser would run after super() and clobber the seeded value.
    declare private _scrollShadows:       boolean;
    declare private _shadowOverlay:       HTMLElement | null;
    declare private _shadowScrollHandler: (() => void) | null;   // cached bound scroll handler — wired once

    // Runtime-only: never touched during the super cascade (the overlay only
    // exists post-render), so a plain initialiser is safe here.
    private _shadowOverlayStyle: InlineStyle       = new InlineStyle();
    private _shadowEdges:        ScrollShadowEdges = { top: false, bottom: false, left: false, right: false };

    /**
     * Creates a panel with 4-pixel insets on all sides by default.
     *
     * @param options - Optional. Construction-time options applied to the panel.
     *   `options.tag` overrides the default `"div"` tag for subclasses that need
     *   a different element (e.g. `"header"`, `"section"`). `options.insets`
     *   overrides the default `(4, 4, 4, 4)` perimeter.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            options,
            { ..._defaultPanelOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );
    }

    /**
     * Dispatches `Panel`-specific options after delegating the inherited
     * {@link Component} options bag to `super`.
     *
     * @param options - The options bag whose fields populate this panel.
     *
     * @returns This panel, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as TOptions;

        // Seed the scrollbar gutter cache before `setAutoScroll` — the latter
        // reads `_scrollbarGutter` to decide whether to clear it on a
        // `"none"` transition, and the `declare`d field would otherwise be
        // undefined at first dispatch.
        this.setScrollbarGutter(0, 0);

        // Always dispatch `setAutoScroll` — the `?? "none"` covers the
        // no-option default. Routing through the setter (even for the
        // default) keeps the `declare`d backing field initialised and
        // dodges the class-field super-cascade trap that would bite a
        // `= "none"` initialiser.
        this.setAutoScroll(opts.autoScroll ?? "none");

        // Seed the `declare`d overlay/handler fields before `setScrollShadows`
        // dispatches — the setter's teardown branch reads them, and the
        // `declare` leaves them `undefined` until first written.
        this._shadowOverlay        = null;
        this._shadowScrollHandler  = null;

        // Always dispatch (default on) so the backing field is seeded through
        // the setter, mirroring the `setAutoScroll` cascade above.
        this.setScrollShadows(opts.scrollShadows ?? true);

        return this;
    }

    /**
     * Selects the panel's native scroll behaviour. Translates `mode` to
     * per-axis `overflow` writes via [`Component.setOverflowX`](/api/core/classes/Component#setoverflowx) /
     * [`Component.setOverflowY`](/api/core/classes/Component#setoverflowy).
     *
     * @param mode - The {@link AutoScrollMode} to apply.
     *
     * @returns This panel, for method chaining.
     *
     * @remarks Children render at their preferred size when `mode !== "none"`
     * — the panel no longer clips them to its allocated rect.
     *
     * Whenever a scrollbar becomes visible, `doLayout` measures the gutter
     * and shrinks the panel's reported inner size by that amount so the next
     * layout pass keeps children inside the visible content area (preventing
     * the classic V→H cascade where a right-anchored child gets exposed
     * behind a freshly-shown V scrollbar and triggers an H one).
     *
     * Do not combine with a [`Scrollbar`](/api/component/container/classes/Scrollbar) overlay or a
     * component (e.g. [`Table`](/api/component/table/classes/Table)) that already manages its own scroll
     * state — stacking native overflow on top of the custom scrollbar would
     * produce two scrollbars.
     */
    setAutoScroll(mode: AutoScrollMode): this {
        this._autoScroll = mode;

        switch (mode) {
            case "none":
                this.setOverflowX("hidden").setOverflowY("hidden");
                break;
            case "auto":
                this.setOverflowX("auto").setOverflowY("auto");
                break;
            case "x":
                this.setOverflowX("auto").setOverflowY("hidden");
                break;
            case "y":
                this.setOverflowX("hidden").setOverflowY("auto");
                break;
            case "both":
                this.setOverflowX("scroll").setOverflowY("scroll");
                break;
        }

        // Mode switched — drop any cached gutter from the previous mode so
        // the next `doLayout` re-measures against the new overflow setting.
        // ("none" never has a gutter; the other modes recompute below.)
        if (mode === "none" && (this._scrollbarGutter.right !== 0 || this._scrollbarGutter.bottom !== 0)) {
            this.setScrollbarGutter(0, 0);
        }

        // Forward the per-axis "let children overflow the host" decision to
        // the layout manager. Each manager honours these flags from its own
        // `doLayout` so trailing children land past `innerSize` when their
        // combined minSize exceeds the host's allocated rect, producing the
        // scrollbar the CSS `overflow: auto` above is waiting for.
        const x = mode === "auto" || mode === "x" || mode === "both";
        const y = mode === "auto" || mode === "y" || mode === "both";

        this.getLayoutManager()?.setOverflowing(x, y);

        // Re-evaluate the shadows for the new mode: a transition into `"none"`
        // tears the overlay down, a transition into a scrolling mode installs
        // it. No-op before the element exists (creation is deferred to `init`).
        this.refreshScrollShadows();

        return this;
    }

    /**
     * Re-applies the cached `autoScroll` mode to the new layout manager so
     * swapping managers preserves scroll behaviour. The base `setLayoutManager`
     * does the attach work; this override only forwards the overflow flags.
     *
     * @param layoutManager - The new LayoutManager to use for this panel.
     *
     * @returns This panel, for method chaining.
     */
    setLayoutManager(layoutManager: LayoutManager): this {
        super.setLayoutManager(layoutManager);
        this.setAutoScroll(this._autoScroll);

        return this;
    }

    /**
     * Returns the panel's current scroll mode.
     *
     * @returns The cached {@link AutoScrollMode}; `"none"` if never set.
     */
    getAutoScroll(): AutoScrollMode {
        return this._autoScroll;
    }

    /**
     * Resets the panel's scroll mode to `"none"`, restoring the inherited
     * `overflow: hidden` clipping behaviour.
     *
     * @returns This panel, for method chaining.
     */
    clearAutoScroll(): this {
        return this.setAutoScroll("none");
    }

    /**
     * Enables or disables the position-aware edge shadows on a scrolling
     * panel. When enabled (the default), each side that can still be scrolled
     * toward fades its content into the viewport border; the shadows are
     * suppressed entirely while `autoScroll === "none"` or when content does
     * not overflow.
     *
     * @param enabled - `true` to paint the edge shadows, `false` to suppress them.
     *
     * @returns This panel, for method chaining.
     */
    setScrollShadows(enabled: boolean): this {
        this._scrollShadows = enabled;

        this.refreshScrollShadows();

        return this;
    }

    /**
     * Returns whether the panel's scroll edge shadows are enabled.
     *
     * @returns The cached `scrollShadows` flag; `true` unless explicitly disabled.
     */
    getScrollShadows(): boolean {
        return this._scrollShadows;
    }

    /**
     * Returns the panel's usable inner size with the currently-reserved
     * scrollbar gutter subtracted from each axis. Layout managers read this
     * to lay out children inside the post-gutter content area when a native
     * scrollbar is visible, instead of letting them fill the full rect and
     * spill behind (or be clipped by) the scrollbar.
     *
     * @returns The inner size minus the active scrollbar gutter, or null
     * when the element is not yet in the DOM (matches the base
     * `Component.getInnerSize` contract).
     */
    getInnerSize(): { width: number, height: number } | null {
        const size = super.getInnerSize();
        if (!size) {
            return null;
        }

        return {
            width:  size.width  - this._scrollbarGutter.right,
            height: size.height - this._scrollbarGutter.bottom,
        };
    }

    /**
     * Lays out children, then measures the post-layout scrollbar visibility
     * and, when it has changed since the last pass, caches the new gutter
     * and schedules a follow-up layout so children land inside the new
     * post-gutter content area. The follow-up is the "one-frame reflow"
     * documented on {@link AutoScrollMode}.
     *
     * @returns This panel, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        // Flush queued inline-style writes (own size in particular) before
        // reading scrollbar geometry: `LayoutManager.commitBounds` runs us
        // with `autoCommitStyle === false`, so the new width/height
        // `setSize` queued during the parent's layout pass haven't reached
        // the DOM yet — `scrollHeight` / `clientHeight` would otherwise
        // report the previous frame's dimensions and `measureScrollbarGutter`
        // wouldn't see the scrollbar transition.
        this.commitElementStyle();
        this.measureScrollbarGutter();

        // Re-pin the overlay and recompute edge state against the freshly
        // committed geometry (content-size or scrollbar-gutter changes can
        // flip which edges overflow). The preceding `commitElementStyle`
        // guarantees the reads see this frame's dimensions.
        this.updateScrollShadows();

        return this;
    }

    /**
     * Initialises the panel element, then installs the scroll-shadow overlay
     * if the panel is a scroll-shadow candidate. Overlay creation is deferred
     * to here (rather than `applyOptions`) because the element only exists
     * once rendered.
     *
     * @param element - Optional. The element to initialise; falls back to the rendered element.
     *
     * @returns This panel, for method chaining.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        // `getElement()` is still undefined inside `init` (the base assigns
        // `_element` only after `render` returns), so hand the resolved
        // element straight to the installer instead of re-reading it.
        const resolved = element ?? this.getElement();
        if (resolved && this._scrollShadows && this._autoScroll !== "none") {
            this.installScrollShadows(resolved);
            this.updateScrollShadows(resolved);
        }

        return this;
    }

    /**
     * Removes the cached scroll listener before the base destructor detaches
     * the element. The overlay is a child of that element, so it is removed
     * with it; only the window-level listener registration needs explicit
     * cleanup.
     */
    protected destructor(): void {
        this.removeScrollShadows();

        super.destructor();
    }

    /**
     * Caches the new gutter for each axis. Internal — driven by
     * `measureScrollbarGutter` after a layout pass; consumers can't
     * configure this (it's derived from runtime DOM measurement, not a
     * declarative input), so it stays off the `PanelOptions` bag.
     *
     * @param right - Reserved gutter on the right edge in pixels.
     * @param bottom - Reserved gutter on the bottom edge in pixels.
     */
    private setScrollbarGutter(right: number, bottom: number): void {
        this._scrollbarGutter = { right, bottom };
    }

    /**
     * Reads the post-layout scrollbar visibility from the live DOM and
     * updates the cached gutter to match. When the gutter changed,
     * schedules a follow-up layout pass so children re-flow inside the new
     * inner area. No-op for `mode === "none"` and on browsers whose
     * scrollbars don't reserve space (e.g. macOS overlay scrollbars, where
     * the native width measures as 0 — the cascade can't happen there).
     */
    private measureScrollbarGutter(): void {
        if (this._autoScroll === "none") {
            return;
        }

        const el = this.getElement();
        if (!el) {
            return;
        }

        const trackW = Util.getScrollBarWidth();
        if (trackW === 0) {
            return;
        }

        // `"both"` forces both scrollbars on (`overflow: scroll` on both
        // axes), so the gutter is always reserved on both sides. The
        // single-axis modes only show their one bar, and `"auto"` shows
        // each independently; reading `scrollHeight > clientHeight` (and
        // its X-axis twin) detects whichever bars the browser has chosen
        // to render this frame, which matches the visible-only criterion.
        let vReserved: boolean;
        let hReserved: boolean;

        if (this._autoScroll === "both") {
            vReserved = true;
            hReserved = true;
        } else {
            const vAxisEnabled = this._autoScroll === "y" || this._autoScroll === "auto";
            const hAxisEnabled = this._autoScroll === "x" || this._autoScroll === "auto";

            vReserved = vAxisEnabled && el.scrollHeight > el.clientHeight;
            hReserved = hAxisEnabled && el.scrollWidth  > el.clientWidth;
        }

        const newRight  = vReserved ? trackW : 0;
        const newBottom = hReserved ? trackW : 0;

        if (newRight === this._scrollbarGutter.right && newBottom === this._scrollbarGutter.bottom) {
            return;
        }

        this.setScrollbarGutter(newRight, newBottom);
        this.scheduleLayout();
    }

    /**
     * Brings the scroll-shadow overlay into the state implied by the current
     * `scrollShadows` / `autoScroll` settings: torn down when disabled or
     * non-scrolling, otherwise installed and refreshed. No-op before the
     * element exists — `init` performs the first install once rendered.
     */
    private refreshScrollShadows(): void {
        if (!this._scrollShadows || this._autoScroll === "none") {
            this.removeScrollShadows();

            return;
        }

        const element = this.getElement();
        if (!element) {
            return;
        }

        this.installScrollShadows(element);
        this.updateScrollShadows(element);
    }

    /**
     * Creates the overlay and wires the scroll listener if they are not
     * already present. Idempotent: the `_shadowOverlay` / `_shadowScrollHandler` guards
     * keep it from stacking a duplicate overlay or listener across repeated
     * calls (the "wire once" rule).
     *
     * @param element - The rendered panel element to append the overlay to.
     */
    private installScrollShadows(element: HTMLElement): void {
        if (!this._shadowOverlay) {
            this.createScrollShadowOverlay(element);
        }

        if (!this._shadowScrollHandler) {
            const handler = (): void => {
                this.updateScrollShadows();
            };

            this._shadowScrollHandler = handler;
            Event.addListener(this, "scroll", handler);
        }
    }

    /**
     * Builds the non-interactive shadow overlay: an id-less, listener-free
     * presentational sheath (mirroring the clip/content frames) carrying all
     * four edge-fade gradient layers. Each layer's start colour is a local
     * custom property defaulting to `transparent`, so the per-scroll path only
     * flips a property to light an edge rather than rebuilding the image.
     *
     * @param element - The panel element the overlay is appended to.
     */
    private createScrollShadowOverlay(element: HTMLElement): void {
        const overlay = document.createElement("div");
        const extent  = SCROLL_SHADOW_EXTENT_PX + "px";

        this._shadowOverlayStyle.attach(overlay);
        this._shadowOverlayStyle.setMany({
            position:      "absolute",
            left:          "0px",
            top:           "0px",
            pointerEvents: "none",
            // Paint above the content frame: `setContentFrame` re-appends that
            // frame as the element's last child during layout, so DOM order
            // alone would let it cover an overlay appended here at `init`.
            zIndex:        "1",
            // Permanent scroll-mirror target (one per scrollable panel) — the
            // documented will-change budget exception for compositor pinning.
            willChange:    "transform",
            backgroundRepeat: "no-repeat",
            backgroundImage:
                "linear-gradient(to bottom, var(--ts-ss-top, transparent), transparent)," +
                "linear-gradient(to top, var(--ts-ss-bottom, transparent), transparent)," +
                "linear-gradient(to right, var(--ts-ss-left, transparent), transparent)," +
                "linear-gradient(to left, var(--ts-ss-right, transparent), transparent)",
            backgroundSize:     `100% ${extent}, 100% ${extent}, ${extent} 100%, ${extent} 100%`,
            backgroundPosition: "top, bottom, left, right",
        });

        element.appendChild(overlay);
        this._shadowOverlay = overlay;
    }

    /**
     * Tears the overlay down and unwires the scroll listener, resetting the
     * cached edge state. Each step is guarded so this is safe to call before
     * the overlay was ever created (e.g. during the construction cascade).
     */
    private removeScrollShadows(): void {
        if (this._shadowScrollHandler) {
            Event.removeListener(this, "scroll", this._shadowScrollHandler);
            this._shadowScrollHandler = null;
        }

        if (this._shadowOverlay) {
            this._shadowOverlay.remove();
            this._shadowOverlay = null;

            // The buffer was bound to the now-removed overlay; a fresh one is
            // needed for any future re-install (mirrors `disposeFrame`).
            this._shadowOverlayStyle = new InlineStyle();
        }

        this._shadowEdges = { top: false, bottom: false, left: false, right: false };
    }

    /**
     * Pins the overlay over the live viewport and recomputes which edges show
     * a fade. Cheap enough for the per-scroll path: it writes one transform
     * (plus the viewport size) and toggles a custom property only when an edge
     * crosses its threshold.
     *
     * @param element - Optional. The panel element; falls back to the rendered
     *   element. Passed explicitly from `init`, where `getElement` is not yet
     *   populated.
     */
    private updateScrollShadows(element?: HTMLElement): void {
        const el = element ?? this.getElement();
        if (!el || !this._shadowOverlay) {
            return;
        }

        const { scrollTop, scrollLeft, scrollWidth, scrollHeight, clientWidth, clientHeight } = el;

        // Pin to the viewport: the overlay is an absolute child of the scroll
        // port, so without this it would scroll away with the content. Its far
        // edge is always `scrollOffset + clientSize <= scrollSize`, so it never
        // grows the scrollable region (no feedback with `scrollWidth/Height`).
        this._shadowOverlayStyle.setMany({
            width:     clientWidth  + "px",
            height:    clientHeight + "px",
            transform: `translate(${scrollLeft}px, ${scrollTop}px)`,
        });

        // `- 1` epsilon: some browsers report `scrollOffset + clientSize` a
        // sub-pixel short of `scrollSize` at the true extreme, which would
        // otherwise light a phantom trailing-edge fade.
        this.setShadowEdge("top",    "--ts-ss-top",    scrollTop  > 0);
        this.setShadowEdge("bottom", "--ts-ss-bottom", scrollTop  + clientHeight < scrollHeight - 1);
        this.setShadowEdge("left",   "--ts-ss-left",   scrollLeft > 0);
        this.setShadowEdge("right",  "--ts-ss-right",  scrollLeft + clientWidth  < scrollWidth  - 1);
    }

    /**
     * Toggles a single edge's fade by flipping its local custom property
     * between the theme shadow colour and unset (which falls back to
     * `transparent`). Skips the write when the edge state is unchanged so a
     * scroll that doesn't cross a threshold costs nothing here.
     *
     * @param edge - The edge whose cached state this updates.
     * @param property - The overlay custom property backing that edge's layer.
     * @param on - Whether the edge should currently show its fade.
     */
    private setShadowEdge(edge: keyof ScrollShadowEdges, property: string, on: boolean): void {
        if (this._shadowEdges[edge] === on) {
            return;
        }

        this._shadowEdges[edge] = on;
        this._shadowOverlayStyle.set(property, on ? "var(--ts-ui-scroll-shadow-color)" : null);
    }
}

const PanelCallable = callable(Panel);
type PanelCallable<TOptions extends PanelOptions = PanelOptions> = Panel<TOptions>;
export {
    Panel as _Panel,
    PanelCallable as Panel
};
