// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { Size } from "~/Size.js";
import { ToggleButton } from "~/component/ToggleButton.js";
import { Component } from "~/Component.js";
import { Event } from "~/Event.js";
import { Insets } from "~/Insets.js";
import { BorderStyle } from "~/BorderStyle.js";
import { FillType } from "~/layout/FillType.js";
import { ButtonGroup } from "~/ButtonGroup.js";
import { RovingTabIndex } from "~/RovingTabIndex.js";
import { Column } from "~/layout/Column.js";
import { HBox } from "~/layout/HBox.js";
import { TabCloseButton } from "~/component/TabCloseButton.js";
import { callable } from "~/Callable.js";

/**
 * Construction-time options for {@link Tab}.
 *
 * @category Layouts
 */
export interface TabOptions extends LayoutManagerOptions {
    onTabClose?: (component: Component) => void;
}

/** Bookkeeping record for one tab slot. */
interface TabEntry {
    wrapper: Component;
    button: ToggleButton;
    closeButton?: TabCloseButton;
}

/**
 * A layout manager that renders a row of tab buttons above the container content area
 * and shows exactly one child component at a time based on the selected tab.
 * Tab button labels are taken from `LayoutConstraints.name` when available,
 * otherwise from the component's ID.
 *
 * @category Layouts
 */
class Tab extends LayoutManager {

    private toolbar: Component = new Component();
    private tabs: Array<TabEntry> = [];
    private buttonGroup: ButtonGroup = new ButtonGroup();
    private rovingTabIndex: RovingTabIndex = new RovingTabIndex();
    private selectedTabIndex: number = 0;
    private onTabClose: ((component: Component) => void) | null = null;

    /**
     * Creates a Tab layout manager with an empty toolbar.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TabOptions) {
        super();

        let columnLayout = new Column();
        columnLayout.setGap(0);
        this.toolbar.setLayoutManager(columnLayout);
        this.toolbar.setBackgroundColor("var(--ts-ui-tab-toolbar-bg, #eee)");
        this.toolbar.setInsets(null);
        this.toolbar.setBorder({ style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-tab-toolbar-border, #e1e1e8)" });
        this.toolbar.setPreferredSize(0, 30);

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link TabOptions} bag, dispatching the close callback
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TabOptions): void {
        super.applyOptions(options);

        if (options.onTabClose !== undefined) {
            this.setOnTabClose(options.onTabClose);
        }
    }

    /**
     * Updates the selected tab index, syncs the roving tabindex, and triggers a re-layout when a tab button is clicked.
     *
     * @param tab - The tab button component that was pressed.
     */
    onTabPressed(tab: Component): void {
        const idx = this.tabs.findIndex(entry => entry.button === tab);

        if (idx >= 0) {
            this.selectedTabIndex = idx;
            this.rovingTabIndex.moveTo(idx);
        }

        this.getContainer()?.scheduleLayout();
    }

    /**
     * Attaches to a container and appends the tab toolbar element to it.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component): this {
        super.attach(container);

        let element = this.toolbar.getElement(true);
        container.getElement(true).appendChild(element);

        this.toolbar.getAria().setRole("tablist");

        Event.addSubtreeListener(this.toolbar, "keydown", (e: KeyboardEvent) => this.onToolbarKeyDown(e));

        return this;
    }

    /**
     * Detaches from the container and removes the tab toolbar element from the DOM.
     */
    detach(): this {
        super.detach();

        this.toolbar.getElement().remove();

        return this;
    }

    /**
     * Returns the child component at the currently selected tab index.
     *
     * @returns The visible component, or `null` if the container is empty or not attached.
     */
    getVisibleComponent(): Component | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let components = container.getComponents();

