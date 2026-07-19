// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { ThemeManager, ModernTheme } from "~/core/Theme.js";

/**
 * A {@link Component} that wraps the page's `<body>` element.
 *
 * Use the singleton accessor to add top-level components to the page:
 * ```
 * let body = Body.getInstance();
 * body.addComponent(....);
 * ```
 *
 * @category Core
 */
export class Body extends Component {

    private static readonly INSTANCE: Body = new Body();

    /**
     * Returns the singleton Body instance.
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
     * @param options - Component options to apply (layout manager, children, …).
     *
     * @returns The singleton Body instance, for chaining.
     */
    static init(options: ComponentOptions = {}): Body {
        this.INSTANCE.applyOptions(options);

        return this.INSTANCE;
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
