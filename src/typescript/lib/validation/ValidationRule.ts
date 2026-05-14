// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from '~/core/Component.js';
import { FieldDecorator } from '~/validation/FieldDecorator.js';

/**
 * A discriminated union of all supported validation rule types.
 *
 * Each variant carries a `message` override that is shown in the error tooltip
 * when the rule fails. If omitted, a sensible default message is used.
 *
 * @category Validation
 */
export type ValidationRule =
    | { type: 'required';  message?: string }
    | { type: 'minLength'; min: number;     message?: string }
    | { type: 'maxLength'; max: number;     message?: string }
    | { type: 'min';       min: number;     message?: string }
    | { type: 'max';       max: number;     message?: string }
    | { type: 'regex';     pattern: RegExp; message?: string }
    | { type: 'custom';    predicate: (value: unknown) => boolean; message?: string };

/**
 * Internal per-field configuration created by {@link Binding.addValidation}.
 *
 * Tracks the rules, the component reference, whether live validation is enabled
 * for this field, and the lazily-created {@link FieldDecorator}.
 */
export interface FieldValidationConfig {
    /** The rules to evaluate against the field's current value. */
    rules            : ValidationRule[];
    /** The UI component that will be wrapped by a {@link FieldDecorator} on error. */
    component        : Component;
    /** When true, validation runs on every field change. Overrides the global flag. */
    validateOnChange : boolean;
    /** The decorator instance, created lazily on first invalid result. */
    decorator        : FieldDecorator | null;
}
