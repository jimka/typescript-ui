// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { CSS } from "../CSS.js";
import { Event } from "../Event.js";
import { Label } from "./Label.js";

/**
 * A single row inside an `AutoCompleteDropdown`.
 *
 * Renders a text label with hover and keyboard-highlight states. Unlike
 * `ContextMenuItem`, this item is mutable after construction so the dropdown
 * can reuse the DOM pool across keystrokes.
 */
export class AutoCompleteItem extends Component {

    /** Fixed pixel height of every autocomplete item row. */
    static readonly HEIGHT: number = 24;

    private label: Label;
    private hoverCSSRule: CSSStyleRule;
    private highlighted: boolean;
    private clickListener: (value: string) => void;
    private readonly onSelect: (value: string) => void;
    private text: string;

    /**
     * @param text - The suggestion text to display.
     * @param onSelect - Called with the item text when the user clicks or selects this item.
     */
    constructor(text: string, onSelect: (value: string) => void) {
        super();

        this.text        = text;
        this.onSelect    = onSelect;
        this.highlighted = false;

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

        this.label = new Label(text);
        this.label.setPointerEvents("none");
        this.label.setElementCSSRule("lineHeight", AutoCompleteItem.HEIGHT + "px");
        this.label.setElementCSSRule("whiteSpace", "nowrap");
        this.label.setElementCSSRule("overflow", "hidden");
        this.label.setElementCSSRule("textOverflow", "ellipsis");
        this.addComponent(this.label);

        this.clickListener = () => {
            this.onSelect(this.text);
        };

        Event.addListener(this, "click", this.clickListener);
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
        this.label.setText(text);
    }

    /**
     * Toggles the keyboard-navigation highlight state.
     *
     * @param highlighted - True to apply highlight styling; false to clear it.
     */
    setHighlighted(highlighted: boolean): void {
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
     * Positions the label to fill the item with 8 px horizontal padding.
     */
    doLayout(): void {
        super.doLayout();

        this.label.setX(8);
        this.label.setY(0);
        this.label.setWidth(Math.max(0, this.getWidth() - 16));
        this.label.setHeight(AutoCompleteItem.HEIGHT);
    }
}
