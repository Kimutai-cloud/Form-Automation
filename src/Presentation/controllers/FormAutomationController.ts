import { IFormAutomation, FormAutomationConfig, FormAutomationResult } from '../../Application/Interfaces/IFormAutomation';
import { ExtractFormFieldsUseCase } from '../../Application/Use-Cases/ExtractFormFields';
import { FormProcessingService, IValidationService } from '../../Domain/Services/FromProcessingService';
import { Logger } from '../../Infrastucture/logging/Logger';
import { OpenAIRepository } from '../../Infrastucture/Repositories/OpenAIRepository';
import { ConsoleUserInterface } from '../../Infrastucture/ui/ConsoleUserInterface';
import { ValidationService } from '../../Domain/Services/ValidationService';
import { FormUtils } from '../../Domain/Services/FormUtils';
import { Page } from 'puppeteer';
import { FormField } from '../../Domain/Entities/FormField';

/**
 * Controller for managing the form automation process.
 * It orchestrates the use cases for extracting form fields, generating questions,
 * collecting user input, and submitting the form.
 */
export class FormAutomationController implements IFormAutomation {
  private formProcessingService: FormProcessingService | null = null;
  private readonly maxRetryAttempts: number = 3;

  constructor(
    private readonly extractFormFieldsUseCase: ExtractFormFieldsUseCase,
    private readonly openAIRepository: OpenAIRepository,
    private readonly consoleUI: ConsoleUserInterface,
    private readonly logger: Logger,
    private readonly validationService?: IValidationService
  ) {}

  async execute(config: FormAutomationConfig): Promise<FormAutomationResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('🎯 == Starting Enhanced Form Automation Process ==');
      
      const { fields, page } = await this.extractAndAnalyzeForm(config);
      
      this.initializeFormProcessingService(page);
      
      const shouldProceed = await this.presentFormSummaryAndConfirm(fields);
      if (!shouldProceed) {
        await page.close();
        return this.createCancelledResult();
      }

      const processingResult = await this.processFormWithRetries(fields);
      
      const duration = Date.now() - startTime;
      await page.close();
      
