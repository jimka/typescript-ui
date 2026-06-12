// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Absolute}.
 *
 * @category Layouts
 */
export interface AbsoluteOptions extends LayoutManagerOptions {
}

/**
 * A layout manager that places each child at its preferred (or current) size
 * at the position the application has already set on the child. No clamp is
 * applied — a child larger than the container is committed at its full size,
 * letting a host `Panel` with `autoScroll: "auto"` scroll the overflow.
 *
 * @category Layouts
 */
class Absolute extends LayoutManager {

    constructor(options?: AbsoluteOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Places each child at the size declared by `preferredSize` (falling back
     * to `size`, then `0`) at the position declared by the child's own
     * `getX` / `getY`. Bypasses {@link LayoutManager.placeComponent} so the
     * cell clamp does not shrink an oversized child.
     */
    doLayout(): void {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        const components = container.getLaidOutComponents();

        for (const component of components) {
            const preferredSize = component.getPreferredSize();
            const size = component.getSize();

            const width = preferredSize?.width ?? size?.width ?? 0;
            const height = preferredSize?.height ?? size?.height ?? 0;

            const x = component.getX();
            const y = component.getY();

            this.commitBounds(component, x, y, width, height);
        }
    }
}

const AbsoluteCallable = callable(Absolute);
type AbsoluteCallable = Absolute;
export {
    Absolute         as _Absolute,
    AbsoluteCallable as Absolute
};
