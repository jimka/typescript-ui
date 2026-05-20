// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component";
import { Insets } from "~/primitive/Insets";
import { callable } from "~/core/Callable.js";

/**
 * Selects the per-axis scroll behaviour for a {@link Panel}.
 *
 * - `"none"` — never scroll; oversized children clip (the default).
 * - `"auto"` — scrollbars appear on either axis only when content overflows.
 * - `"x"`    — horizontal scrollbar on overflow; vertical overflow clips.
 * - `"y"`    — vertical scrollbar on overflow; horizontal overflow clips.
 * - `"both"` — both scrollbars are always shown (`overflow: scroll`).
 *
 * @remarks For every value except `"none"` the panel also sets
 * `scrollbar-gutter: stable` so an auto-appearing scrollbar does not reflow
 * its children. Browser support: Chromium 94+, Firefox 97+, Safari 18.2+.
 *
 * @category Core
 */
export type AutoScrollMode = "none" | "auto" | "x" | "y" | "both";

/**
 * Construction-time options for {@link Panel}.
 *
 * @remarks `insets` is inherited from {@link ComponentOptions} but defaults to
 * `(4, 4, 4, 4)` for `Panel` (Component itself defaults to zero insets). Pass
 * an explicit `insets` to override.
 *
 * @category Core
 */
export interface PanelOptions extends ComponentOptions {
    tag?:        string;

    /**
     * Construction-time shortcut for {@link Panel.setAutoScroll}. Defaults to
     * `"none"` (oversized children clip, matching the inherited `Component`
     * `overflow: hidden` behaviour).
     */
    autoScroll?: AutoScrollMode;
}

/**
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade in `Component`'s constructor dispatches `setInsets` once with the
 * final value, so a caller-supplied `insets` wins over the panel default.
 */
const _defaultPanelOptions: Partial<PanelOptions> = {
    insets: new Insets(4, 4, 4, 4)
};

/**
 * A [`Component`](/api/core/classes/Component) subclass that applies a default 4-pixel inset on all sides.
 *
 * Use `Panel` as the base class for grouped UI containers where children
 * should not sit flush against the outer edge. Plain [`Component`](/api/core/classes/Component) defaults
 * to zero insets to keep leaf widgets pixel-predictable; `Panel` opts into
 * the visual breathing room that grouped layouts typically want.
 *
 * `Panel` also exposes `setAutoScroll` to opt the container into native
 * browser scrolling when its children overflow the allocated rect.
 *
 * @category Core
 */
class Panel<TOptions extends PanelOptions = PanelOptions> extends Component<TOptions> {

    private _autoScroll: AutoScrollMode = "none";

    /**
     * Creates a panel with 4-pixel insets on all sides by default.
     *
     * @param options - Optional. Construction-time options applied to the panel.
     *   `options.tag` overrides the default `"div"` tag for subclasses that need
     *   a different element (e.g. `"header"`, `"section"`). `options.insets`
     *   overrides the default `(4, 4, 4, 4)` perimeter.
     */
    constructor(options?: TOptions) {
        super({
            ..._defaultPanelOptions,
            ...(options ?? {}),
            tag: options?.tag ?? "div",
        } as TOptions);
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

        if (options.autoScroll !== undefined) {
            this.setAutoScroll(options.autoScroll);
        }

        return this;
    }

    /**
     * Selects the panel's native scroll behaviour. Translates `mode` to
     * per-axis `overflow` writes via [`Component.setOverflowX`](/api/core/classes/Component#setoverflowx) /
     * [`Component.setOverflowY`](/api/core/classes/Component#setoverflowy) and sets `scrollbar-gutter: stable` for
     * every non-`"none"` mode so an auto-appearing scrollbar does not reflow
     * children.
     *
     * @param mode - The {@link AutoScrollMode} to apply.
     *
     * @returns This panel, for method chaining.
     *
     * @remarks Children render at their preferred size when `mode !== "none"`
     * — the panel no longer clips them to its allocated rect.
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

        this.setElementCSSRule("scrollbarGutter", mode === "none" ? null : "stable");

        return this;
    }

    /**
     * Returns the panel's current scroll mode.
     *
     * @returns The cached {@link AutoScrollMode}; `"none"` if never set.
     */
    getAutoScroll(): AutoScrollMode {
        return this._autoScroll;
    }

    /**
     * Resets the panel's scroll mode to `"none"`, restoring the inherited
     * `overflow: hidden` clipping behaviour and clearing `scrollbar-gutter`.
     *
     * @returns This panel, for method chaining.
     */
    clearAutoScroll(): this {
        return this.setAutoScroll("none");
    }
}

const PanelCallable = callable(Panel);
type PanelCallable<TOptions extends PanelOptions = PanelOptions> = Panel<TOptions>;
export {
    Panel as _Panel,
    PanelCallable as Panel
};
