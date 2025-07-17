import { Page } from 'puppeteer';
import { FormField, FormFieldEntity } from '../../Domain/Entities/FormField';
import { IValidationError } from '../../Domain/Repositories/IValidationError';
import { ValidationService } from './ValidationService';
import { OpenAIRepository } from '../../Infrastucture/Repositories/OpenAIRepository';
import { ConsoleUserInterface } from '../../Infrastucture/ui/ConsoleUserInterface';
import { AIQuestionRequest } from '../../Domain/Repositories/IAIRepository';
import { FormUtils } from '../Services/FormUtils'; 

export interface IValidationService {
  isFormSubmitted(): Promise<boolean>;
  detectValidationErrors(): Promise<IValidationError[]>;
}

export class FormProcessingService {
  private page: Page;
  private validationService: IValidationService;
  private questionService: OpenAIRepository;
  private consoleUI: ConsoleUserInterface;
  private maxRetries: number = 3;
  private readonly DEFAULT_TIMEOUT = 10000;
  private readonly SUBMIT_WAIT_TIMEOUT = 5000;
  private userResponseCache: Map<string, string> = new Map();

  constructor(
    page: Page,
    questionService: OpenAIRepository,
    consoleUI: ConsoleUserInterface,
    validationService?: IValidationService
  ) {
    this.page = page;
    this.validationService = validationService ?? new ValidationService(page);
    this.questionService = questionService;
    this.consoleUI = consoleUI;
  }

  async processFormWithValidation(formFields: FormField[]): Promise<boolean> {
    this.logStage("🎯 == Starting Form Processing ==");

    try {
      const userResponses = await this.collectInitialResponses(formFields);
      await this.fillFormFields(formFields, userResponses);
      return await this.submitWithValidationHandling();
    } catch (error) {
      this.logError("❌ Form processing failed:", error);
      return false;
    }
  }

  private async collectInitialResponses(
    formFields: FormField[]
  ): Promise<Map<string, string>> {
    const responses = new Map<string, string>();
    this.logStage("🎯 == Collecting User Responses ==");

    console.log("Let me ask you some questions to fill out this form:\n");

    for (const field of formFields) {
      try {
        const fieldName = this.getFieldName(field);

        if (this.userResponseCache.has(fieldName)) {
          const cachedValue = this.userResponseCache.get(fieldName)!;
          console.log(
            `🔄 Using cached value for "${field.label}": "${cachedValue}"`
          );
          responses.set(fieldName, cachedValue);
          continue;
        }

        const questionRequest: AIQuestionRequest = {
          labelText: field.label,
          fieldType: field.type,
          tone: "casual",
          context: this.buildFieldContext(field),
          placeholder: field.placeholder,
        };

        const aiResponse =
          await this.questionService.generateQuestion(questionRequest);
        const question = aiResponse.success
          ? aiResponse.question
          : `Please provide your ${field.label.toLowerCase()}:`;

        let answer: string;
        do {
          answer = await this.consoleUI.askQuestion(question);

          if (this.isUserCancellation(answer)) {
            console.warn(
              "❗️ User cancelled input. Aborting form processing..."
            );
            throw new Error("User cancelled");
          }

          answer = FormUtils.sanitizeInput(answer);

          const validation = this.validateFieldInput(field, answer);
          if (!validation.isValid) {
            this.logError(`❌ ${validation.message}`);
            continue;
          }

          break;
        } while (true);

        responses.set(fieldName, answer);
        this.userResponseCache.set(fieldName, answer); 
        this.logSuccess(`✓ Collected "${field.label}": "${answer}"`);
      } catch (error) {
        this.logError(
          `Error collecting response for field "${field.label}":`,
          error
        );
        throw error;
      }
    }

    return responses;
  }

  private buildFieldContext(field: FormField): string {
    const contexts = [];
    if (field.required) contexts.push("This field is required");
    if (field.placeholder) contexts.push(`Example: ${field.placeholder}`);

    if (field.type === "email")
      contexts.push("Please provide a valid email address");
    if (field.type === "tel")
      contexts.push("Please provide a valid phone number");

    return contexts.join(". ");
  }

  private validateFieldInput(
    field: FormField,
    input: string
  ): { isValid: boolean; message?: string } {
    if (field.required && !input.trim()) {
      return {
        isValid: false,
        message: "This field is required. Please provide a value.",
      };
    }

    switch (field.type) {
      case "email":
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (input && !emailRegex.test(input)) {
          return {
            isValid: false,
            message: "Please provide a valid email address.",
          };
        }
        break;
      case "tel":
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        if (input && !phoneRegex.test(input.replace(/\s|-|\(|\)/g, ""))) {
          return {
            isValid: false,
            message: "Please provide a valid phone number.",
          };
        }
        break;
      case "number":
        if (input && isNaN(Number(input))) {
          return { isValid: false, message: "Please provide a valid number." };
        }
        break;
    }

    return { isValid: true };
  }

