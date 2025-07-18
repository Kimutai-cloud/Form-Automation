import { FormAutomationController } from '../controllers/FormAutomationController';
import { FormAutomationConfig } from '../../Application/Interfaces/IFormAutomation';
import { IUserInterface } from '../../Application/Interfaces/IUserInterface';
import { Logger } from '../../Infrastucture/logging/Logger';

/**
 * Command Line Interface (CLI) runner for the AI Form Automation Tool.
 * This class handles user interaction, configuration, and execution of form automation tasks.
 */

export class CLIRunner {
  constructor(
    private readonly controller: FormAutomationController,
    private readonly userInterface: IUserInterface,
    private readonly logger: Logger
  ) {}

  async run(config: FormAutomationConfig): Promise<void> {
    try {
      console.clear(); 
      console.log('╔════════════════════════════════════════════╗');
      console.log('║        🤖 AI Form Automation Tool          ║');
      console.log('╚════════════════════════════════════════════╝');
      console.log('\n📍 Form URL:', config.url);
      console.log('🎨 Tone:', config.tone);
      console.log('⏱️  Timeout:', `${config.timeout}ms`);
      console.log('🖥️  Mode:', config.headless ? 'Headless' : 'Browser Window');
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const result = await this.controller.run(config);

      if (result.success) {
        console.log('\n╔════════════════════════════════════════════╗');
        console.log('║     ✅ Form Submitted Successfully! 🎉     ║');
        console.log('╚════════════════════════════════════════════╝');
        
        if (result.submission) {
          try {
            if (typeof result.submission.toSummary === 'function') {
              const summary = result.submission.toSummary();
              console.log('\n📊 Your Submitted Information:');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              
              Object.entries(summary).forEach(([key, value]) => {
                const displayKey = key.replace(/\*/g, '').trim();
                console.log(`  ${displayKey}: ${value}`);
              });
              
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            }
          } catch (summaryError) {
            this.logger.warn('Could not display submission summary:', summaryError);
          }
        }
        
        if (result.submission?.result?.url) {
          console.log(`\n🔗 Submission URL: ${result.submission.result.url}`);
        }
        
        console.log('\n✨ Thank you for using the AI Form Automation Tool!');
      } else {
        console.log('\n╔════════════════════════════════════════════╗');
        console.log('║      ❌ Form Submission Failed            ║');
        console.log('╚════════════════════════════════════════════╝');
        
        if (result.error) {
          console.log('\n📝 Error Details:', result.error);
        }
        
        console.log('\n💡 Tips:');
        console.log('  • Check if the form URL is correct');
        console.log('  • Ensure all required fields are filled');
        console.log('  • Try running with headless mode disabled to see what\'s happening');
      }
    } catch (error) {
      this.logger.error('CLI execution failed:', error);
      console.log('\n╔════════════════════════════════════════════╗');
      console.log('║      💥 Unexpected Error Occurred         ║');
      console.log('╚════════════════════════════════════════════╝');
      console.log('\n📝 Error:', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      await this.userInterface.close();
    }
  }

  async getUserConfiguration(): Promise<Partial<FormAutomationConfig>> {
    console.clear();
    console.log('╔════════════════════════════════════════════╗');
    console.log('║        🤖 AI Form Automation Tool          ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('\n🔧 Let\'s configure your form automation:\n');

    const url = await this.userInterface.askQuestion(
      '📝 Enter form URL (or press Enter for demo form)'
    );

    const toneInput = await this.userInterface.askQuestion(
      '🎨 Choose tone - casual or professional (default: professional)'
    );

    const headlessInput = await this.userInterface.askQuestion(
      '🖥️  Run in background? yes/no (default: no - shows browser)'
    );

    const timeoutInput = await this.userInterface.askQuestion(
      '⏱️  Timeout in seconds (default: 30)'
    );

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return {
      url: url || undefined,
      tone: (toneInput === 'casual' ? 'casual' : 'professional') as 'casual' | 'professional',
      headless: headlessInput.toLowerCase() === 'yes' || headlessInput.toLowerCase() === 'true',
      timeout: timeoutInput ? parseInt(timeoutInput) * 1000 : undefined
    };
  }

  async showWelcome(): Promise<void> {
    console.clear();
    console.log('╔════════════════════════════════════════════╗');
    console.log('║        🤖 AI Form Automation Tool          ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log('║                                            ║');
    console.log('║  This tool will help you fill out forms   ║');
    console.log('║  automatically using AI-powered questions  ║');
    console.log('║                                            ║');
    console.log('║  Features:                                 ║');
    console.log('║  • 📋 Automatic form field detection       ║');
    console.log('║  • 🤔 AI-generated conversational questions║');
    console.log('║  • 🔍 Smart validation error handling      ║');
    console.log('║  • 📝 Support for all field types          ║');
    console.log('║  • 🔄 Automatic retry on errors            ║');
    console.log('║                                            ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('\n💡 Tip: Type "quit" at any time to cancel\n');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}