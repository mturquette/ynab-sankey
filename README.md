# YNAB Sankey Diagram Generator

Visualize your YNAB budget data with beautiful, interactive Sankey diagrams. See where your money comes from and where it goes with a flow-based visualization showing income → category groups → individual spending categories.

## Features

- **Interactive Visualizations**: Hover over flows to see detailed amounts
- **Central Pivot Node**: Date range label with net income/loss delta
- **Financial Summary**: Stat cards showing Total Income, Total Expenses, and Net
- **Smart Caching**: Fetch once, iterate on building/rendering without hitting API rate limits
- **Modular Pipeline**: Run individual stages (fetch, build-d3, render) or chain them together
- **Self-Contained HTML**: Generated files work offline, no web server required
- **Flexible Date Ranges**: Current month, year-to-date, or arbitrary date ranges
- **Configurable Exclusions**: Filter groups/categories via shared config or CLI options

## Prerequisites

- **Node.js 18+** (for native fetch support)
- **YNAB Account** with API access

## Quick Start

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ynab-sankey.git
cd ynab-sankey

# Install dependencies
npm install
```

### 2. Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` and add your YNAB credentials:

```bash
YNAB_API_TOKEN=your_token_here
YNAB_BUDGET_ID=your_budget_id_here
```

#### Getting Your YNAB API Token

