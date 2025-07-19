import { Page } from "puppeteer";
import { FormField, FormFieldEntity } from "../../Domain/Entities/FormField";
import { IValidationError } from "../../Domain/Repositories/IValidationError";
import { ValidationService } from "./ValidationService";
import { OpenAIRepository } from "../../Infrastucture/Repositories/OpenAIRepository";
import { ConsoleUserInterface } from "../../Infrastucture/ui/ConsoleUserInterface";
import { AIQuestionRequest } from "../../Domain/Repositories/IAIRepository";
import { FormUtils } from "../Services/FormUtils";

/**
 * Service for processing forms with validation handling.
 */

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
  private displayResponseCache: Map<string, string> = new Map();

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

  async processFormWithValidationEnhanced(
    formFields: FormField[]
  ): Promise<boolean> {
    try {
      console.log("\n🎯 Starting Form Filling Process\n");

      (this.consoleUI as any).setTotalQuestions?.(formFields.length);

      const verifiedFields = await this.verifyAndUpdateSelectors(formFields);
      const allFields = await this.detectAllFormFields(verifiedFields);
      const userResponses = await this.collectInitialResponses(allFields);
      await this.fillFormFieldsEnhanced(allFields, userResponses);

      return await this.submitWithEnhancedValidationHandling(userResponses);
    } catch (error) {
      if (error instanceof Error && error.message === "User cancelled") {
        console.log("\n👋 Form filling cancelled by user.");
        return false;
      }
      console.error("\n❌ Form processing failed:", error);
      return false;
    }
  }

  private async detectAllFormFields(
    initialFields: FormField[]
  ): Promise<FormField[]> {
    const allFields = [...initialFields];

    try {
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        const forms = document.querySelectorAll("form");
        forms.forEach((form) => {
          const event = new Event("focus", { bubbles: true });
          form.dispatchEvent(event);
        });
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      const hiddenFields = await this.detectHiddenFields();

      for (const hiddenField of hiddenFields) {
        const exists = allFields.some(
          (existing) =>
            existing.selector === hiddenField.selector ||
            existing.label === hiddenField.label
        );

        if (!exists) {
          allFields.push(hiddenField);
        }
      }
    } catch (error) {}

    return allFields;
  }

  private async collectInitialResponses(
    formFields: FormField[]
  ): Promise<Map<string, string>> {
    const responses = new Map<string, string>();

    console.log("📝 Please answer the following questions:\n");

    for (const field of formFields) {
      try {
        const fieldName = this.getFieldName(field);

        if (this.userResponseCache.has(fieldName)) {
          const cachedValue = this.userResponseCache.get(fieldName)!;
          responses.set(fieldName, cachedValue);
          continue;
        }

        let question: string;
        let options: string[] = [];
        if (field.type === "select" || this.isDropdownField(field)) {
          options = await this.getDropdownOptions(field);
          if (options.length > 0) {
            question = await this.generateDropdownQuestion(field, options);
          } else {
            question = await this.generateRegularQuestion(field);
          }
        } else {
          question = await this.generateRegularQuestion(field);
        }

        let answer: string;
        let isValid = false;

        do {
          answer = await this.consoleUI.askQuestion(question);

          if (this.isUserCancellation(answer)) {
            throw new Error("User cancelled");
          }

          answer = FormUtils.sanitizeInput(answer);

          const validation =
            options.length > 0
              ? this.validateDropdownAnswer(answer, options, field)
              : this.validateFieldInput(field, answer);

          if (!validation.isValid) {
            console.log(`⚠️  ${validation.message}`);
            continue;
          }

          if (options.length > 0) {
            const numAnswer = parseInt(answer);
            if (
              !isNaN(numAnswer) &&
              numAnswer >= 1 &&
              numAnswer <= options.length
            ) {
              answer = options[numAnswer - 1];
            } else {
              const matchingOption = options.find(
                (option) =>
                  option.toLowerCase().includes(answer.toLowerCase()) ||
                  answer.toLowerCase().includes(option.toLowerCase())
              );
              if (matchingOption) {
                answer = matchingOption;
              }
            }
          }

          isValid = true;
        } while (!isValid);

        responses.set(fieldName, answer);
        this.userResponseCache.set(fieldName, answer);

        const displayName = this.getDisplayName(field);
        this.displayResponseCache.set(displayName, answer);
      } catch (error) {
        if (error instanceof Error && error.message === "User cancelled") {
          throw error;
        }
        console.error(
          `Error collecting response for field "${field.label}":`,
          error
        );
        throw error;
      }
    }

    return responses;
  }

  private async generateDropdownQuestion(
    field: FormField,
    options: string[]
  ): Promise<string> {
    const baseQuestion = await this.generateRegularQuestion(field);

    const displayOptions = options.slice(0, 10);
    const optionsText = displayOptions
      .map((option, index) => `  ${index + 1}. ${option}`)
      .join("\n");

    const moreOptionsText =
      options.length > 10
        ? `\n  ... and ${options.length - 10} more options`
        : "";

    return `${baseQuestion}\n${optionsText}${moreOptionsText}\n\n(Enter number or type option name)`;
  }

  private async generateRegularQuestion(field: FormField): Promise<string> {
    const questionRequest: AIQuestionRequest = {
      labelText: field.label,
      fieldType: field.type,
      tone: "casual",
      context: this.buildFieldContext(field),
      placeholder: field.placeholder,
    };

    const aiResponse =
      await this.questionService.generateQuestion(questionRequest);
    return aiResponse.success
      ? aiResponse.question
      : `Please provide your ${field.label.toLowerCase().replace("*", "").trim()}`;
  }

  private async verifyAndUpdateSelectors(
    formFields: FormField[]
  ): Promise<FormField[]> {
    const updatedFields: FormField[] = [];

    for (const field of formFields) {
      try {
        const element = await this.page.$(field.selector);
        if (element) {
          updatedFields.push(field);
        } else {
          const newSelector = await this.findWorkingSelector(field);
          if (newSelector) {
            updatedFields.push({ ...field, selector: newSelector });
          } else {
            updatedFields.push(field);
          }
        }
      } catch (error) {
        updatedFields.push(field);
      }
    }

    return updatedFields;
  }

  private async fillFormFieldsEnhanced(
    formFields: FormField[],
    responses: Map<string, string>
  ): Promise<void> {
    console.log("\n🔄 Filling out the form...");

    for (const field of formFields) {
      const fieldName = this.getFieldName(field);
      const value = responses.get(fieldName);
      if (value) {
        await this.fillFieldEnhanced(field, value);
      }
    }

    console.log("✅ Form filled successfully!");
  }

  private async submitWithEnhancedValidationHandling(
    existingResponses: Map<string, string>
  ): Promise<boolean> {
    let attempt = 0;

    console.log("\n🚀 Submitting the form...");

    while (attempt < this.maxRetries) {
      attempt++;

      try {
        await this.submitForm();
        const isSubmitted = await this.waitForSubmissionResult();

        if (isSubmitted) {
          console.log("\n🎉 Form submitted successfully!");
          return true;
        }

        const validationErrors =
          await this.validationService.detectValidationErrors();

        if (validationErrors.length === 0) {
          console.log("\n✅ Form appears to have been submitted.");
          return true;
        }

        console.log(
          `\n⚠️  Found ${validationErrors.length} validation error(s):`
        );
        for (const err of validationErrors) {
          console.log(
            `   • ${err.fieldLabel || err.fieldName}: ${err.errorMessage}`
          );
        }

        if (attempt < this.maxRetries) {
          console.log("\n🔄 Let's fix these issues:\n");
          const shouldContinue = await this.handleValidationErrorsEnhanced(
            validationErrors,
            existingResponses
          );
          if (!shouldContinue) {
            return false;
          }
        } else {
          console.log("\n❌ Maximum retry attempts reached.");
          return false;
        }
      } catch (error) {
        console.error(`Error during submission attempt ${attempt}:`, error);
        if (attempt >= this.maxRetries) {
          return false;
        }
      }
    }

    return false;
  }

  private async handleValidationErrorsEnhanced(
    validationErrors: IValidationError[],
    existingResponses: Map<string, string>
  ): Promise<boolean> {
    const hiddenFields = await this.detectHiddenFields();

    for (const error of validationErrors) {
      try {
        const correctionResponse =
          await this.questionService.generateCorrectionQuestion(error);
        const correctionQuestion = correctionResponse.success
          ? correctionResponse.question
          : `Please provide a value for "${error.fieldLabel || error.fieldName}"`;

        const correctedValue =
          await this.consoleUI.askQuestion(correctionQuestion);

        if (this.isUserCancellation(correctedValue)) {
          return false;
        }

        if (!correctedValue.trim()) {
          console.log("⚠️  Empty value provided, skipping this field.");
          continue;
        }

        const sanitizedValue = FormUtils.sanitizeInput(correctedValue);

        let field = await this.findFieldByNameOrLabel(
          error.fieldName,
          error.fieldLabel
        );

        if (!field) {
          const hiddenField = hiddenFields.find(
            (f) =>
              f.label.includes(error.fieldLabel || error.fieldName) ||
              (error.fieldLabel || error.fieldName).includes(f.label)
          );
          if (hiddenField) {
            field = hiddenField;
          }
        }

        if (field) {
          await this.fillFieldEnhanced(field, sanitizedValue);
          this.userResponseCache.set(this.getFieldName(field), sanitizedValue);
          existingResponses.set(this.getFieldName(field), sanitizedValue);
        }
      } catch (error) {
        console.error(`Error handling validation:`, error);
      }
    }
    return true;
  }

  private isDropdownField(field: FormField): boolean {
    return (
      field.selector.includes("select") ||
      field.selector.includes("dropdown") ||
      field.selector.includes("mantine-") ||
      field.type === "select"
    );
  }

  private async getDropdownOptions(field: FormField): Promise<string[]> {
    try {
      const element = await this.page.$(field.selector);
      if (!element) return [];

      if (field.type === "select") {
        const options = await this.page.$$eval(
          `${field.selector} option`,
          (opts) =>
            opts
              .map((opt) => opt.textContent?.trim() || "")
              .filter((text) => text)
        );
        if (options.length > 0) return options;
      }

      await element.click();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const optionSelectors = [
        '[role="option"]',
        "[data-value]",
        ".mantine-Select-item",
        ".dropdown-item",
        ".select-option",
      ];

      for (const selector of optionSelectors) {
        try {
          const options = await this.page.$$(selector);
          if (options && options.length > 0) {
            const optionTexts: string[] = [];

            for (const option of options) {
              const text = await option.evaluate(
                (el) => el.textContent?.trim() || el.getAttribute("value") || ""
              );
              if (text && !optionTexts.includes(text)) {
                optionTexts.push(text);
              }
            }

            await this.page.click("body");
            return optionTexts;
          }
        } catch (error) {
          continue;
        }
      }

      await this.page.click("body");
      return [];
    } catch (error) {
      return [];
    }
  }

  private validateDropdownAnswer(
    answer: string,
    options: string[],
    field: FormField
  ): { isValid: boolean; message?: string } {
    if (field.required && !answer.trim()) {
      return {
        isValid: false,
        message: "This field is required. Please select an option.",
      };
    }

    if (!answer.trim()) return { isValid: true };

    const numAnswer = parseInt(answer.trim());
    if (!isNaN(numAnswer) && numAnswer >= 1 && numAnswer <= options.length) {
      return { isValid: true };
    }

    const matchingOption = options.find(
      (option) =>
        option.toLowerCase().includes(answer.toLowerCase()) ||
        answer.toLowerCase().includes(option.toLowerCase())
    );

    if (matchingOption) {
      return { isValid: true };
    }

    return {
      isValid: false,
      message: `Please select from the available options or enter a number 1-${options.length}.`,
    };
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

    if (!input.trim() && !field.required) {
      return { isValid: true };
    }

    switch (field.type) {
      case "email":
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) {
          return {
            isValid: false,
            message:
              "Please provide a valid email address (e.g., name@example.com).",
          };
        }
        break;

      case "tel":
        const cleanPhone = input.replace(/[\s\-\(\)\.]/g, "");

        const phonePatterns = [
          /^[\+]?[1-9]\d{1,14}$/,
          /^0[1-9]\d{8,9}$/,
          /^\d{10,11}$/,
          /^(\+\d{1,3}[- ]?)?\d{10}$/,
        ];

        const isValidPhone = phonePatterns.some((pattern) =>
          pattern.test(cleanPhone)
        );

        if (!isValidPhone) {
          return {
            isValid: false,
            message:
              "Please provide a valid phone number (e.g., +254701452662, 0701452662, or 701452662).",
          };
        }
        break;

      case "number":
        if (isNaN(Number(input))) {
          return {
            isValid: false,
            message: "Please provide a valid number.",
          };
        }

        const numValue = Number(input);
        if (field.min !== undefined && numValue < field.min) {
          return {
            isValid: false,
            message: `Number must be at least ${field.min}.`,
          };
        }
        if (field.max !== undefined && numValue > field.max) {
          return {
            isValid: false,
            message: `Number must be at most ${field.max}.`,
          };
        }
        break;

      case "date":
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(input)) {
          return {
            isValid: false,
            message: "Please use format: YYYY-MM-DD (e.g., 2024-03-15)",
          };
        }

        const date = new Date(input);
        if (isNaN(date.getTime())) {
          return {
            isValid: false,
            message: "Please provide a valid date.",
          };
        }

        if (field.min) {
          const minDate = new Date(field.min);
          if (date < minDate) {
            return {
              isValid: false,
              message: `Date must be on or after ${field.min}.`,
            };
          }
        }
        if (field.max) {
          const maxDate = new Date(field.max);
          if (date > maxDate) {
            return {
              isValid: false,
              message: `Date must be on or before ${field.max}.`,
            };
          }
        }
        break;

      case "datetime-local":
        const datetimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
        if (!datetimeRegex.test(input)) {
          return {
            isValid: false,
            message:
              "Please use format: YYYY-MM-DDTHH:mm (e.g., 2024-03-15T14:30)",
          };
        }

        const datetime = new Date(input);
        if (isNaN(datetime.getTime())) {
          return {
            isValid: false,
            message: "Please provide a valid date and time.",
          };
        }
        break;

      case "time":
        const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d$/;
        if (!timeRegex.test(input)) {
          return {
            isValid: false,
            message: "Please use 24-hour format: HH:mm (e.g., 14:30)",
          };
        }
        break;

      case "month":
        const monthRegex = /^\d{4}-\d{2}$/;
        if (!monthRegex.test(input)) {
          return {
            isValid: false,
            message: "Please use format: YYYY-MM (e.g., 2024-03)",
          };
        }

        const [year, month] = input.split("-").map(Number);
        if (month < 1 || month > 12) {
          return {
            isValid: false,
            message: "Month must be between 01 and 12.",
          };
        }
        break;

      case "week":
        const weekRegex = /^\d{4}-W\d{2}$/;
        if (!weekRegex.test(input)) {
          return {
            isValid: false,
            message: "Please use format: YYYY-W## (e.g., 2024-W12)",
          };
        }

        const weekNum = parseInt(input.split("-W")[1]);
        if (weekNum < 1 || weekNum > 53) {
          return {
            isValid: false,
            message: "Week number must be between 01 and 53.",
          };
        }
        break;

      case "color":
        const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;
        const colorNames = [
          "red",
          "green",
          "blue",
          "yellow",
          "black",
          "white",
          "purple",
          "orange",
          "pink",
          "gray",
          "grey",
          "brown",
          "cyan",
          "magenta",
          "lime",
          "navy",
          "olive",
          "teal",
        ];

        if (
          !hexColorRegex.test(input) &&
          !colorNames.includes(input.toLowerCase())
        ) {
          return {
            isValid: false,
            message:
              "Please use a color name (e.g., 'red') or hex format (e.g., '#FF0000')",
          };
        }
        break;

      case "url":
        try {
          const url = new URL(
            input.startsWith("http") ? input : `https://${input}`
          );
          if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("Invalid protocol");
          }
        } catch (e) {
          return {
            isValid: false,
            message: "Please provide a valid URL (e.g., https://example.com)",
          };
        }
        break;

      case "range":
        const rangeValue = Number(input);
        if (isNaN(rangeValue)) {
          return {
            isValid: false,
            message: "Please provide a numeric value.",
          };
        }

        const min = field.min ?? 0;
        const max = field.max ?? 100;

        if (rangeValue < min || rangeValue > max) {
          return {
            isValid: false,
            message: `Please provide a value between ${min} and ${max}.`,
          };
        }
        break;

      case "checkbox":
      case "radio":
        const validBooleanInputs = [
          "true",
          "false",
          "yes",
          "no",
          "1",
          "0",
          "on",
          "off",
          "checked",
          "unchecked",
        ];
        if (!validBooleanInputs.includes(input.toLowerCase())) {
          return {
            isValid: false,
            message: "Please enter: yes/no, true/false, or 1/0",
          };
        }
        break;
      case "select":
        if (field.options && field.options.length > 0) {
          const validOption = field.options.some(
            (option) =>
              option.toLowerCase() === input.toLowerCase() ||
              option.toLowerCase().includes(input.toLowerCase())
          );

          if (!validOption) {
            return {
              isValid: false,
              message: `Please select one of the available options: ${field.options.slice(0, 5).join(", ")}${field.options.length > 5 ? "..." : ""}`,
            };
          }
        }
        break;

      default:
        if (field.minLength && input.length < field.minLength) {
          return {
            isValid: false,
            message: `This field requires at least ${field.minLength} characters.`,
          };
        }

        if (field.maxLength && input.length > field.maxLength) {
          return {
            isValid: false,
            message: `This field allows a maximum of ${field.maxLength} characters.`,
          };
        }

        break;
    }

    return { isValid: true };
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

  private isUserCancellation(input: string): boolean {
    const cancelKeywords = ["quit", "exit", "cancel", "abort", "stop"];
    return cancelKeywords.includes(input.toLowerCase().trim());
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

  private getDisplayName(field: FormField): string {
    return field.label.replace(/\s*\*\s*$/, "").trim();
  }

  private async fillFieldEnhanced(
    field: FormField,
    value: string
  ): Promise<void> {
    try {
      const selectors = [field.selector];

      if ((field as any).alternativeSelectors) {
        selectors.push(...(field as any).alternativeSelectors);
      }

      const labelBasedSelectors = this.generateSelectorsByLabel(field.label);
      selectors.push(...labelBasedSelectors);

      let element = null;

      for (const selector of selectors) {
        try {
          element = await this.page.waitForSelector(selector, {
            timeout: 3000,
            visible: false,
          });

          if (element) {
            break;
          }
        } catch (error) {
          continue;
        }
      }

      if (!element) {
        element = await this.findElementByLabelText(field.label);
      }

      if (!element) {
        throw new Error(`Could not find element for field "${field.label}"`);
      }

      const elementState = await element.evaluate((el: Element) => {
        const input = el as HTMLInputElement;
        const computedStyle = window.getComputedStyle(el);

        return {
          disabled: input.disabled || el.hasAttribute("disabled"),
          readonly: input.readOnly || el.hasAttribute("readonly"),
          visible:
            computedStyle.display !== "none" &&
            computedStyle.visibility !== "hidden",
          tagName: el.tagName.toLowerCase(),
          type: input.type || "",
          isDropdown:
            el.className.includes("select") ||
            el.getAttribute("role") === "combobox" ||
            el.tagName.toLowerCase() === "select",
        };
      });

      if (elementState.disabled || elementState.readonly) {
        console.log(
          `Skipping ${elementState.disabled ? "disabled" : "readonly"} field: ${field.label}`
        );
        return;
      }

      if (elementState.isDropdown || field.type === "select") {
        await this.fillDropdownField(element, value, field.label);
      } else {
        await this.fillFieldByType(element, field, value);
      }
    } catch (error) {}
  }

  private async fillDropdownField(
    element: any,
    value: string,
    fieldLabel: string
  ): Promise<void> {
    try {
      const tagName = await element.evaluate((el: Element) =>
        el.tagName.toLowerCase()
      );
      if (tagName === "select") {
        await element.select(value);
        return;
      }

      await element.click();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const optionSelectors = [
        '[role="option"]',
        "[data-value]",
        ".mantine-Select-item",
        ".dropdown-item",
      ];

      for (const selector of optionSelectors) {
        try {
          const options = await this.page.$$(selector);

          if (options && options.length > 0) {
            for (const option of options) {
              const optionText = await option.evaluate(
                (el: Element) => el.textContent?.trim().toLowerCase() || ""
              );

              if (
                optionText === value.toLowerCase() ||
                optionText.includes(value.toLowerCase()) ||
                value.toLowerCase().includes(optionText)
              ) {
                await option.click();
                return;
              }
            }
          }
        } catch (error) {
          continue;
        }
      }

      await element.focus();
      await element.type(value);
      await this.page.keyboard.press("Enter");
    } catch (error) {}
  }

  private async fillFieldByType(
    element: any,
    field: FormField,
    value: string
  ): Promise<void> {
    switch (field.type) {
      case "checkbox":
      case "select":
        await this.fillDropdownField(element, value, field.label);
        break;
      case "password":
        await element.focus();
        await element.evaluate((el: Element) => {
          const input = el as HTMLInputElement;
          input.value = "";
        });
        await element.type(value, { delay: 100 });
        break;
      case "email":
        const emailValue = value.trim().toLowerCase();
        await element.focus();
        await element.evaluate((el: Element) => {
          const input = el as HTMLInputElement;
          input.value = "";
        });
        await element.type(emailValue, { delay: 50 });
        break;
      case "number":
        const numValue = value.replace(/[^0-9.-]/g, "");
        await element.focus();
        await element.evaluate((el: Element, val: string) => {
          const input = el as HTMLInputElement;
          input.value = val;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }, numValue);
        break;
      case "tel":
        const phoneValue = value.replace(/[^\d+\-() ]/g, "");
        await element.focus();
        await element.evaluate((el: Element) => {
          const input = el as HTMLInputElement;
          input.value = "";
        });
        await element.type(phoneValue, { delay: 50 });
        break;
      case "color":
        let colorValue = value.trim();

        if (!colorValue.startsWith("#")) {
          const colorMap: Record<string, string> = {
            red: "#FF0000",
            green: "#008000",
            blue: "#0000FF",
            yellow: "#FFFF00",
            black: "#000000",
            white: "#FFFFFF",
            purple: "#800080",
            orange: "#FFA500",
            pink: "#FFC0CB",
            gray: "#808080",
            grey: "#808080",
            brown: "#A52A2A",
          };

          colorValue = colorMap[colorValue.toLowerCase()] || "#000000";
        }

        if (!/^#[0-9A-Fa-f]{6}$/.test(colorValue)) {
          colorValue = "#000000";
        }

        await element.evaluate((el: HTMLInputElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, colorValue);
        break;
      case "date":
        await element.evaluate((el: HTMLInputElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
        break;
      case "datetime-local":
        await element.evaluate((el: HTMLInputElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
        break;
      case "file":
        console.log("File inputs require special handling - skipping");
        break;
      case "range":
        await element.evaluate((el: HTMLInputElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }, value);
        break;
      case "time":
        await element.evaluate((el: HTMLInputElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
        break;
      case "week":
        await element.evaluate((el: HTMLInputElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
        break;
      case "month":
        await element.evaluate((el: HTMLInputElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
        break;
      case "radio":
        const shouldCheck = ["true", "yes", "1", "on", "checked"].includes(
          value.toLowerCase()
        );
        const isChecked = await element.evaluate(
          (el: Element) => (el as HTMLInputElement).checked
        );
        if (shouldCheck !== isChecked) {
          await element.click();
        }
        break;
      case "textarea":
        await element.focus();
        await element.evaluate((el: Element) => {
          const textarea = el as HTMLTextAreaElement;
          textarea.value = "";
        });
        await element.type(value, { delay: 30 });
        break;
      default:
        await element.focus();

        const hasDatalist = await element.evaluate((el: Element) => {
          const input = el as HTMLInputElement;
          return !!input.list;
        });

        if (hasDatalist) {
          await element.evaluate((el: Element) => {
            const input = el as HTMLInputElement;
            input.value = "";
          });
          await element.type(value, { delay: 100 });

          await new Promise((resolve) => setTimeout(resolve, 300));

          try {
            const optionSelector = `option[value="${value}"]`;
            const option = await this.page.$(optionSelector);
            if (option) {
              await option.click();
            }
          } catch (error) {}
        } else {
          await element.focus();
          await this.page.keyboard.down("Control");
          await this.page.keyboard.press("KeyA");
          await this.page.keyboard.up("Control");
          await element.type(value, { delay: 50 });
        }
        break;
    }
    await element.evaluate((el: Element) => {
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    });
  }

  private async findWorkingSelector(field: FormField): Promise<string | null> {
    const potentialSelectors = this.generateSelectorsByLabel(field.label);

    for (const selector of potentialSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          const tagName = await element.evaluate((el: Element) =>
            el.tagName.toLowerCase()
          );
          if (["input", "textarea", "select"].includes(tagName)) {
            return selector;
          }
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  private generateSelectorsByLabel(label: string): string[] {
    const selectors: string[] = [];
    const cleanLabel = label.replace(/\s*\*\s*$/, "").trim();

    selectors.push(`[aria-label="${cleanLabel}"]`);
    selectors.push(`[aria-label*="${cleanLabel}"]`);
    selectors.push(`[placeholder="${cleanLabel}"]`);
    selectors.push(`[placeholder*="${cleanLabel}"]`);
    selectors.push(`[title="${cleanLabel}"]`);
    selectors.push(`[title*="${cleanLabel}"]`);

    const nameVariations = [
      cleanLabel.toLowerCase().replace(/\s+/g, ""),
      cleanLabel.toLowerCase().replace(/\s+/g, "_"),
      cleanLabel.toLowerCase().replace(/\s+/g, "-"),
    ];

    nameVariations.forEach((name) => {
      selectors.push(`[name="${name}"]`);
      selectors.push(`[name*="${name}"]`);
      selectors.push(`#${name}`);
    });

    return selectors;
  }

  private async findElementByLabelText(labelText: string): Promise<any> {
    try {
      return await this.page.evaluateHandle((text: string) => {
        const cleanText = text.replace(/\s*\*\s*$/, "").trim();
        const labels = Array.from(document.querySelectorAll("label"));

        for (const label of labels) {
          const labelContent = label.textContent?.trim() || "";
          if (
            labelContent.includes(cleanText) ||
            cleanText.includes(labelContent)
          ) {
            const forAttr = label.getAttribute("for");
            if (forAttr) {
              const input = document.getElementById(forAttr);
              if (input) return input;
            }

            const input = label.querySelector("input, textarea, select");
            if (input) return input;

            const nextElement = label.nextElementSibling;
            if (
              nextElement &&
              ["INPUT", "TEXTAREA", "SELECT"].includes(nextElement.tagName)
            ) {
              return nextElement;
            }
          }
        }

        const inputs = Array.from(
          document.querySelectorAll("input, textarea, select")
        );
        for (const input of inputs) {
          const placeholder = input.getAttribute("placeholder") || "";
          if (
            placeholder.includes(cleanText) ||
            cleanText.includes(placeholder)
          ) {
            return input;
          }
        }

        return null;
      }, labelText);
    } catch (error) {
      return null;
    }
  }

  private async detectHiddenFields(): Promise<FormField[]> {
    try {
      const hiddenFields = await this.page.evaluate(() => {
        const foundFields: any[] = [];
        const allElements = document.querySelectorAll("*");

        allElements.forEach((element) => {
          if (element.id && element.id.includes("mantine-")) {
            const tagName = element.tagName.toLowerCase();

            if (["input", "textarea", "select", "div"].includes(tagName)) {
              let label = "";

              const parent = element.parentElement;
              if (parent) {
                const labelElement = parent.querySelector("label");
                if (labelElement) {
                  label = labelElement.textContent?.trim() || "";
                }

                if (!label) {
                  const siblings = Array.from(parent.children);
                  for (const sibling of siblings) {
                    if (sibling !== element && sibling.textContent) {
                      const text = sibling.textContent.trim();
                      if (text.includes("*") || text.length < 50) {
                        label = text;
                        break;
                      }
                    }
                  }
                }
              }

              if (label) {
                foundFields.push({
                  label: label,
                  selector: `#${element.id}`,
                  type:
                    element.tagName.toLowerCase() === "select"
                      ? "select"
                      : "input",
                  required:
                    label.includes("*") || element.hasAttribute("required"),
                  placeholder: element.getAttribute("placeholder") || "",
                });
              }
            }
          }
        });

        return foundFields;
      });

      return hiddenFields;
    } catch (error) {
      return [];
    }
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
          continue;
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
      return null;
    }
  }

  private async findElementByLabel(
    labelText: string
  ): Promise<{ element: any; selector: string } | null> {
    try {
      const labelElements = await this.page.$$("label");

      if (!labelElements || labelElements.length === 0) {
        return null;
      }

      for (const label of labelElements) {
        const currentLabelText = await label.evaluate(
          (el: Element) => el.textContent?.trim() || ""
        );
        if (
          currentLabelText === labelText ||
          currentLabelText.includes(labelText)
        ) {
          const forAttr = await label.evaluate((el: Element) =>
            el.getAttribute("for")
          );
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
    } catch (error) {
      return null;
    }
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

  private async submitForm(): Promise<void> {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:contains("Submit")',
      'button:contains("Send")',
      'button:contains("Next")',
      'button:contains("Continue")',
      ".submit-btn",
      "#submit",
      '[data-testid="submit"]',
      'button[class*="submit"]',
      'button[class*="Submit"]',
      '[role="button"][class*="submit"]',
      '[role="button"][class*="Submit"]',
    ];

    for (const selector of submitSelectors) {
      try {
        const btn = await this.page.$(selector);
        if (btn && (await this.isElementVisible(btn))) {
          await btn.click();
          console.log(`Clicked submit button with selector: ${selector}`);
          return;
        }
      } catch (error) {
        continue;
      }
    }
    const buttons = await this.page.$$("button");
    for (const button of buttons) {
      const text = await button.evaluate(
        (el) => el.textContent?.toLowerCase() || ""
      );
      const className = await button.evaluate((el) =>
        el.className.toLowerCase()
      );

      if (
        [
          "submit",
          "send",
          "continue",
          "save",
          "next",
          "finish",
          "complete",
        ].some(
          (keyword) => text.includes(keyword) || className.includes(keyword)
        )
      ) {
        if (await this.isElementVisible(button)) {
          const buttonPosition = await button.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            const windowHeight = window.innerHeight;
            return rect.top / windowHeight;
          });

          if (buttonPosition > 0.5) {
            await button.click();
            console.log(`Clicked button with text: "${text}"`);
            return;
          }
        }
      }
    }

    try {
      await this.page.evaluate(() => {
        const form = document.querySelector("form");
        if (form) {
          form.submit();
        } else {
          const allButtons = Array.from(
            document.querySelectorAll("button:not([disabled])")
          );
          const visibleButtons = allButtons.filter((btn) => {
            const style = window.getComputedStyle(btn);
            return style.display !== "none" && style.visibility !== "hidden";
          });

          if (visibleButtons.length > 0) {
            (visibleButtons[visibleButtons.length - 1] as HTMLElement).click();
          } else {
            throw new Error("No submit button or form found");
          }
        }
      });
    } catch (error) {
      console.log("Could not find a way to submit the form");
      throw error;
    }
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

  public sanitizeInput(input: string): string {
    return FormUtils.sanitizeInput(input);
  }

  public validateFormFields(fields: FormFieldEntity[]): FormFieldEntity[] {
    return fields.filter((field) => field.isValid());
  }

  public validateAnswer(
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
    this.displayResponseCache.clear();
  }

  public getCachedResponses(): Map<string, string> {
    return new Map(this.userResponseCache);
  }

  public getDisplayResponses(): Map<string, string> {
    return this.displayResponseCache;
  }

  async processFormWithValidation(formFields: FormField[]): Promise<boolean> {
    return this.processFormWithValidationEnhanced(formFields);
  }
}
