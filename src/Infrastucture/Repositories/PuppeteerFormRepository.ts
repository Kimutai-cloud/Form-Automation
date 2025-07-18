import puppeteer, { Browser, Page } from 'puppeteer';
import { IFormRepository } from '../../Domain/Repositories/IFormRepository';
import { FormFieldEntity } from '../../Domain/Entities/FormField';
import { FormSubmissionResult } from '../../Domain/Entities/FormSubmission';
import { Logger } from '../logging/Logger';

/**
 * Repository for interacting with web forms using Puppeteer.
 * Provides methods to initialize the browser, navigate to pages, extract form fields,
 * fill fields, submit forms, and close the browser.
 */

export class PuppeteerFormRepository implements IFormRepository {
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(private readonly logger: Logger) {}

  async initialize(headless: boolean = true): Promise<void> {
    try {
      this.browser = await puppeteer.launch({
        headless,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        defaultViewport: { width: 1280, height: 720 },
      });

      this.page = await this.browser.newPage();

      await this.page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      );

      this.logger.info("Browser initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize browser:", error);
      throw error;
    }
  }

  async navigateToPage(url: string, timeout: number = 30000): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      await this.page.goto(url, {
        waitUntil: "networkidle2",
        timeout,
      });
      this.logger.info(`Successfully navigated to: ${url}`);
    } catch (error) {
      this.logger.error(`Failed to navigate to ${url}:`, error);
      throw error;
    }
  }

  async extractFormFields(): Promise<FormFieldEntity[]> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      const fields = await this.page.evaluate(() => {
        const foundFields: any[] = [];

        const processInputs = () => {
          const inputs = document.querySelectorAll("input");
          inputs.forEach((element: HTMLInputElement) => {
            if (
              element.type === "hidden" ||
              element.disabled ||
              element.readOnly ||
              element.style.display === "none" ||
              element.offsetParent === null
            ) {
              return;
            }

            const fieldData = extractFieldData(element, "input");
            if (fieldData) foundFields.push(fieldData);
          });
        };

        const processTextareas = () => {
          const textareas = document.querySelectorAll("textarea");
          textareas.forEach((element: HTMLTextAreaElement) => {
            if (
              element.disabled ||
              element.readOnly ||
              element.style.display === "none" ||
              element.offsetParent === null
            ) {
              return;
            }

            const fieldData = extractFieldData(element, "textarea");
            if (fieldData) foundFields.push(fieldData);
          });
        };

        const processSelects = () => {
          const selects = document.querySelectorAll("select");
          selects.forEach((element: HTMLSelectElement) => {
            if (
              element.disabled ||
              element.style.display === "none" ||
              element.offsetParent === null
            ) {
              return;
            }

            const fieldData = extractFieldData(element, "select");
            if (fieldData) foundFields.push(fieldData);
          });
        };

        const extractFieldData = (
          element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
          baseType: string
        ) => {
          let label = "";
          let selector = "";

          if (element.getAttribute("aria-label")) {
            label = element.getAttribute("aria-label")!;
          } else if (element.id) {
            const labelElement = document.querySelector(
              `label[for="${element.id}"]`
            );
            if (labelElement) {
              label = labelElement.textContent?.trim() || "";
            }
          } else {
            const parentLabel = element.closest("label");
            if (parentLabel) {
              const inputValue = (element as HTMLInputElement).value || "";
              label =
                parentLabel.textContent?.replace(inputValue, "").trim() || "";
            }
          }
          if (!label && element.getAttribute("placeholder")) {
            label = element.getAttribute("placeholder")!;
          }
          if (!label && element.getAttribute("name")) {
            label = element.getAttribute("name")!.replace(/[-_]/g, " ");
          }
          const selectors: string[] = [];
          const nameAttr = element.getAttribute("name");
          if (nameAttr) selectors.push(`[name="${nameAttr}"]`);
          if (element.id && !element.id.includes("mantine-"))
            selectors.push(`#${element.id}`);

          const dataTestId = element.getAttribute("data-testid");
          if (dataTestId) selectors.push(`[data-testid="${dataTestId}"]`);

          const dataTest = element.getAttribute("data-test");
          if (dataTest) selectors.push(`[data-test="${dataTest}"]`);

          if (element.getAttribute("aria-label")) {
            selectors.push(
              `[aria-label="${element.getAttribute("aria-label")}"]`
            );
          }

          selector =
            selectors[0] ||
            `${baseType}:nth-of-type(${Array.from(document.querySelectorAll(baseType)).indexOf(element) + 1})`;

          if (!label || !selector) return null;

          let type: string = baseType;
          if (baseType === "input") {
            const inputType = (element as HTMLInputElement).type.toLowerCase();
            switch (inputType) {
              case "email":
                type = "email";
                break;
              case "tel":
                type = "tel";
                break;
              case "number":
                type = "number";
                break;
              case "date":
                type = "date";
                break;
              case "checkbox":
                type = "checkbox";
                break;
              case "radio":
                type = "radio";
                break;
              default:
                type = "input";
                break;
            }
          }

          const isRequired =
            element.hasAttribute("required") ||
            element.getAttribute("aria-required") === "true" ||
            label.includes("*");

          const placeholder = element.getAttribute("placeholder") || "";

          return {
            label,
            selector,
            alternativeSelectors: selectors,
            type: type as
              | "input"
              | "textarea"
              | "select"
              | "checkbox"
              | "radio"
              | "date"
              | "email"
              | "number"
              | "tel",
            required: isRequired,
            placeholder,
          };
        };

        processInputs();
        processTextareas();
        processSelects();

        return foundFields;
      });

      const formFields = fields.map((field) => {
        const entity = new FormFieldEntity(
          field.label,
          field.selector,
          field.type,
          field.required,
          field.placeholder
        );
        (entity as any).alternativeSelectors = field.alternativeSelectors;
        return entity;
      });

      this.logger.info(`Extracted ${formFields.length} form fields`);
      return formFields;
    } catch (error) {
      this.logger.error("Failed to extract form fields:", error);
      throw error;
    }
  }

  async fillField(selector: string, value: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      const element = await this.page.$(selector);
      if (!element) {
        this.logger.warn(`Element not found: ${selector}`);
        return;
      }

      const tagName = await element.evaluate((el) => el.tagName.toLowerCase());

      if (tagName === "select") {
        await this.page.select(selector, value);
      } else {
        await element.click({ clickCount: 3 });
        await element.type(value, { delay: 50 });
      }

      this.logger.info(`Filled field ${selector} with value: ${value}`);
    } catch (error) {
      this.logger.error(`Failed to fill field ${selector}:`, error);
      throw error;
    }
  }

  async submitForm(): Promise<FormSubmissionResult> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      const submitButton = await this.page.$(
        "button[type=submit], input[type=submit]"
      );

      if (submitButton) {
        await submitButton.click();
        this.logger.info("Form submitted via submit button");
      } else {
        await this.page.evaluate(() => {
          const form = document.querySelector("form") as HTMLFormElement;
          if (form) form.submit();
        });
        this.logger.info("Form submitted via form.submit()");
      }

      await this.delay(2000);

      return {
        success: true,
        message: "Form submitted successfully",
        url: this.page.url(),
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error("Failed to submit form:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.logger.info("Browser closed");
    }
  }

  setPage(page: Page): void {
    this.page = page;
  }

  getPage(): Page | undefined {
    return this.page ?? undefined;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}