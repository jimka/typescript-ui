// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ButtonGroup, callable, Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { ComboBox, RadioButton, Text, TextArea, TextField } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { FieldSet } from '@jimka/typescript-ui/component/container';
import { Table } from '@jimka/typescript-ui/component/table';
class ComplexUIPanel extends Panel {

    constructor() {
        super({ layoutManager: new VBox({ stretching: true }) });

        this.initLayout();
    }

    private initLayout() {
        this.addComponents(
            this.buildPanel1(),
            this.buildPanel2(),
            this.buildPanel3(),
            this.buildPanel4(),
            this.buildPanel5(),
            this.buildPanel6(),
            this.buildPanel7()
        );
    }

    private buildPanel1() {
        return Panel({
            layoutManager: HBox(),
            border: "1px solid black",
            components: [
                Panel({
                    layoutManager: VBox(),
                    components: [
                        Text("Select Customer or Contact"),
                        ComboBox().addItem("Alderson.George")
                    ]
                }),
                FieldSet("Filter", {
                    layoutManager: VBox(),
                    components: ButtonGroup({
                        buttons: [
                            RadioButton("Customers Only"),
                            RadioButton("Customers on a Trip"),
                            RadioButton("All Contacts")
                        ]
                    }).getButtons()
                }),
                Panel({
                    layoutManager: VBox(),
                    components: [
                        Button({ text: "New Customer" }),
                        Button({ text: "Save Customer" })
                    ]
                })
            ]
        });
    }

    private buildPanel2() {
        return Panel({
            layoutManager: HBox(),
            components: [
                Text("Title:")        , TextField(),
                Text("First Name:")   , TextField(),
                Text("Last Name:")    , TextField(),
                Text("Customer Type:"), TextField()
            ]
        });
    }

    private buildPanel3() {
        return FieldSet("Preferences");
    }

    private buildPanel4() {
        return Panel({
            layoutManager: HBox(),
            components: [
                Text("Notes:"),
                TextArea()
            ]
        });
    }

    private buildPanel5() {
        let tableModel = new Model([
            { name: "street1",        type: "string", description: "Street1",       order: 1 },
            { name: "street2",        type: "string", description: "Street2",       order: 2 },
            { name: "city",           type: "string", description: "City",          order: 3 },
            { name: "state_province", type: "string", description: "StateProvince", order: 4 },
            { name: "country_region", type: "string", description: "CountryRegion", order: 5 },
        ]);

        // Seed rows so a click-on-header / shift-click sort exercise produces
        // visible reorderings — useful for demoing multi-column sorting.
        const store = new MemoryStore({
            model: tableModel,
            data : [
                { street1: "1 Market St",     street2: "",        city: "San Francisco", state_province: "CA", country_region: "US" },
                { street1: "200 Pine St",     street2: "Apt 4",   city: "Seattle",       state_province: "WA", country_region: "US" },
                { street1: "55 Broadway",     street2: "",        city: "New York",      state_province: "NY", country_region: "US" },
                { street1: "12 King St W",    street2: "Suite 5", city: "Toronto",       state_province: "ON", country_region: "CA" },
                { street1: "300 Granville",   street2: "",        city: "Vancouver",     state_province: "BC", country_region: "CA" },
                { street1: "10 Downing St",   street2: "",        city: "London",        state_province: "ENG", country_region: "UK" },
                { street1: "221B Baker St",   street2: "",        city: "London",        state_province: "ENG", country_region: "UK" },
                { street1: "1 Infinite Loop", street2: "",        city: "Cupertino",     state_province: "CA", country_region: "US" },
            ],
            autoLoad: true,
        });

        return Table(store)
            .setExportMenuEnabled(true);
    }

    private buildPanel6() {
        let tableModel = new Model([
            { name: "reservation_date", type: "string", description: "ReservationDate", order: 1 },
            { name: "trip",             type: "string", description: "Trip",            order: 2 },
            { name: "balance",          type: "string", description: "Balance",         order: 3 },
        ]);

        return Table(new MemoryStore(tableModel))
            .setExportMenuEnabled(true);
    }

    private buildPanel7() {
        return Panel({
            layoutManager: HBox(),
            components: [
                Text("Add Date:"),                TextField(),
                Text("Modified Date:"),           TextField(),
                Text("Initial Date as Customer:"), TextField()
            ]
        });
    }
}

const ComplexUIPanelCallable = callable(ComplexUIPanel);
type ComplexUIPanelCallable = ComplexUIPanel;
export {
    ComplexUIPanel as _ComplexUIPanel,
    ComplexUIPanelCallable as ComplexUIPanel
};
