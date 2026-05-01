// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";
import { Util } from "./Util.js";
import { Event } from "./Event.js";
import { Size } from "./Size.js";
import { ThemeManager, DefaultTheme } from "./Theme.js";

/**
 * A {@link Component} that wraps the page's `<body>` element.
 *
 * Use the singleton accessor to add top-level components to the page:
 * ```
 * let body = Body.getInstance();
 * body.addComponent(....);
 * ```
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
        super("body");

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
     */
    protected init() {
        super.init();

        let viewportSize = Util.getViewportSize();

        let me = this;
        this.setSize(viewportSize);

        Event.addViewportResizeListener(function (size: Size) {
            me.setSize(size);
        });
    }
}