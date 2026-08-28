// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// The default container renderer for a DiagramView compound node: a titled,
// translucent box painted behind its (flat-sibling, not DOM-child) leaf/child
// components. `DiagramView` positions this box at ELK's computed absolute
// bounds and paints it at the lowest z-index among a compound graph's nodes,
// so it never intercepts a click meant for a leaf sitting visually inside it.

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Absolute } from "~/layout/Absolute.js";
import { IconText } from "~/component/display/IconText.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link DiagramGroupNode}.
 *
 * @category Components
 */
export interface DiagramGroupNodeOptions extends PanelOptions {
    /** The container's header label (e.g. the schema name). */
    label?: string;
    /** Optional registered glyph name shown before the header label. */
    glyph?: string;
}

/**
 * Distance in pixels from the box's top-left corner to the header label's
 * origin — enough breathing room that the label never sits flush against the
 * rounded border, mirroring `DiagramNode`'s interior inset.
 */
const HEADER_INSET = 6;

/** Resting fill colour of a `DiagramGroupNode` — and, once level-of-detail
 *  simplification engages, of a container `<rect>` `DiagramNodeLayer` draws
 *  in its place. @internal */
export const DIAGRAM_GROUP_BACKGROUND_COLOR = "var(--ts-ui-diagram-group-bg, rgba(120, 120, 120, 0.08))";

/** Resting border colour of a `DiagramGroupNode` — and, once level-of-detail
 *  simplification engages, of a container `<rect>` `DiagramNodeLayer` draws
 *  in its place. @internal */
export const DIAGRAM_GROUP_BORDER_COLOR = "var(--ts-ui-diagram-group-border, var(--ts-ui-border-color, rgb(180, 180, 180)))";

const _defaultDiagramGroupNodeOptions: Partial<DiagramGroupNodeOptions> = {
    backgroundColor: DIAGRAM_GROUP_BACKGROUND_COLOR,
    // A container is a selectable node like any leaf, so it carries the same
    // pointer cursor `DiagramNode` does — left at the Component default it
    // would read as an arrow and promise a pan its own box does not perform.
    cursor:       "pointer",
    border:       `1px solid ${DIAGRAM_GROUP_BORDER_COLOR}`,
    borderRadius: "4px",
};

/**
 * The default themed container renderer for a
 * [`DiagramView`](/api/component/diagram/classes/DiagramView) compound node.
 * Paints a translucent, rounded box with a header label pinned to the
 * top-left corner; the rest of the box stays open so the container's
 * children — rendered as separate flat siblings positioned by ELK, not as DOM
 * children of this component — visually read as sitting inside it.
 *
 * @category Components
 */
class DiagramGroupNode extends Panel<DiagramGroupNodeOptions> {

    /** The header shown at the box's top-left corner: a bare label, or a glyph + label. */
    private _header!: IconText | Text;

    constructor(options?: DiagramGroupNodeOptions, subclassDefaults?: Partial<DiagramGroupNodeOptions>) {
        super(options, {
            layoutManager: new Absolute(),
            ..._defaultDiagramGroupNodeOptions,
            ...(subclassDefaults ?? {}),
        });

        // The header is built here (not during super's cascade), so the values
        // cached pure in `applyOptions` are dispatched now that the box exists.
        // An IconText when a glyph is present (glyph before the label, mirroring
        // DiagramNode), else a bare Text.
        const label = this._options.label ?? "";
        this._header = this._options.glyph !== undefined
            ? new IconText(this._options.glyph, label)
            : new Text(label);
        this._header.setPointerEvents("none");
        this._header.setX(HEADER_INSET);
        this._header.setY(HEADER_INSET);
        this.addComponent(this._header);
    }

    /**
     * Caches the label/glyph fields pure to `_options`; they are dispatched from
     * the constructor body once the header child exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: DiagramGroupNodeOptions): this {
        super.applyOptions(options);

        if (options.label !== undefined) this._options.label = options.label;
        if (options.glyph !== undefined) this._options.glyph = options.glyph;

        return this;
    }

    /**
     * Updates the container's header label.
     *
     * @param value - The new label.
     *
     * @returns This node, for method chaining.
     */
    setLabel(value: string): this {
        this._options.label = value;
        this._header.setText(value);

        return this;
    }

    /**
     * Returns the container's header label, or `null` when none was set.
     *
     * @returns The label text, or `null`.
     */
    getLabel(): string | null {
        return this._options.label ?? null;
    }
}

const DiagramGroupNodeCallable = callable(DiagramGroupNode);
type DiagramGroupNodeCallable = DiagramGroupNode;
export {
    DiagramGroupNode         as _DiagramGroupNode,
    DiagramGroupNodeCallable as DiagramGroupNode,
};
