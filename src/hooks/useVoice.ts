// Voice removed — stub. Mic + STT needs native audio + OAuth; not shipped.
// Preserves export surface so the rest of the codebase compiles unchanged.
// All voice entry points report unavailable.

import { useCallback, useState } from 'react'

const DEFAULT_STT_LANGUAGE = 'en'

const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  english: 'en',
  spanish: 'es',
  'espa\u00f1ol': 'es',
  espanol: 'es',
  french: 'fr',
  german: 'de',
  portuguese: 'pt',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  hindi: 'hi',
  russian: 'ru',
}

const SUPPORTED_LANGUAGE_CODES = new Set([
  'en', 'es', 'fr', 'ja', 'de', 'pt', 'it', 'ko', 'hi', 'ru',
])

export function normalizeLanguageForSTT(language: string | undefined): {
  code: string
  fellBackFrom?: string
} {
  if (!language) return { code: DEFAULT_STT_LANGUAGE }
  const lower = language.toLowerCase().trim()
  if (!lower) return { code: DEFAULT_STT_LANGUAGE }
  if (SUPPORTED_LANGUAGE_CODES.has(lower)) return { code: lower }
  const fromName = LANGUAGE_NAME_TO_CODE[lower]
  if (fromName) return { code: fromName }
  const base = lower.split('-')[0]
  if (base && SUPPORTED_LANGUAGE_CODES.has(base)) return { code: base }
  return { code: DEFAULT_STT_LANGUAGE, fellBackFrom: language }
}

export function computeLevel(_chunk: Buffer): number {
  return 0
}

export const FIRST_PRESS_FALLBACK_MS = 2000

type VoiceState = 'idle' | 'recording' | 'processing'

type UseVoiceOptions = {
  onTranscript: (text: string) => void
  onError?: (message: string) => void
  enabled: boolean
  focusMode: boolean
}

type UseVoiceReturn = {
  state: VoiceState
  handleKeyEvent: (fallbackMs?: number) => void
}

export function isVoiceStreamAvailable(): boolean {
  return false
}

export function useVoice(_opts: UseVoiceOptions): UseVoiceReturn {
  const [state] = useState<VoiceState>('idle')
  const handleKeyEvent = useCallback((_fallbackMs?: number): void => {}, [])
  return { state, handleKeyEvent }
}
