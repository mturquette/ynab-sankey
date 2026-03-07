#!/usr/bin/env node

/**
 * ys-build-plotly
 * Transforms cached YNAB data into Plotly.js sankey JSON format.
 *
 * Reads transactions.json, accounts.json, categories.json, and metadata.json
 * from a raw data directory and produces a Plotly-compatible nodes+links JSON
 * file for rendering.
 *
 * Key differences from D3 version:
 *   - Index-based node references instead of string IDs
 *   - Account grouping by type (Deposit, Revolving Credit, etc.)
 *   - Native directional arrow support
 *   - Inline styling (colors, borders)
 */

import fs from 'fs';
import path from 'path';
import { readJSON } from './src/utils/file-io.js';
import { milliunitsToUSD } from './src/utils/format.js';
import config from './src/config.js';

// ---------------------------------------------------------------------------
// Plotly Account Grouping Configuration
// ---------------------------------------------------------------------------

const plotlyAccountGroups = {
  'Deposit Accounts': ['checking', 'savings'],
  'Revolving Credit': ['creditCard'],
  'Investments': ['otherAsset'],
  'Liabilities': ['autoLoan', 'mortgage', 'otherLiability', 'personalLoan']
};

function getAccountGroup(accountType) {
  for (const [groupName, types] of Object.entries(plotlyAccountGroups)) {
    if (types.includes(accountType)) return groupName;
  }
  return 'Other';
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = {
    inputDir: null,
    output: null,
    debug: false,
    includeZeroActivity: false,
    excludedGroups: [...config.defaultExcludedGroups],
    excludedCategories: [...config.defaultExcludedCategories]
  };

  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--input-dir=')) {
      args.inputDir = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    } else if (arg === '--debug') {
      args.debug = true;
    } else if (arg === '--include-zero-activity') {
      args.includeZeroActivity = true;
    } else if (arg.startsWith('--exclude-group=')) {
      args.excludedGroups.push(arg.split('=')[1]);
    } else if (arg.startsWith('--exclude-category=')) {
      args.excludedCategories.push(arg.split('=')[1]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
YNAB → Plotly Sankey Builder

Usage: ys-build-plotly [options]

Options:
  --input-dir=<path>           Path to YNAB data directory (default: latest in output/ynab/)
  --output=<path>              Output JSON file path (default: output/plotly/plotly-sankey-<date>.json)
  --debug                      Enable debug output
  --include-zero-activity      Include accounts with no transactions
  --exclude-group=<name>       Exclude a category group (can be used multiple times)
  --exclude-category=<name>    Exclude a category (can be used multiple times)
  -h, --help                   Show this help message

Examples:
  ys-build-plotly --input-dir=output/ynab/2026-01-01_2026-02-28
  ys-build-plotly --input-dir=output/ynab/2026-02 --debug
  ys-build-plotly --input-dir=output/ynab/2026-02 --exclude-group="Internal Master Category"
      `);
      process.exit(0);
    }
  });

  return args;
}

/**
 * Find the latest YNAB data directory in output/ynab/
 * @returns {string} Path to the latest directory
 */
function findLatestYnabData() {
  const dataDir = path.join(process.cwd(), 'output', 'ynab');

  if (!fs.existsSync(dataDir)) {
    throw new Error(`Data directory not found: ${dataDir}`);
  }

  const dirs = fs.readdirSync(dataDir)
    .filter(f => {
      const fullPath = path.join(dataDir, f);
      return fs.statSync(fullPath).isDirectory();
    })
    .sort()
    .reverse();

  if (dirs.length === 0) {
    throw new Error('No YNAB data directories found. Run "npm run fetch" first.');
  }

  const dirPath = path.join(dataDir, dirs[0]);
  console.log(`📂 Using input directory: ${dirPath}`);
  return dirPath;
}

// ---------------------------------------------------------------------------
// Lookup map builders (from ys-build-d3)
// ---------------------------------------------------------------------------

function buildAccountMap(accounts) {
  const map = new Map();
  accounts.forEach(a => map.set(a.id, a));
  return map;
}

function buildCategoryToGroupMap(categoryGroups) {
  const map = new Map();
  categoryGroups.forEach(group => {
    if (group.hidden || group.deleted) return;
    (group.categories || []).forEach(cat => {
      if (cat.hidden || cat.deleted) return;
      map.set(cat.name, group.name);
    });
  });
  return map;
}

function classifyAccount(account) {
  if (config.assetAccountTypes.includes(account.type)) return 'asset';
  if (config.liabilityAccountTypes.includes(account.type)) return 'liability';
  // Check for liability types from plotly grouping
  const group = getAccountGroup(account.type);
  if (group === 'Liabilities') return 'liability';
  if (group === 'Investments') return 'asset';
  return null;
}

// ---------------------------------------------------------------------------
// Node ID helpers
// ---------------------------------------------------------------------------

function makeAccountNodeId(account) {
  return `acct:${account.name}`;
}

function makeGroupNodeId(groupName) {
  return `group:${groupName}`;
}

function makeCategoryNodeId(categoryName) {
  return `cat:${categoryName}`;
}

// ---------------------------------------------------------------------------
// Transaction aggregation (from ys-build-d3)
// ---------------------------------------------------------------------------

function aggregateTransactions(transactions, accountById, categoryToGroup, options) {
  const { debug = false, excludedGroupSet, excludedCategorySet } = options;

  const incomeByAccount = new Map();
  const ccPaymentsBySourceAndTarget = new Map();
  const expensesByAccountAndGroup = new Map();
  const expensesByGroupAndCategory = new Map();
  const loanPaymentsByCategoryAndAccount = new Map();

  let totalIncomeMilliunits = 0;
  let totalCCPaymentsMilliunits = 0;
  let totalLoanPaymentsMilliunits = 0;

  function addToMap(map, key, amount) {
    map.set(key, (map.get(key) || 0) + amount);
  }

  const processedTransferIds = new Set();

  transactions.forEach(txn => {
    const entries = (txn.subtransactions && txn.subtransactions.length > 0)
      ? txn.subtransactions.map(sub => ({
          ...sub,
          account_id: txn.account_id,
          account_name: txn.account_name,
          transfer_account_id: sub.transfer_account_id ?? txn.transfer_account_id
        }))
      : [txn];

    entries.forEach(entry => {
      const account = accountById.get(entry.account_id);
      if (!account) return;

      const absAmount = Math.abs(entry.amount);
      const isOutflow = entry.amount < 0;

      // TRANSFERS
      if (entry.transfer_account_id) {
        if (entry.transfer_transaction_id &&
            processedTransferIds.has(entry.transfer_transaction_id)) {
          return;
        }
        if (entry.id) {
          processedTransferIds.add(entry.id);
        }

        const partnerAccount = accountById.get(entry.transfer_account_id);
        const sourceAccount = isOutflow ? account : partnerAccount;
        const targetAccount = isOutflow ? partnerAccount : account;

        const sourceType = sourceAccount ? classifyAccount(sourceAccount) : null;
        const targetType = targetAccount ? classifyAccount(targetAccount) : null;

        // CC Payment: asset → on-budget liability
        if (sourceType === 'asset' && targetType === 'liability' && targetAccount?.on_budget) {
          addToMap(ccPaymentsBySourceAndTarget, `${sourceAccount.id}|${targetAccount.id}`, absAmount);
          totalCCPaymentsMilliunits += absAmount;
          if (debug) {
            console.log(`  CC payment: ${sourceAccount.name} → ${targetAccount.name}: ${milliunitsToUSD(absAmount)}`);
          }
          return;
        }

        // Loan payment: asset → off-budget (route through category)
        if (sourceType === 'asset' && targetAccount && !targetAccount.on_budget) {
          const groupName = categoryToGroup.get(entry.category_name);
          if (groupName && !excludedGroupSet.has(groupName) && !excludedCategorySet.has(entry.category_name)) {
            const acctNodeId = makeAccountNodeId(sourceAccount);
            const groupNodeId = makeGroupNodeId(groupName);
            const catNodeId = makeCategoryNodeId(entry.category_name);
            const loanAcctNodeId = makeAccountNodeId(targetAccount);
            addToMap(expensesByAccountAndGroup, `${acctNodeId}|${groupNodeId}`, absAmount);
            addToMap(expensesByGroupAndCategory, `${groupNodeId}|${catNodeId}`, absAmount);
            addToMap(loanPaymentsByCategoryAndAccount, `${catNodeId}|${loanAcctNodeId}`, absAmount);
            totalLoanPaymentsMilliunits += absAmount;
            if (debug) {
              console.log(`  Loan payment: ${sourceAccount.name} → ${groupName} → ${entry.category_name} → ${targetAccount.name}: ${milliunitsToUSD(absAmount)}`);
            }
          }
          return;
        }

        // Loan disbursement: off-budget → asset (treat as income)
        if (sourceAccount && !sourceAccount.on_budget && targetType === 'asset') {
          addToMap(incomeByAccount, targetAccount.id, absAmount);
          totalIncomeMilliunits += absAmount;
          if (debug) {
            console.log(`  Loan disbursement: ${sourceAccount.name} → ${targetAccount.name}: ${milliunitsToUSD(absAmount)}`);
          }
          return;
        }

        // Other transfers - skip
        if (debug) {
          console.log(`  Skipped transfer: ${account.name} ↔ ${partnerAccount?.name || '?'}: ${milliunitsToUSD(absAmount)}`);
        }
        return;
      }

      // NON-TRANSFERS

      // Income
      if (entry.category_name === 'Inflow: Ready to Assign') {
        addToMap(incomeByAccount, entry.account_id, absAmount);
        totalIncomeMilliunits += absAmount;
        return;
      }

      // Expenses (outflows only)
      if (isOutflow) {
        const groupName = categoryToGroup.get(entry.category_name);
        if (!groupName || excludedGroupSet.has(groupName) || excludedCategorySet.has(entry.category_name)) {
          return;
        }
        const acctNodeId = makeAccountNodeId(account);
        const groupNodeId = makeGroupNodeId(groupName);
        const catNodeId = makeCategoryNodeId(entry.category_name);
        addToMap(expensesByAccountAndGroup, `${acctNodeId}|${groupNodeId}`, absAmount);
        addToMap(expensesByGroupAndCategory, `${groupNodeId}|${catNodeId}`, absAmount);
      }
    });
  });

  return {
    incomeByAccount,
    ccPaymentsBySourceAndTarget,
    expensesByAccountAndGroup,
    expensesByGroupAndCategory,
    loanPaymentsByCategoryAndAccount,
    totalIncomeMilliunits,
    totalCCPaymentsMilliunits,
    totalLoanPaymentsMilliunits
  };
}

// ---------------------------------------------------------------------------
// Styling functions
// ---------------------------------------------------------------------------

function getAccountColor(account) {
  const groupColors = {
    'Deposit Accounts': '#2196F3',
    'Revolving Credit': '#FF9800',
    'Investments': '#4CAF50',
    'Liabilities': '#E91E63'
  };

  const group = getAccountGroup(account.type);
  return groupColors[group] || '#9E9E9E';
}

function getAccountBorder(account) {
  if (account.closed) {
    return { color: 'rgba(255, 165, 0, 0.8)', width: 2 };
  }
  if (account.deleted) {
    return { color: 'rgba(255, 0, 0, 0.8)', width: 2 };
  }
  return { color: 'white', width: 0.5 };
}

function getCategoryGroupColor(groupName) {
  const colors = ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462',
                  '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f'];
  const hash = groupName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function getCategoryColor(categoryName) {
  const colors = ['#b3e5fc', '#fff9c4', '#e1bee7', '#ffccbc', '#c5e1a5', '#ffe0b2',
                  '#c8e6c9', '#f8bbd0', '#eeeeee', '#d1c4e9', '#dcedc8', '#fff59d'];
  const hash = categoryName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// ---------------------------------------------------------------------------
// Plotly node construction (index-based)
// ---------------------------------------------------------------------------

function buildPlotlyNodes(aggregationData, accountById, categoryGroups, options) {
  const nodes = [];
  const nodeIndexMap = new Map();
  let currentIndex = 0;

  function addNode(id, label, metadata) {
    if (!nodeIndexMap.has(id)) {
      nodeIndexMap.set(id, currentIndex);
      nodes.push({ id, label, ...metadata });
      currentIndex++;
    }
    return nodeIndexMap.get(id);
  }

  // 1. Add asset and credit card account nodes
  for (const [accountId, account] of accountById) {
    const accountGroup = getAccountGroup(account.type);
    const isLiability = accountGroup === 'Liabilities';

    // Skip liability accounts for now (added later)
    if (isLiability) continue;

    // Check if account has activity
    const hasIncome = aggregationData.incomeByAccount.has(accountId);
    const hasExpenses = Array.from(aggregationData.expensesByAccountAndGroup.keys())
      .some(key => key.startsWith(makeAccountNodeId(account) + '|'));
    const hasCCPayments = Array.from(aggregationData.ccPaymentsBySourceAndTarget.keys())
      .some(key => key.includes(accountId));

    if (!hasIncome && !hasExpenses && !hasCCPayments && !options.includeZeroActivity) {
      continue;
    }

    addNode(
      makeAccountNodeId(account),
      account.name,
      {
        type: 'account',
        accountType: account.type,
        accountGroup,
        x: 0.0,
        color: getAccountColor(account),
        opacity: (account.closed || account.deleted) ? 0.5 : 1.0,
        line: getAccountBorder(account)
      }
    );
  }

  // 2. Add category group nodes
  for (const group of categoryGroups) {
    if (group.hidden || group.deleted) continue;
    if (options.excludedGroupSet.has(group.name)) continue;

    // Check if group has activity
    const hasActivity = Array.from(aggregationData.expensesByAccountAndGroup.keys())
      .some(key => key.endsWith(`|${makeGroupNodeId(group.name)}`));

    if (!hasActivity && !options.includeZeroActivity) continue;

    addNode(
      makeGroupNodeId(group.name),
      group.name,
      {
        type: 'categoryGroup',
        x: 0.33,
        color: getCategoryGroupColor(group.name)
      }
    );
  }

  // 3. Add category nodes
  for (const group of categoryGroups) {
    if (group.hidden || group.deleted) continue;
    for (const category of group.categories) {
      if (category.hidden || category.deleted) continue;
      if (options.excludedCategorySet.has(category.name)) continue;

      // Check if category has activity
      const hasActivity = Array.from(aggregationData.expensesByGroupAndCategory.keys())
        .some(key => key.endsWith(`|${makeCategoryNodeId(category.name)}`));

      if (!hasActivity && !options.includeZeroActivity) continue;

      addNode(
        makeCategoryNodeId(category.name),
        category.name,
        {
          type: 'category',
          categoryGroup: group.name,
          x: 0.66,
          color: getCategoryColor(category.name)
        }
      );
    }
  }

  // 4. Add liability account nodes (loans, mortgages)
  for (const [accountId, account] of accountById) {
    const accountGroup = getAccountGroup(account.type);
    if (accountGroup !== 'Liabilities') continue;

    // Check if account has loan payment activity
    const hasActivity = Array.from(aggregationData.loanPaymentsByCategoryAndAccount.keys())
      .some(key => key.endsWith(`|${makeAccountNodeId(account)}`));

    if (!hasActivity) continue;

    addNode(
      makeAccountNodeId(account),
      account.name,
      {
        type: 'account',
        accountType: account.type,
        accountGroup,
        x: 1.0,
        color: getAccountColor(account),
        opacity: (account.closed || account.deleted) ? 0.5 : 1.0
      }
    );
  }

  return { nodes, nodeIndexMap };
}

// ---------------------------------------------------------------------------
// Plotly link construction
// ---------------------------------------------------------------------------

function buildPlotlyLinks(aggregationData, nodeIndexMap, accountById) {
  const links = {
    source: [],
    target: [],
    value: [],
    color: [],
    label: []
  };

  // 1. CC Payment links (Account → Account)
  for (const [key, milliunits] of aggregationData.ccPaymentsBySourceAndTarget) {
    const [sourceAcctId, targetAcctId] = key.split('|');

    // Look up accounts by ID to get their names
    const sourceAcct = accountById.get(sourceAcctId);
    const targetAcct = accountById.get(targetAcctId);

    if (!sourceAcct || !targetAcct) continue;

    const sourceNodeId = makeAccountNodeId(sourceAcct);
    const targetNodeId = makeAccountNodeId(targetAcct);

    const sourceIdx = nodeIndexMap.get(sourceNodeId);
    const targetIdx = nodeIndexMap.get(targetNodeId);

    if (sourceIdx === undefined || targetIdx === undefined) continue;

    links.source.push(sourceIdx);
    links.target.push(targetIdx);
    links.value.push(milliunitsToUSD(milliunits));
    links.color.push('rgba(100, 100, 100, 0.3)');
    links.label.push('CC Payment');
  }

  // 2. Expense links (Account → Group)
  for (const [key, milliunits] of aggregationData.expensesByAccountAndGroup) {
    const [acctNodeId, groupNodeId] = key.split('|');

    const sourceIdx = nodeIndexMap.get(acctNodeId);
    const targetIdx = nodeIndexMap.get(groupNodeId);

    if (sourceIdx === undefined || targetIdx === undefined) continue;

    links.source.push(sourceIdx);
    links.target.push(targetIdx);
    links.value.push(milliunitsToUSD(milliunits));
    links.color.push('rgba(0, 0, 0, 0.2)');
    links.label.push('Expense');
  }

  // 3. Group → Category links
  for (const [key, milliunits] of aggregationData.expensesByGroupAndCategory) {
    const [groupNodeId, catNodeId] = key.split('|');

    const sourceIdx = nodeIndexMap.get(groupNodeId);
    const targetIdx = nodeIndexMap.get(catNodeId);

    if (sourceIdx === undefined || targetIdx === undefined) continue;

    links.source.push(sourceIdx);
    links.target.push(targetIdx);
    links.value.push(milliunitsToUSD(milliunits));
    links.color.push('rgba(0, 0, 0, 0.1)');
    links.label.push('Budget');
  }

  // 4. Loan payment links (Category → Liability Account)
  for (const [key, milliunits] of aggregationData.loanPaymentsByCategoryAndAccount) {
    const [catNodeId, loanAcctNodeId] = key.split('|');

    const sourceIdx = nodeIndexMap.get(catNodeId);
    const targetIdx = nodeIndexMap.get(loanAcctNodeId);

    if (sourceIdx === undefined || targetIdx === undefined) continue;

    links.source.push(sourceIdx);
    links.target.push(targetIdx);
    links.value.push(milliunitsToUSD(milliunits));
    links.color.push('rgba(233, 30, 99, 0.3)');
    links.label.push('Loan Payment');
  }

  return links;
}

// ---------------------------------------------------------------------------
// Plotly output format
// ---------------------------------------------------------------------------

function buildPlotlyOutput(nodes, nodeIndexMap, links, metadata, inputMetadata) {
  const plotlyNode = {
    pad: 20,
    thickness: 25,
    label: nodes.map(n => n.label),
    color: nodes.map(n => n.color),
    x: nodes.map(n => n.x),
    customdata: nodes.map(n => ({
      id: n.id,
      type: n.type,
      accountType: n.accountType,
      accountGroup: n.accountGroup
    })),
    line: {
      color: nodes.map(n => n.line?.color || 'white'),
      width: nodes.map(n => n.line?.width || 0.5)
    },
    hovertemplate: '<b>%{label}</b><br>Total Flow: $%{value:,.2f}<extra></extra>'
  };

  const plotlyData = {
    type: 'sankey',
    orientation: 'h',
    node: plotlyNode,
    link: {
      ...links,
      arrowlen: 15,
      hovertemplate: '%{source.label} → %{target.label}<br>Amount: $%{value:,.2f}<extra></extra>'
    },
    arrangement: 'snap'
  };

  const layout = {
    title: {
      text: 'YNAB Budget Flow',
      font: { size: 24 }
    },
    font: { size: 11 },
    width: 1800,
    height: Math.max(1000, nodes.length * 15),
    plot_bgcolor: '#f8f9fa',
    paper_bgcolor: 'white',
    margin: { t: 100, b: 50, l: 50, r: 50 },
    annotations: [
      {
        text: 'Accounts',
        x: 0.0,
        y: 1.05,
        xref: 'paper',
        yref: 'paper',
        showarrow: false,
        font: { size: 14, color: '#666' },
        xanchor: 'center'
      },
      {
        text: 'Category Groups',
        x: 0.33,
        y: 1.05,
        xref: 'paper',
        yref: 'paper',
        showarrow: false,
        font: { size: 14, color: '#666' },
        xanchor: 'center'
      },
      {
        text: 'Categories',
        x: 0.66,
        y: 1.05,
        xref: 'paper',
        yref: 'paper',
        showarrow: false,
        font: { size: 14, color: '#666' },
        xanchor: 'center'
      },
      {
        text: 'Liabilities',
        x: 1.0,
        y: 1.05,
        xref: 'paper',
        yref: 'paper',
        showarrow: false,
        font: { size: 14, color: '#666' },
        xanchor: 'center'
      }
    ]
  };

  return {
    plotlyData,
    layout,
    config: {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d']
    },
    metadata: {
      ...metadata,
      dateRange: inputMetadata.dateRange || {
        start: inputMetadata.startDate,
        end: inputMetadata.endDate,
        label: path.basename(inputMetadata.inputDir || '')
      },
      incomeMilliunits: inputMetadata.incomeMilliunits,
      expenseMilliunits: inputMetadata.expenseMilliunits,
      deltaMilliunits: inputMetadata.deltaMilliunits,
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      linkCount: links.source.length
    }
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('📊 YNAB → Plotly Sankey Builder\n');

  const args = parseArgs();

  const inputDir = args.inputDir || findLatestYnabData();
  const categoriesFile = path.join(inputDir, 'categories.json');
  const metadataFile = path.join(inputDir, 'metadata.json');
  const transactionsFile = path.join(inputDir, 'transactions.json');
  const accountsFile = path.join(inputDir, 'accounts.json');

  console.log(`Reading from: ${inputDir}`);

  // Verify input files exist
  for (const [label, file] of [
    ['Categories', categoriesFile],
    ['Metadata', metadataFile],
    ['Transactions', transactionsFile],
    ['Accounts', accountsFile]
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(`${label} file not found: ${file}`);
    }
  }

  // Load all data files
  const categoryGroups = readJSON(categoriesFile);
  const metadata = readJSON(metadataFile);
  const transactions = readJSON(transactionsFile);
  const accounts = readJSON(accountsFile);

  console.log(`   ✓ Loaded ${categoryGroups.length} category groups`);
  console.log(`   ✓ Loaded ${transactions.length} transactions`);
  console.log(`   ✓ Loaded ${accounts.length} accounts`);
  console.log(`   ✓ Loaded metadata\n`);

  const excludedGroupSet = new Set(args.excludedGroups);
  const excludedCategorySet = new Set(args.excludedCategories);

  // Build lookup maps
  const accountById = buildAccountMap(accounts);
  const categoryToGroup = buildCategoryToGroupMap(categoryGroups);

  if (args.debug) console.log('Aggregating transactions...');

  // Aggregate transactions
  const aggregationData = aggregateTransactions(transactions, accountById, categoryToGroup, {
    debug: args.debug,
    excludedGroupSet,
    excludedCategorySet
  });

  if (args.debug) {
    console.log(`  Income entries: ${aggregationData.incomeByAccount.size} accounts`);
    console.log(`  CC payments: ${aggregationData.ccPaymentsBySourceAndTarget.size} pairs`);
    console.log(`  Expense account→group links: ${aggregationData.expensesByAccountAndGroup.size}`);
    console.log(`  Group→category links: ${aggregationData.expensesByGroupAndCategory.size}`);
    console.log(`  Category→loan account links: ${aggregationData.loanPaymentsByCategoryAndAccount.size}\n`);
  }

  // Build Plotly nodes and links
  console.log('Building Plotly structure...');

  const { nodes, nodeIndexMap } = buildPlotlyNodes(
    aggregationData,
    accountById,
    categoryGroups,
    {
      excludedGroupSet,
      excludedCategorySet,
      includeZeroActivity: args.includeZeroActivity
    }
  );

  const links = buildPlotlyLinks(aggregationData, nodeIndexMap, accountById);

  console.log(`   ✓ ${nodes.length} nodes`);
  console.log(`   ✓ ${links.source.length} links`);

  // Build output
  const output = buildPlotlyOutput(
    nodes,
    nodeIndexMap,
    links,
    {
      totalIncomeMilliunits: aggregationData.totalIncomeMilliunits,
      totalCCPaymentsMilliunits: aggregationData.totalCCPaymentsMilliunits,
      totalLoanPaymentsMilliunits: aggregationData.totalLoanPaymentsMilliunits
    },
    {
      ...metadata,
      inputDir
    }
  );

  // Determine output path
  const dateLabel = path.basename(inputDir).replace(/\s+/g, '-');
  const outputFile = args.output ||
    path.join(process.cwd(), 'output', 'plotly', `plotly-sankey-${dateLabel}.json`);

  // Ensure output directory exists
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write JSON output
  console.log('Saving output...');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`   ✓ ${outputFile}`);

  console.log('\n✅ Done!');
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
});
