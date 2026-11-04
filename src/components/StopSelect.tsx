import type { Campus } from '../core/types'

/** A list of every place on the campus, for choosing a start or a destination. */
export function StopSelect({
  label,
  placeholder,
  value,
  campus,
  onPick,
}: {
  label: string
  placeholder: string
  value: string
  campus: Campus
  onPick: (id: string) => void
}) {
  const sorted = [...campus.nodes].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onPick(e.target.value)}>
        <option value="">{placeholder}</option>
        {sorted.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
    </label>
  )
}
