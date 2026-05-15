// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { Event } from "~/core/Event.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link TextArea}.
 *
 * @category Components
 */
export interface TextAreaOptions extends TextInputOptions {
    rows?: number;
    cols?: number;
    wrap?: string;
}

/**
 * A multi-line text area component backed by a `<textarea>` element.
 *
 * Keeps internal text state in sync with the DOM on every input event.
 *
 * @category Components
 */
class TextArea extends TextInput {

    private rows: number | null = null;
    private cols: number | null = null;
    private wrap: string | null = null;

    constructor(text: string = "", options?: TextAreaOptions) {
        super({ tag: "textarea" });

        this.setCursor("text");
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setPreferredSize(200, 200);
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");
        if (text) {
            this.setText(text);
        }

        Event.addListener(this, "input", this.onInput);

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link TextAreaOptions} bag, dispatching textarea-specific
     * `rows`, `cols`, and `wrap` attributes after inherited TextInput fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TextAreaOptions): this {
        super.applyOptions(options);

        if (options.rows !== undefined) {
            this.setRows(options.rows);
        }

        if (options.cols !== undefined) {
            this.setCols(options.cols);
        }

        if (options.wrap !== undefined) {
            this.setWrap(options.wrap);
        }

        return this;
    }

    /**
     * Returns the configured `rows` attribute value, or null if not set.
     *
     * @returns The row count, or null.
     */
    getRows(): number | null {
        return this.rows;
    }

    /**
     * Sets the HTML `rows` attribute on the underlying textarea.
     *
     * @param value - The number of visible text rows.
     *
     * @returns This component, for method chaining.
     */
    setRows(value: number): this {
        this.rows = value;
        this.setElementAttribute("rows", String(value));

        return this;
    }

    /**
     * Returns the configured `cols` attribute value, or null if not set.
     *
     * @returns The column count, or null.
     */
    getCols(): number | null {
        return this.cols;
    }

    /**
     * Sets the HTML `cols` attribute on the underlying textarea.
     *
     * @param value - The visible width in average character widths.
     *
     * @returns This component, for method chaining.
     */
    setCols(value: number): this {
        this.cols = value;
        this.setElementAttribute("cols", String(value));

        return this;
    }

    /**
     * Returns the configured `wrap` attribute value, or null if not set.
     *
     * @returns The wrap mode, or null.
     */
    getWrap(): string | null {
        return this.wrap;
    }

    /**
     * Sets the HTML `wrap` attribute on the underlying textarea.
     *
     * @param value - The wrap mode (e.g. "hard", "soft", "off").
     *
     * @returns This component, for method chaining.
     */
    setWrap(value: string): this {
        this.wrap = value;
        this.setElementAttribute("wrap", value);

        return this;
    }

    /**
     * Returns `null` so a `TextArea` is treated as a graphical / replaced element
     * by horizontal layouts.
     *
     * @returns Always `null`.
     *
     * @remarks A multi-line text area's box height is far larger than its first
     * line of text, so participating in baseline alignment would drag every
     * surrounding text label down by the area's vertical extent. Treating it as
     * a baseline-less block lets the row keep its text labels in place.
     */
    getBaseline(): number | null {
        return null;
    }

    /**
     * Cleanup hook; currently a no-op placeholder.
     */
    destructor() {
        //Util.removeListener("input", this.onInput);
    }

    /**
     * Syncs the text content from the DOM element's value on every input event.
     */
    onInput() {
        let element = this.getElement();
        this.setText(element.value);
    }

    /**
     * Registers a listener for the 'input' event, fired on every keystroke.
     *
     * @param listener - The callback to invoke on each input event.
     */
    addActionListener(listener: Function) : this {
        Event.addListener(this, "input", listener);

        return this;
    }

    /**
     * Renders the textarea element with CSS resize disabled.
     *
     * @returns The created textarea element with resize set to "none".
     */
    render() {
        let element = super.render();

        element.style.resize = "none";

        return element;
    }
}

const TextAreaCallable = callable(TextArea);
type TextAreaCallable = TextArea;
export {
    TextArea         as _TextArea,
    TextAreaCallable as TextArea
};
