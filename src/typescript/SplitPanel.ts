// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Split } from "./Base/layout/Split.js";
import { Component } from "./Base/Component.js";
import { TextArea } from "./Base/component/TextArea.js";
import { List } from "./Base/component/List.js";
import { Slider } from "./Base/component/Slider.js";
import { Fit } from "./Base/layout/Fit.js";
import { Text } from "./Base/component/Text.js";
import { Button } from "./Base/component/Button.js";
import { Panel } from "./Base/Panel.js";

export class SplitPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new Fit());

        let mainSplit = new Component();
        mainSplit.setLayoutManager(new Split("vertical"));

        this.addComponent(mainSplit);

        let northComponent = new Component();
        northComponent.setLayoutManager(new Split());
        mainSplit.addComponent(northComponent);

        let button = new Button("Hello World button!");
        northComponent.addComponent(button);

        let sliderText = new Text("0%");
        northComponent.addComponent(sliderText);

        let southComponent = new Component();
        southComponent.setLayoutManager(new Split());
        mainSplit.addComponent(southComponent);

        let list = new List();
        southComponent.addComponent(list);

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

        let textArea = new TextArea();
        southComponent.addComponent(textArea);

        let slider = new Slider();
        sliderText.setText(slider.getValue().toString() + "%");
        slider.addActionListener(() => {
            sliderText.setText(slider.getValue().toString() + "%");
        });
        southComponent.addComponent(slider);
    }
}