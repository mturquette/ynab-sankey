import config from './config.js';

/**
 * YNAB API Client
 * Documentation: https://api.ynab.com/
 */

class YNABClient {
  constructor(apiToken = config.ynab.apiToken) {
    this.apiToken = apiToken;
    this.apiBase = config.ynab.apiBase;
  }

  /**
   * Makes an authenticated request to the YNAB API
   * @param {string} endpoint - API endpoint (e.g., '/budgets')
   * @returns {Promise<any>} Response data
   * @private
   */
  async _request(endpoint) {
    const url = `${this.apiBase}${endpoint}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            'YNAB API authentication failed. Please check your YNAB_API_TOKEN in .env file.\n' +
            'Get your token from: https://app.ynab.com/settings/developer'
          );
        }

        if (response.status === 404) {
          throw new Error(
            'YNAB API resource not found. Please check your YNAB_BUDGET_ID in .env file.'
          );
        }

        if (response.status === 429) {
          throw new Error(
            'YNAB API rate limit exceeded (200 requests/hour). Please wait and try again.'
          );
        }

        const errorText = await response.text();
        throw new Error(`YNAB API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      return data.data;

    } catch (error) {
      if (error.message.includes('fetch failed') || error.code === 'ENOTFOUND') {
        throw new Error(
          'Failed to connect to YNAB API. Please check your internet connection.'
        );
      }
      throw error;
    }
  }

  /**
   * Gets all budgets for the authenticated user
   * @returns {Promise<Array>} List of budgets
   */
  async getBudgets() {
    const data = await this._request('/budgets');
    return data.budgets;
  }

  /**
   * Gets transactions for a specific budget within a date range
   * @param {string} budgetId - YNAB budget ID
   * @param {string} startDate - Start date in YYYY-MM-DD format
   * @param {string} endDate - End date in YYYY-MM-DD format (optional)
   * @returns {Promise<Array>} List of transactions
   */
  async getTransactions(budgetId, startDate, endDate = null) {
    // YNAB API uses 'since_date' parameter
    let endpoint = `/budgets/${budgetId}/transactions?since_date=${startDate}`;

    const data = await this._request(endpoint);
    let transactions = data.transactions;

    // Filter to end date if provided (YNAB API doesn't have native end date filter)
    if (endDate) {
      transactions = transactions.filter(t => t.date <= endDate);
    }

    // Filter out deleted transactions
    transactions = transactions.filter(t => !t.deleted);

    return transactions;
  }

  /**
   * Gets categories for a specific budget
   * @param {string} budgetId - YNAB budget ID
   * @returns {Promise<Array>} List of category groups with categories
   */
  async getCategories(budgetId) {
    const data = await this._request(`/budgets/${budgetId}/categories`);
    return data.category_groups;
  }

  /**
   * Gets a specific budget by ID
   * @param {string} budgetId - YNAB budget ID
   * @returns {Promise<Object>} Budget details
   */
  async getBudget(budgetId) {
    const data = await this._request(`/budgets/${budgetId}`);
    return data.budget;
  }

  /**
   * Gets all accounts for a specific budget
   * @param {string} budgetId - YNAB budget ID
   * @returns {Promise<Array>} List of accounts
   */
  async getAccounts(budgetId) {
    const data = await this._request(`/budgets/${budgetId}/accounts`);
    return data.accounts;
  }
}

/**
 * Creates and exports a YNAB client instance
 */
export const ynabClient = new YNABClient();

export default YNABClient;
