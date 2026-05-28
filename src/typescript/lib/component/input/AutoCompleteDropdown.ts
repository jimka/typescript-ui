// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { Event } from "~/core/Event.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Fit } from "~/layout/Fit.js";
import { List } from "~/component/list/List.js";
import { callable } from "~/core/Callable.js";

/** Pixel height of a single row inside the dropdown. Matches `CustomListRow`'s cached `preferredSize(0, 22)`. */
const AUTOCOMPLETE_DROPDOWN_ROW_HEIGHT_PX = 22;

/**
 * Construction-time options for {@link AutoCompleteDropdown}.
 *
 * @category Components
 */
export interface AutoCompleteDropdownOptions extends AnimatedDropdownOptions {}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultAutoCompleteDropdownOptions: Partial<AutoCompleteDropdownOptions> = {
    zIndex:          10050,
    durationMs:      100,
    backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
    border:          "var(--ts-ui-input-border)",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
};

// The dropdown wrapper carries the visible chrome (border / radius /
// shadow); the embedded List inherits a `:focus::after` ring from
// `AbstractCustomList`, which would paint a second ring inside the
// dropdown if any code path programmatically focused the list. The
// host-forwarded keystroke pattern keeps DOM focus on the TextField
// throughout the dropdown's lifetime, but the suppression is
// belt-and-braces — a future code path that does focus the list won't
// double-stack the chrome.
(() => {
    new StyleRule({
        scope:  "selector",
        name:   ".AutoCompleteDropdown .List:focus::after",
        styles: {
            content: "none",
        },
    });
})();

/**
 * Floating dropdown panel for [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField).
 *
 * Hosts a single [`List`](/api/component/list/classes/List) instance that
 * owns the row pool, the click-commit gesture, the keyboard reducer, the
 * type-ahead buffer, and the ARIA `option`-role wiring. The dropdown
 * wrapper handles only the overlay lifecycle (fade, anchored positioning,
 * viewport click-outside dismiss). Selection-follows-focus is disabled on
 * the inner list so ArrowUp/Down moves the focus highlight without
 * committing the row as the TextField's value; Enter / click still commit
 * through the list's `change` event.
 */
class AutoCompleteDropdown extends AnimatedDropdown<AutoCompleteDropdownOptions> {

    private readonly _list: List;
    private readonly _onSelect: (value: string) => void;
    private readonly _onHide: () => void;
    private readonly _onViewportMouseDown: (e: MouseEvent) => void;

    /**
     * @param onSelect - Called with the selected suggestion string when the user picks an item.
     * @param onHide - Called whenever the dropdown hides, including via viewport click-outside.
     * @param options - Optional construction-time options.
     */
    constructor(onSelect: (value: string) => void, onHide: () => void, options?: AutoCompleteDropdownOptions) {
        super(options, _defaultAutoCompleteDropdownOptions);

        this._onSelect = onSelect;
        this._onHide   = onHide;

        // The inner List already exposes `role="listbox"` from
        // `AbstractCustomList`; the dropdown wrapper just provides the
        // overlay chrome and must not duplicate the listbox role
        // (nested listboxes break assistive-tech enumeration of the
        // `option` rows).
        this.setContain("layout");
        this.setLayoutManager(new Fit());

        // `Fit` makes the inner list fill the dropdown's content box. The
        // list's own border is stripped — the dropdown root carries the
        // visible chrome (border + radius + shadow) so the two never
        // double-stack. Focus-on-row-click is disabled because the host
        // TextField keeps DOM focus throughout the dropdown's lifetime;
        // letting the list grab focus on a row click would blur the
        // TextField and tear down the autocomplete session before
        // `_onSelect` runs. Selection-follows-focus is disabled so
        // ArrowUp/Down previews a row without writing it into the
        // TextField — Enter / click still commit through `change`.
        this._list = new List();
        this._list.setBorder("none");
        this._list.setBorderRadius("0");
        this._list.setFocusOnRowClick(false);
        this._list.setSelectFollowsFocus(false);
        this.addComponent(this._list);

        // Click and keyboard commits both arrive through the list's
        // `change` event (fired by `notifyUserChange` after the click /
        // keyboard reducer mutates the selection set). Programmatic
        // writes (`setItemsArray`) bypass this path, so re-opening the
        // dropdown doesn't trigger a spurious commit.
        this._list.addActionListener(() => {
            const value = this._list.getValue();

            if (value) {
                this._onSelect(value);
            }
        });

        this._onViewportMouseDown = (e: MouseEvent) => {
            if (!this.getElement()?.contains(e.target as Node)) {
                this.hide();
            }
        };
    }

