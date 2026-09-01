"use client"

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ASSOCIATE'

  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [preferences, setPreferences] = useState<NotificationPreferenceRow[]>([])
  const [report, setReport] = useState<DeliveryReport | null>(null)

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  // Keyed by `${eventCategory}:${channel}` — disables just the one checkbox
  // being toggled instead of the whole preferences card, and prevents a
  // second click from firing before the first PATCH round-trips (which
  // could otherwise race and leave the UI showing a stale state).
  const [togglingChannel, setTogglingChannel] = useState<string | null>(null)

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
    if (markingId) return
    setError(null)
    setMarkingId(id)
    try {
      await markRead(id)
      refreshInbox(unreadOnly)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark notification as read')
    } finally {
      setMarkingId(null)
    }
  }

  async function handleMarkAllRead() {
    setError(null)
    setMessage(null)
    setMarkingAllRead(true)
    try {
      await markAllRead()
      setMessage('All notifications marked as read.')
      refreshInbox(unreadOnly)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark all as read')
    } finally {
      setMarkingAllRead(false)
    }
  }

  async function toggleChannel(row: NotificationPreferenceRow, channel: NotificationChannel) {
    const key = `${row.eventCategory}:${channel}`
    if (togglingChannel) return
    setError(null)
    setTogglingChannel(key)
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
    } finally {
      setTogglingChannel(null)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Notifications</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                Inbox
                {unreadCount > 0 && <Badge variant="secondary">{unreadCount} unread</Badge>}
              </CardTitle>
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
                <Button size="sm" variant="outline" disabled={markingAllRead || unreadCount === 0} onClick={handleMarkAllRead}>
                  {markingAllRead ? 'Marking…' : 'Mark all read'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

          <ul className="flex flex-col gap-2 text-sm">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  disabled={markingId === n.id}
                  className={`flex w-full flex-col items-start gap-1 rounded-md border p-2 text-left hover:bg-muted disabled:cursor-wait disabled:opacity-70 ${
                    !n.readAt ? 'bg-muted/50' : ''
                  }`}
                  onClick={() => !n.readAt && handleMarkRead(n.id)}
                >
                  <div className="flex w-full items-center justify-between">
                    <p className="font-medium">{n.title}</p>
                    {!n.readAt && <Badge variant="secondary">{markingId === n.id ? 'Marking…' : 'New'}</Badge>}
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery Preferences</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
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
                      className="flex items-center gap-1 text-xs text-muted-foreground has-disabled:opacity-50"
                    >
                      <input
                        type="checkbox"
                        checked={row.channelsEnabled.includes(channel)}
                        disabled={togglingChannel === `${row.eventCategory}:${channel}`}
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
          </CardContent>
        </Card>
      </div>

      {isHrAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Delivery Report</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
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
          </CardContent>
        </Card>
      )}
    </div>
  )
}
