"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
import { dismissEmployee } from '../api'

// This task: dismissal must go through a confirmation dialog, not
// window.confirm/alert — the app already has a Dialog component, so this
// reuses it rather than introducing a second confirmation mechanism.
export function DismissEmployeeDialog({
  employeeId,
  employeeName,
  onDismissed,
}: {
  employeeId: string
  employeeName: string
  onDismissed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await dismissEmployee(employeeId)
      setOpen(false)
      onDismissed()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to dismiss employee')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive">Dismiss Employee</Button>} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dismiss Employee?</DialogTitle>
          <DialogDescription>
            Are you sure you want to dismiss {employeeName}? This will deactivate the employee&apos;s
            account and prevent further login. Existing HR records will be retained.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={submitting} />}>
            Cancel
          </DialogClose>
          <Button variant="destructive" disabled={submitting} onClick={handleConfirm}>
            {submitting ? 'Dismissing…' : 'Dismiss Employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
