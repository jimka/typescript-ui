// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text } from "./Text.js"
import { Position } from "../Position.js";

/**
 * A legend component backed by a `<legend>` element.
 *
 * Uses static CSS positioning so the browser can render the title text inside a fieldset border.
 */
export class Legend extends Text {

    constructor() {
        super("legend");

        // Needs to be static for the browser to position the title text properly.
        this.setPosition(Position.STATIC);
    }
}