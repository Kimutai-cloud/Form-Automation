import { OpenAI } from 'openai';
import { IAIRepository, AIQuestionRequest, AIQuestionResponse } from '../../Domain/Repositories/IAIRepository';
import { Logger } from '../logging/Logger';

/**
 * Repository for interacting with OpenAI's API to generate questions based on form field labels.
 */
export class OpenAIRepository implements IAIRepository {
  private openai: OpenAI;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;

  constructor(apiKey: string, private readonly logger: Logger) {
    if (!apiKey || !apiKey.startsWith('sk-')) {
      throw new Error('Invalid OpenAI API key format');
    }
    
    this.openai = new OpenAI({ 
      apiKey,
      timeout: 10000, 
    });
  }

  async generateQuestion(request: AIQuestionRequest): Promise<AIQuestionResponse> {
    const systemPrompt = `You are a helpful assistant that generates clear, concise questions for form fields. 
    Generate questions that are ${request.tone} in tone and help users understand what information is needed.`;
    
    const userPrompt = `Create a ${request.tone} question for the form field labeled "${request.labelText}".
    ${request.context ? `Additional context: ${request.context}` : ''}
    ${request.placeholder ? `Placeholder text: ${request.placeholder}` : ''}
    Keep the question under 100 characters and make it user-friendly.`;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4.1-nano', 
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 50,
          temperature: 0.7,
        });

        const question = response.choices[0]?.message?.content?.trim();
        if (question) {
          this.logger.info(`Generated question for "${request.labelText}": ${question}`);
          return {
            question,
            success: true
          };
        }
        
        throw new Error('No response content received from OpenAI');
      } catch (error) {
        if (error instanceof Error) {
          lastError = error;
          this.logger.error(`Attempt ${attempt} failed for "${request.labelText}": ${error.message}`);
        } else {
          lastError = new Error(String(error));
          this.logger.error(`Attempt ${attempt} failed for "${request.labelText}": ${String(error)}`);
        }

        if (attempt < this.maxRetries) {
          this.logger.info(`Retrying in ${this.retryDelay * attempt}ms...`);
          await this.delay(this.retryDelay * attempt); 
        }
      }
    }

    this.logger.error(`Failed to generate prompt after ${this.maxRetries} attempts: ${lastError?.message}`);
    return {
      question: '',
      success: false,
      error: lastError?.message || 'Unknown error'
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}