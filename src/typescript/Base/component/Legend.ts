// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text } from "./Text.js"
import { Position } from "../Position.js";

export class Legend extends Text {

    constructor() {
        super("legend");

        // Needs to be static for the browser to position the title text properly.
        this.setPosition(Position.STATIC);
    }
}