import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs';
import { dirname } from 'path';

/**
 * File I/O Utilities
 * Centralized JSON read/write operations with validation and error handling
 */

/**
 * Ensures a directory exists, creating it recursively if needed
 * @param {string} dirPath - Directory path to ensure exists
 */
export function ensureDirectoryExists(dirPath) {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
  }
}

/**
 * Writes data to a JSON file with pretty formatting
 * Creates parent directories automatically if they don't exist
 * @param {string} filePath - Path to write the JSON file
 * @param {any} data - Data to write (will be JSON stringified)
 * @param {Object} options - Write options
 * @param {number} options.spaces - Number of spaces for indentation (default: 2)
 * @param {boolean} options.createDirs - Create parent directories (default: true)
 */
export function writeJSON(filePath, data, options = {}) {
  const { spaces = 2, createDirs = true } = options;

  try {
    // Create parent directories if needed
    if (createDirs) {
      const dir = dirname(filePath);
      ensureDirectoryExists(dir);
    }

    // Convert to JSON with pretty formatting
    const jsonString = JSON.stringify(data, null, spaces);

    // Write to file
    writeFileSync(filePath, jsonString, 'utf-8');
  } catch (error) {
    if (error.message.includes('Failed to create directory')) {
      throw error; // Re-throw directory creation errors
    }
    throw new Error(`Failed to write JSON to ${filePath}: ${error.message}`);
  }
}

/**
 * Reads and parses a JSON file
 * @param {string} filePath - Path to the JSON file
 * @param {Object} options - Read options
 * @param {boolean} options.throwOnMissing - Throw error if file doesn't exist (default: true)
 * @returns {any} Parsed JSON data, or null if file missing and throwOnMissing is false
 */
export function readJSON(filePath, options = {}) {
  const { throwOnMissing = true } = options;

  try {
    // Check if file exists
    if (!existsSync(filePath)) {
      if (throwOnMissing) {
        throw new Error(`File not found: ${filePath}`);
      }
      return null;
    }

    // Read file
    const content = readFileSync(filePath, 'utf-8');

    // Parse JSON
    try {
      return JSON.parse(content);
    } catch (parseError) {
      throw new Error(`Invalid JSON in ${filePath}: ${parseError.message}`);
    }
  } catch (error) {
    if (error.message.startsWith('File not found') || error.message.startsWith('Invalid JSON')) {
      throw error; // Re-throw our custom errors
    }
    throw new Error(`Failed to read JSON from ${filePath}: ${error.message}`);
  }
}

/**
 * Checks if a file exists and is readable
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file exists and is readable
 */
export function fileExists(filePath) {
  try {
    return existsSync(filePath);
  } catch (error) {
    // Permission errors, etc. - treat as "doesn't exist"
    return false;
  }
}

/**
 * Gets the modification time of a file
 * @param {string} filePath - Path to the file
 * @returns {Date|null} File modification time, or null if file doesn't exist
 */
export function getFileModTime(filePath) {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const stats = statSync(filePath);
    return stats.mtime;
  } catch (error) {
    // Permission errors, invalid paths, etc.
    return null;
  }
}
