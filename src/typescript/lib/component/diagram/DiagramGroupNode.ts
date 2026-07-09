// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// The default container renderer for a DiagramView compound node: a titled,
// translucent box painted behind its (flat-sibling, not DOM-child) leaf/child
// components. `DiagramView` positions this box at ELK's computed absolute
// bounds and paints it at the lowest z-index among a compound graph's nodes,
// so it never intercepts a click meant for a leaf sitting visually inside it.

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Absolute } from "~/layout/Absolute.js";
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
}

/** Corner radius in pixels for the container's box, matching `DiagramNode`. */
const GROUP_BORDER_RADIUS = "4px";

/**
 * Distance in pixels from the box's top-left corner to the header label's
 * origin — enough breathing room that the label never sits flush against the
 * rounded border, mirroring `DiagramNode`'s interior inset.
 */
const HEADER_INSET = 6;

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

    /** The header label shown at the box's top-left corner. */
    private _label!: Text;

    constructor(options?: DiagramGroupNodeOptions) {
        super(options, { layoutManager: new Absolute() });

        this.setBackgroundColor("var(--ts-ui-diagram-group-bg, rgba(120, 120, 120, 0.08))");
        this.setBorder("1px solid var(--ts-ui-diagram-group-border, var(--ts-ui-border-color, rgb(180, 180, 180)))");
        this.setBorderRadius(GROUP_BORDER_RADIUS);

        // The label is built here (not during super's cascade), so the value
        // cached pure in `applyOptions` is dispatched now that the box exists.
        this._label = new Text(this._options.label ?? "");
        this._label.setPointerEvents("none");
        this._label.setX(HEADER_INSET);
        this._label.setY(HEADER_INSET);
        this.addComponent(this._label);
    }

    /**
     * Caches the label field pure to `_options`; it is dispatched from the
     * constructor body once the header child exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: DiagramGroupNodeOptions): this {
        super.applyOptions(options);

        if (options.label !== undefined) this._options.label = options.label;

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
        this._label.setText(value);

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
