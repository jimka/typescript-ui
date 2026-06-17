// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Component } from "~/core/Component.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Tab, TabOptions } from "~/layout/Tab.js";
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
    /** Optional registry glyph name shown leading the tab button's label. */
    glyph?:     string;
}

/**
 * Construction-time options for {@link TabPanel}.
 *
 * @category Components
 */
export interface TabPanelOptions extends ContainerOptions {
    /** Optional initial set of tabs; each entry maps to one `addTab` call. */
    tabs?:       TabEntryConfig[];
    /**
     * Optional callback fired when the user closes a tab via its close
     * button. Receives the closed tab's content component.
     */
    onTabClose?: (component: Component) => void;
    /**
     * Construction-time options for the wrapped {@link Tab} manager (strip
     * placement, width mode, scrolling, tools, compact, reorder, …). Passed
     * straight to the manager's constructor.
     */
    tabOptions?: TabOptions;
}

/**
 * A [`Container`](/api/core/classes/Container) subclass that owns an internal
 * [`Tab`](/api/layout/classes/Tab) layout manager and exposes a tab-typed
 * `addTab` / `addLazyTab` surface so consumers do not have to wire
 * `new Container({ layoutManager: new Tab() })` themselves. The bare
 * Container + Tab manager path still works unchanged; `TabPanel` is the
 * convenience entry point.
 *
 * Strip-level tuning (placement, width mode, scrolling, tools, …) is reached
 * through {@link getTab}, the typed accessor for the wrapped manager, rather
 * than a mirrored forwarder per setter.
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
 *
 * tabs.getTab().setSide("west");
 * ```
 *
 * @category Components
 */
class TabPanel<TOptions extends TabPanelOptions = TabPanelOptions> extends Container<TOptions> {

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
        // `Tab` manager. Override-by-options would defeat the class. The strip
        // configuration rides in as the manager's own options bag.
        this.setLayoutManager(new Tab(options?.tabOptions));

        if (options?.tabs) {
            for (const entry of options.tabs) {
                this.addTab(entry.component, entry.label, { closeable: entry.closeable, glyph: entry.glyph });
            }
        }

        if (options?.onTabClose) {
            this.getTab().on("tabclose", options.onTabClose);
        }
    }

    /**
     * Adds a tab to the panel's internal `Tab` manager.
     *
     * @param component - The content shown when this tab is selected.
     * @param label - The tab button's label.
     * @param options - Optional. Supports `{ closeable: true }` and a leading `glyph` name.
     *
     * @returns This panel, for method chaining.
     */
    addTab(component: Component, label: string, options?: { closeable?: boolean; glyph?: string }): this {
        const constraints = new LayoutConstraints();
        constraints.name      = label;
        constraints.closeable = options?.closeable ?? false;
        constraints.glyph     = options?.glyph ?? null;

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
     * @param options - Optional. Supports `{ closeable: true }` and a leading `glyph` name.
     *
     * @returns This panel, for method chaining.
     */
    addLazyTab(factory: () => Component, label: string, options?: { closeable?: boolean; glyph?: string }): this {
        const constraints = new LayoutConstraints();
        constraints.name      = label;
        constraints.closeable = options?.closeable ?? false;
        constraints.glyph     = options?.glyph ?? null;

        this.getTab().addLazyTab(factory, label, constraints);

        return this;
    }

    /**
     * Typed accessor for the internally-owned `Tab` manager. Use it to reach
     * strip-level configuration (placement, width mode, scrolling, tools,
     * events, …) and per-tab operations without casting `getLayoutManager()`.
     *
     * @returns The wrapped `Tab` instance.
     */
    getTab(): Tab {
        return this.getLayoutManager() as Tab;
    }
}

const TabPanelCallable = callable(TabPanel);
type TabPanelCallable<TOptions extends TabPanelOptions = TabPanelOptions> = TabPanel<TOptions>;
export {
    TabPanel         as _TabPanel,
    TabPanelCallable as TabPanel,
};
