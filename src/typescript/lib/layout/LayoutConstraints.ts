// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FillType } from "~/layout/FillType";
import { AnchorType } from "~/layout/AnchorType";
import { Placement } from "~/primitive/Placement";
import { CollapseDirection } from "~/component/container/CollapseButton";

/**
 * Holds per-component layout hints passed to a {@link LayoutManager}.
 * Fields are optional; unset fields cause the layout manager to apply its defaults.
 *
 * @category Layouts
 */
export class LayoutConstraints {
    name?: string | null = null;
    description?: string | null = null;
    fill?: FillType | null = null;
    anchor?: AnchorType | null = null;
    placement?: Placement;
    ignoreParentInsets?: boolean = false;
    data?: any;
    closeable?: boolean;
    weight?: number;
    /**
     * Whether a [`Border`](/api/layout/classes/Border) region may be collapsed.
     * Read by `Border` into its per-region collapsible flag; collapsing is
     * opt-in, so this is treated as `false` when unset. Ignored by other layout
     * managers and for the center region.
     */
    collapsible?: boolean;
    /**
     * The direction a [`Split`](/api/layout/classes/Split) pane collapses. A
     * pane collapsing toward its leading edge (`"west"`/`"north"`, the default)
     * uses the gutter on its trailing side; one collapsing toward its trailing
     * edge (`"east"`/`"south"`) uses the gutter on its leading side — which is
     * what lets the last pane collapse. Defaults to the leading direction for
     * the split's axis. Ignored by other layout managers.
     */
    collapseDirection?: CollapseDirection;

    constructor() {
    }
}
