// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, Panel } from '@jimka/typescript-ui/core';
import { Insets } from '@jimka/typescript-ui/primitive';
import { AnchorType, FlowLayout, HBox, LayoutConstraints, VBox } from '@jimka/typescript-ui/layout';
import type { AxisPosition, AxisSpread, FlowItemAlign, FlowUniformity } from '@jimka/typescript-ui/layout';
import { ComboBox, NumberSpinner, Text } from '@jimka/typescript-ui/component/input';
import { ToolBar } from '@jimka/typescript-ui/component/menubar';
import { Tooltip } from '@jimka/typescript-ui/overlay';
import { LayoutTestPanel } from "./LayoutTestPanel.js";

/**
 * Width in pixels the enum dropdowns are pinned to. A `ComboBox` otherwise
 * reports a fixed 200px preferred width (`ComboBox.updateHeight`), which would
 * make the six-control bar wide enough to overflow — and once a `ToolBar`'s
 * `HBox` overflows it shrinks every child, truncating the captions. Pinning the
 * dropdowns narrow keeps the bar within normal window widths so nothing clips.
 */
const ENUM_CONTROL_WIDTH_PX = 100;

/** Width in pixels the numeric spinners are pinned to, for the same reason. */
const NUMBER_CONTROL_WIDTH_PX = 76;

/**
 * Shared base for the {@link HFlow} / {@link VFlow} demo panels. Stacks a
 * settings {@link ToolBar} above a {@link LayoutTestPanel} of mixed sample
 * widgets — the latter *is* the flow container. The toolbar exposes every
 * {@link FlowLayout} option (the two spacings plus the `uniform`, `align`,
 * `itemAlign`, and `justify` enums) through dropdowns and spinners; each change
 * drives the corresponding setter and re-lays-out the content, so the effect of
 * a setting is visible immediately.
 *
 * @remarks The sample widgets live in the nested panel rather than on this panel
 * so the toolbar is not itself a flow item, mirroring how {@link
 * AccordionDemoPanel} nests its accordion below its controls.
 */
class FlowDemoPanel extends Panel {

    private readonly flow:  FlowLayout;
    private readonly inner: LayoutTestPanel;

    /**
     * Constructs the demo panel around a flow layout.
     *
     * @param flow - The flow layout (an {@link HFlow} or {@link VFlow}) applied
     *   to the sample content and driven by the toolbar controls.
     */
    protected constructor(flow: FlowLayout) {
        super();

        this.flow = flow;

        // Fixed settings bar above the scrolling flow content.
        this.setLayoutManager(new VBox({ stretching: true, spacing: 0 }));
        this.setInsets(new Insets(0, 0, 0, 0));

        this.addComponent(this.buildToolbar());

        // The inner panel owns the flow and the sample widgets; it keeps its own
        // `autoScroll: "auto"` so the flow — not this outer VBox — scrolls.
        this.inner = new LayoutTestPanel();
        this.inner.setLayoutManager(flow);
        this.assignDemoAnchors();

        // Weight 1 so the flow fills the height below the toolbar.
        const fill = new LayoutConstraints();

        fill.weight = 1;

        this.addComponent(this.inner, fill);
    }

    /**
     * Gives each sample widget a distinct {@link AnchorType} so its placement
     * within its (possibly uniform) flow cell is visible — the same cycling the
     * flow demos used before the toolbar was added.
     */
    private assignDemoAnchors(): void {
        const enums = Object.keys(AnchorType).length;
        let n = 0;

        for (const component of this.inner.getComponents()) {
            const constraints = this.inner.getLayoutConstraints(component) ?? new LayoutConstraints();

            constraints.anchor = n % enums;
            n += 1;

            this.inner.setLayoutConstraints(component, constraints);
        }
    }

