// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component";
import { Insets } from "~/primitive/Insets";
import { callable } from "~/core/Callable.js";

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
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade in `Component`'s constructor dispatches `setInsets` once with the
 * final value, so a caller-supplied `insets` wins over the panel default.
 */
const _defaultPanelOptions: Partial<PanelOptions> = {
    insets: new Insets(4, 4, 4, 4),
};

/**
 * A [`Component`](/api/core/classes/Component) subclass that applies a default 4-pixel inset on all sides.
 *
 * Use `Panel` as the base class for grouped UI containers where children
 * should not sit flush against the outer edge. Plain [`Component`](/api/core/classes/Component) defaults
 * to zero insets to keep leaf widgets pixel-predictable; `Panel` opts into
 * the visual breathing room that grouped layouts typically want.
 *
 * @category Core
 */
class Panel<TOptions extends PanelOptions = PanelOptions> extends Component<TOptions> {

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
}

const PanelCallable = callable(Panel);
type PanelCallable<TOptions extends PanelOptions = PanelOptions> = Panel<TOptions>;
export {
    Panel as _Panel,
    PanelCallable as Panel
};
