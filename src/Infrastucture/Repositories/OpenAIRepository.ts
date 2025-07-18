import { OpenAI } from 'openai';
import { IAIRepository, AIQuestionRequest, AIQuestionResponse } from '../../Domain/Repositories/IAIRepository';
import { IValidationError } from '../../Domain/Repositories/IValidationError';
import { Logger } from '../logging/Logger';

/**
 * Repository for interacting with OpenAI's API to generate questions based on form field labels.
 */
export class OpenAIRepository implements IAIRepository {
  private openai: OpenAI;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;

  constructor(apiKey: string, private readonly logger: Logger) {
    this.openai = new OpenAI({ 
      apiKey,
      timeout: 10000, 
    });
  }

  async generateQuestion(request: AIQuestionRequest): Promise<AIQuestionResponse> {
    const systemPrompt = `You are a helpful assistant that generates clear, concise questions for form fields. 
    Generate questions that are ${request.tone || 'friendly'} in tone, natural, conversational. Base it from the form field label and type.
    Keep it concise, friendly, and clear.

    Field Type: ${request.fieldType}
    Field Label: ${request.labelText}
  
    
    Generate just the question, no additional text.`;

    const userPrompt = `Create a ${request.tone || 'friendly'} question for the form field labeled "${request.labelText}".
    ${request.context ? `Additional context: ${request.context}` : ''}
    ${request.placeholder ? `Placeholder text: ${request.placeholder}` : ''}
    Keep the question under 100 characters and make it user-friendly, avoiding technical jargon.`;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4.1-nano',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 100,
          temperature: 0.7,
        });

        const question = response.choices[0]?.message?.content?.trim();
        if (question) {
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
      question: this.generateFallbackQuestion(request.labelText),
      success: false,
      error: lastError?.message || 'Unknown error'
    };
  }

  async generateCorrectionQuestion(validationError: IValidationError): Promise<AIQuestionResponse> {
    const systemPrompt = `You are a helpful assistant that generates friendly correction questions when form validation fails.
    
    The user previously entered a value that didn't pass validation. Generate a polite, helpful question that:
    1. Acknowledges the error
    2. Explains what went wrong (if the error message is clear)
    3. Asks for a corrected value
    4. Provides guidance if applicable
    
    Be conversational and supportive, not critical.
    
    Field Information:
    - Field Name: ${validationError.fieldName}
    - Field Label: ${validationError.fieldLabel}
    - Current Value: "${validationError.currentValue}"
    - Error Message: "${validationError.errorMessage}"
    

    
    Generate just the question, no additional text.`;

    const userPrompt = `Generate a correction question for this validation error.`;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4.1-nano',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 150,
          temperature: 0.7,
        });

        const question = response.choices[0]?.message?.content?.trim();
        if (question) {
          return {
            question,
            success: true
          };
        }
        
        throw new Error('No response content received from OpenAI');
      } catch (error) {
        if (error instanceof Error) {
          lastError = error;
          this.logger.error(`Attempt ${attempt} failed for correction question "${validationError.fieldLabel}": ${error.message}`);
        } else {
          lastError = new Error(String(error));
          this.logger.error(`Attempt ${attempt} failed for correction question "${validationError.fieldLabel}": ${String(error)}`);
        }

        if (attempt < this.maxRetries) {
          this.logger.info(`Retrying in ${this.retryDelay * attempt}ms...`);
          await this.delay(this.retryDelay * attempt); 
        }
      }
    }

    this.logger.error(`Failed to generate correction question after ${this.maxRetries} attempts: ${lastError?.message}`);
    return {
      question: this.generateFallbackCorrectionQuestion(validationError),
      success: false,
      error: lastError?.message || 'Unknown error'
    };
  }

  private generateFallbackQuestion(labelText: string): string {
    return `Please provide your ${labelText.toLowerCase()}:`;
  }

  private generateFallbackCorrectionQuestion(validationError: IValidationError): string {
    const fieldLabel = validationError.fieldLabel;
    const errorMessage = validationError.errorMessage;
    
    if (errorMessage.toLowerCase().includes('required')) {
      return `The ${fieldLabel} field is required. Could you please provide this information?`;
    } else if (errorMessage.toLowerCase().includes('email')) {
      return `There seems to be an issue with the email format. Could you please provide your email address again?`;
    } else if (errorMessage.toLowerCase().includes('format') || errorMessage.toLowerCase().includes('invalid')) {
      return `The ${fieldLabel} format doesn't seem quite right. Could you please try entering it again?`;
    } else {
      return `I noticed there might be an issue with "${fieldLabel}". Could you please provide this information again?`;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}