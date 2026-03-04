import { join } from 'path';
import { readdirSync, rmSync } from 'fs';
import { fileExists, readJSON, getFileModTime } from './file-io.js';

/**
 * Cache Manager
 * Handles cache validation and path generation for cached data files
 */

/**
 * Generates a cache key from a date range
 * @param {Object} dateRange - Date range object with startDate and endDate
 * @param {string} dateRange.startDate - Start date in YYYY-MM-DD format
 * @param {string} dateRange.endDate - End date in YYYY-MM-DD format
 * @returns {string} Cache key (e.g., "2026-02" or "2026-01-01_2026-02-28")
 */
export function getCacheKey(dateRange) {
  const { startDate, endDate } = dateRange;

  // Extract year and month from start date
  const [startYear, startMonth] = startDate.split('-');
  const [endYear, endMonth] = endDate.split('-');

  // If it's a single month range, use YYYY-MM format
  if (startYear === endYear && startMonth === endMonth) {
    return `${startYear}-${startMonth}`;
  }

  // For arbitrary ranges, use start_end format
  return `${startDate}_${endDate}`;
}

/**
 * Gets the cache directory path for a date range
 * @param {Object} dateRange - Date range object
 * @param {string} dataType - Type of data: 'ynab' or 'plotly'
 * @returns {string} Full path to cache directory
 */
export function getCachePath(dateRange, dataType = 'ynab') {
  const cacheKey = getCacheKey(dateRange);
  const baseDir = process.cwd();

  if (dataType === 'ynab') {
    return join(baseDir, 'output', 'ynab', cacheKey);
  } else if (dataType === 'plotly') {
    return join(baseDir, 'output', 'plotly', cacheKey);
  }

  throw new Error(`Invalid dataType: ${dataType}. Must be 'ynab' or 'plotly'`);
}

/**
 * Gets the full path to a specific cache file
 * @param {Object} dateRange - Date range object
 * @param {string} dataType - Type of data: 'raw' or 'processed'
 * @param {string} filename - Filename (e.g., 'transactions.json', 'ynab-2026-02.json')
 * @returns {string} Full path to cache file
 */
export function getCacheFilePath(dateRange, dataType, filename) {
  const cachePath = getCachePath(dateRange, dataType);
  return join(cachePath, filename);
}

/**
 * Checks if cached data exists and is still valid
 * @param {Object} dateRange - Date range object
 * @param {number} maxAgeHours - Maximum age in hours before cache is considered stale (default: 24)
 * @returns {boolean} True if cache is valid and fresh
 */
export function isCacheValid(dateRange, maxAgeHours = 24) {
  try {
    const cacheDir = getCachePath(dateRange, 'ynab');

    // Check if all required files exist
    const requiredFiles = [
      'transactions.json',
      'accounts.json',
      'categories.json',
      'metadata.json'
    ];

    for (const filename of requiredFiles) {
      const filePath = join(cacheDir, filename);
      if (!fileExists(filePath)) {
        return false;
      }
    }

    // Read metadata to check timestamp and date range
    const metadataPath = join(cacheDir, 'metadata.json');
    const metadata = readJSON(metadataPath, { throwOnMissing: false });

    if (!metadata) {
      return false;
    }

    // Validate metadata has required fields
    if (!metadata.fetchedAt || !metadata.dateRange) {
      return false;
    }

    // Check if date ranges match
    if (
      metadata.dateRange.start !== dateRange.startDate ||
      metadata.dateRange.end !== dateRange.endDate
    ) {
      return false;
    }

    // Check if cache is still fresh (within maxAgeHours)
    const fetchedAt = new Date(metadata.fetchedAt);
    const now = new Date();
    const ageInHours = (now - fetchedAt) / (1000 * 60 * 60);

    if (ageInHours > maxAgeHours) {
      return false;
    }

    // All checks passed - cache is valid
    return true;
  } catch (error) {
    // Any error (permission issues, invalid JSON, etc.) means cache is invalid
    return false;
  }
}

/**
 * Clears old cache files
 * @param {number} olderThanDays - Remove cache files older than this many days (default: 30)
 * @returns {number} Number of cache directories removed
 */
export function clearCache(olderThanDays = 30) {
  const baseDir = process.cwd();
  const rawCacheDir = join(baseDir, 'output', 'ynab');

  if (!fileExists(rawCacheDir)) {
    return 0;
  }

  let removedCount = 0;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  try {
    const entries = readdirSync(rawCacheDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = join(rawCacheDir, entry.name);
      const metadataPath = join(entryPath, 'metadata.json');

      // Check metadata to determine age
      if (fileExists(metadataPath)) {
        const metadata = readJSON(metadataPath, { throwOnMissing: false });
        if (metadata && metadata.fetchedAt) {
          const fetchedAt = new Date(metadata.fetchedAt);
          if (fetchedAt < cutoffDate) {
            rmSync(entryPath, { recursive: true, force: true });
            removedCount++;
          }
          continue;
        }
      }

      // If no valid metadata, use directory modification time
      const modTime = getFileModTime(entryPath);
      if (modTime && modTime < cutoffDate) {
        rmSync(entryPath, { recursive: true, force: true });
        removedCount++;
      }
    }
  } catch (error) {
    // Silently fail - cache clearing is not critical
    console.warn(`Warning: Failed to clear cache: ${error.message}`);
  }

  return removedCount;
}

/**
 * Gets information about the latest cached data
 * @returns {Object|null} Information about latest cache, or null if no cache exists
 */
export function getLatestCache() {
  const baseDir = process.cwd();
  const rawCacheDir = join(baseDir, 'output', 'ynab');

  if (!fileExists(rawCacheDir)) {
    return null;
  }

  try {
    const entries = readdirSync(rawCacheDir, { withFileTypes: true });
    let latestCache = null;
    let latestDate = null;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const metadataPath = join(rawCacheDir, entry.name, 'metadata.json');
      if (!fileExists(metadataPath)) {
        continue;
      }

      const metadata = readJSON(metadataPath, { throwOnMissing: false });
      if (!metadata || !metadata.fetchedAt) {
        continue;
      }

      const fetchedAt = new Date(metadata.fetchedAt);
      if (!latestDate || fetchedAt > latestDate) {
        latestDate = fetchedAt;
        latestCache = {
          cacheKey: entry.name,
          path: join(rawCacheDir, entry.name),
          metadata
        };
      }
    }

    return latestCache;
  } catch (error) {
    return null;
  }
}
