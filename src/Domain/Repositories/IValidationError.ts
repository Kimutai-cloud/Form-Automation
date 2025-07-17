export interface IValidationError {
    fieldName: string;
    fieldLabel: string;
    errorMessage: string;
    fieldType: string;
    currentValue: string;
}