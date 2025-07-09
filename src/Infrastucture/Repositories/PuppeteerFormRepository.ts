import puppeteer, { Browser, Page } from 'puppeteer';
import { IFormRepository } from '../../Domain/Repositories/IFormRepository';
import { FormFieldEntity } from '../../Domain/Entities/FormField';
import { FormSubmissionResult } from '../../Domain/Entities/FormSubmission';
import { Logger } from '../logging/Logger';
import { resolve } from 'path';

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
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: 1280, height: 720 }
      });
      
      this.page = await this.browser.newPage();
      
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      this.logger.info('Browser initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  async navigateToPage(url: string, timeout: number = 30000): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    
    try {
      await this.page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout 
      });
      this.logger.info(`Successfully navigated to: ${url}`);
    } catch (error) {
      this.logger.error(`Failed to navigate to ${url}:`, error);
      throw error;
    }
  }

  async extractFormFields(): Promise<FormFieldEntity[]> {
    if (!this.page) throw new Error('Browser not initialized');

    try {
      const fields = await this.page.$$eval('label',(labels: HTMLLabelElement[]) => {
        return labels
          .filter(label => label.offsetParent !== null)
          .map(label => {
            const forAttr = label.getAttribute('for');
            let selector = '';
            let associatedElement: HTMLElement | null = null;

            if (forAttr) {
              selector = `#${forAttr}`;
              associatedElement = document.getElementById(forAttr);
            } else {
              const child = label.querySelector('input, textarea, select') as HTMLElement;
              if (child?.id) {
                selector = `#${child.id}`;
                associatedElement = child;
              }
            }

            if (!associatedElement) return null;

            const tagName = associatedElement.tagName.toLowerCase();
            const isRequired = associatedElement.hasAttribute('required');
            const placeholder = associatedElement.getAttribute('placeholder') || '';

            return {
              label: label.innerText.trim(),
              selector,
              type: tagName as 'input' | 'textarea' | 'select',
              required: isRequired,
              placeholder
            };
          })
          .filter((field): field is any => field !== null && field.selector !== '');
      });

      const formFields = fields.map(field => 
        new FormFieldEntity(field.label, field.selector, field.type, field.required, field.placeholder)
      );

      this.logger.info(`Extracted ${formFields.length} form fields`);
      return formFields;
    } catch (error) {
      this.logger.error('Failed to extract form fields:', error);
      throw error;
    }
  }

  async fillField(selector: string, value: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    try {
      const element = await this.page.$(selector);
      if (!element) {
        this.logger.warn(`Element not found: ${selector}`);
        return;
      }

      const tagName = await element.evaluate(el => el.tagName.toLowerCase());
      
      if (tagName === 'select') {
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
    if (!this.page) throw new Error('Browser not initialized');

    try {
      const submitButton = await this.page.$('button[type=submit], input[type=submit]');
      
      if (submitButton) {
        await submitButton.click();
        this.logger.info('Form submitted via submit button');
      } else {
        await this.page.evaluate(() => {
          const form = document.querySelector('form') as HTMLFormElement;
          if (form) form.submit();
        });
        this.logger.info('Form submitted via form.submit()');
      }

      // Wait for navigation or response
      await new Promise(resolve => setTimeout(resolve, 2000));
      //await Promise.all([
            //this.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
            //submitButton.click()
            //]);

      
      return {
        success: true,
        message: 'Form submitted successfully',
        url: this.page.url(),
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error('Failed to submit form:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.logger.info('Browser closed');
    }
  }
}