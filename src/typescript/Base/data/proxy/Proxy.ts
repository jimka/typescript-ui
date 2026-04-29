// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ModelRecord } from '../ModelRecord.js';

export abstract class Proxy {
    abstract read(): Promise<any[]>;
    abstract create(record: ModelRecord): Promise<Record<string, any>>;
    abstract update(record: ModelRecord): Promise<Record<string, any>>;
    abstract destroy(record: ModelRecord): Promise<void>;
}
