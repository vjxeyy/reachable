import { describe, expect, it } from 'vitest'
import { buildServerClassifier, chooseKind } from './classifier-config'

const input = { image: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', fileName: 'x.jpg' }

describe('choosing the photo classifier from the environment', () => {
  it('uses the demo classifier by default', () => {
    expect(chooseKind({})).toBe('simulated')
    expect(chooseKind({ OPENROUTER_API_KEY: '   ' })).toBe('simulated')
  })

  it('uses OpenRouter when a key is set, or when asked for', () => {
    expect(chooseKind({ OPENROUTER_API_KEY: 'sk-or-test' })).toBe('openrouter')
    expect(chooseKind({ CLASSIFIER: 'OpenRouter' })).toBe('openrouter')
  })

  it('uses CLIP only when asked for, even if a key is set', () => {
    expect(chooseKind({ CLASSIFIER: 'clip', OPENROUTER_API_KEY: 'sk-or-test' })).toBe('clip')
  })

  it('lets CLASSIFIER=simulated switch a real model off', () => {
    expect(chooseKind({ CLASSIFIER: 'simulated', OPENROUTER_API_KEY: 'sk-or-test' })).toBe('simulated')
    expect(chooseKind({ CLASSIFIER: 'off' })).toBe('simulated')
  })

  it('never throws and always answers: with no key it explains why it is the demo classifier', async () => {
    const asked = buildServerClassifier({ CLASSIFIER: 'openrouter' }, 'unused')
    expect(asked.kind).toBe('simulated')
    const result = await asked.classifier.classify(input)
    expect(result.source).toBe('simulated')
    expect(result.note).toMatch(/OPENROUTER_API_KEY is not set/)

    const plain = await buildServerClassifier({}, 'unused').classifier.classify(input)
    expect(plain.note).toMatch(/OPENROUTER_API_KEY/)
  })

  it('builds the OpenRouter classifier without calling the network', () => {
    const built = buildServerClassifier({ OPENROUTER_API_KEY: 'sk-or-test', OPENROUTER_MODEL: 'a:free, b:free' }, 'unused')
    expect(built.kind).toBe('openrouter')
    expect(built.description).toMatch(/OpenRouter a:free/)
  })

  it('builds CLIP lazily: nothing is downloaded or loaded until it is used', () => {
    const built = buildServerClassifier({ CLASSIFIER: 'clip' }, 'unused')
    expect(built.kind).toBe('clip')
    expect(built.clipRuntime).toBeDefined()
  })
})
