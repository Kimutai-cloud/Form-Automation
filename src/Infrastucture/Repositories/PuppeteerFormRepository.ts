import puppeteer, { Browser, Page } from "puppeteer";
import { IFormRepository } from "../../Domain/Repositories/IFormRepository";
import { FormFieldEntity } from "../../Domain/Entities/FormField";
import { FormSubmissionResult } from "../../Domain/Entities/FormSubmission";
import { Logger } from "../logging/Logger";

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

      // Wait for any dynamic content to load
      await this.delay(1000);

      // Try to trigger any lazy-loaded form elements
      await this.page.evaluate(() => {
        // Scroll through the page to trigger any lazy loading
        window.scrollTo(0, document.body.scrollHeight);
        window.scrollTo(0, 0);

        // Try to focus on form elements to trigger dynamic loading
        const allFormElements = document.querySelectorAll(
          'input, select, textarea, [role="combobox"], [role="listbox"]'
        );
        allFormElements.forEach((el, index) => {
          setTimeout(() => {
            try {
              (el as HTMLElement).focus();
              (el as HTMLElement).blur();
            } catch (e) {
              // Silent fail
            }
          }, index * 10);
        });
      });

      // Wait for dynamic content to settle
      await this.delay(1000);

      // Enable console logging from the page
      this.page.on("console", (msg) => {
        if (msg.text().startsWith("DEBUG:")) {
          this.logger.info(`Page Debug: ${msg.text()}`);
        }
      });

      const fields = await this.page.evaluate(() => {
        const foundFields: any[] = [];
        const processedElements = new Set<Element>();

        // Enhanced type detection function
        const getElementType = (element: Element): string => {
          const tagName = element.tagName.toLowerCase();

          // Check for explicit type attribute first
          const typeAttr = element.getAttribute("type");

          // Check for data attributes that might indicate type
          const dataType = element.getAttribute("data-type");

          // Check for class names that might indicate type
          const classList = element.className;

          // Check for ARIA attributes
          const role = element.getAttribute("role");

          console.log(
            `DEBUG: Element analysis - tag: ${tagName}, type: ${typeAttr}, dataType: ${dataType}, classes: ${classList}, role: ${role}`
          );

          // Handle different element types
          if (tagName === "select") {
            return "select";
          }

          if (tagName === "textarea") {
            return "textarea";
          }

          if (tagName === "input") {
            // Enhanced type detection for input elements
            if (typeAttr) {
              return typeAttr;
            }

            // Try to detect type from other attributes
            if (dataType) {
              return dataType;
            }

            // Check for common class patterns
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

            // Check input mode
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

            // Check for patterns that might indicate type
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

            // Default to text for input elements
            return "text";
          }

          // Handle elements with roles - but only if they're actual form controls
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

          // Check for custom form elements (like Mantine components) - but be more specific
          if (classList && (tagName === "div" || tagName === "span")) {
            // Only consider divs/spans that have clear form control indicators
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

        // Helper function to check if element is a form control
        const isFormControl = (element: Element): boolean => {
          const tagName = element.tagName.toLowerCase();

          // Standard form controls
          if (["input", "select", "textarea"].includes(tagName)) {
            // Skip hidden, submit, button, reset inputs
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

          // Custom form controls with proper roles
          const role = element.getAttribute("role");
          if (
            role &&
            ["combobox", "listbox", "textbox", "searchbox"].includes(role)
          ) {
            return true;
          }

          // Mantine or other custom form controls - be very specific
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

        // Helper function to find label for an element
        const findLabel = (element: Element): string => {
          // Method 1: Look for label with matching 'for' attribute
          const id = element.getAttribute("id");
          if (id) {
            const labelByFor = document.querySelector(`label[for="${id}"]`);
            if (labelByFor) {
              return labelByFor.textContent?.trim() || "";
            }
          }

          // Method 2: Check if element is inside a label
          const parentLabel = element.closest("label");
          if (parentLabel) {
            const clone = parentLabel.cloneNode(true) as HTMLElement;
            const inputsInLabel = clone.querySelectorAll(
              "input, select, textarea"
            );
            inputsInLabel.forEach((input) => input.remove());
            return clone.textContent?.trim() || "";
          }

          // Method 3: Look for nearby labels using various strategies
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

          // Method 4: Look for aria-label or aria-labelledby
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

          // Method 5: Look for placeholder or title
          const placeholder = element.getAttribute("placeholder");
          if (placeholder) {
            return placeholder.trim();
          }

          const title = element.getAttribute("title");
          if (title) {
            return title.trim();
          }

          // Method 6: Try to derive from name or id
          const name =
            element.getAttribute("name") || element.getAttribute("id");
          if (name) {
            return name
              .replace(/[-_]/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase());
          }

          return "";
        };

        // FIXED: Only select actual form controls, not labels or wrapper divs
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

        // Also look for custom form controls with specific patterns
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

        // Process each element
        allElements.forEach((element, index) => {
          // Skip if already processed
          if (processedElements.has(element)) {
            console.log(`DEBUG: Skipping already processed element ${index}`);
            return;
          }

          // Check if this is actually a form control
          if (!isFormControl(element)) {
            console.log(
              `DEBUG: Skipping non-form-control element ${index}: ${element.tagName}`
            );
            return;
          }

          const tagName = element.tagName.toLowerCase();
          const fieldType = getElementType(element);

          // Skip if we couldn't determine a valid type
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

          // Create better selector
          let selector = "";
          if (element.getAttribute("name")) {
            selector = `[name="${element.getAttribute("name")}"]`;
          } else if (element.getAttribute("id")) {
            selector = `#${element.getAttribute("id")}`;
          } else {
            // Create a more specific selector for elements without name/id
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

          // Handle select options
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

          // Handle radio button groups
          if (fieldType === "radio") {
            const radioName = element.getAttribute("name");
            if (radioName) {
              // Check if we've already processed this radio group
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

              // Get all radio buttons in this group
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

              // Mark all radio buttons in this group as processed
              radioGroup.forEach((radio) => processedElements.add(radio));
            }
          }

          // Handle checkbox groups
          if (fieldType === "checkbox") {
            const checkboxName = element.getAttribute("name");
            if (checkboxName) {
              // Check if we've already processed this checkbox group
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

              // Get all checkboxes in this group
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

                // Mark all checkboxes in this group as processed
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
      // Try to find the element
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
        // Handle select dropdown
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

        // Try to find option by value first, then by text
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
        // Handle radio buttons - FIXED: Better radio button selection
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
        // Handle checkboxes - FIXED: Better checkbox handling
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
        // Handle text inputs, textareas, etc.
        const element = await this.page.$(selector);
        if (element) {
          await element.click({ clickCount: 3 }); // Select all text
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
