import type { Command } from '../../commands.js'

const web: Command = {
  description: 'Start the web command center (agent API on 127.0.0.1:4096 + harness-web UI)',
  name: 'web',
  argumentHint: '[stop]',
  type: 'local',
  supportsNonInteractive: false,
  load: () => import('./web.js'),
}

export default web
