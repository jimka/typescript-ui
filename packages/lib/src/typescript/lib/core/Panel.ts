// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Component } from "~/core/Component.js";
import { Insets } from "~/primitive/Insets";
import { LayoutManager } from "~/layout/LayoutManager.js";
import { Event } from "~/core/Event.js";
import { InlineStyle, StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, ScrollMetrics } from "~/core/DOM.js";
import { FocusReveal } from "~/core/FocusReveal.js";
import type { FocusRevealer } from "~/core/FocusReveal.js";
import { appendScrollShadowStrips, scrollShadowEdgeValue, scrollShadowRamp, quantizeShadowEdge, ScrollShadowEdges } from "~/core/ScrollShadow.js";
import { Scrollbar } from "~/component/container/Scrollbar.js";

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
 * Selects how a scrolling {@link Panel} renders its scrollbar.
 *
 * - `"overlay"` — the default. Scrolling stays native (`overflow: auto`), the
 *   native scrollbar is hidden visually, and two custom `Scrollbar` widgets
 *   are overlaid at the trailing edges, synced to the element's native
 *   `scrollTop` / `scrollLeft`. Every native scroll behaviour (keyboard, find,
 *   focus-scroll, caret scroll, assistive tech) is preserved.
 * - `"native"` — the OS scrollbar renders as usual; the panel reserves the
 *   measured native gutter width instead of the fixed overlay track width.
 *
 * Ignored while `autoScroll === "none"` (a non-scrolling panel shows neither).
 *
 * @category Core
 */
export type ScrollbarStyle = "native" | "overlay";

/**
 * Construction-time options for {@link Panel}.
 *
 * @remarks `insets` is inherited from {@link ComponentOptions} but defaults to
 * `(4, 4, 4, 4)` for `Panel` (Component itself defaults to zero insets). Pass
 * an explicit `insets` to override.
 *
 * @category Core
 */
export interface PanelOptions extends ContainerOptions {
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

    /**
     * Selects the scrollbar rendering for an `autoScroll` panel. Defaults to
     * `"overlay"` — a scrolling panel hides its native bar and paints synced
     * overlay `Scrollbar` widgets instead. Pass `"native"` to opt out and keep
     * the OS scrollbar. Ignored while `autoScroll === "none"`.
     */
    scrollbarStyle?: ScrollbarStyle;

    /**
     * When `true`, the panel's default content insets are zero instead of the
     * usual `(4, 4, 4, 4)` — the rail-style default for a fixed-width strip
     * (activity rail, narrow Border/VBox region) that must sit flush against
     * its host and keep a constant width. Construction-time only; a
     * caller-supplied `insets` still wins. Defaults to `false`.
     */
    flush?: boolean;
}

/**
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade in `Component`'s constructor dispatches `setInsets` once with the
 * final value, so a caller-supplied `insets` wins over the panel default.
 */
const _defaultPanelOptions: Partial<PanelOptions> = {
    tag:            "div",
    insets:         new Insets(4, 4, 4, 4),
    autoScroll:     "none",
    scrollShadows:  true,
    scrollbarStyle: "overlay",
};

/**
 * Class applied to the raw inner scroll element of an overlay-mode panel. The
 * inner element has no `#id` (it is not a `Component`), so its native bar is
 * hidden through a shared class rule rather than the per-`#id`
 * `setElementCSSRule` path the panel element uses — the framework's module-level
 * shared class-rule pattern (as the focus-ring and `Component` class rules use).
 */
const OVERLAY_SCROLLER_CLASS = "PanelOverlayScroller";

// The shared inner-scroller class rules, retained once registered (mirrors the
// CollapseButton / header-glyph module-singleton pattern). The array doubles as
// the idempotency guard.
let _scrollerClassRules: StyleRule[] | null = null;

/**
 * Registers, once, the shared class rules that hide the native scrollbar on an
 * overlay panel's raw inner scroll element: `scrollbar-width: none` (Firefox /
 * Chromium >= 121) plus a `::-webkit-scrollbar { display: none }` selector rule
 * (WebKit / older Blink) — the two-write pair the panel element's
 * `setNativeScrollbarHidden` uses, expressed as a shared class instead of a
 * per-`#id` rule.
 */
function ensureOverlayScrollerClassRule(): void {
    if (_scrollerClassRules) {
        return;
    }

    _scrollerClassRules = [
        new StyleRule({
            scope:  "class",
            name:   OVERLAY_SCROLLER_CLASS,
            styles: { scrollbarWidth: "none" },
        }),
        new StyleRule({
            scope:  "selector",
            name:   `.${OVERLAY_SCROLLER_CLASS}::-webkit-scrollbar`,
            styles: { display: "none" },
        }),
    ];
}

/** Resolved from `measureOverlayLayout`'s one necessary write-then-read (see
 *  its own doc comment); `commitOverlayLayout` applies every write from it. */
interface OverlayLayoutResolution {
    innerW: number;
    innerH: number;
    /** The inner scroller's post-resize metrics — reused for the shadow-edge
     *  calc too, so nothing re-reads it. */
    m: ScrollMetrics;
    needsReinset: boolean;
    newRight: number;
    newBottom: number;
}

/**
 * A [`Container`](/api/core/classes/Container) subclass that applies a default 4-pixel inset on all sides.
 *
 * Use `Panel` as the base class for grouped UI containers where children
 * should not sit flush against the outer edge. A plain [`Container`](/api/core/classes/Container) fits
 * its parent's allocation with zero insets to keep structural regions
 * pixel-predictable; `Panel` opts into the visual breathing room that grouped
 * content layouts typically want.
 *
 * `Panel` also exposes `setAutoScroll` to opt the container into native
 * browser scrolling when its children overflow the allocated rect.
 *
 * Pass `flush: true` to opt a panel into zero default insets instead of the
 * 4px default, for rail-style fixed-width strips that must sit flush against
 * their host.
 *
 * @category Core
 */
class Panel<TOptions extends PanelOptions = PanelOptions> extends Container<TOptions> implements FocusRevealer {

    // `declare` rather than initialiser to dodge the class-field super-cascade
    // trap: a `= "none"` initialiser runs *after* super() returns, which
    // overwrites whatever `setAutoScroll(options.autoScroll)` had already
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
    declare private _shadowOverlay:       Handle | null;
    declare private _shadowScrollHandler: (() => void) | null;   // cached bound scroll handler — wired once
    // The overlay's four edge strips. Written by the same `setScrollShadows`
    // super-cascade dispatch as `_shadowOverlay` above, so it needs the same
    // `declare` + `applyOptions`-seed treatment for the same reason.
    declare private _shadowStrips: readonly Handle[];

    // Runtime-only: never touched during the super cascade (the overlay only
    // exists post-render), so a plain initialiser is safe here.
    private _shadowOverlayStyle: InlineStyle       = new InlineStyle();
    // Read during the super-time options cascade (setAutoScroll → doLayout →
    // scheduleGutterSettleOnShrink → showsScrollAffordance inspects the edges),
    // so `declare`d and seeded in `applyOptions` to dodge the class-field
    // super-cascade trap, exactly like `_scrollbarGutter`.
    declare private _shadowEdges: ScrollShadowEdges;
    // Child count observed on the previous layout pass, so a shrink (removed
    // children) can force one follow-up gutter/shadow re-measure. See
    // `scheduleGutterSettleOnShrink`.
    private _lastChildCount:     number            = 0;

