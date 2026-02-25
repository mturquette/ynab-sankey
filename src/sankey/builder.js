/**
 * Sankey Diagram Builder
 * Converts processed data into Plotly.js Sankey format
 */

/**
 * Builds a YNAB-only Sankey diagram with income/expense split layout
 * Left: Income Sources → Center: Month → Right: Accounts → Category Groups → Categories
 * @param {Object} ynabData - Processed YNAB data from ynab-processor
 * @param {string} dateLabel - Label for the center node (e.g., "February 2026")
 * @returns {Object} Plotly.js Sankey data structure
 */
export function buildYNABSankey(ynabData, dateLabel = 'Budget Period') {
  const nodes = [];
  const links = [];
  let nodeIndex = 0;

  // ===== LEFT SIDE: Income Sources =====
  // Only include income sources with positive amounts
  const incomeSourceIndexMap = new Map();
  ynabData.incomeSources.forEach((source) => {
    if (source.amount > 0) {
      nodes.push({
        label: source.name,
        color: 'rgba(34, 139, 34, 0.8)' // Green for income
      });
      incomeSourceIndexMap.set(source.name, nodeIndex);
      nodeIndex++;
    }
  });

  // ===== CENTER: Month/Period Node =====
  nodes.push({
    label: dateLabel,
    color: 'rgba(100, 100, 100, 0.3)' // Neutral gray
  });
  const centerNodeIndex = nodeIndex++;

  // Create links from income sources to center node
  // Only create links for income sources with positive amounts
  ynabData.incomeSources.forEach((source) => {
    if (source.amount > 0) {
      const sourceIndex = incomeSourceIndexMap.get(source.name);
      links.push({
        source: sourceIndex,
        target: centerNodeIndex,
        value: source.amount,
        customdata: {
          percentage: (source.amount / ynabData.income * 100).toFixed(1),
          amount: source.amount
        }
      });
    }
  });

  // ===== RIGHT SIDE: Account nodes =====
  // Only create account nodes for accounts with positive spending
  const accountIndexMap = new Map(); // Map account ID to node index
  ynabData.accountFlows.forEach((accountFlow) => {
    if (accountFlow.totalSpending > 0) {
      nodes.push({
        label: accountFlow.accountName,
        color: getAccountColor(accountFlow.accountType)
      });
      accountIndexMap.set(accountFlow.accountId, nodeIndex);

      // Link from CENTER node to this account
      links.push({
        source: centerNodeIndex,
        target: nodeIndex,
        value: accountFlow.totalSpending,
        customdata: {
          percentage: (accountFlow.totalSpending / ynabData.totalSpending * 100).toFixed(1),
          accountType: accountFlow.accountType,
          amount: accountFlow.totalSpending
        }
      });

      nodeIndex++;
    }
  });

  // ===== Category Group nodes (aggregated across all accounts) =====
  const categoryGroupIndexMap = new Map(); // Map group name to node index
  const categoryGroupTotals = new Map(); // Track totals per group

  // Collect all unique category groups and their totals
  // Skip groups with non-positive spending (refunds exceeded spending)
  ynabData.accountFlows.forEach((accountFlow) => {
    accountFlow.categoryGroups.forEach((group) => {
      if (group.totalSpending > 0) {
        if (!categoryGroupTotals.has(group.name)) {
          categoryGroupTotals.set(group.name, 0);
        }
        categoryGroupTotals.set(group.name, categoryGroupTotals.get(group.name) + group.totalSpending);
      }
    });
  });

  // Create nodes for category groups
  let groupColorIndex = 0;
  Array.from(categoryGroupTotals.entries())
    .sort((a, b) => b[1] - a[1]) // Sort by total spending
    .forEach(([groupName, total]) => {
      nodes.push({
        label: groupName,
        color: getCategoryGroupColor(groupName, groupColorIndex++)
      });
      categoryGroupIndexMap.set(groupName, nodeIndex);
      nodeIndex++;
    });

  // ===== Category nodes (rightmost - aggregated across all accounts and groups) =====
  const categoryIndexMap = new Map(); // Map category name to node index

  // Only create nodes for categories with positive spending
  // (skip categories where refunds exceeded spending)
  ynabData.categories.forEach((category, idx) => {
    if (category.amount > 0) {
      nodes.push({
        label: category.name,
        color: getCategoryColor(category.name, idx)
      });
      categoryIndexMap.set(category.name, nodeIndex);
      nodeIndex++;
    }
  });

  // Create links: Accounts → Category Groups
  // Skip groups with non-positive spending
  ynabData.accountFlows.forEach((accountFlow) => {
    const accountNodeIndex = accountIndexMap.get(accountFlow.accountId);

    // Skip if account node doesn't exist (filtered out due to non-positive spending)
    if (accountNodeIndex === undefined) {
      return;
    }

    accountFlow.categoryGroups.forEach((group) => {
      const groupNodeIndex = categoryGroupIndexMap.get(group.name);

      // Ensure both nodes exist and spending is positive
      if (groupNodeIndex !== undefined && group.totalSpending > 0) {
        links.push({
          source: accountNodeIndex,
          target: groupNodeIndex,
          value: group.totalSpending,
          customdata: {
            percentage: (group.totalSpending / accountFlow.totalSpending * 100).toFixed(1),
            accountName: accountFlow.accountName,
            amount: group.totalSpending
          }
        });
      }
    });
  });

  // Create links: Category Groups → Categories
  // Build a map to aggregate category amounts within each group across all accounts
  const groupCategoryTotals = new Map(); // Map<groupName, Map<categoryName, totalAmount>>

  ynabData.accountFlows.forEach((accountFlow) => {
    accountFlow.categoryGroups.forEach((group) => {
      if (!groupCategoryTotals.has(group.name)) {
        groupCategoryTotals.set(group.name, new Map());
      }
      const categoryMap = groupCategoryTotals.get(group.name);

      group.categories.forEach((category) => {
        // Only aggregate categories with positive amounts
        if (category.amount > 0) {
          if (!categoryMap.has(category.name)) {
            categoryMap.set(category.name, 0);
          }
          categoryMap.set(category.name, categoryMap.get(category.name) + category.amount);
        }
      });
    });
  });

  // Now create the links with aggregated totals
  // Skip categories with non-positive amounts
  groupCategoryTotals.forEach((categoryMap, groupName) => {
    const groupNodeIndex = categoryGroupIndexMap.get(groupName);
    const groupTotal = categoryGroupTotals.get(groupName);

    categoryMap.forEach((totalAmount, categoryName) => {
      const categoryNodeIndex = categoryIndexMap.get(categoryName);

      if (groupNodeIndex !== undefined && categoryNodeIndex !== undefined && totalAmount > 0) {
        links.push({
          source: groupNodeIndex,
          target: categoryNodeIndex,
          value: totalAmount,
          customdata: {
            percentage: (totalAmount / categoryGroupTotals.get(groupName) * 100).toFixed(1),
            groupName: groupName,
            amount: totalAmount
          }
        });
      }
    });
  });

  // Calculate savings for metadata (but don't add to diagram)
  const savings = ynabData.income - ynabData.totalSpending;

  return {
    nodes,
    links,
    metadata: {
      income: ynabData.income,
      totalSpending: ynabData.totalSpending,
      savings: savings,
      categoryCount: ynabData.categories.length,
      categoryGroupCount: categoryGroupTotals.size,
      accountCount: ynabData.accountFlows.length,
      transactionCount: ynabData.transactionCount
    }
  };
}


