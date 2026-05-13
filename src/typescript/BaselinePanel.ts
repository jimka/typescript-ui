// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    Button,
    callable,
    ComboBox,
    Component,
    HBox,
    Insets,
    Panel,
    ProgressBar,
    RadioButton,
    Text,
    TextField,
    VBox
} from "@jimka/typescript-ui";

class BaselinePanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new HBox());

        const baselineDemo = new Component({
            preferredSize: { width: 420, height: 220 },
        });
        baselineDemo.setLayoutManager(new VBox());

        const progressBar = new ProgressBar(50, false, {
            preferredSize: { width: 120, height: 12 },
            insets       : new Insets(0, 0, 0, 0),
        });

        const progressRow = new Component();
        progressRow.setLayoutManager(new HBox());

        progressRow.addComponent(new Text("Progress:"));
        progressRow.addComponent(progressBar);
        progressRow.addComponent(new Text("done"));

        baselineDemo.addComponent(progressRow);

        const fieldRow = new Component();
        fieldRow.setLayoutManager(new HBox());
        fieldRow.addComponent(new Text("Name:"));
        fieldRow.addComponent(new TextField());
        baselineDemo.addComponent(fieldRow);

        const buttonRow = new Component();
        buttonRow.setLayoutManager(new HBox());
        buttonRow.addComponent(new Text("Save:"));
        buttonRow.addComponent(new Button("Save"));
        baselineDemo.addComponent(buttonRow);

        const comboBox = new ComboBox();
        comboBox.addItem("First");
        comboBox.addItem("Second");

        const comboRow = new Component();
        comboRow.setLayoutManager(new HBox());
        comboRow.addComponent(new Text("Pick:"));
        comboRow.addComponent(comboBox);
        baselineDemo.addComponent(comboRow);

        const radioRow = new Component();
        radioRow.setLayoutManager(new HBox());
        radioRow.addComponent(new Text("Mode:"));
        radioRow.addComponent(new RadioButton("Option A"));
        radioRow.addComponent(new RadioButton("Option B"));
        baselineDemo.addComponent(radioRow);

        this.addComponent(baselineDemo);
    }
}

const BaselinePanelCallable = callable(BaselinePanel);
type BaselinePanelCallable = BaselinePanel;
export {
    BaselinePanel         as _BaselinePanel,
    BaselinePanelCallable as BaselinePanel
};
