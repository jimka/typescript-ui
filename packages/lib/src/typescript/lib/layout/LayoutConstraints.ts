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
    /**
     * Optional registry glyph name shown leading a tab button's label. Read by
     * the [`Tab`](/api/layout/classes/Tab) manager into the button's `setGlyph`;
     * ignored by other layout managers.
     */
    glyph?: string | null = null;
    /**
     * Optional hover-tooltip text for a tab button. Read by the
     * [`Tab`](/api/layout/classes/Tab) manager (via
     * [`TabBar`](/api/component/container/classes/TabBar)) and attached to the
     * tab button; ignored by other layout managers.
     */
    tooltip?: string | null = null;
    /**
     * How the component fills its allocated cell. Beyond the grid-style managers,
     * [`HBox`](/api/layout/classes/HBox) and [`VBox`](/api/layout/classes/VBox)
     * read the **cross-axis** component as per-child align-self in both
     * `"preferred"` and `"equal"` mode: `VERTICAL`/`BOTH` stretch a child to the
     * full row height in an HBox, `HORIZONTAL`/`BOTH` to the full column width in
     * a VBox. The main-axis component is ignored by the box (it owns main-axis
     * sequencing). An explicit cross fill overrides the box's global `stretching`.
     */
    fill?: FillType | null = null;
    /**
     * The anchor point used to position the component when it does not fill its
     * cell. Beyond the grid-style managers,
     * [`HBox`](/api/layout/classes/HBox) and [`VBox`](/api/layout/classes/VBox)
     * read the **cross-axis** component as per-child align-self in both
     * `"preferred"` and `"equal"` mode: `NORTH`/`SOUTH` (and the matching corners)
     * pin a child to the top/bottom of the row in an HBox; `WEST`/`EAST` pin it to
     * the left/right of the column in a VBox. `CENTER` and pure main-axis anchors
     * are inert, leaving each box's default (HBox baseline, VBox WEST origin). An
     * explicit cross anchor overrides the box's global `stretching` for that child.
     */
    anchor?: AnchorType | null = null;
    placement?: Placement;
    ignoreParentInsets?: boolean = false;
    data?: any;
    closeable?: boolean;
    /**
     * Whether a factory passed to
     * [`Component.addComponent`](/api/core/classes/Component#addcomponent) is
     * registered without being run. Read by the
     * [`Tab`](/api/layout/classes/Tab) manager only, where it defaults to
     * `true`; pass `false` to build the child immediately instead. Ignored when
     * the child is an already-constructed component, and by every other manager.
     */
    lazy?: boolean;
    /**
     * Whether closing this component's tab destroys it. Read by the `Tab`
     * manager only, where it defaults to `true`: a closed tab's content is
     * disposed, releasing its element, handles and per-instance stylesheet
     * rules. Pass `false` for a component the caller owns and intends to
     * re-use after the tab closes. Ignored by every other layout manager,
     * and by the tear-off / re-dock path, which relocates rather than closes.
     */
    disposeOnClose?: boolean;
    /**
     * Marks a child as chrome that participates in layout but is excluded from
     * layout serialization. A `transient` child is laid out normally (it can be a
     * real tab or pane), but [`serializeLayout`](/api/layout/functions/serializeLayout)
     * skips it — so it is never captured in a saved arrangement nor parked/rebuilt
     * on restore. Used for placeholder chrome such as a [`Dock`](/api/overlay/classes/Dock)
     * empty-state start page shown as a non-closeable tab. Ignored by layout
     * managers themselves.
     */
    transient?: boolean;
    /**
     * A per-component distribution weight, read differently by three managers.
     * [`HBox`](/api/layout/classes/HBox) and [`VBox`](/api/layout/classes/VBox)
     * use it to share **extra main-axis space** among children (unset is treated
     * as `0` — no share). [`Accordion`](/api/layout/classes/Accordion) reads it
     * the same way (`?? 0`) as an open section's share of the container's
     * leftover height, defaulting to `1` when `Accordion.setFillHeight` is on;
     * under `Accordion.setResizable` a `0` section additionally holds its px
     * across a container resize while the weighted sections absorb the change.
     * [`Split`](/api/layout/classes/Split) uses it as the
     * pane's **container-resize weight**: on a container resize the extent delta
     * is split across panes in proportion to this weight, so `0` pins a pane's px
     * size and a positive weight absorbs the change. Split reads the raw value,
     * so an unset weight there means "default to the pane's current size" (a
     * proportional rescale), not `0`. `Split.setPaneResizeWeight` overrides it at
     * runtime. Ignored by other layout managers.
     */
    weight?: number;
    /**
     * Whether a region/pane may be collapsed. Read by two managers with
     * **opposite defaults**:
     *
     * - [`Border`](/api/layout/classes/Border) — collapsing is opt-**in**
     *   (`collapsible ?? false`): an edge region is fixed unless it sets
     *   `collapsible: true`. Ignored for the center region.
     * - [`Split`](/api/layout/classes/Split) — collapsing is opt-**out**
     *   (`collapsible !== false`): a pane is collapsible unless it sets
     *   `collapsible: false`. A `collapsible: false` pane keeps a draggable
     *   gutter (it still resizes) but loses its collapse chevron and cannot be
     *   collapsed by double-click, `setPaneCollapsed`, `setPaneCollapsedImmediate`,
     *   or the `collapsedPanes` option. Restoring an already-collapsed such pane
     *   is still allowed.
     *
     * Ignored by other layout managers.
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
