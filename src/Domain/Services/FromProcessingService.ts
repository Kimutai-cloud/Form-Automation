import { Page } from "puppeteer";
import { FormField, FormFieldEntity } from "../../Domain/Entities/FormField";
import { IValidationError } from "../../Domain/Repositories/IValidationError";
import { ValidationService } from "./ValidationService";
import { OpenAIRepository } from "../../Infrastucture/Repositories/OpenAIRepository";
import { ConsoleUserInterface } from "../../Infrastucture/ui/ConsoleUserInterface";
import { AIQuestionRequest } from "../../Domain/Repositories/IAIRepository";
import { FormUtils } from "../Services/FormUtils";

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

  async verifyAndUpdateSelectors(
    formFields: FormField[]
  ): Promise<FormField[]> {
    this.logStage("🔍 == Verifying Form Field Selectors ==");

    const updatedFields: FormField[] = [];

    for (const field of formFields) {
      try {
        const element = await this.page.$(field.selector);

        if (element) {
          updatedFields.push(field);
         
        } else {
          

          const newSelector = await this.findWorkingSelector(field);
          if (newSelector) {
            const updatedField = {
              ...field,
              selector: newSelector,
            };
            updatedFields.push(updatedField);
            
          } else {
            
            updatedFields.push(field);
          }
        }
      } catch (error) {
        this.logError(`Error verifying selector for "${field.label}":`, error);
        updatedFields.push(field);
      }
    }

    return updatedFields;
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
  async detectHiddenFields(): Promise<FormField[]> {
    try {
      const hiddenFields = await this.page.evaluate(() => {
        const foundFields: any[] = [];

        const allElements = document.querySelectorAll("*");

        allElements.forEach((element) => {
          if (element.id && element.id.includes("mantine-")) {
            const tagName = element.tagName.toLowerCase();

            if (["input", "textarea", "select", "div"].includes(tagName)) {
              const ariaLabel = element.getAttribute("aria-label");
              const dataLabel = element.getAttribute("data-label");
              const placeholder = element.getAttribute("placeholder");

              let label = ariaLabel || dataLabel || placeholder || "";

              if (!label) {
                const parent = element.parentElement;
                if (parent) {
                  const labelElement = parent.querySelector("label");
                  if (labelElement) {
                    label = labelElement.textContent?.trim() || "";
                  }

                  const siblings = Array.from(parent.children);
                  for (const sibling of siblings) {
                    if (
                      sibling !== element &&
                      sibling.textContent &&
                      sibling.textContent.trim().length < 50
                    ) {
                      const text = sibling.textContent.trim();
                      if (text.includes("*") || text.includes("required")) {
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
                  placeholder: placeholder || "",
                });
              }
            }
          }
        });

        return foundFields;
      });

      return hiddenFields.map((field: any) => ({
        label: field.label,
        selector: field.selector,
        type: field.type as FormField["type"],
        required: field.required,
        placeholder: field.placeholder,
      }));
    } catch (error) {
      this.logError("Error detecting hidden fields:", error);
      return [];
    }
  }

  async processFormWithValidation(formFields: FormField[]): Promise<boolean> {
    this.logStage("🎯 == Starting Form Processing ==");

    try {
      const verifiedFields = await this.verifyAndUpdateSelectors(formFields);

      const userResponses = await this.collectInitialResponses(verifiedFields);
      await this.fillFormFields(verifiedFields, userResponses);
      return await this.submitWithValidationHandling();
    } catch (error) {
      this.logError("❌ Form processing failed:", error);
      return false;
    }
  }

  async processFormWithValidationEnhanced(
    formFields: FormField[]
  ): Promise<boolean> {
    this.logStage("🎯 == Starting Form Processing ==");

    try {
      const verifiedFields = await this.verifyAndUpdateSelectors(formFields);

      const userResponses = await this.collectInitialResponses(verifiedFields);

      await this.fillFormFieldsEnhanced(verifiedFields, userResponses);

      return await this.submitWithEnhancedValidationHandling(userResponses);
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

    // First, detect all fields including hidden dropdowns
    const allFields = await this.detectAllFormFields(formFields);

    console.log("Let me ask you some questions to fill out this form:\n");

    for (const field of allFields) {
      try {
        const fieldName = this.getFieldName(field);

        if (this.userResponseCache.has(fieldName)) {
          const cachedValue = this.userResponseCache.get(fieldName)!;
          responses.set(fieldName, cachedValue);
          continue;
        }

        let question: string;
        let options: string[] = [];

        // For dropdown fields, get available options first
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
        do {
          answer = await this.consoleUI.askQuestion(question);

          if (this.isUserCancellation(answer)) {
            console.warn(
              "❗️ User cancelled input. Aborting form processing..."
            );
            throw new Error("User cancelled");
          }

          answer = FormUtils.sanitizeInput(answer);

          // Validate answer (including dropdown validation)
          const validation =
            options.length > 0
              ? this.validateDropdownAnswer(answer, options, field)
              : this.validateFieldInput(field, answer);

          if (!validation.isValid) {
            console.log(`❌ ${validation.message}`);
            continue;
          }

          break;
        } while (true);

        responses.set(fieldName, answer);
        this.userResponseCache.set(fieldName, answer);
        // Remove the success log here - keep it quiet
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
          this.logInfo(`🔍 Detected additional field: "${hiddenField.label}"`);
        }
      }
    } catch (error) {
      this.logWarning("Could not detect additional fields:");
    }

    return allFields;
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

      await element.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const optionSelectors = [
        '[role="option"]',
        "option",
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

            for (let i = 0; i < options.length; i++) {
              const option = options[i];
              const text = await option.evaluate(
                (el: Element) =>
                  el.textContent?.trim() || el.getAttribute("value") || ""
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

  private async generateDropdownQuestion(
    field: FormField,
    options: string[]
  ): Promise<string> {
    const baseQuestion = await this.generateRegularQuestion(field);

    const optionsText = options
      .slice(0, 10)
      .map((option, index) => `${index + 1}. ${option}`)
      .join("\n  ");

    return `${baseQuestion}\n\nAvailable options:\n  ${optionsText}\n\nYou can either:\n- Enter the number (1-${Math.min(options.length, 10)})\n- Type the option name\n- Type part of the option name\n\nYour choice`;
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
      : `Please provide your ${field.label.toLowerCase()}:`;
  }

  private validateDropdownAnswer(
    answer: string,
    options: string[],
    field: FormField
  ): { isValid: boolean; message?: string } {
    if (field.required && !answer.trim()) {
      return {
        isValid: false,
        message: "This field is required. Please provide a value.",
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

  private async fillFormFieldsEnhanced(
    formFields: FormField[],
    responses: Map<string, string>
  ): Promise<void> {
    this.logStage("🎯 == Filling Form Fields ==");

    for (const field of formFields) {
      const fieldName = this.getFieldName(field);
      const value = responses.get(fieldName);
      if (value) {
        await this.fillFieldEnhanced(field, value);
      }
    }
  }

  async fillField(field: FormField, value: string): Promise<void> {
    try {
      const selectors = [field.selector];

      if ((field as any).alternativeSelectors) {
        selectors.push(...(field as any).alternativeSelectors);
      }

      const labelBasedSelectors = this.generateSelectorsByLabel(field.label);
      selectors.push(...labelBasedSelectors);

      let element = null;
      let usedSelector = "";

      for (const selector of selectors) {
        try {
          this.logInfo(`🔍 Trying selector: ${selector}`);

          element = await this.page.waitForSelector(selector, {
            timeout: 3000,
            visible: true,
          });

          if (element) {
            usedSelector = selector;
            this.logSuccess(`✅ Found element with selector: ${selector}`);
            break;
          }
        } catch (error) {
          this.logWarning(`⚠️ Selector failed: ${selector}`);
          continue;
        }
      }

      if (!element) {
        element = await this.findElementByLabelText(field.label);
        if (element) {
          usedSelector = `label-text:"${field.label}"`;
          this.logSuccess(`✅ Found element by label text: ${field.label}`);
        }
      }

      if (!element) {
        throw new Error(
          `Could not find element for field "${field.label}" with any selector`
        );
      }

      const elementState = await element.evaluate((el: Element) => ({
        disabled:
          (el as HTMLInputElement).disabled || el.hasAttribute("disabled"),
        readonly:
          (el as HTMLInputElement).readOnly || el.hasAttribute("readonly"),
        visible: window.getComputedStyle(el).display !== "none",
        tagName: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type || "",
      }));

      if (elementState.disabled) {
        console.warn(`⚠️ Field "${field.label}" is disabled, skipping...`);
        return;
      }

      if (elementState.readonly) {
        console.warn(`⚠️ Field "${field.label}" is readonly, skipping...`);
        return;
      }

      await this.fillFieldByType(element, field, value);

      this.logSuccess(
        `✅ Successfully filled "${field.label}" with: "${value}" using selector: ${usedSelector}`
      );
    } catch (error) {
      this.logError(`❌ Error filling field "${field.label}":`, error);
      await this.dumpPageHTML(field.label);
      await this.analyzeFormState();
      throw error;
    }
  }

  async fillFieldEnhanced(field: FormField, value: string): Promise<void> {
    try {
      const selectors = [field.selector];

      if ((field as any).alternativeSelectors) {
        selectors.push(...(field as any).alternativeSelectors);
      }

      const labelBasedSelectors = this.generateSelectorsByLabel(field.label);
      selectors.push(...labelBasedSelectors);

      let element = null;
      let usedSelector = "";

      for (const selector of selectors) {
        try {
          element = await this.page.waitForSelector(selector, {
            timeout: 3000,
            visible: false,
          });

          if (element) {
            usedSelector = selector;
            break;
          }
        } catch (error) {
          continue;
        }
      }

      if (!element) {
        element = await this.findElementByLabelText(field.label);
        if (element) {
          usedSelector = `label-text:"${field.label}"`;
        }
      }

      if (!element) {
        throw new Error(
          `Could not find element for field "${field.label}" with any selector`
        );
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
          className: el.className,
          isMantineSelect:
            el.className.includes("mantine") &&
            (el.getAttribute("role") === "combobox" ||
              el.className.includes("select") ||
              el.tagName.toLowerCase() === "input"),
        };
      });

      if (elementState.isMantineSelect || elementState.readonly) {
        await this.fillDropdownField(element, value, field.label);
      } else if (elementState.disabled) {
        this.logWarning(`⚠️ Field "${field.label}" is disabled, skipping...`);
        return;
      } else {
        await this.fillFieldByType(element, field, value);
      }

    } catch (error) {
      this.logError(`❌ Error filling field "${field.label}":`, error);
      await this.dumpPageHTML(field.label);
      await this.analyzeFormState();
      this.logWarning(`⚠️ Continuing with other fields...`);
    }
  }
  private async fillDropdownField(
    element: any,
    value: string,
    fieldLabel: string
  ): Promise<void> {
    try {
      await element.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const optionSelectors = [
        '[role="option"]',
        "[data-value]",
        ".mantine-Select-item",
        ".mantine-MultiSelect-item",
        "option",
      ];

      let selectedOption = null;

      for (const selector of optionSelectors) {
        try {
          const options = await this.page.$$(selector);

          if (options && options.length > 0) {
            const numValue = parseInt(value.trim());
            if (
              !isNaN(numValue) &&
              numValue >= 1 &&
              numValue <= options.length
            ) {
              selectedOption = options[numValue - 1];
            } else {
              for (let i = 0; i < options.length; i++) {
                const option = options[i];
                const optionText = await option.evaluate(
                  (el: Element) => el.textContent?.trim().toLowerCase() || ""
                );

                if (
                  optionText.includes(value.toLowerCase()) ||
                  value.toLowerCase().includes(optionText)
                ) {
                  selectedOption = option;
                  break;
                }
              }
            }

            if (selectedOption) {
              await selectedOption.click();
              return;
            }
          }
        } catch (error) {
          continue;
        }
      }

      await element.focus();
      await element.type(value);
      await this.page.keyboard.press("Enter");
    } catch (error) {
      this.logError(`Error handling dropdown for "${fieldLabel}":`, error);
      throw error;
    }
  }

  private getDisplayName(field: FormField): string {
    return field.label.replace(/\s*\*\s*$/, "").trim();
  }

  public getDisplayResponses(): Map<string, string> {
    return (this as any).displayResponseCache || new Map();
  }

  private async fillMantineSelect(
    element: any,
    value: string,
    fieldLabel: string
  ): Promise<void> {
    try {

      await element.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const optionSelectors = [
        '[role="option"]',
        "[data-value]",
        ".mantine-Select-item",
        ".mantine-MultiSelect-item",
        '[data-testid*="option"]',
      ];

      for (const selector of optionSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 2000 });

          const options = await this.page.$$(selector);

          if (options && options.length > 0) {
            for (let i = 0; i < options.length; i++) {
              const option = options[i];
              const optionText = await option.evaluate(
                (el: Element) => el.textContent?.trim().toLowerCase() || ""
              );

              if (
                optionText.includes(value.toLowerCase()) ||
                value.toLowerCase().includes(optionText)
              ) {
                await option.click();
                this.logSuccess(`✅ Selected option: "${optionText}"`);
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
    } catch (error) {
      this.logError(`Error handling Mantine select:`, error);
      throw error;
    }
  }

  private async handleDropdownSelection(value: string): Promise<boolean> {
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));

      const dropdownSelectors = [
        '[role="listbox"] [role="option"]',
        '[role="menu"] [role="menuitem"]',
        ".dropdown-item",
        ".select-option",
        "[data-value]",
        "li[data-value]",
        "div[data-value]",
      ];

      for (const selector of dropdownSelectors) {
        try {
          const options = await this.page.$$(selector);

          if (options && options.length > 0) {
            this.logInfo(
              `🔍 Found ${options.length} dropdown options with selector: ${selector}`
            );

            for (let i = 0; i < options.length; i++) {
              const option = options[i];
              const optionText = await option.evaluate(
                (el: Element) => el.textContent?.trim().toLowerCase() || ""
              );
              const optionValue = await option.evaluate(
                (el: Element) =>
                  el.getAttribute("data-value")?.toLowerCase() || ""
              );

              if (
                optionText.includes(value.toLowerCase()) ||
                optionValue.includes(value.toLowerCase()) ||
                value.toLowerCase().includes(optionText)
              ) {
                await option.click();
                this.logSuccess(`✅ Selected dropdown option: "${optionText}"`);
                return true;
              }
            }
          }
        } catch (error) {
          this.logWarning(`⚠️ Error with selector ${selector}: ${error}`);
          continue;
        }
      }

      return false;
    } catch (error) {
      this.logError("Error in handleDropdownSelection:", error);
      return false;
    }
  }

  private async fillFieldByType(
    element: any,
    field: FormField,
    value: string
  ): Promise<void> {
    const elementInfo = await element.evaluate((el: Element) => ({
      tagName: el.tagName.toLowerCase(),
      type: (el as HTMLInputElement).type || "",
      isSelect: el.tagName.toLowerCase() === "select",
      isTextarea: el.tagName.toLowerCase() === "textarea",
      isCheckbox: (el as HTMLInputElement).type === "checkbox",
      isRadio: (el as HTMLInputElement).type === "radio",
    }));

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
    } catch (error) {      interface SelectOption {
        value: string;
        text: string;
      }

      const options: SelectOption[] = await element.$$eval(
        "option",
        (opts: HTMLOptionElement[]) =>
          opts.map(
            (opt): SelectOption => ({
              value: opt.value,
              text: opt.textContent?.trim() || "",
            })
          )
      );

      const matchingOption = options.find(
        (opt: SelectOption) =>
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
      (el: Element) => (el as HTMLInputElement).checked
    );

    if (shouldCheck !== isChecked) {
      await element.click();
    }
  }

  private async fillTextAreaField(element: any, value: string): Promise<void> {
    await element.focus();
    await element.evaluate((el: Element) => {
      const textarea = el as HTMLTextAreaElement;
      textarea.value = "";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await element.type(value, { delay: 30 });
    await element.evaluate((el: Element) => {
      const textarea = el as HTMLTextAreaElement;
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  private async fillInputField(element: any, value: string): Promise<void> {
    await element.focus();
    await this.page.keyboard.down("Control");
    await this.page.keyboard.press("KeyA");
    await this.page.keyboard.up("Control");
    await element.type(value, { delay: 50 });

    await element.evaluate((el: Element) => {
      const input = el as HTMLInputElement;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
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

  private async submitWithEnhancedValidationHandling(
    existingResponses: Map<string, string>
  ): Promise<boolean> {
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
          
          return false;
        }

        this.logValidationErrors(validationErrors);

        if (attempt < this.maxRetries) {
          this.logInfo("🔄 Let me help you correct these issues...\n");

          const shouldContinue = await this.handleValidationErrorsEnhanced(
            validationErrors,
            existingResponses
          );

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
          : `Please provide a corrected value for "${error.fieldLabel || error.fieldName}" (Error: ${error.errorMessage}):`;

        const correctedValue =
          await this.consoleUI.askQuestion(correctionQuestion);

        if (this.isUserCancellation(correctedValue)) {
          return false;
        }

        if (!correctedValue.trim()) {
          this.logWarning("⚠️ Empty value provided, skipping this field.");
          continue;
        }

        const sanitizedValue = FormUtils.sanitizeInput(correctedValue);

        // Try to find the field in our known fields first
        let field = await this.findFieldByNameOrLabel(
          error.fieldName,
          error.fieldLabel
        );

        // If not found, check hidden fields
        if (!field) {
          const hiddenField = hiddenFields.find(
            (f) =>
              f.label.includes(error.fieldLabel || error.fieldName) ||
              (error.fieldLabel || error.fieldName).includes(f.label)
          );

          if (hiddenField) {
            field = hiddenField;
            this.logInfo(
              `🔍 Found field in hidden fields: ${hiddenField.label}`
            );
          }
        }

        if (field) {
          await this.fillFieldEnhanced(field, sanitizedValue); // Use enhanced method
          this.logSuccess(
            `✓ Updated "${error.fieldLabel || error.fieldName}" with corrected value`
          );
          this.userResponseCache.set(this.getFieldName(field), sanitizedValue);
          existingResponses.set(this.getFieldName(field), sanitizedValue);
        } else {
          this.logWarning(
            `⚠️ Could not find field to update: ${error.fieldLabel || error.fieldName}`
          );
        }
      } catch (error) {
        this.logError(`Error handling validation error:`, error);
      }
    }
    return true;
  }

  private logValidationErrors(validationErrors: IValidationError[]): void {
    this.logError(`❌ Found ${validationErrors.length} validation error(s):`);
    for (const err of validationErrors) {
      console.log(
        `  - Field "${err.fieldLabel || err.fieldName}": ${err.errorMessage || "Unknown error"}`
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
    if (buttons.length > 0) {
      for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
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
          : `Please provide a corrected value for "${error.fieldLabel || error.fieldName}" (Error: ${error.errorMessage}):`;

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
          await this.fillFieldEnhanced(field, sanitizedValue); // Use enhanced method here too
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
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, "");
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
          // Continue to next selector
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
    try {
      const labelElements = await this.page.$$("label");

      if (!labelElements || labelElements.length === 0) {
        return null;
      }

      for (let i = 0; i < labelElements.length; i++) {
        const label = labelElements[i];
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
      this.logError("Error in findElementByLabel:", error);
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

  private async dumpPageHTML(fieldLabel: string): Promise<void> {
    try {
      const html = await this.page.content();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `debug-${fieldLabel.replace(/[^a-zA-Z0-9]/g, "_")}-${timestamp}.html`;
      const filepath = `./screenshots/${filename}`;

      const fs = require("fs");
      fs.writeFileSync(filepath, html);

      this.logInfo(`📄 Page HTML dumped: ${filepath}`);
    } catch (error) {
      this.logWarning(`Failed to dump page HTML: ${error}`);
    }
  }

  private async analyzeFormState(): Promise<void> {
    try {
      const formInfo = await this.page.evaluate(() => {
        const forms = Array.from(document.querySelectorAll("form"));
        const inputs = Array.from(
          document.querySelectorAll("input, textarea, select")
        );

        return {
          formsCount: forms.length,
          inputsCount: inputs.length,
          visibleInputs: inputs.filter((input: Element) => {
            const element = input as HTMLElement;
            return (
              element.offsetParent !== null &&
              window.getComputedStyle(element).display !== "none"
            );
          }).length,
          inputTypes: inputs.map((input: Element) => ({
            tag: input.tagName.toLowerCase(),
            type: (input as HTMLInputElement).type || "N/A",
            id: (input as HTMLElement).id || "N/A",
            name: (input as HTMLInputElement).name || "N/A",
            className: (input as HTMLElement).className || "N/A",
          })),
        };
      });

      this.logInfo(`📊 Form State Analysis:`);
      this.logInfo(`   Forms found: ${formInfo.formsCount}`);
      this.logInfo(`   Total inputs: ${formInfo.inputsCount}`);
      this.logInfo(`   Visible inputs: ${formInfo.visibleInputs}`);

      console.table(formInfo.inputTypes.slice(0, 10)); 
    } catch (error) {
      this.logWarning(`Failed to analyze form state: ${error}`);
    }
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
    console.warn(`⚠️ ${message}`);
  }

  private logInfo(message: string): void {
    console.log(`ℹ️ ${message}`);
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
