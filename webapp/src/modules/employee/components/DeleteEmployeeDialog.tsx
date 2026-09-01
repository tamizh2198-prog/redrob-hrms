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
import { deleteEmployee } from '../api'

// This task: Super Admin-only permanent removal, for test/development
// cleanup only — separate component from DismissEmployeeDialog (which
// remains the real-world offboarding path, unchanged). Mirrors its
// confirm-dialog pattern rather than window.confirm/alert.
export function DeleteEmployeeDialog({
  employeeId,
  employeeName,
  onDeleted,
}: {
  employeeId: string
  employeeName: string
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await deleteEmployee(employeeId)
      setOpen(false)
      onDeleted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete employee')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive">Delete Employee</Button>} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Employee?</DialogTitle>
          <DialogDescription>
            This will permanently delete {employeeName}&apos;s employee record and associated
            test/invitation data. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={submitting} />}>
            Cancel
          </DialogClose>
          <Button variant="destructive" disabled={submitting} onClick={handleConfirm}>
            {submitting ? 'Deleting…' : 'Delete Employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
