import winston from 'winston';

/**
 * Logger class for logging messages in the form automation application.
 * It uses Winston for logging and supports different log levels.
 */

export class Logger {
  private logger: winston.Logger;

  constructor(logLevel: string = 'info') {
    this.logger = winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        }),
        new winston.transports.File({ filename: 'form-automation.log' })
      ]
    });
  }

  info(message: string, ...args: any[]): void {
    this.logger.info(message, ...args);
  }

  error(message: string, error?: any): void {
    this.logger.error(message, error);
  }

  warn(message: string, ...args: any[]): void {
    this.logger.warn(message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.logger.debug(message, ...args);
  }
}