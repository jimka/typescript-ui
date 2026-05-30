// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { Event } from "~/core/Event.js";
import { ThemeManager, DefaultTheme } from "~/core/Theme.js";

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

    private constructor() {
        super({ tag: "body" });

        this.init();

        this.setBackgroundColor("var(--ts-ui-body-bg, rgb(241, 241, 241))");

        ThemeManager.setTheme(DefaultTheme);
    }

    /**
     * Returns the document body element.
     *
     * @returns The `<body>` HTMLElement.
     */
    getElement() {
        return Util.select("body");
    }

    /**
     * Initializes the body size from the viewport and registers a resize listener to keep it in sync.
     *
     * @returns This component, for method chaining.
     */
    protected init(): this {
        super.init();

        this.setSize(Util.getViewportSize());
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
        this.setSize(Util.getViewportSize());
    };
}
