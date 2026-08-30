// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Form}.
 *
 * @category Core
 */
export interface FormOptions extends PanelOptions {
    /**
     * Called after a native form submission is requested — via the submit
     * button, Enter in a field, or `requestSubmit()`. The framework has already
     * called `preventDefault()` on the submit event, so the page will not
     * navigate; the handler owns what submission means.
     */
    onSubmit?: (form: Form) => void;
}

/**
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade in `Component`'s constructor dispatches each setter once with the
 * final value, so any field the caller supplied wins.
 */
const _defaultFormOptions: Partial<FormOptions> = {
    tag: "form",
};

/**
 * A {@link Panel} that bakes the semantic `<form>` tag and wires the native
 * `submit` event to a single `onSubmit` callback.
 *
 * Use `Form` as the content surface for a group of fields that should submit
 * together — it inherits `Panel`'s 4-pixel insets and `autoScroll` stack, so a
 * tall form in a short area scrolls rather than inflating to content size.
 * Trigger a submission from an external control (e.g. a footer button outside
 * the form) via {@link Form.requestSubmit}, which reaches the browser's native
 * `HTMLFormElement.requestSubmit()` — firing the cancelable `submit` event and
 * running constraint validation — through the `DOM.sink` seam, mirroring how
 * {@link Component.focus} reaches the native `focus()`.
 *
 * @example
 * ```typescript
 * const form = new Form({
 *     onSubmit: (f) => console.log('submitted'),
 * });
 * // ...
 * submitButton.on("action", () => form.requestSubmit());
 * ```
 *
 * @category Core
 */
class Form<TOptions extends FormOptions = FormOptions> extends Panel<TOptions> {

    private _onSubmit: ((form: Form) => void) | null = null;

    /**
     * @param options - Optional. Construction-time options applied to the form.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(options, { ..._defaultFormOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>);

        // Wire after super() returns: Event.addListener needs the fully
        // constructed component, and this is the deferred-dispatch site the
        // super-cascade trap requires (never applyOptions).
        this._onSubmit = options?.onSubmit ?? null;
        Event.addListener(this, "submit", this.handleSubmit);
    }

    /**
     * Handles the native `submit` event: prevents the browser's default
     * navigation and forwards to the `onSubmit` callback, if any.
     *
     * @param e - The native submit event.
     */
    private handleSubmit(e: SubmitEvent): void {
        e.preventDefault();
        this._onSubmit?.(this);
    }

    /**
     * Requests a native form submission, firing the cancelable `submit` event
     * and running the browser's constraint validation (unlike `.submit()`,
     * which skips both). No-op if the form is not yet rendered.
     */
    requestSubmit(): void {
        const element = this.getElement();

        if (!element) {
            return;
        }

        DOM.sink.requestSubmit(element);
    }
}

const FormCallable = callable(Form);
type FormCallable<TOptions extends FormOptions = FormOptions> = Form<TOptions>;
export {
    Form         as _Form,
    FormCallable as Form,
};
