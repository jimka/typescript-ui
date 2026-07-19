// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Panel } from '@jimka/typescript-ui/core';
import { Absolute, HBox } from '@jimka/typescript-ui/layout';
import {
    ComboBox,
    AutoCompleteField,
    Checkbox,
    CheckboxOptions,
    DateField,
    DateTimeField,
    Label,
    NumberSpinner,
    RadioButton,
    Slider,
    SliderOptions,
    Text,
    TextArea,
    TextField,
    TimeField,
    Toggle,
    ToggleOptions,
} from '@jimka/typescript-ui/component/input';
import { Button, ToggleButton } from '@jimka/typescript-ui/component/button';
import { Glyph, ProgressBar, ProgressSpinner } from '@jimka/typescript-ui/component/display';

/** Vertical gap from the tab bar to the control row, in pixels. */
const ROW_TOP_OFFSET = 40;

/**
 * Visual baseline-alignment diagnostic.
 *
 * Lays every baseline-bearing control out in a single {@link HBox} row and
 * overlays a 1px ruler at the row's common text baseline — the exact
 * `rowAscent` line the HBox aligns every child to (see
 * `HBox.doLayout` / `LayoutManager.computeRowMetrics`). A control whose text
 * sits *on* the line reports a correct {@link Component.getBaseline}; a control
 * whose text floats above or below the line has a wrong baseline measurement
 * and is what needs adjusting.
 */
class BaselinePanel extends Panel {

    private readonly _row:          Component;
    private readonly _textArea:     TextArea;
    private readonly _baselineLine: Component;
    private readonly _topLine:      Component;
    private readonly _bottomLine:   Component;

    constructor() {
        super();

        // Absolute layout so the row and the overlay ruler each sit at the
        // position we set (0,0 for the row; the ruler's Y is recomputed in
        // doLayout). Horizontal autoScroll lets the wide single row scroll
        // rather than compress the controls below their natural size.
        this.setLayoutManager(new Absolute());
        this.setAutoScroll("auto");

        this._row = new Component();
        this._row.setLayoutManager(new HBox({ spacing: 16 }));

        // Plain text first — the ground-truth baseline to compare against.
        this._row.addComponent(new Text("Reference"));
        this._row.addComponent(new Label("Label", "baseline-ref"));
        this._row.addComponent(new TextField({ text: "Field" }));
        this._textArea = new TextArea("Area");
        this._row.addComponent(this._textArea);

        const combo = new ComboBox();
        combo.addItem("First");
        combo.addItem("Second");
        this._row.addComponent(combo);

        // Fixed timestamp so the picker fields render stable, comparable text.
        const sample = new Date(2026, 0, 15, 9, 30);

        const auto = new AutoCompleteField();
        auto.setValue("Auto");
        this._row.addComponent(auto);

        this._row.addComponent(new DateField({ value: sample }));
        this._row.addComponent(new TimeField({ value: sample }));
        this._row.addComponent(new DateTimeField({ value: sample }));
        this._row.addComponent(new NumberSpinner({ value: 42 }));
        this._row.addComponent(new Checkbox<CheckboxOptions>({ label: "Check" }));
        this._row.addComponent(new RadioButton("Radio"));
        this._row.addComponent(new Toggle<ToggleOptions>({ label: "Toggle" }));
        this._row.addComponent(new Slider<SliderOptions>({ value: 50 }));
        this._row.addComponent(new Button("Button"));
        this._row.addComponent(new ToggleButton("ToggleBtn"));
        this._row.addComponent(new Glyph("xmark"));
        this._row.addComponent(new ProgressBar(50, false, { preferredSize: { width: 120, height: 12 } }));
        this._row.addComponent(new ProgressSpinner(16));

        this.addComponent(this._row);
        // Drop the row clear of the tab bar above so the baseline ruler (which
        // tracks the row's Y) doesn't hug the tabs. Absolute honours this Y.
        this._row.setY(ROW_TOP_OFFSET);

        // Overlay rulers: pinned on top, repositioned in doLayout. The red
        // baseline line marks the row's common text baseline; the two blue
        // lines bracket the components' top and bottom edges so their relative
        // sizes are visible. The initial 1px size is a placeholder Absolute
        // lays out before the override stretches each across the row.
        this._baselineLine = this.addRuler("var(--ts-ui-error-color, red)");
        this._topLine      = this.addRuler("var(--ts-ui-accent-color, blue)");
        this._bottomLine   = this.addRuler("var(--ts-ui-accent-color, blue)");
    }

