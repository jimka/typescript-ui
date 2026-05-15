// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { CSS } from "~/core/CSS.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link AutoCompleteItem}.
 *
 * @category Components
 */
export interface AutoCompleteItemOptions extends ComponentOptions {
    text?:        string;
    highlighted?: boolean;
}

/**
 * A single row inside an `AutoCompleteDropdown`.
 *
 * Renders a text label with hover and keyboard-highlight states. Unlike
 * [`MenuItem`](/api/component/container/classes/MenuItem), this item is mutable after construction so the dropdown
 * can reuse the DOM pool across keystrokes.
 */
class AutoCompleteItem extends Component {

    /** Fixed pixel height of every autocomplete item row. */
    static readonly HEIGHT: number = 24;

    private textComponent: Text;
    private hoverCSSRule: CSSStyleRule;
    private highlighted: boolean = false;
    private clickListener: (value: string) => void;
    private readonly onSelect: (value: string) => void;
    private text: string;

    /**
     * @param text - The suggestion text to display.
     * @param onSelect - Called with the item text when the user clicks or selects this item.
     */
    constructor(text: string, onSelect: (value: string) => void, options?: AutoCompleteItemOptions) {
        super();

        this.text     = text;
        this.onSelect = onSelect;

        this.hoverCSSRule = CSS.createComponentRule(this.getId() + ":hover") as CSSStyleRule;
        this.hoverCSSRule.style.setProperty(
            "background-color",
            "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))"
        );

        this.setHeight(AutoCompleteItem.HEIGHT);
        this.setPreferredSize(0, AutoCompleteItem.HEIGHT);
        this.setBackgroundColor("transparent");
        this.setCursor("pointer");
        this.getAria().setRole("option");
        this.getAria().setSelected(false);

        this.textComponent = new Text(text);
        this.textComponent.setPointerEvents("none");
        this.textComponent.centerInHeight(AutoCompleteItem.HEIGHT);
        this.textComponent.setElementCSSRule("whiteSpace", "nowrap");
        this.textComponent.setElementCSSRule("overflow", "hidden");
        this.textComponent.setElementCSSRule("textOverflow", "ellipsis");
        this.addComponent(this.textComponent);

        this.clickListener = () => {
            this.onSelect(this.text);
        };

        Event.addListener(this, "click", this.clickListener);

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link AutoCompleteItemOptions} bag, dispatching displayed
     * text and highlight state after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: AutoCompleteItemOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) {
            this.update(options.text);
        }

        if (options.highlighted !== undefined) {
            this.setHighlighted(options.highlighted);
        }

        return this;
    }

    /**
     * Returns the suggestion text this item currently displays.
     *
     * @returns The current text string.
     */
    getText(): string {
        return this.text;
    }

    /**
     * Updates the displayed suggestion text in place without recreating the DOM element.
     *
     * @param text - The new suggestion string to show.
     */
    update(text: string): void {
        this.text = text;
        this.textComponent.setText(text);
    }

    /**
     * Toggles the keyboard-navigation highlight state.
     *
     * @param highlighted - True to apply highlight styling; false to clear it.
     */
    setHighlighted(highlighted: boolean): this {
        this.highlighted = highlighted;

        if (highlighted) {
            this.setBackgroundColor(
                "var(--ts-ui-autocomplete-item-highlight-bg, rgba(30, 100, 200, 0.18))"
            );
            this.setForegroundColor(
                "var(--ts-ui-autocomplete-item-highlight-color, inherit)"
            );
            this.getAria().setSelected(true);
        } else {
            this.setBackgroundColor("transparent");
            this.setForegroundColor("inherit");
            this.getAria().setSelected(false);
        }

        return this;
    }

    /**
     * Returns whether this item is currently keyboard-highlighted.
     *
     * @returns True if the item is highlighted.
     */
    isHighlighted(): boolean {
        return this.highlighted;
    }

    /**
     * Returns the offset from the top of the item to the label's text baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the label has no baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this.textComponent.getBaseline());
    }

    /**
     * Positions the label to fill the item with 8 px horizontal padding.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this.textComponent.setX(8);
        this.textComponent.setY(0);
        this.textComponent.setWidth(Math.max(0, this.getWidth() - 16));
        this.textComponent.setHeight(AutoCompleteItem.HEIGHT);

        return this;
    }
}

const AutoCompleteItemCallable = callable(AutoCompleteItem);
type AutoCompleteItemCallable = AutoCompleteItem;
export {
    AutoCompleteItem         as _AutoCompleteItem,
    AutoCompleteItemCallable as AutoCompleteItem
};