/**
 * Gets a color for an account based on its type
 * @param {string} accountType - YNAB account type
 * @returns {string} RGBA color string
 */
function getAccountColor(accountType) {
  const accountTypeColors = {
    'checking': 'rgba(52, 152, 219, 0.8)',      // Blue
    'savings': 'rgba(46, 204, 113, 0.8)',       // Green
    'creditCard': 'rgba(231, 76, 60, 0.8)',     // Red
    'cash': 'rgba(241, 196, 15, 0.8)',          // Yellow
    'lineOfCredit': 'rgba(155, 89, 182, 0.8)',  // Purple
    'otherAsset': 'rgba(149, 165, 166, 0.8)',   // Gray
    'otherLiability': 'rgba(236, 112, 99, 0.8)', // Light red
    'mortgage': 'rgba(142, 68, 173, 0.8)',      // Dark purple
    'autoLoan': 'rgba(230, 126, 34, 0.8)',      // Orange
    'studentLoan': 'rgba(22, 160, 133, 0.8)',   // Teal
    'personalLoan': 'rgba(211, 84, 0, 0.8)',    // Dark orange
    'medicalDebt': 'rgba(192, 57, 43, 0.8)',    // Dark red
    'otherDebt': 'rgba(189, 195, 199, 0.8)'     // Light gray
  };

  return accountTypeColors[accountType] || 'rgba(127, 140, 141, 0.8)'; // Default gray
}

