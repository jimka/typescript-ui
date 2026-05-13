// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./lib/Component.js"
import { Button } from "./lib/component/Button.js";
import { Checkbox } from "./lib/component/Checkbox.js";
import { ComboBox } from "./lib/component/ComboBox.js";
import { Text } from "./lib/component/Text.js";
import { List } from "./lib/component/List.js";
import { PasswordField } from "./lib/component/PasswordField.js";
import { RadioButton } from "./lib/component/RadioButton.js";
import { Slider } from "./lib/component/Slider.js";
import { TextArea } from "./lib/component/TextArea.js";
import { TextField } from "./lib/component/TextField.js";
import { ToggleButton } from "./lib/component/ToggleButton.js";
import { FieldSet } from "./lib/component/FieldSet.js";
import { HBox } from "./lib/layout/HBox.js";
import { ButtonGroup } from "./lib/ButtonGroup.js";
import { Panel } from "./lib/Panel.js";
import { callable } from "./lib/Callable.js";

class LayoutTestPanel extends Panel {

    constructor() {
        super();

        let button = new Button("Hello World button!");
        this.addComponent(button);

        let checkbox = new Checkbox();
        this.addComponent(checkbox);

        let comboBox = new ComboBox();
        this.addComponent(comboBox);

        comboBox.addItem("Zero in combobox!");

        let helloText = new Text("I am a label!");
        this.addComponent(helloText);

        let list = new List();
        this.addComponent(list);

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

        let passwordField = new PasswordField();
        this.addComponent(passwordField);

        let radioButtonComponent = new Component();
        radioButtonComponent.setInsets(null);
        radioButtonComponent.setLayoutManager(new HBox());

        let buttonGroup = new ButtonGroup();
        let radioButton1 = new RadioButton();
        buttonGroup.addButton(radioButton1);
        radioButtonComponent.addComponent(radioButton1);
        let radioButton2 = new RadioButton();
        buttonGroup.addButton(radioButton2);
        radioButtonComponent.addComponent(radioButton2);
        let radioButton3 = new RadioButton();
        buttonGroup.addButton(radioButton3);
        radioButtonComponent.addComponent(radioButton3);
        let radioButton4 = new RadioButton();
        buttonGroup.addButton(radioButton4);
        radioButtonComponent.addComponent(radioButton4);
        let radioButton5 = new RadioButton();
        buttonGroup.addButton(radioButton5);
        radioButtonComponent.addComponent(radioButton5);
        this.addComponent(radioButtonComponent);

        let sliderText = new Text("0%");
        this.addComponent(sliderText);

        let slider = new Slider();
        sliderText.setText(slider.getValue().toString() + "%");
        slider.addActionListener(() => {
            sliderText.setText(slider.getValue().toString() + "%");
        });
        this.addComponent(slider);

        let textArea = new TextArea();
        this.addComponent(textArea);

        let textField = new TextField();
        textField.addActionListener(() => {
            helloText.setText(textField.getText());
            textArea.setText(textField.getText());
        });
        this.addComponent(textField);

        let toggleButton = new ToggleButton("Hello World toggle button!");
        this.addComponent(toggleButton);

        let fieldSet = new FieldSet("Hello World fieldset!");
        this.addComponent(fieldSet);
    }
}

const LayoutTestPanelCallable = callable(LayoutTestPanel);
type LayoutTestPanelCallable = LayoutTestPanel;
export {
    LayoutTestPanel         as _LayoutTestPanel,
    LayoutTestPanelCallable as LayoutTestPanel
};
