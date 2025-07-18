import { Page } from 'puppeteer';
import { IFormRepository } from '../../Domain/Repositories/IFormRepository';
import { FormFieldEntity } from '../../Domain/Entities/FormField';
import { FormProcessingService } from '../../Domain/Services/FromProcessingService';

/**
 * Request and response interfaces for extracting form fields from a webpage.
 * This use case handles the extraction of form fields, validation, and summary generation.
 */
export interface ExtractFormFieldsRequest {
  url: string;
  timeout?: number;
  headless?: boolean;
}

export interface ExtractFormFieldsResponse {
  fields: FormFieldEntity[];
  summary: Record<string, any>;
  success: boolean;
  page?: Page;
  error?: string;
}

export class ExtractFormFieldsUseCase {
  constructor(
    private readonly formRepository: IFormRepository,
    private readonly formProcessingService: FormProcessingService
  ) {}

  async execute(request: ExtractFormFieldsRequest): Promise<ExtractFormFieldsResponse> {
    try {
      await this.formRepository.initialize(request.headless ?? true);
      await this.formRepository.navigateToPage(request.url, request.timeout);

      const rawFields = await this.formRepository.extractFormFields();
      const validFields = this.formProcessingService.validateFormFields(rawFields);

      if (validFields.length === 0) {
        return {
          fields: [],
          summary: {},
          success: false,
          error: 'No valid form fields found on the page',
        };
      }

      const summary = this.formProcessingService.generateFieldSummary(validFields);

      return {
        fields: validFields,
        summary,
        success: true,
        page: this.formRepository.getPage(), 
      };
    } catch (error) {
      return {
        fields: [],
        summary: {},
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
