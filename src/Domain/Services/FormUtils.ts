import { FormField } from '../../Domain/Entities/FormField';

/**
 * Pure utility functions for form processing
 */
export class FormUtils {
  
  /**
   * Sanitizes user input by trimming whitespace and normalizing line breaks
   */
  static sanitizeInput(input: string): string {
    return input
      .trim()
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, ''); 
  }

  /**
   * Generates a field name from a label string
   */
  static generateFieldNameFromLabel(label: string): string {
    return label
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, ''); 
  }

  /**
   * Generates a summary of form fields for analysis
   */
  static generateFieldSummary(fields: FormField[]): Record<string, any> {
    return {
      totalFields: fields.length,
      requiredFields: fields.filter((f) => f.required).length,
      optionalFields: fields.filter((f) => !f.required).length,
      fieldTypes: fields.reduce((acc, field) => {
        acc[field.type] = (acc[field.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      fieldsWithPlaceholders: fields.filter((f) => f.placeholder).length,
      complexity: FormUtils.calculateFormComplexity(fields)
    };
  }

  /**
   * Calculates form complexity score based on field types and requirements
   */
  static calculateFormComplexity(fields: FormField[]): 'simple' | 'moderate' | 'complex' {
    let complexityScore = 0;
    
    for (const field of fields) {
      complexityScore += 1;
      
      if (field.required) complexityScore += 1;
      
      switch (field.type) {
        case 'select':
          complexityScore += 2;
          break;
        case 'checkbox':
        case 'radio':
          complexityScore += 1;
          break;
        case 'email':
        case 'tel':
          complexityScore += 1;
          break;
      }
    }
    
    if (complexityScore <= 5) return 'simple';
    if (complexityScore <= 15) return 'moderate';
    return 'complex';
  }

  /**
   * Validates email format
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validates phone number format (basic international format)
   */
  static isValidPhone(phone: string): boolean {
    const cleanPhone = phone.replace(/\s|-|\(|\)/g, '');
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(cleanPhone);
  }

  /**
   * Normalizes boolean-like strings to actual boolean values
   */
  static normalizeBooleanInput(input: string): boolean {
    const truthyValues = ['true', 'yes', '1', 'on', 'checked', 'selected'];
    return truthyValues.includes(input.toLowerCase().trim());
  }

  /**
   * Extracts field name from various selector patterns
   */
  static extractFieldNameFromSelector(selector: string): string | null {
    const patterns = [
      /\[name="([^"]+)"\]/,
      /\[data-testid="([^"]+)"\]/,
      /\[data-test="([^"]+)"\]/,
      /\[id="([^"]+)"\]/,
      /#([^,\s\[.]+)/
    ];

    for (const pattern of patterns) {
      const match = selector.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Generates multiple selector variations for field finding
   */
  static generateSelectorVariations(fieldName: string): string[] {
    return [
      `[name="${fieldName}"]`,
      `#${fieldName}`,
      `[id="${fieldName}"]`,
      `[data-testid="${fieldName}"]`,
      `[data-test="${fieldName}"]`,
      `[data-field="${fieldName}"]`,
      `.${fieldName}`,
      `[for="${fieldName}"]`
    ];
  }

  /**
   * Checks if input represents a cancellation intent
   */
  static isCancellationInput(input: string): boolean {
    const cancelKeywords = ['quit', 'exit', 'cancel', 'abort', 'stop', 'back'];
    return cancelKeywords.includes(input.toLowerCase().trim());
  }

  /**
   * Formats field validation error messages
   */
  static formatValidationError(fieldLabel: string, errorType: string, customMessage?: string): string {
    const templates = {
      required: `"${fieldLabel}" is required and cannot be empty.`,
      email: `"${fieldLabel}" must be a valid email address.`,
      phone: `"${fieldLabel}" must be a valid phone number.`,
      number: `"${fieldLabel}" must be a valid number.`,
      minLength: `"${fieldLabel}" is too short.`,
      maxLength: `"${fieldLabel}" is too long.`,
      pattern: `"${fieldLabel}" format is invalid.`
    };

    return customMessage || templates[errorType as keyof typeof templates] || `"${fieldLabel}" has an error.`;
  }

  /**
   * Creates a delay promise for timing control
   */
  static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Safely parses JSON strings
   */
  static safeJsonParse<T>(jsonString: string, fallback: T): T {
    try {
      return JSON.parse(jsonString);
    } catch {
      return fallback;
    }
  }

  /**
   * Creates a unique identifier for form fields
   */
  static createFieldId(field: FormField): string {
    const extractedName = FormUtils.extractFieldNameFromSelector(field.selector);
    if (extractedName) {
      return extractedName;
    }
    
    const labelName = FormUtils.generateFieldNameFromLabel(field.label);
    const typePrefix = field.type.substring(0, 3);
    
    return `${typePrefix}_${labelName}`;
  }

  /**
   * Validates field constraints like minlength, maxlength, pattern
   */
  static validateFieldConstraints(
    value: string, 
    constraints: {
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      min?: number;
      max?: number;
    }
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (constraints.minLength && value.length < constraints.minLength) {
      errors.push(`Minimum length is ${constraints.minLength} characters`);
    }

    if (constraints.maxLength && value.length > constraints.maxLength) {
      errors.push(`Maximum length is ${constraints.maxLength} characters`);
    }

    if (constraints.pattern) {
      const regex = new RegExp(constraints.pattern);
      if (!regex.test(value)) {
        errors.push('Format does not match required pattern');
      }
    }

    if (constraints.min !== undefined) {
      const numValue = Number(value);
      if (!isNaN(numValue) && numValue < constraints.min) {
        errors.push(`Minimum value is ${constraints.min}`);
      }
    }

    if (constraints.max !== undefined) {
      const numValue = Number(value);
      if (!isNaN(numValue) && numValue > constraints.max) {
        errors.push(`Maximum value is ${constraints.max}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Converts common user inputs to standardized formats
   */
  static standardizeUserInput(input: string, fieldType: string): string {
    let standardized = FormUtils.sanitizeInput(input);

    switch (fieldType) {
      case 'email':
        standardized = standardized.toLowerCase();
        break;
      case 'tel':
        standardized = standardized.replace(/[\s\-\(\)\.]/g, '');
        break;
      case 'number':
        standardized = standardized.replace(/[^\d\.\-]/g, '');
        break;
      case 'checkbox':
      case 'radio':
        standardized = FormUtils.normalizeBooleanInput(standardized).toString();
        break;
    }

    return standardized;
  }

  /**
   * Generates helpful suggestions for common input errors
   */
  static generateInputSuggestions(value: string, fieldType: string): string[] {
    const suggestions: string[] = [];

    switch (fieldType) {
      case 'email':
        if (!value.includes('@')) {
          suggestions.push('Email addresses must contain an @ symbol');
        }
        if (!value.includes('.')) {
          suggestions.push('Email addresses usually contain a domain like .com, .org, etc.');
        }
        break;
      case 'tel':
        if (!/\d/.test(value)) {
          suggestions.push('Phone numbers should contain digits');
        }
        if (value.length < 7) {
          suggestions.push('Phone numbers are usually at least 7 digits long');
        }
        break;
      case 'number':
        if (!/^\d*\.?\d*$/.test(value)) {
          suggestions.push('Please enter only numbers (and optionally one decimal point)');
        }
        break;
    }

    return suggestions;
  }

  /**
   * Estimates the time needed to fill a form based on complexity
   */
  static estimateCompletionTime(fields: FormField[]): number {
    let estimatedSeconds = 0;

    for (const field of fields) {
      estimatedSeconds += 10;

      switch (field.type) {
        case 'select':
          estimatedSeconds += 5; 
          break;
        case 'textarea':
          estimatedSeconds += 20; 
          break;
        case 'email':
        case 'tel':
          estimatedSeconds += 5; 
          break;
      }

      if (field.required) {
        estimatedSeconds += 3;
      }
    }

    return Math.max(estimatedSeconds, 30); 
  }

  /**
   * Creates a progress indicator for form completion
   */
  static createProgressIndicator(completed: number, total: number): string {
    const percentage = Math.round((completed / total) * 100);
    const progressBar = '█'.repeat(Math.floor(percentage / 5)) + 
                       '░'.repeat(20 - Math.floor(percentage / 5));
    
    return `Progress: [${progressBar}] ${percentage}% (${completed}/${total} fields)`;
  }

  /**
   * Analyzes form accessibility features
   */
  static analyzeAccessibility(fields: FormField[]): {
    score: number;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    const fieldsWithoutLabels = fields.filter(f => !f.label || f.label.trim() === '');
    if (fieldsWithoutLabels.length > 0) {
      issues.push(`${fieldsWithoutLabels.length} fields missing labels`);
      score -= fieldsWithoutLabels.length * 10;
      recommendations.push('Add descriptive labels to all form fields');
    }

    const requiredFieldsWithoutIndicators = fields.filter(f => 
      f.required && !f.label.includes('*') && !f.label.toLowerCase().includes('required')
    );
    if (requiredFieldsWithoutIndicators.length > 0) {
      issues.push(`${requiredFieldsWithoutIndicators.length} required fields without clear indicators`);
      score -= requiredFieldsWithoutIndicators.length * 5;
      recommendations.push('Mark required fields clearly (e.g., with asterisks)');
    }

    const fieldsWithoutPlaceholders = fields.filter(f => 
      ['input', 'textarea'].includes(f.type) && !f.placeholder
    );
    if (fieldsWithoutPlaceholders.length > fields.length * 0.5) {
      issues.push('Many fields lack helpful placeholder text');
      score -= 10;
      recommendations.push('Add placeholder text to guide users');
    }

    return {
      score: Math.max(score, 0),
      issues,
      recommendations
    };
  }
}