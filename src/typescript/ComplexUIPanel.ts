import { Component } from "./Base/Component.js";
import { VBox } from "./Base/layout/VBox.js";
import { Label } from "./Base/component/Label.js";
import { HBox } from "./Base/layout/HBox.js";
import { ComboBox } from "./Base/component/ComboBox.js";
import { FieldSet } from "./Base/component/FieldSet.js";
import { RadioButton } from "./Base/component/RadioButton.js";
import { ButtonGroup } from "./Base/ButtonGroup.js";
import { Button } from "./Base/component/Button.js";
import { TextField } from "./Base/component/TextField.js";
import { TextArea } from "./Base/component/TextArea.js";
import { Table } from "./Base/component/table/Table.js";
import { Model } from "./Base/component/table/model/Model.js";
import { Field } from "./Base/component/table/model/Field.js";

export class ComplexUIPanel extends Component {

    constructor() {
        super();

        this.initLayout();
    }

    private initLayout() {
        this.setLayoutManager(new VBox());

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
        let comp = new Component();
        comp.setLayoutManager(new HBox());

        let panel11 = new Component();
        panel11.setLayoutManager(new VBox());

        let labelCustomerOrContact = new Label("Select Customer or Contact");
        panel11.addComponent(labelCustomerOrContact);

        let comboCustomerOrContact = new ComboBox();
        comboCustomerOrContact.addItem("Alderson.George");
        panel11.addComponent(comboCustomerOrContact);

        comp.addComponent(panel11);

        let panel12 = new FieldSet("Filter");
        panel12.setLayoutManager(new VBox());

        let radioCustomersOnly = new RadioButton(); // "Customers Only");
        let radioCustomersOnATrip = new RadioButton(); // "Customers on a Trip");
        let radioAllContacts = new RadioButton(); // "All Contacts");

        panel12.addComponent(radioCustomersOnly);
        panel12.addComponent(radioCustomersOnATrip);
        panel12.addComponent(radioAllContacts);

        let buttonGroup = new ButtonGroup();
        buttonGroup.addButton(radioCustomersOnly);
        buttonGroup.addButton(radioCustomersOnATrip);
        buttonGroup.addButton(radioAllContacts);

        comp.addComponent(panel12);

        let panel13 = new Component();
        panel13.setLayoutManager(new VBox());

        let buttonNewCustomer = new Button("New Customer");
        let buttonSaveCustomer = new Button("Save Customer");
        panel13.addComponent(buttonNewCustomer);
        panel13.addComponent(buttonSaveCustomer);

        comp.addComponent(panel13);

        return comp;
    }

    private buildPanel2() {
        let comp = new Component();
        comp.setLayoutManager(new HBox());

        let labelTitle = new Label("Title:");
        let textTitle = new TextField();
        comp.addComponent(labelTitle);
        comp.addComponent(textTitle);

        let labelFirstName = new Label("First Name:");
        let textFirstName = new TextField();
        comp.addComponent(labelFirstName);
        comp.addComponent(textFirstName);

        let labelLastName = new Label("Last Name:");
        let textLastName = new TextField();
        comp.addComponent(labelLastName);
        comp.addComponent(textLastName);

        let labelCustomerType = new Label("Customer Type:");
        let textCustomerType = new TextField();
        comp.addComponent(labelCustomerType);
        comp.addComponent(textCustomerType);

        return comp;
    }

    private buildPanel3() {
        let comp = new FieldSet("Preferences");

        return comp;
    }

    private buildPanel4() {
        let comp = new Component();
        comp.setLayoutManager(new HBox());

        let labelNotes = new Label("Notes:");
        let areaNotes = new TextArea();
        comp.addComponent(labelNotes);
        comp.addComponent(areaNotes);

        return comp
    }

    private buildPanel5() {
        let tableModel = new Model([
            new Field("street1", "string", "Street1", 1),
            new Field("street2", "string", "Street2", 2),
            new Field("city", "string", "City", 3),
            new Field("state_province", "string", "StateProvince", 4),
            new Field("country_region", "string", "CountryRegion", 5),
        ]);
        
        let comp = new Table(tableModel);

        return comp;
    }

    private buildPanel6() {
        let tableModel = new Model([
            new Field("reservation_date", "string", "ReservationDate", 1),
            new Field("trip", "string", "Trip", 2),
            new Field("balance", "string", "Balance", 3),
        ]);

        let comp = new Table(tableModel);

        return comp;
    }

    private buildPanel7() {
        let comp = new Component();
        comp.setLayoutManager(new HBox());

        let labelAddDate = new Label("Add Date:");
        let textAddDate = new TextField();
        comp.addComponent(labelAddDate);
        comp.addComponent(textAddDate);

        let labelModifiedDate = new Label("Modified Date:");
        let textModifiedDate = new TextField();
        comp.addComponent(labelModifiedDate);
        comp.addComponent(textModifiedDate);

        let labelInitialDateAsCustomer = new Label("Initial Date as Customer:");
        let textInitialDateAsCustomer = new TextField();
        comp.addComponent(labelInitialDateAsCustomer);
        comp.addComponent(textInitialDateAsCustomer);

        return comp;
    }
}