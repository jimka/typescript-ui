// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "./LayoutManager.js";

/**
 * Construction-time options for {@link Absolute}.
 *
 * @category Layouts
 */
export interface AbsoluteOptions extends LayoutManagerOptions {
}

/**
 * A layout manager that performs no automatic layout.
 * Children are expected to be positioned absolutely by the application.
 *
 * @category Layouts
 */
export class Absolute extends LayoutManager {

    constructor(options?: AbsoluteOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * No-op layout; children are positioned absolutely by the application.
     */
    doLayout(): void {
    }
}
