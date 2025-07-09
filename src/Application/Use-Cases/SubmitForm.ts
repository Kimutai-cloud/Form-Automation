import { IFormRepository } from '../../Domain/Repositories/IFormRepository';
import { FormSubmissionEntity } from '../../Domain/Entities/FormSubmission';
import { FormProcessingService } from '../../Domain/Services/FromProcessingService';

/**
 * Use case for submitting a form with user answers.
 * It fills the form fields, submits the form, and returns the submission result.
 */

export interface SubmitFormRequest {
  submission: FormSubmissionEntity;
}

export interface SubmitFormResponse {
  submission: FormSubmissionEntity;
  success: boolean;
  error?: string;
}

export class SubmitFormUseCase {
  constructor(
    private readonly formRepository: IFormRepository,
    private readonly formProcessingService: FormProcessingService
  ) {}

  async execute(request: SubmitFormRequest): Promise<SubmitFormResponse> {
    try {
      const { submission } = request;
      
      // Validate submission
      if (!submission.isValid()) {
        return {
          submission,
          success: false,
          error: 'Invalid form submission data'
        };
      }
      
      // Fill form fields
      const answersMap = submission.getAnswersMap();
      
      for (const [selector, value] of answersMap) {
        await this.formRepository.fillField(selector, value);
      }
      
      // Submit form
      const submissionResult = await this.formRepository.submitForm();
      
      // Update submission with result
      const updatedSubmission = submission.withResult(submissionResult);
      
      return {
        submission: updatedSubmission,
        success: submissionResult.success
      };
    } catch (error) {
      return {
        submission: request.submission,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    } finally {
      // Clean up browser resources
      await this.formRepository.close();
    }
  }
}