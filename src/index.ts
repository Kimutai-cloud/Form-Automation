import { Configuration } from './Infrastucture/config/Configurations';
import { Logger } from './Infrastucture/logging/Logger';
import { PuppeteerFormRepository } from './Infrastucture/Repositories/PuppeteerFormRepository';
import { OpenAIRepository } from './Infrastucture/Repositories/OpenAIRepository';
import { ConsoleUserInterface } from './Infrastucture/ui/ConsoleUserInterface';

import { FormProcessingService } from './Domain/Services/FromProcessingService';
import { QuestionGenerationService } from './Domain/Services/QuestionGenerationService';

import { ExtractFormFieldsUseCase } from './Application/Use-Cases/ExtractFormFields';
import { GenerateQuestionsUseCase } from './Application/Use-Cases/GenerateQuestions';
import { CollectUserInputUseCase } from './Application/Use-Cases/CollectUserInput';
import { SubmitFormUseCase } from './Application/Use-Cases/SubmitForm';

import { FormAutomationController } from './Presentation/controllers/FormAutomationController';
import { CLIRunner } from './Presentation/CLI/CLIRunner';
import { FormAutomationConfig } from './Application/Interfaces/IFormAutomation';

import dotenv from 'dotenv';

dotenv.config();

/**
 * Main entry point for the AI Form Automation application.
 * It initializes the configuration, repositories, services, use cases, and controller,
 */

async function main(): Promise<void> {
  // Initialize configuration
  const config = new Configuration();
 
  // Initialize logger
  const logger = new Logger(config.logLevel);
  
  // Initialize repositories
  const formRepository = new PuppeteerFormRepository(logger);
  const aiRepository = new OpenAIRepository(config.openaiApiKey, logger);
  const userInterface = new ConsoleUserInterface();
  
  // Initialize domain services
  const formProcessingService = new FormProcessingService();
  const questionGenerationService = new QuestionGenerationService();
  
  // Initialize use cases
  const extractFormFieldsUseCase = new ExtractFormFieldsUseCase(
    formRepository,
    formProcessingService
  );
  
  const generateQuestionsUseCase = new GenerateQuestionsUseCase(
    aiRepository,
    questionGenerationService
  );
  
  const collectUserInputUseCase = new CollectUserInputUseCase(
    userInterface,
    formProcessingService
  );
  
  const submitFormUseCase = new SubmitFormUseCase(
    formRepository,
    formProcessingService
  );
  
  // Initialize controller
  const controller = new FormAutomationController(
    extractFormFieldsUseCase,
    generateQuestionsUseCase,
    collectUserInputUseCase,
    submitFormUseCase,
    formProcessingService,
    logger
  );
  
  // Initialize CLI runner
  const cliRunner = new CLIRunner(controller, userInterface, logger);
  
  try {
    console.log('🤖 AI Form Automation Tool');
    console.log('===========================');
    
    // Get user configuration
    const userConfig = await cliRunner.getUserConfiguration();
    
    // Create final configuration
    const automationConfig: FormAutomationConfig = {
      url: userConfig.url || config.defaultFormUrl,
      tone: userConfig.tone || 'professional',
      timeout: userConfig.timeout || config.formTimeout,
      headless: userConfig.headless ?? config.headlessMode
    };
    
    // Run automation
    await cliRunner.run(automationConfig);
    
  } catch (error) {
    logger.error('Application failed:', error);
    console.error('💥 Fatal error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { main };