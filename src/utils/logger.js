import chalk from 'chalk';

const DEBUG = process.env.CLAUDE_COUNT_DEBUG === '1';

export const logger = {
  debug: (message, ...args) => {
    if (DEBUG) {
      console.log(chalk.gray(`[DEBUG] ${message}`), ...args);
    }
  },
  
  info: (message, ...args) => {
    console.log(chalk.blue(message), ...args);
  },
  
  success: (message, ...args) => {
    console.log(chalk.green(message), ...args);
  },
  
  warn: (message, ...args) => {
    console.log(chalk.yellow(message), ...args);
  },
  
  error: (message, ...args) => {
    console.error(chalk.red(message), ...args);
  },
  
  verbose: (message, ...args) => {
    if (process.env.VERBOSE === '1') {
      console.log(chalk.gray(message), ...args);
    }
  }
};

export function logApiError(error, context) {
  logger.error(`❌ API Error in ${context}:`);
  
  if (error.response) {
    logger.error(`  Status: ${error.response.status}`);
    logger.error(`  Message: ${error.response.statusText}`);
  } else if (error.request) {
    logger.error('  No response received from server');
  } else {
    logger.error(`  ${error.message}`);
  }
  
  if (DEBUG) {
    logger.debug('Full error:', error);
  }
}