1. Go to [YNAB Account Settings](https://app.ynab.com/settings/developer)
2. Click "New Token"
3. Give it a name (e.g., "Sankey Diagram")
4. Copy the token to your `.env` file

#### Finding Your YNAB Budget ID

1. Open YNAB in your browser
2. Navigate to any budget
3. Look at the URL: `https://app.ynab.com/[BUDGET_ID]/budget`
4. Copy the budget ID from the URL to your `.env` file

### 3. Generate Your First Diagram

```bash
# Generate and open in browser
npm run generate -- --open

# Or generate without auto-opening
npm run generate
```

## Architecture

This tool uses a modular, three-stage pipeline with intelligent caching:

```
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 1: ys-fetch                                               │
│ Fetches raw data from YNAB API and caches to disk               │
│ • Renames "Uncategorized" transfers to "Transfer Payments"      │
│ • Sums transaction amounts per category and group               │
│ • Computes income/expense/delta for financial summary           │
│ • Respects 24-hour cache TTL (configurable)                     │
│ Output: data/raw/<date-key>/*.json                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 2: ys-build-d3                                            │
│ Transforms cached data into D3.js sankey format                 │
│ • Builds category and group nodes with links                    │
│ • Creates central pivot node with income/expense delta          │
│ • Wires inflow and group nodes to/from pivot                    │
│ • Filters excluded groups/categories (configurable)             │
│ Output: data/processed/d3-sankey-<date-key>.json                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 3: ys-render                                              │
│ Generates self-contained HTML visualization                     │
│ • Injects D3 sankey JSON into HTML template                     │
│ • Loads D3.js and d3-sankey from CDN                            │
│ • Renders interactive SVG with hover tooltips                   │
│ Output: output/ynab-sankey-d3-<date-key>.html                   │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

**API Rate Limits**: YNAB allows 200 API requests per hour. With caching, you fetch once and can iterate on building/rendering unlimited times.

**Development Workflow**: Modify chart logic or visualization styles without waiting for API calls.

**Debugging**: Inspect raw JSON files at each stage to understand data flow and troubleshoot issues.

**Flexibility**: Run stages independently for custom workflows or testing.

## Usage

### NPM Scripts

```bash
# Full pipeline (fetch → build-d3 → render)
npm run generate

# Individual stages
npm run fetch              # Fetch and cache YNAB data
npm run build-d3           # Transform cached data to D3 sankey format
npm run render             # Render HTML from D3 sankey JSON

# Utilities
npm run clear-cache        # Delete all cached data
```

### Command Line Options

#### Full Pipeline

```bash
npm run generate -- [options]

Options:
  --range=<range>          Date range (see formats below)
  --output=<path>          Custom output HTML path
  --force                  Force refresh cache even if still valid
  --open                   Open result in browser after generation
  --debug                  Enable debug logging
```

#### Individual Utilities

```bash
# Fetch utility
npm run fetch -- [options]
  --range=<range>          Date range
  --force                  Force refresh
  --max-age=<hours>        Cache TTL in hours (default: 24)
  --debug                  Enable debug logging
  --debugverbose           Verbose transaction logging

# Build D3 utility
npm run build-d3 -- [options]
  --input-dir=<path>       Input raw data directory
  --output=<path>          Output D3 sankey JSON file
  --exclude-group=<name>   Exclude a group (repeatable, appends to defaults)
  --exclude-category=<name> Exclude a category (repeatable, appends to defaults)
  --include-zero-activity  Include categories with zero spending
  --debug                  Enable debug logging

# Render utility
npm run render -- [options]
  --input=<path>           Input D3 sankey JSON file
  --output=<path>          Output HTML file path
  --open                   Open in browser after rendering
```

### Date Range Formats

```bash
# Current month (default)
npm run generate -- --range=month

# Year to date
npm run generate -- --range=ytd

# From specific date to today
npm run generate -- --range=2026-01-01

# Arbitrary date range
npm run generate -- --range=2026-01-01:2026-01-31
```

### Example Workflows

**Standard workflow** - Generate current month report:
```bash
npm run generate -- --open
```

**Development workflow** - Iterate on chart logic without API calls:
```bash
# Fetch once
npm run fetch -- --range=month

# Re-build and re-render multiple times (no API calls!)
npm run build-d3 -- --input-dir=data/raw/2026-03
npm run render -- --open
```

**Force refresh** - Ignore cache and fetch fresh data:
```bash
npm run generate -- --force --open
```

**Custom exclusions** - Hide specific groups from the chart:
```bash
npm run build-d3 -- --input-dir=data/raw/2026-03 --exclude-group="Credit Card Payments"
```

## Understanding Your Diagram

### Visual Flow

The Sankey diagram shows a 3-level flow:

1. **Inflow (Left)**: "Inflow: Ready to Assign" — your total income for the period
2. **Pivot Node (Center)**: Date range label with net delta (+$X or -$X)
3. **Category Groups → Categories (Right)**: How money flows from budget groups into individual spending categories

Income flows left-to-right through the pivot. Expense groups fan out from the pivot to the right. The visual height of each flow represents its relative dollar amount.

### Stats Cards

At the top of the page:
- **Total Income**: Sum of all inflows for the period
- **Total Expenses**: Sum of all outflows (shown as positive)
- **Net**: Income minus expenses (positive = surplus, negative = deficit)

### Hover Tooltips

Hover over any flow or node to see:
- Dollar amount
- Source and target nodes
- Node type (group, category, inflow, etc.)

### Default Exclusions

By default, the following are excluded from the chart to reduce noise:
- **Internal Master Category** group (YNAB system category)
- **Internal Master Category** and **Transfer Payments** categories

These defaults live in `src/config.js` and can be extended via CLI `--exclude-group` / `--exclude-category` flags.

### How Transactions are Processed

- **Split transactions**: Each subtransaction is processed individually with its correct category
- **Transfer payments**: YNAB's "Uncategorized" category is renamed to "Transfer Payments" for clarity
- **Deleted transactions**: Filtered out during fetch
- **Amounts**: Stored in YNAB milliunits (1000 milliunits = $1.00), converted to dollars for display

## Data Caching

### How Caching Works

When you run `ys-fetch`, it saves four files to `data/raw/<date-key>/`:
- `transactions.json` - Raw YNAB transactions
- `accounts.json` - Account definitions
- `categories.json` - Category groups and categories (with summed transaction amounts)
- `metadata.json` - Fetch timestamp, date range, and financial summary

**Cache validity**: 24 hours by default

If you run `fetch` again within 24 hours, it uses cached data instead of hitting the API.

### Cache Management

```bash
# Check if cache exists (fetch will tell you)
npm run fetch

# Force refresh regardless of cache age
npm run fetch -- --force

# Custom cache TTL (e.g., 6 hours)
npm run fetch -- --max-age=6

# Clear all cached data
npm run clear-cache
```

## Troubleshooting

### "YNAB API authentication failed"

- Double-check your `YNAB_API_TOKEN` in `.env`
- Generate a new token at https://app.ynab.com/settings/developer
- Ensure there are no extra spaces or quotes around the token

### "YNAB API resource not found"

- Verify your `YNAB_BUDGET_ID` is correct
- Check the URL when viewing your budget in YNAB

### "No transactions found"

- Check your date range — you may be looking at a period with no transactions
- Try `--range=ytd` to expand the date range

### "Rate limit exceeded"

- YNAB allows 200 API requests per hour
- Wait an hour, or use cached data with `npm run build-d3` / `npm run render`

### Income/Spending Numbers Look Wrong

Run with debug mode to inspect processing:
```bash
npm run generate -- --debug
```

## Project Structure

```
ynab-sankey/
├── bin/                          # CLI pipeline scripts
│   ├── ynab-sankey               # Main orchestrator (fetch → build-d3 → render)
│   ├── ys-fetch                  # Stage 1: YNAB API → cached JSON
│   ├── ys-build-d3               # Stage 2: Cached JSON → D3 sankey JSON
│   └── ys-render                 # Stage 3: D3 sankey JSON → HTML
│
├── src/
│   ├── config.js                 # Central configuration (env vars, defaults, exclusions)
│   ├── ynab-api.js               # YNAB REST API client
│   ├── d3-sankey-template.html   # HTML template with D3.js visualization
│   └── utils/
│       ├── cache-manager.js      # Cache validation and path management
│       ├── date-range.js         # Date parsing and formatting
│       ├── file-io.js            # JSON read/write helpers
│       └── format.js             # Monetary formatting (milliunits → USD)
│
├── data/                         # Cached data (gitignored)
│   ├── raw/                      # Stage 1 output (API responses + metadata)
│   └── processed/                # Stage 2 output (D3 sankey JSON)
│
├── output/                       # Generated HTML files (gitignored)
├── .env                          # Your API credentials (gitignored)
├── .env.example                  # Template for .env
└── package.json
```

## Data Privacy & Security

- API tokens stored locally in `.env` (never committed to git)
- Tokens used only server-side (Node.js), never exposed in browser
- Generated HTML contains only aggregated flow data
- No data sent to external services (except YNAB API)
- Output files can be safely shared (no credentials)
- D3.js and d3-sankey loaded from CDN at render time

## Customization

### Exclusion Lists

Edit `src/config.js` to change which groups/categories are excluded by default:

```javascript
defaultExcludedGroups: ['Internal Master Category'],
defaultExcludedCategories: ['Internal Master Category', 'Transfer Payments']
```

Or use CLI flags for one-off exclusions:
```bash
npm run build-d3 -- --input-dir=data/raw/2026-03 --exclude-group="My Group"
```

### Transfer Payment Label

The YNAB API labels account-to-account transfers as "Uncategorized". This tool renames them to "Transfer Payments" by default. To change this label, edit `src/config.js`:

```javascript
transferCategoryName: 'Transfer Payments',
```

### Visual Styling

Edit `src/d3-sankey-template.html` to customize:
- CSS styles (colors, layout, fonts)
- D3.js sankey configuration (node width, padding, alignment)
- Color palettes (uses `d3.schemeTableau10` for groups, `d3.schemePastel1` for categories)
- Stat card layout and formatting

## Advanced Usage

### Using jq to Explore Cached Data

```bash
# List all category groups
cat data/raw/2026-03/categories.json | jq '.[].name'

# View transaction sums by category
cat data/raw/2026-03/categories.json | jq '.[].categories[] | select(.sumTransactionAmount) | {name, sumTransactionAmount}'

# Check metadata and financial summary
cat data/raw/2026-03/metadata.json | jq '.'

# Inspect the D3 sankey nodes
cat data/processed/d3-sankey-2026-03.json | jq '.nodes[] | {id, type}'

# Group together all Liabilities
cat data/raw/2020-01-01_2026-03-04/accounts.json | jq '.[] | select(.type as $a | ["personalLoan", "otherLiability", "mortgage", "autoLoan"] | index($a) ) | {name, type, closed}' 

# List all of the account types
cat data/raw/2020-01-01_2026-03-04/accounts.json | jq '.[].type' | sort | uniq

```

### Batch Processing Multiple Months

```bash
for month in 01 02 03; do
  npm run generate -- --range=2026-${month}-01:2026-${month}-28
done
```

## Roadmap

- [x] D3.js interactive sankey visualization
- [x] Central pivot node with income/expense delta
- [x] Financial summary stat cards
- [x] Intelligent caching system
- [x] Modular 3-stage pipeline (fetch → build-d3 → render)
- [x] Flexible date ranges
- [x] Configurable exclusion lists
- [x] Transfer payment handling
- [ ] Budget vs. Actual comparison
- [ ] Month-to-month trend analysis
- [ ] Handle negative flows / refunds with side swapping
- [ ] Multiple budget support
- [ ] PDF/PNG export
- [ ] Dark mode toggle

## License

MIT License

## Support

- [YNAB API Documentation](https://api.ynab.com/)
- [D3.js Sankey Documentation](https://github.com/d3/d3-sankey)

## Acknowledgments

- [YNAB](https://www.ynab.com/) for the excellent budgeting API
- [D3.js](https://d3js.org/) and [d3-sankey](https://github.com/d3/d3-sankey) for the visualization engine

---

**Made with care for better financial visibility**
