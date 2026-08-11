import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import {
  listInbox,
  markRead,
  markAllRead,
  getPreferences,
  updatePreferences,
  getDeliveryReport,
  type NotificationItem,
  type NotificationPreferenceRow,
  type NotificationChannel,
  type DeliveryReport,
} from '../api'

const TOGGLEABLE_CHANNELS: NotificationChannel[] = ['EMAIL', 'SLACK', 'SMS']

function label(value: string) {
  return value.replaceAll('_', ' ').replaceAll('-', ' ')
}

export function NotificationsPage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [preferences, setPreferences] = useState<NotificationPreferenceRow[]>([])
  const [report, setReport] = useState<DeliveryReport | null>(null)

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    refreshInbox(false)
    getPreferences().then(setPreferences).catch(() => setPreferences([]))
    if (isHrAdmin) refreshReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refreshInbox(nextUnreadOnly: boolean) {
    setLoading(true)
    listInbox({ unreadOnly: nextUnreadOnly })
      .then((r) => {
        setItems(r.items)
        setUnreadCount(r.unreadCount)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }

  function refreshReport() {
    getDeliveryReport().then(setReport).catch(() => setReport(null))
  }

  async function handleMarkRead(id: string) {
    setError(null)
    try {
      await markRead(id)
      refreshInbox(unreadOnly)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark notification as read')
    }
  }

  async function handleMarkAllRead() {
    setError(null)
    setMessage(null)
    try {
      await markAllRead()
      setMessage('All notifications marked as read.')
      refreshInbox(unreadOnly)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark all as read')
    }
  }

  async function toggleChannel(row: NotificationPreferenceRow, channel: NotificationChannel) {
    setError(null)
    const nextChannels = row.channelsEnabled.includes(channel)
      ? row.channelsEnabled.filter((c) => c !== channel)
      : [...row.channelsEnabled, channel]
    try {
      const updated = await updatePreferences({
        eventCategory: row.eventCategory,
        channelsEnabled: nextChannels,
      })
      setPreferences((prev) =>
        prev.map((p) => (p.eventCategory === row.eventCategory ? updated : p)),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update preference')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Notifications</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-md border p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-medium">
              Inbox
              {unreadCount > 0 && <Badge variant="secondary">{unreadCount} unread</Badge>}
            </h2>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => {
                    setUnreadOnly(e.target.checked)
                    refreshInbox(e.target.checked)
                  }}
                />
                Unread only
              </label>
              <Button size="sm" variant="outline" onClick={handleMarkAllRead}>
                Mark all read
              </Button>
            </div>
          </div>

          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

          <ul className="flex flex-col gap-2 text-sm">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  className={`flex w-full flex-col items-start gap-1 rounded border p-2 text-left hover:bg-muted ${
                    !n.readAt ? 'bg-muted/50' : ''
                  }`}
                  onClick={() => !n.readAt && handleMarkRead(n.id)}
                >
                  <div className="flex w-full items-center justify-between">
                    <p className="font-medium">{n.title}</p>
                    {!n.readAt && <Badge variant="secondary">New</Badge>}
                  </div>
                  {n.body && <p className="text-muted-foreground">{n.body}</p>}
                  <p className="text-xs text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
            {!loading && items.length === 0 && (
              <p className="text-muted-foreground">No notifications yet.</p>
            )}
          </ul>
        </div>

        <div className="rounded-md border p-4 text-sm">
          <h2 className="mb-2 font-medium">Delivery Preferences</h2>
          <p className="mb-3 text-muted-foreground">
            In-app delivery is always on. Email/Slack/SMS are simulated in this build (no
            mailer/SMS/Slack integration is wired up yet), but your preference is still recorded.
          </p>
          <ul className="flex flex-col gap-2">
            {preferences.map((row) => (
              <li
                key={row.eventCategory}
                className="flex items-center justify-between rounded border p-2"
              >
                <span>{label(row.eventCategory)}</span>
                <div className="flex items-center gap-3">
                  {TOGGLEABLE_CHANNELS.map((channel) => (
                    <label
                      key={channel}
                      className="flex items-center gap-1 text-xs text-muted-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={row.channelsEnabled.includes(channel)}
                        onChange={() => toggleChannel(row, channel)}
                      />
                      {channel}
                    </label>
                  ))}
                </div>
              </li>
            ))}
            {preferences.length === 0 && (
              <p className="text-muted-foreground">No preference categories yet.</p>
            )}
          </ul>
        </div>
      </div>

      {isHrAdmin && (
        <div className="rounded-md border p-4 text-sm">
          <h2 className="mb-2 font-medium">Delivery Report</h2>
          {report ? (
            <div className="flex flex-col gap-1">
              <p>In-app notifications delivered: {report.inAppCount}</p>
              <p>
                By channel:{' '}
                {Object.entries(report.byChannel)
                  .map(
                    ([channel, counts]) =>
                      `${channel}: ${counts.sent} sent / ${counts.failed} failed`,
                  )
                  .join(', ') || '—'}
              </p>
              <p>
                Volume by template:{' '}
                {Object.entries(report.volumeByTemplate)
                  .map(([template, count]) => `${template}: ${count}`)
                  .join(', ') || '—'}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">No delivery data yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
