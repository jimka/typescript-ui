// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { ToggleButton } from "../component/ToggleButton.js";
import { Component } from "../Component.js";
import { Insets } from "../Insets.js";
import { BorderStyle } from "../BorderStyle.js";
import { FillType } from "./FillType.js";
import { ButtonGroup } from "../ButtonGroup.js";
import { Column } from "./Column.js"

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

    onTabPressed(tab: Component) {
        this.selectedTabIndex = this.tabs.indexOf(tab);
        this.doLayout();
    }

    attach(container: Component) {
        super.attach(container);

        let element = this.toolbar.getElement(true);
        container.getElement().appendChild(element);
    }

    detach() {
        super.detach();

        this.toolbar.getElement().remove();
    }


    getVisibleComponent() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let components = container.getComponents();

        return components[this.selectedTabIndex];
    }

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