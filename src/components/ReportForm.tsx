import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getClassifier, type ClassifierResult } from '../classifier'
import { describePath, graphFor } from '../core/graph'
import { CATEGORIES, type Campus, type Category, type Report, type Severity } from '../core/types'
import { addReport } from '../state/store'
import { CATEGORY_LABEL } from './labels'
import { CloseIcon } from './icons'
import { isSample, loadSamplePhoto, preparePhoto, SAMPLE_PHOTOS, type PreparedPhoto } from './photo'

/** Severity a category usually has; the user can change it. */
const DEFAULT_SEVERITY: Record<Category, Severity> = {
  blocked_ramp: 'blocked',
  parked_vehicle: 'partial',
  flooding: 'blocked',
  broken_pavement: 'partial',
  missing_kerb_cut: 'blocked',
  other: 'partial',
}

/** Confidence stored when the user picks a category with no photo to classify. */
const NO_PHOTO_CONFIDENCE = 0.5

type Analysis =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done'; result: ClassifierResult }
  | { state: 'error'; message: string }

interface FormProps {
  campus: Campus
  /** The road, or null while the person has not chosen one yet (every step still shows). */
  pathId: string | null
  /** Number shown on the first step, so a step placed above the form can be number 1. */
  firstStep?: number
  onSubmitted: (report: Report) => void
}

