import { join } from 'node:path'

import { RagError } from '../../domain/rag.js'
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_DTYPE,
  EMBEDDING_FINGERPRINT,
  EMBEDDING_NORMALIZED,
  EMBEDDING_POOLING,
  MODEL_REPOSITORY,
  MODEL_REVISION,
  PASSAGE_PREFIX,
  QUERY_PREFIX,
  verifyModelAssets,
} from './model-manifest.js'

export interface LocalE5Tensor {
  data: ArrayLike<number>
  dims: readonly number[]
}

export interface LocalE5Pipeline {
  (texts: string | string[], options: { pooling: 'mean'; normalize: true }): Promise<LocalE5Tensor>
  tokenizer: {
    encode(text: string, options: { add_special_tokens: true }): ArrayLike<unknown>
  }
  dispose(): Promise<void>
}

export interface LocalE5TransformersModule {
  env: {
    allowRemoteModels: boolean
    allowLocalModels: boolean
    useBrowserCache: boolean
  }
  pipeline(
    task: 'feature-extraction',
    model: string,
    options: { dtype: 'uint8'; local_files_only: true; revision: string },
  ): Promise<LocalE5Pipeline>
}

export interface LocalE5EncoderOptions {
  modelRoot: string
  loadTransformers?: () => Promise<LocalE5TransformersModule>
  verifyAssets?: typeof verifyModelAssets
}

const NORMALIZATION_TOLERANCE = 1e-3

async function loadTransformersModule(): Promise<LocalE5TransformersModule> {
  return (await import('@huggingface/transformers')) as unknown as LocalE5TransformersModule
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export class LocalE5Encoder {
  readonly embeddingFingerprint = EMBEDDING_FINGERPRINT
  readonly #modelPath: string
  readonly #loadTransformers: () => Promise<LocalE5TransformersModule>
  readonly #verifyAssets: typeof verifyModelAssets
  #pipeline: LocalE5Pipeline | undefined
  #initializePromise: Promise<void> | undefined
  #closePromise: Promise<void> | undefined

  constructor(options: LocalE5EncoderOptions) {
    this.#modelPath = join(options.modelRoot, ...MODEL_REPOSITORY.split('/'))
    this.#loadTransformers = options.loadTransformers ?? loadTransformersModule
    this.#verifyAssets = options.verifyAssets ?? verifyModelAssets
  }

  initialize(): Promise<void> {
    if (this.#pipeline) return Promise.resolve()
    if (this.#initializePromise) return this.#initializePromise
    const initialization = this.#initialize()
    this.#initializePromise = initialization
    void initialization.catch(() => {
      if (this.#initializePromise === initialization) this.#initializePromise = undefined
    })
    return initialization
  }

  async #initialize(): Promise<void> {
    let pipeline: LocalE5Pipeline | undefined
    try {
      const verified = await this.#verifyAssets(this.#modelPath)
      if (verified.embeddingFingerprint !== EMBEDDING_FINGERPRINT) {
        throw new Error('embedding fingerprint mismatch')
      }
      const transformers = await this.#loadTransformers()
      transformers.env.allowRemoteModels = false
      transformers.env.allowLocalModels = true
      transformers.env.useBrowserCache = false
      pipeline = await transformers.pipeline('feature-extraction', this.#modelPath, {
        dtype: EMBEDDING_DTYPE,
        local_files_only: true,
        revision: MODEL_REVISION,
      })
      const warmup = await pipeline(`${QUERY_PREFIX}warmup`, {
        pooling: EMBEDDING_POOLING,
        normalize: EMBEDDING_NORMALIZED,
      })
      this.#vectors(warmup, 1)
      this.#pipeline = pipeline
    } catch {
      await pipeline?.dispose().catch(() => undefined)
      throw new RagError('RAG_MODEL_UNAVAILABLE')
    }
  }

  countModelTokens(text: string): number {
    const pipeline = this.#requiredPipeline()
    try {
      const encoded = pipeline.tokenizer.encode(text, { add_special_tokens: true })
      const count = encoded.length
      if (!Number.isSafeInteger(count) || count < 1) throw new Error('invalid tokenizer output')
      return count
    } catch {
      throw new RagError('RAG_MODEL_UNAVAILABLE')
    }
  }

  embedQuery(query: string, signal?: AbortSignal): Promise<Float32Array> {
    return this.#embed([`${QUERY_PREFIX}${query}`], signal).then(
      (vectors) => vectors[0] as Float32Array,
    )
  }

  embedPassages(passages: readonly string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (passages.length === 0) return Promise.resolve([])
    return this.#embed(
      passages.map((passage) => `${PASSAGE_PREFIX}${passage}`),
      signal,
    )
  }

  async #embed(inputs: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    signal?.throwIfAborted()
    try {
      const output = await this.#requiredPipeline()(
        inputs.length === 1 ? (inputs[0] as string) : inputs,
        {
          pooling: EMBEDDING_POOLING,
          normalize: EMBEDDING_NORMALIZED,
        },
      )
      signal?.throwIfAborted()
      return this.#vectors(output, inputs.length)
    } catch (error) {
      if (isAbort(error)) throw error
      if (error instanceof RagError) throw error
      throw new RagError('RAG_MODEL_UNAVAILABLE')
    }
  }

  #vectors(tensor: LocalE5Tensor, count: number): Float32Array[] {
    if (
      tensor.dims.length !== 2 ||
      tensor.dims[0] !== count ||
      tensor.dims[1] !== EMBEDDING_DIMENSIONS ||
      tensor.data.length !== count * EMBEDDING_DIMENSIONS
    ) {
      throw new Error('invalid embedding dimensions')
    }
    const vectors: Float32Array[] = []
    for (let index = 0; index < count; index += 1) {
      const vector = new Float32Array(EMBEDDING_DIMENSIONS)
      let squaredNorm = 0
      for (let offset = 0; offset < EMBEDDING_DIMENSIONS; offset += 1) {
        const value = Number(tensor.data[index * EMBEDDING_DIMENSIONS + offset])
        if (!Number.isFinite(value)) throw new Error('invalid embedding value')
        vector[offset] = value
        squaredNorm += value * value
      }
      const norm = Math.sqrt(squaredNorm)
      if (!Number.isFinite(norm) || Math.abs(norm - 1) > NORMALIZATION_TOLERANCE) {
        throw new Error('invalid embedding norm')
      }
      vectors.push(vector)
    }
    return vectors
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closePromise = this.#close()
    return this.#closePromise
  }

  async #close(): Promise<void> {
    const pipeline = this.#pipeline
    this.#pipeline = undefined
    if (pipeline) await pipeline.dispose()
  }

  #requiredPipeline(): LocalE5Pipeline {
    if (!this.#pipeline) throw new RagError('RAG_MODEL_UNAVAILABLE')
    return this.#pipeline
  }
}
