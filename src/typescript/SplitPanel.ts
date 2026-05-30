// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Panel } from '@jimka/typescript-ui/core';
import { Fit, Split } from '@jimka/typescript-ui/layout';
import { Slider, Text, TextArea } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { List } from '@jimka/typescript-ui/component/list';
class SplitPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new Fit());

        let mainSplit = new Component();
        mainSplit.setLayoutManager(new Split({ direction: "vertical" }));

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
        slider.on("action", () => {
            sliderText.setText(slider.getValue().toString() + "%");
        });
        southComponent.addComponent(slider);
    }
}

const SplitPanelCallable = callable(SplitPanel);
type SplitPanelCallable = SplitPanel;
export {
    SplitPanel         as _SplitPanel,
    SplitPanelCallable as SplitPanel
};
