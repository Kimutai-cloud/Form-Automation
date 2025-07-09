import { FormFieldEntity } from '../Entities/FormField';
/**
 * Service for generating questions based on form field labels.
 * Provides fallback questions and formats questions with additional context.
 */
export class QuestionGenerationService {
  getFallbackQuestion(labelText: string): string {
    // This is just as an out of box thought
    const lowercaseLabel = labelText.toLowerCase();
    
    if (lowercaseLabel.includes('email')) return 'What is your email address?';
    if (lowercaseLabel.includes('name')) return 'What is your name?';
    if (lowercaseLabel.includes('phone')) return 'What is your phone number?';
    if (lowercaseLabel.includes('password')) return 'Please enter your password:';
    if (lowercaseLabel.includes('date')) return 'Please enter the date:';
    if (lowercaseLabel.includes('address')) return 'What is your address?';
    if (lowercaseLabel.includes('city')) return 'What city are you in?';
    if (lowercaseLabel.includes('zip') || lowercaseLabel.includes('postal')) return 'What is your zip/postal code?';
    if (lowercaseLabel.includes('country')) return 'What country are you in?';
    if (lowercaseLabel.includes('age')) return 'What is your age?';
    
    return `Please provide a value for ${labelText}:`;
  }

  formatQuestion(question: string, field: FormFieldEntity): string {
    let formattedQuestion = question;
    
    if (field.required) {
      formattedQuestion += ' (required)';
    }
    
    if (field.placeholder) {
      formattedQuestion += ` [${field.placeholder}]`;
    }
    
    return formattedQuestion;
  }

  generateContextInfo(field: FormFieldEntity): string {
    const context = [];
    
    if (field.type === 'select') {
      context.push('This is a dropdown selection');
    }
    
    if (field.required) {
      context.push('This field is required');
    }
    
    if (field.placeholder) {
      context.push(`Placeholder: ${field.placeholder}`);
    }
    
    return context.join('. ');
  }
}