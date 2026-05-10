// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component";
import { Insets } from "./Insets";

/**
 * A `Component` subclass that applies a default 4-pixel inset on all sides.
 *
 * Use `Panel` as the base class for grouped UI containers where children
 * should not sit flush against the outer edge. Plain `Component` defaults
 * to zero insets to keep leaf widgets pixel-predictable; `Panel` opts into
 * the visual breathing room that grouped layouts typically want.
 *
 * @category Core
 */
export class Panel extends Component {

    /**
     * Creates a panel with 4-pixel insets on all sides.
     *
     * @param tag - Optional. The HTML tag to render. Defaults to `"div"`.
     */
    constructor(tag: string = "div") {
        super(tag);

        this.setInsets(new Insets(4, 4, 4, 4));
    }
}
