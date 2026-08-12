// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * Construction-time options for {@link FilterClauseBadge}.
 *
 * @category Components
 */
interface FilterClauseBadgeOptions extends ComponentOptions {
    count?: number | null;
}

let _classRule: StyleRule | null = null;

/**
 * Registers the shared `.FilterClauseBadge` class rule once on first use. The
 * rule holds the absolute-position overlay geometry (position, top, right,
 * font-size, line-height, border-radius, padding, pointer-events) so
 * per-instance setters only carry per-instance state (background, color,
 * visibility, text) — mirrors {@link SortPriorityBadge}'s own class rule.
 *
 * Idempotent and module-local; safe across hot reloads.
 */
function ensureFilterClauseBadgeClassRule(): void {
    if (_classRule) {
        return;
    }

    _classRule = new StyleRule({
        scope:  "class",
        name:   "FilterClauseBadge",
        styles: {
            position:      "absolute",
            top:           "2px",
            right:         "8px",
            fontSize:      "var(--ts-ui-filter-clause-badge-font-size, var(--ts-ui-font-size))",
            lineHeight:    "1",
            borderRadius:  "3px",
            padding:       "1px 3px",
            pointerEvents: "none",
        },
    });
}

const _defaultFilterClauseBadgeOptions: Partial<FilterClauseBadgeOptions> = {
    backgroundColor: "var(--ts-ui-filter-clause-badge-bg, rgba(0,0,0,0.15))",
    foregroundColor: "var(--ts-ui-filter-clause-badge-color, inherit)",
};

/**
 * A small numeric badge anchored to the top-right corner of a table filter
 * cell, used to surface the count of AND-combined conditions held by that
 * column's {@link FilterCell} once there are 2 or more.
 *
 * Lives as a side-loaded overlay on the cell's `<th>` (its `position:absolute`
 * plus the host cell's [`Card`](/api/layout/classes/Card) layout keep it out
 * of the cell renderer's flow), mirroring
 * [`SortPriorityBadge`](/api/component/table/classes/SortPriorityBadge)'s own
 * placement. The badge stays hidden for a count of `null`, `0`, and `1` — a
 * column with zero or one condition renders exactly as it did before this
 * badge existed.
 *
 * A dedicated class rather than a second use of `SortPriorityBadge`: its CSS
 * custom properties are named `--ts-ui-filter-clause-badge-bg` /
 * `--ts-ui-filter-clause-badge-color`, an independent token pair from the
 * multi-sort priority badge's own, so re-theming one badge never silently
 * re-themes the other.
 *
 * @category Components
 */
class FilterClauseBadge extends Component<FilterClauseBadgeOptions> {

    declare private _count: number | null;

    /**
     * Constructs a filter-clause-count badge. The badge starts hidden until
     * {@link setCount} writes a count of 2 or greater.
     *
     * @param options - Optional configuration bag (initial count plus common
     *   Component fields).
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: FilterClauseBadgeOptions, subclassDefaults?: Partial<FilterClauseBadgeOptions>) {
        ensureFilterClauseBadgeClassRule();

        super({ tag: "span", ...(options ?? {}) }, { ..._defaultFilterClauseBadgeOptions, ...(subclassDefaults ?? {}) });

        this._count ??= null;

        this.setVisible(this._shouldShow(this._count));
    }

    /**
     * Applies a {@link FilterClauseBadgeOptions} bag. The count field is
     * written pure to the backing field here; inherited Component fields
     * cascade through `super.applyOptions`.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: FilterClauseBadgeOptions): this {
        super.applyOptions(options);

        if (options.count !== undefined) {
            this._count = options.count;
        }

        return this;
    }

    /**
     * Renders the root span and flushes the cached count into `textContent`
     * and visibility.
     *
     * @returns The rendered root element handle.
     */
    protected render(): Handle {
        const element = super.render();

        DOM.sink.apply(element, { text: this._countText() });

        return element;
    }

    /**
     * Returns the count last written via {@link setCount}, or `null`.
     *
     * @returns The current count, or null when none has been set.
     */
    getCount(): number | null {
        return this._count;
    }

    /**
     * Sets the clause count. Counts below 2 collapse to hidden because a
     * column with zero or one condition needs no numeric badge.
     *
     * @param value - The clause count, or `null` to clear.
     * @returns This component, for method chaining.
     */
    setCount(value: number | null): this {
        this._count = value;

        const element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { text: this._countText() });
        }

        this.setVisible(this._shouldShow(value));

        return this;
    }

    /**
     * Returns the count rendered as a string, or the empty string when the
     * badge should not display text.
     *
     * @returns The text content for the current count value.
     */
    private _countText(): string {
        return this._shouldShow(this._count) ? String(this._count) : "";
    }

    /**
     * Returns `true` when the given count should make the badge visible.
     *
     * @param value - The count value to evaluate.
     * @returns True if a badge with this count should display.
     */
    private _shouldShow(value: number | null): boolean {
        return value != null && value >= 2;
    }
}

const FilterClauseBadgeCallable = callable(FilterClauseBadge);
type FilterClauseBadgeCallable = FilterClauseBadge;
export {
    FilterClauseBadge         as _FilterClauseBadge,
    FilterClauseBadgeCallable as FilterClauseBadge
};
