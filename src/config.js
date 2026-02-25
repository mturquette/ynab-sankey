import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

dotenv.config({ path: join(rootDir, '.env') });

/**
 * Application configuration loaded from environment variables
 */
const config = {
  ynab: {
    apiToken: process.env.YNAB_API_TOKEN,
    budgetId: process.env.YNAB_BUDGET_ID,
    apiBase: 'https://api.ynab.com/v1'
  },

  app: {
    defaultRange: process.env.DEFAULT_RANGE || 'month',
    outputDir: process.env.OUTPUT_DIR || './output'
  }
};

/**
 * Validates that required YNAB configuration is present
 * @throws {Error} If required configuration is missing
 */
export function validateConfig() {
  const errors = [];

  if (!config.ynab.apiToken) {
    errors.push('YNAB_API_TOKEN is required. Get your token from: https://app.ynab.com/settings/developer');
  }

  if (!config.ynab.budgetId) {
    errors.push('YNAB_BUDGET_ID is required. You can find this in your YNAB URL when viewing a budget.');
  }

  if (errors.length > 0) {
    throw new Error(
      'Configuration errors:\n' +
      errors.map(err => `  - ${err}`).join('\n') +
      '\n\nPlease check your .env file. See .env.example for reference.'
    );
  }
}

export default config;
