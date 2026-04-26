// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export abstract class Proxy {
    abstract read(): Promise<any[]>;
}
