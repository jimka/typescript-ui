// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Panel } from '@jimka/typescript-ui/core';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Border as BorderLayout } from '@jimka/typescript-ui/layout';
import { Text, TextArea } from '@jimka/typescript-ui/component/input';
import { BulletedList, List, ListItem, NumberedList } from '@jimka/typescript-ui/component/list';
class BorderPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new BorderLayout());

        let headerText = new Text("Header!");
        headerText.setPreferredSize({ width: 20, height: 100 });
        this.addComponent(headerText, { placement: Placement.NORTH, collapsible: true });

        let list = new List();
        this.addComponent(list, { placement: Placement.WEST, collapsible: true });

        list.addItem("One");
        list.addItem("Two");
        list.addItem("Three");
        list.addItem("Four");
        list.addItem("Five");
        list.addItem("Six");
        list.addItem("Seven");
        list.addItem("Eight");
        list.addItem("Nine");
        list.addItem("Ten");
        list.addItem("Eleven");
        list.addItem("Twelve");
        list.addItem("Thirteen");

        let centerTextArea = new TextArea("Center textarea!");
        this.addComponent(centerTextArea, { placement: Placement.CENTER });

        let footerText = new Text("Footer!1!!!");
        footerText.setPreferredSize({ width: 20, height: 50 });
        this.addComponent(footerText, { placement: Placement.SOUTH, collapsible: true });

        let eastComponent = new Component();
        eastComponent.setLayoutManager(new BorderLayout());

        let bulletedList = new BulletedList();
        bulletedList.addComponent(new ListItem("a", "A"));
        bulletedList.addComponent(new ListItem("b", "B"));
        bulletedList.addComponent(new ListItem("c", "C"));
        bulletedList.addComponent(new ListItem("d", "D"));
        bulletedList.addComponent(new ListItem("e", "E"));

        eastComponent.addComponent(bulletedList, { placement: Placement.NORTH });

        let numberedList = new NumberedList();
        numberedList.addComponent(new ListItem("1", "One"));
        numberedList.addComponent(new ListItem("2", "Two"));
        numberedList.addComponent(new ListItem("3", "Three"));
        numberedList.addComponent(new ListItem("4", "Four"));
        numberedList.addComponent(new ListItem("5", "Five"));

        eastComponent.addComponent(numberedList, { placement: Placement.SOUTH });

        // Collapsing is opt-in: the north, south, and west regions above pass
        // `collapsible: true`, so each shows a single chevron handle whose
        // double-click toggles collapse/restore — the region's gutter slides to
        // the outer edge and becomes the opaque strip, and slides back on
        // restore. The east region and the center opt out simply by not asking,
        // so they show no chevron.
        this.addComponent(eastComponent, { placement: Placement.EAST });
    }
}

const BorderPanelCallable = callable(BorderPanel);
type BorderPanelCallable = BorderPanel;
export {
    BorderPanel         as _BorderPanel,
    BorderPanelCallable as BorderPanel
};
