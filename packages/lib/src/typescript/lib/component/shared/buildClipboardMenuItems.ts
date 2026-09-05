// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { MenuItemConfig } from "~/component/container/MenuItem.js";

/** Which clipboard rows a surface offers, and what each one does. */
export interface ClipboardMenuConfig {
    /** Whether the surface has text selected right now. Sets `enabled` on Cut and Copy. */
    hasSelectedText: boolean;
    /** Runs the Cut command. Omit to leave the Cut row out entirely. */
    cut?:   () => void;
    /** Runs the Copy command. Omit to leave the Copy row out entirely. */
    copy?:  () => void;
    /** Runs the Paste command. Omit to leave the Paste row out entirely. */
    paste?: () => void;
}

/**
 * Builds the Cut / Copy / Paste rows a right-click menu offers for clipboard
 * actions. A row is built only for a handler `config` supplies — a surface
 * with no `paste()` gets no Paste row at all, rather than a dimmed one.
 * `hasSelectedText` sets `enabled` on Cut and Copy so both dim when there is
 * nothing to act on; Paste never sets `enabled`, since whether there is
 * something to paste depends on the system clipboard, not the surface.
 *
 * @param config - Which rows to build and what each one does.
 * @returns The requested rows, in Cut / Copy / Paste order, with no trailing
 *   separator — a caller that follows the block with more items writes its
 *   own.
 *
 * @internal Shared by every component offering clipboard actions in its right-click menu; not barrel-exported.
 */
export function buildClipboardMenuItems(config: ClipboardMenuConfig): MenuItemConfig[] {
    const items: MenuItemConfig[] = [];

    if (config.cut) {
        items.push({ text: "Cut", enabled: config.hasSelectedText, action: config.cut });
    }

    if (config.copy) {
        items.push({ text: "Copy", enabled: config.hasSelectedText, action: config.copy });
    }

    if (config.paste) {
        items.push({ text: "Paste", action: config.paste });
    }

    return items;
}
