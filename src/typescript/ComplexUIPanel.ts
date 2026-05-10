// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { VBox } from "./Base/layout/VBox.js";
import { Text } from "./Base/component/Text.js";
import { HBox } from "./Base/layout/HBox.js";
import { ComboBox } from "./Base/component/ComboBox.js";
import { FieldSet } from "./Base/component/FieldSet.js";
import { RadioButton } from "./Base/component/RadioButton.js";
import { ButtonGroup } from "./Base/ButtonGroup.js";
import { Button } from "./Base/component/Button.js";
import { TextField } from "./Base/component/TextField.js";
import { TextArea } from "./Base/component/TextArea.js";
import { Table } from "./Base/component/table/Table.js";
import { Model } from "./Base/data/Model.js";
import { MemoryStore } from "./Base/data/MemoryStore.js";
import { BorderStyle } from "./Base/BorderStyle.js";
import { Panel } from "./Base/Panel.js";

export class ComplexUIPanel extends Panel {

    constructor() {
        super();

        this.initLayout();
    }

    private initLayout() {
        let vbox = new VBox()
        vbox.setStretching(true);
        this.setLayoutManager(vbox);

        let panel1 = this.buildPanel1();
        this.addComponent(panel1);

        let panel2 = this.buildPanel2();
        this.addComponent(panel2);

        let panel3 = this.buildPanel3();
        this.addComponent(panel3);

        let panel4 = this.buildPanel4();
        this.addComponent(panel4);

        let panel5 = this.buildPanel5();
        this.addComponent(panel5);

        let panel6 = this.buildPanel6();
        this.addComponent(panel6);

        let panel7 = this.buildPanel7();
        this.addComponent(panel7);
    }

    private buildPanel1() {
        let comp = new Panel();
        comp.setLayoutManager(new HBox());
        comp.setBorder({ style: BorderStyle.SOLID, width: 1, color: "black" })

        let panel11 = new Panel();
        panel11.setLayoutManager(new VBox());

        let captionCustomerOrContact = new Text("Select Customer or Contact");
        panel11.addComponent(captionCustomerOrContact);

        let comboCustomerOrContact = new ComboBox();
        comboCustomerOrContact.addItem("Alderson.George");
        panel11.addComponent(comboCustomerOrContact);

        comp.addComponent(panel11);

        let panel12 = new FieldSet("Filter");
        panel12.setLayoutManager(new VBox());

        let radioCustomersOnly = new RadioButton("Customers Only");
        let radioCustomersOnATrip = new RadioButton("Customers on a Trip");
        let radioAllContacts = new RadioButton("All Contacts");

        panel12.addComponent(radioCustomersOnly);
        panel12.addComponent(radioCustomersOnATrip);
        panel12.addComponent(radioAllContacts);

        let buttonGroup = new ButtonGroup();
        buttonGroup.addButton(radioCustomersOnly);
        buttonGroup.addButton(radioCustomersOnATrip);
        buttonGroup.addButton(radioAllContacts);

        comp.addComponent(panel12);

        let panel13 = new Panel();
        panel13.setLayoutManager(new VBox());

        let buttonNewCustomer = new Button("New Customer");
        let buttonSaveCustomer = new Button("Save Customer");
        panel13.addComponent(buttonNewCustomer);
        panel13.addComponent(buttonSaveCustomer);

        comp.addComponent(panel13);

        return comp;
    }

    private buildPanel2() {
        let comp = new Panel();
        comp.setLayoutManager(new HBox());

        let captionTitle = new Text("Title:");
        let textTitle = new TextField();
        comp.addComponent(captionTitle);
        comp.addComponent(textTitle);

        let captionFirstName = new Text("First Name:");
        let textFirstName = new TextField();
        comp.addComponent(captionFirstName);
        comp.addComponent(textFirstName);

        let captionLastName = new Text("Last Name:");
        let textLastName = new TextField();
        comp.addComponent(captionLastName);
        comp.addComponent(textLastName);

        let captionCustomerType = new Text("Customer Type:");
        let textCustomerType = new TextField();
        comp.addComponent(captionCustomerType);
        comp.addComponent(textCustomerType);

        return comp;
    }

    private buildPanel3() {
        let comp = new FieldSet("Preferences");

        return comp;
    }

    private buildPanel4() {
        let comp = new Panel();
        comp.setLayoutManager(new HBox());

        let captionNotes = new Text("Notes:");
        let areaNotes = new TextArea();
        comp.addComponent(captionNotes);
        comp.addComponent(areaNotes);

        return comp
    }

    private buildPanel5() {
        let tableModel = new Model([
            { name: "street1",        type: "string", description: "Street1",       order: 1 },
            { name: "street2",        type: "string", description: "Street2",       order: 2 },
            { name: "city",           type: "string", description: "City",          order: 3 },
            { name: "state_province", type: "string", description: "StateProvince", order: 4 },
            { name: "country_region", type: "string", description: "CountryRegion", order: 5 },
        ]);

        let comp = new Table(new MemoryStore(tableModel));

        comp.setExportMenuEnabled(true);

        return comp;
    }

    private buildPanel6() {
        let tableModel = new Model([
            { name: "reservation_date", type: "string", description: "ReservationDate", order: 1 },
            { name: "trip",             type: "string", description: "Trip",            order: 2 },
            { name: "balance",          type: "string", description: "Balance",         order: 3 },
        ]);

        let comp = new Table(new MemoryStore(tableModel));

        comp.setExportMenuEnabled(true);

        return comp;
    }

    private buildPanel7() {
        let comp = new Panel();
        comp.setLayoutManager(new HBox());

        let captionAddDate = new Text("Add Date:");
        let textAddDate = new TextField();
        comp.addComponent(captionAddDate);
        comp.addComponent(textAddDate);

        let captionModifiedDate = new Text("Modified Date:");
        let textModifiedDate = new TextField();
        comp.addComponent(captionModifiedDate);
        comp.addComponent(textModifiedDate);

        let captionInitialDateAsCustomer = new Text("Initial Date as Customer:");
        let textInitialDateAsCustomer = new TextField();
        comp.addComponent(captionInitialDateAsCustomer);
        comp.addComponent(textInitialDateAsCustomer);

        return comp;
    }
}