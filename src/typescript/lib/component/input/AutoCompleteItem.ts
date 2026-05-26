// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
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

    private _textComponent: Text;
    private _highlighted: boolean = false;
    private _clickListener: (value: string) => void;
    private readonly _onSelect: (value: string) => void;
    private _text: string;

    /**
     * @param text - The suggestion text to display.
     * @param onSelect - Called with the item text when the user clicks or selects this item.
     */
    constructor(text: string, onSelect: (value: string) => void, options?: AutoCompleteItemOptions) {
        super({
            ...options,
            styleRules: [
                ...(options?.styleRules ?? []),
                {
                    suffix: ":hover",
                    styles: {
                        backgroundColor: "var(--ts-ui-autocomplete-item-hover-bg, rgba(30, 100, 200, 0.08))",
                    },
                },
            ],
        });

        this._text     = text;
        this._onSelect = onSelect;

        this.setHeight(AutoCompleteItem.HEIGHT);
        this.setPreferredSize(0, AutoCompleteItem.HEIGHT);
        this.setBackgroundColor("transparent");
        this.setCursor("pointer");
        this.getAria().setRole("option");
        this.getAria().setSelected(false);

        this._textComponent = new Text(text);
        this._textComponent.setPointerEvents("none");
        this._textComponent.centerInHeight(AutoCompleteItem.HEIGHT);
        this._textComponent.setWhiteSpace("nowrap");
        this._textComponent.setOverflow("hidden");
        this._textComponent.setTextOverflow("ellipsis");
        this.addComponent(this._textComponent);

        this._clickListener = () => {
            this._onSelect(this._text);
        };

        Event.addListener(this, "click", this._clickListener);

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

        const opts = { ...this._defaultOptions, ...options } as AutoCompleteItemOptions;

        if (opts.text !== undefined) {
            this.update(opts.text);
        }

        if (opts.highlighted !== undefined) {
            this.setHighlighted(opts.highlighted);
        }

        return this;
    }

    /**
     * Returns the suggestion text this item currently displays.
     *
     * @returns The current text string.
     */
    getText(): string {
        return this._text;
    }

    /**
     * Updates the displayed suggestion text in place without recreating the DOM element.
     *
     * @param text - The new suggestion string to show.
     */
    update(text: string): void {
        this._text = text;
        this._textComponent.setText(text);
    }

    /**
     * Toggles the keyboard-navigation highlight state.
     *
     * @param highlighted - True to apply highlight styling; false to clear it.
     */
    setHighlighted(highlighted: boolean): this {
        this._highlighted = highlighted;

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
        return this._highlighted;
    }

    /**
     * Returns the offset from the top of the item to the label's text baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the label has no baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this._textComponent.getBaseline());
    }

    /**
     * Positions the label to fill the item with 8 px horizontal padding.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this._textComponent.setX(8);
        this._textComponent.setY(0);
        this._textComponent.setWidth(Math.max(0, this.getWidth() - 16));
        this._textComponent.setHeight(AutoCompleteItem.HEIGHT);

        return this;
    }
}

const AutoCompleteItemCallable = callable(AutoCompleteItem);
type AutoCompleteItemCallable = AutoCompleteItem;
export {
    AutoCompleteItem         as _AutoCompleteItem,
    AutoCompleteItemCallable as AutoCompleteItem
};
