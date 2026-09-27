// Mirrors the agent's live todo list to ./todo.md in the working directory so
// progress is visible outside the TUI (editor, web UI, git diff). Fed by both
// TodoWriteTool (headless) and the Task tools (interactive). Set
// DOPE_TODO_MD=0 to turn it off.
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { isEnvDefinedFalsy } from './envUtils.js'

export type TodoLine = { content: string; status: string }

export function renderTodoMarkdown(items: TodoLine[]): string {
  const lines = items.map(t =>
    t.status === 'completed'
      ? `- [x] ${t.content}`
      : t.status === 'in_progress'
        ? `- [ ] **${t.content}** _(in progress)_`
        : `- [ ] ${t.content}`,
  )
  const done = items.filter(t => t.status === 'completed').length
  return `# Todo\n\n${lines.join('\n')}\n\n_${done}/${items.length} done · updated ${new Date().toISOString()}_\n`
}

export async function writeTodoMarkdown(items: TodoLine[]): Promise<void> {
  if (isEnvDefinedFalsy(process.env.DOPE_TODO_MD) || items.length === 0) return
  try {
    await writeFile(join(getCwd(), 'todo.md'), renderTodoMarkdown(items), 'utf8')
  } catch (error) {
    logForDebugging(`todo.md mirror failed: ${String(error)}`)
  }
}