    // Content preferred extent observed on the previous layout pass while a
    // scroll affordance was showing, so a shrink that happens inside a nested
    // descendant (whose removal leaves this panel's own child count unchanged)
    // still forces the follow-up re-measure. See `scheduleGutterSettleOnShrink`.
    // `declare`d + seeded in `applyOptions` for the same super-cascade reason.
    declare private _lastContentExtent: { width: number; height: number };

    // Overlay-scrollbar state. `_scrollbarStyle` is written by
    // `setScrollbarStyle` during the super-time options cascade, and
    // `_overlayScrollElement` / `_scrollbarV` / `_scrollbarH` / `_overlayScrollHandler`
    // are read (for the teardown guard) by the setter's install/refresh path
    // it triggers — so all five are `declare`d and seeded in `applyOptions`
    // for the same class-field super-cascade reason as the scroll-shadow
    // fields above.
    declare private _scrollbarStyle:       ScrollbarStyle;
    declare private _overlayScrollElement: Handle | null;            // raw inner scroll div (bars are its siblings)
    declare private _scrollbarV:           Scrollbar | null;
    declare private _scrollbarH:           Scrollbar | null;
    declare private _overlayScrollHandler: (() => void) | null;      // native "scroll" -> sync

    // Runtime-only: never touched during the super cascade (the inner scroll
    // element only exists post-render), so a plain initialiser is safe here —
    // mirrors `_shadowOverlayStyle`.
    private _overlayScrollStyle: InlineStyle = new InlineStyle();

    // Bound scroll-forwarders wired to each overlay Scrollbar's "scroll"
    // event. Named class fields (per ARCHITECTURE.md *Listeners must
    // reference a named function*) so they are stable, removable references.
    private _onOverlayScrollV = (position: number): void => { this.setScrollTop(position); };
    private _onOverlayScrollH = (position: number): void => { this.setScrollLeft(position); };

    // This panel's own committed width/height as of the last layout pass — the
    // baseline a live external resize (e.g. a Split gutter drag resizing this
    // panel) is detected against. -1 until the first pass, so the very first
    // doLayout() call always measures the scroll metrics live. `setAutoScroll`
    // (dispatched from `applyOptions`, below) can itself trigger a `doLayout()`
    // call from inside the `super()` cascade (via `LayoutManager.setOverflowing`),
    // so — like `_shadowEdges`/`_lastContentExtent` above — these five fields
    // are `declare`d and seeded in `applyOptions` rather than given plain
    // initialisers, which would silently revert whatever that cascade-time
    // pass wrote.
    declare private _lastPanelWidth:  number;
    declare private _lastPanelHeight: number;

    // Whether a pass withheld the post-layout scroll-metrics remeasure
    // (remeasureScrollMetrics) that is still owed once the current resize
    // burst settles.
    declare private _scrollMetricsOwed: boolean;

    // Whether a further width/height change landed after the settle frame was
    // armed.
    declare private _panelSizeMoved: boolean;

    // The afterNextLayout relay armed to end a resize burst, or null when none
    // is in flight.
    declare private _scrollMetricsSettleHandle: { cancel(): void } | null;

