// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Container}.
 *
 * Adds no fields over {@link ComponentOptions}; declared as a named extension
 * point so structural containers have a stable options type and so
 * {@link Panel}'s `PanelOptions` can extend it.
 *
 * @category Core
 */
export interface ContainerOptions extends ComponentOptions {}

/**
 * A fit-parent {@link Component}: a container that fills the rect its parent's
 * layout manager allocates instead of shrinking to its content's size.
 *
 * `Component` already owns the container machinery — a layout manager, children,
 * insets, a child host. `Container`'s sole contribution is flipping the size
 * policy: it overrides `clampsToContentSize` to `false`, so its width and
 * height accept whatever the parent allocates and oversized content overflows
 * (clipped) rather than inflating the box back up to its content-derived
 * minimum. It keeps `Component`'s **zero** default insets and adds no scrolling.
 *
 * Use `Container` for structural regions that must fill their slot — a dock
 * `Split`/`Tab` region, an identity frame — without the perimeter padding or
 * native scrolling a content surface wants. For those, use
 * [`Panel`](/api/core/classes/Panel), which is a `Container` that adds a default
 * 4-pixel inset and an `autoScroll` stack on top.
 *
 * @category Core
 */
class Container<TOptions extends ContainerOptions = ContainerOptions> extends Component<TOptions> {

    /**
     * Overrides {@link Component.clampsToContentSize} to `false`: a container
     * fits whatever space its parent's layout manager allocates rather than
     * inflating up to its content-derived minimum. Oversized children clip (a
     * `Container` adds no scrolling — use [`Panel`](/api/core/classes/Panel) for
     * that). Only an explicit {@link Component.setMinSize} /
     * {@link Component.setMaxSize} remains a hard floor or ceiling.
     *
     * @returns `false`, so size clamping uses the container's own explicit
     *   constraints only, not its content-derived ones.
     */
    protected clampsToContentSize(): boolean {
        return false;
    }
}

const ContainerCallable = callable(Container);
type ContainerCallable<TOptions extends ContainerOptions = ContainerOptions> = Container<TOptions>;
export {
    Container         as _Container,
    ContainerCallable as Container,
};
