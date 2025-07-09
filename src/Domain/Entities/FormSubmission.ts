import { FormAnswerEntity } from './FormAnswer';

/** Represents a form submission entity.
 * Contains the answers provided by the user, the URL of the form, submission time, and an optional result.
 * Provides methods to create a submission, validate it, and convert answers to a summary format.
 */
export interface FormSubmissionResult {
  success: boolean;
  message?: string;
  url?: string;
  timestamp: Date;
}

export class FormSubmissionEntity {
  constructor(
    public readonly answers: FormAnswerEntity[],
    public readonly url: string,
    public readonly submissionTime: Date = new Date(),
    public readonly result?: FormSubmissionResult
  ) {}

  static create(answers: FormAnswerEntity[], url: string): FormSubmissionEntity {
    return new FormSubmissionEntity(answers, url);
  }

  withResult(result: FormSubmissionResult): FormSubmissionEntity {
    return new FormSubmissionEntity(
      this.answers,
      this.url,
      this.submissionTime,
      result
    );
  }

  getAnswersMap(): Map<string, string> {
    return new Map(this.answers.map(answer => [answer.selector, answer.value]));
  }

  isValid(): boolean {
    return !!(
      this.answers.length > 0 &&
      this.url &&
      this.answers.every(answer => answer.isValid())
    );
  }

  toSummary(): Record<string, string> {
    return Object.fromEntries(
      this.answers.map(answer => [answer.fieldLabel, answer.value])
    );
  }
}