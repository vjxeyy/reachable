import { useMemo } from 'react'
import { VoteButtons } from '../components/ReportList'
import { TrustBadge } from '../components/TrustBadge'
import { withDerivedStatus } from '../core/trust'
import type { Report } from '../core/types'
import { castVote, notify, useNow, useStore, voteBlocked } from '../state/store'

/**
 * What the pages that list reports share: reports with their status worked out for "now", newest first,
 * and the status and vote controls under each one.
 */
export function useReportViews() {
  const { reports, confirmations } = useStore()
  const now = useNow()
  const live = useMemo(
    () => withDerivedStatus(reports, confirmations, now).sort((a, b) => b.createdAt - a.createdAt),
    [reports, confirmations, now],
  )
  const visible = live.filter((r) => r.status !== 'cleared')

  const renderStatus = (report: Report) => <TrustBadge report={report} confirmations={confirmations} now={now} />
  const renderActions = (report: Report) => (
    <VoteButtons
      report={report}
      blockedReason={(vote) => voteBlocked(report, vote)}
      onVote={async (vote) => {
        const problem = await castVote(report.id, vote)
        notify(problem ?? (vote === 'cleared' ? 'Marked cleared. Routes updated.' : 'Thanks, confirmation added.'))
      }}
    />
  )

  return { reports, confirmations, now, live, visible, renderStatus, renderActions }
}
