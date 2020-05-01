import { Field } from "./Field";

export class Model {

    private fieldsByOrder: Array<Field> = new Array<Field>();
    private fieldsById: Map<String, Field> = new Map<String, Field>();

    constructor(fields: Array<Field>) {
        if (fields) {
            this.addFields(fields);
        }
    }

    getFields() {
        return this.fieldsByOrder;
    }

    getField(id: String) {
        return this.fieldsById.get(id);
    }

    hasField(id: String) {
        return !!this.fieldsById.get(id);
    }

    addFields(fields: Array<Field>) {
        for (let idx in fields) {
            let field = fields[idx];

            this.addField(field, false);
        }

        this.resortOrderArray();
    }

    addField(field: Field, resort = true) {
        this.fieldsByOrder.push(field);
        this.fieldsById.set(field.getId(), field);

        if (resort) {
            this.resortOrderArray();
        }
    }

    removeField(field: Field, resort = true) {
        let idx = this.fieldsByOrder.indexOf(field);
        if (idx > -1) {
            this.fieldsByOrder.splice(idx, 1);
        }

        this.fieldsById.delete(field.getId());

        if (resort) {
            this.resortOrderArray();
        }
    }

    resortOrderArray() {
        this.fieldsByOrder.sort(function (f1, f2) {
            let o1 = f1.getOrder();
            let o2 = f2.getOrder();

            if (!o1 && !o2) {
                return 0;
            } else if (!o1) {
                return 1;
            } else if (!o2) {
                return -1;
            }

            return o1 - o2;
        });
    }
}