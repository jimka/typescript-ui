// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from '@jimka/typescript-ui/core';
import { callable, Panel } from '@jimka/typescript-ui/core';
import { ButtonGroup } from '@jimka/typescript-ui/overlay';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { Checkbox, ComboBox, PasswordField, RadioButton, Slider, Text, TextArea, TextField, Toggle, UsernameField } from '@jimka/typescript-ui/component/input';
import { Button, ToggleButton } from '@jimka/typescript-ui/component/button';
import { List } from '@jimka/typescript-ui/component/list';
import { FieldSet, Separator } from '@jimka/typescript-ui/component/container';
class LayoutTestPanel extends Panel {

    constructor() {
        super({ autoScroll: 'auto' });

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

        this.addComponent(new Separator({ orientation: "vertical" }));
        this.addComponent(new Separator({ orientation: "horizontal" }));

        let passwordField = new PasswordField();
        this.addComponent(passwordField);

        // A <form> container demonstrating the credential presets. No submit
        // handler — the presets only wire autocomplete/name; the form
        // semantics stay the consumer's job.
        let loginForm = new Component({ tag: "form" });
        loginForm.setLayoutManager(new VBox());
        loginForm.addComponent(new UsernameField());
        loginForm.addComponent(new PasswordField());     // login default: current-password
        this.addComponent(loginForm);

        let radioButtonComponent = new Component();
        radioButtonComponent.clearInsets();
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
        slider.on("action", () => {
            sliderText.setText(slider.getValue().toString() + "%");
        });
        this.addComponent(slider);

        let textArea = new TextArea();
        this.addComponent(textArea);

        let textField = new TextField();
        textField.on("action", () => {
            helloText.setText(textField.getText());
            textArea.setText(textField.getText());
        });
        this.addComponent(textField);

        let toggleButton = new ToggleButton("Hello World toggle button!");
        this.addComponent(toggleButton);

        let toggle = Toggle({ label: "I am a custom toggle switch!" });
        this.addComponent(toggle);

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
