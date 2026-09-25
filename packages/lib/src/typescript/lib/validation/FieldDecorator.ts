// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from '~/core/Component.js';
import { Fit } from '~/layout/Fit.js';
import { Tooltip } from '~/overlay/Tooltip.js';
import { callable } from "~/core/Callable.js";

/**
 * A thin wrapper component that provides error visualisation for a field component.
 *
 * On construction the decorator replaces the field in its current parent — via
 * {@link Component.replaceComponent}, so it takes the field's original index and
 * layout constraints — then re-adds the field as its own child. This means the error
 * border is applied to the decorator — never to the field itself — so the field's own
 * border is left untouched, removing the validation state is a clean one-step reset,
 * and the field's position among its siblings is preserved.
 *
 * @category Validation
 */
class FieldDecorator extends Component {

    /**
     * Creates a decorator that wraps `field` inside `parent`.
     *
     * The field is removed from `parent` and the decorator is added in its place,
     * then the field is added as a child of the decorator.
     *
     * @param field - The UI component to decorate.
     * @param parent - The current parent container of `field`.
     */
    constructor(field: Component, parent: Component) {
        super();

        this.setLayoutManager(new Fit());

        // Every Component defaults to 4px insets on all sides.  Zero them out so
        // the Fit layout gives the field the decorator's full content area.
        this.clearInsets();

        // Inherit the theme border radius so the outline follows the field's rounded corners.
        this.setBorderRadius('var(--ts-ui-border-radius)');

        // Mirror the field's preferred size so the parent layout allocates the
        // same space for the decorator as it did for the field.  Without this,
        // layouts that fall back to a default width (e.g. HBox defaultComponentWidth)
        // would give the decorator a different — usually smaller — allocation.
        const ps = field.getPreferredSize();

        if (ps) {
            this.setPreferredSize({ width: ps.width, height: ps.height });
        } else {
            this.setPreferredSize({ width: field.getWidth(), height: field.getHeight() });
        }

        parent.replaceComponent(field, this);
        this.addComponent(field);
    }

    /**
     * Applies a red validation-error outline to this decorator and attaches an error
     * tooltip that appears when the pointer rests anywhere on the decorated field.
     * The field fills the decorator, so the tooltip listens on the decorator's whole
     * subtree rather than on its own element; over the field it takes precedence
     * over a tooltip attached to the field itself.
     *
     * A message that changes while the pointer is already resting on the field —
     * the usual shape of validation on change, since the pointer never moves
     * between keystrokes — appears after the same hover delay without leaving
     * the field and returning.
     *
     * CSS `outline` is used instead of `border` so that the decorator's content area
     * and the wrapped field's size are completely unaffected — outline renders outside
     * the box model and takes up no layout space.
     *
     * @param message - The error message to display in the tooltip.
     */
    showError(message: string): this {
        this.setOutline('2px solid var(--ts-ui-validation-error-border)');

        Tooltip.attachCovering(this, message, {
            background: 'var(--ts-ui-validation-error-tooltip-bg)',
            color     : 'var(--ts-ui-validation-error-tooltip-color)',
            border    : 'var(--ts-ui-validation-error-tooltip-border)',
        });

        return this;
    }

    /**
     * Removes the error outline and detaches the error tooltip.
     */
    clearError(): this {
        this.clearOutline();
        Tooltip.detach(this);

        return this;
    }

    /**
     * Opts into the unchanged-geometry layout skip: a decorator re-committed at
     * the rectangle it already holds, with no pass owed, is not re-laid-out.
     *
     * A decorator is a `Fit` over exactly one child with cleared insets, so its
     * pass reads nothing but the content box a skip by definition did not
     * change. Every input announces itself:
     *
     * - {@link showError} and {@link clearError} write a CSS `outline` and
     *   attach or detach a tooltip. An outline renders outside the box model and
     *   takes no layout space, and a tooltip is an overlay with its own root, so
     *   neither is a layout input — which is the whole point of decorating
     *   instead of bordering the field.
     * - The field's own re-measure schedules its parent, which is this
     *   decorator, and a `setPreferredSize` on the field relays upward through
     *   it.
     * - The preferred size mirrored from the field in the constructor is copied
     *   once, before the decorator is added.
     * - `setInsets` / `clearInsets`, `setLayoutManager`, padding and border —
     *   each marks the layout owed here, like any `invalidateLayout`.
     *
     * Not covered, and so not re-flowed until the decorator's rectangle next
     * moves or something schedules it: a consumer field that changes its own
     * intrinsic size without calling `setPreferredSize` or
     * `notifyIntrinsicSizeChanged`. It should follow its change with
     * `scheduleLayout()`.
     *
     * @returns `true`.
     */
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }
}

const FieldDecoratorCallable = callable(FieldDecorator);
type FieldDecoratorCallable = FieldDecorator;
export {
    FieldDecorator         as _FieldDecorator,
    FieldDecoratorCallable as FieldDecorator
};
