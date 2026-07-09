// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// The default node renderer for a DiagramView: a themed rounded box wrapping a
// glyph + label (or a bare label). Its content-derived preferred size is what
// the view feeds to ELK when a node carries no explicit width/height.

import { Panel, PanelOptions } from "~/core/Panel.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Fit } from "~/layout/Fit.js";
import { Insets } from "~/primitive/Insets.js";
import { IconText } from "~/component/display/IconText.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link DiagramNode}.
 *
 * @category Components
 */
export interface DiagramNodeOptions extends PanelOptions {
    /** Label text shown inside the node. */
    label?: string;
    /** Optional registered glyph name shown before the label. */
    glyph?: string;
    /** Whether the node starts selected. */
    selected?: boolean;
}

/**
 * User-overridable defaults. The node paints a themed rounded box; its interior
 * inset gives the label structural breathing room away from the border.
 */
const _defaultDiagramNodeOptions: Partial<DiagramNodeOptions> = {
    // Vertical 4px / horizontal 8px so a short label never sits flush against
    // the rounded border — structural interior spacing, not cosmetic nudging.
    insets: new Insets(4, 8, 4, 8),
};

/** Corner radius in pixels for the node's rounded box. */
const NODE_BORDER_RADIUS = "4px";

/**
 * The default themed node renderer for a
 * [`DiagramView`](/api/component/diagram/classes/DiagramView). Composes a glyph
 * and label inside a rounded, theme-aware box and toggles a `.selected` state
 * rule when selected.
 *
 * @category Components
 */
class DiagramNode extends Panel<DiagramNodeOptions> {

    /** The inner glyph+label (or bare label) component. */
    private _content!: IconText | Text;

    // Lazy `.selected` state rule. The slot caches the wrapper returned by
    // Component's `createStyleRule` builder, which dedupes by selector suffix.
    private declare _selectedStyleRule?: StyleRule;
    private get selectedStyleRule(): StyleRule {
        return this._selectedStyleRule ??= this.createStyleRule(".selected");
    }

    constructor(options?: DiagramNodeOptions) {
        super(options, { ..._defaultDiagramNodeOptions, layoutManager: new Fit() });

        this.setBackgroundColor("var(--ts-ui-diagram-node-bg, var(--ts-ui-button-bg, rgb(245, 245, 245)))");
        this.setBorder("1px solid var(--ts-ui-border-color, rgb(180, 180, 180))");
        this.setBorderRadius(NODE_BORDER_RADIUS);
        this.setCursor("pointer");

        this.selectedStyleRule.set("borderColor",     "var(--ts-ui-accent-color, rgb(30, 100, 200))");
        this.selectedStyleRule.set("backgroundColor", "var(--ts-ui-diagram-node-selected-bg, var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15)))");

        // Content children are built here (not during super's cascade), so the
        // label/glyph/selected values cached pure in `applyOptions` are
        // dispatched now that the row exists.
        this.buildContent(this._options.glyph, this._options.label ?? "");

        if (this._options.selected !== undefined) {
            this.setSelected(this._options.selected);
        }
    }

    /**
     * Caches the label/glyph/selected fields pure to `_options`; they are
     * dispatched from the constructor body once the content child exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: DiagramNodeOptions): this {
        super.applyOptions(options);

        if (options.label    !== undefined) this._options.label    = options.label;
        if (options.glyph    !== undefined) this._options.glyph    = options.glyph;
        if (options.selected !== undefined) this._options.selected = options.selected;

        return this;
    }

    /**
     * Builds (or rebuilds) the inner content child — an `IconText` when a glyph
     * is present, else a bare `Text`.
     *
     * @param glyph - Optional glyph name.
     * @param label - The label text.
     */
    private buildContent(glyph: string | undefined, label: string): void {
        if (this._content) {
            this.removeComponent(this._content);
        }

        this._content = glyph !== undefined ? new IconText(glyph, label) : new Text(label);

        // Every Component stamps its own `cursor` (defaulting to `default`) onto
        // its CSS rule, so the label/glyph would override the node's `pointer`
        // wherever they sit under the cursor — the hover cursor would flicker
        // between pointer (over padding) and arrow (over the text). Make the
        // content transparent to pointer events so hover + clicks land on the
        // node itself; `pointer-events: none` inherits, so this one call also
        // covers the glyph and text nested inside an `IconText`. Mirrors how
        // `Button` frees its label row so the button's cursor governs.
        this._content.setPointerEvents("none");

        this.addComponent(this._content);
    }

    /**
     * Updates the node's label text.
     *
     * @param value - The new label.
     *
     * @returns This node, for method chaining.
     */
    setLabel(value: string): this {
        this._options.label = value;
        this._content.setText(value);

        return this;
    }

    /**
     * Returns the node's label, or `null` when none was set.
     *
     * @returns The label text, or `null`.
     */
    getLabel(): string | null {
        return this._options.label ?? null;
    }

    /**
     * Sets the selected state and toggles the `.selected` CSS class.
     *
     * @param value - True to select, false to deselect.
     *
     * @returns This node, for method chaining.
     */
    setSelected(value: boolean): this {
        this._options.selected = value;

        const element = this.getElement();

        if (element) {
            DOM.sink.apply(element, { toggleClass: { selected: value } });
        }

        return this;
    }

    /**
     * Returns whether the node is currently selected.
     *
     * @returns True when selected.
     */
    isSelected(): boolean {
        return this._options.selected ?? false;
    }

    /**
     * Re-applies the cached selected class after (re-)render, since a fresh
     * element starts without it.
     *
     * @param element - Optional element from the render pipeline.
     *
     * @returns This node, for method chaining.
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();

        if (el && this.isSelected()) {
            DOM.sink.apply(el, { toggleClass: { selected: true } });
        }

        return this;
    }
}

const DiagramNodeCallable = callable(DiagramNode);
type DiagramNodeCallable = DiagramNode;
export {
    DiagramNode         as _DiagramNode,
    DiagramNodeCallable as DiagramNode,
};
