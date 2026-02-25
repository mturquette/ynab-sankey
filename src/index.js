#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getCacheKey } from './utils/cache-manager.js';
import { getDateRange } from './utils/date-range.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main orchestrator for YNAB Sankey Generator
 * Chains together: fetch → process → render
 *
 * Usage:
 *   node src/index.js [options]
 *
 * Options:
 *   --range=<range>          Date range (default: month)
 *   --output=<path>          Output file path (optional)
 *   --force                  Force refresh cache
 *   --open                   Open result in browser
 *   --debug                  Enable debug logging
 */

/**
 * Parses command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = {
    range: 'month',
    output: null,
    force: false,
    open: false,
    debug: false
  };

  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--range=')) {
      args.range = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--open') {
      args.open = true;
    } else if (arg === '--debug') {
      args.debug = true;
    }
  });

  return args;
}

/**
 * Runs a utility script as a child process
 * @param {string} scriptName - Name of the script in bin/ directory
 * @param {Array<string>} args - Arguments to pass to the script
 * @returns {Promise<void>}
 */
function runUtility(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, '../bin', scriptName);
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptName} exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to run ${scriptName}: ${err.message}`));
    });
  });
}

/**
 * Main application function
 */
async function main() {
  try {
    console.log('🚀 Starting YNAB Sankey Generator\n');

    // Parse command line arguments
    const args = parseArgs();

    // Get date range for cache key calculation
    const dateRange = getDateRange(args.range);
    const cacheKey = getCacheKey(dateRange);

    // Step 1: Fetch data
    console.log('📊 Step 1/3: Fetching data from YNAB API...');
    const fetchArgs = [`--range=${args.range}`];
    if (args.force) fetchArgs.push('--force');
    if (args.debug) fetchArgs.push('--debug');

    await runUtility('fetch-data.js', fetchArgs);

    // Step 2: Process data
    console.log('\n⚙️  Step 2/3: Processing data...');
    const processArgs = [`--input-dir=data/raw/${cacheKey}`];
    if (args.debug) processArgs.push('--debug');

    await runUtility('process-data.js', processArgs);

    // Step 3: Render visualization
    console.log('\n🎨 Step 3/3: Generating visualization...');
    const renderArgs = [`--input=data/processed/ynab-${cacheKey}.json`];
    if (args.output) renderArgs.push(`--output=${args.output}`);
    if (args.open) renderArgs.push('--open');

    await runUtility('render-sankey.js', renderArgs);

    console.log('\n✅ Done! HTML file saved to output/');
    if (!args.open) {
      console.log('💡 Use --open to automatically open the result in your browser');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);

    if (error.stack && process.env.DEBUG) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Run the application
main();
