import type { ProfileId } from '../core/types'

interface IconProps {
  size?: number
}

function WheelchairIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="4" r="2" fill="currentColor" stroke="none" />
      <path d="M11 7v6h6l2 6" />
      <path d="M11 10h5" />
      <path d="M8 10.5a6 6 0 1 0 8.2 7" />
    </svg>
  )
}

function CrutchesIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h6" />
      <path d="M8 3l2.5 18" />
      <path d="M12 3l-1.5 18" />
      <path d="M8.6 12h3" />
      <path d="M15 5h5" />
      <path d="M16 5l1.5 16" />
      <path d="M19 5l-1.5 16" />
    </svg>
  )
}

function LowVisionIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M4 20L20 4" />
    </svg>
  )
}

export function ProfileIcon({ profile, size }: IconProps & { profile: ProfileId }) {
  if (profile === 'wheelchair') return <WheelchairIcon size={size} />
  if (profile === 'crutches') return <CrutchesIcon size={size} />
  return <LowVisionIcon size={size} />
}
