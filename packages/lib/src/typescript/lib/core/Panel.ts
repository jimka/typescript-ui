// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Insets } from "~/primitive/Insets";
import { LayoutManager } from "~/layout/LayoutManager.js";
import { Event } from "~/core/Event.js";
import { InlineStyle, StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { scrollShadowBoxShadow, scrollShadowEdgeValue, scrollShadowRamp } from "~/core/ScrollShadow.js";
import { Scrollbar } from "~/component/container/Scrollbar.js";

/**
 * Per-edge shadow strength for a panel's scroll shadows, cached as a whole
 * percentage (0–100). The per-scroll update only rewrites a custom property
 * when an edge's quantised strength actually changes, so a scroll that doesn't
 * move the visible strength costs nothing here.
 */
type ScrollShadowEdges = { top: number; bottom: number; left: number; right: number };

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
class Panel<TOptions extends PanelOptions = PanelOptions> extends Container<TOptions> {

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

        // Re-size the scroll-shadow overlay against the just-committed geometry
        // before measuring: it is the only in-flow child, so a stale height left
        // over from the previous pass floors `scrollHeight` and fakes an overflow
        // on every pass that shrinks the panel. See `resizeScrollShadowOverlay`.
        this.resizeScrollShadowOverlay();
        this.measureScrollbarGutter();

        // Re-pin the overlay and recompute edge state against the freshly
        // committed geometry (content-size or scrollbar-gutter changes can
        // flip which edges overflow). The preceding `commitElementStyle`
        // guarantees the reads see this frame's dimensions.
        this.updateScrollShadows();

        this.scheduleGutterSettleOnShrink();

        return this;
    }

    /**
     * Forces one follow-up layout pass after this panel's content shrinks, so a
     * shrink that brings overflowing content back within the viewport re-clears
     * the reserved scrollbar gutter and scroll shadow.
     *
     * `measureScrollbarGutter` only reschedules a pass when the gutter *value*
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
     */
    protected destructor(): void {
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

        if (this._scrollbarStyle === "overlay") {
            this.layoutOverlayScrollbars();

            return;
        }

        const el = this.getElement();
        if (!el) {
            return;
        }

        const trackW = DOM.source.getScrollBarWidth();
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
            const axes    = this.scrollableAxes();
            const metrics = DOM.source.getScrollMetrics(el);

            vReserved = axes.y && metrics.scrollHeight > metrics.clientHeight;
            hReserved = axes.x && metrics.scrollWidth  > metrics.clientWidth;
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
     * presentational sheath (mirroring the clip/content frames) carrying four
     * blurred inset edge shadows, one per side. Each shadow's colour is a local
     * custom property defaulting to `transparent`, so the per-scroll path only
     * flips a property to light an edge rather than rebuilding the shadow.
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
            // Four blurred inset shadows — one per edge — each gated by a local
            // custom property defaulting to `transparent` (flipped to the theme
            // colour by `setShadowEdge`). See `scrollShadowBoxShadow`.
            boxShadow: scrollShadowBoxShadow(),
        });

        DOM.sink.appendChild(element, overlay);
        // Track the panel-owned overlay so a discarded panel releases it on GC
        // even if removeScrollShadows never runs; untracked there on eager removal.
        this.trackHandle(overlay);
        this._shadowOverlay = overlay;
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
     * `scrollHeight`. That makes its size load-bearing for
     * {@link Panel.measureScrollbarGutter}, not merely cosmetic: while it
     * carries the previous pass's height, a panel that just shrank reads
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
        if (!el || !this._shadowOverlay) {
            return;
        }

        const { clientWidth, clientHeight } = DOM.source.getScrollMetrics(el);

        // In overlay-scrollbar mode the native bar is hidden, so clientWidth /
        // clientHeight still span the strip the overlay Scrollbar paints on.
        // Inset the shadow overlay by the reserved overlay gutter so each edge
        // shadow lands just inside its bar — aligned with the content viewport
        // getInnerSize exposes — instead of bleeding under the translucent bar
        // track (which reads as the shadow painting on top of the scrollbar).
        // Native mode needs no inset: clientWidth / clientHeight already exclude
        // the OS scrollbar, so the gutter there is physical, not overlaid.
        const rightInset  = this._scrollbarStyle === "overlay" ? this._scrollbarGutter.right  : 0;
        const bottomInset = this._scrollbarStyle === "overlay" ? this._scrollbarGutter.bottom : 0;

        // Size the overlay to the viewport box; `position: sticky` keeps it
        // pinned there as the content scrolls, so no transform is needed.
        this._shadowOverlayStyle.setMany({
            width:  (clientWidth  - rightInset)  + "px",
            height: (clientHeight - bottomInset) + "px",
        });
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
        const { scrollTop, scrollLeft, scrollWidth, scrollHeight, clientWidth, clientHeight } =
            DOM.source.getScrollMetrics(this.getScrollElement() ?? el);

        this.resizeScrollShadowOverlay(el);

        const maxTop  = scrollHeight - clientHeight;
        const maxLeft = scrollWidth  - clientWidth;

        // Ramp an edge in by its distance past that extreme (see `scrollShadowRamp`).
        const ramp = scrollShadowRamp;

        // A shadow says "there is more content this way, scroll to reach it", so
        // only an axis the user can actually scroll may light its edges. A
        // clipped axis still reports overflow through `scrollWidth` /
        // `scrollHeight` — an `autoScroll: "y"` panel whose content is a few px
        // wider than its post-gutter width reads a non-zero `maxLeft` — and
        // ramping that would paint a right-edge fade promising content no
        // gesture can reveal.
        const axes = this.scrollableAxes();

        this.setShadowEdge("top",    "--ts-ss-top",    axes.y ? ramp(scrollTop)           : 0);
        this.setShadowEdge("bottom", "--ts-ss-bottom", axes.y ? ramp(maxTop  - scrollTop) : 0);
        this.setShadowEdge("left",   "--ts-ss-left",   axes.x ? ramp(scrollLeft)          : 0);
        this.setShadowEdge("right",  "--ts-ss-right",  axes.x ? ramp(maxLeft - scrollLeft): 0);
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
        const percent = Math.round(strength * 100);   // quantise: 0–1 → 0–100%

        if (this._shadowEdges[edge] === percent) {
            return;
        }

        this._shadowEdges[edge] = percent;
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
     * reserves the matching gutter — rescheduling a layout pass when it changed.
     * Called from `init` (first install) and from `measureScrollbarGutter`'s
     * overlay branch (every `doLayout` pass).
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
        const innerEl = this._overlayScrollElement;
        if (!panelEl || !innerEl || !this._scrollbarV || !this._scrollbarH) {
            return;
        }

        const trackW = this._scrollbarV.getTrackWidth();

        // Available viewport: the panel element's client box. The parent layout
        // sizes the panel element (and `doLayout` flushes it via
        // `commitElementStyle`) before this runs, so `avail` is always current —
        // it never lags a resize.
        const avail  = DOM.source.getScrollMetrics(panelEl);
        const availW = avail.clientWidth;
        const availH = avail.clientHeight;

        const curRight  = this._scrollbarGutter.right;
        const curBottom = this._scrollbarGutter.bottom;

        // Size the inner scroller to the CURRENT viewport (minus the currently
        // reserved gutter) BEFORE reading its metrics, so its `clientWidth`/
        // `clientHeight` — and thus `scrollWidth`/`scrollHeight`, which the
        // browser floors at the client box — reflect THIS frame's viewport. The
        // inner element otherwise carries the previous pass's size, which lags a
        // resize in BOTH directions: on expand the stale-small client box kept a
        // bar the widened viewport no longer needs; on shrink the stale-large
        // client box floored `scrollWidth` so content that now fits still read as
        // overflowing — each flickered a transient bar that could stick. A gutter
        // change below re-sizes and reschedules, converging in one extra pass.
        this._overlayScrollStyle.setMany({
            width:  (availW - curRight)  + "px",
            height: (availH - curBottom) + "px",
        });

        // Content extent, offsets, and the now-current inner client box.
        const m    = DOM.source.getScrollMetrics(innerEl);
        const axes = this.scrollableAxes();

        // A bar shows when content exceeds the inner scroller's (now current)
        // viewport. The V<->H dependency — reserving one bar shrinks the other's
        // viewport — settles across passes via the gutter-change reschedule
        // below, the same one-extra-pass convergence the gutter always used.
        const vVisible = axes.y && m.scrollHeight > m.clientHeight;
        const hVisible = axes.x && m.scrollWidth  > m.clientWidth;

        const innerW = availW - (vVisible ? trackW : 0);
        const innerH = availH - (hVisible ? trackW : 0);

        // Re-inset the inner scroller when this pass's gutter differs from the
        // one the pre-read sizing used, so overflowing content clips at the inner
        // viewport edge and can never scroll under a bar.
        if (innerW !== availW - curRight || innerH !== availH - curBottom) {
            this._overlayScrollStyle.setMany({ width: innerW + "px", height: innerH + "px" });
        }

        // Bars occupy the reserved band at the trailing edges, sized to the
        // inner extent so each stops short of the shared corner. setMetrics
        // takes the same reduced viewport (`innerH`/`innerW`) the visibility
        // test used, so a bar's shown/hidden state and the reserved gutter
        // never disagree.
        this._scrollbarV.setX(innerW);
        this._scrollbarV.setY(0);
        this._scrollbarV.setHeight(innerH);
        this._scrollbarV.setMetrics(innerH, m.scrollHeight, m.scrollTop);

        this._scrollbarH.setX(0);
        this._scrollbarH.setY(innerH);
        this._scrollbarH.setWidth(innerW);
        this._scrollbarH.setMetrics(innerW, m.scrollWidth, m.scrollLeft);

        const newRight  = vVisible ? trackW : 0;
        const newBottom = hVisible ? trackW : 0;

        if (newRight !== curRight || newBottom !== curBottom) {
            this.setScrollbarGutter(newRight, newBottom);
            this.scheduleLayout();
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
