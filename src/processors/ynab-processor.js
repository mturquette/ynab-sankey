/**
 * YNAB Data Processor
 * Transforms YNAB transactions into aggregated spending data for Sankey diagrams
 */

/**
 * Converts YNAB milliunits to dollars
 * YNAB stores amounts in milliunits (1000 milliunits = $1.00)
 * @param {number} milliunits - Amount in milliunits
 * @returns {number} Amount in dollars
 */
function milliunitsToDollars(milliunits) {
  return milliunits / 1000;
}

/**
 * Processes YNAB transactions into income and spending by category
 * @param {Array} transactions - Raw YNAB transactions
 * @param {Object} options - Processing options
 * @param {boolean} options.debug - Enable debug logging
 * @param {Array} options.accounts - YNAB accounts (for filtering tracking accounts)
 * @param {Array} options.categoryGroups - YNAB category groups (for hierarchy)
 * @returns {Object} Processed data with income and spending categories
 */
export function processYNABTransactions(transactions, options = {}) {
  const { debug = false, accounts = [], categoryGroups = [] } = options;

  // Build account lookup map
  const accountMap = new Map();
  accounts.forEach(account => {
    accountMap.set(account.id, {
      name: account.name,
      type: account.type,
      onBudget: account.on_budget,
      closed: account.closed
    });
  });

  // Build category to category group map
  const categoryToGroupMap = new Map();
  const categoryGroupMap = new Map();
  categoryGroups.forEach(group => {
    categoryGroupMap.set(group.id, {
      name: group.name,
      hidden: group.hidden
    });

    if (group.categories) {
      group.categories.forEach(category => {
        categoryToGroupMap.set(category.name, {
          groupId: group.id,
          groupName: group.name,
          hidden: category.hidden || group.hidden
        });
      });
    }
  });

  let totalIncome = 0;
  const incomeBySource = new Map(); // Track income by payee/source
  const categorySpending = new Map();
  const categoryTransactionCounts = new Map();

  // Track spending by account, category group, and category
  const accountTotals = new Map(); // Map<accountId, totalAmount>
  const accountGroupSpending = new Map(); // Map<accountId, Map<groupName, amount>>
  const accountGroupCategorySpending = new Map(); // Map<accountId, Map<groupName, Map<categoryName, amount>>>

  // Tracking for debug/validation
  let skippedTransfers = 0;
  let skippedDeleted = 0;
  let skippedOffBudget = 0;
  let processedIncome = 0;
  let processedSpending = 0;
  let splitTransactionsProcessed = 0;

  // Process each transaction
  for (const transaction of transactions) {
    // Skip deleted or pending transactions
    if (transaction.deleted) {
      skippedDeleted++;
      continue;
    }

    // Skip transactions from off-budget (tracking) accounts
    const account = accountMap.get(transaction.account_id);
    if (account && !account.onBudget) {
      skippedOffBudget++;
      if (debug) {
        console.log(`  [SKIP OFF-BUDGET] ${account.name}: ${transaction.payee_name || 'Unknown'} $${milliunitsToDollars(transaction.amount).toFixed(2)}`);
      }
      continue;
    }

    // Handle transfer transactions
    // Transfers between on-budget accounts should be skipped
    // But transfers TO off-budget accounts (loans, mortgages) are real spending
    if (transaction.transfer_account_id) {
      const sourceAccount = accountMap.get(transaction.account_id);
      const targetAccount = accountMap.get(transaction.transfer_account_id);

      // If source is on-budget and target is off-budget, this is spending (loan/mortgage payment)
      if (sourceAccount?.onBudget && targetAccount && !targetAccount.onBudget) {
        const amountInDollars = milliunitsToDollars(transaction.amount);

        // We're looking at this from the source account's perspective
        // Money leaving the on-budget account is negative
        if (amountInDollars < 0) {
          const spendingAmount = Math.abs(amountInDollars);
          const categoryName = targetAccount.name; // Use target account name as category

          aggregateSpending(categoryName, spendingAmount, categorySpending, categoryTransactionCounts);
          trackAccountGroupCategorySpending(
            transaction.account_id,
            'Loan & Mortgage Payments',
            categoryName,
            spendingAmount,
            accountTotals,
            accountGroupSpending,
            accountGroupCategorySpending
          );
          processedSpending++;

          if (debug) {
            console.log(`  [LOAN/MORTGAGE PAYMENT] ${categoryName}: $${spendingAmount.toFixed(2)} from ${sourceAccount.name}`);
          }
          continue;
        }
      }

      // All other transfers (on-budget to on-budget, off-budget to on-budget) should be skipped
      skippedTransfers++;
      if (debug) {
        console.log(`  [SKIP TRANSFER] ${transaction.payee_name}: $${milliunitsToDollars(transaction.amount).toFixed(2)} (${sourceAccount?.name || 'Unknown'} → ${targetAccount?.name || 'Unknown'})`);
      }
      continue;
    }

    // Handle split transactions - process subtransactions instead of parent
    if (transaction.subtransactions && transaction.subtransactions.length > 0) {
      splitTransactionsProcessed++;

      for (const subtrans of transaction.subtransactions) {
        if (subtrans.deleted || subtrans.transfer_account_id) {
          continue;
        }

        const subAmount = milliunitsToDollars(subtrans.amount);
        const categoryName = subtrans.category_name || 'Uncategorized';

        // Skip internal categories
        if (shouldSkipCategory(categoryName)) {
          continue;
        }

        // INCOME: Category starts with "Inflow:" or is "Deferred Income SubCategory"
        if (categoryName.startsWith('Inflow:') || categoryName === 'Deferred Income SubCategory') {
          totalIncome += subAmount;
          processedIncome++;

          // Track income by source
          const incomeSource = transaction.payee_name || 'Other Income';
          if (incomeBySource.has(incomeSource)) {
            incomeBySource.set(incomeSource, incomeBySource.get(incomeSource) + subAmount);
          } else {
            incomeBySource.set(incomeSource, subAmount);
          }

          if (debug) {
            console.log(`  [SPLIT INCOME] ${incomeSource}: $${subAmount.toFixed(2)}`);
          }
        }
        // SPENDING-RELATED: All other categories
        else {
          const groupInfo = categoryToGroupMap.get(categoryName);

          if (subAmount < 0) {
            // Negative amount = Spending
            const spendingAmount = Math.abs(subAmount);
            aggregateSpending(categoryName, spendingAmount, categorySpending, categoryTransactionCounts);
            trackAccountGroupCategorySpending(
              transaction.account_id,
              groupInfo?.groupName || 'Uncategorized',
              categoryName,
              spendingAmount,
              accountTotals,
              accountGroupSpending,
              accountGroupCategorySpending
            );
            processedSpending++;

            if (debug) {
              console.log(`  [SPLIT SPENDING] ${categoryName}: $${spendingAmount.toFixed(2)}`);
            }
          } else {
            // Positive amount = Refund/Reimbursement (reduces spending)
            aggregateSpending(categoryName, -subAmount, categorySpending, categoryTransactionCounts);
            trackAccountGroupCategorySpending(
              transaction.account_id,
              groupInfo?.groupName || 'Uncategorized',
              categoryName,
              -subAmount,
              accountTotals,
              accountGroupSpending,
              accountGroupCategorySpending
            );
            processedSpending++;

            if (debug) {
              console.log(`  [SPLIT REFUND/REIMBURSEMENT] ${categoryName}: -$${subAmount.toFixed(2)}`);
            }
          }
        }
      }

      continue; // Don't process the parent transaction
    }

    // Process regular transactions
    // Check CATEGORY first to determine transaction type
    const amountInDollars = milliunitsToDollars(transaction.amount);
    const categoryName = transaction.category_name || 'Uncategorized';

    // Skip internal categories
    if (shouldSkipCategory(categoryName)) {
      continue;
    }

    // INCOME: Category starts with "Inflow:" or is "Deferred Income SubCategory"
    if (categoryName.startsWith('Inflow:') || categoryName === 'Deferred Income SubCategory') {
      totalIncome += amountInDollars;
      processedIncome++;

      // Track income by source
      const incomeSource = transaction.payee_name || 'Other Income';
      if (incomeBySource.has(incomeSource)) {
        incomeBySource.set(incomeSource, incomeBySource.get(incomeSource) + amountInDollars);
      } else {
        incomeBySource.set(incomeSource, amountInDollars);
      }

      if (debug) {
        const acct = accountMap.get(transaction.account_id);
        console.log(`  [INCOME] ${incomeSource}: $${amountInDollars.toFixed(2)} (${acct?.name || 'Unknown account'})`);
      }
    }
    // SPENDING-RELATED: All other categories
    else {
      const groupInfo = categoryToGroupMap.get(categoryName);

      if (amountInDollars < 0) {
        // Negative amount = Spending
        const spendingAmount = Math.abs(amountInDollars);
        aggregateSpending(categoryName, spendingAmount, categorySpending, categoryTransactionCounts);
        trackAccountGroupCategorySpending(
          transaction.account_id,
          groupInfo?.groupName || 'Uncategorized',
          categoryName,
          spendingAmount,
          accountTotals,
          accountGroupSpending,
          accountGroupCategorySpending
        );
        processedSpending++;

        if (debug) {
          const acct = accountMap.get(transaction.account_id);
          console.log(`  [SPENDING] ${categoryName}: $${spendingAmount.toFixed(2)} - ${transaction.payee_name || 'Unknown'} (${acct?.name || 'Unknown account'})`);
        }
      } else {
        // Positive amount = Refund/Reimbursement (reduces spending)
        aggregateSpending(categoryName, -amountInDollars, categorySpending, categoryTransactionCounts);
        trackAccountGroupCategorySpending(
          transaction.account_id,
          groupInfo?.groupName || 'Uncategorized',
          categoryName,
          -amountInDollars,
          accountTotals,
          accountGroupSpending,
          accountGroupCategorySpending
        );
        processedSpending++;

        if (debug) {
          const acct = accountMap.get(transaction.account_id);
          console.log(`  [REFUND/REIMBURSEMENT] ${categoryName}: -$${amountInDollars.toFixed(2)} from ${transaction.payee_name || 'Unknown'} (${acct?.name || 'Unknown account'})`);
        }
      }
    }
  }

  // Log summary if debug enabled
  if (debug) {
    console.log('\n=== Processing Summary ===');
    console.log(`Total transactions: ${transactions.length}`);
    console.log(`Skipped (deleted): ${skippedDeleted}`);
    console.log(`Skipped (off-budget/tracking): ${skippedOffBudget}`);
    console.log(`Skipped (transfers): ${skippedTransfers}`);
    console.log(`Split transactions: ${splitTransactionsProcessed}`);
    console.log(`Income transactions: ${processedIncome}`);
    console.log(`Spending transactions: ${processedSpending}`);
    console.log('==========================\n');
  }

  // Convert Map to sorted array of categories
  const categories = Array.from(categorySpending.entries())
    .map(([name, amount]) => ({
      name,
      amount: Math.round(amount * 100) / 100, // Round to 2 decimal places
      transactionCount: categoryTransactionCounts.get(name),
      percentage: 0 // Will be calculated later
    }))
    .sort((a, b) => b.amount - a.amount); // Sort by amount descending

  // Calculate percentages
  const totalSpending = categories.reduce((sum, cat) => sum + cat.amount, 0);
  categories.forEach(cat => {
    cat.percentage = totalSpending > 0 ? (cat.amount / totalSpending * 100) : 0;
    cat.percentage = Math.round(cat.percentage * 10) / 10; // Round to 1 decimal
  });

  // Build account flows data with category group hierarchy
  const accountFlows = Array.from(accountGroupCategorySpending.entries())
    .map(([accountId, groupMap]) => {
      const account = accountMap.get(accountId);

      // Build category groups for this account
      const categoryGroups = Array.from(groupMap.entries())
        .map(([groupName, categoryMap]) => {
          const categories = Array.from(categoryMap.entries())
            .map(([categoryName, amount]) => ({
              name: categoryName,
              amount: Math.round(amount * 100) / 100
            }))
            .sort((a, b) => b.amount - a.amount);

          const groupTotal = categories.reduce((sum, cat) => sum + cat.amount, 0);

          return {
            name: groupName,
            totalSpending: Math.round(groupTotal * 100) / 100,
            categories
          };
        })
        .sort((a, b) => b.totalSpending - a.totalSpending);

      return {
        accountId,
        accountName: account?.name || 'Unknown Account',
        accountType: account?.type || 'unknown',
        totalSpending: Math.round(accountTotals.get(accountId) * 100) / 100,
        categoryGroups
      };
    })
    .sort((a, b) => b.totalSpending - a.totalSpending);

  // Build income sources array
  const incomeSources = Array.from(incomeBySource.entries())
    .map(([name, amount]) => ({
      name,
      amount: Math.round(amount * 100) / 100
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    income: Math.round(totalIncome * 100) / 100,
    totalSpending: Math.round(totalSpending * 100) / 100,
    incomeSources, // Income broken down by source (payee)
    categories,
    accountFlows, // Spending grouped by account → category group → category
    transactionCount: processedIncome + processedSpending,
    savingsRate: totalIncome > 0 ? ((totalIncome - totalSpending) / totalIncome * 100) : 0,
    debug: debug ? {
      skippedTransfers,
      skippedDeleted,
      skippedOffBudget,
      splitTransactionsProcessed,
      processedIncome,
      processedSpending
    } : undefined
  };
}

/**
 * Checks if a category should be skipped
 * Note: "Inflow:" categories are NOT skipped - they're processed as income
 * @param {string} categoryName - Category name to check
 * @returns {boolean} True if should skip
 */
function shouldSkipCategory(categoryName) {
  return (
    categoryName === 'Hidden' ||
    categoryName === 'Uncategorized Transactions' // YNAB's internal uncategorized holder
  );
}

/**
 * Aggregates spending for a category
 * @param {string} categoryName - Category name
 * @param {number} amount - Amount to add
 * @param {Map} categorySpending - Map of category totals
 * @param {Map} categoryTransactionCounts - Map of transaction counts
 */
function aggregateSpending(categoryName, amount, categorySpending, categoryTransactionCounts) {
  if (categorySpending.has(categoryName)) {
    categorySpending.set(categoryName, categorySpending.get(categoryName) + amount);
    categoryTransactionCounts.set(categoryName, categoryTransactionCounts.get(categoryName) + 1);
  } else {
    categorySpending.set(categoryName, amount);
    categoryTransactionCounts.set(categoryName, 1);
  }
}

/**
 * Tracks spending by account, category group, and category
 * @param {string} accountId - Account ID
 * @param {string} groupName - Category group name
 * @param {string} categoryName - Category name
 * @param {number} amount - Amount to add
 * @param {Map} accountTotals - Map of account -> total amount
 * @param {Map} accountGroupSpending - Map of account -> group -> amount
 * @param {Map} accountGroupCategorySpending - Map of account -> group -> category -> amount
 */
function trackAccountGroupCategorySpending(
  accountId,
  groupName,
  categoryName,
  amount,
  accountTotals,
  accountGroupSpending,
  accountGroupCategorySpending
) {
  // Initialize account's group map if needed
  if (!accountGroupCategorySpending.has(accountId)) {
    accountGroupCategorySpending.set(accountId, new Map());
  }

  const groupMap = accountGroupCategorySpending.get(accountId);

  // Initialize group's category map if needed
  if (!groupMap.has(groupName)) {
    groupMap.set(groupName, new Map());
  }

  const categoryMap = groupMap.get(groupName);

  // Add to category total for this account+group
  if (categoryMap.has(categoryName)) {
    categoryMap.set(categoryName, categoryMap.get(categoryName) + amount);
  } else {
    categoryMap.set(categoryName, amount);
  }

  // Track group totals
  if (!accountGroupSpending.has(accountId)) {
    accountGroupSpending.set(accountId, new Map());
  }
  const accountGroups = accountGroupSpending.get(accountId);
  if (accountGroups.has(groupName)) {
    accountGroups.set(groupName, accountGroups.get(groupName) + amount);
  } else {
    accountGroups.set(groupName, amount);
  }

  // Add to account total
  if (accountTotals.has(accountId)) {
    accountTotals.set(accountId, accountTotals.get(accountId) + amount);
  } else {
    accountTotals.set(accountId, amount);
  }
}

/**
 * Validates processed YNAB data
 * @param {Object} processedData - Output from processYNABTransactions
 * @returns {Object} Validation result with any warnings
 */
export function validateYNABData(processedData) {
  const warnings = [];

  if (processedData.income === 0) {
    warnings.push('No income found in the selected date range. This might indicate missing transactions or an incorrect date range.');
  }

  if (processedData.categories.length === 0) {
    warnings.push('No spending categories found. This might indicate missing transactions or all transactions are uncategorized.');
  }

  if (processedData.totalSpending > processedData.income * 1.1) {
    warnings.push(`Spending ($${processedData.totalSpending}) exceeds income ($${processedData.income}) by more than 10%. You may be spending from savings, or there may be untracked income.`);
  }

  const uncategorized = processedData.categories.find(cat => cat.name === 'Uncategorized');
  if (uncategorized && uncategorized.percentage > 20) {
    warnings.push(`${uncategorized.percentage}% of spending is uncategorized. Consider categorizing these transactions in YNAB.`);
  }

  return {
    isValid: warnings.length === 0,
    warnings
  };
}

/**
 * Gets a summary of processed data for display
 * @param {Object} processedData - Output from processYNABTransactions
 * @returns {string} Human-readable summary
 */
export function getSummary(processedData) {
  const { income, totalSpending, categories, savingsRate } = processedData;
  const savings = income - totalSpending;

  return [
    `Income: $${income.toLocaleString()}`,
    `Spending: $${totalSpending.toLocaleString()}`,
    `Savings: $${savings.toLocaleString()} (${savingsRate.toFixed(1)}%)`,
    `Categories: ${categories.length}`,
    `Top category: ${categories[0]?.name || 'None'} ($${categories[0]?.amount.toLocaleString() || 0})`
  ].join('\n');
}
