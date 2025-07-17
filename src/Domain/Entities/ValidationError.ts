import { IValidationError } from '../Repositories/IValidationError';

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