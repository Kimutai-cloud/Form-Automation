/**
 * Interface representing a validation error in a form field
 */
export interface IValidationError {
    fieldName: string;
    fieldLabel: string;
    errorMessage: string;
    fieldType: string;
    currentValue: string;
}