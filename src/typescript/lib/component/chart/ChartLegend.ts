// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Component } from "~/core/Component.js";
import { Text } from "~/component/input/Text.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { Insets } from "~/primitive/Insets.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";

/**
 * One legend entry: a series' name, its resolved swatch colour, and whether the
 * legend has toggled it hidden (rendered greyed).
 *
 * @category Components
 */
export interface ChartLegendEntry {
    /** The series' display name. */
    name: string;
    /** The resolved swatch colour (a concrete colour or a `var(--…)` binding). */
    color: string;
    /** Whether the entry is toggled off (rendered dimmed). */
    hidden?: boolean;
}

/**
 * The direction the legend arranges its entries: a vertical stack (docked to the
 * plot's right) or a horizontal row (docked above or below).
 *
 * @category Components
 */
export type ChartLegendOrientation = "vertical" | "horizontal";

/**
 * Construction-time options for {@link ChartLegend}.
 *
 * @category Components
 */
export interface ChartLegendOptions extends PanelOptions {
    /** The legend entries to render. */
    entries?: ChartLegendEntry[];
    /** Arrangement direction; defaults to `"vertical"`. */
    orientation?: ChartLegendOrientation;
    /** Construction-time listener bag for the `"toggle"` event. */
    listeners?: {
        toggle?: (seriesIndex: number) => void;
    };
}

/** Custom events emitted by {@link ChartLegend}. */
type ChartLegendEvent = "toggle";

/** Swatch square edge length in px — a compact colour chip beside each label. */
const SWATCH_SIZE = 12;

/** Opacity applied to a legend row whose series is toggled hidden. */
const HIDDEN_OPACITY = 0.4;

/**
 * A clickable chart legend: one row per series (colour swatch + name). A click
 * on a row emits `"toggle"(seriesIndex)` so the owning chart can hide/show that
 * series and repaint. Composed from existing components — an `HBox`/`VBox`
 * `Panel` of per-entry rows, each an `HBox` of a swatch `Component` and a
 * `Text` — rather than a specialised component.
 *
 * @category Components
 */
class ChartLegend extends Panel<ChartLegendOptions> {

    private _listeners: ListenerBag<ChartLegendEvent> = new ListenerBag<ChartLegendEvent>();
    private _rows: Component[] = [];
    private _entries: ChartLegendEntry[] = [];
    private _orientation: ChartLegendOrientation = "vertical";

    /**
     * Builds the legend and dispatches its own options from the constructor body
     * (not `applyOptions`, which runs inside the `super()` cascade before the
     * `ListenerBag` and row list exist).
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: ChartLegendOptions) {
        super(options);

        this.setBackgroundColor("transparent");
        this.clearInsets();
        this.applyOrientationLayout();

        this.dispatchLegendOptions(options);

        // A row click toggles its series. Subtree listener on self (never on a
        // child's own event surface), matching the framework's delegation rule.
        Event.addSubtreeListener(this, "click", this.handleRowClick);
    }

    /**
     * Dispatches the legend-specific options through their setters once the row
     * list and listener bag exist.
     *
     * @param options - The construction options, or `undefined`.
     */
    private dispatchLegendOptions(options?: ChartLegendOptions): void {
        if (!options) {
            return;
        }

        if (options.orientation !== undefined) {
            this.setOrientation(options.orientation);
        }

        if (options.entries !== undefined) {
            this.setEntries(options.entries);
        }

        this.applyListeners(options.listeners);
    }

    /**
     * Sets the arrangement direction and swaps the layout manager to match
     * (`VBox` for vertical, `HBox` for horizontal), then re-lays out.
     *
     * @param orientation - The arrangement direction.
     *
     * @returns This legend, for method chaining.
     */
    setOrientation(orientation: ChartLegendOrientation): this {
        this._orientation = orientation;

        this.applyOrientationLayout();

        return this;
    }

    /**
     * Returns the current arrangement direction.
     *
     * @returns The legend orientation.
     */
    getOrientation(): ChartLegendOrientation {
        return this._orientation;
    }

