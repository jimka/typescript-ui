// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM, type Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { Animation } from "~/core/Animation.js";
import { Text } from "~/component/input/Text.js";

const TOOLTIP_ANIM_DURATION_MS: number = 100;

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

/** Internal record of a raw-element tooltip attachment. */
interface ElementTooltipAttachment {
    text       : string;
    mouseoverFn: (e: MouseEvent) => void;
    mousemoveFn: (e: MouseEvent) => void;
    mouseoutFn : () => void;
    showTimer  : ReturnType<typeof setTimeout> | null;
    lastX      : number;
    lastY      : number;
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
    private static elementAttachments: Map<Handle, ElementTooltipAttachment> = new Map();
    private static activeElement: Handle | null = null;

    // Set true while a fade-out is in flight; reset to false when the fade-out
    // completes (so the deferred removeElement fires) or when a fresh `show()`
    // re-displays the tooltip mid-fade (the deferred removeElement is then
    // skipped because the tooltip is back on screen).
    private static dismissing: boolean = false;

    private static readonly H_PADDING: number = 16;
    private static readonly V_PADDING: number = 8;
    private static readonly MAX_WIDTH: number = 300;
    private static readonly ITEM_HEIGHT: number = 20;
    private static readonly CURSOR_OFFSET: number = 14;

    private _text: Text;

    // Number of `\n`-separated lines in the text currently shown. Cached by
    // `show()` (which knows the raw string) and read by `doLayout()` (which
    // only sees the committed size) so the label's height tracks the line
    // count. 1 for a single-line tooltip — the unchanged legacy case.
    private _lineCount: number = 1;

    // Resolved per-line pixel height of the tooltip text, set by `show()` from
    // the live additive line box and read by `doLayout()`. Replaces the
    // fixed `ITEM_HEIGHT` multiplier, which over-allocated ~3px/line and left
    // a trailing empty line on multi-line tooltips.
    private _perLine: number = Tooltip.ITEM_HEIGHT;

