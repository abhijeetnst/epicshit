// Headless (-p / --print) runner.
//
// DopeCode keeps the one-shot / scripted path: a prompt (argument or stdin) or
// an NDJSON stream of user messages (--input-format stream-json) is run through
// the same ask() query loop the TUI uses, and the result is printed as text,
// json or stream-json. The Agent-SDK control protocol that upstream layered on
// top (MCP management, OAuth, remote bridge, channels, prompt suggestions) is
// gone with those features; control requests on stdin are ignored.
import { randomUUID, type UUID } from 'crypto'
import { dirname } from 'path'
import { cwd } from 'process'
import { StructuredIO } from 'src/cli/structuredIO.js'
import type { Command } from 'src/commands.js'
import type { SDKMessage, SDKUserMessage } from 'src/entrypoints/agentSdkTypes.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import { ask } from 'src/QueryEngine.js'
import { EMPTY_USAGE } from 'src/services/api/logging.js'
import type { AppState } from 'src/state/AppStateStore.js'
import type { Tools } from 'src/Tool.js'
import {
  type AgentDefinition,
  isBuiltInAgent,
} from 'src/tools/AgentTool/loadAgentsDir.js'
import { asSessionId } from 'src/types/ids.js'
import type { Message } from 'src/types/message.js'
import {
  getMainThreadAgentType,
  getSessionId,
  isSessionPersistenceDisabled,
  switchSession,
} from 'src/bootstrap/state.js'
import { createAbortController } from 'src/utils/abortController.js'
import { loadConversationForResume } from 'src/utils/conversationRecovery.js'
import { errorMessage } from 'src/utils/errors.js'
import { READ_FILE_STATE_CACHE_SIZE } from 'src/utils/fileStateCache.js'
import {
  fileHistoryCanRestore,
  fileHistoryEnabled,
  fileHistoryRewind,
} from 'src/utils/fileHistory.js'
import { fromArray } from 'src/utils/generators.js'
import {
  gracefulShutdown,
  gracefulShutdownSync,
} from 'src/utils/gracefulShutdown.js'
import { registerHookEventHandler } from 'src/utils/hooks/hookEvents.js'
import { logError } from 'src/utils/log.js'
import { ensureModelStringsInitialized } from 'src/utils/model/modelStrings.js'
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js'
import {
  registerProcessOutputErrorHandlers,
  writeToStdout,
} from 'src/utils/process.js'
import { extractReadFilesFromMessages } from 'src/utils/queryHelpers.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import {
  restoreAgentFromSession,
  restoreSessionStateFromLog,
} from 'src/utils/sessionRestore.js'
import {
  processSessionStartHooks,
  processSetupHooks,
  takeInitialUserMessage,
} from 'src/utils/sessionStart.js'
import {
  resetSessionFilePointer,
  restoreSessionMetadata,
  saveAgentSetting,
} from 'src/utils/sessionStorage.js'
import { applySettingsChange } from 'src/utils/settings/applySettingsChange.js'
import { settingsChangeDetector } from 'src/utils/settings/changeDetector.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { installStreamJsonStdoutGuard } from 'src/utils/streamJsonStdoutGuard.js'
import type { ThinkingConfig } from 'src/utils/thinking.js'
import { validateUuid } from 'src/utils/uuid.js'

type HeadlessOptions = {
  continue: boolean | undefined
  resume: string | boolean | undefined
  resumeSessionAt: string | undefined
  verbose: boolean | undefined
  outputFormat: string | undefined
  jsonSchema: Record<string, unknown> | undefined
  allowedTools: string[] | undefined
  thinkingConfig: ThinkingConfig | undefined
  maxTurns: number | undefined
  taskBudget: { total: number } | undefined
  systemPrompt: string | undefined
  appendSystemPrompt: string | undefined
  userSpecifiedModel: string | undefined
  fallbackModel: string | undefined
  replayUserMessages: boolean | undefined
  includePartialMessages: boolean | undefined
  forkSession: boolean | undefined
  rewindFiles: string | undefined
  agent: string | undefined
  workload: string | undefined
  setupTrigger?: 'init' | 'maintenance' | undefined
  sessionStartHooksPromise?: ReturnType<typeof processSessionStartHooks>
}

