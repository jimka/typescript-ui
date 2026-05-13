// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ValidationRule } from './ValidationRule.js';
import { FieldValidationResult } from './ValidationResult.js';

/**
 * Evaluates a single {@link ValidationRule} against a field value.
 *
 * This is a stateless pure function — it has no dependency on DOM or components
 * and can be tested independently.
 *
 * @param rule - The rule to evaluate.
 * @param value - The current field value.
 * @returns A {@link FieldValidationResult} with `valid` and `message`.
 */
export function applyRule(rule: ValidationRule, value: unknown): FieldValidationResult {
    switch (rule.type) {
        case 'required': {
            const empty = value === null
                || value === undefined
                || (typeof value === 'string' && value.trim() === '');
            if (empty) {
                return { valid: false, message: rule.message ?? 'This field is required.' };
            }

            break;
        }

        case 'minLength': {
            const str = typeof value === 'string' ? value : String(value ?? '');

            if (str.length < rule.min) {
                return {
                    valid  : false,
                    message: rule.message ?? `Minimum length is ${rule.min} characters.`,
                };
            }

            break;
        }

        case 'maxLength': {
            const str = typeof value === 'string' ? value : String(value ?? '');

            if (str.length > rule.max) {
                return {
                    valid  : false,
                    message: rule.message ?? `Maximum length is ${rule.max} characters.`,
                };
            }

            break;
        }

        case 'min': {
            const num = Number(value);

            if (isNaN(num) || num < rule.min) {
                return {
                    valid  : false,
                    message: rule.message ?? `Value must be at least ${rule.min}.`,
                };
            }

            break;
        }

        case 'max': {
            const num = Number(value);

            if (isNaN(num) || num > rule.max) {
                return {
                    valid  : false,
                    message: rule.message ?? `Value must be at most ${rule.max}.`,
                };
            }

            break;
        }

        case 'regex': {
            const str = typeof value === 'string' ? value : String(value ?? '');

            if (!rule.pattern.test(str)) {
                return {
                    valid  : false,
                    message: rule.message ?? 'Value does not match the required format.',
                };
            }

            break;
        }

        case 'custom': {
            if (!rule.predicate(value)) {
                return { valid: false, message: rule.message ?? 'Invalid value.' };
            }

            break;
        }
    }

    return { valid: true, message: '' };
}
