import { FormAutomationController } from "./Presentation/controllers/FormAutomationController";
import { PuppeteerFormRepository } from "./Infrastucture/Repositories/PuppeteerFormRepository";
import { OpenAIRepository } from "./Infrastucture/Repositories/OpenAIRepository";
import { FormProcessingService } from "./Domain/Services/FromProcessingService";
import { ConsoleUserInterface } from "./Infrastucture/ui/ConsoleUserInterface";
import { Configuration } from "./Infrastucture/config/Configurations";
import { Logger } from "./Infrastucture/logging/Logger";
import { ExtractFormFieldsUseCase } from "./Application/Use-Cases/ExtractFormFields";
import { QuestionGenerationService } from "./Domain/Services/QuestionGenerationService"; 
import { FormAutomationConfig } from "./Application/Interfaces/IFormAutomation";
import { CLIRunner } from "./Presentation/CLI/CLIRunner";
import * as fs from "fs";
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });


const screenshotsDir = "./screenshots";
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function main(): Promise<void> {
  console.log("🤖  Form Automation");
  console.log("This tool will:");
  console.log("1. 📋 Extract form fields from the webpage");
  console.log("2. 🤔 Generate conversational questions using AI");
  console.log("3. 📝 Fill out the form with your responses");
  console.log("4. 🔍 Detect validation errors automatically");
  console.log("5. 🔄 Ask for corrections and retry submission");
  console.log("6. ✅ Complete the form successfully");
  console.log();

  const config = new Configuration();
  const logger = new Logger(config.logLevel);

  // Initialize repositories
  const formRepository = new PuppeteerFormRepository(logger);
  const aiRepository = new OpenAIRepository(config.openaiApiKey, logger);
  const userInterface = new ConsoleUserInterface();
  const questionGenerationService = new QuestionGenerationService(); 

  const controller = new FormAutomationController(
    formRepository,     
    aiRepository,        
    userInterface,       
    config,             
    logger              
  );

  const cliRunner = new CLIRunner(controller, userInterface, logger);

  const handleShutdown = async () => {
    console.log("\n🛑 Shutting down...");
    try {
      await userInterface.close();
      await formRepository.close();
      console.log("✅ Cleanup completed");
    } catch (error) {
      console.error("❌ Error during cleanup:", error);
    }
    process.exit(0);
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  process.on("uncaughtException", async (error) => {
    console.error("💥 Uncaught Exception:", error);
    await handleShutdown();
  });

  process.on("unhandledRejection", async (reason, promise) => {
    console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
    await handleShutdown();
  });

  try {
    console.log('🤖 AI Form Automation Tool');
    console.log('===========================');
    
    const userConfig = await cliRunner.getUserConfiguration();
    
    const automationConfig: FormAutomationConfig = {
      url: userConfig.url || config.defaultFormUrl,
      tone: userConfig.tone || 'professional',
      timeout: userConfig.timeout || config.formTimeout,
      headless: userConfig.headless ?? config.headlessMode
    };
    
    await cliRunner.run(automationConfig);
    
  } catch (error) {
    logger.error('Application failed:', error);
    console.error('💥 Fatal error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("💥 Application startup failed:", error);
    process.exit(1);
  });
}