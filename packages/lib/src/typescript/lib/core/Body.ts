// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Favicon, DEFAULT_FAVICON } from "~/core/Favicon.js";
import { ThemeManager, ModernTheme } from "~/core/Theme.js";

/**
 * Options for the singleton {@link Body}.
 *
 * @category Core
 */
export interface BodyOptions extends ComponentOptions {
    /**
     * Browser-tab icon. A URL or `data:` URI installs that icon; `false`
     * suppresses injection entirely. Omitted, the library's built-in mark is
     * used. In every case a `<link rel="icon">` already present in the page's
     * HTML wins and nothing is injected.
     */
    favicon?: string | false;

    /**
     * Whether the browser's own right-click menu is allowed. Defaults to
     * `false` — `Body.init` suppresses the native menu page-wide, so only
     * menus the library or the app opens on `contextmenu` ever appear.
     * `true` restores the browser's menu everywhere.
     */
    nativeContextMenu?: boolean;
}

/**
 * A {@link Component} that wraps the page's `<body>` element.
 *
 * Mount a top-level layout in one call:
 * ```
 * Body.init({ layoutManager: Fit(), components: [shell] });
 * ```
 *
 * Once mounted, reach the singleton again with `Body.getInstance()` — to add a
 * further child, read the layout manager, or attach a listener.
 *
 * @category Core
 */
export class Body extends Component<BodyOptions> {

    private static readonly INSTANCE: Body = new Body();

    /**
     * Returns the singleton Body instance — the accessor for reaching the body
     * *after* it is mounted: adding a further child, reading its layout
     * manager, or attaching a listener. To mount a top-level layout in one
     * call, use `Body.init` instead.
     *
     * @returns The single shared Body component for this page.
     */
    static getInstance() {
        return this.INSTANCE;
    }

    /**
     * Applies an options bag to the singleton Body and returns it — the
     * ergonomic entry point for mounting a top-level layout in one call:
     * `Body.init({ layoutManager: Fit(), components: [shell] })`. Only the
     * supplied fields are dispatched (it delegates to
     * `Component.applyOptions`), so the body's viewport-size tracking and
     * theme set up at construction are preserved.
     *
     * Also installs the browser-tab icon, unless the page already declares a
     * `<link rel="icon">` of its own or `options.favicon` is `false`, and
     * suppresses the browser's native right-click menu page-wide, unless
     * `options.nativeContextMenu` is `true`.
     *
     * @param options - Component options to apply (layout manager, children, …).
     *
     * @returns The singleton Body instance, for chaining.
     *
     * @remarks Re-binds the style and attribute buffers to the current body
     * element before dispatching `options` — see
     * `Component.reattachElementBuffers`. The singleton is constructed once
     * per page load, so this only matters when the underlying DOM has been
     * swapped since construction (a test harness); it is a no-op rebind
     * otherwise.
     */
    static init(options: BodyOptions = {}): Body {
        this.INSTANCE.reattachElementBuffers();
        this.INSTANCE.applyOptions(options);

        // The built-in default is dispatched here rather than from
        // applyOptions, which also runs during the singleton's construction at
        // module import — too early for a caller to have opted out, and before
        // a test harness has swapped the DOM seams.
        if (options.favicon === undefined) {
            this.INSTANCE.setFavicon(DEFAULT_FAVICON);
        }

        // Same reasoning as the favicon default above: dispatched here rather
        // than from applyOptions, which also runs during the singleton's
        // construction at module import — too early for a caller to have
        // opted out, and before a test harness has swapped the DOM seams.
        if (options.nativeContextMenu === undefined) {
            this.INSTANCE.setNativeContextMenu(false);
        }

        return this.INSTANCE;
    }

    /** @inheritDoc */
    protected applyOptions(options: BodyOptions): this {
        super.applyOptions(options);

        if (options.favicon !== undefined) this.setFavicon(options.favicon);
        if (options.nativeContextMenu !== undefined) this.setNativeContextMenu(options.nativeContextMenu);

        return this;
    }

    /**
     * Installs the browser-tab icon, or suppresses it.
     *
     * A `<link rel="icon">` the page's own HTML declares always wins, so this
     * writes nothing when one is present. `false` suppresses injection; it does
     * not remove an icon already installed.
     *
     * @param favicon - The icon URL or `data:` URI, or `false` for none.
     *
     * @returns This component, for method chaining.
     */
    setFavicon(favicon: string | false): this {
        this._options.favicon = favicon;

        if (favicon !== false) {
            Favicon.install(favicon);
        }

        return this;
    }

