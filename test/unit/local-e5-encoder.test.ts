import { describe, expect, it, type Mock, vi } from 'vitest'

import {
  LocalE5Encoder,
  type LocalE5Pipeline,
  type LocalE5Tensor,
  type LocalE5TransformersModule,
} from '../../src/infrastructure/rag/local-e5-encoder.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'

function normalized(seed: number): Float32Array {
  const vector = new Float32Array(384)
  vector[seed % 384] = 1
  return vector
}

type EmbedMock = Mock<(texts: string | string[]) => Promise<LocalE5Tensor>>

function fakePipeline(
  embed: EmbedMock = vi.fn(async (texts: string | string[]): Promise<LocalE5Tensor> => {
    const values = Array.isArray(texts) ? texts : [texts]
    return {
      data: Float32Array.from(values.flatMap((_value, index) => [...normalized(index)])),
      dims: [values.length, 384],
    }
  }),
) {
  const tokenizer = {
    encode: vi.fn((text: string) => Array.from({ length: Array.from(text).length + 2 }, () => 1)),
  }
  const dispose = vi.fn().mockResolvedValue(undefined)
  const callable = Object.assign(embed, { tokenizer, dispose }) as LocalE5Pipeline
  return { callable, dispose, embed, tokenizer }
}

function fixture(overrides: { pipeline?: LocalE5Pipeline; verify?: () => Promise<unknown> } = {}) {
  const env = {
    allowRemoteModels: true,
    allowLocalModels: false,
    useBrowserCache: true,
  }
  const fake = overrides.pipeline ? undefined : fakePipeline()
  const pipelineValue = overrides.pipeline ?? fake?.callable
  const pipeline = vi.fn(async () => pipelineValue as LocalE5Pipeline)
  const module: LocalE5TransformersModule = { env, pipeline }
  const verifyAssets = vi
    .fn()
    .mockImplementation(
      overrides.verify ?? (async () => ({ embeddingFingerprint: EMBEDDING_FINGERPRINT })),
    )
  const loadTransformers = vi.fn(async () => module)
  const encoder = new LocalE5Encoder({
    modelRoot: '/app/models',
    loadTransformers,
    verifyAssets,
  })
  return { encoder, env, fake, loadTransformers, pipeline, verifyAssets }
}

describe('LocalE5Encoder', () => {
  it('verifies the exact local revision and disables remote access before pipeline construction', async () => {
    const value = fixture()
    value.pipeline.mockImplementation(async (..._arguments) => {
      expect(value.env).toEqual({
        allowRemoteModels: false,
        allowLocalModels: true,
        useBrowserCache: false,
      })
      return value.fake?.callable as LocalE5Pipeline
    })

    await value.encoder.initialize()

    expect(value.verifyAssets).toHaveBeenCalledExactlyOnceWith(
      '/app/models/Xenova/multilingual-e5-small',
    )
    expect(value.pipeline).toHaveBeenCalledExactlyOnceWith(
      'feature-extraction',
      '/app/models/Xenova/multilingual-e5-small',
      {
        dtype: 'int8',
        local_files_only: true,
        revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
      },
    )
    expect(value.fake?.embed).toHaveBeenCalledExactlyOnceWith('query: warmup', {
      pooling: 'mean',
      normalize: true,
    })
    expect(value.encoder.embeddingFingerprint).toBe(EMBEDDING_FINGERPRINT)
  })

  it('uses exact E5 prefixes, mean pooling, normalization, and returns isolated 384-float vectors', async () => {
    const value = fixture()
    await value.encoder.initialize()
    value.fake?.embed.mockClear()

    const query = await value.encoder.embedQuery('qual motor?')
    const passages = await value.encoder.embedPassages(['motor flex', 'motor diesel'])

    expect(value.fake?.embed.mock.calls).toEqual([
      ['query: qual motor?', { pooling: 'mean', normalize: true }],
      [['passage: motor flex', 'passage: motor diesel'], { pooling: 'mean', normalize: true }],
    ])
    expect(query).toEqual(normalized(0))
    expect(passages).toEqual([normalized(0), normalized(1)])
    expect(passages[0]).not.toBe(passages[1])
  })

  it('counts actual tokenizer output including special tokens without model truncation', async () => {
    const value = fixture()
    await value.encoder.initialize()

    expect(value.encoder.countModelTokens('passage: carro')).toBe(16)
    expect(value.fake?.tokenizer.encode).toHaveBeenCalledExactlyOnceWith('passage: carro', {
      add_special_tokens: true,
    })
  })

  it.each([
    ['dimension', Float32Array.from([1])],
    [
      'non-finite',
      Float32Array.from({ length: 384 }, (_value, index) => (index === 0 ? Number.NaN : 0)),
    ],
    ['norm', Float32Array.from({ length: 384 }, () => 0)],
  ] as const)('fails closed for an invalid %s output', async (_name, vector) => {
    const pipeline = fakePipeline(
      vi.fn(async () => ({ data: vector, dims: [1, vector.length] })),
    ).callable
    const value = fixture({ pipeline })

    await expect(value.encoder.initialize()).rejects.toMatchObject({
      code: 'RAG_MODEL_UNAVAILABLE',
      message: 'The local RAG model is unavailable',
    })
  })

  it('checks abort before and after inference without disposing the shared pipeline', async () => {
    let resolveInference: ((value: { data: Float32Array; dims: number[] }) => void) | undefined
    let blocking = false
    const delayed = vi.fn<(texts: string | string[]) => Promise<LocalE5Tensor>>(() => {
      if (!blocking) return Promise.resolve({ data: normalized(0), dims: [1, 384] })
      return new Promise<{ data: Float32Array; dims: number[] }>((resolve) => {
        resolveInference = resolve
      })
    })
    const fake = fakePipeline(delayed)
    const value = fixture({ pipeline: fake.callable })
    await value.encoder.initialize()
    delayed.mockClear()
    blocking = true
    const before = new AbortController()
    before.abort()

    await expect(value.encoder.embedQuery('abortada', before.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(delayed).not.toHaveBeenCalled()

    const during = new AbortController()
    const embedding = value.encoder.embedQuery('em voo', during.signal)
    await vi.waitFor(() => expect(delayed).toHaveBeenCalledOnce())
    during.abort()
    resolveInference?.({ data: normalized(0), dims: [1, 384] })
    await expect(embedding).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.dispose).not.toHaveBeenCalled()
  })

  it('sanitizes integrity/import failures and closes one initialized pipeline idempotently', async () => {
    const failed = fixture({
      verify: async () => {
        throw new Error('/private/model API_KEY=secret')
      },
    })

    const failure = await failed.encoder.initialize().catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'RAG_MODEL_UNAVAILABLE',
      message: 'The local RAG model is unavailable',
    })
    expect(JSON.stringify(failure)).not.toMatch(/private|API_KEY|secret|cause/)
    expect(failed.loadTransformers).not.toHaveBeenCalled()

    const healthy = fixture()
    await healthy.encoder.initialize()
    await Promise.all([healthy.encoder.close(), healthy.encoder.close()])
    expect(healthy.fake?.dispose).toHaveBeenCalledOnce()
  })
})
