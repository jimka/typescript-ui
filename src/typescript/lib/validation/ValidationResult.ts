// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The result of evaluating one or more validation rules against a field value.
 *
 * @category Validation
 */
export interface FieldValidationResult {
    /** True if all rules passed; false if any rule failed. */
    valid  : boolean;
    /** The first failing rule's message, or an empty string when valid. */
    message: string;
}
