// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";

/**
 * A layout manager that performs no automatic layout.
 * Children are expected to be positioned absolutely by the application.
 */
export class Absolute extends LayoutManager {

    /**
     * No-op layout; children are positioned absolutely by the application.
     */
    doLayout(): void {
    }
}
