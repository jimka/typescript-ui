// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Orientation of a {@link ToolBarSeparator}. `"vertical"` (the default) draws a
 * thin vertical rule suitable for a horizontal toolbar; `"horizontal"` draws a
 * thin horizontal rule suitable for a vertical toolbar.
 *
 * @category Components
 */
export type ToolBarSeparatorOrientation = "vertical" | "horizontal";

/**
 * Construction-time options for {@link ToolBarSeparator}.
 *
 * @category Components
 */
export interface ToolBarSeparatorOptions extends ComponentOptions {
    orientation?: ToolBarSeparatorOrientation;
}

/**
 * Empty subclass-default const so the super call follows the framework's
 * `(options, defaults)` shape uniformly.
 */
const _defaultToolBarSeparatorOptions: Partial<ToolBarSeparatorOptions> = {};

/**
 * A thin divider rule used inside a [`ToolBar`](/api/component/menubar/classes/ToolBar) to visually group
 * related controls. Defaults to a vertical rule (for horizontal toolbars);
 * pass `orientation: "horizontal"` for a vertical toolbar.
 *
 * Renders as a single bordered DOM element. The rule colour is theme-driven
 * via `--ts-ui-toolbar-separator-color`. Separators report `role="separator"`
 * with a matching `aria-orientation`, and stay out of the keyboard tab order.
 *
 * @example
 * ```typescript
 * import { ToolBar, ToolBarSeparator } from '@jimka/typescript-ui/component/menubar';
 * const bar = new ToolBar();
 * bar.addComponent(new ToolBarSeparator());
 * ```
 *
 * @category Components
 */
class ToolBarSeparator extends Component<ToolBarSeparatorOptions> {

    /**
     * Pixel thickness of the rendered rule — a 1-pixel hairline. The breathing
     * room on either side of the rule comes from the parent toolbar's HBox /
     * VBox `componentSpacing` (theme token `--ts-ui-toolbar-gap`, default 4 px),
     * so the separator itself only carries the line. A wider THICKNESS would
     * stack on top of the parent's spacing and produce an asymmetric gap.
     */
    static readonly THICKNESS: number = 1;

    private readonly _orientation: ToolBarSeparatorOrientation;

    /**
     * Constructs a `ToolBarSeparator`.
     *
     * @param options - Optional construction-time options. `options.orientation`
     *   selects the rule direction; defaults to `"vertical"`.
     */
    constructor(options?: ToolBarSeparatorOptions) {
        super(options, _defaultToolBarSeparatorOptions);

        this._orientation = options?.orientation ?? "vertical";

        if (this._orientation === "vertical") {
            // preferredSize.height = 0 keeps the separator out of the parent
            // HBox's row-height computation. The rendered height comes from
            // the parent's stretching=true branch, clamped to maxSize.height
            // (MAX_VALUE → containerSize.height). preferredSize.width = THICKNESS
            // makes the toolbar's own preferred width count the separator.
            this.setPreferredSize(ToolBarSeparator.THICKNESS, 0);
            this.setMaxSize(ToolBarSeparator.THICKNESS, Number.MAX_VALUE);
        } else {
            this.setPreferredSize(0, ToolBarSeparator.THICKNESS);
            this.setMaxSize(Number.MAX_VALUE, ToolBarSeparator.THICKNESS);
        }

        // The element IS the rule — a 1 px line filled with the theme colour.
        this.setBackgroundColor("var(--ts-ui-toolbar-separator-color, rgb(220, 220, 220))");

        this.getAria().setRole("separator");
        this.getAria().setOrientation(this._orientation);
        this.getAria().setTabIndex(-1);
    }

    /**
     * Returns the orientation passed at construction time.
     *
     * @returns The `ToolBarSeparator` orientation — `"vertical"` or `"horizontal"`.
     */
    getOrientation(): ToolBarSeparatorOrientation {
        return this._orientation;
    }
}

const ToolBarSeparatorCallable = callable(ToolBarSeparator);
type ToolBarSeparatorCallable = ToolBarSeparator;
export {
    ToolBarSeparator         as _ToolBarSeparator,
    ToolBarSeparatorCallable as ToolBarSeparator
};
