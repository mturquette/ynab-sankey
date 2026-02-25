# YNAB Sankey Diagram Generator

Visualize your YNAB budget data with beautiful, interactive Sankey diagrams. See where your money comes from and where it goes with a flow-based visualization that shows income sources → accounts → category groups → individual spending categories.

![Sankey Diagram Example](docs/example-screenshot.png)

## Features

- **Interactive Visualizations**: Hover over flows to see detailed amounts and percentages
- **Multi-Level Flow**: Income Sources → Month → Accounts → Category Groups → Categories
- **Smart Caching**: Fetch once, iterate on processing/rendering without hitting API rate limits
- **Modular Architecture**: Run individual utilities (fetch, process, render) or chain them together
- **Self-Contained HTML**: Generated files work offline, no web server required
- **Flexible Date Ranges**: Current month, year-to-date, or arbitrary date ranges
- **Secure**: API tokens stay server-side, never exposed in output files

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
# Generate spending diagram for current month
npm run generate

# Open the generated file
open output/ynab-sankey-2026-02.html
```

That's it! You should see an interactive Sankey diagram showing your spending breakdown.

## Architecture

This tool uses a modular, three-stage pipeline with intelligent caching:

```
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 1: fetch-data.js                                          │
│ Fetches raw data from YNAB API and caches to disk              │
│ • Respects 24-hour cache TTL (configurable)                    │
│ • Avoids hitting API rate limits (200 req/hour)                │
│ Output: data/raw/YYYY-MM/*.json                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 2: process-data.js                                        │
│ Transforms raw data into aggregated analysis                   │
│ • Converts milliunits to dollars                               │
│ • Filters transfers and off-budget accounts                    │
│ • Aggregates by category, calculates percentages              │
│ Output: data/processed/ynab-YYYY-MM.json                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 3: render-sankey.js                                       │
│ Generates HTML visualization from processed data               │
│ • Builds Plotly.js Sankey diagram structure                    │
│ • Embeds data in self-contained HTML                           │
│ Output: output/ynab-sankey-YYYY-MM.html                         │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

**API Rate Limits**: YNAB allows 200 API requests per hour. With caching, you fetch once and can iterate on processing/rendering unlimited times.

**Development Workflow**: Modify processing logic or visualization styles without waiting for API calls.

**Debugging**: Inspect raw JSON files at each stage to understand data flow and troubleshoot issues.

**Flexibility**: Run stages independently for custom workflows or testing.

## Usage

### NPM Scripts

```bash
# Full pipeline (fetch → process → render)
npm run generate

# Individual stages
npm run fetch              # Fetch and cache YNAB data
npm run process            # Process cached data
npm run render             # Render HTML from processed data

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

# Process utility
npm run process -- [options]
  --input-dir=<path>       Input raw data directory
  --output=<path>          Output processed JSON file
  --debug                  Enable debug logging

# Render utility
npm run render -- [options]
  --input=<path>           Input processed JSON file
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

# Spans multiple months
npm run generate -- --range=2025-12-01:2026-02-28
```

### Example Workflows

**Standard workflow** - Generate current month report:
```bash
npm run generate
```

**Development workflow** - Iterate on processing logic without API calls:
```bash
# Fetch once
npm run fetch -- --range=month

# Modify src/processors/ynab-processor.js

# Re-process multiple times (no API calls!)
npm run process -- --input-dir=data/raw/2026-02
npm run process -- --input-dir=data/raw/2026-02 --debug

# Render result
npm run render -- --input=data/processed/ynab-2026-02.json --open
```

**Debugging workflow** - Understand transaction processing:
```bash
# Run with debug to see every transaction
npm run generate -- --range=month --debug

# Inspect raw data
cat data/raw/2026-02/transactions.json | jq '.[] | select(.amount > 0)'

# Inspect processed output
cat data/processed/ynab-2026-02.json | jq '.categories'
```

**Force refresh** - Ignore cache and fetch fresh data:
```bash
npm run generate -- --force
```

**Custom date range** - Analyze specific period:
```bash
npm run generate -- --range=2025-12-01:2026-01-31 --open
```

## Understanding Your Diagram

### Visual Flow

The Sankey diagram shows a 5-level flow:

1. **Income Sources (Left)**: Your income by source (payee name)
2. **Month Bar (Center)**: The period being analyzed
3. **Accounts**: Which accounts transactions flow through
4. **Category Groups**: YNAB's category groups (e.g., "Splurge", "Monthly Bills")
5. **Categories (Right)**: Individual spending categories

The visual height of flows represents relative amounts. A thicker flow = more money.

### Hover Tooltips

Hover over any flow to see:
- Dollar amount
- Percentage of total
- Source and target nodes

### Stats Cards

At the top of the page:
- **Income**: Total inflows for the period
- **Total Spending**: Sum of all outflows
- **Savings**: Income minus spending (with savings rate %)

### How Transactions are Processed

The application intelligently filters transactions to avoid double-counting:

**✅ Excluded from calculations:**
- **Transfers between accounts** - Moving money between checking and savings doesn't count as spending
- **Credit card payments** - Only the actual purchases count, not the payment itself
- **Off-budget (tracking) accounts** - Retirement accounts, loans you're tracking, etc.
- **Deleted transactions** - Removed from YNAB
- **Internal YNAB categories** - "Inflow: Ready to Assign", "Hidden", etc.

**✅ Split transactions:**
- Each subtransaction is processed individually with its correct category
- Parent split transaction is not double-counted

**Why use `--debug` mode:**

If your numbers look unexpected, run with `--debug` to see exactly which transactions are being counted, skipped, or categorized:

```bash
npm run generate -- --debug
```

This shows:
- Which transactions are being skipped (transfers, off-budget, etc.)
- Income transactions and their sources
- Spending by category with payee names
- Processing summary with counts

## Data Caching

### How Caching Works

When you run `fetch-data.js`, it saves four files to `data/raw/YYYY-MM/`:
- `transactions.json` - Raw YNAB transactions
- `accounts.json` - Account definitions
- `categories.json` - Category groups and categories
- `metadata.json` - Fetch timestamp and date range

**Cache validity**: 24 hours by default

If you run `fetch` again within 24 hours, it uses cached data instead of hitting the API. This is displayed as:
```
✅ Using cached data (still fresh)
💡 Use --force to refresh from API
```

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

### Benefits

1. **No rate limit concerns during development**
2. **Inspect raw API responses** - Debug data issues by reading JSON files
3. **Reproducible results** - Same data, consistent output
4. **Historical analysis** - Keep archived data from previous months

## Troubleshooting

### "YNAB API authentication failed"

- Double-check your `YNAB_API_TOKEN` in `.env`
- Generate a new token at https://app.ynab.com/settings/developer
- Ensure there are no extra spaces or quotes around the token

### "YNAB API resource not found"

- Verify your `YNAB_BUDGET_ID` is correct
- Check the URL when viewing your budget in YNAB
- Make sure the budget hasn't been deleted

### "No transactions found"

- Check your date range - you may be looking at a period with no transactions
- Verify transactions exist in YNAB for the selected period
- Try using `--range=ytd` to expand the date range

### "Rate limit exceeded"

- YNAB allows 200 API requests per hour
- Wait an hour, or use cached data with `npm run process`
- The caching system is designed specifically to avoid this issue

### Income/Spending Numbers Look Wrong

Run with debug mode to see transaction processing:
```bash
npm run generate -- --debug
```

Common issues:
- **Large unexpected income**: Check for transfers being counted as income (should be filtered)
- **Missing spending**: Transactions might be in off-budget accounts (correctly excluded)
- **Uncategorized transactions**: Categorize them in YNAB for accurate breakdown

### Cache Issues

```bash
# Force fresh data
npm run fetch -- --force

# Clear cache and start over
npm run clear-cache
npm run generate
```

## Project Structure

```
ynab-sankey/
├── bin/                          # Standalone utilities
│   ├── fetch-data.js             # Fetch from YNAB API
│   ├── process-data.js           # Transform raw data
│   └── render-sankey.js          # Generate HTML
│
├── src/
│   ├── index.js                  # Main orchestrator
│   ├── config.js                 # Configuration loader
│   ├── api/
│   │   └── ynab.js               # YNAB API client
│   ├── processors/
│   │   └── ynab-processor.js     # Transaction processing logic
│   ├── sankey/
│   │   └── builder.js            # Sankey diagram builder
│   ├── templates/
│   │   └── sankey.html           # HTML template
│   └── utils/
│       ├── date-range.js         # Date utilities
│       ├── file-io.js            # JSON I/O helpers
│       └── cache-manager.js      # Cache validation
│
├── data/                         # Cached data (gitignored)
│   ├── raw/
│   │   └── 2026-02/              # Raw API responses
│   └── processed/
│       └── ynab-2026-02.json     # Aggregated data
│
├── output/                       # Generated HTML (gitignored)
│   └── ynab-sankey-2026-02.html
│
├── .env                          # Your API credentials
└── package.json
```

## Data Privacy & Security

- ✅ API tokens stored locally in `.env` (never committed to git)
- ✅ Tokens used only server-side (Node.js), never exposed to browser
- ✅ Generated HTML contains only aggregated data (no raw transaction details)
- ✅ No data sent to external services (except YNAB API)
- ✅ Output files can be safely shared (no sensitive credentials)
- ✅ Cached data stays on your machine

## Customization

### Changing Colors

Edit `src/sankey/builder.js` to customize colors:

```javascript
function getAccountColor(accountType) {
  const colors = {
    checking: 'rgba(52, 152, 219, 0.8)',     // Blue
    creditCard: 'rgba(231, 76, 60, 0.8)',    // Red
    // Add your custom colors
  };
  return colors[accountType] || 'rgba(149, 165, 166, 0.8)';
}
```

### Modifying the Template

Edit `src/templates/sankey.html` to:
- Change styling (CSS in `<style>` tag)
- Adjust diagram layout (Plotly.js config)
- Add custom statistics or branding

### Custom Processing Logic

Edit `src/processors/ynab-processor.js` to:
- Filter specific categories
- Add custom aggregations
- Change how transactions are categorized

Example - exclude a category:
```javascript
function shouldSkipCategory(categoryName) {
  return (
    categoryName.startsWith('Inflow:') ||
    categoryName === 'Your Category to Skip'
  );
}
```

## Advanced Usage

### Using jq to Explore Data

```bash
# View all income transactions
cat data/raw/2026-02/transactions.json | jq '.[] | select(.amount > 0)'

# Find high-value transactions
cat data/raw/2026-02/transactions.json | jq '.[] | select(.amount < -50000)'

# List all category groups
cat data/raw/2026-02/categories.json | jq '.[].name'

# Check spending by category
cat data/processed/ynab-2026-02.json | jq '.categories[] | {name, amount}'
```

### Batch Processing Multiple Months

```bash
# Fetch and process January through March
for month in 01 02 03; do
  npm run generate -- --range=2026-${month}-01:2026-${month}-31
done
```

### Custom Output Locations

```bash
# Save to specific location
npm run generate -- --output=/path/to/my-report.html

# Save with custom name
npm run render -- --input=data/processed/ynab-2026-02.json \
                  --output=february-budget.html
```

## Roadmap

- [x] YNAB spending visualization
- [x] Multi-level flow (Income → Accounts → Groups → Categories)
- [x] Intelligent caching system
- [x] Modular architecture (fetch/process/render)
- [x] Flexible date ranges including arbitrary ranges
- [x] Debug mode for transaction inspection
- [ ] Budget vs. Actual comparison
- [ ] Month-to-month trend analysis
- [ ] Multiple budget support
- [ ] PDF/PNG export
- [ ] Mobile-responsive improvements
- [ ] Dark mode toggle

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

- 📚 [YNAB API Documentation](https://api.ynab.com/)
- 📚 [Plotly.js Sankey Docs](https://plotly.com/javascript/sankey-diagram/)
- 🐛 [Report Issues](https://github.com/yourusername/ynab-sankey/issues)
- 💬 [Discussions](https://github.com/yourusername/ynab-sankey/discussions)

## Acknowledgments

- [YNAB](https://www.ynab.com/) for the excellent budgeting API
- [Plotly.js](https://plotly.com/javascript/) for beautiful visualizations
- The personal finance community for inspiration

---

**Made with ❤️ for better financial visibility**
