import { FormFieldEntity } from '../Entities/FormField';
import { FormSubmissionEntity, FormSubmissionResult } from '../Entities/FormSubmission';
import { Page } from 'puppeteer';

/**
 * Interface for form repository operations.
 * Provides methods to initialize, navigate, extract fields, fill fields, submit forms, and close the repository.
 */
export interface IFormRepository {
  initialize(headless: boolean): Promise<void>;
  navigateToPage(url: string, timeout?: number): Promise<void>;
  extractFormFields(): Promise<FormFieldEntity[]>;
  fillField(selector: string, value: string): Promise<void>;
  submitForm(): Promise<FormSubmissionResult>;
  close(): Promise<void>;
  setPage(page: Page): void;
  getPage(): Page | undefined;
}