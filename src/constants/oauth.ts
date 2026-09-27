// ponytail: DopeCode is bring-your-own-key only; there is no OAuth sign-in.
// These stubs keep the remaining importers compiling: the config file name and
// keychain service name (both use an empty suffix) and dead auth-header paths.
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const

export function fileSuffixForOauthConfig(): string {
  return ''
}

export function getOauthConfig(): { BASE_API_URL: string; OAUTH_FILE_SUFFIX: string } {
  return { BASE_API_URL: '', OAUTH_FILE_SUFFIX: '' }
}