export async function runHeadless(
  inputPrompt: string | AsyncIterable<string>,
  getAppState: () => AppState,
  setAppState: (f: (prev: AppState) => AppState) => void,
  commands: Command[],
  tools: Tools,
  agents: AgentDefinition[],
  options: HeadlessOptions,
): Promise<void> {
  // No React tree in headless mode, so apply settings changes directly.
  settingsChangeDetector.subscribe(source => applySettingsChange(source, setAppState))

  if (options.resumeSessionAt && !options.resume) {
    return fail('Error: --resume-session-at requires --resume')
  }
  if (options.rewindFiles && !options.resume) {
    return fail('Error: --rewind-files requires --resume')
  }
  if (options.rewindFiles && inputPrompt) {
    return fail(
      'Error: --rewind-files is a standalone operation and cannot be used with a prompt',
    )
  }

  const structuredIO = new StructuredIO(
    toInputStream(inputPrompt),
    options.replayUserMessages,
  )
  // Stray stdout writes would corrupt the NDJSON stream.
  if (options.outputFormat === 'stream-json') installStreamJsonStdoutGuard()

  const sandboxUnavailableReason = SandboxManager.getSandboxUnavailableReason()
  if (sandboxUnavailableReason) {
    if (SandboxManager.isSandboxRequired()) {
      return fail(
        `\nError: sandbox required but unavailable: ${sandboxUnavailableReason}\n` +
          `  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n`,
      )
    }
    process.stderr.write(
      `\n⚠ Sandbox disabled: ${sandboxUnavailableReason}\n` +
        `  Commands will run WITHOUT sandboxing.\n\n`,
    )
  } else if (SandboxManager.isSandboxingEnabled()) {
    try {
      await SandboxManager.initialize(structuredIO.createSandboxAskCallback())
    } catch (err) {
      return fail(`\nSandbox Error: ${errorMessage(err)}`)
    }
  }

  if (options.outputFormat === 'stream-json' && options.verbose) {
    registerHookEventHandler(event => {
      const base = {
        type: 'system' as const,
        hook_id: event.hookId,
        hook_name: event.hookName,
        hook_event: event.hookEvent,
        uuid: randomUUID(),
        session_id: getSessionId(),
      }
      const message =
        event.type === 'started'
          ? { ...base, subtype: 'hook_started' as const }
          : event.type === 'progress'
            ? {
                ...base,
                subtype: 'hook_progress' as const,
                stdout: event.stdout,
                stderr: event.stderr,
                output: event.output,
              }
            : {
                ...base,
                subtype: 'hook_response' as const,
                output: event.output,
                stdout: event.stdout,
                stderr: event.stderr,
                exit_code: event.exitCode,
                outcome: event.outcome,
              }
      void structuredIO.write(message as StdoutMessage)
    })
  }

  if (options.setupTrigger) await processSetupHooks(options.setupTrigger)

  const loaded = await loadInitialMessages(setAppState, options)
  if (!loaded) return
  const hookInitialUserMessage = takeInitialUserMessage()
  if (hookInitialUserMessage) structuredIO.prependUserMessage(hookInitialUserMessage)

  // Restore the resumed session's agent unless --agent / settings chose one.
  if (!options.agent && !getMainThreadAgentType() && loaded.agentSetting) {
    const { agentDefinition: restoredAgent } = restoreAgentFromSession(
      loaded.agentSetting,
      undefined,
      { activeAgents: agents, allAgents: agents },
    )
    if (restoredAgent) {
      setAppState(prev => ({ ...prev, agent: restoredAgent.agentType }))
      if (!options.systemPrompt && !isBuiltInAgent(restoredAgent)) {
        options.systemPrompt = restoredAgent.getSystemPrompt() || undefined
      }
      saveAgentSetting(restoredAgent.agentType)
    }
  }

  if (options.rewindFiles) {
    const target = loaded.messages.find(m => m.uuid === options.rewindFiles)
    if (!target || target.type !== 'user') {
      return fail(
        `Error: --rewind-files requires a user message UUID, but ${options.rewindFiles} is not a user message in this session`,
      )
    }
    const error = await rewindFiles(options.rewindFiles as UUID, getAppState(), setAppState)
    if (error) return fail(`Error: ${error}`)
    writeToStdout(`Files rewound to state at message ${options.rewindFiles}\n`)
    gracefulShutdownSync(0)
    return
  }

  const hasValidResumeSessionId =
    typeof options.resume === 'string' &&
    (Boolean(validateUuid(options.resume)) || options.resume.endsWith('.jsonl'))
  if (!inputPrompt && !hasValidResumeSessionId) {
    return fail(
      'Error: Input must be provided either through stdin or as a prompt argument when using --print',
    )
  }
  if (options.outputFormat === 'stream-json' && !options.verbose) {
    return fail(
      'Error: When using --print, --output-format=stream-json requires --verbose',
    )
  }

  // No one to ask in headless mode: rules decide, anything still "ask" is denied.
  const canUseTool: CanUseToolFn = async (
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseId,
    forceDecision,
  ) =>
    forceDecision ??
    (await hasPermissionsToUseTool(tool, input, toolUseContext, assistantMessage, toolUseId))

  registerProcessOutputErrorHandlers()
  await ensureModelStringsInitialized()

  let abortController: AbortController | undefined
  process.on('SIGINT', () => {
    abortController?.abort()
    void gracefulShutdown(0)
  })

  const mutableMessages: Message[] = loaded.messages
  let readFileState = extractReadFilesFromMessages(
    loaded.messages,
    cwd(),
    READ_FILE_STATE_CACHE_SIZE,
  )
  const keepAll = options.outputFormat === 'json' && options.verbose
  const collected: SDKMessage[] = []
  let lastMessage: SDKMessage | undefined

  for await (const input of structuredIO.structuredInput) {
    if (input.type !== 'user') continue // control requests are not supported
    const user = input as SDKUserMessage
    abortController = createAbortController()
    for await (const message of ask({
      commands,
      prompt: user.message.content,
      promptUuid: user.uuid,
      cwd: cwd(),
      tools,
      verbose: options.verbose,
      thinkingConfig: options.thinkingConfig,
      maxTurns: options.maxTurns,
      taskBudget: options.taskBudget,
      canUseTool,
      userSpecifiedModel: options.userSpecifiedModel,
      fallbackModel: options.fallbackModel,
      jsonSchema: options.jsonSchema,
      mutableMessages,
      getReadFileCache: () => readFileState,
      setReadFileCache: cache => {
        readFileState = cache
      },
      customSystemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
      getAppState,
      setAppState,
      abortController,
      replayUserMessages: options.replayUserMessages,
      includePartialMessages: options.includePartialMessages,
      agents,
    })) {
      if (options.outputFormat === 'stream-json') {
        await structuredIO.write(message as StdoutMessage)
      }
      if (message.type === 'stream_event') continue
      if (keepAll) collected.push(message)
      lastMessage = message
    }
  }

  const result = lastMessage?.type === 'result' ? lastMessage : undefined
  if (options.outputFormat === 'json') {
    if (!result) throw new Error('No messages returned')
    writeToStdout(jsonStringify(keepAll ? collected : result) + '\n')
  } else if (options.outputFormat !== 'stream-json') {
    if (!result) throw new Error('No messages returned')
    switch (result.subtype) {
      case 'success':
        writeToStdout(result.result.endsWith('\n') ? result.result : result.result + '\n')
        break
      case 'error_max_turns':
        writeToStdout(`Error: Reached max turns (${options.maxTurns})\n`)
        break
      case 'error_max_structured_output_retries':
        writeToStdout('Error: Failed to provide valid structured output after maximum retries\n')
        break
      default:
        writeToStdout('Execution error\n')
    }
  }
  gracefulShutdownSync(result?.is_error ? 1 : 0)

  function fail(message: string): void {
    if (options.outputFormat === 'stream-json') {
      writeToStdout(
        jsonStringify({
          type: 'result',
          subtype: 'error_during_execution',
          duration_ms: 0,
          duration_api_ms: 0,
          is_error: true,
          num_turns: 0,
          stop_reason: null,
          session_id: getSessionId(),
          total_cost_usd: 0,
          usage: EMPTY_USAGE,
          modelUsage: {},
          permission_denials: [],
          uuid: randomUUID(),
          errors: [message],
        }) + '\n',
      )
    } else {
      process.stderr.write(message + '\n')
    }
    gracefulShutdownSync(1)
  }
}

