// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Util } from "./Util.js"

/**
 * Base class for all library objects.
 * Automatically assigns a unique identifier on construction.
 */
export class BaseObject {

    private id: string;

    constructor() {
        this.id = Util.generateUUID();
    }

    /**
     * Returns the unique identifier for this object.
     *
     * @returns The UUID string assigned at construction time.
     */
    getId() {
        return this.id;
    }

    /**
     * Sets the unique identifier for this object.
     *
     * @param id - The new identifier string to assign.
     */
    setId(id: string) {
        this.id = id;
    }

    /**
     * Returns the runtime class name of this object.
     *
     * @returns The name of the constructor function as a string.
     */
    getClassName() {
        return this.constructor.name;
    }
};
