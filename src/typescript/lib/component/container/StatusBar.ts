// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Panel, PanelOptions } from "~/core/Panel.js";
import { Text } from "~/component/input/Text.js";
import { HBox } from "~/layout/HBox.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import { Spacer } from "./Spacer";

/**
 * Fixed strip height for every `StatusBar` instance. Kept in lockstep with the
 * `--ts-ui-statusbar-height` token in [Theme.ts](/api/core/interfaces/Theme);
 * changing one without the other lets the bar grow taller than its chrome
 * background suggests.
 */
export const STATUS_BAR_HEIGHT: number = 22;

/**
 * Pixel width of the bar's top separator border. Hardcoded rather than
 * read from the theme because the value is part of the bar's box-model
 * arithmetic — it determines the inner content height
 * (`STATUS_BAR_HEIGHT - STATUS_BAR_BORDER_TOP_WIDTH`) that the message
 * text line-height must match for vertical centring. A theme that wanted
 * a thicker rule would have to bump `STATUS_BAR_HEIGHT` in lockstep.
 */
const STATUS_BAR_BORDER_TOP_WIDTH: number = 1;

/**
 * Construction-time options for {@link StatusBar}.
 *
 * @category Components
 */
export interface StatusBarOptions extends PanelOptions {
    /** Initial transient message shown in the left zone. */
    message?:        string;
    /**
     * Fallback message restored when a timed {@link StatusBar.setMessage}
     * call expires. Defaults to the empty string.
     */
    defaultMessage?: string;
}

/**
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade in [`Component`](/api/core/classes/Component)'s constructor
 * dispatches each present setter once with the final value. `message` and
 * `defaultMessage` are written pure to `_options` by `applyOptions` and
 * dispatched from the constructor body once the internal
 * [`Text`](/api/component/input/classes/Text) child exists.
 */
const _defaultStatusBarOptions: Partial<StatusBarOptions> = {
    insets: new Insets(0, 6, 0, 6),
};

/**
 * A thin horizontal strip mounted at the bottom of a window or panel that
 * surfaces a transient status message and small persistent indicators.
 *
 * `StatusBar` extends [`Panel`](/api/core/classes/Panel) and wraps an
 * [`HBox`](/api/layout/classes/HBox) layout split into three siblings: a left
 * zone holding the message [`Text`](/api/component/input/classes/Text) plus
 * any caller-added widgets, a flex-weighted spacer, and a right zone for
 * persistent indicators. Insert additional widgets via `addLeft` / `addRight`
 * — for example an [`IconText`](/api/component/display/classes/IconText) for
 * a connection light, a small [`ProgressBar`](/api/component/display/classes/ProgressBar),
 * or a [`ProgressSpinner`](/api/component/display/classes/ProgressSpinner).
 *
 * The strip is a single screen-reader live region (`role="status"`,
 * `aria-live="polite"`) so widget mutations inside either zone announce
 * politely without per-widget opt-in.
 *
 * @example
 * ```typescript
 * const sb = new StatusBar({ defaultMessage: "Ready" });
 * sb.setMessage("Saved", 2000);
 * container.addComponent(sb);
 * ```
 *
 * @category Components
 */
class StatusBar extends Panel<StatusBarOptions> {

    private _message:        string         = "";
    private _defaultMessage: string         = "";
    private _messageTimer:   number | null  = null;
    private _leftZone!:      Panel;
    private _rightZone!:     Panel;
    private _messageText!:   Text;

    /**
     * Constructs a `StatusBar` with optional initial message and default
     * message.
     *
     * @param options - Optional configuration bag. See {@link StatusBarOptions}
     *   for caller-overridable fields.
     */
    constructor(options?: StatusBarOptions) {
        super(options, _defaultStatusBarOptions);

        const outer = new HBox();
        outer.setComponentSpacing(0);
        outer.setStretching(true);
        this.setLayoutManager(outer);

        this.setBackgroundColor("var(--ts-ui-statusbar-bg, rgb(245, 245, 245))");
        this.setForegroundColor("var(--ts-ui-statusbar-color, rgb(60, 60, 60))");
        this.setBorder({
            top: {
                style: BorderStyle.SOLID,
                width: STATUS_BAR_BORDER_TOP_WIDTH,
                color: "var(--ts-ui-statusbar-border, rgb(220, 220, 220))",
            },
        });
        this.setMinSize(0,                       STATUS_BAR_HEIGHT);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, STATUS_BAR_HEIGHT);

        this._leftZone  = new Panel({ insets: new Insets(0, 0, 0, 0) });
        this._rightZone = new Panel({ insets: new Insets(0, 0, 0, 0) });

        const leftBox = new HBox();
        leftBox.setComponentSpacing(4);
        leftBox.setStretching(true);
        this._leftZone.setLayoutManager(leftBox);

        const rightBox = new HBox();
        rightBox.setComponentSpacing(4);
        rightBox.setStretching(true);
        this._rightZone.setLayoutManager(rightBox);

        this._messageText = new Text("");
        this._messageText.centerInHeight(STATUS_BAR_HEIGHT - STATUS_BAR_BORDER_TOP_WIDTH);
        this._leftZone.addComponent(this._messageText);

