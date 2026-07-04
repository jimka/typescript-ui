// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CustomListItem } from "~/component/list/AbstractCustomList.js";

/**
 * The bound-item state handed to a
 * [`ListItemRenderer`](/api/component/list/classes/ListItemRenderer) each time
 * a pool row (or the collapsed
 * [`ComboBox`](/api/component/input/classes/ComboBox) control) is mapped to a
 * different item.
 *
 * @remarks Selection / focus / hover styling is applied by the owning list on
 * the row element directly and does not flow through the renderer, so the
 * context carries only the item data and its position — mirroring
 * `TreeNodeRenderContext`.
 *
 * @category Components
 */
export interface ListItemRenderContext {
    /** The bound item — `{ key, label, glyph? }`. */
    item:  CustomListItem;
    /** Zero-based row index, or `-1` for the empty collapsed-control state. */
    index: number;
}
