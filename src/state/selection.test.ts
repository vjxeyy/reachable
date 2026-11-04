import { describe, expect, it } from 'vitest'
import { EMPTY_SELECTION } from './store'

describe('the starting selection', () => {
  it('has no profile, no start and no destination, so nothing is assumed about the person', () => {
    expect(EMPTY_SELECTION).toEqual({ profiles: [], from: '', to: '' })
  })
})