/**
 * Gets a color for a category group
 * @param {string} groupName - Name of the category group
 * @param {number} index - Index in the group list
 * @returns {string} RGBA color string
 */
function getCategoryGroupColor(groupName, index) {
  // Predefined colors for common category groups
  const groupColors = {
    'Monthly Bills': 'rgba(192, 57, 43, 0.7)',          // Red
    'True Expenses': 'rgba(230, 126, 34, 0.7)',         // Orange
    'Debt Payments': 'rgba(155, 89, 182, 0.7)',         // Purple
    'Quality of Life Goals': 'rgba(52, 152, 219, 0.7)', // Blue
    'Splurge': 'rgba(241, 196, 15, 0.7)',               // Yellow
    'Giving': 'rgba(46, 204, 113, 0.7)',                // Green
    'Savings Goals': 'rgba(26, 188, 156, 0.7)',         // Teal
    'Investments': 'rgba(52, 73, 94, 0.7)',             // Dark blue-gray
  };

  // Check if group name matches any predefined colors
  for (const [key, color] of Object.entries(groupColors)) {
    if (groupName.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }

  // Generate a color based on index
  const hue = (index * 50) % 360; // Spread out colors
  return `hsla(${hue}, 55%, 55%, 0.7)`;
}

/**
 * Gets a color for a category based on its name and index
 * @param {string} categoryName - Name of the category
 * @param {number} index - Index in the category list
 * @returns {string} RGBA color string
 */
function getCategoryColor(categoryName, index) {
  // Predefined colors for common categories
  const categoryColors = {
    'Groceries': 'rgba(255, 140, 0, 0.8)',      // Dark orange
    'Rent': 'rgba(139, 0, 139, 0.8)',           // Dark magenta
    'Mortgage': 'rgba(139, 0, 139, 0.8)',       // Dark magenta
    'Utilities': 'rgba(70, 130, 180, 0.8)',     // Steel blue
    'Transportation': 'rgba(255, 215, 0, 0.8)', // Gold
    'Gas': 'rgba(255, 215, 0, 0.8)',            // Gold
    'Dining': 'rgba(255, 99, 71, 0.8)',         // Tomato
    'Restaurants': 'rgba(255, 99, 71, 0.8)',    // Tomato
    'Entertainment': 'rgba(147, 112, 219, 0.8)', // Medium purple
    'Healthcare': 'rgba(220, 20, 60, 0.8)',     // Crimson
    'Insurance': 'rgba(105, 105, 105, 0.8)',    // Dim gray
    'Shopping': 'rgba(255, 20, 147, 0.8)',      // Deep pink
    'Subscriptions': 'rgba(138, 43, 226, 0.8)', // Blue violet
    'Savings': 'rgba(65, 105, 225, 0.8)',       // Royal blue
    'Investments': 'rgba(0, 128, 128, 0.8)',    // Teal
  };

  // Check if category name matches any predefined colors
  for (const [key, color] of Object.entries(categoryColors)) {
    if (categoryName.toLowerCase().includes(key.toLowerCase())) {
      return color;
    }
  }

  // Generate a color based on index
  const hue = (index * 137.5) % 360; // Golden angle for good distribution
  return `hsla(${hue}, 60%, 50%, 0.8)`;
}

/**
 * Validates Sankey data structure
 * @param {Object} sankeyData - Output from buildYNABSankey or buildFullSankey
 * @returns {Object} Validation result
 */
export function validateSankeyData(sankeyData) {
  const errors = [];

  if (!sankeyData.nodes || sankeyData.nodes.length === 0) {
    errors.push('No nodes in Sankey data');
  }

  if (!sankeyData.links || sankeyData.links.length === 0) {
    errors.push('No links in Sankey data');
  }

  // Validate that all link sources and targets refer to valid nodes
  sankeyData.links.forEach((link, i) => {
    if (link.source < 0 || link.source >= sankeyData.nodes.length) {
      errors.push(`Link ${i} has invalid source index: ${link.source}`);
    }
    if (link.target < 0 || link.target >= sankeyData.nodes.length) {
      errors.push(`Link ${i} has invalid target index: ${link.target}`);
    }
    if (link.value <= 0) {
      errors.push(`Link ${i} has invalid value: ${link.value}`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors
  };
}
