// Shared data types for REACHABLE. Field names follow PLAN.md section 5.
// Pure types and constants only: no React, DOM, network or Node code in src/core.

export const CATEGORIES = [
  'blocked_ramp',
  'parked_vehicle',
  'flooding',
  'broken_pavement',
  'missing_kerb_cut',
  'other',
] as const
export type Category = (typeof CATEGORIES)[number]

export const SEVERITIES = ['blocked', 'partial'] as const
/** `blocked` = fully impassable, `partial` = passable with difficulty. */
export type Severity = (typeof SEVERITIES)[number]

/** Always derived from the report, its confirmations and the current time (see trust.ts). */
export type ReportStatus = 'verified' | 'unverified' | 'outdated' | 'cleared'

export type Vote = 'still_there' | 'cleared'

export const PROFILE_IDS = ['wheelchair', 'crutches', 'low_vision'] as const
export type ProfileId = (typeof PROFILE_IDS)[number]

/** How the illustrated map draws a place. Drawing only: routing ignores it. */
export const NODE_KINDS = ['building', 'green', 'field', 'lot', 'gate', 'stop'] as const
export type NodeKind = (typeof NODE_KINDS)[number]

/** Epoch milliseconds. */
export type Timestamp = number

export interface CampusNode {
  id: string
  name: string
  x: number
  y: number
  areaId: string
  /** Optional: drawn as a building when missing. */
  kind?: NodeKind
}

/** A two-way walking link between two nodes. */
export interface CampusPath {
  id: string
  from: string
  to: string
  lengthM: number
  stepFree: boolean
  widthM: number
  slopePct: number
  areaId: string
}

export interface Campus {
  areaId: string
  name: string
  /** Map drawing size in the same units as node x/y. */
  width: number
  height: number
  nodes: CampusNode[]
  paths: CampusPath[]
}

export interface Report {
  id: string
  areaId: string
  pathId: string
  category: Category
  severity: Severity
  /** Cached copy of the derived status. Logic never trusts it; call deriveStatus(). */
  status: ReportStatus
  /** AI confidence (0 to 1) for the category the user confirmed. */
  confidence: number
  /** The category the classifier suggested, or null when no suggestion was made. */
  aiCategory: Category | null
  photoUrl: string | null
  description: string
  /** Anonymous id of the device that filed the report. It cannot confirm its own report. */
  reporterId: string
  createdAt: Timestamp
  lastConfirmedAt: Timestamp
  clearedAt: Timestamp | null
  /** Set when an admin verifies the report. Makes it `verified` until it goes outdated. */
  adminVerifiedAt: Timestamp | null
}

export interface Confirmation {
  reportId: string
  areaId: string
  /** Anonymous device id. One vote per device per report keeps confirmations independent. */
  voterId: string
  vote: Vote
  at: Timestamp
}
