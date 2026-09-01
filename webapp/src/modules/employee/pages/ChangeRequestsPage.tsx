"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  approveChangeRequest,
  listChangeRequests,
  rejectChangeRequest,
  type ChangeRequest,
} from '../api'

export function ChangeRequestsPage() {
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  // { id, decision } guards a single in-flight approve/reject so a slow
  // response can't be double-fired by a second click.
  const [deciding, setDeciding] = useState<{ id: string; decision: 'approve' | 'reject' } | null>(null)

  function load() {
    listChangeRequests('PENDING')
      .then(setRequests)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }

  useEffect(() => {
    load()
  }, [])

  async function handleApprove(id: string) {
    if (deciding) return
    setError(null)
    setDeciding({ id, decision: 'approve' })
    try {
      await approveChangeRequest(id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve request')
    } finally {
      setDeciding(null)
    }
  }

  async function handleReject(id: string) {
    if (deciding) return
    setError(null)
    setDeciding({ id, decision: 'reject' })
    try {
      await rejectChangeRequest(id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject request')
    } finally {
      setDeciding(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Link href="/employee" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← Back to directory
      </Link>
      <h1 className="text-xl font-semibold">Pending Profile Change Requests</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Field</TableHead>
            <TableHead>Old value</TableHead>
            <TableHead>New value</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                {r.employee.firstName} {r.employee.lastName}
              </TableCell>
              <TableCell>{r.fieldName}</TableCell>
              <TableCell>{r.oldValue}</TableCell>
              <TableCell>{r.newValue}</TableCell>
              <TableCell className="flex gap-2">
                <Button
                  size="sm"
                  variant="success"
                  disabled={deciding !== null}
                  onClick={() => handleApprove(r.id)}
                >
                  {deciding?.id === r.id && deciding.decision === 'approve' ? 'Approving…' : 'Approve'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deciding !== null}
                  onClick={() => handleReject(r.id)}
                >
                  {deciding?.id === r.id && deciding.decision === 'reject' ? 'Rejecting…' : 'Reject'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {requests.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No pending requests.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
