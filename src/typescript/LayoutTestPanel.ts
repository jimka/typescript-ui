import { Component } from "./Base/Component.js"
import { Button } from "./Base/component/Button.js";
import { Checkbox } from "./Base/component/CheckBox.js";
import { ComboBox } from "./Base/component/ComboBox.js";
import { Label } from "./Base/component/Label.js";
import { List } from "./Base/component/List.js";
import { PasswordField } from "./Base/component/PasswordField.js";
import { RadioButton } from "./Base/component/RadioButton.js";
import { Slider } from "./Base/component/Slider.js";
import { TextArea } from "./Base/component/TextArea.js";
import { TextField } from "./Base/component/TextField.js";
import { ToggleButton } from "./Base/component/ToggleButton.js";
import { FieldSet } from "./Base/component/FieldSet.js";
import { HBox } from "./Base/layout/HBox.js";
import { ButtonGroup } from "./Base/ButtonGroup.js";

export class LayoutTestPanel extends Component {

    constructor() {
        super();

        let button = new Button("Hello World button!");
        this.addComponent(button);

        let checkbox = new Checkbox();
        this.addComponent(checkbox);

        let comboBox = new ComboBox();
        this.addComponent(comboBox);

        comboBox.addItem("Zero in combobox!");

        let label = new Label("I am a label!");
        this.addComponent(label);

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

        let sliderLabel = new Label("0%");
        this.addComponent(sliderLabel);

        let slider = new Slider();
        sliderLabel.setText(slider.getValue().toString() + "%");
        slider.addActionListener(() => {
            sliderLabel.setText(slider.getValue().toString() + "%");
            this.doLayout();
        });
        this.addComponent(slider);

        let textArea = new TextArea();
        this.addComponent(textArea);

        let textField = new TextField();
        textField.addActionListener(() => {
            label.setText(textField.getText());
            textArea.setText(textField.getText());
            this.doLayout();
        });
        this.addComponent(textField);

        let toggleButton = new ToggleButton("Hello World toggle button!");
        this.addComponent(toggleButton);

        let fieldSet = new FieldSet("Hello World fieldset!");
        this.addComponent(fieldSet);
    }
}