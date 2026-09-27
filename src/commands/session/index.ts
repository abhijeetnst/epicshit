import type { Command } from '../../commands.js'

const session: Command = {
  description: 'Open a new, independent DopeCode session in a new terminal window',
  name: 'session',
  argumentHint: '[folder]',
  type: 'local',
  supportsNonInteractive: false,
  load: () => import('./session.js'),
}

export default session
