import { IAIRepository, AIQuestionRequest } from '../../Domain/Repositories/IAIRepository';
import { FormFieldEntity } from '../../Domain/Entities/FormField';
import { QuestionGenerationService } from '../../Domain/Services/QuestionGenerationService';

/**
 * Use case for generating questions based on form fields.
 * It interacts with an AI repository to generate questions and formats them.
 */
export interface GenerateQuestionsRequest {
  fields: FormFieldEntity[];
  tone: 'casual' | 'professional';
}

export interface GeneratedQuestion {
  field: FormFieldEntity;
  question: string;
  isAIGenerated: boolean;
}

export interface GenerateQuestionsResponse {
  questions: GeneratedQuestion[];
  success: boolean;
  error?: string;
}

export class GenerateQuestionsUseCase {
  constructor(
    private readonly aiRepository: IAIRepository,
    private readonly questionService: QuestionGenerationService
  ) {}

  async execute(request: GenerateQuestionsRequest): Promise<GenerateQuestionsResponse> {
    try {
      const questions: GeneratedQuestion[] = [];
      
      for (const field of request.fields) {
        const aiRequest: AIQuestionRequest = {
          labelText: field.label,
          tone: request.tone,
          context: this.questionService.generateContextInfo(field),
          placeholder: field.placeholder
        };
        
        const aiResponse = await this.aiRepository.generateQuestion(aiRequest);
        
        let question: string;
        let isAIGenerated: boolean;
        
        if (aiResponse.success) {
          question = this.questionService.formatQuestion(aiResponse.question, field);
          isAIGenerated = true;
        } else {
          question = this.questionService.getFallbackQuestion(field.label);
          question = this.questionService.formatQuestion(question, field);
          isAIGenerated = false;
        }
        
        questions.push({
          field,
          question,
          isAIGenerated
        });
      }
      
      return {
        questions,
        success: true
      };
    } catch (error) {
      return {
        questions: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}