    /**
     * Creates a panel with 4-pixel insets on all sides by default.
     *
     * @param options - Optional. Construction-time options applied to the panel.
     *   `options.tag` overrides the default `"div"` tag for subclasses that need
     *   a different element (e.g. `"header"`, `"section"`). `options.insets`
     *   overrides the default `(4, 4, 4, 4)` perimeter. `options.flush` zeroes
     *   that default instead (a caller-supplied `insets` still wins).
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        // `flush` seeds a zero-inset default; a caller-supplied `insets` still
        // wins because Component.applyOptions dispatches setInsets only when
        // options.insets is defined, overriding whatever default we pick here.
        const flushDefault: Partial<TOptions> =
            options?.flush ? ({ insets: new Insets(0, 0, 0, 0) } as Partial<TOptions>) : {};

        super(
            options,
            { ..._defaultPanelOptions, ...(subclassDefaults ?? {}), ...flushDefault } as Partial<TOptions>,
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

        // Seed the scrollbar gutter cache before `setAutoScroll` — the latter
        // reads `_scrollbarGutter` to decide whether to clear it on a
        // `"none"` transition, and the `declare`d field would otherwise be
        // undefined at first dispatch.
        this.setScrollbarGutter(0, 0);

        // Seed the shadow-edge and content-extent caches for the same reason:
        // `setAutoScroll` below triggers a `doLayout` whose
        // `scheduleGutterSettleOnShrink` reads both, and their `declare`d fields
        // would otherwise be undefined during this super-time cascade.
        this._shadowEdges       = { top: 0, bottom: 0, left: 0, right: 0 };
        this._lastContentExtent = { width: 0, height: 0 };

        // Seed the resize-metrics settle-relay state for the same reason:
        // `setAutoScroll` below can itself trigger a `doLayout()` call from
        // inside this cascade (via `LayoutManager.setOverflowing`), whose
        // `deferScrollMetricsWhileResizing` reads all five of these
        // `declare`d fields — left undefined, `_scrollMetricsSettleHandle
        // === null` would read `false` (`undefined === null` is `false`),
        // sending that cascade-time pass down the wrong branch.
        this._lastPanelWidth            = -1;
        this._lastPanelHeight           = -1;
        this._scrollMetricsOwed         = false;
        this._panelSizeMoved            = false;
        this._scrollMetricsSettleHandle = null;

        // Always dispatch `setAutoScroll` — the fallback is the class
        // default from `_defaultPanelOptions`. Routing through the setter
        // (even for the default) keeps the `declare`d backing field
        // initialised and dodges the class-field super-cascade trap that
        // would bite a `= "none"` initialiser.
        this.setAutoScroll(options.autoScroll ?? this.getAutoScroll());

        // Seed the `declare`d overlay/handler fields before `setScrollShadows`
        // dispatches — the setter's teardown branch reads them, and the
        // `declare` leaves them `undefined` until first written.
        this._shadowOverlay        = null;
        this._shadowScrollHandler  = null;
        this._shadowStrips         = [];

        // Always dispatch so the backing field is seeded through the setter,
        // mirroring the `setAutoScroll` cascade above; the fallback is the
        // class default from `_defaultPanelOptions`.
        this.setScrollShadows(options.scrollShadows ?? this.getScrollShadows());

        // Seed the `declare`d overlay fields before `setScrollbarStyle`
        // dispatches — its refresh path (via `refreshOverlayScrollbars` ->
        // `removeOverlayScrollbars`) reads them, and the `declare` leaves
        // them `undefined` until first written.
        this._overlayScrollElement = null;
        this._scrollbarV           = null;
        this._scrollbarH           = null;
        this._overlayScrollHandler = null;

        // Always dispatch so the backing field is seeded through the setter,
        // mirroring the `setAutoScroll` / `setScrollShadows` cascades above;
        // the fallback is the class default from `_defaultPanelOptions`. Must
        // run after `setAutoScroll` — the install path this triggers reads
        // `_autoScroll`.
        this.setScrollbarStyle(options.scrollbarStyle ?? this.getScrollbarStyle());

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

        // Only a scrolling mode can ever need to reveal a target by scrolling
        // it into view; both calls are idempotent (backed by a `Set`).
        if (mode === "none") {
            FocusReveal.unregister(this);
        } else {
            FocusReveal.register(this);
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
        const axes = this.scrollableAxes();

        this.getLayoutManager()?.setOverflowing(axes.x, axes.y);

        // Re-evaluate the overlay scrollbar for the new mode FIRST: a transition
        // into `"none"` tears it (and the inner scroll element) down, a
        // transition into a scrolling mode installs it (when
        // `scrollbarStyle === "overlay"`). Must precede `refreshScrollShadows`
        // so `getScrollElement()` already resolves to the inner element when the
        // shadow refresh reads its scroll offsets. No-op before the element
        // exists (creation is deferred to `init`).
        this.refreshOverlayScrollbars();

        // Then re-evaluate the shadows for the new mode against the (now
        // correct) scroll element.
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
     * @returns The cached {@link AutoScrollMode}, or the class default when never set.
     */
    getAutoScroll(): AutoScrollMode {
        return this._autoScroll ?? this._defaultOptions.autoScroll!;
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
     * @returns The cached `scrollShadows` flag, or the class default when never set.
     */
    getScrollShadows(): boolean {
        return this._scrollShadows ?? this._defaultOptions.scrollShadows!;
    }

    /**
     * Selects the scrollbar rendering for this panel — the overlay default
     * (native scroll, hidden native bar, two synced `Scrollbar` widgets) or
     * `"native"` to keep the OS scrollbar. Installs or tears down the overlay
     * immediately when the element already exists; a no-op before render
     * beyond caching the value (the first install happens in `init`).
     *
     * @param style - The {@link ScrollbarStyle} to apply.
     *
     * @returns This panel, for method chaining.
     */
    setScrollbarStyle(style: ScrollbarStyle): this {
        this._scrollbarStyle = style;

        this.refreshOverlayScrollbars();

        // Re-home the shadow metric source: an overlay<->native toggle changes
        // which element `getScrollElement()` resolves to (inner element vs panel
        // element), so the shadows must re-read from the new scroller.
        this.refreshScrollShadows();

        return this;
    }

    /**
     * Returns the panel's current scrollbar style.
     *
     * @returns The cached {@link ScrollbarStyle}, or the class default when never set.
     */
    getScrollbarStyle(): ScrollbarStyle {
        return this._scrollbarStyle ?? this._defaultOptions.scrollbarStyle!;
    }

    /**
     * Routes every scroll read/write, the child host, and the content frame to
     * the inner scroll element while overlay mode is installed, and to the panel
     * element otherwise (native mode, `autoScroll: "none"`, pre-render). This is
     * the single seam that lets the overlay restructure move the actual scroller
     * inward without each scroll-plumbing call site knowing about it.
     *
     * @returns The inner scroll element in overlay mode, else the panel element.
     */
    protected getScrollElement(): Handle | undefined {
        return this._overlayScrollElement ?? this.getElement();
    }

    /** @inheritDoc */
    getRevealElement(): Handle | null {
        return this.getElement() ?? null;
    }

    /**
     * {@link FocusRevealer.revealDescendant}: scrolls `target` into view along
     * whichever axis it currently sits outside of, through the cached scroll
     * API — never the browser's native scroll-into-view method. Reads the
     * viewport rect through the panel's own scroll element rather than its
     * outer element, since under `scrollbarStyle: "overlay"` the panel's own
     * element never scrolls — the narrower inner overlay-scroll element does,
     * and reading the outer element's rect would treat the scrollbar gutter
     * band as already-visible and under-scroll a target sitting there.
     *
     * @param target - The element to scroll into view.
     */
    revealDescendant(target: Handle): void {
        const el = this.getScrollElement() ?? this.getElement();

        if (!el) {
            return;
        }

        const view = DOM.source.getElementRect(el);
        const rect = DOM.source.getElementRect(target);

        if (rect.top < view.top) {
            this.setScrollTop(this.getScrollTop() - (view.top - rect.top));
        } else if (rect.bottom > view.bottom) {
            this.setScrollTop(this.getScrollTop() + (rect.bottom - view.bottom));
        }

        if (rect.left < view.left) {
            this.setScrollLeft(this.getScrollLeft() - (view.left - rect.left));
        } else if (rect.right > view.right) {
            this.setScrollLeft(this.getScrollLeft() + (rect.right - view.right));
        }
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
     * While this panel's own committed width or height is still changing every
     * pass — a live external resize, e.g. a `Split` gutter drag resizing this
     * panel — the post-layout scroll-metrics remeasure (`remeasureScrollMetrics`:
     * the scroll-shadow overlay resize, the scrollbar gutter measurement, and
     * the scroll-shadow edge recompute) is withheld until a couple of quiet
     * frames confirm the resize has stopped moving. Children are unaffected:
     * they are already laid out against this frame's real size by
     * `super.doLayout()` above, before that decision runs.
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
        // report the previous frame's dimensions and `remeasureScrollMetrics`
        // wouldn't see the scrollbar transition.
        this.commitElementStyle();

        const width  = this.getWidth();
        const height = this.getHeight();
        const sizeChanged = width !== this._lastPanelWidth || height !== this._lastPanelHeight;

        if (sizeChanged) {
            this._lastPanelWidth  = width;
            this._lastPanelHeight = height;
        }

        if (!this.deferScrollMetricsWhileResizing(sizeChanged)) {
            this.remeasureScrollMetrics();
        } else if (this._scrollbarStyle === "overlay" && this._overlayScrollElement) {
            // The remeasure above is withheld, but the inner scroller's own
            // size must still track this panel's current committed size every
            // pass — unlike the gutter reservation or shadow strength, this is
            // a plain write against already-cached data, not a fresh
            // `getScrollMetrics` read, so writing it unconditionally costs
            // nothing the withholding exists to avoid. Skipping it would
            // otherwise leave the inner scroller — and the content it clips —
            // visibly stuck at its pre-burst size for the whole resize burst
            // (a `Split` gutter widening the panel would reveal a growing gap
            // between the frozen inner viewport and the live-resizing outer
            // border), rather than the single-frame staleness the gutter
            // reservation itself tolerates.
            //
            // `layoutOverlayScrollbars`'s own pre-read sizing write uses
            // `getScrollMetrics(panelEl).clientWidth/clientHeight` — the
            // border-box `width`/`height` above minus this panel's own
            // border, not minus nothing — so this must subtract the border
            // too, via the already-cached `getBorderSize()`, or a bordered
            // panel would jump by its border widths on every withheld frame
            // and back at settle. No new read either way: `getBorderSize()`
            // is measured once and cached until the border or theme changes.
            const border = this.getBorderSize();

            this._overlayScrollStyle.setMany({
                width:  (width  - border.left - border.right  - this._scrollbarGutter.right)  + "px",
                height: (height - border.top  - border.bottom - this._scrollbarGutter.bottom) + "px",
            });
        }

        this.scheduleGutterSettleOnShrink();

        return this;
    }

    /**
     * Decides whether this layout pass may withhold the post-layout scroll-metrics
     * remeasure — {@link remeasureScrollMetrics} — because a resize burst is in
     * flight, and arms (or extends) the settle pass that catches it up once the
     * burst goes quiet. Mirrors `Split.scheduleDrag`/`flushDrag` and `ScrollStrip`'s
     * own settle relay, which solve the same class of problem for a pane resize and a
     * tab strip's scroll resync respectively.
     *
     * @param sizeChanged - Whether this pass committed a different width or height
     *   than the previous pass did.
     *
     * @returns `true` when the caller must withhold this pass's remeasure.
     *
     * @remarks A panel with `autoScroll === "none"` never reaches a state where
     * withholding matters — none of the three helpers perform a live DOM read in
     * that mode — so this returns `false` immediately for one, without touching
     * any settle state. The same applies before this panel has ever rendered:
     * `Panel.applyOptions` dispatching a non-`"none"` `setAutoScroll` from
     * inside the `super()` cascade (via `LayoutManager.setOverflowing`) can
     * trigger a `doLayout()` call before `getElement()` resolves to anything —
     * a pass with no element yet has nothing for any of the three helpers to
     * measure (each already no-ops on a missing element or overlay), so
     * arming a settle frame for it would only outlive construction and
     * wrongly mark this panel's genuine first post-render pass as "mid-burst"
     * before it ever ran. Otherwise, whether a settle frame is already
     * armed — not `sizeChanged` — decides withholding: a pass with no settle
     * frame armed always remeasures live, while any pass that finds one
     * already armed withholds regardless of whether *this specific* pass's
     * size moved. The first size change of a burst is still always applied in
     * full, because the check that matters — "is a settle frame already
     * armed" — is false until this call arms one.
     */
    private deferScrollMetricsWhileResizing(sizeChanged: boolean): boolean {
        if (this._autoScroll === "none" || !this.getElement()) {
            return false;
        }

        if (this._scrollMetricsSettleHandle === null) {
            if (sizeChanged) {
                this.scheduleScrollMetricsSettle();
            }

            return false;
        }

        if (sizeChanged) {
            this._panelSizeMoved = true;
        }

        this._scrollMetricsOwed = true;

        return true;
    }

    /**
     * Arms the two-frame relay that ends a resize burst: a decoy
     * `Component.afterNextLayout` callback that does nothing but register a
     * second one on the *following* frame, which is what {@link
     * flushScrollMetricsSettle} runs from. Armed once and left alone while
     * further size changes arrive, matching `Split.scheduleDrag`.
     *
     * @remarks A single `afterNextLayout` call here is not enough. The owner
     * driving this panel's resize (e.g. `Split.flushDrag`, itself already
     * coalesced to one call per frame) calls `doLayout()` directly from its
     * own independently-scheduled `requestAnimationFrame`, registered by
     * whichever `mousemove` arrives after the previous frame finishes —
     * chronologically *after* this method's own registration for the same
     * upcoming frame, made synchronously inside the *current* frame's pass.
     * `afterNextLayout`'s ordering guarantee is scoped to `Component`'s own
     * coalesced flush and says nothing about `Split`'s separate registration,
     * so a single relay hop would still always fire and resolve *before* that
     * frame's real layout pass runs, making `_scrollMetricsSettleHandle` read
     * as `null` again just before the pass that needed to see it armed. Two
     * hops fixes this: the decoy, nested here, only relays the handle to a
     * second frame, costing nothing but keeping `_scrollMetricsSettleHandle`
     * continuously non-null across the boundary — a callback registered from
     * inside an `afterNextLayout` callback defers to the *following* frame
     * rather than running re-entrantly within the same drain
     * (`Component.afterNextLayout`'s own doc comment; confirmed by
     * `AfterNextLayout.test.ts`). {@link flushScrollMetricsSettle} then checks
     * `_panelSizeMoved`, set by any pass over the *prior* frame — an entirely
     * separate, already-completed frame batch — so it is never racing
     * anything by the time this one reads it.
     */
    private scheduleScrollMetricsSettle(): void {
        this._scrollMetricsSettleHandle = Component.afterNextLayout(() => {
            this._scrollMetricsSettleHandle = Component.afterNextLayout(() => this.flushScrollMetricsSettle());
        });
    }

    /**
     * The settle relay's second hop: ends a resize burst, or extends it by
     * another two-frame relay when this panel's size moved again during the
     * frame between the two hops. On the first quiet cycle it performs the
     * withheld remeasure — {@link remeasureScrollMetrics} — in the same order
     * `doLayout` itself uses.
     */
    private flushScrollMetricsSettle(): void {
        this._scrollMetricsSettleHandle = null;

        if (this._panelSizeMoved) {
            this._panelSizeMoved = false;
            this.scheduleScrollMetricsSettle();

            return;
        }

        if (!this._scrollMetricsOwed) {
            return;
        }

        this._scrollMetricsOwed = false;
        this.remeasureScrollMetrics();
    }

    /**
     * Forces one follow-up layout pass after this panel's content shrinks, so a
     * shrink that brings overflowing content back within the viewport re-clears
     * the reserved scrollbar gutter and scroll shadow.
     *
     * `remeasureScrollMetrics` only reschedules a pass when the gutter *value*
     * it reads changes. When content is removed, the overflow→fit transition
     * often has not settled on the pass that runs immediately after the
     * removal — the DOM `scrollHeight` still reads its old (overflowing) value,
     * so both the gutter and the shadow measure stale, see no change, and
     * schedule nothing; the stale gutter and shadow then linger until some later
     * unrelated layout (or a scroll event) re-measures. So this schedules one
     * more pass off a signal that *is* accurate at layout time — the content's
     * preferred extent, which drops synchronously when content is removed — and
     * the next frame re-measures against the settled content and clears anything
     * no longer needed.
     *
     * Two shrink signals are used. A direct-child-count drop is the cheap common
     * case. But content can also shrink inside a nested descendant (e.g. rows
     * removed from a grid several levels down), leaving this panel's own child
     * count unchanged; a drop in the panel's preferred extent catches that. The
     * preferred-extent read is gated behind an actually-showing scroll affordance
     * (a reserved gutter or a painted shadow edge) so it costs nothing on the
     * overwhelming majority of layouts, where there is nothing to settle.
     *
     * Bounded and non-looping: it fires only on the pass *after* a shrink (the
     * follow-up pass sees an unchanged count and extent), and never for a
     * `"none"` panel, which reserves no gutter and paints no shadow.
     */
    private scheduleGutterSettleOnShrink(): void {
        if (this._autoScroll === "none") {
            return;
        }

        const count       = this.getComponents().length;
        const childShrank  = count < this._lastChildCount;

        this._lastChildCount = count;

        // A shrink inside a nested descendant leaves `count` unchanged, so also
        // watch the preferred extent — but only while a scroll affordance is on
        // screen, since that is the only state a shrink could leave stale.
        let contentShrank = false;

        if (this.showsScrollAffordance()) {
            const preferred = this.getPreferredSize();
            const width     = preferred ? preferred.width  : 0;
            const height    = preferred ? preferred.height : 0;

            contentShrank = width < this._lastContentExtent.width
                         || height < this._lastContentExtent.height;

            this._lastContentExtent = { width, height };
        }

        if (childShrank || contentShrank) {
            this.scheduleLayout();
        }
    }

    /**
     * Whether this panel is currently painting a scroll affordance — a reserved
     * scrollbar gutter or any lit shadow edge. Used by
     * {@link Panel.scheduleGutterSettleOnShrink} to decide whether a shrink could
     * have left a stale gutter/shadow worth re-measuring.
     *
     * @returns `true` when a gutter is reserved or any shadow edge is lit.
     */
    private showsScrollAffordance(): boolean {
        return this._scrollbarGutter.right > 0
            || this._scrollbarGutter.bottom > 0
            || this._shadowEdges.top    > 0
            || this._shadowEdges.bottom > 0
            || this._shadowEdges.left   > 0
            || this._shadowEdges.right  > 0;
    }

    /**
     * Resizes the inner scroller to `avail` (the panel's own client box) minus
     * the currently-cached gutter, then reads the scroller's own post-resize
     * metrics. This read must follow that write: the scroller's `scrollWidth`/
     * `scrollHeight` are floored at its own `clientWidth`/`clientHeight`, so
     * reading them against the *previous* pass's box would report stale
     * overflow on a shrink. Returns null when the overlay scrollbars aren't
     * installed yet.
     *
     * @param avail - This panel's own client box for the current pass.
     * @returns The resolved overlay geometry, or `null` when the overlay
     *   scrollbars aren't installed.
     */
    private measureOverlayLayout(avail: ScrollMetrics): OverlayLayoutResolution | null {
        const innerEl = this._overlayScrollElement;
        if (!innerEl || !this._scrollbarV || !this._scrollbarH) {
            return null;
        }

        const trackW    = this._scrollbarV.getTrackWidth();
        const availW    = avail.clientWidth;
        const availH    = avail.clientHeight;
        const curRight  = this._scrollbarGutter.right;
        const curBottom = this._scrollbarGutter.bottom;

        this._overlayScrollStyle.setMany({
            width:  (availW - curRight)  + "px",
            height: (availH - curBottom) + "px",
        });

        const m    = DOM.source.getScrollMetrics(innerEl);
        const axes = this.scrollableAxes();

        const vVisible = axes.y && m.scrollHeight > m.clientHeight;
        const hVisible = axes.x && m.scrollWidth  > m.clientWidth;

        const innerW = availW - (vVisible ? trackW : 0);
        const innerH = availH - (hVisible ? trackW : 0);

        return {
            innerW, innerH, m,
            needsReinset: innerW !== availW - curRight || innerH !== availH - curBottom,
            newRight:  vVisible ? trackW : 0,
            newBottom: hVisible ? trackW : 0,
        };
    }

    /**
     * Applies every write {@link measureOverlayLayout} resolved. Pure writes —
     * no read.
     *
     * @param resolution - The resolved overlay geometry to commit.
     */
    private commitOverlayLayout(resolution: OverlayLayoutResolution): void {
        const { innerW, innerH, m, needsReinset, newRight, newBottom } = resolution;

        if (needsReinset) {
            this._overlayScrollStyle.setMany({ width: innerW + "px", height: innerH + "px" });
        }

        this._scrollbarV?.setX(innerW);
        this._scrollbarV?.setY(0);
        this._scrollbarV?.setHeight(innerH);
        this._scrollbarV?.setMetrics(innerH, m.scrollHeight, m.scrollTop);

        this._scrollbarH?.setX(0);
        this._scrollbarH?.setY(innerH);
        this._scrollbarH?.setWidth(innerW);
        this._scrollbarH?.setMetrics(innerW, m.scrollWidth, m.scrollLeft);

        this.commitScrollbarGutterIfChanged(newRight, newBottom);
    }

    /**
     * Pure calc: the native-mode gutter for the given (already-read) panel
     * metrics.
     *
     * @param metrics - This panel's own already-read scroll metrics.
     * @returns The right/bottom gutter the native scrollbar(s) reserve.
     */
    private resolveNativeGutter(metrics: ScrollMetrics): { right: number; bottom: number } {
        const trackW = DOM.source.getScrollBarWidth();
        if (trackW === 0) {
            return { right: this._scrollbarGutter.right, bottom: this._scrollbarGutter.bottom };
        }
        if (this._autoScroll === "both") {
            return { right: trackW, bottom: trackW };
        }
        const axes = this.scrollableAxes();
        return {
            right:  axes.y && metrics.scrollHeight > metrics.clientHeight ? trackW : 0,
            bottom: axes.x && metrics.scrollWidth  > metrics.clientWidth  ? trackW : 0,
        };
    }

    /**
     * Shared write, used by both the overlay and native gutter paths.
     *
     * @param right - The new right gutter, in pixels.
     * @param bottom - The new bottom gutter, in pixels.
     */
    private commitScrollbarGutterIfChanged(right: number, bottom: number): void {
        if (right === this._scrollbarGutter.right && bottom === this._scrollbarGutter.bottom) {
            return;
        }
        this.setScrollbarGutter(right, bottom);
        this.scheduleLayout();
    }

    /**
     * Pure calc: the shadow overlay's target size for the given panel client
     * box.
     *
     * @param clientWidth - The panel's current client width.
     * @param clientHeight - The panel's current client height.
     * @returns The overlay's target size, or `null` when no shadow overlay
     *   exists.
     */
    private resolveShadowOverlaySize(clientWidth: number, clientHeight: number): { width: number; height: number } | null {
        if (!this._shadowOverlay) {
            return null;
        }
        const rightInset  = this._scrollbarStyle === "overlay" ? this._scrollbarGutter.right  : 0;
        const bottomInset = this._scrollbarStyle === "overlay" ? this._scrollbarGutter.bottom : 0;
        return { width: clientWidth - rightInset, height: clientHeight - bottomInset };
    }

    /**
     * Pure write: applies the shadow overlay's resolved size.
     *
     * @param size - The size {@link resolveShadowOverlaySize} resolved.
     */
    private applyShadowOverlaySize(size: { width: number; height: number }): void {
        this._shadowOverlayStyle.setMany({ width: size.width + "px", height: size.height + "px" });
    }

    /**
     * Pure calc: the four edge strengths for the given (already-read) scroll
     * metrics.
     *
     * @param metrics - The already-read scroll metrics to ramp each edge from.
     * @returns The four edge strengths, or `null` when no shadow overlay
     *   exists.
     */
    private resolveShadowEdges(metrics: ScrollMetrics): { top: number; bottom: number; left: number; right: number } | null {
        if (!this._shadowOverlay) {
            return null;
        }
        const maxTop  = metrics.scrollHeight - metrics.clientHeight;
        const maxLeft = metrics.scrollWidth  - metrics.clientWidth;
        const axes    = this.scrollableAxes();
        return {
            top:    axes.y ? scrollShadowRamp(metrics.scrollTop)             : 0,
            bottom: axes.y ? scrollShadowRamp(maxTop  - metrics.scrollTop)   : 0,
            left:   axes.x ? scrollShadowRamp(metrics.scrollLeft)            : 0,
            right:  axes.x ? scrollShadowRamp(maxLeft - metrics.scrollLeft)  : 0,
        };
    }

    /**
     * Pure write: applies the four resolved edge strengths.
     *
     * @param edges - The edge strengths {@link resolveShadowEdges} resolved.
     */
    private applyShadowEdges(edges: { top: number; bottom: number; left: number; right: number }): void {
        this.setShadowEdge("top",    "--ts-ss-top",    edges.top);
        this.setShadowEdge("bottom", "--ts-ss-bottom", edges.bottom);
        this.setShadowEdge("left",   "--ts-ss-left",   edges.left);
        this.setShadowEdge("right",  "--ts-ss-right",  edges.right);
    }

    /**
     * The post-layout scroll-metrics remeasure, restructured into a read
     * phase and a write phase: this panel's own box is read once, every
     * derived value is resolved from it, and every write is applied in a
     * trailing pass. Two exceptions keep their own interleaved
     * read-after-write, because the read genuinely depends on the write's
     * effect: overlay mode's inner scroller (inside {@link
     * measureOverlayLayout}) and native mode's shadow overlay, handled inline
     * below — see the resize-settle uplift plan's Architecture Decisions for
     * why each one is unavoidable.
     */
    private remeasureScrollMetrics(): void {
        if (this._autoScroll === "none") {
            return;
        }

        const el = this.getElement();
        if (!el) {
            return;
        }

        const avail = DOM.source.getScrollMetrics(el);
        let shadowMetrics: ScrollMetrics = avail;

        if (this._scrollbarStyle === "overlay") {
            const resolution = this.measureOverlayLayout(avail);
            if (resolution) {
                this.commitOverlayLayout(resolution);
                shadowMetrics = resolution.m;
            }
        } else {
            // The shadow overlay is this panel's own in-flow child, so a
            // stale height floors this panel's own scrollHeight/scrollWidth
            // (see the plan's Architecture Decisions). Size it against the
            // current, stable client box first, and only re-read when that
            // write actually happened (no overlay installed means nothing to
            // floor).
            const preSize = this.resolveShadowOverlaySize(avail.clientWidth, avail.clientHeight);
            if (preSize) {
                this.applyShadowOverlaySize(preSize);
                shadowMetrics = DOM.source.getScrollMetrics(el);
            }

            const gutter = this.resolveNativeGutter(shadowMetrics);
            this.commitScrollbarGutterIfChanged(gutter.right, gutter.bottom);
        }

        // The gutter may have just changed; size the overlay against the
        // FINAL value. `avail.clientWidth/clientHeight` are still current —
        // nothing above wrote to this panel's own box.
        const finalSize = this.resolveShadowOverlaySize(avail.clientWidth, avail.clientHeight);
        if (finalSize) {
            this.applyShadowOverlaySize(finalSize);
        }

        const edges = this.resolveShadowEdges(shadowMetrics);
        if (edges) {
            this.applyShadowEdges(edges);
        }
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
    protected init(element?: Handle): this {
        super.init(element);

        // `getElement()` is still undefined inside `init` (the base assigns
        // `_element` only after `render` returns), so hand the resolved
        // element straight to the installer instead of re-reading it.
        const resolved = element ?? this.getElement();

        // Install the overlay scrollbars (which create the inner scroll element)
        // BEFORE the scroll shadows, so `getScrollElement()` already resolves to
        // the inner element when `updateScrollShadows` first reads its offsets.
        if (resolved && this._scrollbarStyle === "overlay" && this._autoScroll !== "none") {
            this.installOverlayScrollbars(resolved);
            this.layoutOverlayScrollbars(resolved);
        }

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
     *
     * A still-armed scroll-metrics settle frame is cancelled first, so it
     * never fires against a disposed panel.
     */
    protected destructor(): void {
        this._scrollMetricsSettleHandle?.cancel();
        this._scrollMetricsSettleHandle = null;

        FocusReveal.unregister(this);

        this.removeScrollShadows();
        this.removeOverlayScrollbars();

        super.destructor();
    }

    /**
     * Which axes the current `autoScroll` mode lets the user scroll along. The
     * single source of truth behind the layout manager's overflow flags, the
     * gutter measurement, and the shadow edges — all three must agree on what
     * "scrollable" means or the panel paints an affordance for an axis that
     * cannot move.
     *
     * @returns A flag per axis; `true` when that axis scrolls under the current mode.
     */
    private scrollableAxes(): { x: boolean; y: boolean } {
        const mode = this._autoScroll;

        return {
            x: mode === "x" || mode === "auto" || mode === "both",
            y: mode === "y" || mode === "auto" || mode === "both",
        };
    }

    /**
     * Caches the new gutter for each axis. Internal — driven by
     * `remeasureScrollMetrics` after a layout pass; consumers can't configure
     * this (it's derived from runtime DOM measurement, not a declarative
     * input), so it stays off the `PanelOptions` bag.
     *
     * @param right - Reserved gutter on the right edge in pixels.
     * @param bottom - Reserved gutter on the bottom edge in pixels.
     */
    private setScrollbarGutter(right: number, bottom: number): void {
        this._scrollbarGutter = { right, bottom };
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
    private installScrollShadows(element: Handle): void {
        if (!this._shadowOverlay) {
            this.createScrollShadowOverlay(element);
        }

        if (!this._shadowScrollHandler) {
            const handler = (): void => {
                this.updateScrollShadows();
            };

            this._shadowScrollHandler = handler;
            // Subtree, not exact-target: in overlay mode the scroll fires on the
            // id-less inner element, which only reaches the panel's id-keyed
            // listener bag by climbing the subtree. Native mode's scroll fires on
            // the panel element itself, which the subtree walk also matches.
            Event.addSubtreeListener(this, "scroll", handler);
        }
    }

    /**
     * Builds the non-interactive shadow overlay: an id-less, listener-free
     * presentational sheath (mirroring the clip/content frames) that hosts
     * four edge strips, one per side. Each strip carries one blurred inset
     * shadow layer gated by a local custom property on the host, defaulting to
     * `transparent`, so the per-scroll path only flips a property to light an
     * edge rather than rebuilding any shadow.
     *
     * @param element - The panel element the overlay is appended to.
     */
    private createScrollShadowOverlay(element: Handle): void {
        const overlay = DOM.sink.createElement("div");

        this._shadowOverlayStyle.attach(overlay);
        this._shadowOverlayStyle.setMany({
            // `sticky` pins the overlay to the scroll-port viewport on the
            // compositor: the browser keeps it at the `top: 0` / `left: 0`
            // edge as the content scrolls underneath, so it tracks the
            // viewport without any per-scroll JS write (no transform repin, no
            // main-thread flicker). It also does not extend the scrollable
            // region, since it stays inside the viewport box.
            position:      "sticky",
            left:          "0px",
            top:           "0px",
            pointerEvents: "none",
            // Paint above the content frame: `setContentFrame` re-appends that
            // frame as the element's last child during layout, so DOM order
            // alone would let it cover an overlay appended here at `init`.
            zIndex:        "1",
        });

        DOM.sink.appendChild(element, overlay);
        // Track the panel-owned overlay so a discarded panel releases it on GC
        // even if removeScrollShadows never runs; untracked there on eager removal.
        this.trackHandle(overlay);
        this._shadowOverlay = overlay;

        this._shadowStrips = appendScrollShadowStrips(overlay);

        for (const strip of this._shadowStrips) {
            this.trackHandle(strip);
        }
    }

    /**
     * Tears the overlay down and unwires the scroll listener, resetting the
     * cached edge state. Each step is guarded so this is safe to call before
     * the overlay was ever created (e.g. during the construction cascade).
     */
    private removeScrollShadows(): void {
        if (this._shadowScrollHandler) {
            Event.removeSubtreeListener(this, "scroll", this._shadowScrollHandler);
            this._shadowScrollHandler = null;
        }

        if (this._shadowOverlay) {
            for (const strip of this._shadowStrips) {
                DOM.sink.removeElement(strip);
                this.untrackHandle(strip);
                DOM.sink.release(strip);
            }

            this._shadowStrips = [];

            DOM.sink.removeElement(this._shadowOverlay);
            this.untrackHandle(this._shadowOverlay);
            DOM.sink.release(this._shadowOverlay);
            this._shadowOverlay = null;

            // The buffer was bound to the now-removed overlay; a fresh one is
            // needed for any future re-install (mirrors `disposeFrame`).
            this._shadowOverlayStyle = new InlineStyle();
        }

        this._shadowEdges = { top: 0, bottom: 0, left: 0, right: 0 };
    }

    /**
     * Re-asserts the shadow overlay's size against the live viewport box (a
     * no-op write unless it changed).
     *
     * The overlay is the panel's only in-flow child — every child *component*
     * is absolutely positioned — so its height alone floors the element's
     * `scrollHeight`. That makes its size load-bearing for {@link
     * Panel.remeasureScrollMetrics}, not merely cosmetic: while it carries
     * the previous pass's height, a panel that just shrank reads
     * `scrollHeight` (the stale, taller overlay) above `clientHeight` (the
     * freshly committed height) and reserves a scrollbar gutter for an overflow
     * that does not exist. Hence `doLayout` re-sizes the overlay *before* it
     * measures, which is what keeps the "stays inside the viewport box, so it
     * never extends the scrollable region" invariant true on the shrinking pass
     * as well as the settled one.
     *
     * @param element - Optional. The panel element; falls back to the rendered
     *   element. Passed explicitly from `init`, where `getElement` is not yet
     *   populated.
     */
    private resizeScrollShadowOverlay(element?: Handle): void {
        const el = element ?? this.getElement();

        if (!el) {
            return;
        }

        const { clientWidth, clientHeight } = DOM.source.getScrollMetrics(el);
        const size = this.resolveShadowOverlaySize(clientWidth, clientHeight);

        if (size) {
            this.applyShadowOverlaySize(size);
        }
    }

    /**
     * Sizes the overlay to the live viewport and recomputes each edge's shadow
     * strength from its distance to that extreme. `sticky` handles the
     * positioning, so the per-scroll path only re-asserts the viewport size (a
     * no-op write unless it changed) and rescales the edges — no positioning
     * work runs here.
     *
     * @param element - Optional. The panel element; falls back to the rendered
     *   element. Passed explicitly from `init`, where `getElement` is not yet
     *   populated.
     */
    private updateScrollShadows(element?: Handle): void {
        const el = element ?? this.getElement();

        if (!el || !this._shadowOverlay) {
            return;
        }

        // Read the scroll offsets and extents from the element that actually
        // scrolls — the inner scroller in overlay mode (the panel element's own
        // offsets are always 0 there), the panel element otherwise. The overlay
        // is still sized against, and pinned to, the panel element (`el`).
        const metrics = DOM.source.getScrollMetrics(this.getScrollElement() ?? el);

        this.resizeScrollShadowOverlay(el);

        const edges = this.resolveShadowEdges(metrics);

        if (edges) {
            this.applyShadowEdges(edges);
        }
    }

    /**
     * Sets a single edge's shadow strength by scaling the theme shadow colour
     * toward transparent. Strength is quantised to a whole percent so an
     * in-ramp scroll only repaints when the visible strength actually changes
     * (and never sub-pixel-thrashes); at zero the property is unset so the
     * `box-shadow` layer falls back to `transparent`.
     *
     * @param edge - The edge whose cached strength this updates.
     * @param property - The overlay custom property backing that edge's shadow.
     * @param strength - The target strength in the range 0–1.
     */
    private setShadowEdge(edge: keyof ScrollShadowEdges, property: string, strength: number): void {
        const percent = quantizeShadowEdge(this._shadowEdges, edge, strength);

        if (percent === null) {
            return;
        }

        this._shadowOverlayStyle.set(property, scrollShadowEdgeValue(percent));
    }

    /**
     * Brings the overlay scrollbar into the state implied by the current
     * `scrollbarStyle` / `autoScroll` settings: torn down when native or
     * non-scrolling, otherwise installed and laid out. No-op before the
     * element exists — `init` performs the first install once rendered.
     */
    private refreshOverlayScrollbars(): void {
        if (this._scrollbarStyle !== "overlay" || this._autoScroll === "none") {
            this.removeOverlayScrollbars();

            return;
        }

        const element = this.getElement();
        if (!element) {
            return;
        }

        this.installOverlayScrollbars(element);
        this.layoutOverlayScrollbars(element);
    }

    /**
     * Creates the inner scroll element (if absent), appends the two `Scrollbar`
     * widgets as its siblings on the panel element, and hides the native bar.
     * Idempotent: the element/bars/listener are each guarded by a `null` check,
     * so repeated calls neither stack duplicates nor re-hide an already-hidden
     * bar — but the inner element's per-axis overflow IS re-asserted on every
     * call so a runtime `setAutoScroll` mode-to-mode change (which keeps the
     * existing inner element) updates which axes scroll.
     *
     * @param element - The rendered panel element to append the inner scroller
     *   and bars into.
     */
    private installOverlayScrollbars(element: Handle): void {
        if (!this._overlayScrollElement) {
            // The native scroll happens on this inner element, physically inset
            // by the reserved track (see `layoutOverlayScrollbars`) so content
            // clips at the inner viewport edge and can never scroll under a bar.
            // The bars are its SIBLINGS on the panel element (below), outside
            // this element's overflow clip — the two-element structure
            // `VirtualScroller` uses. The panel element keeps its own
            // `overflow: auto` (inert: the inner element is absolute / out of
            // flow and always fits, so the panel element never scrolls).
            ensureOverlayScrollerClassRule();

            const inner = DOM.sink.createElement("div");

            // `width/height: 100%` fills the panel element's padding box (its
            // containing block, since every Component is positioned) so the
            // first overflow read sees the full viewport; `layoutOverlayScrollbars`
            // then overrides with the explicit post-gutter px size each pass.
            this._overlayScrollStyle.attach(inner);
            this._overlayScrollStyle.setMany({
                position:  "absolute",
                left:      "0px",
                top:       "0px",
                width:     "100%",
                height:    "100%",
            });

            // Hide the inner element's own native bar via the shared class rule
            // (it has no `#id`, so the panel element's per-`#id` path can't reach it).
            DOM.sink.apply(inner, { addClass: [OVERLAY_SCROLLER_CLASS] });
            DOM.sink.appendChild(element, inner);

            // Shift the existing children (or the active content frame) onto the
            // inner scroller, preserving the scroll offset across the host swap.
            this.reparentContent(element, inner);

            this.trackHandle(inner);
            this._overlayScrollElement = inner;
        }

        // Re-assert the inner element's per-axis overflow every call: on a
        // runtime `setAutoScroll` mode-to-mode change the inner element already
        // exists (no teardown), so the guard above is skipped — but the newly
        // scrollable axis must flip from `hidden` to `auto` (and vice versa) or
        // native wheel/keyboard scroll and the matching bar would be inert.
        const axes = this.scrollableAxes();
        this._overlayScrollStyle.setMany({
            overflowX: axes.x ? "auto" : "hidden",
            overflowY: axes.y ? "auto" : "hidden",
        });

        if (!this._scrollbarV) {
            this._scrollbarV = new Scrollbar("vertical");
            this._scrollbarV.setZIndex(2);   // above the shadow overlay's z-index: 1
            DOM.sink.appendChild(element, this._scrollbarV.getElement(true)!);
            this._scrollbarV.on("scroll", this._onOverlayScrollV);
        }

        if (!this._scrollbarH) {
            this._scrollbarH = new Scrollbar("horizontal");
            this._scrollbarH.setZIndex(2);
            DOM.sink.appendChild(element, this._scrollbarH.getElement(true)!);
            this._scrollbarH.on("scroll", this._onOverlayScrollH);
        }

        if (!this._overlayScrollHandler) {
            // Subtree, not exact-target: the inner scroll element is a raw,
            // id-less div, so its native "scroll" only reaches the panel's
            // id-keyed listener bag by climbing the subtree to the panel element
            // (the same mechanism the wheel listener uses). The handler reads
            // `getScrollElement()`, not the event target, so a nested
            // descendant's scroll only triggers a harmless re-read.
            const handler = (): void => {
                this.syncOverlayScrollbars();
            };

            this._overlayScrollHandler = handler;
            Event.addSubtreeListener(this, "scroll", handler);
        }

        this.setNativeScrollbarHidden(true);
    }

    /**
     * Tears the overlay scrollbar down: unwires the native scroll listener,
     * disposes both bars, re-parents content off the inner scroll host and
     * removes it, un-hides the native bar, and clears any reserved gutter.
     * Each step is guarded so this is safe to
     * call before the overlay was ever created (e.g. during the construction
     * cascade). Disposing (rather than only detaching) is required because
     * each bar is appended straight onto the panel element with a raw
     * `DOM.sink.appendChild` and held only in `_scrollbarV` / `_scrollbarH` —
     * never registered via `addComponent` — so `Component.destructor()`'s
     * child recursion can never reach it to reclaim its per-instance
     * stylesheet rule.
     */
    private removeOverlayScrollbars(): void {
        if (this._overlayScrollHandler) {
            Event.removeSubtreeListener(this, "scroll", this._overlayScrollHandler);
            this._overlayScrollHandler = null;
        }

        if (this._scrollbarV) {
            this._scrollbarV.off("scroll", this._onOverlayScrollV);
            this._scrollbarV.dispose();
            this._scrollbarV = null;
        }

        if (this._scrollbarH) {
            this._scrollbarH.off("scroll", this._onOverlayScrollH);
            this._scrollbarH.dispose();
            this._scrollbarH = null;
        }

        if (this._overlayScrollElement) {
            // Re-parent the children (or content frame) back onto the panel
            // element — which resumes scrolling in native mode — before the
            // inner element is destroyed, preserving the scroll offset.
            const element = this.getElement();

            if (element) {
                this.reparentContent(this._overlayScrollElement, element);
            }

            DOM.sink.removeElement(this._overlayScrollElement);
            this.untrackHandle(this._overlayScrollElement);
            DOM.sink.release(this._overlayScrollElement);
            this._overlayScrollElement = null;

            // The buffer was bound to the now-removed inner element; a fresh one
            // is needed for any future re-install (mirrors `_shadowOverlayStyle`
            // in `removeScrollShadows`).
            this._overlayScrollStyle = new InlineStyle();
        }

        this.setNativeScrollbarHidden(false);

        // Unconditional (rather than gated on the previous value, as
        // `setAutoScroll`'s native-path gutter-clear is): `setLayoutManager`
        // can re-enter this teardown from inside `Component.applyOptions`'s
        // own `layoutManager` option handling, before Panel's `applyOptions`
        // body has seeded `_scrollbarGutter` at all. The assignment itself is
        // a cheap plain-object write, so skipping the read-before-write
        // avoids that ordering hazard for free.
        this.setScrollbarGutter(0, 0);
    }

    /**
     * Hides or restores the native scrollbar through the framework's deferred
     * style seams — a `scrollbar-width: none` write on the component's own
     * `#id` rule (Firefox / Chromium >= 121) plus a `#id::-webkit-scrollbar {
     * display: none }` state rule (WebKit / older Blink).
     *
     * @param hidden - `true` to hide the native bar, `false` to restore it.
     */
    private setNativeScrollbarHidden(hidden: boolean): void {
        this.setElementCSSRule("scrollbarWidth", hidden ? "none" : null);
        this.createStyleRule("::-webkit-scrollbar").set("display", hidden ? "none" : null);
    }

    /**
     * Sizes the inner scroll element to the available viewport minus the track
     * on each axis whose perpendicular bar is visible, positions both bars in
     * the reserved band at the trailing edges, pushes their metrics, and
     * reserves the matching gutter — rescheduling a layout pass when it
     * changed. Called from `init` (first install) and other standalone
     * re-layout paths; the hot per-`doLayout`-pass path routes through
     * {@link measureOverlayLayout}/{@link commitOverlayLayout} via {@link
     * remeasureScrollMetrics} instead, which this method's own body now
     * delegates to as well.
     *
     * The dual read is the crux: the **available viewport** comes from the panel
     * element (which never scrolls, so its client box is the full viewport),
     * while content extent, offsets, and the current inner client box come from
     * the **inner scroll element**. Physically insetting the inner element is
     * what makes overflowing content clip before the bar band instead of
     * scrolling under it.
     *
     * @param element - Optional. The panel element; falls back to the rendered
     *   element. Passed explicitly from `init`, where `getElement` is not yet
     *   populated.
     */
    private layoutOverlayScrollbars(element?: Handle): void {
        const panelEl = element ?? this.getElement();

        if (!panelEl) {
            return;
        }

        const avail = DOM.source.getScrollMetrics(panelEl);
        const resolution = this.measureOverlayLayout(avail);

        if (resolution) {
            this.commitOverlayLayout(resolution);
        }
    }

    /**
     * Re-pushes metrics (thumb size/position only) to both overlay bars against
     * the inner scroller's live scroll offset. Called from the native `"scroll"`
     * handler — geometry (bar position/size, reserved gutter, inner element
     * size) changes only on layout, so this never repositions or resizes
     * anything and never schedules a layout.
     */
    private syncOverlayScrollbars(): void {
        const innerEl = this._overlayScrollElement;
        if (!innerEl || !this._scrollbarV || !this._scrollbarH) {
            return;
        }

        const m = DOM.source.getScrollMetrics(innerEl);

        this._scrollbarV.setMetrics(m.clientHeight, m.scrollHeight, m.scrollTop);
        this._scrollbarH.setMetrics(m.clientWidth,  m.scrollWidth,  m.scrollLeft);
    }
}

const PanelCallable = callable(Panel);
type PanelCallable<TOptions extends PanelOptions = PanelOptions> = Panel<TOptions>;
export {
    Panel as _Panel,
    PanelCallable as Panel
};
