import readline from 'readline';
import { IUserInterface } from '../../Application/Interfaces/IUserInterface';

export class ConsoleUserInterface implements IUserInterface {
  private rl: readline.Interface;
  private questionCount: number = 0;
  private totalQuestions: number = 0;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  setTotalQuestions(total: number): void {
    this.totalQuestions = total;
    this.questionCount = 0;
  }

  async askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.questionCount++;
      
      const progress = this.totalQuestions > 0 
        ? `[${this.questionCount}/${this.totalQuestions}] `
        : '';
      
      const cleanQuestion = question
        .replace(/\n\n/g, '\n')  
        .replace(/\n$/, '');      
      
      if (this.questionCount > 1) {
        console.log(''); 
      }
      
      this.rl.question(`${progress}${cleanQuestion}: `, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async showMessage(message: string): Promise<void> {
    if (this.shouldShowMessage(message)) {
      console.log(message);
    }
  }

  async showTable(data: Record<string, any>): Promise<void> {
    console.log('\n📋 Form Summary:');
    console.log('─'.repeat(50));
    
    Object.entries(data).forEach(([key, value]) => {
      const displayKey = key.replace(/\*/g, '').trim();
      console.log(`  ${displayKey}: ${value}`);
    });
    
    console.log('─'.repeat(50));
  }

  async showProgress(message: string): Promise<void> {
    console.log(`\n✨ ${message}`);
  }

  async showError(message: string): Promise<void> {
    console.log(`\n❌ ${message}`);
  }

  async showSuccess(message: string): Promise<void> {
    console.log(`\n✅ ${message}`);
  }

  async close(): Promise<void> {
    this.rl.close();
  }

  private shouldShowMessage(message: string): boolean {
    const technicalPrefixes = [
      '🔍', '🔧', 'info:', 'debug:', 'ℹ️', '⏳',
      'Browser initialized', 'Successfully navigated',
      'Extracted', 'Generated question', 'Trying selector',
      'Found element', 'Successfully filled'
    ];
    
    return !technicalPrefixes.some(prefix => message.includes(prefix));
  }
}