import { afterEach, describe, expect, it, vi } from 'vitest'

import { LocalE5Encoder } from '../../src/infrastructure/rag/local-e5-encoder.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'

const encoders: LocalE5Encoder[] = []

function dot(left: Float32Array, right: Float32Array): number {
  let value = 0
  for (let index = 0; index < left.length; index += 1) {
    value += (left[index] as number) * (right[index] as number)
  }
  return value
}

afterEach(async () => {
  await Promise.all(encoders.splice(0).map((encoder) => encoder.close()))
  vi.unstubAllGlobals()
})

describe('real offline multilingual E5 encoder', () => {
  it('loads only verified local assets and produces pinned normalized golden vectors without network', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('runtime network is forbidden')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const encoder = new LocalE5Encoder({ modelRoot: '.models' })
    encoders.push(encoder)

    await encoder.initialize()
    const query = await encoder.embedQuery('qual motor do carro flex?')
    const [relevant, unrelated] = await encoder.embedPassages([
      'o carro usa motor flex de 1.6 litro',
      'manual de pintura e acabamento externo',
    ])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(encoder.embeddingFingerprint).toBe(EMBEDDING_FINGERPRINT)
    expect([query.length, relevant?.length, unrelated?.length]).toEqual([384, 384, 384])
    expect(dot(query, query)).toBeCloseTo(1, 5)
    expect(dot(relevant as Float32Array, relevant as Float32Array)).toBeCloseTo(1, 5)
    expect(dot(query, relevant as Float32Array)).toBeCloseTo(0.8981677, 4)
    expect(dot(query, unrelated as Float32Array)).toBeCloseTo(0.8044794, 4)
    expect(dot(query, relevant as Float32Array)).toBeGreaterThan(
      dot(query, unrelated as Float32Array),
    )
  }, 120_000)

  it('counts the real pinned tokenizer exactly at the 319, 320, and 321 token boundaries', async () => {
    const encoder = new LocalE5Encoder({ modelRoot: '.models' })
    encoders.push(encoder)
    await encoder.initialize()

    const inputs = [315, 316, 317].map(
      (words) => `passage: ${Array.from({ length: words }, () => 'carro').join(' ')}`,
    )

    expect(inputs.map((input) => encoder.countModelTokens(input))).toEqual([319, 320, 321])
  }, 120_000)
})
