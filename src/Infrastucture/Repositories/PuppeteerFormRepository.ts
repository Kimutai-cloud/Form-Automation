import puppeteer, { Browser, Page } from "puppeteer";
import { IFormRepository } from "../../Domain/Repositories/IFormRepository";
import { FormFieldEntity } from "../../Domain/Entities/FormField";
import { FormSubmissionResult } from "../../Domain/Entities/FormSubmission";
import { Logger } from "../logging/Logger";

/**
 * Puppeteer-based implementation of the IFormRepository interface.
 * This class handles browser automation tasks such as navigating to pages,
 * extracting form fields, filling fields, and submitting forms.
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
      await this.page.goto(url, { waitUntil: "networkidle2", timeout });
      this.logger.info(`Successfully navigated to: ${url}`);
    } catch (error) {
      this.logger.error(`Failed to navigate to ${url}:`, error);
      throw error;
    }
  }

  async extractFormFields(): Promise<FormFieldEntity[]> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      await this.revealHiddenFields();

      await this.delay(1000);

      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        window.scrollTo(0, 0);

        const allFormElements = document.querySelectorAll(
          'input, select, textarea, [role="combobox"], [role="listbox"]'
        );
        allFormElements.forEach((el, index) => {
          setTimeout(() => {
            try {
              (el as HTMLElement).focus();
              (el as HTMLElement).blur();
            } catch (e) {
            }
          }, index * 10);
        });
      });

      await this.delay(1000);

      this.page.on("console", (msg) => {
        if (msg.text().startsWith("DEBUG:")) {
          this.logger.info(`Page Debug: ${msg.text()}`);
        }
      });

      const fields = await this.page.evaluate(() => {
        const foundFields: any[] = [];
        const processedElements = new Set<Element>();

        const getElementType = (element: Element): string => {
          const tagName = element.tagName.toLowerCase();

          const typeAttr = element.getAttribute("type");

          const dataType = element.getAttribute("data-type");

          const classList = element.className;

          const role = element.getAttribute("role");

          console.log(
            `DEBUG: Element analysis - tag: ${tagName}, type: ${typeAttr}, dataType: ${dataType}, classes: ${classList}, role: ${role}`
          );

          if (tagName === "select") {
            return "select";
          }

          if (tagName === "textarea") {
            return "textarea";
          }

          if (tagName === "input") {
            if (typeAttr) {
              return typeAttr;
            }

            if (dataType) {
              return dataType;
            }

            if (classList) {
              if (classList.includes("password")) return "password";
              if (classList.includes("email")) return "email";
              if (classList.includes("number")) return "number";
              if (classList.includes("date")) return "date";
              if (classList.includes("tel") || classList.includes("phone"))
                return "tel";
              if (classList.includes("url")) return "url";
              if (classList.includes("search")) return "search";
            }

            const inputMode = element.getAttribute("inputmode");
            if (inputMode) {
              switch (inputMode) {
                case "email":
                  return "email";
                case "tel":
                  return "tel";
                case "numeric":
                  return "number";
                case "url":
                  return "url";
                case "search":
                  return "search";
              }
            }

            const placeholder = element
              .getAttribute("placeholder")
              ?.toLowerCase();

            if (placeholder) {
              if (placeholder.includes("password")) return "password";
              if (placeholder.includes("email")) return "email";
              if (placeholder.includes("phone") || placeholder.includes("tel"))
                return "tel";
              if (
                placeholder.includes("url") ||
                placeholder.includes("website")
              )
                return "url";
            }
            return "text";
          }

          if (
            role &&
            (tagName === "input" ||
              tagName === "select" ||
              tagName === "textarea" ||
              element.hasAttribute("contenteditable") ||
              element.hasAttribute("tabindex"))
          ) {
            switch (role) {
              case "combobox":
                return "select";
              case "listbox":
                return "select";
              case "textbox":
                return "text";
              case "searchbox":
                return "search";
            }
          }

          if (classList && (tagName === "div" || tagName === "span")) {
            const hasFormRole =
              element.hasAttribute("role") &&
              ["combobox", "listbox", "textbox", "searchbox"].includes(
                role || ""
              );
            const hasFormAttributes =
              element.hasAttribute("tabindex") ||
              element.hasAttribute("contenteditable");
            const hasFormClasses =
              classList.includes("mantine-Input") ||
              classList.includes("mantine-Select") ||
              classList.includes("mantine-Textarea") ||
              classList.includes("form-control");

            if (hasFormRole || hasFormAttributes || hasFormClasses) {
              if (
                classList.includes("mantine-Select") ||
                classList.includes("select")
              )
                return "select";
              if (
                classList.includes("mantine-Textarea") ||
                classList.includes("textarea")
              )
                return "textarea";
              if (
                classList.includes("mantine-PasswordInput") ||
                classList.includes("password")
              )
                return "password";
              if (
                classList.includes("mantine-NumberInput") ||
                classList.includes("number")
              )
                return "number";
              if (
                classList.includes("mantine-DateInput") ||
                classList.includes("date")
              )
                return "date";
              if (
                classList.includes("mantine-Checkbox") ||
                classList.includes("checkbox")
              )
                return "checkbox";
              if (
                classList.includes("mantine-Radio") ||
                classList.includes("radio")
              )
                return "radio";
              return "text"; 
            }
          }

          return "";
        };

        const isFormControl = (element: Element): boolean => {
          const tagName = element.tagName.toLowerCase();

          if (["input", "select", "textarea"].includes(tagName)) {
            if (tagName === "input") {
              const type = element.getAttribute("type");
              if (
                ["hidden", "submit", "button", "reset"].includes(type || "")
              ) {
                return false;
              }
            }
            return true;
          }

          const role = element.getAttribute("role");
          if (
            role &&
            ["combobox", "listbox", "textbox", "searchbox"].includes(role)
          ) {
            return true;
          }

          const classList = element.className;
          if (classList && (tagName === "div" || tagName === "span")) {
            const hasFormRole =
              element.hasAttribute("role") &&
              ["combobox", "listbox", "textbox", "searchbox"].includes(
                role || ""
              );
            const hasFormAttributes =
              element.hasAttribute("tabindex") ||
              element.hasAttribute("contenteditable");
            const hasSpecificFormClasses =
              classList.includes("mantine-Input") ||
              classList.includes("mantine-Select") ||
              classList.includes("mantine-Textarea") ||
              classList.includes("form-control");

            return hasFormRole || hasFormAttributes || hasSpecificFormClasses;
          }

          return false;
        };

        const findLabel = (element: Element): string => {
          const id = element.getAttribute("id");
          if (id) {
            const labelByFor = document.querySelector(`label[for="${id}"]`);
            if (labelByFor) {
              return labelByFor.textContent?.trim() || "";
            }
          }

          const parentLabel = element.closest("label");
          if (parentLabel) {
            const clone = parentLabel.cloneNode(true) as HTMLElement;
            const inputsInLabel = clone.querySelectorAll(
              "input, select, textarea"
            );
            inputsInLabel.forEach((input) => input.remove());
            return clone.textContent?.trim() || "";
          }

          const allLabels = Array.from(document.querySelectorAll("label"));
          const elementRect = element.getBoundingClientRect();

          let closestLabel: HTMLLabelElement | null = null;
          let closestDistance = Infinity;

          for (const label of allLabels) {
            const labelRect = label.getBoundingClientRect();
            const distance = Math.sqrt(
              Math.pow(labelRect.left - elementRect.left, 2) +
                Math.pow(labelRect.top - elementRect.top, 2)
            );

            const isAbove = labelRect.bottom <= elementRect.top + 20;
            const isLeft = labelRect.right <= elementRect.left + 20;
            const isVerticallyAligned =
              Math.abs(labelRect.top - elementRect.top) < 50;
            const isHorizontallyAligned =
              Math.abs(labelRect.left - elementRect.left) < 200;

            if (
              (isAbove && isHorizontallyAligned) ||
              (isLeft && isVerticallyAligned)
            ) {
              if (distance < closestDistance) {
                closestDistance = distance;
                closestLabel = label;
              }
            }
          }

          if (closestLabel) {
            return closestLabel.textContent?.trim() || "";
          }

          const ariaLabel = element.getAttribute("aria-label");
          if (ariaLabel) {
            return ariaLabel.trim();
          }

          const ariaLabelledBy = element.getAttribute("aria-labelledby");
          if (ariaLabelledBy) {
            const labelElement = document.getElementById(ariaLabelledBy);
            if (labelElement) {
              return labelElement.textContent?.trim() || "";
            }
          }

          const placeholder = element.getAttribute("placeholder");
          if (placeholder) {
            return placeholder.trim();
          }

          const title = element.getAttribute("title");
          if (title) {
            return title.trim();
          }

          const name =
            element.getAttribute("name") || element.getAttribute("id");
          if (name) {
            return name
              .replace(/[-_]/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase());
          }

          return "";
        };

        const potentialElements = Array.from(
          document.querySelectorAll(`
        input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]),
        textarea,
        select,
        [role="combobox"],
        [role="listbox"],
        [role="textbox"],
        [role="searchbox"]
      `)
        );

        const customFormControls = Array.from(
          document.querySelectorAll(`
        [class*="mantine-Input"],
        [class*="mantine-Select"],
        [class*="mantine-Textarea"],
        [class*="mantine-PasswordInput"],
        [class*="mantine-NumberInput"],
        [class*="mantine-DateInput"],
        [class*="mantine-Checkbox"],
        [class*="mantine-Radio"]
      `)
        ).filter((el) => isFormControl(el));

        const allElements = [...potentialElements, ...customFormControls];

        console.log(
          `DEBUG: Found ${allElements.length} potential form elements`
        );

        allElements.forEach((element, index) => {
          if (processedElements.has(element)) {
            console.log(`DEBUG: Skipping already processed element ${index}`);
            return;
          }

          if (!isFormControl(element)) {
            console.log(
              `DEBUG: Skipping non-form-control element ${index}: ${element.tagName}`
            );
            return;
          }

          const tagName = element.tagName.toLowerCase();
          const fieldType = getElementType(element);

          if (!fieldType) {
            console.log(
              `DEBUG: Skipping element with no valid type: ${tagName}`
            );
            return;
          }

          const name =
            element.getAttribute("name") ||
            element.getAttribute("id") ||
            `element-${index}`;

          console.log(
            `DEBUG: Processing element ${index}: ${tagName}, detected type: ${fieldType}, name: ${name}`
          );

          const label = findLabel(element);

          let selector = "";
          if (element.getAttribute("name")) {
            selector = `[name="${element.getAttribute("name")}"]`;
          } else if (element.getAttribute("id")) {
            selector = `#${element.getAttribute("id")}`;
          } else {
            const classList = element.className;
            if (classList) {
              const classes = classList.split(" ").filter((c) => c.trim());
              if (classes.length > 0) {
                selector = `.${classes[0]}`;
              }
            }

            if (!selector) {
              selector = `${tagName}:nth-of-type(${Array.from(document.querySelectorAll(tagName)).indexOf(element) + 1})`;
            }
          }

          console.log(
            `DEBUG: Created selector: ${selector} for element with label: ${label}`
          );

          const fieldData: any = {
            label:
              label ||
              `${fieldType.charAt(0).toUpperCase() + fieldType.slice(1)} Field`,
            selector: selector,
            type: fieldType,
            required:
              (element as HTMLInputElement).required ||
              element.getAttribute("aria-required") === "true",
            options: [],
            placeholder: (element as HTMLInputElement).placeholder || "",
          };

          if (fieldType === "select" && tagName === "select") {
            const selectElement = element as HTMLSelectElement;
            fieldData.options = Array.from(selectElement.options)
              .filter((option) => option.value !== "")
              .map((option) => option.text || option.value);
            console.log(
              `DEBUG: Select options for ${label}:`,
              fieldData.options
            );
          }

          if (fieldType === "radio") {
            const radioName = element.getAttribute("name");
            if (radioName) {
              const existingRadioField = foundFields.find(
                (f) =>
                  f.type === "radio" &&
                  f.selector.includes(`[name="${radioName}"]`)
              );
              if (existingRadioField) {
                console.log(
                  `DEBUG: Radio group ${radioName} already processed, skipping`
                );
                processedElements.add(element);
                return;
              }

              const radioGroup = Array.from(
                document.querySelectorAll(
                  `input[type="radio"][name="${radioName}"]`
                )
              );
              fieldData.options = radioGroup.map((radio) => {
                const radioLabel = findLabel(radio);
                return (
                  radioLabel || (radio as HTMLInputElement).value || "Option"
                );
              });

              radioGroup.forEach((radio) => processedElements.add(radio));
            }
          }
          if (fieldType === "checkbox") {
            const checkboxName = element.getAttribute("name");
            if (checkboxName) {
              const existingCheckboxField = foundFields.find(
                (f) =>
                  f.type === "checkbox" &&
                  f.selector.includes(`[name="${checkboxName}"]`)
              );
              if (existingCheckboxField) {
                console.log(
                  `DEBUG: Checkbox group ${checkboxName} already processed, skipping`
                );
                processedElements.add(element);
                return;
              }

              const checkboxGroup = Array.from(
                document.querySelectorAll(
                  `input[type="checkbox"][name="${checkboxName}"]`
                )
              );
              if (checkboxGroup.length > 1) {
                fieldData.options = checkboxGroup.map((checkbox) => {
                  const checkboxLabel = findLabel(checkbox);
                  return (
                    checkboxLabel ||
                    (checkbox as HTMLInputElement).value ||
                    "Option"
                  );
                });

                checkboxGroup.forEach((checkbox) =>
                  processedElements.add(checkbox)
                );
              }
            }
          }

          foundFields.push(fieldData);
          processedElements.add(element);

          console.log(
            `DEBUG: Added field: ${fieldData.label} (${fieldData.type}) with selector: ${fieldData.selector}`
          );
        });

        console.log(`DEBUG: Total fields found: ${foundFields.length}`);

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
        (entity as any).options = field.options;
        return entity;
      });

      this.logger.info(`Extracted ${formFields.length} form fields`);
      formFields.forEach((field) => {
        this.logger.info(
          `Field: ${field.label} (${field.type}) - Selector: ${field.selector}`
        );
      });

      return formFields;
    } catch (error) {
      this.logger.error("Failed to extract form fields:", error);
      throw error;
    }
  }

  async fillField(selector: string, value: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });

      const elementInfo = await this.page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) return null;

        return {
          tagName: element.tagName.toLowerCase(),
          type: element.getAttribute("type"),
          name: element.getAttribute("name"),
          id: element.getAttribute("id"),
        };
      }, selector);

      if (!elementInfo) {
        this.logger.warn(`Element not found: ${selector}`);
        return;
      }

      const { tagName, type } = elementInfo;
      this.logger.info(
        `Filling field: ${selector} (${tagName}:${type}) with value: ${value}`
      );

      if (tagName === "select") {
        const options = await this.page.evaluate((sel) => {
          const selectElement = document.querySelector(
            sel
          ) as HTMLSelectElement;
          if (!selectElement) return [];

          return Array.from(selectElement.options).map((opt) => ({
            value: opt.value,
            text: opt.textContent?.trim() || "",
          }));
        }, selector);

        let optionFound = false;
        for (const option of options) {
          if (
            option.value === value ||
            option.text.toLowerCase().includes(value.toLowerCase())
          ) {
            await this.page.select(selector, option.value);
            optionFound = true;
            this.logger.info(
              `Selected option: ${option.text} (value: ${option.value})`
            );
            break;
          }
        }

        if (!optionFound) {
          this.logger.warn(
            `Option not found in select for value: ${value}. Available options: ${options.map((o) => o.text).join(", ")}`
          );
        }
      } else if (type === "radio") {
        const radioElements = await this.page.$$(selector);
        let filled = false;

        for (const radio of radioElements) {
          const radioValue = await radio.evaluate(
            (el) => (el as HTMLInputElement).value
          );
          const radioLabel = await radio.evaluate((el) => {
            const label =
              document.querySelector(`label[for="${el.id}"]`) ||
              el.closest("label");
            return label?.textContent?.trim() || "";
          });

          if (
            radioValue === value ||
            radioLabel?.toLowerCase().includes(value.toLowerCase())
          ) {
            await radio.click();
            filled = true;
            this.logger.info(
              `Selected radio option: ${radioLabel || radioValue}`
            );
            break;
          }
        }

        if (!filled) {
          this.logger.warn(`Radio option not found for value: ${value}`);
        }
      } else if (type === "checkbox") {
        const checkboxElements = await this.page.$$(selector);

        for (const checkbox of checkboxElements) {
          const checkboxValue = await checkbox.evaluate(
            (el) => (el as HTMLInputElement).value
          );
          const checkboxLabel = await checkbox.evaluate((el) => {
            const label =
              document.querySelector(`label[for="${el.id}"]`) ||
              el.closest("label");
            return label?.textContent?.trim() || "";
          });

          if (
            checkboxValue === value ||
            checkboxLabel?.toLowerCase().includes(value.toLowerCase())
          ) {
            const isChecked = await checkbox.evaluate(
              (el) => (el as HTMLInputElement).checked
            );
            if (!isChecked) {
              await checkbox.click();
              this.logger.info(
                `Checked checkbox: ${checkboxLabel || checkboxValue}`
              );
            }
            break;
          }
        }
      } else {
        const element = await this.page.$(selector);
        if (element) {
          await element.click({ clickCount: 3 }); 
          await element.type(value, { delay: 50 });
        }
      }

      this.logger.info(
        `Successfully filled field ${selector} with value: ${value}`
      );
    } catch (error) {
      this.logger.error(`Failed to fill field ${selector}:`, error);
      throw error;
    }
  }

  private async revealHiddenFields(): Promise<void> {
    try {
      await this.page?.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        window.scrollTo(0, 0);
      });
      await this.delay(500);

      await this.page?.evaluate(() => {
        const formElements = document.querySelectorAll(
          'input:not([type="hidden"]), select, textarea, [role="combobox"]'
        );
        formElements.forEach((el: Element) => {
          try {
            (el as HTMLElement).focus();
          } catch (e) {}
        });
      });
      await this.delay(300);
    } catch (error) {
      this.logger.warn("Could not reveal hidden fields:", error);
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
