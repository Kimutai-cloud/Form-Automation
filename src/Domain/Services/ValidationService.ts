
import { Page } from 'puppeteer';
import { IValidationError } from '../Repositories/IValidationError';

export class ValidationService {
    private page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    /**
     * Scan the page for validation errors after form submission attempt
     */
    async detectValidationErrors(): Promise<IValidationError[]> {
        const errors: IValidationError[] = [];

        const errorSelectors = [
            '[aria-invalid="true"]',
            '.error',
            '.invalid',
            '.field-error',
            '.validation-error',
            '.form-error',
            'input:invalid',
            'input[style*="border-color: red"]',
            'input[style*="border: red"]',
            '.has-error input',
            '.error input'
        ];

        for (const selector of errorSelectors) {
            try {
                const elements = await this.page.$$(selector);
                
                for (const element of elements) {
                    const fieldInfo = await this.extractFieldInfo(element);
                    if (fieldInfo) {
                        errors.push(fieldInfo);
                    }
                }
            } catch (error) {
                console.warn(`Error checking selector ${selector}:`, error);
            }
        }

        const errorMessages = await this.findErrorMessages();
        for (const errorMsg of errorMessages) {
            const existingError = errors.find(e => e.fieldName === errorMsg.fieldName);
            if (existingError) {
                existingError.errorMessage = errorMsg.message;
            } else {
                errors.push({
                    fieldName: errorMsg.fieldName,
                    fieldLabel: errorMsg.fieldLabel || errorMsg.fieldName,
                    errorMessage: errorMsg.message,
                    fieldType: 'unknown',
                    currentValue: ''
                });
            }
        }

        return this.removeDuplicateErrors(errors);
    }

    private async extractFieldInfo(element: any): Promise<IValidationError | null> {
        try {
            const fieldName = await element.evaluate((el: HTMLElement) => {
                return el.getAttribute('name') || el.getAttribute('id') || '';
            });

            const fieldLabel = await this.getFieldLabel(element);
            const fieldType = await element.evaluate((el: HTMLElement) => {
                return el.tagName.toLowerCase() === 'input' ? 
                    (el as HTMLInputElement).type : 
                    el.tagName.toLowerCase();
            });

            const currentValue = await element.evaluate((el: HTMLElement) => {
                if (el.tagName.toLowerCase() === 'input') {
                    return (el as HTMLInputElement).value;
                } else if (el.tagName.toLowerCase() === 'textarea') {
                    return (el as HTMLTextAreaElement).value;
                } else if (el.tagName.toLowerCase() === 'select') {
                    return (el as HTMLSelectElement).value;
                }
                return '';
            });

            const errorMessage = await this.getAssociatedErrorMessage(element);

            if (fieldName || fieldLabel) {
                return {
                    fieldName: fieldName || fieldLabel,
                    fieldLabel: fieldLabel || fieldName,
                    errorMessage: errorMessage || 'Field validation failed',
                    fieldType,
                    currentValue
                };
            }
        } catch (error) {
            console.warn('Error extracting field info:', error);
        }
        return null;
    }

    private async getFieldLabel(element: any): Promise<string> {
        try {
            const labelText = await element.evaluate((el: HTMLElement) => {
                if (el.getAttribute('aria-label')) {
                    return el.getAttribute('aria-label');
                }

                const id = el.getAttribute('id');
                if (id) {
                    const label = document.querySelector(`label[for="${id}"]`);
                    if (label) return label.textContent?.trim();
                }

                const parentLabel = el.closest('label');
                if (parentLabel) {
                    return parentLabel.textContent?.trim();
                }

                const prevSibling = el.previousElementSibling;
                if (prevSibling && prevSibling.tagName.toLowerCase() === 'label') {
                    return prevSibling.textContent?.trim();
                }

                if (el.getAttribute('placeholder')) {
                    return el.getAttribute('placeholder');
                }

                return '';
            });

            return labelText || '';
        } catch (error) {
            return '';
        }
    }

    private async getAssociatedErrorMessage(element: any): Promise<string> {
        try {
            return await element.evaluate((el: HTMLElement) => {
                const describedBy = el.getAttribute('aria-describedby');
                if (describedBy) {
                    const errorEl = document.getElementById(describedBy);
                    if (errorEl) return errorEl.textContent?.trim();
                }

                const parent = el.parentElement;
                if (parent) {
                    const errorSelectors = [
                        '.error-message',
                        '.validation-error',
                        '.field-error',
                        '.error',
                        '[role="alert"]'
                    ];

                    for (const selector of errorSelectors) {
                        const errorEl = parent.querySelector(selector);
                        if (errorEl) return errorEl.textContent?.trim();
                    }
                }

                if (el.tagName.toLowerCase() === 'input') {
                    const input = el as HTMLInputElement;
                    if (input.validationMessage) {
                        return input.validationMessage;
                    }
                }

                return '';
            });
        } catch (error) {
            return '';
        }
    }

    private async findErrorMessages(): Promise<Array<{fieldName: string, fieldLabel?: string, message: string}>> {
        const messages: Array<{fieldName: string, fieldLabel?: string, message: string}> = [];

        try {
            const errorElements = await this.page.$$('.error-message, .validation-error, .field-error, [role="alert"]');
            
            for (const element of errorElements) {
                const messageText = await element.evaluate(el => el.textContent?.trim() || '');
                if (messageText) {
                    const fieldInfo = await this.findAssociatedField(element);
                    messages.push({
                        fieldName: fieldInfo?.name || 'unknown',
                        fieldLabel: fieldInfo?.label,
                        message: messageText
                    });
                }
            }
        } catch (error) {
            console.warn('Error finding error messages:', error);
        }

        return messages;
    }

    private async findAssociatedField(errorElement: any): Promise<{name: string, label?: string} | null> {
        try {
            return await errorElement.evaluate((el: HTMLElement) => {
                const container = el.closest('.form-group, .field, .form-field, .input-group');
                if (container) {
                    const input = container.querySelector('input, textarea, select');
                    if (input) {
                        const name = input.getAttribute('name') || input.getAttribute('id');
                        const label = container.querySelector('label')?.textContent?.trim();
                        return { name: name || '', label };
                    }
                }

                const parent = el.parentElement;
                if (parent) {
                    const input = parent.querySelector('input, textarea, select');
                    if (input) {
                        const name = input.getAttribute('name') || input.getAttribute('id');
                        return { name: name || '' };
                    }
                }

                return null;
            });
        } catch (error) {
            return null;
        }
    }

    private removeDuplicateErrors(errors: IValidationError[]): IValidationError[] {
        const seen = new Set<string>();
        return errors.filter(error => {
            const key = `${error.fieldName}-${error.fieldLabel}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    /**
     * Check if the form was successfully submitted
     */
    async isFormSubmitted(): Promise<boolean> {
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const successIndicators = await this.page.$$('.success, .success-message, .submitted, [role="status"]');
            if (successIndicators.length > 0) {
                return true;
            }

            const currentUrl = this.page.url();
            if (currentUrl.includes('success') || currentUrl.includes('thank') || currentUrl.includes('submitted')) {
                return true;
            }

            const errors = await this.detectValidationErrors();
            const formElements = await this.page.$$('form');
            
            return errors.length === 0 && formElements.length > 0;
        } catch (error) {
            console.warn('Error checking form submission status:', error);
            return false;
        }
    }
}