export function ReportForm({ campus, pathId, firstStep = 1, onSubmitted }: FormProps) {
  const path = pathId ? graphFor(campus).pathById.get(pathId) : undefined
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null)
  const [analysis, setAnalysis] = useState<Analysis>({ state: 'idle' })
  const [noPhoto, setNoPhoto] = useState(false)
  const [category, setCategory] = useState<Category | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [severity, setSeverity] = useState<Severity | null>(null)
  const [severityTouched, setSeverityTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const run = useRef(0)

  const suggestion = analysis.state === 'done' ? analysis.result : null

  function pickCategory(next: Category) {
    setCategory(next)
    setChoosing(false)
    if (!severityTouched) setSeverity(DEFAULT_SEVERITY[next])
  }

  async function analysePhoto(load: () => Promise<PreparedPhoto>) {
    const id = ++run.current
    setPhotoError(null)
    setNoPhoto(false)
    setCategory(null)
    setChoosing(false)
    setAnalysis({ state: 'working' })
    try {
      const prepared = await load()
      if (id !== run.current) return
      setPhoto(prepared)
      const result = await getClassifier().classify({
        image: prepared.bytes,
        mimeType: prepared.mimeType,
        fileName: prepared.fileName,
        context: path ? { stepFree: path.stepFree, slopePct: path.slopePct, widthM: path.widthM } : undefined,
      })
      if (id !== run.current) return
      setAnalysis({ state: 'done', result })
    } catch (error) {
      if (id !== run.current) return
      setAnalysis({ state: 'idle' })
      setPhotoError(error instanceof Error ? error.message : 'Could not read that photo.')
    }
  }

  async function submit() {
    if (!pathId || !category || !severity || saving) return
    setSaving(true)
    setSaveError(null)
    const result = await addReport({
      pathId,
      category,
      severity,
      description,
      confidence: suggestion ? suggestion.scores[category] : NO_PHOTO_CONFIDENCE,
      aiCategory: suggestion ? suggestion.category : null,
      photoUrl: photo?.dataUrl ?? null,
    })
    setSaving(false)
    if ('error' in result) setSaveError(result.error)
    else onSubmitted(result.report)
  }

  function onFile(file: File | undefined) {
    if (file) void analysePhoto(() => preparePhoto(file, file.name))
  }

  // A suggestion made before a road was chosen is redone with the road's facts, unless the person already answered.
  useEffect(() => {
    if (!photo || !pathId || analysis.state !== 'done' || category !== null) return
    void analysePhoto(async () => photo)
    // Only a change of road should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathId])

  const canSubmit = pathId !== null && category !== null && severity !== null && analysis.state !== 'working' && !saving

  return (
    <form
      className="report-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Step n={firstStep} title="Photo">
        {photo ? (
          <div className="photo-preview">
            <img src={photo.dataUrl} alt={isSample(photo) ? 'Sample drawing of the problem' : 'Photo of the problem'} />
            <div className="photo-side">
              {isSample(photo) && <p className="muted small">Sample drawing, not a real photo.</p>}
              <label className="btn btn-quiet btn-small file-btn">
                Replace photo
                <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </div>
          </div>
        ) : (
          <>
            <div className="row">
              <label className="btn file-btn">
                Take photo
                <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <label className="btn btn-ghost file-btn">
                Upload photo
                <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </div>
            <p className="muted small">No photo handy? Use a sample drawing:</p>
            <div className="sample-row">
              {SAMPLE_PHOTOS.map((s) => (
                <button key={s.id} type="button" className="btn btn-ghost btn-small" onClick={() => analysePhoto(() => loadSamplePhoto(s.id))}>
                  {s.label}
                </button>
              ))}
            </div>
            {!noPhoto && (
              <button type="button" className="link-btn" onClick={() => { setNoPhoto(true); setChoosing(true) }}>
                Skip the photo and choose the problem myself
              </button>
            )}
          </>
        )}
        {photoError && <p className="error">{photoError}</p>}
      </Step>

      <Step n={firstStep + 1} title="What is the problem?">
        {analysis.state === 'working' && (
          <p className="analysing" role="status">
            <span className="spinner" aria-hidden="true" /> Analysing photo…
          </p>
        )}
        {suggestion && (
          <div className="suggestion">
            <div className="suggestion-head">
              <span className={`ai-badge${suggestion.source === 'simulated' ? ' ai-badge-demo' : ''}`}>
                {suggestion.source === 'simulated' ? 'AI suggestion (demo)' : `AI suggestion · ${suggestion.model}`}
              </span>
              <span className="muted small">{Math.round(suggestion.confidence * 100)}% confidence</span>
            </div>
            <p className="suggestion-category">{CATEGORY_LABEL[suggestion.category]}</p>
            {suggestion.note && <p className="muted small">{suggestion.note}</p>}
            {category === null && !choosing && (
              <div className="row">
                <button type="button" className="btn btn-good btn-small" onClick={() => pickCategory(suggestion.category)}>
                  Looks right
                </button>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => setChoosing(true)}>
                  Change
                </button>
              </div>
            )}
          </div>
        )}
        {category !== null && !choosing && (
          <p className="confirmed">
            <span>
              <strong>{CATEGORY_LABEL[category]}</strong>
              {suggestion
                ? category === suggestion.category
                  ? ' (you confirmed the AI suggestion)'
                  : ` (you corrected the AI, which suggested ${CATEGORY_LABEL[suggestion.category]})`
                : ' (chosen by you)'}
            </span>
            <button type="button" className="link-btn" onClick={() => setChoosing(true)}>
              Change
            </button>
          </p>
        )}
        {choosing && (
          <div className="category-grid" role="radiogroup" aria-label="Problem type">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={category === c}
                className={`cat-option${category === c ? ' is-active' : ''}`}
                onClick={() => pickCategory(c)}
              >
                {CATEGORY_LABEL[c]}
                {suggestion && <span className="muted small">{Math.round(suggestion.scores[c] * 100)}%</span>}
              </button>
            ))}
          </div>
        )}
        {analysis.state === 'idle' && !noPhoto && category === null && (
          <p className="muted small">Add a photo first and the AI will suggest a category.</p>
        )}
      </Step>

      <Step n={firstStep + 2} title="How bad is it?">
        <div className="severity-grid">
          {(['blocked', 'partial'] as const).map((s) => (
            <label key={s} className={`severity-option${severity === s ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="severity"
                checked={severity === s}
                onChange={() => {
                  setSeverity(s)
                  setSeverityTouched(true)
                }}
              />
              <strong>{s === 'blocked' ? 'Blocked' : 'Partly blocked'}</strong>
              <span className="muted small">{s === 'blocked' ? 'Cannot get past' : 'Passable with difficulty'}</span>
            </label>
          ))}
        </div>
      </Step>

      <Step n={firstStep + 3} title="Anything to add? (optional)">
        <label className="field">
          <span className="visually-hidden">Description</span>
          <textarea
            rows={2}
            maxLength={280}
            placeholder="e.g. Barrier across the ramp, work crew on site"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </Step>

      <p className="muted small">
        New reports start as <strong>unverified</strong>. Routes avoid them whenever another way exists. They block a
        route outright only after 2 more people confirm them or an admin verifies them.
      </p>
      {saveError && <p className="error">{saveError}</p>}
      {!canSubmit && !saving && analysis.state !== 'working' && (
        <p className="muted small" role="status">
          Still needed:{' '}
          {[pathId === null && 'the road', category === null && 'what the problem is', severity === null && 'how bad it is']
            .filter(Boolean)
            .join(', ')}
          .
        </p>
      )}
      <button type="submit" className="btn submit-btn" disabled={!canSubmit}>
        {saving ? 'Saving…' : path ? `Submit report on ${describePath(campus, path.id)}` : 'Choose a road first'}
      </button>
    </form>
  )

}

export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="step">
      <legend>
        <span className="step-n">{n}</span> {title}
      </legend>
      {children}
    </fieldset>
  )
}

interface SheetProps {
  campus: Campus
  pathId: string
  /** Reports on this path, shown above the form. */
  children?: ReactNode
  onClose: () => void
  onSubmitted: (report: Report) => void
}

/** Dialog for one path: its facts, its reports and the report form. A bottom sheet on phones. */
export function ReportSheet({ campus, pathId, children, onClose, onSubmitted }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const path = graphFor(campus).pathById.get(pathId)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  if (!path) return null
  const facts = [
    path.stepFree ? 'step-free' : 'steps',
    `${path.lengthM} m long`,
    `${path.widthM} m wide`,
    `${path.slopePct}% slope`,
  ]
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close()
      }}
    >
      <div className="sheet-inner">
        <header className="sheet-head">
          <div>
            <h2 id="sheet-title">{describePath(campus, pathId)}</h2>
            <p className="muted small">{facts.join(' · ')}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>
            <CloseIcon />
          </button>
        </header>
        {children}
        <h3 className="sheet-section">Report a problem here</h3>
        <ReportForm campus={campus} pathId={pathId} onSubmitted={onSubmitted} />
      </div>
    </dialog>
  )
}
