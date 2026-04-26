// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'auto';

export interface FieldConfig {
    name: string;
    type?: FieldType;
    defaultValue?: any;
    mapping?: string;
}

export class Field {

    private name: string;
    private type: FieldType;
    private defaultValue: any;
    private mapping: string;

    constructor(config: FieldConfig) {
        this.name = config.name;
        this.type = config.type ?? 'auto';
        this.defaultValue = config.defaultValue;
        this.mapping = config.mapping ?? config.name;
    }

    getName(): string {
        return this.name;
    }

    getType(): FieldType {
        return this.type;
    }

    getDefaultValue(): any {
        return this.defaultValue;
    }

    getMapping(): string {
        return this.mapping;
    }
}