        return components[this.selectedTabIndex];
    }

    /**
     * Returns the preferred size: the visible component's preferred size plus the toolbar height.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or visible component.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getPreferredSize();
        if (!size) {
            return null;
        }

        let toolbarSize = this.toolbar.getPreferredSize();
        if (!toolbarSize) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + toolbarSize.height + outerHeight
        };
    }

    /**
     * Returns the minimum size: the visible component's minimum size plus the toolbar minimum height.
     *
     * @returns The minimum `{width, height}`, or `null` if there is no container or visible component.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getMinSize();
        if (!size) {
            return null;
        }

        let toolbarSize = this.toolbar.getMinSize();
        if (!toolbarSize) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + toolbarSize.height + outerHeight
        };
    }

    /**
     * Returns the maximum size: the visible component's maximum size plus the toolbar maximum height.
     *
     * @returns The maximum `{width, height}`, or `null` if there is no container or visible component.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getMaxSize();
        if (!size) {
            return null;
        }

        let toolbarSize = this.toolbar.getMaxSize();
        if (!toolbarSize) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + toolbarSize.height + outerHeight
        };
    }

    /**
     * Creates a tab entry for a component and adds it to the toolbar.
     *
     * @param component - The content component for which a tab entry should be created.
     *
     * @remarks The button label is taken from `LayoutConstraints.name` when available;
     * otherwise the component's ID is used. When `constraints.closeable` is true, a
     * `TabCloseButton` is appended to the wrapper after the toggle button.
     */
    createTab(component: Component): void {
        let constraints = this.getLayoutConstraints(component);
        let name: string;

        if (constraints && constraints.name) {
            name = constraints.name;
        } else {
            name = component.getId();
        }

        let tabButton = new ToggleButton(name);

        tabButton.setBackgroundColor("var(--ts-ui-tab-button-bg, #b8b8c3)");
        tabButton.setBorder();
        tabButton.setBorderRadius();
        tabButton.setShadow(null);
        tabButton.setInsets(new Insets(0, 4, 0, 4));
        tabButton.getText().setInsets(new Insets(0, 4, 0, 4));

        tabButton.addActionListener(() => this.onTabPressed(tabButton));

        const wrapperHBox = new HBox();
        wrapperHBox.setComponentSpacing(0);
        wrapperHBox.setStretching(true);

        const wrapper = new Component();
        wrapper.setLayoutManager(wrapperHBox);
        wrapper.setBackgroundColor("transparent");
        wrapper.setBorder();
        wrapper.setShadow(null);
        wrapper.setInsets(new Insets(0, 0, 0, 0));

        wrapper.addComponent(tabButton, { weight: 1 });

        let closeButton: TabCloseButton | undefined;

        if (constraints?.closeable) {
            closeButton = new TabCloseButton();
            closeButton.setBorder();
            closeButton.setBorderRadius();
            closeButton.setShadow(null);
            wrapper.addComponent(closeButton);
        }

        const entry: TabEntry = { wrapper, button: tabButton, closeButton };

        if (closeButton) {
            closeButton.addActionListener(() => this.closeTab(entry));
        }

        this.tabs.push(entry);

        const isSelected = this.tabs.length - 1 === this.selectedTabIndex;

        if (isSelected) {
            tabButton.setSelected(true);
        }

        this.buttonGroup.addButton(tabButton);
        this.rovingTabIndex.add(tabButton);
        this.toolbar.addComponent(wrapper);

        tabButton.getAria().setRole("tab");
        tabButton.getAria().setSelected(isSelected);
        tabButton.getAria().setControls(component.getId());

        component.getAria().setRole("tabpanel");
        component.getAria().setTabIndex(-1);
        component.getAria().setLabelledBy(tabButton.getId());
    }

    /**
     * Creates tab buttons for new components, hides all but the selected child,
     * and positions the toolbar and the visible component.
     *
     * @remarks Tab buttons are created lazily: only components that do not yet have
     * a corresponding button receive one. The toolbar is positioned at the top of the
     * container and the visible component occupies the remaining space beneath it.
     */
    doLayout(): void {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let containerSize = container.getInnerSize();
        let containerInsets = container.getInsets();

        let componentCount = components.length;

        for (let i = this.tabs.length; i < componentCount; i += 1) {
            let component = components[i];
            this.createTab(component);
        }

        for (let idx in components) {
            let component = components[idx];
            component.setVisible(false);
            component.getAria().setHidden(true);
        }

        for (let i = 0; i < this.tabs.length; i++) {
            this.tabs[i].button.getAria().setSelected(i === this.selectedTabIndex);
        }

        let component = this.getVisibleComponent();

        if (!component && components.length > 0) {
            component = components[0];
        }

        let toolbarSize = this.toolbar.getPreferredSize();
        let toolbarHeight = toolbarSize ? toolbarSize.height : 0;

        this.toolbar.setX(containerInsets.getLeft());
        this.toolbar.setY(containerInsets.getTop());
        this.toolbar.setWidth(containerSize ? containerSize.width : 0);
        this.toolbar.setHeight(toolbarHeight);

        this.toolbar.doLayout();

        if (!component) {
            return;
        }

        component.setVisible(true);
        component.getAria().setHidden(false);

        this.placeComponent(
            component,
            containerInsets.getLeft(),
            containerInsets.getTop() + toolbarHeight,
            containerSize ? containerSize.width : 0,
            containerSize ? containerSize.height - toolbarHeight : 0,
            FillType.BOTH
        );
    }

    /**
     * Registers a callback invoked after a tab is closed.
     *
     * @param callback - Receives the content component that was removed.
     */
    setOnTabClose(callback: (component: Component) => void): void {
        this.onTabClose = callback;
    }

    /**
     * Removes a tab entry and its associated content component, then selects the next tab.
     *
     * @param entry - The tab entry to close.
     */
    private closeTab(entry: TabEntry): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const entryIndex = this.tabs.indexOf(entry);
        if (entryIndex < 0) {
            return;
        }

        const components = container.getComponents();
        const contentComponent = components[entryIndex];

        this.buttonGroup.removeButton(entry.button);
        this.rovingTabIndex.remove(entry.button);
        this.tabs.splice(entryIndex, 1);
        this.toolbar.removeComponent(entry.wrapper);
        container.removeComponent(contentComponent);

        if (this.onTabClose && contentComponent) {
            this.onTabClose(contentComponent);
        }

        this.selectNextTab(entryIndex);
        this.getContainer()?.scheduleLayout();
    }

    /**
     * Selects an appropriate tab after the tab at `closedIndex` has been removed.
     *
     * @param closedIndex - The index that was just spliced out.
     */
    private selectNextTab(closedIndex: number): void {
        const count = this.tabs.length;

        if (count === 0) {
            this.selectedTabIndex = 0;

            return;
        }

        const newIndex = closedIndex > 0 ? closedIndex - 1 : 0;
        this.selectedTabIndex = newIndex;

        this.tabs.forEach(e => e.button.setSelected(false));
        this.tabs[newIndex].button.setSelected(true);
    }

    /**
     * Handles ArrowLeft / ArrowRight to move tab focus and activate the adjacent tab.
     *
     * @param e - The keyboard event fired on the toolbar element.
     */
    private onToolbarKeyDown(e: KeyboardEvent): void {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
            return;
        }

        const tabCount = this.tabs.length;

        if (tabCount === 0) {
            return;
        }

        e.preventDefault();

        const newIdx = e.key === 'ArrowRight'
            ? (this.selectedTabIndex + 1) % tabCount
            : (this.selectedTabIndex - 1 + tabCount) % tabCount;

        const newTab = this.tabs[newIdx].button;

        this.tabs.forEach(entry => entry.button.setSelected(false));
        newTab.setSelected(true);

        this.onTabPressed(newTab);
    }
}

const TabCallable = callable(Tab);
type TabCallable = Tab;
export {
    Tab         as _Tab,
    TabCallable as Tab
};
