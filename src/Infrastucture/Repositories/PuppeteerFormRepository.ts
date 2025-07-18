import puppeteer, { Browser, Page } from 'puppeteer';
import { IFormRepository } from '../../Domain/Repositories/IFormRepository';
import { FormFieldEntity } from '../../Domain/Entities/FormField';
import { FormSubmissionResult } from '../../Domain/Entities/FormSubmission';
import { Logger } from '../logging/Logger';

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
      await this.revealHiddenFields();

      const fields = await this.page.evaluate(() => {
        const foundFields: any[] = [];
        const processedSelectors = new Set<string>();
        const processedRadioGroups = new Set<string>();

        const isDropdownElement = (element: Element): boolean => {
          if (element.tagName.toLowerCase() === 'select') return true;
          
          const classes = element.className || '';
          const role = element.getAttribute('role') || '';
          const ariaExpanded = element.getAttribute('aria-expanded');
          const ariaHaspopup = element.getAttribute('aria-haspopup');
          
          return (
            classes.includes('select') ||
            classes.includes('dropdown') ||
            classes.includes('mantine-Select') ||
            role === 'combobox' ||
            role === 'listbox' ||
            ariaExpanded !== null ||
            ariaHaspopup === 'listbox'
          );
        };
        const getDropdownOptionsFromElement = (element: Element): string[] => {
          const options: string[] = [];
          
          if (element.tagName.toLowerCase() === 'select') {
            const selectEl = element as HTMLSelectElement;
            Array.from(selectEl.options).forEach(opt => {
              if (opt.value && opt.text) {
                options.push(opt.text.trim());
              }
            });
          }
          
          return options;
        };

        const extractFieldData = (
          element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
          baseType: string
        ) => {
          const uniqueKey = element.id || element.name || `${element.tagName}-${element.className}`;
          if (processedSelectors.has(uniqueKey)) return null;
          processedSelectors.add(uniqueKey);

          let label = "";
          let selector = "";

          if (element.getAttribute("aria-label")) {
            label = element.getAttribute("aria-label")!;
          } else if (element.id) {
            const labelElement = document.querySelector(`label[for="${element.id}"]`);
            if (labelElement) {
              label = labelElement.textContent?.trim() || "";
            }
          }

          if (!label) {
            const parentLabel = element.closest("label");
            if (parentLabel) {
              label = parentLabel.textContent?.trim() || "";
              if (element.value) {
                label = label.replace(element.value, "").trim();
              }
            }
          }

          if (!label) {
            const parent = element.parentElement;
            if (parent) {
              let prevSibling = element.previousElementSibling;
              while (prevSibling && !label) {
                if (prevSibling.tagName === 'LABEL' || prevSibling.tagName === 'SPAN' || prevSibling.tagName === 'DIV') {
                  const text = prevSibling.textContent?.trim() || "";
                  if (text && text.length < 100 && !text.includes('\n')) {
                    label = text;
                    break;
                  }
                }
                prevSibling = prevSibling.previousElementSibling;
              }

              if (!label && parent.previousElementSibling) {
                const parentPrev = parent.previousElementSibling;
                if (parentPrev.textContent) {
                  const text = parentPrev.textContent.trim();
                  if (text && text.length < 100) {
                    label = text;
                  }
                }
              }
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
          if (element.id) selectors.push(`#${element.id}`);

          const dataTestId = element.getAttribute("data-testid");
          if (dataTestId) selectors.push(`[data-testid="${dataTestId}"]`);

          selector = selectors[0] || 
            `${baseType}:nth-of-type(${Array.from(document.querySelectorAll(baseType)).indexOf(element) + 1})`;

          if (!label || !selector) return null;

          let type: string = baseType;
          let options: string[] = [];
          
          if (isDropdownElement(element)) {
            type = "select";
            options = getDropdownOptionsFromElement(element);
          } else if (baseType === "input") {
            const inputType = (element as HTMLInputElement).type.toLowerCase();
            switch (inputType) {
              case "email": type = "email"; break;
              case "tel": type = "tel"; break;
              case "number": type = "number"; break;
              case "date": type = "date"; break;
              case "checkbox": type = "checkbox"; break;
              case "radio": type = "radio"; break;
              default: type = "input"; break;
            }
          }

          const isRequired = element.hasAttribute("required") || 
                           element.getAttribute("aria-required") === "true" || 
                           label.includes("*");

          return {
            label,
            selector,
            alternativeSelectors: selectors,
            type: type as any,
            required: isRequired,
            placeholder: element.getAttribute("placeholder") || "",
            options: options.length > 0 ? options : undefined,
          };
        };

        const allInputs = document.querySelectorAll("input, textarea, select, [role='combobox'], [role='listbox']");

        allInputs.forEach((element: Element) => {
          const el = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          
          if (el.type === "hidden" || 
              (el.style.display === "none" && !isDropdownElement(el))) {
            return;
          }

          const tagName = el.tagName.toLowerCase();
          const fieldData = extractFieldData(el, tagName === 'select' ? 'select' : tagName);
          if (fieldData) foundFields.push(fieldData);
        });

        const radioButtons = document.querySelectorAll('input[type="radio"]');
        const radioGroups = new Map<string, any>();

        radioButtons.forEach((radio: Element) => {
          const radioEl = radio as HTMLInputElement;
          const groupName = radioEl.name;
          
          if (!groupName || processedRadioGroups.has(groupName)) return;
          
          if (!radioGroups.has(groupName)) {
            let groupLabel = "";
            const container = radioEl.closest('.form-group, .field, fieldset, div');
            
            if (container) {
              const legend = container.querySelector('legend');
              if (legend) {
                groupLabel = legend.textContent?.trim() || "";
              }
              
              if (!groupLabel) {
                const heading = container.querySelector('label:not([for]), h3, h4, span.label');
                if (heading) {
                  groupLabel = heading.textContent?.trim() || "";
                }
              }
              
              if (!groupLabel && container.previousElementSibling) {
                const prev = container.previousElementSibling;
                if (prev.textContent && prev.textContent.trim().length < 100) {
                  groupLabel = prev.textContent.trim();
                }
              }
            }
            
            if (!groupLabel) {
              groupLabel = groupName.replace(/[-_]/g, " ");
            }
            
            radioGroups.set(groupName, {
              label: groupLabel,
              selector: `[name="${groupName}"]`,
              type: "radio",
              required: radioEl.hasAttribute("required"),
              options: [],
              name: groupName
            });
          }
          const optionLabel = radioEl.parentElement?.textContent?.trim() || 
                            radioEl.value || 
                            radioEl.id || "";
          
          if (optionLabel) {
            radioGroups.get(groupName)!.options.push(optionLabel);
          }
        });

        radioGroups.forEach((group, name) => {
          if (!processedRadioGroups.has(name) && group.options.length > 0) {
            processedRadioGroups.add(name);
            foundFields.push(group);
          }
        });

        const customDropdowns = document.querySelectorAll('.mantine-Select-root, .mantine-MultiSelect-root');
        customDropdowns.forEach((dropdownRoot: Element) => {
          const input = dropdownRoot.querySelector('input');
          const label = dropdownRoot.querySelector('label')?.textContent?.trim() || "";
          
          if (input && label && !processedSelectors.has(input.id || label)) {
            foundFields.push({
              label,
              selector: input.id ? `#${input.id}` : `input[placeholder="${input.placeholder}"]`,
              alternativeSelectors: [],
              type: "select",
              required: label.includes("*"),
              placeholder: input.getAttribute("placeholder") || "",
              options: [] 
            });
          }
        });

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
        (entity as any).options = field.options;
        return entity;
      });

      this.logger.info(`Extracted ${formFields.length} form fields`);
      return formFields;
    } catch (error) {
      this.logger.error("Failed to extract form fields:", error);
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
        const formElements = document.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"]');
        formElements.forEach((el: Element) => {
          try {
            (el as HTMLElement).focus();
          } catch (e) {
          }
        });
      });
      await this.delay(300);

    } catch (error) {
      this.logger.warn("Could not reveal hidden fields:", error);
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