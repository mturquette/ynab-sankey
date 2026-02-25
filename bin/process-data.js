#!/usr/bin/env node

import { join } from 'path';
import { processYNABTransactions, validateYNABData, getSummary } from '../src/processors/ynab-processor.js';
import { readJSON, writeJSON } from '../src/utils/file-io.js';
import { getLatestCache, getCacheKey } from '../src/utils/cache-manager.js';
import { getDateRange } from '../src/utils/date-range.js';

/**
 * process-data.js
 * Transforms raw YNAB data into aggregated spending analysis
 *
 * Usage:
 *   node bin/process-data.js [options]
 *
 * Options:
 *   --input=<path>           Input raw data directory or JSON file
 *   --input-dir=<path>       Input directory (default: latest cache)
 *   --output=<path>          Output processed JSON file
 *   --output-dir=<path>      Output directory (default: data/processed)
 *   --stdin                  Read from stdin (pipe mode)
 *   --debug                  Enable debug logging
 */

/**
 * Parses command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = {
    input: null,
    inputDir: null,
    output: null,
    outputDir: null,
    stdin: false,
    debug: false
  };

  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--input=')) {
      args.input = arg.split('=')[1];
    } else if (arg.startsWith('--input-dir=')) {
      args.inputDir = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    } else if (arg.startsWith('--output-dir=')) {
      args.outputDir = arg.split('=')[1];
    } else if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--debug') {
      args.debug = true;
    }
  });

  return args;
}

/**
 * Reads data from stdin
 * @returns {Promise<string>} stdin content
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', chunk => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      resolve(data);
    });

    process.stdin.on('error', err => {
      reject(err);
    });
  });
}

/**
 * Loads raw data from various sources
 * @param {Object} args - Parsed arguments
 * @returns {Object} { transactions, accounts, categoryGroups, metadata }
 */
function loadRawData(args) {
  // Load from stdin (pipe mode)
  if (args.stdin) {
    throw new Error('stdin mode not yet implemented. Please use --input or --input-dir instead.');
  }

  // Load from specific input directory
  if (args.inputDir) {
    const transactions = readJSON(join(args.inputDir, 'transactions.json'));
    const accounts = readJSON(join(args.inputDir, 'accounts.json'));
    const categoryGroups = readJSON(join(args.inputDir, 'categories.json'));
    const metadata = readJSON(join(args.inputDir, 'metadata.json'), { throwOnMissing: false });

    return { transactions, accounts, categoryGroups, metadata };
  }

  // Load from specific input file (combined JSON)
  if (args.input) {
    const data = readJSON(args.input);
    return {
      transactions: data.transactions || [],
      accounts: data.accounts || [],
      categoryGroups: data.categoryGroups || data.categories || [],
      metadata: data.metadata || null
    };
  }

  // Default: Load from latest cache
  const latestCache = getLatestCache();
  if (!latestCache) {
    throw new Error(
      'No cached data found. Please run "npm run fetch" first, or specify --input-dir.'
    );
  }

  console.log(`Using latest cached data from ${latestCache.cacheKey}`);
  const transactions = readJSON(join(latestCache.path, 'transactions.json'));
  const accounts = readJSON(join(latestCache.path, 'accounts.json'));
  const categoryGroups = readJSON(join(latestCache.path, 'categories.json'));

  return {
    transactions,
    accounts,
    categoryGroups,
    metadata: latestCache.metadata
  };
}

/**
 * Validates raw data structure
 * @param {Object} rawData - Raw data to validate
 */
function validateRawData(rawData) {
  const { transactions, accounts, categoryGroups } = rawData;

  if (!Array.isArray(transactions)) {
    throw new Error('Invalid raw data: transactions must be an array');
  }

  if (!Array.isArray(accounts)) {
    throw new Error('Invalid raw data: accounts must be an array');
  }

  if (!Array.isArray(categoryGroups)) {
    throw new Error('Invalid raw data: categoryGroups must be an array');
  }

  if (transactions.length === 0) {
    console.warn('Warning: No transactions found in input data');
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('⚙️  YNAB Data Processor\n');

    // Parse arguments
    const args = parseArgs();

    if (args.debug) {
      console.log('Debug mode enabled\n');
    }

    // Load raw data
    console.log('Loading raw data...');
    const rawData = loadRawData(args);

    // Validate raw data
    validateRawData(rawData);

    console.log(`   ✓ ${rawData.transactions.length} transactions`);
    console.log(`   ✓ ${rawData.accounts.length} accounts`);
    console.log(`   ✓ ${rawData.categoryGroups.length} category groups\n`);

    // Process data
    console.log('Processing YNAB data...');
    const processedData = processYNABTransactions(rawData.transactions, {
      debug: args.debug,
      accounts: rawData.accounts,
      categoryGroups: rawData.categoryGroups
    });

    console.log(`   ✓ ${processedData.categories.length} spending categories`);
    console.log(`   ✓ ${processedData.transactionCount} transactions processed\n`);

    // Validate processed data
    const validation = validateYNABData(processedData);
    if (validation.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      validation.warnings.forEach(warning => console.log(`   - ${warning}`));
      console.log();
    }

    // Display summary
    console.log('📈 Summary:');
    console.log(getSummary(processedData).split('\n').map(line => `   ${line}`).join('\n'));
    console.log();

    // Determine output path
    const outputDir = args.outputDir || join(process.cwd(), 'data', 'processed');
    let outputPath;

    if (args.output) {
      outputPath = args.output;
    } else {
      // Generate filename based on date range
      let filename;
      if (rawData.metadata && rawData.metadata.dateRange) {
        const dateRange = {
          startDate: rawData.metadata.dateRange.start,
          endDate: rawData.metadata.dateRange.end
        };
        const cacheKey = getCacheKey(dateRange);
        filename = `ynab-${cacheKey}.json`;
      } else {
        // Fallback: use current timestamp
        const now = new Date();
        const timestamp = now.toISOString().split('T')[0];
        filename = `ynab-${timestamp}.json`;
      }
      outputPath = join(outputDir, filename);
    }

    // Build output data
    const outputData = {
      metadata: {
        processedAt: new Date().toISOString(),
        sourceData: args.inputDir || args.input || 'latest cache',
        dateRange: rawData.metadata?.dateRange || null
      },
      ...processedData
    };

    // Save processed data
    console.log('Saving processed data...');
    writeJSON(outputPath, outputData);
    console.log(`   ✓ Saved to ${outputPath}\n`);

    console.log('✅ Processing complete!');

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
