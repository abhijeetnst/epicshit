import { useAppState } from '../state/AppState.js'

/**
 * Voice removed — always disabled. Mic + STT needs native audio + OAuth.
 */
export function useVoiceEnabled(): boolean {
  void useAppState
  return false
}
