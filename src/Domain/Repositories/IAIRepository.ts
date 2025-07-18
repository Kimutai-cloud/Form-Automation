/**
 * Interface for AI question generation requests and responses.
 * Provides methods to generate questions based on form field labels and additional context.
 */

export interface AIQuestionRequest {
  labelText: string;
  fieldType?: 'input' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'date' | 'email' | 'number' | 'tel' | 'file' | 'password' | 
    'url' | 'color' | 'range' | 'time' | 'month' | 'week' | 'hidden' | 'datetime-local';
  tone: 'casual' | 'professional';
  context?: string;
  placeholder?: string;
}

export interface AIQuestionResponse {
  question: string;
  success: boolean;
  error?: string;
}

export interface IAIRepository {
  generateQuestion(request: AIQuestionRequest): Promise<AIQuestionResponse>;
}