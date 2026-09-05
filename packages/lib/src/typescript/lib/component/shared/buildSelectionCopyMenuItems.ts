// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { buildClipboardMenuItems } from "~/component/shared/buildClipboardMenuItems.js";

/**
 * Reads the page's current selection as text, but only when it belongs
 * entirely to `element` — both the selection's start and end containers must
 * sit inside it. A DOM range runs contiguously in document order, so both
 * endpoints inside one subtree means the whole range is; either endpoint
 * outside means some of the selected text belongs to something else on the
 * page, and is withheld rather than partially offered.
 */
function selectedTextWithin(element: Handle): string {
    const selection = DOM.source.getDocumentSelection();

    if (selection === null
        || !DOM.source.contains(element, selection.startContainer)
        || !DOM.source.contains(element, selection.endContainer)) {
        return "";
    }

    return DOM.source.getDocumentSelectionText();
}

/**
 * Builds the right-click menu rows for a read-only surface that offers Copy
 * for text selected inside it: a single Copy row, enabled only when the
 * current selection sits entirely within `element`. The row's `action`
 * closes over the text as read *now* — a later click on the row copies what
 * was selected when the menu opened, not whatever the selection has since
 * moved to (opening a menu and clicking a row are pointer gestures that can
 * themselves collapse or move the document selection).
 *
 * @param element - The component's own element; only a selection contained
 *   entirely within it is offered.
 * @returns A one-row `MenuItemConfig[]` — always `"Copy"`, never `"Cut"` or
 *   `"Paste"`.
 *
 * @internal Shared by every read-only selectable surface offering Copy in its right-click menu; not barrel-exported.
 */
export function buildSelectionCopyMenuItems(element: Handle): MenuItemConfig[] {
    const text = selectedTextWithin(element);

    return buildClipboardMenuItems({
        hasSelectedText: text !== "",
        copy:            () => DOM.sink.writeClipboardText(text),
    });
}