    /**
     * Returns the browser-tab icon this body was configured with.
     *
     * @returns The configured URL or `data:` URI, `false` when injection is
     *   suppressed, or the library's built-in mark when nothing was configured.
     */
    getFavicon(): string | false {
        return this._options.favicon ?? DEFAULT_FAVICON;
    }

    /**
     * Allows or suppresses the browser's native right-click menu page-wide.
     *
     * @param allowed - `true` lets the browser's own menu open on
     *   `contextmenu`; `false` suppresses it everywhere.
     *
     * @returns This component, for method chaining.
     */
    setNativeContextMenu(allowed: boolean): this {
        // The listener is registered exactly when the option reads `false`;
        // `undefined` means "not configured yet", so nothing is registered.
        const listening = this._options.nativeContextMenu === false;

        this._options.nativeContextMenu = allowed;

        if (!allowed && !listening) {
            Event.addViewportListener(this, "contextmenu", this.onContextMenu);
        } else if (allowed && listening) {
            Event.removeViewportListener(this, "contextmenu", this.onContextMenu);
        }

        return this;
    }

    /**
     * Returns whether the browser's native right-click menu is allowed.
     *
     * @returns `true` when the native menu is allowed, `false` when it is
     *   suppressed (the default).
     */
    getNativeContextMenu(): boolean {
        return this._options.nativeContextMenu ?? false;
    }

    private constructor() {
        super({ tag: "body" });

        this.init();

        this.setBackgroundColor("var(--ts-ui-body-bg, rgb(241, 241, 241))");

        ThemeManager.setTheme(ModernTheme);
    }

    /**
     * Returns the document body element.
     *
     * @returns The `<body>` HTMLElement.
     */
    getElement() {
        return DOM.source.getBody();
    }

    /**
     * Initializes the body size from the viewport and registers a resize listener to keep it in sync.
     *
     * @returns This component, for method chaining.
     */
    protected init(): this {
        super.init();

        this.setSize(DOM.source.getViewportSize());
        this.clearInsets();

        Event.addViewportListener(this, "resize", this._onViewportResize);
        this.subscribeTheme(this._onThemeReflow);

        return this;
    }

    /**
     * Bound viewport-resize handler. Reads the current viewport extent on
     * each fire (DOM `resize` events carry no payload) and writes it
     * through the typed setter.
     */
    private _onViewportResize = (): void => {
        this.setSize(DOM.source.getViewportSize());
    };

    /**
     * Viewport `contextmenu` handler registered by {@link setNativeContextMenu}
     * while the native menu is suppressed. Returns a disposition rather than
     * calling `preventDefault()` itself, and deliberately never returns a stop
     * disposition: a `contextmenu` event is also routed to any component's
     * own handler (e.g. `Tree`, `DiagramView`) through `Event`'s other
     * window-capture listener, and this handler must not cut that walk short.
     * A plain prototype method, not an arrow field, so it exists before the
     * constructor runs and has a stable identity `removeViewportListener` can
     * find (see `Markdown.handleViewportChange` for the same reasoning).
     *
     * @returns `{ prevent: true }`, suppressing the browser's own menu.
     */
    private onContextMenu(): Event.ListenerResult {
        return { prevent: true };
    }

    /**
     * Bound theme-change handler. Schedules a layout pass so every `Text` in
     * the page re-measures lazily against the new theme's metrics — replaces
     * the per-`Text` theme subscription this component's children used to
     * hold individually.
     */
    private _onThemeReflow = (): void => {
        this.scheduleLayout();
    };

    /**
     * Overrides {@link Component.clampsToContentSize} to `false`: the body *is*
     * the viewport, so its size must track {@link Util.getViewportSize} exactly
     * and let oversized content overflow (the page scrolls / a child `Panel`
     * scrolls internally) rather than inflating the body up to its
     * content-derived minimum. With the `Component` default (`true`),
     * {@link Component.setSize} ran the viewport extent through
     * {@link Component.clampHeight}, which floored it to `getMinSize()` — the
     * tall content's minimum — so once that minimum was measured the body could
     * never shrink back below its content when the viewport shrank.
     *
     * @returns `false`, so size clamping uses the body's own explicit
     *   constraints only, not its content-derived ones.
     */
    protected clampsToContentSize(): boolean {
        return false;
    }
}
