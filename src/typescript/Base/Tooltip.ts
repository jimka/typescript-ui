// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";
import { Event } from "./Event.js";
import { Util } from "./Util.js";
import { BorderStyle } from "./BorderStyle.js";
import { Label } from "./component/Label.js";

/**
 * A singleton floating tooltip that appears near the cursor after a short delay.
 *
 * Use `Tooltip.attach(component, text)` to wire hover listeners onto any component.
 * For manual control use `Tooltip.show(text, x, y)` and `Tooltip.hide()` directly.
 *
 * @example
 * ```typescript
 * Tooltip.attach(myButton, 'Save the document');
 * ```
 */
export class Tooltip extends Component {

    private static instance: Tooltip | null = null;
    private static showTimer: ReturnType<typeof setTimeout> | null = null;

    /** Approximate character width in pixels for the 14 px system-ui font. */
    private static readonly CHAR_WIDTH: number = 7;
    private static readonly H_PADDING: number = 16;
    private static readonly V_PADDING: number = 8;
    private static readonly MIN_WIDTH: number = 80;
    private static readonly MAX_WIDTH: number = 300;
    private static readonly ITEM_HEIGHT: number = 20;
    private static readonly CURSOR_OFFSET: number = 14;

    private label: Label;

    /** Private — use the static methods; only one instance is ever created. */
    private constructor() {
        super();

        this.setVisible(false);
        this.setZIndex(10001);
        this.setBackgroundColor("var(--ts-ui-tooltip-bg, rgb(255, 255, 240))");
        this.setForegroundColor("var(--ts-ui-tooltip-color, rgb(0, 0, 0))");
        this.setBorder({
            style: BorderStyle.SOLID,
            width: 1,
            color: "var(--ts-ui-tooltip-border, rgb(180, 180, 100))",
        });
        this.setShadow("var(--ts-ui-tooltip-shadow, 1px 2px 4px rgba(0, 0, 0, 0.2))");
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setPointerEvents("none");

        this.label = new Label();
        this.label.setPointerEvents("none");
        this.label.setElementCSSRule("whiteSpace", "nowrap");
        this.addComponent(this.label);
    }

    /**
     * Returns the single shared `Tooltip` instance, creating it on first call.
     *
     * @returns The singleton `Tooltip` component.
     */
    private static getInstance(): Tooltip {
        if (!Tooltip.instance) {
            Tooltip.instance = new Tooltip();
        }

        return Tooltip.instance;
    }

    /**
     * Immediately shows the tooltip with the given text near the specified coordinates.
     *
     * @param text - The string to display inside the tooltip.
     * @param x - Horizontal viewport coordinate for the tooltip origin.
     * @param y - Vertical viewport coordinate for the tooltip origin.
     */
    static show(text: string, x: number, y: number): void {
        if (Tooltip.showTimer !== null) {
            clearTimeout(Tooltip.showTimer);
            Tooltip.showTimer = null;
        }

        const inst = Tooltip.getInstance();

        inst.label.setText(text);

        const tooltipWidth = Math.min(
            Tooltip.MAX_WIDTH,
            Math.max(Tooltip.MIN_WIDTH, text.length * Tooltip.CHAR_WIDTH + Tooltip.H_PADDING)
        );
        const tooltipHeight = Tooltip.ITEM_HEIGHT + Tooltip.V_PADDING;

        inst.setWidth(tooltipWidth);
        inst.setHeight(tooltipHeight);

        const vp = Util.getViewportSize();
        const clampedX = Math.min(x + Tooltip.CURSOR_OFFSET, vp.width - tooltipWidth);
        const clampedY = Math.min(y + Tooltip.CURSOR_OFFSET, vp.height - tooltipHeight);

        inst.setX(Math.max(0, clampedX));
        inst.setY(Math.max(0, clampedY));

        const el = inst.getElement(true);

        inst.doLayout();

        document.documentElement.appendChild(el);

        inst.setVisible(true);
    }

    /**
     * Hides and detaches the tooltip.
     *
     * Any pending show timer is also cancelled.
     */
    static hide(): void {
        if (Tooltip.showTimer !== null) {
            clearTimeout(Tooltip.showTimer);
            Tooltip.showTimer = null;
        }

        const inst = Tooltip.getInstance();

        inst.setVisible(false);
        inst.removeElement();
    }

    /**
     * Wires `mouseover` and `mouseout` listeners onto `component` so the tooltip
     * shows automatically after a 500 ms hover delay.
     *
     * @remarks Uses `mouseover`/`mouseout` rather than `mouseenter`/`mouseleave`
     * because the Event system routes through a window-level capture handler, and
     * the non-bubbling enter/leave events are not reliably seen there in Chrome.
     *
     * @param component - The component to attach hover behaviour to.
     * @param text - The tooltip text to display.
     */
    static attach(component: Component, text: string): void {
        let cursorX = 0;
        let cursorY = 0;

        Event.addListener(component, "mouseover", (e: MouseEvent) => {
            if (Tooltip.showTimer !== null) {
                return;
            }

            cursorX = e.clientX;
            cursorY = e.clientY;

            Tooltip.showTimer = setTimeout(() => {
                Tooltip.show(text, cursorX, cursorY);
                Tooltip.showTimer = null;
            }, 500);
        });

        Event.addListener(component, "mousemove", (e: MouseEvent) => {
            cursorX = e.clientX;
            cursorY = e.clientY;
        });

        Event.addListener(component, "mouseout", () => {
            Tooltip.hide();
        });
    }

    /**
     * Positions the label to fill the tooltip body with uniform padding.
     */
    doLayout(): void {
        super.doLayout();

        this.label.setX(Tooltip.H_PADDING / 2);
        this.label.setY(Tooltip.V_PADDING / 2);
        this.label.setWidth(Math.max(0, this.getWidth() - Tooltip.H_PADDING));
        this.label.setHeight(Tooltip.ITEM_HEIGHT);
    }
}
