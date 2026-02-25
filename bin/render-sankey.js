#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { buildYNABSankey, validateSankeyData } from '../src/sankey/builder.js';
import { readJSON, writeJSON } from '../src/utils/file-io.js';
import { getFilenameTimestamp } from '../src/utils/date-range.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * render-sankey.js
 * Generates HTML visualization from processed YNAB data
 *
 * Usage:
 *   node bin/render-sankey.js [options]
 *
 * Options:
 *   --input=<path>           Input processed JSON file
 *   --input-dir=<path>       Input directory (default: data/processed/latest)
 *   --output=<path>          Output HTML file path
 *   --output-dir=<path>      Output directory (default: output/)
 *   --stdin                  Read from stdin (pipe mode)
 *   --template=<path>        Custom HTML template (default: src/templates/sankey.html)
 *   --title=<string>         Custom title
 *   --open                   Open in browser after generation
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
    template: null,
    title: null,
    open: false
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
    } else if (arg.startsWith('--template=')) {
      args.template = arg.split('=')[1];
    } else if (arg.startsWith('--title=')) {
      args.title = arg.split('=')[1];
    } else if (arg === '--open') {
      args.open = true;
    }
  });

  return args;
}

/**
 * Loads processed data from various sources
 * @param {Object} args - Parsed arguments
 * @returns {Object} Processed YNAB data
 */
function loadProcessedData(args) {
  // Load from stdin (pipe mode)
  if (args.stdin) {
    throw new Error('stdin mode not yet implemented. Please use --input or --input-dir instead.');
  }

  // Load from specific input file
  if (args.input) {
    return readJSON(args.input);
  }

  // Load from input directory (find latest)
  if (args.inputDir) {
    // For now, assume a specific filename pattern
    // TODO: Implement finding latest file in directory
    throw new Error('--input-dir not yet implemented. Please use --input to specify exact file.');
  }

  // Default: Load from latest processed file
  const defaultPath = join(process.cwd(), 'data', 'processed');
  throw new Error(
    `No input specified. Please provide --input=<path> to specify the processed data file.\n` +
    `  Example: --input=${defaultPath}/ynab-2026-02.json`
  );
}

/**
 * Validates processed data structure
 * @param {Object} processedData - Processed data to validate
 */
function validateProcessedData(processedData) {
  if (!processedData.income && processedData.income !== 0) {
    throw new Error('Invalid processed data: missing "income" field');
  }

  if (!processedData.totalSpending && processedData.totalSpending !== 0) {
    throw new Error('Invalid processed data: missing "totalSpending" field');
  }

  if (!Array.isArray(processedData.categories)) {
    throw new Error('Invalid processed data: "categories" must be an array');
  }

  if (!Array.isArray(processedData.incomeSources)) {
    throw new Error('Invalid processed data: "incomeSources" must be an array');
  }

  if (!Array.isArray(processedData.accountFlows)) {
    throw new Error('Invalid processed data: "accountFlows" must be an array');
  }
}

/**
 * Generates HTML from template with data
 * @param {Object} sankeyData - Sankey diagram data
 * @param {Object} metadata - Additional metadata for the page
 * @param {string} dateLabel - Date range label
 * @param {string} templatePath - Path to HTML template
 * @returns {string} Complete HTML content
 */