    /**
     * Builds a 1px overlay ruler, adds it on top of the panel, and returns it.
     *
     * @param color - The ruler's background colour.
     * @returns The ruler component.
     */
    private addRuler(color: string): Component {
        const ruler = new Component({
            preferredSize:   { width: 1, height: 1 },
            backgroundColor: color,
            zIndex:          1000,
        });

        this.addComponent(ruler);

        return ruler;
    }

    /**
     * Lays the row out, then drops the baseline ruler at the row's common
     * baseline — `rowAscent`, the max child baseline, which is the exact line
     * HBox aligns every text-bearing child to.
     */
    doLayout(): this {
        super.doLayout();

        // `setLayoutManager` / `setAutoScroll` in the constructor trigger a
        // layout pass before the field assignments below them run, so guard
        // against the row/rulers not existing yet during that super-cascade.
        if (this._row && this._baselineLine && this._topLine && this._bottomLine) {
            this.positionRulers();
        }

        return this;
    }

    /**
     * Positions the three overlay rulers from the laid-out children: the red
     * baseline at `rowAscent` (max child baseline, matching
     * {@link LayoutManager.computeRowMetrics}), and the two blue lines at the
     * highest child top and lowest child bottom. All three share the row's Y
     * origin so the spans line up.
     */
    private positionRulers(): void {
        const rowY  = this._row.getY();
        const width = Math.max(this._row.getWidth(), this.getInnerSize()?.width ?? 0);

        let rowAscent: number | null = null;
        let minTop    = Number.POSITIVE_INFINITY;
        let maxBottom = Number.NEGATIVE_INFINITY;

        for (const child of this._row.getComponents()) {
            const top = child.getY();

            minTop = Math.min(minTop, top);

            // The TextArea is naturally far taller than the single-line
            // controls, so excluding it keeps the bottom ruler meaningful for
            // comparing the rest.
            if (child !== this._textArea) {
                maxBottom = Math.max(maxBottom, top + child.getHeight());
            }

            const baseline = child.getBaseline();
            if (baseline !== null && (rowAscent === null || baseline > rowAscent)) {
                rowAscent = baseline;
            }
        }

        if (rowAscent !== null) {
            // `child.getY()` already folds in the row's content-inset top, so
            // the baseline lands at the same origin as the top/bottom lines.
            const baseTop = rowY + this._row.getContentInsets().getTop();
            this.placeRuler(this._baselineLine, baseTop + rowAscent, width);
        }

        if (Number.isFinite(minTop)) {
            this.placeRuler(this._topLine,    rowY + minTop,    width);
            this.placeRuler(this._bottomLine, rowY + maxBottom, width);
        }
    }

    /**
     * Pins a ruler at the given Y and stretches it across the row width.
     *
     * @param ruler - The ruler component to position.
     * @param y     - The Y coordinate, in the row's coordinate space.
     * @param width - The width to span.
     */
    private placeRuler(ruler: Component, y: number, width: number): void {
        ruler.setY(y);
        ruler.setWidth(width);
    }
}

const BaselinePanelCallable = callable(BaselinePanel);
type BaselinePanelCallable = BaselinePanel;
export {
    BaselinePanel         as _BaselinePanel,
    BaselinePanelCallable as BaselinePanel
};
