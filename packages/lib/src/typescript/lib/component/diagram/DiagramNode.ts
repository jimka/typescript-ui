// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// The default node renderer for a DiagramView: a themed rounded box wrapping a
// glyph + label (or a bare label). Its content-derived preferred size is what
// the view feeds to ELK when a node carries no explicit width/height.

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Component } from "~/core/Component.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
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
    /** Short marker text drawn after the label, in the same row. */
    badge?: string;
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
    backgroundColor: "var(--ts-ui-diagram-node-bg, var(--ts-ui-button-bg, rgb(245, 245, 245)))",
    border:       "1px solid var(--ts-ui-border-color, rgb(180, 180, 180))",
    borderRadius: "4px",
    cursor:       "pointer",
};

// The badge's opacity: present but secondary to the label it trails. Matches
// the "dim the supporting value" weight the framework already uses for a
// receded label, so the badge reads as an annotation rather than a second
// name.
const BADGE_OPACITY = 0.6;

/** `.selected`'s background-color declaration. */
const DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR = "var(--ts-ui-diagram-node-selected-bg, var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15)))";

/** `.selected`'s border-color declaration. Recolours the resting border,
 *  leaving `_defaultDiagramNodeOptions.border`'s width and style intact. */
const DIAGRAM_NODE_SELECTED_BORDER_COLOR = "var(--ts-ui-accent-color, rgb(30, 100, 200))";

/**
 * The default themed node renderer for a
 * [`DiagramView`](/api/component/diagram/classes/DiagramView). Composes a glyph
 * and label inside a rounded, theme-aware box and toggles a `.selected` state
 * rule when selected.
 *
 * @category Components
 */
class DiagramNode extends Panel<DiagramNodeOptions> {

    // Declares `.selected` so `styleLayers()`/`restingGuardSuffix` know
    // about it — see `Button`'s `ownStyleStates` for the full mechanism.
    // Both declarations hoist onto the shared `.DiagramNode.selected` rule.
    // The state declares the `borderColor` longhand rather than the `border`
    // shorthand so it recolours the resting border without restating its
    // width or style.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".selected",
            extract:  (): StyleBag => ({
                backgroundColor: DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR,
                borderColor:     DIAGRAM_NODE_SELECTED_BORDER_COLOR,
            }),
        },
    ];

    /** The glyph+label (or bare label) component. */
    private _label!: IconText | Text;

    /** The child added to the node: `_label` alone, or a row of `_label` + `_badge`. */
    private _content!: Component;

    /** The trailing badge chip, when the node carries one. */
    private _badge?: Text;

    /**
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: DiagramNodeOptions, subclassDefaults?: Partial<DiagramNodeOptions>) {
        super(options, {
            ..._defaultDiagramNodeOptions,
            layoutManager: new Fit(),
            ...(subclassDefaults ?? {}),
        });

        // Content children are built here (not during super's cascade), so the
        // label/glyph/badge/selected values cached pure in `applyOptions` are
        // dispatched now that the row exists.
        this.buildContent(this._options.glyph, this._options.label ?? "", this._options.badge);

        if (this._options.selected !== undefined) {
            this.setSelected(this._options.selected);
        }
    }

    /**
     * Caches the label/glyph/badge/selected fields pure to `_options`; they are
     * dispatched from the constructor body once the content child exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: DiagramNodeOptions): this {
        super.applyOptions(options);

        if (options.label    !== undefined) this._options.label    = options.label;
        if (options.glyph    !== undefined) this._options.glyph    = options.glyph;
        if (options.badge    !== undefined) this._options.badge    = options.badge;
        if (options.selected !== undefined) this._options.selected = options.selected;

        return this;
    }

    /**
     * Builds (or rebuilds) the inner content child: `_label` alone (an
     * `IconText` when a glyph is present, else a bare `Text`), or — when a
     * badge is given — a row of `_label` followed by the badge `Text`.
     *
     * @param glyph - Optional glyph name.
     * @param label - The label text.
     * @param badge - Optional trailing badge text.
     */
    private buildContent(glyph: string | undefined, label: string, badge: string | undefined): void {
        if (this._content) {
            this.removeComponent(this._content);
        }

        this._label = glyph !== undefined ? new IconText(glyph, label) : new Text(label);

        if (badge === undefined) {
            this._badge = undefined;
            this._content = this._label;
        } else {
            this._badge = new Text(badge);
            this._badge.setOpacity(BADGE_OPACITY);
            this._content = new Component({ layoutManager: new HBox(), components: [this._label, this._badge] });
        }

        // Every Component stamps its own `cursor` (defaulting to `default`) onto
        // its CSS rule, so the label/glyph/badge would override the node's
        // `pointer` wherever they sit under the cursor — the hover cursor would
        // flicker between pointer (over padding) and arrow (over the text).
        // Make the content transparent to pointer events so hover + clicks land
        // on the node itself; `pointer-events: none` inherits, so this one call
        // also covers everything nested inside (the glyph and text inside an
        // `IconText`, or the label + badge inside the row). Mirrors how `Button`
        // frees its label row so the button's cursor governs.
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
        this._label.setText(value);

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
     * Returns the node's badge text, or `null` when none was set.
     *
     * @returns The badge text, or `null`.
     */
    getBadge(): string | null {
        return this._options.badge ?? null;
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

        // Unconditional, not gated on `this.getElement()`: `setStyleState`
        // updates `_activeStates` regardless of whether an element exists
        // yet (only its own DOM write is internally element-gated) — see
        // `ToggleButton.setSelected`'s own comment for the full reasoning.
        this.setStyleState(".selected", value);

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
