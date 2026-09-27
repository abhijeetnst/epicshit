import type { ContentBlockParam } from '../../services/api/types.js';
import { randomUUID } from 'crypto';
import * as React from 'react';
import { BashModeProgress } from 'src/components/BashModeProgress.js';
import type { SetToolJSXFn } from 'src/Tool.js';
import { BashTool } from 'src/tools/BashTool/BashTool.js';
import type { AttachmentMessage, SystemMessage, UserMessage } from 'src/types/message.js';
import type { ShellProgress } from 'src/types/tools.js';
import { logEvent } from '../noopTelemetry.js';
import { errorMessage, ShellError } from '../errors.js';
import { createSyntheticUserCaveatMessage, createUserInterruptionMessage, createUserMessage, prepareUserContent } from '../messages.js';
import { processToolResultBlock } from '../toolResultStorage.js';
import { escapeXml } from '../xml.js';
import type { ProcessUserInputContext } from './processUserInput.js';
export async function processBashCommand(inputString: string, precedingInputBlocks: ContentBlockParam[], attachmentMessages: AttachmentMessage[], context: ProcessUserInputContext, setToolJSX: SetToolJSXFn): Promise<{
  messages: (UserMessage | AttachmentMessage | SystemMessage)[];
  shouldQuery: boolean;
}> {
  logEvent('tengu_input_bash', {});
  const userMessage = createUserMessage({
    content: prepareUserContent({
      inputString: `<bash-input>${inputString}</bash-input>`,
      precedingInputBlocks
    })
  });

  // ctrl+b to background indicator
  let jsx: React.ReactNode;

  // Just show initial UI
  setToolJSX({
    jsx: <BashModeProgress input={inputString} progress={null} verbose={context.options.verbose} />,
    shouldHidePromptInput: false
  });
  try {
    const bashModeContext: ProcessUserInputContext = {
      ...context,
      // TODO: Clean up this hack
      setToolJSX: _ => {
        jsx = _?.jsx;
      }
    };

    // Progress UI — shared across both shell backends (both emit ShellProgress)
    const onProgress = (progress: {
      data: ShellProgress;
    }) => {
      setToolJSX({
        jsx: <>
            <BashModeProgress input={inputString!} progress={progress.data} verbose={context.options.verbose} />
            {jsx}
          </>,
        shouldHidePromptInput: false,
        showSpinner: false
      });
    };

    // User-initiated `!` commands run outside sandbox.
    const shellTool = BashTool;
    const response = await BashTool.call({
      command: inputString,
      dangerouslyDisableSandbox: true
    }, bashModeContext, undefined, undefined, onProgress);
    const data = response.data;
    if (!data) {
      throw new Error('No result received from shell command');
    }
    const stderr = data.stderr;
    // Reuse the same formatting pipeline as inline !`cmd` bash (promptShellExecution)
    // and model-initiated Bash. When BashTool.call() persists large output to disk,
    // data.persistedOutputPath is set and the formatter wraps in <persisted-output>.
    // Pass stderr:'' to keep it separate for the <bash-stderr> UI tag.
    const mapped = await processToolResultBlock(shellTool, {
      ...data,
      stderr: ''
    }, randomUUID());
    // mapped.content may contain our own <persisted-output> wrapper (trusted
    // XML from buildLargeToolResultMessage). Escaping it would turn structural
    // tags into &lt;persisted-output&gt;, breaking the model's parse and
    // UserBashOutputMessage's extractTag. Escape the raw fallback only.
    const stdout = typeof mapped.content === 'string' ? mapped.content : escapeXml(data.stdout);
    return {
      messages: [createSyntheticUserCaveatMessage(), userMessage, ...attachmentMessages, createUserMessage({
        content: `<bash-stdout>${stdout}</bash-stdout><bash-stderr>${escapeXml(stderr)}</bash-stderr>`
      })],
      shouldQuery: false
    };
  } catch (e) {
    if (e instanceof ShellError) {
      if (e.interrupted) {
        return {
          messages: [createSyntheticUserCaveatMessage(), userMessage, createUserInterruptionMessage({
            toolUse: false
          }), ...attachmentMessages],
          shouldQuery: false
        };
      }
      return {
        messages: [createSyntheticUserCaveatMessage(), userMessage, ...attachmentMessages, createUserMessage({
          content: `<bash-stdout>${escapeXml(e.stdout)}</bash-stdout><bash-stderr>${escapeXml(e.stderr)}</bash-stderr>`
        })],
        shouldQuery: false
      };
    }
    return {
      messages: [createSyntheticUserCaveatMessage(), userMessage, ...attachmentMessages, createUserMessage({
        content: `<bash-stderr>Command failed: ${escapeXml(errorMessage(e))}</bash-stderr>`
      })],
      shouldQuery: false
    };
  } finally {
    setToolJSX(null);
  }
}
