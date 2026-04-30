// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { ToggleButton } from "../component/ToggleButton.js";
import { Component } from "../Component.js";
import { Insets } from "../Insets.js";
import { BorderStyle } from "../BorderStyle.js";
import { FillType } from "./FillType.js";
import { ButtonGroup } from "../ButtonGroup.js";
import { Column } from "./Column.js"

/**
 * A layout manager that renders a row of tab buttons above the container content area
 * and shows exactly one child component at a time based on the selected tab.
 * Tab button labels are taken from `LayoutConstraints.name` when available,
 * otherwise from the component's ID.
 */
export class Tab extends LayoutManager {

    private toolbar: Component;
    private tabs: Array<Component>;
    private buttonGroup: ButtonGroup;
    private selectedTabIndex: number;

    constructor() {
        super();

        this.tabs = [];
        this.buttonGroup = new ButtonGroup();
        this.toolbar = new Component();
        let columnLayout = new Column();
        //columnLayout.setGap(true);
        columnLayout.setGap(0);
        this.toolbar.setLayoutManager(columnLayout);
        this.toolbar.setBackgroundColor("var(--ts-ui-tab-toolbar-bg, #eee)");
        this.toolbar.setInsets(new Insets(0, 4, 0, 4));
        this.toolbar.setBorder({ style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-tab-toolbar-border, #e1e1e8)" });
        this.toolbar.setPreferredSize(0, 30);
        this.selectedTabIndex = 0;
    }

    /**
     * Updates the selected tab index and triggers a re-layout when a tab button is clicked.
     *
     * @param tab - The tab button component that was pressed.
     */
    onTabPressed(tab: Component) {
        this.selectedTabIndex = this.tabs.indexOf(tab);
        this.doLayout();
    }

    /**
     * Attaches to a container and appends the tab toolbar element to it.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component) {
        super.attach(container);

        let element = this.toolbar.getElement(true);
        container.getElement().appendChild(element);
    }

    /**
     * Detaches from the container and removes the tab toolbar element from the DOM.
     */
    detach() {
        super.detach();

        this.toolbar.getElement().remove();
    }

    /**
     * Returns the child component at the currently selected tab index.
     *
     * @returns The visible component, or `null` if the container is empty or not attached.
     */
    getVisibleComponent() {
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
    getPreferredSize() {
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
    getMinSize() {
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
    getMaxSize() {
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
     * Creates a `ToggleButton` for a component and adds it to the tab toolbar.
     *
     * @param component - The content component for which a tab button should be created.
     *
     * @remarks The button label is taken from `LayoutConstraints.name` when available;
     * otherwise the component's ID is used. The button is automatically selected
     * if it corresponds to the current `selectedTabIndex`.
     */
    createTab(component: Component) {
        let constraints = this.getLayoutConstraints(component);
        let name: string;

        if(constraints && constraints.name) {
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
        tabButton.getLabel().setInsets(new Insets(0, 4, 0, 4));

        tabButton.addActionListener(() => this.onTabPressed(tabButton));

        this.tabs.push(tabButton);

        if (this.tabs.length - 1 === this.selectedTabIndex) {
            tabButton.setSelected(true);
        }

        this.buttonGroup.addButton(tabButton);
        this.toolbar.addComponent(tabButton);
    }

    /**
     * Creates tab buttons for new components, hides all but the selected child,
     * and positions the toolbar and the visible component.
     *
     * @remarks Tab buttons are created lazily: only components that do not yet have
     * a corresponding button receive one. The toolbar is positioned at the top of the
     * container and the visible component occupies the remaining space beneath it.
     */
    doLayout() {
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

        this.placeComponent(
            component,
            containerInsets.getLeft(),
            containerInsets.getTop() + toolbarHeight,
            containerSize ? containerSize.width : 0,
            containerSize ? containerSize.height - toolbarHeight : 0,
            FillType.BOTH
        );
    }
}
