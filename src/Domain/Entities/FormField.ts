/*
  * FormField.ts
  * Represents a form field entity with properties such as label, selector, type, required status, and placeholder.
  * Provides methods for validation and conversion to/from object representation.
  */
export interface FormField {
  label: string;
  selector: string;
  type: 'input' | 'textarea' | 'select';
  required: boolean;
  placeholder?: string;
}

export class FormFieldEntity {
  constructor(
    public readonly label: string,
    public readonly selector: string,
    public readonly type: 'input' | 'textarea' | 'select',
    public readonly required: boolean,
    public readonly placeholder?: string
  ) {}

  static fromObject(obj: FormField): FormFieldEntity {
    return new FormFieldEntity(
      obj.label,
      obj.selector,
      obj.type,
      obj.required,
      obj.placeholder
    );
  }

  toObject(): FormField {
    return {
      label: this.label,
      selector: this.selector,
      type: this.type,
      required: this.required,
      placeholder: this.placeholder
    };
  }

  isValid(): boolean {
    return !!(this.label && this.selector && this.type);
  }

  getFieldValidator(): (input: string) => { isValid: boolean; message?: string } {
    return (input: string) => {
      if (this.required && !input.trim()) {
        return {
          isValid: false,
          message: 'This field is required and cannot be empty.'
        };
      }
      
      const lowercaseLabel = this.label.toLowerCase();
      
      if (lowercaseLabel.includes('email')) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) {
          return {
            isValid: false,
            message: 'Please enter a valid email address.'
          };
        }
      }
      
      return { isValid: true };
    };
  }
}