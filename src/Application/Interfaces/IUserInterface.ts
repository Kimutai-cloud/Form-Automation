/**
 * Contract for user interface interactions in the form automation application.
 * Provides methods to ask questions, show messages, display tables, and close the interface.
 */

export interface IUserInterface {
  askQuestion(question: string): Promise<string>;
  showMessage(message: string): Promise<void>;
  showTable(data: Record<string, any>): Promise<void>;
  close(): Promise<void>;
}