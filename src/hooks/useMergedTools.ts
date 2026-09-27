import { useMemo } from 'react'
import type { Tools, ToolPermissionContext } from '../Tool.js'
import { assembleToolPool } from '../tools.js'
import { mergeAndFilterTools } from '../utils/toolPool.js'

/**
 * React hook that assembles the full tool pool for the REPL: the shared
 * assembleToolPool() (also used by runAgent) plus any extra initialTools,
 * which take precedence in deduplication.
 */
export function useMergedTools(
  initialTools: Tools,
  toolPermissionContext: ToolPermissionContext,
): Tools {
  return useMemo(
    () =>
      mergeAndFilterTools(
        initialTools,
        assembleToolPool(toolPermissionContext),
        toolPermissionContext.mode,
      ),
    [initialTools, toolPermissionContext],
  )
}
