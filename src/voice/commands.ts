// What a person says to the voice guide: a command ("repeat", "change destination") or an answer (a place).
// Pure: no DOM, no network. A command must be the whole sentence (a few polite words around it are allowed),
// so a place such as "North Gate" or "Bus Stop" is never mistaken for "no" or "stop".

export type Command =
  | 'yes'
  | 'no'
  | 'repeat'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'next'
  | 'start_over'
  | 'change_start'
  | 'change_destination'
  | 'change'
  | 'return_to_map'
  | 'help'
  | 'places'

export type Heard = { command: Command } | { text: string }

/** Lowercase, no punctuation, one space between words ("that's" becomes "that s"). */
export function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LEAD = String.raw`(?:(?:please|ok|okay|hey|reachable|now|just|can you|could you|would you|i want to|i would like to|let s|lets)\s+)*`
const TAIL = String.raw`(?:\s+(?:please|now|thanks|thank you|that|it|again|the directions|the route|for now))*`

const WHOLE: [Command, string[]][] = [
  ['change_start', ['change (?:the |my )?(?:start|starting|start point|starting point|start location|starting location|starting place|origin|beginning)', 'wrong start', 'different start', 'new start']],
  ['change_destination', ['change (?:the |my )?(?:destination|end|end point|end location|finish|finishing point)', 'wrong destination', 'different destination', 'new destination']],
  ['change', ['change', 'change it', 'change that', 'change my answer', 'i want to change']],
  ['start_over', ['start over', 'start again', 'restart', 'begin again', 'begin over', 'reset', 'from the beginning', 'new trip', 'new route']],
  ['return_to_map', ['return to (?:the )?map', 'go to (?:the )?map', 'go back to (?:the )?map', 'back to (?:the )?map', 'show (?:me )?(?:the )?map', 'open (?:the )?map', 'campus map', 'map', 'exit', 'leave', 'quit', 'close']],
  ['stop', ['stop', 'stop talking', 'stop speaking', 'stop reading', 'be quiet', 'quiet', 'silence', 'shut up', 'cancel', 'enough']],
  ['pause', ['pause', 'wait', 'hold on', 'hold', 'one moment', 'wait a moment', 'wait a minute']],
  ['resume', ['resume', 'continue', 'go on', 'carry on', 'keep going', 'go ahead', 'proceed', 'unpause', 'start reading']],
  ['next', ['next', 'next step', 'skip', 'skip this', 'skip step', 'go to the next step']],
  ['repeat', ['repeat', 'say that again', 'say it again', 'say again', 'again', 'pardon', 'sorry', 'what', 'come again', 'i did not hear', 'i didn t hear', 'read that again', 'repeat the last step', 'repeat the question']],
  ['help', ['help', 'what can i say', 'what can i do', 'commands', 'options', 'what are my options', 'how does this work']],
  ['places', ['places', 'list places', 'list the places', 'what places are there', 'what places are there', 'which places', 'where can i go', 'what are the places', 'read the places', 'list locations', 'locations']],
]

const WHOLE_RE = WHOLE.map(([command, phrases]) => ({
  command,
  re: new RegExp(String.raw`^${LEAD}(?:${phrases.join('|')})${TAIL}$`),
}))

const YES_RE = new RegExp(
  String.raw`^${LEAD}(?:yes|yeah|yep|yup|correct|right|sure|ok|okay|affirmative|confirm|confirmed|that is right|that is correct|that s right|that s correct|exactly)\b.*$`,
)
const NO_RE = new RegExp(
  String.raw`^${LEAD}(?:no|nope|nah|wrong|incorrect|negative|not right|not correct|that is wrong|that is not right|that is not correct|that s wrong|that s not right|that s not correct)\b.*$`,
)

/** Turns what the browser heard into a command, or leaves it as text for the place matcher. */
export function interpret(spoken: string): Heard {
  const text = plain(spoken)
  if (!text) return { text: '' }
  for (const { command, re } of WHOLE_RE) if (re.test(text)) return { command }
  if (YES_RE.test(text)) return { command: 'yes' }
  if (NO_RE.test(text)) return { command: 'no' }
  return { text }
}
