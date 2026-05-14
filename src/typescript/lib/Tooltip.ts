// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/Component.js";
import { Event } from "~/Event.js";
import { Util } from "~/Util.js";
import { BorderStyle } from "~/BorderStyle.js";
import { Text } from "~/component/Text.js";

/**
 * Optional color overrides for a tooltip attachment.
 *
 * When provided to {@link Tooltip.attach}, these replace the default theme variables
 * for the duration that the tooltip is shown for that component.
 *
 * @category Core
 */
export interface TooltipColors {
    /** CSS color for the tooltip background. */
    background?: string;
    /** CSS color for the tooltip text. */
    color?: string;
    /** CSS color for the tooltip border. */
    border?: string;
}

/** Internal record of a component's tooltip attachment. */
interface TooltipAttachment {
    text       : string;
    colors     : TooltipColors | undefined;
    mouseoverFn: Function;
    mousemoveFn: Function;
    mouseoutFn : Function;
}

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
 *
 * @category Core
 */
export class Tooltip extends Component {

    private static instance: Tooltip | null = null;
    private static showTimer: ReturnType<typeof setTimeout> | null = null;
    private static attachments: Map<string, TooltipAttachment> = new Map();

    private static readonly H_PADDING: number = 16;
    private static readonly V_PADDING: number = 8;
    private static readonly MIN_WIDTH: number = 80;
    private static readonly MAX_WIDTH: number = 300;
    private static readonly ITEM_HEIGHT: number = 20;
    private static readonly CURSOR_OFFSET: number = 14;

    private text: Text;

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
        // Top-level overlay, dynamic size — layout+paint containment scopes reflow without
        // committing to a fixed size.
        this.setElementCSSRule("contain", "layout paint");

        this.text = new Text();
        this.text.setPointerEvents("none");
        this.text.setElementCSSRule("whiteSpace", "nowrap");
        this.addComponent(this.text);
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

        inst.text.setText(text);

        const tooltipWidth = Math.min(
            Tooltip.MAX_WIDTH,
            Math.max(Tooltip.MIN_WIDTH, Util.measureTextWidth(text) + Tooltip.H_PADDING)
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

        inst.scheduleLayout();

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
     * If `colors` is provided the tooltip uses those colors instead of the default
     * theme variables while it is showing for this component.
     *
     * Calling `attach` on a component that already has an attachment replaces it.
     *
     * @param component - The component to attach hover behaviour to.
     * @param text - The tooltip text to display.
     * @param colors - Optional color overrides applied while this tooltip is visible.
     */
    static attach(component: Component, text: string, colors?: TooltipColors): void {
        Tooltip.detach(component);

        let cursorX = 0;
        let cursorY = 0;

        const mouseoverFn = (e: MouseEvent) => {
            if (Tooltip.showTimer !== null) {
                return;
            }

            cursorX = e.clientX;
            cursorY = e.clientY;

            Tooltip.showTimer = setTimeout(() => {
                Tooltip._applyColors(colors);
                Tooltip.show(text, cursorX, cursorY);
                Tooltip.showTimer = null;
            }, 500);
        };

        const mousemoveFn = (e: MouseEvent) => {
            cursorX = e.clientX;
            cursorY = e.clientY;
        };

        const mouseoutFn = () => {
            Tooltip.hide();
        };

        Event.addListener(component, "mouseover", mouseoverFn);
        Event.addListener(component, "mousemove", mousemoveFn);
        Event.addListener(component, "mouseout", mouseoutFn);

        Tooltip.attachments.set(component.getId(), {
            text, colors, mouseoverFn, mousemoveFn, mouseoutFn,
        });
    }

    /**
     * Removes the tooltip attachment from a component, cancelling any pending show
     * and hiding the tooltip if it is currently visible for this component.
     *
     * @param component - The component whose attachment should be removed.
     */
    static detach(component: Component): void {
        const id  = component.getId();
        const att = Tooltip.attachments.get(id);

        if (!att) {
            return;
        }

        Event.removeListener(component, "mouseover", att.mouseoverFn);
        Event.removeListener(component, "mousemove", att.mousemoveFn);
        Event.removeListener(component, "mouseout",  att.mouseoutFn);

        Tooltip.attachments.delete(id);
        Tooltip.hide();
    }

    /**
     * Applies optional color overrides to the singleton tooltip instance before it is shown.
     * Resets to the default theme variables when no overrides are provided.
     *
     * @param colors - The color overrides to apply, or `undefined` to use defaults.
     */
    private static _applyColors(colors?: TooltipColors): void {
        const inst = Tooltip.getInstance();

        inst.setBackgroundColor(
            colors?.background ?? 'var(--ts-ui-tooltip-bg, rgb(255, 255, 240))'
        );
        inst.setForegroundColor(
            colors?.color ?? 'var(--ts-ui-tooltip-color, rgb(0, 0, 0))'
        );
        inst.setBorder({
            style: BorderStyle.SOLID,
            width: 1,
            color: colors?.border ?? 'var(--ts-ui-tooltip-border, rgb(180, 180, 100))',
        });
    }

    /**
     * Wires native `mouseover`, `mousemove`, and `mouseout` listeners directly onto
     * a raw DOM element so the tooltip shows after a 500 ms hover delay.
     *
     * @remarks Use this instead of {@link attach} when the element contains child nodes
     * that would receive the event as `evnt.target` — the Event system's component
     * listener only matches the exact target id, so `attach` would miss those cases.
     *
     * @param element - The raw DOM element to attach hover behaviour to.
     * @param text - The tooltip text to display.
     */
    static attachToElement(element: HTMLElement, text: string): void {
        let cursorX = 0;
        let cursorY = 0;
        let showTimer: ReturnType<typeof setTimeout> | null = null;

        element.addEventListener('mouseover', (e: MouseEvent) => {
            if (showTimer !== null) {
                return;
            }

            cursorX = e.clientX;
            cursorY = e.clientY;

            showTimer = setTimeout(() => {
                Tooltip.show(text, cursorX, cursorY);
                showTimer = null;
            }, 500);
        });

        element.addEventListener('mousemove', (e: MouseEvent) => {
            cursorX = e.clientX;
            cursorY = e.clientY;
        });

        element.addEventListener('mouseout', () => {
            if (showTimer !== null) {
                clearTimeout(showTimer);
                showTimer = null;
            }

            Tooltip.hide();
        });
    }

    /**
     * Positions the label to fill the tooltip body with uniform padding.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this.text.setX(Tooltip.H_PADDING / 2);
        this.text.setY(Tooltip.V_PADDING / 2);
        this.text.setWidth(Math.max(0, this.getWidth() - Tooltip.H_PADDING));
        this.text.setHeight(Tooltip.ITEM_HEIGHT);

        return this;
    }
}
