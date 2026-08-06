// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * Construction-time options for {@link SortPriorityBadge}.
 *
 * @category Components
 */
interface SortPriorityBadgeOptions extends ComponentOptions {
    priority?: number | null;
}

let _classRule: StyleRule | null = null;

/**
 * Registers the shared `.SortPriorityBadge` class rule once on first use. The
 * rule holds the absolute-position overlay geometry (position, top, right,
 * font-size, line-height, border-radius, padding, pointer-events) so
 * per-instance setters only carry per-instance state (background, color,
 * visibility, text).
 *
 * Idempotent and module-local; safe across hot reloads.
 */
function ensureSortBadgeClassRule(): void {
    if (_classRule) {
        return;
    }

    _classRule = new StyleRule({
        scope:  "class",
        name:   "SortPriorityBadge",
        styles: {
            position:      "absolute",
            top:           "2px",
            right:         "8px",
            fontSize:      "var(--ts-ui-sort-badge-font-size, var(--ts-ui-font-size))",
            lineHeight:    "1",
            borderRadius:  "3px",
            padding:       "1px 3px",
            pointerEvents: "none",
        },
    });
}

const _defaultSortPriorityBadgeOptions: Partial<SortPriorityBadgeOptions> = {
    backgroundColor: "var(--ts-ui-sort-badge-bg, rgba(0,0,0,0.15))",
    foregroundColor: "var(--ts-ui-sort-badge-color, inherit)",
};

/**
 * A small numeric badge anchored to the top-right corner of a table header
 * cell, used to surface the multi-sort priority (1-based) of that column.
 *
 * Lives as a side-loaded overlay on the `<th>` (its `position:absolute` plus
 * the host cell's [`Card`](/api/layout/classes/Card) layout keep it out of
 * the cell renderer's flow). The badge stays hidden for priority `null`,
 * `0`, and `1` — the leading sort needs no number because the arrow on the
 * header label already conveys direction.
 *
 * The static overlay geometry lives in a shared `.SortPriorityBadge` class
 * rule registered on first use. The background and foreground colours are
 * per-instance values written through typed Component setters in the
 * constructor.
 *
 * @category Components
 */
class SortPriorityBadge extends Component<SortPriorityBadgeOptions> {

    declare private _priority: number | null;

    /**
     * Constructs a sort-priority badge. The badge starts hidden until
     * {@link setPriority} writes a priority of 2 or greater.
     *
     * @param options - Optional configuration bag (initial priority plus
     *   common Component fields).
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: SortPriorityBadgeOptions, subclassDefaults?: Partial<SortPriorityBadgeOptions>) {
        ensureSortBadgeClassRule();

        super({ tag: "span", ...(options ?? {}) }, { ..._defaultSortPriorityBadgeOptions, ...(subclassDefaults ?? {}) });

        this._priority ??= null;

        this.setVisible(this._shouldShow(this._priority));
    }

    /**
     * Applies a {@link SortPriorityBadgeOptions} bag. The priority field is
     * written pure to the backing field here; inherited Component fields
     * cascade through `super.applyOptions`.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: SortPriorityBadgeOptions): this {
        super.applyOptions(options);

        if (options.priority !== undefined) {
            this._priority = options.priority;
        }

        return this;
    }

    /**
     * Renders the root span and flushes the cached priority into
     * `textContent` and visibility.
     *
     * @returns The rendered root element handle.
     */
    protected render(): Handle {
        const element = super.render();

        DOM.sink.apply(element, { text: this._priorityText() });

        return element;
    }

    /**
     * Returns the priority last written via {@link setPriority}, or `null`.
     *
     * @returns The current priority, or null when none has been set.
     */
    getPriority(): number | null {
        return this._priority;
    }

    /**
     * Sets the multi-sort priority. Priorities below 2 collapse to hidden
     * because the leading sort indicator on the header label is sufficient
     * without a numeric badge.
     *
     * @param value - The 1-based priority, or `null` to clear.
     * @returns This component, for method chaining.
     */
    setPriority(value: number | null): this {
        this._priority = value;

        const element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { text: this._priorityText() });
        }

        this.setVisible(this._shouldShow(value));

        return this;
    }

    /**
     * Clears the priority (equivalent to `setPriority(null)`).
     *
     * @returns This component, for method chaining.
     */
    clearPriority(): this {
        return this.setPriority(null);
    }

    /**
     * Returns the priority rendered as a string, or the empty string when
     * the badge should not display text.
     *
     * @returns The text content for the current priority value.
     */
    private _priorityText(): string {
        return this._shouldShow(this._priority) ? String(this._priority) : "";
    }

    /**
     * Returns `true` when the given priority should make the badge visible.
     *
     * @param value - The priority value to evaluate.
     * @returns True if a badge with this priority should display.
     */
    private _shouldShow(value: number | null): boolean {
        return value != null && value >= 2;
    }
}

const SortPriorityBadgeCallable = callable(SortPriorityBadge);
type SortPriorityBadgeCallable = SortPriorityBadge;
export {
    SortPriorityBadge         as _SortPriorityBadge,
    SortPriorityBadgeCallable as SortPriorityBadge
};
