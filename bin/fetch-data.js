#!/usr/bin/env node

import { join } from 'path';
import config, { validateConfig } from '../src/config.js';
import { ynabClient } from '../src/api/ynab.js';
import { getDateRange } from '../src/utils/date-range.js';
import { writeJSON } from '../src/utils/file-io.js';
import { isCacheValid, getCachePath } from '../src/utils/cache-manager.js';

/**
 * fetch-data.js
 * Fetches data from YNAB API and caches it to disk
 *
 * Usage:
 *   node bin/fetch-data.js [options]
 *
 * Options:
 *   --range=<month|ytd|YYYY-MM-DD|YYYY-MM-DD:YYYY-MM-DD>  Date range (default: month)
 *   --budget-id=<id>         YNAB budget ID (default: from .env)
 *   --force                  Force refresh even if cache valid
 *   --output-dir=<path>      Output directory (default: data/raw)
 *   --max-age=<hours>        Cache TTL in hours (default: 24)
 *   --debug                  Enable debug logging
 */

/**
 * Parses command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = {
    range: 'month',
    budgetId: config.ynab.budgetId,
    force: false,
    outputDir: null,
    maxAge: 24,
    debug: false
  };

  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--range=')) {
      args.range = arg.split('=')[1];
    } else if (arg.startsWith('--budget-id=')) {
      args.budgetId = arg.split('=')[1];
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg.startsWith('--output-dir=')) {
      args.outputDir = arg.split('=')[1];
    } else if (arg.startsWith('--max-age=')) {
      args.maxAge = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--debug') {
      args.debug = true;
    }
  });

  return args;
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('📊 YNAB Data Fetcher\n');

    // Parse arguments
    const args = parseArgs();

    if (args.debug) {
      console.log('Debug mode enabled\n');
    }

    // Validate configuration
    validateConfig();

    // Get date range
    const dateRange = getDateRange(args.range);
    console.log(`Date range: ${dateRange.startDate} to ${dateRange.endDate}`);
    console.log(`Label: ${dateRange.label}\n`);

    // Check cache validity
    const cacheValid = isCacheValid(dateRange, args.maxAge);
    const cacheDir = args.outputDir || getCachePath(dateRange, 'raw');

    if (cacheValid && !args.force) {
      console.log('✅ Using cached data (still fresh)');
      console.log(`   Cache location: ${cacheDir}`);
      console.log(`\n💡 Use --force to refresh from API`);
      process.exit(0);
    }

    if (args.force && cacheValid) {
      console.log('🔄 Force refresh requested, ignoring cache\n');
    } else if (!cacheValid) {
      console.log('🔄 Cache is stale or missing, fetching from API\n');
    }

    // Fetch data from YNAB API
    console.log('Fetching from YNAB API...');

    const [transactions, accounts, categoryGroups] = await Promise.all([
      ynabClient.getTransactions(
        args.budgetId,
        dateRange.startDate,
        dateRange.endDate
      ),
      ynabClient.getAccounts(args.budgetId),
      ynabClient.getCategories(args.budgetId)
    ]);

    console.log(`   ✓ ${transactions.length} transactions`);
    console.log(`   ✓ ${accounts.length} accounts`);
    console.log(`   ✓ ${categoryGroups.length} category groups\n`);

    if (args.debug) {
      console.log('Accounts:');
      accounts.forEach(acct => {
        const status = acct.closed ? '[CLOSED]' : '';
        const budget = acct.on_budget ? '[ON-BUDGET]' : '[OFF-BUDGET]';
        console.log(`  - ${acct.name} (${acct.type}) ${budget} ${status}`);
      });
      console.log();
    }

    // Save data to disk
    console.log('Saving data to cache...');

    writeJSON(join(cacheDir, 'transactions.json'), transactions);
    console.log(`   ✓ Saved transactions.json`);

    writeJSON(join(cacheDir, 'accounts.json'), accounts);
    console.log(`   ✓ Saved accounts.json`);

    writeJSON(join(cacheDir, 'categories.json'), categoryGroups);
    console.log(`   ✓ Saved categories.json`);

    // Create metadata
    const metadata = {
      fetchedAt: new Date().toISOString(),
      dateRange: {
        start: dateRange.startDate,
        end: dateRange.endDate,
        label: dateRange.label
      },
      budgetId: args.budgetId,
      transactionCount: transactions.length,
      accountCount: accounts.length,
      categoryGroupCount: categoryGroups.length
    };

    writeJSON(join(cacheDir, 'metadata.json'), metadata);
    console.log(`   ✓ Saved metadata.json\n`);

    console.log('✅ Data successfully cached!');
    console.log(`   Location: ${cacheDir}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);

    if (error.stack && process.env.DEBUG) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Run the utility
main();
