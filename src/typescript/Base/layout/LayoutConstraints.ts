// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FillType } from "./FillType";
import { AnchorType } from "./AnchorType";
import { Placement } from "../Placement";

/**
 * Holds per-component layout hints passed to a {@link LayoutManager}.
 * Fields are optional; unset fields cause the layout manager to apply its defaults.
 */
export class LayoutConstraints {
    name?: string | null = null;
    description?: string | null = null;
    fill?: FillType | null = null;
    anchor?: AnchorType | null = null;
    placement?: Placement;
    ignoreParentInsets?: boolean = false;
    data?: any;

    constructor() {
    }
}
