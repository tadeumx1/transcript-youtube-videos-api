import { useEffect, useState } from 'react'
import type { ReadingState, Video } from '../api/types'
export function ReadingTools({
  video,
  update,
  download,
}: {
  video: Video
  update: (patch: Partial<ReadingState>) => Promise<ReadingState>
  download: () => Promise<void>
}) {
  const saved = video.reading || { favorite: false, read: false, notes: '', updatedAt: null }
  const [notes, setNotes] = useState(saved.notes)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!dirty) setNotes(saved.notes)
  }, [saved.notes, dirty])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function run(work: () => Promise<unknown>, success: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
      setNotice(success)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }
  const count = Array.from(notes).length
  return (
    <section className="reading-tools" aria-label="Your reading notes">
      <div className="reading-actions">
        <button
          type="button"
          aria-pressed={saved.favorite}
          disabled={busy}
          onClick={() =>
            void run(
              () => update({ favorite: !saved.favorite }),
              saved.favorite ? 'Favorite removed.' : 'Added to favorites.',
            )
          }
        >
          {saved.favorite ? 'Remove favorite' : 'Add favorite'}
        </button>
        <button
          type="button"
          aria-pressed={saved.read}
          disabled={busy}
          onClick={() =>
            void run(
              () => update({ read: !saved.read }),
              saved.read ? 'Marked unread.' : 'Marked as read.',
            )
          }
        >
          {saved.read ? 'Mark unread' : 'Mark as read'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(download, 'Markdown downloaded.')}
        >
          Download Markdown
        </button>
      </div>
      <label htmlFor="personal-notes">Personal notes</label>
      <textarea
        id="personal-notes"
        rows={4}
        value={notes}
        disabled={busy}
        aria-describedby="notes-count"
        onChange={(event) => {
          setNotes(event.target.value)
          setDirty(event.target.value !== saved.notes)
          setNotice('')
        }}
      />
      <div className="notes-footer">
        <span id="notes-count">
          {count} / 10000 characters{dirty ? ' · Unsaved changes' : ''}
        </span>
        <button
          type="button"
          disabled={busy || !dirty || count > 10000}
          onClick={() =>
            void run(async () => {
              const result = await update({ notes })
              setNotes(result.notes)
              setDirty(false)
            }, 'Notes saved.')
          }
        >
          Save notes
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}
