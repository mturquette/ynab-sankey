/**
 * Centralized configuration for YNAB Sankey diagram
 * Colors, settings, and helpers for consistent styling
 */

// =============================================================================
// Color Palette
// =============================================================================

export const COLORS = {
  // Account groups (left side of diagram)
  depositAccounts: '#2196F3',      // Blue - checking, savings
  revolvingCredit: '#FF9800',      // Orange - credit cards
  investments: '#9C27B0',          // Purple - investment accounts
  liabilities: '#E91E63',          // Pink - loans, mortgages

  // Flow types
  income: '#4CAF50',               // Green - money coming in
  expense: '#78909C',              // Blue-gray - general expenses
  ccPayment: '#FF9800',            // Orange - credit card payments
  loanPayment: '#E91E63',          // Pink - loan/mortgage payments
  transfer: '#607D8B',             // Gray - internal transfers

  // Category groups (middle column)
  categoryGroup: '#546E7A',        // Dark blue-gray

  // Categories (right side before liabilities)
  category: '#78909C',             // Blue-gray

  // Special
  inflow: '#2E7D32',               // Dark green - Ready to Assign
};

// =============================================================================
// Account Group Configuration
// =============================================================================

export const ACCOUNT_GROUPS = {
  'Deposit Accounts': {
    types: ['checking', 'savings'],
    color: COLORS.depositAccounts
  },
  'Revolving Credit': {
    types: ['creditCard'],
    color: COLORS.revolvingCredit
  },
  'Investments': {
    types: ['otherAsset'],
    color: COLORS.investments
  },
  'Liabilities': {
    types: ['autoLoan', 'mortgage', 'otherLiability', 'personalLoan'],
    color: COLORS.liabilities
  }
};

// =============================================================================
// Link Styling
// =============================================================================

export const LINK_OPACITY = 0.4;

/**
 * Convert hex color to rgba with specified opacity
 * @param {string} hexColor - Hex color code (e.g., '#2196F3')
 * @param {number} opacity - Opacity value 0-1 (default: LINK_OPACITY)
 * @returns {string} rgba color string
 */
export function getLinkColor(hexColor, opacity = LINK_OPACITY) {
  // Handle rgba passthrough
  if (hexColor.startsWith('rgba')) {
    return hexColor;
  }

  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Get link color based on flow type
 * @param {string} flowType - Type of flow: 'expense', 'ccPayment', 'loanPayment', 'income'
 * @returns {string} rgba color for the link
 */
export function getLinkColorByType(flowType) {
  const colorMap = {
    expense: COLORS.expense,
    ccPayment: COLORS.ccPayment,
    loanPayment: COLORS.loanPayment,
    income: COLORS.income,
    transfer: COLORS.transfer
  };

  const color = colorMap[flowType] || COLORS.expense;
  return getLinkColor(color);
}

// =============================================================================
// Chart Configuration
// =============================================================================

export const CHART_CONFIG = {
  nodeThickness: 20,
  nodePadding: 15,
  nodeLineWidth: 2,
  nodeLineColor: 'white',
  arrowLength: 15,
  containerMaxWidth: 1600,
  chartMinHeight: 500,
  chartMaxHeight: 1200
};

// =============================================================================
// Legend Items (for display in rendered HTML)
// =============================================================================

export const LEGEND_ITEMS = [
  { color: COLORS.depositAccounts, label: 'Deposit Accounts' },
  { color: COLORS.revolvingCredit, label: 'Revolving Credit' },
  { color: COLORS.investments, label: 'Investments' },
  { color: COLORS.liabilities, label: 'Liabilities' },
  { color: COLORS.income, label: 'Income' },
  { color: COLORS.expense, label: 'Expenses' }
];
