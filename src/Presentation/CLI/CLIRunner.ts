import { FormAutomationController } from '../controllers/FormAutomationController';
import { FormAutomationConfig } from '../../Application/Interfaces/IFormAutomation';
import { IUserInterface } from '../../Application/Interfaces/IUserInterface';
import { Logger } from '../../Infrastucture/logging/Logger';

/**
 * CLIRunner class for running the form automation process in a command-line interface.
 * It handles user input, configuration, and displays results.
 */

export class CLIRunner {
  constructor(
    private readonly controller: FormAutomationController,
    private readonly userInterface: IUserInterface,
    private readonly logger: Logger
  ) {}

  async run(config: FormAutomationConfig): Promise<void> {
    try {
      console.log('🚀 Starting Form Automation...');
      console.log(`📝 Form URL: ${config.url}`);
      console.log(`🎯 Tone: ${config.tone}`);
      console.log(`⏱️  Timeout: ${config.timeout}ms`);
      console.log(`👁️  Headless: ${config.headless}`);
      console.log('---');

      const result = await this.controller.execute(config);

      if (result.success) {
        console.log('\n✅ Form automation completed successfully!');
        console.log('\n📊 Submission Summary:');
        await this.userInterface.showTable(result.submission.toSummary());
        
        if (result.submission.result) {
          console.log('\n🎉 Form Submission Result:');
          console.log(`Status: ${result.submission.result.success ? '✅ Success' : '❌ Failed'}`);
          console.log(`Message: ${result.submission.result.message || 'No message'}`);
          console.log(`URL: ${result.submission.result.url || 'No URL'}`);
          console.log(`Time: ${result.submission.result.timestamp.toLocaleString()}`);
        }
      } else {
        console.log('\n❌ Form automation failed!');
        console.log(`Error: ${result.error}`);
      }
    } catch (error) {
      this.logger.error('CLI execution failed:', error);
      console.log('\n💥 Unexpected error occurred!');
      console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      await this.userInterface.close();
    }
  }

  async getUserConfiguration(): Promise<Partial<FormAutomationConfig>> {
    console.log('🔧 Configuration Setup');
    console.log('---');

    const url = await this.userInterface.askQuestion(
      'Enter form URL (press Enter for default): '
    );

    const toneInput = await this.userInterface.askQuestion(
      'Choose tone (casual/professional) [professional]: '
    );

    const headlessInput = await this.userInterface.askQuestion(
      'Run in headless mode? (true/false) [false]: '
    );

    const timeoutInput = await this.userInterface.askQuestion(
      'Timeout in milliseconds [30000]: '
    );

    return {
      url: url || undefined,
      tone: (toneInput === 'casual' ? 'casual' : 'professional') as 'casual' | 'professional',
      headless: headlessInput === 'true',
      timeout: timeoutInput ? parseInt(timeoutInput) : undefined
    };
  }
}