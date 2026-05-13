// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "./Component";
import { Insets } from "./Insets";
import { callable } from "./Callable.js";

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
    tag?: string;
}

/**
 * A `Component` subclass that applies a default 4-pixel inset on all sides.
 *
 * Use `Panel` as the base class for grouped UI containers where children
 * should not sit flush against the outer edge. Plain `Component` defaults
 * to zero insets to keep leaf widgets pixel-predictable; `Panel` opts into
 * the visual breathing room that grouped layouts typically want.
 *
 * @category Core
 */
class Panel extends Component {

    /**
     * Creates a panel with 4-pixel insets on all sides by default.
     *
     * @param options - Optional. Construction-time options applied to the panel.
     *   `options.tag` overrides the default `"div"` tag for subclasses that need
     *   a different element (e.g. `"header"`, `"section"`). `options.insets`
     *   overrides the default `(4, 4, 4, 4)` perimeter.
     */
    constructor(options?: PanelOptions) {
        super({ tag: options?.tag ?? "div" });

        this.setInsets(options?.insets ?? new Insets(4, 4, 4, 4));

        if (this.constructor === Panel && options) {
            this.applyOptions(options);
        }
    }
}

const PanelCallable = callable(Panel);
type PanelCallable = Panel;
export {
    Panel as _Panel,
    PanelCallable as Panel
};