    /**
     * Shows the dropdown anchored relative to `anchorEl`, rendering the
     * given suggestions. Key + label are identical so the list's
     * `getValue()` returns the picked suggestion text directly.
     *
     * @param anchorEl - The input element to anchor the dropdown to.
     * @param suggestions - The list of suggestion strings to display.
     *
     * @returns This dropdown, for method chaining.
     */
    show(anchorEl: HTMLElement, suggestions: string[]): this {
        // Force the floating element into existence before any layout pass.
        // showAnimated() below mounts it, but that runs after doLayout() —
        // on first show getInnerSize() would otherwise return null and the
        // inner list's Fit layout would have nothing to fill.
        this.getElement(true);

        this.pauseLayout();
        this._list.setItemsArray(suggestions.map(s => ({ key: s, label: s })));
        this.resumeLayout();

        const perim   = this.getPerimiterSize();
        const chromeH = perim.top + perim.bottom;
        const rect    = anchorEl.getBoundingClientRect();

        this.setWidth(rect.width);
        this.setHeight(suggestions.length * AUTOCOMPLETE_DROPDOWN_ROW_HEIGHT_PX + chromeH);

        this.placeAnchored(rect);

        this.showAnimated();

        // VBox-backed list positions rows via framework setters that no-op
        // while the dropdown element is detached. Run the layout pass
        // after `showAnimated` mounts the panel so rows land at the
        // correct y offsets on first open.
        this.doLayout();

        Event.addViewportListener(this, "mousedown", this._onViewportMouseDown);

        return this;
    }

    /**
     * Hides the dropdown, detaches it from the DOM, and fires the `onHide` callback.
     */
    hide(): this {
        Event.removeViewportListener(this, "mousedown", this._onViewportMouseDown);

        this.hideAnimated();

        return this;
    }

    /**
     * Forwards a keystroke from the host
     * [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField)
     * (which keeps DOM focus on its TextField while the dropdown is
     * open) into the inner list's keyboard reducer. Mirrors
     * [`AnimatedDropdown.handleKey`](/api/core/classes/AnimatedDropdown#handlekey).
     * Returns `true` when the list consumed the key so the host can
     * `preventDefault` and stop further processing.
     *
     * @param e - The keyboard event captured by the host.
     *
     * @returns `true` when the list consumed the key.
     */
    handleKey(e: KeyboardEvent): boolean {
        return this._list.handleKey(e);
    }

    /**
     * Returns the framework-generated DOM element id of the inner list's
     * keyboard-focus row, suitable for writing into the host TextField's
     * `aria-activedescendant`. Returns `null` when no row holds focus.
     *
     * @returns The focused row's element id, or `null`.
     */
    getFocusedRowId(): string | null {
        return this._list.getFocusedRowId();
    }

    /**
     * Returns the inner [`List`](/api/component/list/classes/List). Test
     * seam — production code should not reach past the dropdown's
     * documented surface.
     *
     * @returns The hosted list instance.
     */
    getList(): List {
        return this._list;
    }

    /**
     * Fires the `onHide` callback once the exit fade has completed and the
     * panel is detached from the DOM.
     */
    protected onHideComplete(): void {
        this._onHide();
    }
}

const AutoCompleteDropdownCallable = callable(AutoCompleteDropdown);
type AutoCompleteDropdownCallable = AutoCompleteDropdown;
export {
    AutoCompleteDropdown         as _AutoCompleteDropdown,
    AutoCompleteDropdownCallable as AutoCompleteDropdown
};
