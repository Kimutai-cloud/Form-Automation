import puppeteer, { Browser, Page } from "puppeteer";
import { IFormRepository } from "../../Domain/Repositories/IFormRepository";
import { FormProcessingService } from "../../Domain/Services/FromProcessingService";
import { ConsoleUserInterface } from "../../Infrastucture/ui/ConsoleUserInterface";
import { Configuration } from "../../Infrastucture/config/Configurations";
import { FormFieldEntity } from "../../Domain/Entities/FormField";
import { OpenAIRepository } from "../../Infrastucture/Repositories/OpenAIRepository";
import { ValidationService } from "../../Domain/Services/ValidationService";
import { Logger } from "../../Infrastucture/logging/Logger";
import { FormSubmissionEntity } from '../../Domain/Entities/FormSubmission';
import { FormAnswerEntity } from '../../Domain/Entities/FormAnswer';
import {
  FormAutomationConfig,
  FormAutomationResult,
} from "../../Application/Interfaces/IFormAutomation";

/**
 * Controller for managing form automation tasks.
 * It initializes the browser, navigates to the form, extracts fields,
 * processes the form with validation, and handles cleanup.
 */

export class FormAutomationController {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private formRepository: IFormRepository;
  private formProcessingService: FormProcessingService | null = null;
  private consoleUI: ConsoleUserInterface;
  private config: Configuration;
  private logger: Logger;
  private openAIRepository: OpenAIRepository;

  constructor(
    formRepository: IFormRepository,
    openAIRepository: OpenAIRepository,
    consoleUI: ConsoleUserInterface,
    config: Configuration,
    logger: Logger
  ) {
    this.formRepository = formRepository;
    this.openAIRepository = openAIRepository;
    this.consoleUI = consoleUI;
    this.config = config;
    this.logger = logger;
  }

  async run(automationConfig?: FormAutomationConfig): Promise<FormAutomationResult> {
  try {
    console.log('🚀 Starting Enhanced Form Automation with Validation...\n');
    
    await this.initializeBrowser(automationConfig?.headless ?? this.config.headlessMode);
    
    const formUrl = automationConfig?.url || this.config.defaultFormUrl;
    console.log(`📋 Navigating to form: ${formUrl}`);
    
    await this.page!.goto(formUrl, { 
      waitUntil: 'networkidle2',
      timeout: automationConfig?.timeout || this.config.formTimeout
    });
    
    console.log('🔍 Analyzing form fields...');
    
    // Initialize the form repository with the page
    await this.formRepository.initialize(automationConfig?.headless ?? this.config.headlessMode);
    await this.formRepository.navigateToPage(formUrl, automationConfig?.timeout);
    
    const formFields = await this.formRepository.extractFormFields();
    
    if (formFields.length === 0) {
      console.log('❌ No form fields found on the page.');
      return {
        submission: null as any,
        success: false,
        error: 'No form fields found on the page'
      };
    }
    
    console.log(`✅ Found ${formFields.length} form fields:`);
    formFields.forEach(field => {
      console.log(`  - ${field.label} (${field.type})`);
    });
    
    this.initializeFormProcessingService();
    
    
    const formFieldsForProcessing = formFields.map(field => field.toObject());
    
    
    const success = await this.formProcessingService!.processFormWithValidationEnhanced(formFieldsForProcessing);
    
    if (success) {
      console.log('\n🎉 Form processing completed successfully!');
      
      
      const cachedResponses = this.formProcessingService!.getCachedResponses();
      const answers: FormAnswerEntity[] = [];
      
      for (const [fieldName, value] of cachedResponses) {
        const answer = FormAnswerEntity.create(fieldName, value, fieldName);
        answers.push(answer);
      }
      
      const submission = FormSubmissionEntity.create(answers, this.page!.url());
      
      const submissionWithResult = submission.withResult({
        success: true,
        timestamp: new Date(),
        url: this.page!.url(),
        message: 'Form submitted successfully'
      });
      
      return {
        submission: submissionWithResult,
        success: true
      };
    } else {
      console.log('\n❌ Form processing failed or was incomplete.');
      
      const submission = FormSubmissionEntity.create([], this.page!.url());
      const submissionWithResult = submission.withResult({
        success: false,
        timestamp: new Date(),
        url: this.page!.url(),
        message: 'Form processing failed or was incomplete'
      });
      
      return {
        submission: submissionWithResult,
        success: false,
        error: 'Form processing failed or was incomplete'
      };
    }

  } catch (error) {
    console.error('❌ Error in form automation:', error);
    this.logger.error('Form automation error:', error);
    
    return {
      submission: null as any,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  } finally {
    await this.cleanup();
  }
}

  private async initializeBrowser(headless: boolean = true): Promise<void> {
    console.log("🌐 Launching browser...");

    this.browser = await puppeteer.launch({
      headless: headless,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });

    this.page = await this.browser.newPage();

    await this.page.setViewport({ width: 1280, height: 720 });

    await this.page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    console.log("✅ Browser initialized successfully");
  }

  private initializeFormProcessingService(): void {
    if (!this.page) {
      throw new Error("Page not initialized");
    }

    const validationService = new ValidationService(this.page);

    this.formProcessingService = new FormProcessingService(
      this.page,
      this.openAIRepository,
      this.consoleUI,
      validationService
    );

    console.log("🔧 FormProcessingService initialized");
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    console.log("🧹 Cleaning up resources...");

    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    await this.consoleUI.close();
    console.log("✅ Cleanup completed");
  }

  async handleShutdown(): Promise<void> {
    console.log("\n🛑 Received shutdown signal...");
    await this.cleanup();
    process.exit(0);
  }

  public getPage(): Page | null {
    return this.page;
  }

  public isInitialized(): boolean {
    return this.browser !== null && this.page !== null;
  }
}
