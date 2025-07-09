import { FormSubmissionEntity } from '../../Domain/Entities/FormSubmission';

/*
    * Represents the configuration for form automation.
    */

export interface FormAutomationConfig {
  url: string;
  tone: 'casual' | 'professional';
  timeout: number;
  headless: boolean;
}

export interface FormAutomationResult {
  submission: FormSubmissionEntity;
  success: boolean;
  error?: string;
}

export interface IFormAutomation {
  execute(config: FormAutomationConfig): Promise<FormAutomationResult>;
}