function toInputStream(inputPrompt: string | AsyncIterable<string>): AsyncIterable<string> {
  if (typeof inputPrompt !== 'string') return inputPrompt
  if (inputPrompt.trim() === '') return fromArray([])
  return fromArray([
    jsonStringify({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: inputPrompt },
      parent_tool_use_id: null,
    } satisfies SDKUserMessage),
  ])
}

async function rewindFiles(
  userMessageId: UUID,
  appState: AppState,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): Promise<string | null> {
  if (!fileHistoryEnabled()) return 'File rewinding is not enabled.'
  if (!fileHistoryCanRestore(appState.fileHistory, userMessageId)) {
    return 'No file checkpoint found for this message.'
  }
  try {
    await fileHistoryRewind(
      updater => setAppState(prev => ({ ...prev, fileHistory: updater(prev.fileHistory) })),
      userMessageId,
    )
    return null
  } catch (error) {
    return `Failed to rewind: ${errorMessage(error)}`
  }
}

/** --continue / --resume <id|file.jsonl>, else SessionStart hooks. Null after a fatal error. */
async function loadInitialMessages(
  setAppState: (f: (prev: AppState) => AppState) => void,
  options: HeadlessOptions,
): Promise<{ messages: Message[]; agentSetting?: string } | null> {
  const fail = (message: string) => {
    process.stderr.write(message + '\n')
    gracefulShutdownSync(1)
    return null
  }
  if (!options.continue && !options.resume) {
    return {
      messages: await (options.sessionStartHooksPromise ??
        processSessionStartHooks('startup')),
    }
  }

  let sessionId: string | undefined
  let jsonlFile: string | undefined
  if (options.resume) {
    const raw = typeof options.resume === 'string' ? options.resume : ''
    if (raw.endsWith('.jsonl')) jsonlFile = raw
    else sessionId = validateUuid(raw) ?? undefined
    if (!sessionId && !jsonlFile) {
      return fail(
        `Error: --resume requires a valid session ID (UUID) or .jsonl transcript when used with --print. Got "${raw}".`,
      )
    }
  }

  try {
    const result = await loadConversationForResume(sessionId, jsonlFile)
    if (!result || (options.resume && result.messages.length === 0)) {
      if (options.continue) {
        // Nothing to continue: start fresh like the TUI does.
        return { messages: await processSessionStartHooks('startup') }
      }
      return fail(`No conversation found with session ID: ${sessionId ?? jsonlFile}`)
    }
    if (options.resumeSessionAt) {
      const index = result.messages.findIndex(m => m.uuid === options.resumeSessionAt)
      if (index < 0) {
        return fail(`No message found with message.uuid of: ${options.resumeSessionAt}`)
      }
      result.messages = result.messages.slice(0, index + 1)
    }
    if (!options.forkSession && result.sessionId) {
      switchSession(
        asSessionId(result.sessionId),
        result.fullPath ? dirname(result.fullPath) : null,
      )
      if (!isSessionPersistenceDisabled()) await resetSessionFilePointer()
    }
    restoreSessionStateFromLog(result, setAppState)
    restoreSessionMetadata(
      options.forkSession ? { ...result, worktreeSession: undefined } : result,
    )
    return { messages: result.messages, agentSetting: result.agentSetting }
  } catch (error) {
    logError(error)
    return fail(`Failed to resume session: ${errorMessage(error)}`)
  }
}
