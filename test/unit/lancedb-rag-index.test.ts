import { describe, expect, it } from 'vitest'

import { documentPredicate } from '../../src/infrastructure/rag/lancedb-rag-index.js'

describe('LanceDB RAG document predicate', () => {
  it('uses the approved unqualified predicate after validating the SHA-256 identifier', () => {
    const documentId = 'a'.repeat(64)

    expect(documentPredicate(documentId)).toBe(`document_id = '${documentId}'`)
  })

  it.each(["a' OR true --", 'A'.repeat(64), 'a'.repeat(63), `../${'a'.repeat(64)}`])(
    'rejects an unvalidated predicate input: %s',
    (documentId) => {
      expect(() => documentPredicate(documentId)).toThrow()
    },
  )
})
