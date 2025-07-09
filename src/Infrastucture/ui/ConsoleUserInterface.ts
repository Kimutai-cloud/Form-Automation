import readline from 'readline';
import { IUserInterface } from '../../Application/Interfaces/IUserInterface';

/**
 * Console-based user interface implementation for interacting with the user.
 * It provides methods to ask questions, show messages, display tables, and close the interface.
 */

export class ConsoleUserInterface implements IUserInterface {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(`${question} `, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async showMessage(message: string): Promise<void> {
    console.log(message);
  }

  async showTable(data: Record<string, any>): Promise<void> {
    console.table(data);
  }

  async close(): Promise<void> {
    this.rl.close();
  }
}