  private isUserCancellation(input: string): boolean {
    const cancelKeywords = ["quit", "exit", "cancel", "abort", "stop"];
    return cancelKeywords.includes(input.toLowerCase().trim());
  }

  private async fillFormFields(
    formFields: FormField[],
    responses: Map<string, string>
  ): Promise<void> {
    this.logStage("🎯 == Filling Form Fields ==");

    for (const field of formFields) {
      const fieldName = this.getFieldName(field);
      const value = responses.get(fieldName);
      if (value) {
        await this.fillField(field, value);
      }
    }
  }

  private async fillField(field: FormField, value: string): Promise<void> {
    try {
      const selector = field.selector;

      await this.page.waitForSelector(selector, {
        timeout: this.DEFAULT_TIMEOUT,
        visible: true,
      });

      const element = await this.page.$(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      const elementState = await element.evaluate((el) => ({
        disabled:
          (el as HTMLInputElement).disabled || el.hasAttribute("disabled"),
        readonly:
          (el as HTMLInputElement).readOnly || el.hasAttribute("readonly"),
        visible: window.getComputedStyle(el).display !== "none",
      }));

      if (elementState.disabled) {
        console.warn(`⚠️  Field "${field.label}" is disabled, skipping...`);
        return;
      }

      if (elementState.readonly) {
        console.warn(`⚠️  Field "${field.label}" is readonly, skipping...`);
        return;
      }

      await this.fillFieldByType(element, field, value);
      this.logSuccess(`✓ Filled "${field.label}" with: "${value}"`);
    } catch (error) {
      this.logError(`✗ Error filling field "${field.label}":`, error);
      throw error;
    }
  }

  private async fillFieldByType(
    element: any,
    field: FormField,
    value: string
  ): Promise<void> {
    switch (field.type) {
      case "select":
        await this.fillSelectField(element, value);
        break;
      case "checkbox":
      case "radio":
        await this.fillCheckboxRadioField(element, value);
        break;
      case "textarea":
        await this.fillTextAreaField(element, value);
        break;
      case "input":
      default:
        await this.fillInputField(element, value);
        break;
    }
  }

  private async fillSelectField(element: any, value: string): Promise<void> {
    try {
      await element.select(value);
    } catch (error) {
      const options = await element.$$eval(
        "option",
        (opts: HTMLOptionElement[]) =>
          opts.map((opt) => ({
            value: opt.value,
            text: opt.textContent?.trim() || "",
          }))
      );

      const matchingOption = options.find(
        (opt: HTMLOptionElement) =>
          opt.text.toLowerCase().includes(value.toLowerCase()) ||
          opt.value.toLowerCase().includes(value.toLowerCase())
      );

      if (matchingOption) {
        await element.select(matchingOption.value);
      } else {
        throw new Error(`No matching option found for value: ${value}`);
      }
    }
  }

  private async fillCheckboxRadioField(
    element: any,
    value: string
  ): Promise<void> {
    const shouldCheck = ["true", "yes", "1", "on", "checked"].includes(
      value.toLowerCase()
    );
    const isChecked = await element.evaluate(
      (el: HTMLInputElement) => el.checked
    );

    if (shouldCheck !== isChecked) {
      await element.click();
    }
  }

  private async fillTextAreaField(element: any, value: string): Promise<void> {
    await element.focus();
    await element.evaluate((el: HTMLTextAreaElement) => {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await element.type(value, { delay: 30 });
    await element.evaluate((el: HTMLTextAreaElement) => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  private async fillInputField(element: any, value: string): Promise<void> {
    await element.focus();
    await this.page.keyboard.down("Control");
    await this.page.keyboard.press("KeyA");
    await this.page.keyboard.up("Control");
    await element.type(value, { delay: 50 });

    await element.evaluate((el: HTMLInputElement) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  private async submitWithValidationHandling(): Promise<boolean> {
    let attempt = 0;
    this.logStage("🎯 == Submitting Form ==");

    while (attempt < this.maxRetries) {
      attempt++;
      this.logInfo(
        `⏳ Attempting to submit form (attempt ${attempt}/${this.maxRetries})...`
      );

      try {
        await this.submitForm();
        const isSubmitted = await this.waitForSubmissionResult();

        if (isSubmitted) {
          this.logSuccess("✅ Form submitted successfully!");
          return true;
        }

        const validationErrors =
          await this.validationService.detectValidationErrors();

        if (validationErrors.length === 0) {
          this.logWarning(
            "⚠️  No validation errors detected, but form submission status is unclear."
          );
          return false;
        }

        this.logValidationErrors(validationErrors);

        if (attempt < this.maxRetries) {
          this.logInfo("🔄 Let me help you correct these issues...\n");
          const shouldContinue =
            await this.handleValidationErrors(validationErrors);
          if (!shouldContinue) {
            this.logWarning("❗️ User chose to abort retry process.");
            return false;
          }
        } else {
          this.logError(
            "❌ Maximum retry attempts reached. Form submission failed."
          );
          return false;
        }
      } catch (error) {
        this.logError(`Error during submission attempt ${attempt}:`, error);
        if (attempt >= this.maxRetries) {
          return false;
        }
      }
    }

    return false;
  }

  private logValidationErrors(validationErrors: IValidationError[]): void {
    this.logError(`❌ Found ${validationErrors.length} validation error(s):`);
    for (const err of validationErrors) {
      console.log(
        `  - Field "${err.fieldLabel || err.fieldName}": ${err || "Unknown error"}`
      );
    }
  }

  private async waitForSubmissionResult(): Promise<boolean> {
    try {
      await Promise.race([
        this.page.waitForNavigation({ timeout: this.SUBMIT_WAIT_TIMEOUT }),
        this.page.waitForSelector(
          ".success, .thank-you, .submitted, .confirmation",
          { timeout: this.SUBMIT_WAIT_TIMEOUT }
        ),
        this.page.waitForSelector(
          ".error, .validation-error, .field-error, .alert-danger",
          { timeout: this.SUBMIT_WAIT_TIMEOUT }
        ),
      ]);

      return await this.validationService.isFormSubmitted();
    } catch (error) {
      return await this.validationService.isFormSubmitted();
    }
  }

  private async submitForm(): Promise<void> {
    this.logInfo("🔄 Searching for submit button...");

    const submitSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[value*="submit" i]',
      'input[value*="send" i]',
      ".submit-btn",
      "#submit",
      '[data-testid="submit"]',
      '[data-test="submit"]',
    ];

    for (const selector of submitSelectors) {
      const btn = await this.page.$(selector);
      if (btn && (await this.isElementVisible(btn))) {
        await btn.click();
        this.logSuccess(`🔄 Clicked submit button: ${selector}`);
        return;
      }
    }

    const buttons = await this.page.$$("button");
    for (const button of buttons) {
      const text = await button.evaluate(
        (el) => el.textContent?.toLowerCase() || ""
      );
      if (
        ["submit", "send", "continue", "save", "next"].some((keyword) =>
          text.includes(keyword)
        )
      ) {
        if (await this.isElementVisible(button)) {
          await button.click();
          this.logSuccess(`🔄 Clicked semantic button: "${text}"`);
          return;
        }
      }
    }

    await this.page.evaluate(() => {
      const form = document.querySelector("form");
      if (form) {
        form.submit();
      } else {
        throw new Error("No form found to submit");
      }
    });
    this.logSuccess("🔄 Submitted form using direct DOM method");
  }

  private async isElementVisible(element: any): Promise<boolean> {
    return await element.evaluate((el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    });
  }

  private async handleValidationErrors(
    validationErrors: IValidationError[]
  ): Promise<boolean> {
    for (const error of validationErrors) {
      try {
        const correctionResponse =
          await this.questionService.generateCorrectionQuestion(error);
        const correctionQuestion = correctionResponse.success
          ? correctionResponse.question
          : `Please provide a corrected value for "${error.fieldLabel || error.fieldName}" (Error: ${error}):`;

        const correctedValue =
          await this.consoleUI.askQuestion(correctionQuestion);

        if (this.isUserCancellation(correctedValue)) {
          return false;
        }

        if (!correctedValue.trim()) {
          this.logWarning("⚠️  Empty value provided, skipping this field.");
          continue;
        }

        const sanitizedValue = FormUtils.sanitizeInput(correctedValue);
        const field = await this.findFieldByNameOrLabel(
          error.fieldName,
          error.fieldLabel
        );

        if (field) {
          await this.fillField(field, sanitizedValue);
          this.logSuccess(
            `✓ Updated "${error.fieldLabel || error.fieldName}" with corrected value`
          );
          this.userResponseCache.set(this.getFieldName(field), sanitizedValue);
        } else {
          this.logWarning(
            `⚠️  Could not find field to update: ${error.fieldLabel || error.fieldName}`
          );
        }
      } catch (error) {
        this.logError(`Error handling validation error:`, error);
      }
    }
    return true;
  }

  public sanitizeInput(input: string): string {
    return input
      .trim()
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, ''); 
  }

  private getFieldName(field: FormField): string {
    const patterns = [
      /\[name="([^"]+)"\]/,
      /\[data-testid="([^"]+)"\]/,
      /\[data-test="([^"]+)"\]/,
      /\[id="([^"]+)"\]/,
      /#([^,\s\[.]+)/,
    ];

    for (const pattern of patterns) {
      const match = field.selector.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    if ((field as any).name) {
      return (field as any).name;
    }

    return FormUtils.generateFieldNameFromLabel(field.label);
  }

  private async findFieldByNameOrLabel(
    fieldName: string,
    fieldLabel: string
  ): Promise<FormField | null> {
    try {
      const selectors = [
        `[name="${fieldName}"]`,
        `#${fieldName}`,
        `[id="${fieldName}"]`,
        `[data-testid="${fieldName}"]`,
        `[data-test="${fieldName}"]`,
        `[data-field="${fieldName}"]`,
        `[aria-label="${fieldLabel}"]`,
      ];

      let element = null;
      let usedSelector = "";

      for (const selector of selectors) {
        try {
          element = await this.page.$(selector);
          if (element) {
            usedSelector = selector;
            break;
          }
        } catch (error) {
        }
      }

      if (!element) {
        const result = await this.findElementByLabel(fieldLabel);
        if (result) {
          element = result.element;
          usedSelector = result.selector;
        }
      }

      if (!element) {
        return null;
      }

      const elementInfo = await this.getElementInfo(element);

      return {
        label: fieldLabel,
        selector: usedSelector,
        type: elementInfo.type as FormField["type"],
        required: elementInfo.required,
        placeholder: elementInfo.placeholder,
      };
    } catch (error) {
      this.logError("Error finding field:", error);
      return null;
    }
  }

  private async findElementByLabel(
    labelText: string
  ): Promise<{ element: any; selector: string } | null> {
    const labelElements = await this.page.$$("label");

    for (const label of labelElements) {
      const currentLabelText = await label.evaluate(
        (el) => el.textContent?.trim() || ""
      );
      if (
        currentLabelText === labelText ||
        currentLabelText.includes(labelText)
      ) {
        const forAttr = await label.evaluate((el) => el.getAttribute("for"));
        if (forAttr) {
          const selector = `#${forAttr}`;
          const element = await this.page.$(selector);
          if (element) {
            return { element, selector };
          }
        }
      }
    }
    return null;
  }

  private async getElementInfo(element: any) {
    return await element.evaluate((el: HTMLElement) => {
      const tagName = el.tagName.toLowerCase();
      let type = "input";

      if (tagName === "input") {
        const inputType = (el as HTMLInputElement).type;
        switch (inputType) {
          case "text":
          case "email":
          case "password":
          case "number":
          case "tel":
          case "url":
            type = "input";
            break;
          case "checkbox":
            type = "checkbox";
            break;
          case "radio":
            type = "radio";
            break;
          default:
            type = "input";
        }
      } else if (tagName === "textarea") {
        type = "textarea";
      } else if (tagName === "select") {
        type = "select";
      }

      return {
        type,
        required:
          (el as HTMLInputElement).required ||
          el.hasAttribute("required") ||
          el.getAttribute("aria-required") === "true",
        placeholder: (el as HTMLInputElement).placeholder || undefined,
      };
    });
  }

  private logStage(message: string): void {
    console.log(`\n${message}\n`);
  }

  private logSuccess(message: string): void {
    console.log(`✅ ${message}`);
  }

  private logError(message: string, error?: any): void {
    console.error(`❌ ${message}`, error || "");
  }

  private logWarning(message: string): void {
    console.warn(`⚠️  ${message}`);
  }

  private logInfo(message: string): void {
    console.log(`ℹ️  ${message}`);
  }

  validateFormFields(fields: FormFieldEntity[]): FormFieldEntity[] {
    return fields.filter((field) => field.isValid());
  }

  validateAnswer(
    field: FormFieldEntity,
    input: string
  ): { isValid: boolean; message?: string } {
    const validator = field.getFieldValidator();
    return validator(input);
  }

  public generateFieldSummary(fields: FormField[]): Record<string, any> {
    return FormUtils.generateFieldSummary(fields);
  }

  public clearResponseCache(): void {
    this.userResponseCache.clear();
  }

  public getCachedResponses(): Map<string, string> {
    return new Map(this.userResponseCache);
  }
}