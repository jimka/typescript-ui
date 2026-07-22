// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Component } from "~/core/Component.js";
import type { ComponentFactory } from "~/core/Component.js";
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
    /**
     * Content shown when this tab is selected: a live component, or a factory
     * built on first activation. A factory may be asynchronous.
     */
    component:  Component | ComponentFactory;
    /** When `true`, a close button appears on the tab button. */
    closeable?: boolean;
    /** Optional registry glyph name shown leading the tab button's label. */
    glyph?:     string;
    /**
     * Whether a factory is deferred until first activation. Defaults to `true`;
     * ignored when `component` is an already-constructed component.
     */
    lazy?:      boolean;
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
 * factory-accepting `addTab` / `addLazyTab` surface so consumers do not have to wire
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
                this.addTab(entry.component, entry.label, { closeable: entry.closeable, glyph: entry.glyph, lazy: entry.lazy });
            }
        }

        if (options?.onTabClose) {
            this.getTab().on("tabclose", options.onTabClose);
        }
    }

    /**
     * Adds a tab to the panel's internal `Tab` manager.
     *
     * The content may be a live component or a factory built on first
     * activation. A factory is deferred by default: until the user selects the
     * tab, the panel reserves the tab slot and shows a spinner placeholder in
     * its place. Pass `{ lazy: false }` to build a factory immediately instead.
     *
     * A factory may be asynchronous, in which case the spinner stays up for the
     * whole wait; if it rejects, the tab closes and the internal `Tab` emits
     * `"exception"` — reach it through {@link TabPanel.getTab}.
     *
     * @param component - The content shown when this tab is selected, or a factory producing it.
     * @param label - The tab button's label.
     * @param options - Optional. Supports `{ closeable: true }`, a leading `glyph` name,
     *   and `{ lazy: false }` to decline deferral.
     *
     * @returns This panel, for method chaining.
     */
    addTab(
        component: Component | ComponentFactory,
        label: string,
        options?: { closeable?: boolean; glyph?: string; lazy?: boolean },
    ): this {
        const constraints = new LayoutConstraints();
        constraints.name      = label;
        constraints.closeable = options?.closeable ?? false;
        constraints.glyph     = options?.glyph ?? null;
        constraints.lazy      = options?.lazy;

        this.addComponent(component, constraints);

        return this;
    }

    /**
     * Registers a lazy tab — an alias for {@link TabPanel.addTab} with a
     * factory, which already defers by default. Prefer `addTab`.
     *
     * @param factory - Builds the content component on first activation.
     * @param label - The tab button's label.
     * @param options - Optional. Supports `{ closeable: true }` and a leading `glyph` name.
     *
     * @returns This panel, for method chaining.
     */
    addLazyTab(factory: ComponentFactory, label: string, options?: { closeable?: boolean; glyph?: string }): this {
        return this.addTab(factory, label, options);
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
