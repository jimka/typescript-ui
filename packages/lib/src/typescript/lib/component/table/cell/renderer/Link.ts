// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Text } from "~/component/input/Text.js";
import { Link } from "~/component/input/Link.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction options for {@link LinkCellRenderer}.
 *
 * @category Components
 */
export interface LinkCellRendererOptions {
    /**
     * CSS colour for the link text. Defaults to the theme-tinted colour of
     * [`Link`](/api/component/input/classes/Link) itself, so leaving this unset
     * keeps every link cell in step with every standalone link.
     */
    color ?: string;
}

/**
 * A display-only cell renderer that presents its string value as a link.
 * Built for the
 * [`ColumnConfig.renderer`](/api/component/table/interfaces/ColumnConfig#renderer)
 * seam so a column can present a clickable value without a custom renderer
 * subclass.
 *
 * Composes a [`Link`](/api/component/input/classes/Link) in its presentational
 * (`interactive: false`) mode, so a link cell looks exactly like a standalone
 * link but claims no `role`, takes no tab focus, and does no keyboard
 * handling — all of which belong to the enclosing {@link Table}.
 *
 * The renderer is purely presentational: it does not handle the click itself.
 * Pair the column with the {@link Table} `"cellclick"` event and act on the
 * matching `field` to open / navigate. Because a custom-rendered cell carries no
 * editor, the cell never enters edit mode, so the click is always a plain click.
 *
 * @example
 * ```typescript
 * new Table(store, {
 *     columns: [{ field: 'refTable', renderer: () => new LinkCellRenderer() }],
 * });
 * table.on('cellclick', e => {
 *     if (e.field === 'refTable') open(String(e.value));
 * });
 * ```
 *
 * @category Components
 */
class LinkCellRenderer extends CellRenderer<String | null> {

    private readonly _text: Text;
    private _value: String | null = null;

    constructor(options?: LinkCellRendererOptions) {
        super();

        this._text = new Link("", {
            // The Table owns keyboard nav (RovingTabIndex) and routes clicks
            // through its own "cellclick", so the link must neither take tab
            // focus nor wire its own keyboard handling.
            interactive:     false,
            // An unset `color` is gated out by applyOptions, so it falls
            // through to Link's own class default rather than being pinned here.
            foregroundColor: options?.color,
        });
        // Renderer Texts opt out of auto-measure — the host cell force-sizes them.
        this._text.setAutoMeasure(false);
        this.addComponent(this._text);
    }

    /**
     * Returns the underlying {@link Text} used to display the link label.
     *
     * @returns The link's {@link Text} component.
     */
    getText(): Text {
        return this._text;
    }

    /**
     * Returns the cached value, or `null` when the cell is empty.
     *
     * @returns The displayed value, or `null`.
     */
    getValue(): String | null {
        return this._value;
    }

    /**
     * Caches the value and renders it as link text. `null` and `undefined`
     * both normalise to `null` and render as the empty string.
     *
     * @param value - The value to display, or `null`/`undefined` to clear.
     */
    setValue(value: String | null): void {
        this._value = value ?? null;
        this._text.setText(this._value === null ? "" : String(this._value));
    }
}

const LinkCellRendererCallable = callable(LinkCellRenderer);
type LinkCellRendererCallable = LinkCellRenderer;
export {
    LinkCellRenderer         as _LinkCellRenderer,
    LinkCellRendererCallable as LinkCellRenderer
};
