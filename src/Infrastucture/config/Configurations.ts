import { z } from 'zod';
import dotenv from 'dotenv';

/**
 * Configuration class for managing application settings.
 * It validates environment variables using Zod and provides access to configuration values.
 */

dotenv.config();

const ConfigSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OpenAI API key is required'),
  FORM_TIMEOUT: z.string().optional().default('30000'),
  HEADLESS_MODE: z.string().optional().default('false'),
  LOG_LEVEL: z.string().optional().default('info'),
  DEFAULT_FORM_URL: z.string().optional().default('https://www.selenium.dev/selenium/web/web-form.html'),
});

export class Configuration {
  private config: z.infer<typeof ConfigSchema>;

  constructor() {
    try {
      this.config = ConfigSchema.parse({
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        FORM_TIMEOUT: process.env.FORM_TIMEOUT,
        HEADLESS_MODE: process.env.HEADLESS_MODE,
        LOG_LEVEL: process.env.LOG_LEVEL,
        DEFAULT_FORM_URL: process.env.DEFAULT_FORM_URL,
      });
    } catch (error) {
      console.error('Configuration validation failed:', error);
      process.exit(1);
    }
  }

  get openaiApiKey(): string {
    return this.config.OPENAI_API_KEY;
  }

  get formTimeout(): number {
    return parseInt(this.config.FORM_TIMEOUT);
  }

  get headlessMode(): boolean {
    return this.config.HEADLESS_MODE === 'true';
  }

  get logLevel(): string {
    return this.config.LOG_LEVEL;
  }

  get defaultFormUrl(): string {
    return this.config.DEFAULT_FORM_URL;
  }
}