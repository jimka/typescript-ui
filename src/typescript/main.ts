// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Body } from "./Base/Body.js";
import { Tab } from "./Base/layout/Tab.js";
import { VBoxPanel } from "./VBoxPanel.js";
import { HBoxPanel } from "./HBoxPanel.js";
import { BorderPanel } from "./BorderPanel.js";
import { RowPanel } from "./RowPanel.js";
import { ColumnPanel } from "./ColumnPanel.js";
import { FitPanel } from "./FitPanel.js";
import { SplitPanel } from "./SplitPanel.js";
import { MiscPanel } from "./MiscPanel.js";
import { BindingPanel } from "./BindingPanel.js";
import { ComplexUIPanel } from "./ComplexUIPanel.js";
import { GridPanel } from "./GridPanel.js";

import { Model, MemoryStore } from "./Base/index.js";

let body = Body.getInstance();

let layoutManager = new Tab();
body.setLayoutManager(layoutManager);

let miscPanel = new MiscPanel();
body.addComponent(miscPanel, { name: "Misc." });

let bindingPanel = new BindingPanel();
body.addComponent(bindingPanel, { name: "Binding" });

let rowPanel = new RowPanel();
body.addComponent(rowPanel, { name: "Row" });

let columnPanel = new ColumnPanel();
body.addComponent(columnPanel, { name: "Column" });

let fitPanel = new FitPanel();
body.addComponent(fitPanel, { name: "Fit" });

let splitPanel = new SplitPanel();
body.addComponent(splitPanel, { name: "Split" });

let borderPanel = new BorderPanel();
body.addComponent(borderPanel, { name: "Border" });

let hboxPanel = new HBoxPanel();
body.addComponent(hboxPanel, { name: "HBox" });

let vboxPanel = new VBoxPanel();
body.addComponent(vboxPanel, { name: "VBox" });

let gridPanel = new GridPanel();
body.addComponent(gridPanel, { name: "Grid" });

let complexPanel = new ComplexUIPanel();
body.addComponent(complexPanel, { name: "Complex" });

const PersonModel = new Model([
    { name: 'id',   type: 'number'                  },
    { name: 'name', type: 'string'                  },
    { name: 'age',  type: 'number', defaultValue: 0 },
]);

const store = new MemoryStore(PersonModel, [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob'  , age: 25 },
]);

store.on('load', () => {
    for (let obj of store.getAll()) {
        console.log(obj);
    }
});

await store.load();
