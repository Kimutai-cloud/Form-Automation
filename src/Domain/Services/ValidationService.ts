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

        await new Promise(resolve => setTimeout(resolve, 500));

        const errorSelectors = [
            '[aria-invalid="true"]',
            '.error',
            '.invalid',
            '.field-error',
            '.validation-error',
            '.form-error',
            'input:invalid',
            'select:invalid',
            'textarea:invalid',
            'input[style*="border-color: red"]',
            'input[style*="border: red"]',
            '.has-error input',
            '.error input',
            '.mantine-Select-error',
            '.mantine-Input-error'
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
                    fieldType: errorMsg.fieldType || 'unknown',
                    currentValue: ''
                });
            }
        }
        const requiredErrors = await this.checkRequiredFields();
        for (const reqError of requiredErrors) {
            if (!errors.find(e => e.fieldName === reqError.fieldName)) {
                errors.push(reqError);
            }
        }

        return this.removeDuplicateErrors(errors);
    }

    private async extractFieldInfo(element: any): Promise<IValidationError | null> {
        try {
            const fieldInfo = await element.evaluate((el: HTMLElement) => {
                const fieldName = el.getAttribute('name') || el.getAttribute('id') || '';
                const fieldType = el.tagName.toLowerCase() === 'input' ? 
                    (el as HTMLInputElement).type : 
                    el.tagName.toLowerCase();
                const currentValue = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value || '';
                
                const isDropdown = el.tagName.toLowerCase() === 'select' || 
                                 el.getAttribute('role') === 'combobox' ||
                                 el.className.includes('select') ||
                                 el.className.includes('dropdown');
                
                return { fieldName, fieldType, currentValue, isDropdown };
            });

            const fieldLabel = await this.getFieldLabel(element);
            const errorMessage = await this.getAssociatedErrorMessage(element);

            if (fieldInfo.fieldName || fieldLabel) {
                let finalErrorMessage = errorMessage;
                
                if (!finalErrorMessage || finalErrorMessage === 'Field validation failed') {
                    if (fieldInfo.isDropdown && !fieldInfo.currentValue) {
                        finalErrorMessage = 'Please select an option from the dropdown';
                    } else if (fieldInfo.isDropdown) {
                        finalErrorMessage = 'Selected option is not valid';
                    } else if (!fieldInfo.currentValue) {
                        finalErrorMessage = 'This field is required';
                    } else {
                        finalErrorMessage = 'Invalid value entered';
                    }
                }

                return {
                    fieldName: fieldInfo.fieldName || fieldLabel,
                    fieldLabel: fieldLabel || fieldInfo.fieldName,
                    errorMessage: finalErrorMessage,
                    fieldType: fieldInfo.fieldType,
                    currentValue: fieldInfo.currentValue
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

                const parent = el.parentElement;
                if (parent) {
                    const labelLike = parent.querySelector('span, div');
                    if (labelLike && labelLike.textContent && labelLike.textContent.trim().length < 100) {
                        return labelLike.textContent.trim();
                    }
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
                        '[role="alert"]',
                        '.mantine-Input-error'
                    ];

                    for (const selector of errorSelectors) {
                        const errorEl = parent.querySelector(selector);
                        if (errorEl) return errorEl.textContent?.trim();
                    }
                }

                if (el.tagName.toLowerCase() === 'input' || 
                    el.tagName.toLowerCase() === 'select' ||
                    el.tagName.toLowerCase() === 'textarea') {
                    const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
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

    private async findErrorMessages(): Promise<Array<{fieldName: string, fieldLabel?: string, message: string, fieldType?: string}>> {
        const messages: Array<{fieldName: string, fieldLabel?: string, message: string, fieldType?: string}> = [];

        try {
            const errorElements = await this.page.$$('.error-message, .validation-error, .field-error, [role="alert"], .mantine-Input-error');
            
            for (const element of errorElements) {
                const messageText = await element.evaluate(el => el.textContent?.trim() || '');
                if (messageText) {
                    const fieldInfo = await this.findAssociatedField(element);
                    if (fieldInfo) {
                        messages.push({
                            fieldName: fieldInfo.name || 'unknown',
                            fieldLabel: fieldInfo.label,
                            message: messageText,
                            fieldType: fieldInfo.type
                        });
                    }
                }
            }
        } catch (error) {
            console.warn('Error finding error messages:', error);
        }

        return messages;
    }

    private async checkRequiredFields(): Promise<IValidationError[]> {
        const errors: IValidationError[] = [];

        try {
            const requiredFields = await this.page.evaluate(() => {
                const fields: any[] = [];
                
                const requiredElements = document.querySelectorAll('[required], [aria-required="true"]');
                requiredElements.forEach((el: Element) => {
                    const element = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
                    const value = element.value || '';
                    
                    if (!value.trim()) {
                        let label = '';
                        
                        const id = element.getAttribute('id');
                        if (id) {
                            const labelEl = document.querySelector(`label[for="${id}"]`);
                            if (labelEl) label = labelEl.textContent?.trim() || '';
                        }
                        
                        if (!label) {
                            label = element.getAttribute('aria-label') || 
                                   element.getAttribute('placeholder') ||
                                   element.getAttribute('name') || '';
                        }
                        
                        const isDropdown = element.tagName.toLowerCase() === 'select' ||
                                         element.getAttribute('role') === 'combobox';
                        
                        fields.push({
                            name: element.getAttribute('name') || element.getAttribute('id') || '',
                            label: label,
                            type: element.tagName.toLowerCase(),
                            isDropdown: isDropdown
                        });
                    }
                });
                
                return fields;
            });

            for (const field of requiredFields) {
                errors.push({
                    fieldName: field.name,
                    fieldLabel: field.label || field.name,
                    errorMessage: field.isDropdown ? 
                        'Please select an option from the dropdown' : 
                        'This field is required',
                    fieldType: field.type,
                    currentValue: ''
                });
            }
        } catch (error) {
            console.warn('Error checking required fields:', error);
        }

        return errors;
    }

    private async findAssociatedField(errorElement: any): Promise<{name: string, label?: string, type?: string} | null> {
        try {
            return await errorElement.evaluate((el: HTMLElement) => {
                const container = el.closest('.form-group, .field, .form-field, .input-group, .mantine-Input-wrapper');
                if (container) {
                    const input = container.querySelector('input, textarea, select');
                    if (input) {
                        const name = input.getAttribute('name') || input.getAttribute('id');
                        const label = container.querySelector('label')?.textContent?.trim();
                        const type = input.tagName.toLowerCase();
                        return { name: name || '', label, type };
                    }
                }

                const parent = el.parentElement;
                if (parent) {
                    const input = parent.querySelector('input, textarea, select');
                    if (input) {
                        const name = input.getAttribute('name') || input.getAttribute('id');
                        const type = input.tagName.toLowerCase();
                        return { name: name || '', type };
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

            const successIndicators = await this.page.$$('.success, .success-message, .submitted, [role="status"], .thank-you');
            if (successIndicators.length > 0) {
                return true;
            }

            const currentUrl = this.page.url();
            if (currentUrl.includes('success') || currentUrl.includes('thank') || currentUrl.includes('submitted')) {
                return true;
            }

            const errors = await this.detectValidationErrors();
            
            const formElements = await this.page.$$('form');
            
            return errors.length === 0 && formElements.length === 0;
        } catch (error) {
            console.warn('Error checking form submission status:', error);
            return false;
        }
    }
}