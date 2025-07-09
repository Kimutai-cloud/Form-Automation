import { FormFieldEntity } from '../Entities/FormField';
import { FormAnswerEntity } from '../Entities/FormAnswer';
import { FormSubmissionEntity } from '../Entities/FormSubmission';
/**
 * Service for processing form fields and submissions.
 * Provides methods to validate fields, create submissions, and sanitize inputs.
 */
export class FormProcessingService {
  validateFormFields(fields: FormFieldEntity[]): FormFieldEntity[] {
    return fields.filter(field => field.isValid());
  }

  createFormSubmission(
    answers: FormAnswerEntity[],
    url: string
  ): FormSubmissionEntity {
    const validAnswers = answers.filter(answer => answer.isValid());
    return FormSubmissionEntity.create(validAnswers, url);
  }

  validateAnswer(field: FormFieldEntity, input: string): { isValid: boolean; message?: string } {
    const validator = field.getFieldValidator();
    return validator(input);
  }

  sanitizeInput(input: string): string {
    return input.trim();
  }

  generateFieldSummary(fields: FormFieldEntity[]): Record<string, any> {
    return {
      totalFields: fields.length,
      requiredFields: fields.filter(f => f.required).length,
      fieldTypes: fields.reduce((acc, field) => {
        acc[field.type] = (acc[field.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };
  }
}