    /** Installs the layout manager matching the current orientation. */
    private applyOrientationLayout(): void {
        this.setLayoutManager(
            this._orientation === "vertical"
                ? new VBox({ spacing: 2, stretching: false })
                : new HBox({ spacing: 10, stretching: false })
        );
    }

    /**
     * Rebuilds the legend rows from `entries`: one row (swatch + name) per
     * entry, dimmed when the entry is hidden. Replaces any previous rows.
     *
     * @param entries - The entries to render.
     *
     * @returns This legend, for method chaining.
     */
    setEntries(entries: ChartLegendEntry[]): this {
        this._entries = entries.map((e) => ({ ...e }));

        this.removeAllComponents();
        this._rows = [];

        for (const entry of this._entries) {
            const row = this.buildRow(entry);

            this._rows.push(row);
            this.addComponent(row);
        }

        return this;
    }

    /**
     * Returns a copy of the current legend entries.
     *
     * @returns The entries.
     */
    getEntries(): ChartLegendEntry[] {
        return this._entries.map((e) => ({ ...e }));
    }

    /**
     * Builds one legend row: a horizontal swatch + name pair, dimmed when the
     * entry is hidden, with a pointer cursor to signal it is clickable.
     *
     * @param entry - The entry to render.
     *
     * @returns The row component.
     */
    private buildRow(entry: ChartLegendEntry): Component {
        const swatch = new Component({
            preferredSize:   { width: SWATCH_SIZE, height: SWATCH_SIZE },
            minSize:         { width: SWATCH_SIZE, height: SWATCH_SIZE },
            maxSize:         { width: SWATCH_SIZE, height: SWATCH_SIZE },
            backgroundColor: entry.color,
            borderRadius:    "2px",
        });

        const label = new Text(entry.name);

        return new Panel({
            layoutManager: new HBox({ spacing: 6, stretching: true }),
            insets:        new Insets(2, 4, 2, 4),
            cursor:        "pointer",
            opacity:       entry.hidden ? HIDDEN_OPACITY : 1,
            components:    [swatch, label],
        });
    }

    /**
     * Resolves a click to the row it landed in and emits `"toggle"` with that
     * row's index. Reads the event target through the source seam and matches it
     * against each row's element (never listening on a row's own surface).
     *
     * @param event - The DOM click event.
     */
    private handleRowClick = (event: MouseEvent): void => {
        if (!DOM.source.isNode(event.target)) {
            return;
        }

        const target = DOM.source.intern(event.target);

        for (let index = 0; index < this._rows.length; index++) {
            const element = this._rows[index].getElement();

            if (element && DOM.source.contains(element, target)) {
                this.emit("toggle", index);

                return;
            }
        }
    };

    /**
     * Registers a `"toggle"` listener, fired with a series index when its row is
     * clicked.
     *
     * @param event - The `"toggle"` event.
     * @param listener - The callback invoked with the toggled series index.
     *
     * @returns This legend, for method chaining.
     */
    on(event: "toggle", listener: (seriesIndex: number) => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered `"toggle"` listener.
     *
     * @param event - The `"toggle"` event.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This legend, for method chaining.
     */
    off(event: "toggle", listener: (seriesIndex: number) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every `"toggle"` listener with the toggled series index.
     *
     * @param event - The `"toggle"` event.
     * @param seriesIndex - The toggled series index.
     */
    protected emit(event: ChartLegendEvent, seriesIndex: number): void {
        this._listeners.fire(event, seriesIndex);
    }

    /**
     * Removes the self-subtree click listener. `Event.addSubtreeListener` holds a
     * permanent hard reference in a module-level map, so a legend that is never
     * disposed pins itself (and its DOM handles) for the life of the page; the
     * owning chart calls this from its own `dispose`.
     */
    dispose(): void {
        Event.removeSubtreeListener(this, "click", this.handleRowClick);
    }
}

const ChartLegendCallable = callable(ChartLegend);
type ChartLegendCallable = ChartLegend;
export {
    ChartLegend         as _ChartLegend,
    ChartLegendCallable as ChartLegend
};
