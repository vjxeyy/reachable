import type { ProfileId, ReportStatus } from '../core/types'

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

const base = {
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function CheckIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

export function CloseIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} {...base}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** Two arrows, up and down: swaps the start and the destination. */
export function SwapIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={2}>
      <path d="M8 20V5M4.5 8.5L8 5l3.5 3.5" />
      <path d="M16 4v15M12.5 15.5L16 19l3.5-3.5" />
    </svg>
  )
}

function ClockIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function RingIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} {...base}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  )
}

/** A small mark for a report status. The status word is always shown next to it. */
export function StatusIcon({ status, size }: IconProps & { status: ReportStatus }) {
  if (status === 'outdated') return <ClockIcon size={size} />
  if (status === 'unverified') return <RingIcon size={size} />
  return <CheckIcon size={size} />
}

export function MapIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={1.8}>
      <path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </svg>
  )
}

export function FlagIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={1.8}>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 4 2.5 4H5" />
    </svg>
  )
}

export function GridIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={1.8}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </svg>
  )
}

export function PersonIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} {...base} strokeWidth={1.8}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.9-3.6 3.8-5.4 7.5-5.4s6.6 1.8 7.5 5.4" />
    </svg>
  )
}
