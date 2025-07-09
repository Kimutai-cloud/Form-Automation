import { IUserInterface } from '../Interfaces/IUserInterface';
//import { FormFieldEntity } from '../../Domain/Entities/FormField';
import { FormAnswerEntity } from '../../Domain/Entities/FormAnswer';
import { FormProcessingService } from '../../Domain/Services/FromProcessingService';
import { GeneratedQuestion } from './GenerateQuestions';

/**
 * Use case for collecting user input based on generated questions.
 * It interacts with the user interface to ask questions and validate answers.
 */

export interface CollectUserInputRequest {
  questions: GeneratedQuestion[];
}

export interface CollectUserInputResponse {
  answers: FormAnswerEntity[];
  success: boolean;
  error?: string;
}

export class CollectUserInputUseCase {
  constructor(
    private readonly userInterface: IUserInterface,
    private readonly formProcessingService: FormProcessingService
  ) {}

  async execute(request: CollectUserInputRequest): Promise<CollectUserInputResponse> {
    try {
      const answers: FormAnswerEntity[] = [];
      
      for (const questionData of request.questions) {
        const { field, question } = questionData;
        
        let userInput: string;
        let isValid = false;
        
        // Keep asking until valid input is received
        while (!isValid) {
          userInput = await this.userInterface.askQuestion(question);
          const sanitizedInput = this.formProcessingService.sanitizeInput(userInput);
          
          const validation = this.formProcessingService.validateAnswer(field, sanitizedInput);
          
          if (validation.isValid) {
            const answer = FormAnswerEntity.create(
              field.selector,
              sanitizedInput,
              field.label
            );
            answers.push(answer);
            isValid = true;
          } else {
            await this.userInterface.showMessage(validation.message || 'Invalid input. Please try again.');
          }
        }
      }
      
      return {
        answers,
        success: true
      };
    } catch (error) {
      return {
        answers: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}