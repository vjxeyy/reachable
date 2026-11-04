import { describe, expect, it } from 'vitest'
import campusData from '../../data/campus.json'
import { loadCampus } from '../core/graph'
import { interpret, type Command } from './commands'

const campus = loadCampus(campusData)

function cmd(text: string): Command | null {
  const heard = interpret(text)
  return 'command' in heard ? heard.command : null
}

describe('interpret: commands', () => {
  const cases: [Command, string[]][] = [
    ['yes', ['yes', 'Yes.', 'yeah', 'yep', 'correct', "that's right", 'yes please', 'okay', 'sure', 'yes that is right']],
    ['no', ['no', 'No.', 'nope', 'nah', 'wrong', "that's wrong", 'no that is wrong', 'not right', 'no thanks']],
    ['repeat', ['repeat', 'Repeat that', 'say that again', 'say again', 'again', 'pardon', 'repeat please', 'sorry']],
    ['pause', ['pause', 'Pause.', 'wait', 'hold on', 'please pause']],
    ['resume', ['resume', 'continue', 'go on', 'carry on', 'keep going', 'please resume']],
    ['stop', ['stop', 'Stop!', 'stop talking', 'be quiet', 'quiet', 'silence', 'please stop']],
    ['next', ['next', 'next step', 'skip']],
    ['start_over', ['start over', 'Start over.', 'restart', 'begin again', 'start again', 'new trip']],
    ['change_start', ['change start', 'change the start', 'change starting point', 'change my starting place', 'change origin']],
    ['change_destination', ['change destination', 'change the destination', 'please change destination', 'change end point']],
    ['change', ['change']],
    ['return_to_map', ['return to map', 'return to the map', 'go back to the map', 'back to map', 'show me the map', 'exit', 'open the map']],
    ['help', ['help', 'what can I say', 'commands']],
    ['places', ['places', 'list places', 'what places are there', 'where can I go']],
  ]

  for (const [command, phrases] of cases) {
    it(`hears "${command}" in several ways`, () => {
      for (const phrase of phrases) expect([phrase, cmd(phrase)]).toEqual([phrase, command])
    })
  }

  it('says nothing is a command for an empty or unclear sentence', () => {
    expect(interpret('')).toEqual({ text: '' })
    expect(cmd('purple elephant')).toBeNull()
  })
})

describe('interpret: places are never mistaken for commands', () => {
  it('leaves every place name, and common ways of saying it, as text', () => {
    for (const place of campus.nodes) {
      for (const phrase of [place.name, place.name.toLowerCase(), `from ${place.name}`, `to the ${place.name}`, `i am at the ${place.name}`]) {
        expect([phrase, 'command' in interpret(phrase)]).toEqual([phrase, false])
      }
    }
  })

  it('does not read "no" or "stop" inside longer words or names', () => {
    expect(cmd('north gate')).toBeNull()
    expect(cmd('bus stop')).toBeNull()
    expect(cmd('nothing')).toBeNull()
    expect(cmd('the bus stop please')).toBeNull()
  })

  it('does not take "map" or "wait" out of the middle of a sentence', () => {
    expect(cmd('i want to see the map of the library')).toBeNull()
    expect(cmd('wait for me at the canteen')).toBeNull()
  })
})
