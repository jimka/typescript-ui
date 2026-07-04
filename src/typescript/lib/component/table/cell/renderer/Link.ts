// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction options for {@link LinkCellRenderer}.
 *
 * @category Components
 */
export interface LinkCellRendererOptions {
    /**
     * CSS colour for the link text. Defaults to
     * `var(--ts-ui-link-color, rgb(21, 101, 192))` so a theme can retint every
     * link cell at once.
     */
    color ?: string;
}

/**
 * A display-only cell renderer that styles its string value as a link —
 * link-coloured, underlined, with a pointer cursor. Built for the
 * [`ColumnConfig.renderer`](/api/component/table/interfaces/ColumnConfig#renderer)
 * seam so a column can present a clickable value without a custom renderer
 * subclass.
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

        this._text = new Text("", {
            foregroundColor: options?.color ?? "var(--ts-ui-link-color, rgb(21, 101, 192))",
            cursor:          "pointer",
            styleRules:      [{ suffix: "", styles: { textDecoration: "underline" } }],
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
