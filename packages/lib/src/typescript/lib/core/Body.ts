// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Favicon, DEFAULT_FAVICON } from "~/core/Favicon.js";
import { getAppResizeMode, setAppResizeMode } from "~/core/ResizeDrag.js";
import type { ResizeMode } from "~/core/ResizeDrag.js";
import { ThemeManager } from "~/core/Theme.js";
import { whenFontActivated } from "~/core/FontActivation.js";

/**
 * Options for the singleton {@link Body}.
 *
 * @category Core
 */
export interface BodyOptions extends Omit<ComponentOptions, "components"> {
    // `components` is omitted: the tree must be built after `init` resolves,
    // not passed to the call that starts the startup font wait.
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

    /**
     * The resize mode of every `Split`, resizable `Accordion` and window that
     * sets none of its own — including the ones a `Dock` builds. Defaults to
     * `"live"`. See {@link Body.setResizeMode}.
     */
    resizeMode?: ResizeMode;
}

/**
 * A {@link Component} that wraps the page's `<body>` element.
 *
 * Mount a top-level layout in one call, then build and add the tree once the
 * bootstrap resolves:
 * ```
 * const body = await Body.init({ layoutManager: Fit() });
 *
 * body.addComponent(shell);
 * ```
 *
 * Once mounted, reach the singleton again with `Body.getInstance()` — to add a
 * further child, read the layout manager, or attach a listener.
 * `getInstance()` does not wait for the font: call it only after `init` has
 * resolved, or where reaching an already-mounted body is genuinely all that is
 * needed.
 *
 * @category Core
 */
export class Body extends Component<BodyOptions> {

    private static instance: Body | null = null;

    /**
     * Returns the singleton Body instance, creating it on first call — the
     * accessor for reaching the body *after* it is mounted: adding a further
     * child, reading its layout manager, or attaching a listener. To mount a
     * top-level layout in one call, use `Body.init` instead.
     *
     * @returns The single shared Body component for this page.
     *
     * @remarks Does not wait for the startup web font — it hands back a usable
     * body immediately, even before `Body.init`'s promise has resolved. A tree
     * built from this accessor before then is measured against the browser's
     * fallback face; the `loadingdone` re-measure still corrects it afterwards.
     */
    static getInstance(): Body {
        if (!Body.instance) {
            Body.instance = new Body();
        }

        return Body.instance;
    }

    /**
     * Applies an options bag to the singleton Body and resolves with it — the
     * awaited startup bootstrap: `const body = await Body.init({ layoutManager:
     * Fit() })`. Only the supplied fields are dispatched (it delegates to
     * `Component.applyOptions`), so the body's viewport-size tracking and
     * theme set up at construction are preserved. Build and add the component
     * tree only after the returned promise resolves — see the class doc.
     *
     * Also installs the browser-tab icon, unless the page already declares a
     * `<link rel="icon">` of its own or `options.favicon` is `false`, and
     * suppresses the browser's native right-click menu page-wide, unless
     * `options.nativeContextMenu` is `true`. `options.resizeMode` sets the
     * app-wide gutter- and window-edge-drag mode at the same time.
     *
     * @param options - Component options to apply (layout manager, background,
     *   …); `components` is not a field — see {@link BodyOptions}.
     *
     * @returns A promise for the singleton Body instance, resolving once the
     *   active theme's web font is active or a bounded deadline expires. A
     *   later call, once one has already resolved, resolves immediately.
     *
     * @remarks Re-binds the style and attribute buffers to the current body
     * element before dispatching `options` — see
     * `Component.reattachElementBuffers`. The singleton is constructed on the
     * first `init` / `getInstance` call and then lives for the page, so this
     * only matters when the underlying DOM has been swapped since construction
     * (a test harness); it is a no-op rebind otherwise. Everything up to the
     * `await` runs synchronously on the calling tick, so a caller that does not
     * await the returned promise still gets its options applied immediately.
     */
    static async init(options: BodyOptions = {}): Promise<Body> {
        const instance = Body.getInstance();

        instance.reattachElementBuffers();
        instance.applyOptions(options);

        // The built-in default is dispatched here rather than from
        // applyOptions, which also runs during the singleton's construction on
        // first use — too early for a caller to have opted out, and before
        // a test harness has swapped the DOM seams.
        if (options.favicon === undefined) {
            instance.setFavicon(DEFAULT_FAVICON);
        }

        // Same reasoning as the favicon default above: dispatched here rather
        // than from applyOptions, which also runs during the singleton's
        // construction on first use — too early for a caller to have
        // opted out, and before a test harness has swapped the DOM seams.
        if (options.nativeContextMenu === undefined) {
            instance.setNativeContextMenu(false);
        }

        await whenFontActivated();

        return instance;
    }

    /** @inheritDoc */
    protected applyOptions(options: BodyOptions): this {
        super.applyOptions(options);

        if (options.favicon !== undefined) this.setFavicon(options.favicon);
        if (options.nativeContextMenu !== undefined) this.setNativeContextMenu(options.nativeContextMenu);
        if (options.resizeMode !== undefined) this.setResizeMode(options.resizeMode);

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

    /**
     * Sets the app-wide resize mode: how every `Split` gutter, resizable
     * `Accordion` gutter and window edge that sets no mode of its own shows a
     * drag. `"outline"` moves a thin outline to where the edge will land and
     * lays the content out once, on release; `"live"` (the default) lays it
     * out on every frame.
     *
     * @param mode - The app-wide mode; takes effect from the next drag.
     *
     * @returns This component, for method chaining.
     *
     * @remarks The value is page-wide rather than per-body state, so it is
     * held in the drag session module the layout managers already read at
     * drag start — reaching it through the `Body` singleton would construct
     * the whole page bootstrap from inside a layout manager.
     */
    setResizeMode(mode: ResizeMode): this {
        setAppResizeMode(mode);

        return this;
    }

    /**
     * Returns the app-wide resize mode.
     *
     * @returns `"live"` until {@link Body.setResizeMode} or `Body.init`'s
     *   `resizeMode` option changes it.
     */
    getResizeMode(): ResizeMode {
        return getAppResizeMode();
    }

    private constructor() {
        super({ tag: "body" });

        this.init();

        this.setBackgroundColor("var(--ts-ui-body-bg, rgb(241, 241, 241))");

        ThemeManager._applyDefaultTheme();
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
