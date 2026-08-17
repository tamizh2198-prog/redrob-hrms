import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { ApiError } from '@/lib/api'
import { submitCompOffRequest, myCompOffRequests, type CompOffRequest } from '../api'

// Reachable by any employee (including managers/HR admins, who can also
// work a holiday) — placed unconditionally on the Dashboard's generic
// branch, per the explicit "apply for comp-off from the employee
// dashboard" instruction.
export function CompOffCard() {
  const [requests, setRequests] = useState<CompOffRequest[]>([])
  const [open, setOpen] = useState(false)
  const [workedDate, setWorkedDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function refresh() {
    myCompOffRequests().then(setRequests).catch(() => setRequests([]))
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await submitCompOffRequest({ workedDate, reason })
      setOpen(false)
      setWorkedDate('')
      setReason('')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit comp-off request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Comp-Off</CardTitle>
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next)
              if (next) setError(null)
            }}
          >
            <DialogTrigger render={<Button size="sm">Apply for Comp-Off</Button>} />
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Apply for Comp-Off</DialogTitle>
                <DialogDescription>
                  Pick the holiday or week-off date you worked. Once your manager approves, you
                  get 1 spendable leave day.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <Label>Date worked</Label>
                  <Input type="date" value={workedDate} onChange={(e) => setWorkedDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Reason</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={submitting} />}>
                  Cancel
                </DialogClose>
                <Button disabled={submitting || !workedDate || !reason} onClick={handleSubmit}>
                  {submitting ? 'Submitting…' : 'Submit'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-md bg-muted px-2 py-1">
              <span>
                {r.workedDate.slice(0, 10)} — {r.reason}
              </span>
              <Badge
                variant={
                  r.status === 'APPROVED' ? 'default' : r.status === 'REJECTED' ? 'destructive' : 'outline'
                }
              >
                {r.status}
              </Badge>
            </li>
          ))}
          {requests.length === 0 && (
            <p className="text-sm text-muted-foreground">No comp-off requests yet.</p>
          )}
        </ul>
      </CardContent>
    </Card>
  )
}
