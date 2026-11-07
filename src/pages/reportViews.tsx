import { useMemo } from 'react'
import { ClearButton } from '../components/ReportList'
import { TrustBadge } from '../components/TrustBadge'
import { withDerivedStatus } from '../core/trust'
import type { Report } from '../core/types'
import { clearBlocked, clearReport, notify, useNow, useStore } from '../state/store'

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
    <ClearButton
      report={report}
      blockedReason={() => clearBlocked(report)}
      onClear={async () => notify((await clearReport(report.id)) ?? 'Marked cleared. Routes updated.')}
    />
  )

  return { reports, confirmations, now, live, visible, renderStatus, renderActions }
}
