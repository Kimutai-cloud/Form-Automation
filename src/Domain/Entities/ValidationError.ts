import { IValidationError } from '../Repositories/IValidationError';

/**
 * Represents a validation error in a form field.
 */

export class ValidationError implements IValidationError {
    constructor(
        public fieldName: string,
        public fieldLabel: string,
        public errorMessage: string,
        public fieldType: string,
        public currentValue: string
    ) {}

    toString(): string {
        return `Field "${this.fieldLabel}" (${this.fieldName}): ${this.errorMessage}. Current value: "${this.currentValue}"`;
    }

    toUserFriendlyString(): string {
        return `There's an issue with "${this.fieldLabel}": ${this.errorMessage}`;
    }
}