// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from '~/core/Component.js';
import { Fit } from '~/layout/Fit.js';
import { Tooltip } from '~/core/Tooltip.js';
import { callable } from "~/core/Callable.js";

/**
 * A thin wrapper component that provides error visualisation for a field component.
 *
 * On construction the decorator removes the field from its current parent and inserts
 * itself in the parent, then re-adds the field as its own child. This means the error
 * border is applied to the decorator — never to the field itself — so the field's own
 * border is left untouched and removing the validation state is a clean one-step reset.
 *
 * @remarks Due to the framework's append-only `addComponent` API the decorator is
 * placed at the end of the parent's children rather than in the field's original slot.
 * A future `addComponentAt(index, component)` enhancement could address this.
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
        this.setInsets(null);

        // Inherit the theme border radius so the outline follows the field's rounded corners.
        this.setBorderRadius('var(--ts-ui-border-radius)');

        // Mirror the field's preferred size so the parent layout allocates the
        // same space for the decorator as it did for the field.  Without this,
        // layouts that fall back to a default width (e.g. HBox defaultComponentWidth)
        // would give the decorator a different — usually smaller — allocation.
        const ps = field.getPreferredSize();

        if (ps) {
            this.setPreferredSize(ps.width, ps.height);
        } else {
            this.setPreferredSize(field.getWidth(), field.getHeight());
        }

        parent.removeComponent(field);
        parent.addComponent(this);
        this.addComponent(field);
    }

    /**
     * Applies a red validation-error outline to this decorator and attaches an error
     * tooltip that appears on hover.
     *
     * CSS `outline` is used instead of `border` so that the decorator's content area
     * and the wrapped field's size are completely unaffected — outline renders outside
     * the box model and takes up no layout space.
     *
     * @param message - The error message to display in the tooltip.
     */
    showError(message: string): this {
        this.setOutline('2px solid var(--ts-ui-validation-error-border)');

        Tooltip.attach(this, message, {
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
        this.setOutline(null);
        Tooltip.detach(this);

        return this;
    }
}

const FieldDecoratorCallable = callable(FieldDecorator);
type FieldDecoratorCallable = FieldDecorator;
export {
    FieldDecorator         as _FieldDecorator,
    FieldDecoratorCallable as FieldDecorator
};
