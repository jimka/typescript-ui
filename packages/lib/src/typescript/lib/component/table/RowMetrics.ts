// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ThemeManager } from "~/core/Theme.js";
import { Util } from "~/core/Util.js";

/**
 * Height in pixels of one table row: the shared px line box plus top+bottom
 * cell padding. Shared by `Body`'s pooled rows and `layout/Table`'s header
 * and footer row height, so all three stay in agreement.
 *
 * @remarks `theme.table.cell.height` is intentionally ignored: a fixed pixel
 * height ignores the active line box and clips text when the theme changes
 * the leading. The line box is the additive `font-size + --ts-ui-line-padding`
 * value `Util.lineHeightPx` derives at the root font size, keeping row
 * height in sync with the line box the cells are actually rendered at.
 *
 * @internal
 */
export function tableRowHeight(): number {
    const theme      = ThemeManager.getTheme();
    const lineHeight = Util.lineHeightPx();
    const padding    = theme.table.cell.padding ?? 2;

    return lineHeight + 2 * padding;
}