      return this.createSuccessResult(processingResult, duration);

    } catch (error) {
      this.logger.error('❌ Form automation failed:', error);
      return this.createErrorResult(error);
    }
  }

  private async extractAndAnalyzeForm(config: FormAutomationConfig): Promise<{fields: FormField[], page: Page}> {
    this.logger.info('📋 Extracting and analyzing form fields...');
    
    const extractResult = await this.extractFormFieldsUseCase.execute({
      url: config.url,
      timeout: config.timeout || 30000,
      headless: config.headless ?? true
    });

    if (!extractResult.success || !extractResult.fields || !extractResult.page) {
      throw new Error(`Form extraction failed: ${extractResult.error || 'Unknown error'}`);
    }

    const fields = extractResult.fields;
    const page = extractResult.page;

    this.logger.info(`✅ Extracted ${fields.length} form fields from ${config.url}`);
    
    const summary = FormUtils.generateFieldSummary(fields);
    const accessibility = FormUtils.analyzeAccessibility(fields);
    const estimatedTime = FormUtils.estimateCompletionTime(fields);

    this.logger.info(`📊 Form Analysis:
      - Complexity: ${summary.complexity}
      - Total Fields: ${summary.totalFields} (${summary.requiredFields} required)
      - Estimated Time: ${Math.ceil(estimatedTime / 60)} minutes
      - Accessibility Score: ${accessibility.score}/100`);

    if (accessibility.issues.length > 0) {
      this.logger.warn('⚠️  Accessibility Issues Detected:');
      accessibility.issues.forEach(issue => this.logger.warn(`  - ${issue}`));
    }

    return { fields, page };
  }

  private initializeFormProcessingService(page: Page): void {
    const validationService = this.validationService || new ValidationService(page);
    
    this.formProcessingService = new FormProcessingService(
      page,
      this.openAIRepository,
      this.consoleUI,
      validationService
    );

    this.logger.info('🔧 Form processing service initialized');
  }

  private async presentFormSummaryAndConfirm(fields: FormField[]): Promise<boolean> {
    const summary = FormUtils.generateFieldSummary(fields);
    const estimatedTime = FormUtils.estimateCompletionTime(fields);

    console.log('\n📋 Form Summary:');
    console.log(`   Total Fields: ${summary.totalFields}`);
    console.log(`   Required Fields: ${summary.requiredFields}`);
    console.log(`   Optional Fields: ${summary.optionalFields}`);
    console.log(`   Field Types: ${Object.entries(summary.fieldTypes).map(([type, count]) => `${type}(${count})`).join(', ')}`);
    console.log(`   Estimated Time: ${Math.ceil(estimatedTime / 60)} minutes`);
    console.log(`   Complexity: ${summary.complexity}`);

    const shouldProceed = await this.consoleUI.askQuestion(
      '\n🤔 Would you like to proceed with filling out this form? (yes/no):'
    );

    const proceed = ['yes', 'y', 'true', '1'].includes(shouldProceed.toLowerCase().trim());
    
    if (!proceed) {
      this.logger.info('❌ User chose not to proceed with form automation');
    }
    
    return proceed;
  }

  private async processFormWithRetries(fields: FormField[]): Promise<boolean> {
    if (!this.formProcessingService) {
      throw new Error('FormProcessingService not initialized');
    }

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.maxRetryAttempts) {
      attempt++;
      
      try {
        this.logger.info(`🔄 Processing attempt ${attempt}/${this.maxRetryAttempts}`);
        
        if (attempt > 1) {
          console.log('\n🔄 Retrying form processing with previous responses cached...');
        }

        const success = await this.formProcessingService.processFormWithValidation(fields);
        
        if (success) {
          this.logger.info('✅ Form processing completed successfully');
          return true;
        } else {
          throw new Error('Form processing failed without specific error');
        }

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`❌ Attempt ${attempt} failed:`, lastError.message);

        if (attempt < this.maxRetryAttempts) {
          const shouldRetry = await this.askUserForRetry(attempt, lastError);
          if (!shouldRetry) {
            this.logger.info('❌ User chose not to retry');
            break;
          }
          
          await FormUtils.delay(2000);
        }
      }
    }

    throw lastError || new Error('Form processing failed after maximum retry attempts');
  }

  private async askUserForRetry(attempt: number, error: Error): Promise<boolean> {
    const remainingAttempts = this.maxRetryAttempts - attempt;
    
    console.log(`\n⚠️  Form processing failed: ${error.message}`);
    console.log(`🔄 ${remainingAttempts} attempt(s) remaining.`);
    
    const retryResponse = await this.consoleUI.askQuestion(
      'Would you like to retry? (yes/no):'
    );

    return ['yes', 'y', 'true', '1'].includes(retryResponse.toLowerCase().trim());
  }

  private createSuccessResult(success: boolean, duration: number): FormAutomationResult {
    if (success) {
      this.logger.info(`✅ Form automation completed successfully in ${Math.ceil(duration / 1000)} seconds`);
      return {
        submission: {
          success: true,
          timestamp: new Date(),
          duration: duration,
          attempts: 1 
        } as any,
        success: true
      };
    } else {
      return {
        submission: {
          success: false,
          timestamp: new Date(),
          duration: duration,
          error: 'Form processing completed but submission may have failed'
        } as any,
        success: false,
        error: 'Form processing completed but submission status unclear'
      };
    }
  }

  private createCancelledResult(): FormAutomationResult {
    return {
      submission: null as any,
      success: false,
      error: 'Form automation cancelled by user'
    };
  }

  private createErrorResult(error: any): FormAutomationResult {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return {
      submission: {
        success: false,
        timestamp: new Date(),
        error: errorMessage
      } as any,
      success: false,
      error: errorMessage
    };
  }


  private validateConfig(config: FormAutomationConfig): void {
    if (!config.url) {
      throw new Error('URL is required for form automation');
    }

    if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
      throw new Error('URL must be a valid HTTP/HTTPS URL');
    }

    if (config.timeout && config.timeout < 5000) {
      throw new Error('Timeout must be at least 5000ms');
    }
  }


  public getCachedResponses(): Map<string, string> | null {
    return this.formProcessingService?.getCachedResponses() || null;
  }

  
  public clearCache(): void {
    this.formProcessingService?.clearResponseCache();
  }

  async executeWithValidation(config: FormAutomationConfig): Promise<FormAutomationResult> {
    try {
      this.validateConfig(config);
      return await this.execute(config);
    } catch (error) {
      this.logger.error('❌ Configuration validation failed:', error);
      return this.createErrorResult(error);
    }
  }

  async executeWithProgress(
    config: FormAutomationConfig,
    progressCallback?: (stage: string, progress: number) => void
  ): Promise<FormAutomationResult> {
    const progress = (stage: string, percent: number) => {
      this.logger.info(`📊 ${stage}: ${percent}%`);
      progressCallback?.(stage, percent);
    };

    try {
      progress('Initializing', 0);
      
      progress('Extracting form fields', 20);
      const { fields, page } = await this.extractAndAnalyzeForm(config);
      
      progress('Setting up form processor', 40);
      this.initializeFormProcessingService(page);
      
      progress('Awaiting user confirmation', 50);
      const shouldProceed = await this.presentFormSummaryAndConfirm(fields);
      if (!shouldProceed) {
        await page.close();
        return this.createCancelledResult();
      }

      progress('Processing form', 60);
      const processingResult = await this.processFormWithRetries(fields);
      
      progress('Completing automation', 100);
      await page.close();
      
      const duration = Date.now() - Date.now(); 
      return this.createSuccessResult(processingResult, duration);

    } catch (error) {
      progress('Error occurred', -1);
      this.logger.error('❌ Form automation failed:', error);
      return this.createErrorResult(error);
    }
  }
}