    /** Private — use the static methods; only one instance is ever created. */
    private constructor() {
        super();

        this.setVisible(false);
        this.setZIndex(10001);
        this.setBackgroundColor("var(--ts-ui-tooltip-bg, rgb(255, 255, 240))");
        this.setForegroundColor("var(--ts-ui-tooltip-color, rgb(0, 0, 0))");
        this.setBorder({ border: "1px solid var(--ts-ui-tooltip-border, rgb(180, 180, 100))" });
        this.setShadow("var(--ts-ui-tooltip-shadow, 1px 2px 4px rgba(0, 0, 0, 0.2))");
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setPointerEvents("none");
        // Top-level overlay, dynamic size — layout+paint containment scopes reflow without
        // committing to a fixed size.
        this.setContain("layout paint");

        this._text = new Text();
        this._text.setPointerEvents("none");
        // `pre-wrap` preserves explicit `\n` breaks as real lines *and* wraps
        // a line that overflows the fixed width — `nowrap` would collapse the
        // breaks onto one line. A single-line tooltip narrower than MAX_WIDTH
        // renders identically to the old `nowrap` behaviour.
        this._text.setWhiteSpace("pre-wrap");
        this.addComponent(this._text);
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

        inst._text.setText(text);

        // Size width to the widest line and height to the line count so a
        // `\n`-containing string renders as a multi-line block. A string with
        // no `\n` yields a single line and the original single-line sizing.
        const lines      = text.split("\n");
        const widestLine = lines.reduce((max, line) => Math.max(max, Util.measureTextWidth(line)), 0);

        inst._perLine = inst._perLineHeight();

        // No minimum width — the tooltip hugs its content (widest line plus
        // horizontal padding), capped at MAX_WIDTH. A min-width floor would
        // pad short labels out to a fixed box wider than their text.
        const tooltipWidth  = Math.min(Tooltip.MAX_WIDTH, widestLine + Tooltip.H_PADDING);

        // When the widest line is wider than the cap, the label soft-wraps at the
        // available text width, so the visual line count exceeds the `\n`-split
        // count. Measure the wrapped height at that width and derive the real line
        // count; an uncapped tooltip never wraps, so the split count stands.
        if (widestLine + Tooltip.H_PADDING > Tooltip.MAX_WIDTH) {
            const availTextWidth = tooltipWidth - Tooltip.H_PADDING;
            const wrappedHeight  = DOM.source.measureText(text, { maxWidth: availTextWidth }).height;
            inst._lineCount      = Math.max(lines.length, Math.round(wrappedHeight / inst._perLine));
        } else {
            inst._lineCount = lines.length;
        }

        // Height hugs the text: one resolved line height per line plus padding.
        // Floor the single-line case to the legacy ITEM_HEIGHT box so plain
        // one-line tooltips stay pixel-stable; only multi-line tooltips switch
        // to the tighter per-line height that removes the trailing gap.
        let tooltipHeight = inst._lineCount * inst._perLine + Tooltip.V_PADDING;
        if (inst._lineCount === 1) {
            tooltipHeight = Math.max(tooltipHeight, Tooltip.ITEM_HEIGHT + Tooltip.V_PADDING);
        }

        inst.setWidth(tooltipWidth);
        inst.setHeight(tooltipHeight);

        const vp = DOM.source.getViewportSize();
        const clampedX = Math.min(x + Tooltip.CURSOR_OFFSET, vp.width - tooltipWidth);
        const clampedY = Math.min(y + Tooltip.CURSOR_OFFSET, vp.height - tooltipHeight);

        inst.setX(Math.max(0, clampedX));
        inst.setY(Math.max(0, clampedY));

        const el = inst.getElement(true)!;

        inst.scheduleLayout();

        DOM.sink.appendChild(DOM.source.getDocumentElement(), el);

        inst.setVisible(true);

        // Cancel a pending fade-out's removeElement so a fresh show during the
        // outgoing transition keeps the element in the DOM.
        Tooltip.dismissing = false;

        Animation.play(el, {
            from:       { opacity: "0" },
            to:         { opacity: "1" },
            durationMs: TOOLTIP_ANIM_DURATION_MS,
            properties: ["opacity"],
        });
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
        const el   = inst.getElement();

        if (!el) {
            return;
        }

        Tooltip.dismissing = true;

        Animation.play(el, {
            to:         { opacity: "0" },
            durationMs: TOOLTIP_ANIM_DURATION_MS,
            properties: ["opacity"],
            onComplete: () => {
                if (!Tooltip.dismissing) {
                    return;
                }
                Tooltip.dismissing = false;
                inst.setVisible(false);
                inst.removeElement();
            },
        });
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
        inst.setBorder({ border: `1px solid ${colors?.border ?? 'var(--ts-ui-tooltip-border, rgb(180, 180, 100))'}` });
    }

