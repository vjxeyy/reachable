import { useEffect, useState } from 'react'
import { apiUserAction, apiUsers, type AccessUser } from '../state/api'
import { formatAgo } from './labels'

const STATUS_TEXT: Record<AccessUser['status'], string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
}

/** The owner's list of sign-ups: approve or reject new ones, remove old ones. */
export function AccessRequests({ now }: { now: number }) {
  const [users, setUsers] = useState<AccessUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const { users: list } = await apiUsers()
        if (alive) {
          setUsers(list)
          setError(null)
        }
      } catch (problem) {
        if (alive) setError(problem instanceof Error ? problem.message : 'Could not load the list.')
      }
    }
    void load()
    const timer = setInterval(() => void load(), 10_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  async function act(user: AccessUser, action: 'approve' | 'reject' | 'remove') {
    if (action === 'remove' && !window.confirm(`Remove ${user.email}? They will have to sign up again.`)) return
    try {
      setUsers((await apiUserAction(user.id, action)).users)
      setError(null)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That did not work.')
    }
  }

  const waiting = users?.filter((u) => u.status === 'pending').length ?? 0

  return (
    <section className="panel" aria-labelledby="access-heading">
      <h2 id="access-heading">
        Access requests{waiting > 0 ? ` (${waiting} waiting)` : ''}
      </h2>
      <p className="muted small">
        People who signed up cannot use the Dashboard until you approve them. Approved people can verify and resolve
        reports. Only you can approve people or reset the demo.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {users === null && !error && <p className="muted small">Loading.</p>}
      {users?.length === 0 && <p className="muted small">Nobody has signed up yet.</p>}
      {users && users.length > 0 && (
        <ul className="access-list">
          {users.map((user) => (
            <li key={user.id} className="access-item">
              <div>
                <strong className="access-email">{user.email}</strong>
                <span className={`pill pill-${user.status === 'approved' ? 'cleared' : user.status === 'pending' ? 'unverified' : 'outdated'}`}>
                  {STATUS_TEXT[user.status]}
                </span>
                <div className="muted small">Signed up {formatAgo(now - user.createdAt)}</div>
              </div>
              <div className="row">
                {user.status !== 'approved' && (
                  <button type="button" className="btn btn-good btn-small" onClick={() => void act(user, 'approve')}>
                    Approve
                  </button>
                )}
                {user.status === 'pending' && (
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => void act(user, 'reject')}>
                    Reject
                  </button>
                )}
                <button type="button" className="btn btn-quiet btn-small" onClick={() => void act(user, 'remove')}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
