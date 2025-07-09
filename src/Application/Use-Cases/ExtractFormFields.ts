import { IFormRepository } from '../../Domain/Repositories/IFormRepository';
import { FormFieldEntity } from '../../Domain/Entities/FormField';
import { FormProcessingService } from '../../Domain/Services/FromProcessingService';

/**
 * Use case for extracting form fields from a given URL.
 * It initializes the repository, navigates to the page, extracts fields,
 * validates them, and generates a summary.
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
  error?: string;
}

export class ExtractFormFieldsUseCase {
  constructor(
    private readonly formRepository: IFormRepository,
    private readonly formProcessingService: FormProcessingService
  ) {}

  async execute(request: ExtractFormFieldsRequest): Promise<ExtractFormFieldsResponse> {
    try {
      // Initialize browser
      await this.formRepository.initialize(request.headless ?? true);
      
      // Navigate to form page
      await this.formRepository.navigateToPage(request.url, request.timeout);
      
      // Extract form fields
      const rawFields = await this.formRepository.extractFormFields();
      
      // Validate and process fields
      const validFields = this.formProcessingService.validateFormFields(rawFields);
      
      if (validFields.length === 0) {
        return {
          fields: [],
          summary: {},
          success: false,
          error: 'No valid form fields found on the page'
        };
      }
      
      // Generate summary
      const summary = this.formProcessingService.generateFieldSummary(validFields);
      
      return {
        fields: validFields,
        summary,
        success: true
      };
    } catch (error) {
      return {
        fields: [],
        summary: {},
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}