        this.addComponent(this._leftZone);
        this.addComponent(Spacer.flex());
        this.addComponent(this._rightZone);

        this.getAria().setRole("status");
        this.getAria().setLive("polite");

        if (this._options.defaultMessage !== undefined) {
            this._defaultMessage = this._options.defaultMessage;
        }
        if (this._options.message !== undefined) {
            this.setMessage(this._options.message);
        } else if (this._defaultMessage !== "") {
            this._message = this._defaultMessage;
            this._messageText.setText(this._defaultMessage);
        }
    }

    /**
     * Applies a {@link StatusBarOptions} bag. Inherited Panel fields cascade
     * through `super.applyOptions`; the `message` and `defaultMessage` fields
     * are written pure to `_options` here and dispatched from the constructor
     * body once the internal message [`Text`](/api/component/input/classes/Text)
     * exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: StatusBarOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as StatusBarOptions;

        if (opts.message        !== undefined) this._options.message        = opts.message;
        if (opts.defaultMessage !== undefined) this._options.defaultMessage = opts.defaultMessage;

        return this;
    }

    /**
     * Appends a component to the left zone, after the message
     * [`Text`](/api/component/input/classes/Text) and any previously-added
     * left widgets.
     *
     * @param component - The component to append. Widgets should be small —
     *   the bar height is fixed at {@link STATUS_BAR_HEIGHT}px.
     *
     * @returns This status bar, for method chaining.
     */
    addLeft(component: Component): this {
        this._leftZone.addComponent(component);

        return this;
    }

    /**
     * Appends a component to the right zone.
     *
     * @param component - The component to append. Widgets should be small —
     *   the bar height is fixed at {@link STATUS_BAR_HEIGHT}px.
     *
     * @returns This status bar, for method chaining.
     */
    addRight(component: Component): this {
        this._rightZone.addComponent(component);

        return this;
    }

    /**
     * Removes a component from the left zone. No-op if `component` is not a
     * left-zone child.
     *
     * @param component - The component to remove.
     *
     * @returns This status bar, for method chaining.
     */
    removeLeft(component: Component): this {
        this._leftZone.removeComponent(component);

        return this;
    }

    /**
     * Removes a component from the right zone. No-op if `component` is not a
     * right-zone child.
     *
     * @param component - The component to remove.
     *
     * @returns This status bar, for method chaining.
     */
    removeRight(component: Component): this {
        this._rightZone.removeComponent(component);

        return this;
    }

    /**
     * Replaces the visible status message. When `timeoutMs` is supplied, the
     * default message is restored after that delay. A subsequent
     * `setMessage` call cancels any pending revert.
     *
     * @param text - The new message string.
     * @param timeoutMs - Optional. Milliseconds before the default message
     *   is restored. Omit (or pass `0` / a negative value) for a persistent
     *   message.
     *
     * @returns This status bar, for method chaining.
     */
    setMessage(text: string, timeoutMs?: number): this {
        if (this._messageTimer !== null) {
            window.clearTimeout(this._messageTimer);
            this._messageTimer = null;
        }

        this._message = text;
        this._messageText.setText(text);

        if (timeoutMs !== undefined && timeoutMs > 0) {
            this._messageTimer = window.setTimeout(() => {
                this._messageTimer = null;
                this._message      = this._defaultMessage;
                this._messageText.setText(this._defaultMessage);
            }, timeoutMs);
        }

        return this;
    }

    /**
     * Returns the currently-visible message string.
     *
     * @returns The current message.
     */
    getMessage(): string {
        return this._message;
    }

    /**
     * Cancels any pending revert and reverts to the default message
     * immediately.
     *
     * @returns This status bar, for method chaining.
     */
    clearMessage(): this {
        return this.setMessage(this._defaultMessage);
    }

    /**
     * Sets the fallback message used when a timed {@link StatusBar.setMessage}
     * call expires. When no transient message is currently in flight (i.e.
     * no pending timer), the visible message is updated immediately so a
     * freshly configured `StatusBar` shows the new default.
     *
     * @param text - The new default message.
     *
     * @returns This status bar, for method chaining.
     */
    setDefaultMessage(text: string): this {
        this._defaultMessage = text;

        if (this._messageTimer === null) {
            this._message = text;
            this._messageText.setText(text);
        }

        return this;
    }

    /**
     * Returns the configured default message.
     *
     * @returns The current default message.
     */
    getDefaultMessage(): string {
        return this._defaultMessage;
    }

    /**
     * Clears any pending message-revert timer before the inherited
     * destructor detaches the element, preventing a stray `setTimeout`
     * callback from writing into a detached
     * [`Text`](/api/component/input/classes/Text).
     */
    protected destructor() {
        if (this._messageTimer !== null) {
            window.clearTimeout(this._messageTimer);
            this._messageTimer = null;
        }

        super.destructor();
    }
}

const StatusBarCallable = callable(StatusBar);
type StatusBarCallable = StatusBar;
export {
    StatusBar         as _StatusBar,
    StatusBarCallable as StatusBar,
};
