/**
 * Represents a form answer entity.
 * Contains the selector, value, field label, and timestamp of the answer.
 */
export interface FormAnswer {
  selector: string;
  value: string;
  fieldLabel: string;
  timestamp: Date;
}

export class FormAnswerEntity {
  constructor(
    public readonly selector: string,
    public readonly value: string,
    public readonly fieldLabel: string,
    public readonly timestamp: Date = new Date()
  ) {}

  static create(selector: string, value: string, fieldLabel: string): FormAnswerEntity {
    return new FormAnswerEntity(selector, value, fieldLabel);
  }

  toObject(): FormAnswer {
    return {
      selector: this.selector,
      value: this.value,
      fieldLabel: this.fieldLabel,
      timestamp: this.timestamp
    };
  }

  isValid(): boolean {
    return !!(this.selector && this.value !== undefined && this.fieldLabel);
  }
}