    /**
     * Builds the settings toolbar with a labelled control per {@link
     * FlowLayout} option, seeded from the flow's current values.
     *
     * @returns The populated toolbar.
     */
    private buildToolbar(): ToolBar {
        const toolbar = new ToolBar({ compact: true });

        // A ToolBar lays its children out with a *stretching* HBox, which fills
        // each child to the bar height and disables baseline alignment
        // (`HBox.getContentBaseline` returns null while stretching). Turn
        // stretching off so the captions sit on a shared text baseline with
        // their controls, and space the items out. (A cross-axis *centre* would
        // read more evenly, but BoxLayout has no `itemAlign` the way FlowLayout
        // does — baseline is the closest built-in.)
        const bar = toolbar.getLayoutManager();

        if (bar instanceof HBox) {
            bar.setStretching(false);
            bar.setComponentSpacing(8);
        }

        this.addEnumSetting(toolbar, "Uniform:", "Which axes grow every cell to a common size so wrapped items align into a grid (none / width / height / both).",
            ["none", "width", "height", "both"], this.flow.getUniform(),
            value => { this.flow.setUniform(value as FlowUniformity); });
        this.addEnumSetting(toolbar, "Align:", "Where each line's content block sits along the main axis when it doesn't fill the container (start / center / end). Ignored while Justify spreads the line.",
            ["start", "center", "end"], this.flow.getAlign(),
            value => { this.flow.setAlign(value as AxisPosition); });
        this.addEnumSetting(toolbar, "Item align:", "How each item is positioned within its line's cross extent — the row height for HFlow, the column width for VFlow (start / center / end / baseline).",
            ["start", "center", "end", "baseline"], this.flow.getItemAlign(),
            value => { this.flow.setItemAlign(value as FlowItemAlign); });
        this.addEnumSetting(toolbar, "Justify:", "How a line's items are distributed along the main axis by growing the inter-item gaps (start keeps the fixed spacing / between / around).",
            ["start", "between", "around"], this.flow.getJustify(),
            value => { this.flow.setJustify(value as AxisSpread); });

        this.addNumberSetting(toolbar, "Spacing:", "Pixel gap between items within a line.",
            this.flow.getComponentSpacing(),
            value => { this.flow.setComponentSpacing(value); });
        this.addNumberSetting(toolbar, "Line spacing:", "Pixel gap between wrapped lines — columns for VFlow, rows for HFlow.",
            this.flow.getLineSpacing(),
            value => { this.flow.setLineSpacing(value); });

        return toolbar;
    }

    /**
     * Appends a labelled dropdown that applies one of a fixed set of enum values
     * to the flow and re-lays-out the content.
     *
     * @param toolbar - The toolbar to append to.
     * @param label - The caption shown before the dropdown.
     * @param tip - Hover description of what the setting does.
     * @param values - The selectable values, in display order.
     * @param current - The flow's current value (the initial selection).
     * @param apply - Pushes the chosen value into the matching flow setter.
     */
    private addEnumSetting(toolbar: ToolBar, label: string, tip: string, values: string[], current: string, apply: (value: string) => void): void {
        const combo = new ComboBox();

        combo.setItems(values);
        combo.setValue(current);
        // A ComboBox reports a fixed 200px preferred width; pin it narrow so the
        // bar fits without overflow-shrinking (which would clip the captions).
        // Keep its own height so it still shares the labels' text baseline.
        combo.setPreferredSize({ width: ENUM_CONTROL_WIDTH_PX, height: combo.getPreferredSize()?.height ?? 0 });
        combo.setMaxSize({ width: ENUM_CONTROL_WIDTH_PX, height: combo.getMaxSize()?.height ?? 0 });
        combo.on("change", () => {
            apply(combo.getValue());
            this.relayout();
        });

        this.addLabelled(toolbar, label, tip, combo);
    }

    /**
     * Appends a labelled spinner that applies a pixel spacing to the flow and
     * re-lays-out the content.
     *
     * @param toolbar - The toolbar to append to.
     * @param label - The caption shown before the spinner.
     * @param tip - Hover description of what the setting does.
     * @param current - The flow's current spacing (the initial value).
     * @param apply - Pushes the chosen value into the matching flow setter.
     */
    private addNumberSetting(toolbar: ToolBar, label: string, tip: string, current: number, apply: (value: number) => void): void {
        const spinner = new NumberSpinner({
            min:   0,
            max:   100,
            step:  1,
            value: current,
        });

        spinner.setPreferredSize({ width: NUMBER_CONTROL_WIDTH_PX, height: spinner.getPreferredSize()?.height ?? 0 });
        spinner.setMaxSize({ width: NUMBER_CONTROL_WIDTH_PX, height: spinner.getMaxSize()?.height ?? 0 });
        spinner.on("change", () => {
            apply(spinner.getValue());
            this.relayout();
        });

        this.addLabelled(toolbar, label, tip, spinner);
    }

    /**
     * Appends a caption + control pair to the toolbar, wiring the same hover
     * tooltip onto both so the setting is discoverable whichever the pointer
     * lands on.
     *
     * @param toolbar - The toolbar to append to.
     * @param label - The caption text.
     * @param tip - Hover description shared by the caption and the control.
     * @param control - The input driving the setting.
     */
    private addLabelled(toolbar: ToolBar, label: string, tip: string, control: Component): void {
        const caption = new Text(label);

        Tooltip.attach(caption, tip);
        Tooltip.attach(control, tip);

        toolbar.addComponent(caption);
        toolbar.addComponent(control);
    }

    /**
     * Re-runs the inner flow's layout so a toolbar-driven setting change takes
     * effect at once (the flow setters mutate configuration but do not schedule
     * a layout on their container).
     */
    private relayout(): void {
        this.inner.doLayout();
    }
}

export { FlowDemoPanel };
