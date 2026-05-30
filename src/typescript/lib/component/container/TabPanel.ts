// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Component } from "~/core/Component.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Tab, TabEvent, TabWidthMode } from "~/layout/Tab.js";
import { callable } from "~/core/Callable.js";

/**
 * One entry in a {@link TabPanel}'s `tabs` options array.
 *
 * @category Components
 */
export interface TabEntryConfig {
    /** Label rendered in the tab button. */
    label:      string;
    /** Component shown in the content area when this tab is selected. */
    component:  Component;
    /** When `true`, a close button appears on the tab button. */
    closeable?: boolean;
}

/**
 * Construction-time options for {@link TabPanel}.
 *
 * @category Components
 */
export interface TabPanelOptions extends PanelOptions {
    /** Optional initial set of tabs; each entry maps to one `addTab` call. */
    tabs?:       TabEntryConfig[];
    /**
     * Optional callback fired when the user closes a tab via its close
     * button. Receives the closed tab's content component.
     */
    onTabClose?: (component: Component) => void;
    /** Tab-button width strategy; defaults to `"fill"`. */
    tabWidthMode?: TabWidthMode;
    /** Per-tab maximum width in px for `"content"` / `"equal"` modes; `null` (the default) leaves tabs uncapped. */
    tabMaxWidth?: number | null;
    /** Per-tab width in px for `"fixed"` mode; defaults to `120`. */
    tabFixedWidth?: number;
    /** Whether the 1px strip under-border runs edge-to-edge; defaults to `true`. */
    tabUnderBorderFullWidth?: boolean;
}

/**
 * A [`Panel`](/api/core/classes/Panel) subclass that owns an internal
 * [`Tab`](/api/layout/classes/Tab) layout manager and exposes a tab-typed
 * `addTab` / `addLazyTab` / `on("tabclose")` surface so consumers do not have
 * to wire `new Panel({ layoutManager: new Tab() })` themselves. The bare
 * Panel + Tab manager path still works unchanged; `TabPanel` is the
 * convenience entry point.
 *
 * @example
 * ```typescript
 * import { TabPanel } from '@jimka/typescript-ui/component/container';
 *
 * const tabs = new TabPanel({
 *     tabs: [
 *         { label: 'Alpha', component: alphaPanel },
 *         { label: 'Beta',  component: betaPanel, closeable: true },
 *     ],
 *     onTabClose: c => console.log("Closed", c.getId()),
 * });
 * ```
 *
 * @category Components
 */
class TabPanel<TOptions extends TabPanelOptions = TabPanelOptions> extends Panel<TOptions> {

    /**
     * Wires the panel to an internal `Tab` manager, dispatches the optional
     * `tabs` / `onTabClose` options to the relevant setters.
     *
     * @param options - Optional construction-time options applied to the panel.
     */
    constructor(options?: TOptions) {
        super(options);

        // Set the layout manager unconditionally — even if the caller passed
        // `layoutManager` via the options bag, `TabPanel`'s identity is the
        // `Tab` manager. Override-by-options would defeat the class.
        this.setLayoutManager(new Tab());

        if (options?.tabWidthMode !== undefined) {
            this.setTabWidthMode(options.tabWidthMode);
        }

        if (options?.tabMaxWidth !== undefined) {
            this.setTabMaxWidth(options.tabMaxWidth);
        }

        if (options?.tabFixedWidth !== undefined) {
            this.setTabFixedWidth(options.tabFixedWidth);
        }

        if (options?.tabUnderBorderFullWidth !== undefined) {
            this.setTabUnderBorderFullWidth(options.tabUnderBorderFullWidth);
        }

        if (options?.tabs) {
            for (const entry of options.tabs) {
                this.addTab(entry.component, entry.label, { closeable: entry.closeable });
            }
        }

        if (options?.onTabClose) {
            this.on("tabclose", options.onTabClose);
        }
    }

    /**
     * Adds a tab to the panel's internal `Tab` manager.
     *
     * @param component - The content shown when this tab is selected.
     * @param label - The tab button's label.
     * @param options - Optional. Currently supports `{ closeable: true }`.
     *
     * @returns This panel, for method chaining.
     */
    addTab(component: Component, label: string, options?: { closeable?: boolean }): this {
        const constraints = new LayoutConstraints();
        constraints.name      = label;
        constraints.closeable = options?.closeable ?? false;

        this.addComponent(component, constraints);

        return this;
    }

