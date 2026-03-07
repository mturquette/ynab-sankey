#!/usr/bin/env node

import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = {
    input: null,
    output: null,
    open: false
  };

  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--input=')) {
      args.input = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    } else if (arg === '--open') {
      args.open = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
YNAB Sankey Plotly Renderer

Usage: ys-render-plotly [options]

Options:
  --input=<path>    Path to Plotly JSON file (default: latest in output/plotly/)
  --output=<path>   Output HTML file path (default: output/render/sankey_yyyy-mm-dd_yyyy-mm-dd.html)
  --open            Open the generated HTML file in default browser
  -h, --help        Show this help message

Examples:
  ys-render-plotly
  ys-render-plotly --open
  ys-render-plotly --input=output/plotly/plotly-sankey-2026-02.json --open
      `);
      process.exit(0);
    }
  });

  return args;
}

/**
 * Find the latest Plotly sankey data file in output/plotly/
 * @returns {string} Path to the latest file
 */
function findLatestPlotlyData() {
  const dataDir = join(process.cwd(), 'output', 'plotly');

  if (!fs.existsSync(dataDir)) {
    throw new Error(`Data directory not found: ${dataDir}`);
  }

  const files = fs.readdirSync(dataDir)
    .filter(f => f.startsWith('plotly-sankey-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No plotly-sankey-*.json files found. Run "ys-build-plotly" first.');
  }

  const filePath = join(dataDir, files[0]);
  console.log(`📂 Using input file: ${filePath}`);
  return filePath;
}

/**
 * Main rendering function
 */
async function main() {
  console.log('🎨 YNAB Sankey Plotly Renderer\n');

  const args = parseArgs();

  // Find input file
  const inputFile = args.input || findLatestPlotlyData();

  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  // Load Plotly data
  console.log('📖 Loading Plotly data...');
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  if (!data.plotlyData || !data.layout || !data.metadata) {
    throw new Error('Invalid Plotly data format. Expected: { plotlyData, layout, metadata }');
  }

  console.log(`   - ${data.plotlyData.node.label.length} nodes`);
  console.log(`   - ${data.plotlyData.link.source.length} links`);

  // Load template
  const templatePath = join(__dirname, 'src', 'plotly-sankey-template.html');

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  console.log('📄 Loading HTML template...');
  let html = fs.readFileSync(templatePath, 'utf8');

  // Replace placeholders
  console.log('🔧 Injecting data into template...');
  html = html.replace('{{PLOTLY_DATA}}', JSON.stringify(data.plotlyData));
  html = html.replace('{{PLOTLY_LAYOUT}}', JSON.stringify(data.layout));
  html = html.replace('{{PLOTLY_CONFIG}}', JSON.stringify(data.config));
  html = html.replace(/{{TITLE}}/g, 'YNAB Budget Flow - Plotly');

  // Handle dateRange which might be an object or a string
  let subtitle = 'Budget Flow';
  if (data.metadata.dateRange) {
    if (typeof data.metadata.dateRange === 'string') {
      subtitle = data.metadata.dateRange;
    } else if (data.metadata.dateRange.label) {
      subtitle = data.metadata.dateRange.label;
    } else if (data.metadata.dateRange.start && data.metadata.dateRange.end) {
      subtitle = `${data.metadata.dateRange.start} to ${data.metadata.dateRange.end}`;
    }
  }

  html = html.replace(/{{SUBTITLE}}/g, subtitle);
  html = html.replace(/{{TIMESTAMP}}/g, new Date().toLocaleString());
  html = html.replace('{{METADATA}}', JSON.stringify(data.metadata));

  // Determine output filename: sankey_yyyy-mm-dd_yyyy-mm-dd.html
  let dateRange = 'budget-flow';
  if (data.metadata.dateRange) {
    if (typeof data.metadata.dateRange === 'object' &&
        data.metadata.dateRange.start &&
        data.metadata.dateRange.end) {
      dateRange = `${data.metadata.dateRange.start}_${data.metadata.dateRange.end}`;
    } else if (typeof data.metadata.dateRange === 'string') {
      dateRange = data.metadata.dateRange.replace(/\s+/g, '-');
    }
  }

  const outputFile = args.output ||
    join(process.cwd(), 'output', 'render', `sankey_${dateRange}.html`);

  // Ensure output directory exists
  fs.mkdirSync(dirname(outputFile), { recursive: true });

  // Write HTML file
  console.log('💾 Writing HTML file...');
  fs.writeFileSync(outputFile, html);

  console.log(`\n✅ Generated: ${outputFile}`);
  console.log(`   File size: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`);

  // Open in browser if requested
  if (args.open) {
    console.log('\n🌐 Opening in browser...');
    const { exec } = await import('child_process');
    const command = process.platform === 'darwin' ? 'open' :
                   process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${command} "${outputFile}"`);
  }

  console.log('\n✨ Done!\n');
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  console.error('\nFor help, run: ys-render-plotly --help\n');
  process.exit(1);
});
