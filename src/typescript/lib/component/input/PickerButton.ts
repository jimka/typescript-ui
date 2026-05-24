// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Insets } from "~/primitive/Insets.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { callable } from "~/core/Callable.js";

/**
 * Internal `<button>` Component used by every {@link AbstractPickerField}
 * concrete subclass (DateField / TimeField / DateTimeField) as the
 * glyph-bearing trigger to the right of the input. Centers a single glyph
 * child via a `doLayout` override; no `display: flex` needed on the button
 * element itself.
 *
 * @category Components
 */
class PickerButton extends Component {

    constructor() {
        super({ tag: "button" });

        this.setBorder({ style: BorderStyle.NONE, width: 0, color: "transparent" });
        this.setBackgroundColor("transparent");
        this.setCursor("pointer");
        this.setPadding(new Insets(0, 4, 0, 4));
    }

    /**
     * Centers the single glyph child within the button's inner rect. The
     * glyph is sized to its preferred 16x16 box (Glyph default) and placed
     * at the geometric center of the inner area.
     */
    doLayout(): this {
        super.doLayout();

        const inner = this.getInnerSize();
        const child = this.getComponents()[0];
        if (!inner || !child) {
            return this;
        }

        const childSize = child.getPreferredSize();
        if (!childSize) {
            return this;
        }

        const insets = this.getInsets();
        const x = insets.getLeft() + Math.max(0, (inner.width  - childSize.width)  / 2);
        const y = insets.getTop()  + Math.max(0, (inner.height - childSize.height) / 2);

        child.setX(x);
        child.setY(y);
        child.setWidth(childSize.width);
        child.setHeight(childSize.height);

        return this;
    }
}

const PickerButtonCallable = callable(PickerButton);
type PickerButtonCallable = PickerButton;
export {
    PickerButton         as _PickerButton,
    PickerButtonCallable as PickerButton,
};