    /**
     * Registers a lazy tab. The factory runs on first activation; until then
     * the panel reserves the tab slot and shows a spinner placeholder when
     * the user selects the tab. Forwards to the wrapped `Tab.addLazyTab`.
     *
     * @param factory - Builds the content component on first activation.
     * @param label - The tab button's label.
     * @param options - Optional. Currently supports `{ closeable: true }`.
     *
     * @returns This panel, for method chaining.
     */
    addLazyTab(factory: () => Component, label: string, options?: { closeable?: boolean }): this {
        const constraints = new LayoutConstraints();
        constraints.name      = label;
        constraints.closeable = options?.closeable ?? false;

        this.getTabManager().addLazyTab(factory, label, constraints);

        return this;
    }

    /**
     * Registers a listener on the wrapped {@link Tab} manager. Public
     * forwarder so consumers can wire `tabclose` listeners through the
     * panel surface without reaching the protected manager accessor.
     *
     * @param event - The {@link Tab} event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This panel, for method chaining.
     */
    on(event: "tabclose", listener: (component: Component) => void): this;
    on(event: TabEvent,   listener: Function): this {
        this.getTabManager().on(event, listener as (component: Component) => void);

        return this;
    }

    /**
     * Removes a listener previously registered via {@link on}.
     *
     * @param event - The {@link Tab} event the listener was registered for.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This panel, for method chaining.
     */
    off(event: TabEvent, listener: Function): this {
        this.getTabManager().off(event, listener as (component: Component) => void);

        return this;
    }

    /**
     * Caps every tab cell's width, forwarding to the wrapped {@link Tab} manager.
     *
     * @param px - The maximum width per tab in px, or `null` to remove the cap.
     *
     * @returns This panel, for method chaining.
     */
    setTabMaxWidth(px: number | null): this {
        this.getTabManager().setTabMaxWidth(px);

        return this;
    }

    /**
     * Returns the current per-tab maximum width.
     *
     * @returns The cap in px, or `null` when tabs are uncapped.
     */
    getTabMaxWidth(): number | null {
        return this.getTabManager().getTabMaxWidth();
    }

    /**
     * Selects the tab-button width strategy, forwarding to the wrapped
     * {@link Tab} manager.
     *
     * @param mode - The {@link TabWidthMode} to apply.
     *
     * @returns This panel, for method chaining.
     */
    setTabWidthMode(mode: TabWidthMode): this {
        this.getTabManager().setTabWidthMode(mode);

        return this;
    }

    /**
     * Returns the current tab-button width strategy.
     *
     * @returns The active {@link TabWidthMode}.
     */
    getTabWidthMode(): TabWidthMode {
        return this.getTabManager().getTabWidthMode();
    }

    /**
     * Sets the per-tab width used by the `"fixed"` width mode, forwarding to the
     * wrapped {@link Tab} manager.
     *
     * @param px - The fixed width per tab in px.
     *
     * @returns This panel, for method chaining.
     */
    setTabFixedWidth(px: number): this {
        this.getTabManager().setTabFixedWidth(px);

        return this;
    }

    /**
     * Returns the per-tab width used by the `"fixed"` width mode.
     *
     * @returns The fixed width in px.
     */
    getTabFixedWidth(): number {
        return this.getTabManager().getTabFixedWidth();
    }

    /**
     * Toggles the edge-to-edge 1px rule under the tab strip, forwarding to the
     * wrapped {@link Tab} manager.
     *
     * @param full - `true` to draw the strip's full-width under-border, `false` to remove it.
     *
     * @returns This panel, for method chaining.
     */
    setTabUnderBorderFullWidth(full: boolean): this {
        this.getTabManager().setTabUnderBorderFullWidth(full);

        return this;
    }

    /**
     * Returns whether the strip's under-border runs edge-to-edge.
     *
     * @returns `true` when the full-width under-border is drawn.
     */
    isTabUnderBorderFullWidth(): boolean {
        return this.getTabManager().isTabUnderBorderFullWidth();
    }

    /**
     * Typed accessor for the internally-owned `Tab` manager. Subclasses use
     * it to forward additional tab-specific setters without re-implementing
     * the cast.
     *
     * @returns The wrapped `Tab` instance.
     */
    protected getTabManager(): Tab {
        return this.getLayoutManager() as Tab;
    }
}

const TabPanelCallable = callable(TabPanel);
type TabPanelCallable<TOptions extends TabPanelOptions = TabPanelOptions> = TabPanel<TOptions>;
export {
    TabPanel         as _TabPanel,
    TabPanelCallable as TabPanel,
};
