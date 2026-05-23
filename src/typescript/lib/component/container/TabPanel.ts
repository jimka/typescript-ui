// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Component } from "~/core/Component.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Tab } from "~/layout/Tab.js";
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
}

/**
 * A [`Panel`](/api/core/classes/Panel) subclass that owns an internal
 * [`Tab`](/api/layout/classes/Tab) layout manager and exposes a tab-typed
 * `addTab` / `addLazyTab` / `setOnTabClose` surface so consumers do not have
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

        if (options?.tabs) {
            for (const entry of options.tabs) {
                this.addTab(entry.component, entry.label, { closeable: entry.closeable });
            }
        }

        if (options?.onTabClose) {
            this.setOnTabClose(options.onTabClose);
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
     * Registers a callback fired when the user closes a tab via its close
     * button. Forwards to the wrapped `Tab.setOnTabClose`.
     *
     * @param callback - Called with the closed tab's content component.
     *
     * @returns This panel, for method chaining.
     */
    setOnTabClose(callback: (component: Component) => void): this {
        this.getTabManager().setOnTabClose(callback);

        return this;
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
