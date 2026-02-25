/**
 * Date utility functions for generating date ranges
 */

/**
 * Formats a date as YYYY-MM-DD string
 * @param {Date} date - The date to format
 * @returns {string} Date in YYYY-MM-DD format
 */
export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Gets the first day of the current month
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getFirstDayOfMonth() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return formatDate(firstDay);
}

/**
 * Gets today's date
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getToday() {
  return formatDate(new Date());
}

/**
 * Gets the first day of the current year
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getFirstDayOfYear() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), 0, 1);
  return formatDate(firstDay);
}

/**
 * Gets date range based on range type
 * @param {string} range - Range type ('month', 'ytd', 'YYYY-MM-DD', or 'YYYY-MM-DD:YYYY-MM-DD')
 * @returns {{startDate: string, endDate: string, label: string}}
 */
export function getDateRange(range = 'month') {
  const today = getToday();

  switch (range.toLowerCase()) {
    case 'month':
      return {
        startDate: getFirstDayOfMonth(),
        endDate: today,
        label: getCurrentMonthLabel()
      };

    case 'ytd':
    case 'year':
      return {
        startDate: getFirstDayOfYear(),
        endDate: today,
        label: `YTD ${new Date().getFullYear()}`
      };

    default:
      // Check for YYYY-MM-DD:YYYY-MM-DD format (arbitrary range)
      if (/^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(range)) {
        const [startDate, endDate] = range.split(':');
        return {
          startDate,
          endDate,
          label: formatDateRangeLabel(startDate, endDate)
        };
      }

      // Check for single YYYY-MM-DD format (from date to today)
      if (/^\d{4}-\d{2}-\d{2}$/.test(range)) {
        return {
          startDate: range,
          endDate: today,
          label: `${range} to ${today}`
        };
      }

      // Default to current month if invalid format
      console.warn(`Invalid range format: ${range}. Defaulting to current month.`);
      return {
        startDate: getFirstDayOfMonth(),
        endDate: today,
        label: getCurrentMonthLabel()
      };
  }
}

/**
 * Gets a human-readable label for the current month
 * @returns {string} Format: "February 2026"
 */
export function getCurrentMonthLabel() {
  const now = new Date();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
}

/**
 * Formats a date range into a human-readable label
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {string} Formatted label (e.g., "January - March 2026" or "Dec 2025 - Feb 2026")
 */
export function formatDateRangeLabel(startDate, endDate) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const shortMonthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);

  // Same year - use full month names
  if (startYear === endYear) {
    // Same month - use day range
    if (startMonth === endMonth) {
      return `${monthNames[startMonth - 1]} ${startDay}-${endDay}, ${startYear}`;
    }
    // Different months, same year
    return `${monthNames[startMonth - 1]} - ${monthNames[endMonth - 1]} ${startYear}`;
  }

  // Different years - use short month names with years
  return `${shortMonthNames[startMonth - 1]} ${startYear} - ${shortMonthNames[endMonth - 1]} ${endYear}`;
}

/**
 * Generates a filename-safe timestamp
 * @param {string} range - Range type for the filename
 * @returns {string} Format: "2026-02", "ytd-2026", or "2026-01-01_2026-02-28"
 */
export function getFilenameTimestamp(range = 'month') {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  if (range.toLowerCase() === 'ytd' || range.toLowerCase() === 'year') {
    return `ytd-${year}`;
  }

  // Check for YYYY-MM-DD:YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(range)) {
    const [startDate, endDate] = range.split(':');
    return `${startDate}_${endDate}`;
  }

  // Check for single YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(range)) {
    return `${range}_${year}-${month}-${String(now.getDate()).padStart(2, '0')}`;
  }

  // Default to current month
  return `${year}-${month}`;
}
