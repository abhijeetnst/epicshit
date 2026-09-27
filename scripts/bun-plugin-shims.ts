// scripts/bun-plugin-shims.ts
// Bun preload plugin — resolves `bun:bundle` at runtime (dev mode, `bun src/...`)
// to a virtual module where every feature flag is off, matching the bundle build.

import { plugin } from 'bun'

;(globalThis as any).MACRO = {
  VERSION: require('../package.json').version,
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: '@epicshit-ai/dope-code',
  NATIVE_PACKAGE_URL: '@epicshit-ai/dope-code',
  ISSUES_EXPLAINER: 'report issues at https://github.com/epicshits/dope-code/issues',
  FEEDBACK_CHANNEL: 'https://github.com/epicshits/dope-code/issues',
  VERSION_CHANGELOG: '',
}

plugin({
  name: 'bun-bundle-shim',
  setup(build) {
    build.onResolve({ filter: /^bun:bundle$/ }, () => ({
      path: 'bun:bundle',
      namespace: 'bun-bundle',
    }))
    build.onLoad({ filter: /.*/, namespace: 'bun-bundle' }, () => ({
      contents: 'export const feature = () => false',
      loader: 'js',
    }))
  },
})
