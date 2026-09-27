/**
 * Combines settings validation errors with MCP configuration errors.
 *
 * This module exists to break a circular dependency:
 *   settings.ts → mcp/config.ts → settings.ts
 *
 * By moving the MCP error aggregation here (a leaf that imports both
 * settings.ts and mcp/config.ts, but is imported by neither), the cycle
 * is eliminated.
 */

import { getSettingsWithErrors } from './settings.js'
import type { SettingsWithErrors } from './validation.js'

/**
 * Get merged settings with all validation errors, including MCP config errors.
 *
 * Use this instead of getSettingsWithErrors() when you need the full set of
 * errors (settings + MCP). The underlying getSettingsWithErrors() no longer
 * includes MCP errors to avoid the circular dependency.
 */
export function getSettingsWithAllErrors(): SettingsWithErrors {
  return getSettingsWithErrors()
}