    /**
     * Wires native `mouseover`, `mousemove`, and `mouseout` listeners directly onto
     * a raw DOM element so the tooltip shows after a 500 ms hover delay.
     *
     * @remarks Use this instead of {@link attach} when the element contains child nodes
     * that would receive the event as `evnt.target` — the Event system's component
     * listener only matches the exact target id, so `attach` would miss those cases.
     *
     * Calling `attachToElement` on an element that already has an attachment
     * replaces it — the previous listeners are removed and a fresh set is
     * installed against the new text. If the tooltip is currently visible for
     * this element when the call happens, it re-renders immediately at the
     * last known cursor position so the visible text updates without a
     * re-hover.
     *
     * @param element - The element handle to attach hover behaviour to.
     * @param text - The tooltip text to display.
     */
    static attachToElement(element: Handle, text: string): void {
        const previous  = Tooltip.elementAttachments.get(element);
        const wasActive = Tooltip.activeElement === element;

        // Carry the previous binding's last cursor coords so the mid-hover
        // repaint below has real values instead of (0, 0) — detachElement
        // deletes the WeakMap entry, so the read has to happen first.
        const carryX = previous ? previous.lastX : 0;
        const carryY = previous ? previous.lastY : 0;

        Tooltip.detachElement(element);

        const att: ElementTooltipAttachment = {
            text,
            showTimer  : null,
            lastX      : carryX,
            lastY      : carryY,
            mouseoverFn: function onTooltipMouseOver(e: MouseEvent): void {
                if (att.showTimer !== null) {
                    return;
                }

                att.lastX = e.clientX;
                att.lastY = e.clientY;

                att.showTimer = setTimeout(function onTooltipShowTimer(): void {
                    Tooltip.activeElement = element;
                    Tooltip.show(att.text, att.lastX, att.lastY);
                    att.showTimer = null;
                }, 500);
            },
            mousemoveFn: function onTooltipMouseMove(e: MouseEvent): void {
                att.lastX = e.clientX;
                att.lastY = e.clientY;
            },
            mouseoutFn: function onTooltipMouseOut(): void {
                if (att.showTimer !== null) {
                    clearTimeout(att.showTimer);
                    att.showTimer = null;
                }

                if (Tooltip.activeElement === element) {
                    Tooltip.activeElement = null;
                }

                Tooltip.hide();
            },
        };

        DOM.sink.addListener(element, "mouseover", att.mouseoverFn);
        DOM.sink.addListener(element, "mousemove", att.mousemoveFn);
        DOM.sink.addListener(element, "mouseout",  att.mouseoutFn);

        Tooltip.elementAttachments.set(element, att);

        // Mid-hover update: if the previous attachment was the active tooltip
        // target, repaint the visible tooltip with the new text at the last
        // known cursor coords so the swap is seen without a re-hover.
        if (wasActive) {
            Tooltip.activeElement = element;
            Tooltip.show(text, att.lastX, att.lastY);
        }
    }

    /**
     * Removes an `attachToElement` binding installed on an element handle.
     *
     * Detaches the three hover listeners, cancels any pending show timer, and
     * clears the active-element tracker if it pointed at this element.
     * Idempotent — calling on an unattached element is a no-op.
     *
     * @param element - The element handle whose attachment should be removed.
     */
    static detachElement(element: Handle): void {
        const att = Tooltip.elementAttachments.get(element);

        if (!att) {
            return;
        }

        DOM.sink.removeListener(element, "mouseover", att.mouseoverFn);
        DOM.sink.removeListener(element, "mousemove", att.mousemoveFn);
        DOM.sink.removeListener(element, "mouseout",  att.mouseoutFn);

        if (att.showTimer !== null) {
            clearTimeout(att.showTimer);
            att.showTimer = null;
        }

        Tooltip.elementAttachments.delete(element);

        if (Tooltip.activeElement === element) {
            Tooltip.activeElement = null;
        }
    }

    /**
     * Resolves the tooltip text's rendered per-line height in pixels from the
     * live additive line box, measured at hover time. Matches the `_text` label
     * (a default `Text`: 14px font, theme leading) so the box hugs the text
     * vertically with no trailing gap, and tracks theme/font changes on the next
     * hover.
     *
     * @returns The per-line height in pixels, ceiled to a whole pixel.
     *
     * @remarks `measureTextMetrics` already defaults `lineHeight` to
     * `calc(1em + var(--ts-ui-line-padding, 2px))`, so the line box is left to
     * that default rather than passed explicitly.
     */
    private _perLineHeight(): number {
        const { height } = DOM.source.measureText("X");

        return Math.ceil(height);
    }

    /**
     * Positions the label to fill the tooltip body with uniform padding.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this._text.setX(Tooltip.H_PADDING / 2);
        this._text.setY(Tooltip.V_PADDING / 2);
        this._text.setWidth(Math.max(0, this.getWidth() - Tooltip.H_PADDING));
        this._text.setHeight(this._lineCount * this._perLine);

        return this;
    }
}
