import { IFormAutomation, FormAutomationConfig, FormAutomationResult } from '../../Application/Interfaces/IFormAutomation';
import { ExtractFormFieldsUseCase } from '../../Application/Use-Cases/ExtractFormFields';
import { GenerateQuestionsUseCase } from '../../Application/Use-Cases/GenerateQuestions';
import { CollectUserInputUseCase } from '../../Application/Use-Cases/CollectUserInput';
import { SubmitFormUseCase } from '../../Application/Use-Cases/SubmitForm';
import { FormProcessingService } from '../../Domain/Services/FromProcessingService';
import { Logger } from '../../Infrastucture/logging/Logger';

/**
 * Controller for managing the form automation process.
 * It orchestrates the use cases for extracting form fields, generating questions,
 * collecting user input, and submitting the form.
 */

export class FormAutomationController implements IFormAutomation {
  constructor(
    private readonly extractFormFieldsUseCase: ExtractFormFieldsUseCase,
    private readonly generateQuestionsUseCase: GenerateQuestionsUseCase,
    private readonly collectUserInputUseCase: CollectUserInputUseCase,
    private readonly submitFormUseCase: SubmitFormUseCase,
    private readonly formProcessingService: FormProcessingService,
    private readonly logger: Logger
  ) {}

  async execute(config: FormAutomationConfig): Promise<FormAutomationResult> {
    try {
      this.logger.info('Starting form automation process');
      
      // Step 1: Extract form fields
      const extractResult = await this.extractFormFieldsUseCase.execute({
        url: config.url,
        timeout: config.timeout,
        headless: config.headless
      });

      if (!extractResult.success) {
        return {
          submission: null as any,
          success: false,
          error: extractResult.error
        };
      }

      this.logger.info(`Extracted ${extractResult.fields.length} form fields`);

      // Step 2: Generate questions
      const questionsResult = await this.generateQuestionsUseCase.execute({
        fields: extractResult.fields,
        tone: config.tone
      });

      if (!questionsResult.success) {
        return {
          submission: null as any,
          success: false,
          error: questionsResult.error
        };
      }

      this.logger.info(`Generated ${questionsResult.questions.length} questions`);

      // Step 3: Collect user input
      const inputResult = await this.collectUserInputUseCase.execute({
        questions: questionsResult.questions
      });

      if (!inputResult.success) {
        return {
          submission: null as any,
          success: false,
          error: inputResult.error
        };
      }

      this.logger.info(`Collected ${inputResult.answers.length} user answers`);

      // Step 4: Create form submission
      const submission = this.formProcessingService.createFormSubmission(
        inputResult.answers,
        config.url
      );

      // Step 5: Submit form
      const submitResult = await this.submitFormUseCase.execute({
        submission
      });

      if (!submitResult.success) {
        return {
          submission: submitResult.submission,
          success: false,
          error: submitResult.error
        };
      }

      this.logger.info('Form automation completed successfully');
      
      return {
        submission: submitResult.submission,
        success: true
      };
    } catch (error) {
      this.logger.error('Form automation failed:', error);
      return {
        submission: null as any,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}