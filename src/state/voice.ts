import { useSyncExternalStore } from 'react'
import { getSpeakState, subscribeSpeech, type SpeakState } from '../voice/speech'

/** The state of reading aloud, shared by every Read directions aloud control on the page. */
export function useSpeech(): SpeakState {
  return useSyncExternalStore(subscribeSpeech, getSpeakState, getSpeakState)
}