function generateHTML(sankeyData, metadata, dateLabel, templatePath) {
  let html = readFileSync(templatePath, 'utf-8');

  // Generate title and subtitle
  const title = 'YNAB Spending Breakdown';
  const subtitle = dateLabel;

  // Generate stats cards
  const stats = [];

  stats.push(`
    <div class="stat-card positive">
      <div class="label">Total Income</div>
      <div class="value">$${metadata.income.toLocaleString()}</div>
    </div>
  `);

  stats.push(`
    <div class="stat-card negative">
      <div class="label">Total Spending</div>
      <div class="value">$${metadata.totalSpending.toLocaleString()}</div>
    </div>
  `);

  if (metadata.savings > 0.01) {
    const savingsRate = metadata.income ? (metadata.savings / metadata.income * 100).toFixed(1) : 0;
    stats.push(`
      <div class="stat-card positive">
        <div class="label">Savings</div>
        <div class="value">$${metadata.savings.toLocaleString()}</div>
        <div class="label" style="margin-top: 5px;">${savingsRate}% saved</div>
      </div>
    `);
  } else if (metadata.savings < -0.01) {
    const deficit = Math.abs(metadata.savings);
    const deficitRate = metadata.income ? (deficit / metadata.income * 100).toFixed(1) : 0;
    stats.push(`
      <div class="stat-card negative">
        <div class="label">Deficit</div>
        <div class="value">$${deficit.toLocaleString()}</div>
        <div class="label" style="margin-top: 5px;">${deficitRate}% over budget</div>
      </div>
    `);
  }

  // Replace placeholders
  const timestamp = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const filename = 'ynab-sankey';

  html = html.replace(/{{TITLE}}/g, title);
  html = html.replace(/{{SUBTITLE}}/g, subtitle);
  html = html.replace(/{{STATS}}/g, stats.join('\n'));
  html = html.replace(/{{SANKEY_DATA}}/g, JSON.stringify(sankeyData));
  html = html.replace(/{{TIMESTAMP}}/g, timestamp);
  html = html.replace(/{{FILENAME}}/g, filename);

  return html;
}

/**
 * Opens a file in the default browser
 * @param {string} filePath - Path to the file to open
 */
function openInBrowser(filePath) {
  const platform = process.platform;
  let command;

  if (platform === 'darwin') {
    command = `open "${filePath}"`;
  } else if (platform === 'win32') {
    command = `start "" "${filePath}"`;
  } else {
    command = `xdg-open "${filePath}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.warn(`Could not open browser: ${error.message}`);
    }
  });
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('🎨 Sankey Diagram Renderer\n');

    // Parse arguments
    const args = parseArgs();

    // Load processed data
    console.log('Loading processed data...');
    const processedData = loadProcessedData(args);

    // Validate processed data
    validateProcessedData(processedData);

    const dateLabel = processedData.metadata?.dateRange?.label || 'Unknown Period';
    console.log(`   ✓ Date range: ${dateLabel}`);
    console.log(`   ✓ Income: $${processedData.income.toLocaleString()}`);
    console.log(`   ✓ Spending: $${processedData.totalSpending.toLocaleString()}\n`);

    // Build Sankey diagram
    console.log('Building Sankey diagram...');
    const sankeyData = buildYNABSankey(processedData, dateLabel);

    // Validate Sankey data
    const sankeyValidation = validateSankeyData(sankeyData);
    if (!sankeyValidation.isValid) {
      console.error('❌ Sankey data validation failed:');
      sankeyValidation.errors.forEach(error => console.error(`   - ${error}`));
      process.exit(1);
    }

    console.log(`   ✓ ${sankeyData.nodes.length} nodes`);
    console.log(`   ✓ ${sankeyData.links.length} links\n`);

    // Generate HTML
    console.log('Generating HTML...');
    const templatePath = args.template || join(__dirname, '../src/templates/sankey.html');
    const metadata = sankeyData.metadata;
    const html = generateHTML(sankeyData, metadata, dateLabel, templatePath);

    // Determine output path
    const outputDir = args.outputDir || join(process.cwd(), 'output');
    let outputPath;

    if (args.output) {
      outputPath = args.output;
    } else {
      // Generate filename based on date range
      let timestamp;
      if (processedData.metadata?.dateRange) {
        const dateRange = processedData.metadata.dateRange;
        // Extract a reasonable range string for filename
        timestamp = dateRange.start.substring(0, 7); // YYYY-MM
      } else {
        timestamp = new Date().toISOString().split('T')[0].substring(0, 7);
      }
      const filename = `ynab-sankey-${timestamp}.html`;
      outputPath = join(outputDir, filename);
    }

    // Write HTML file
    const outputContent = html;
    const fs = await import('fs');
    const path = await import('path');

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, outputContent, 'utf-8');

    console.log(`   ✓ Saved to ${outputPath}\n`);

    console.log('✅ Rendering complete!');
    console.log('💡 Open the file in your web browser to view the interactive diagram.');

    // Open in browser if requested
    if (args.open) {
      console.log('\nOpening in browser...');
      openInBrowser(outputPath);
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

// Run the utility
main();
