import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ApiError } from '@/lib/api'
import { bulkImportEmployees, type BulkImportResult, type Employee } from '../api'

const PLACEHOLDER = JSON.stringify(
  [
    {
      firstName: 'Jane',
      lastName: 'Doe',
      dob: '1992-05-01',
      gender: 'FEMALE',
      dateOfJoining: '2026-01-15',
      pan: 'ABCDE1234F',
      bankAccountNumber: '000111222333',
      emergencyContactName: 'John Doe',
      emergencyContactPhone: '9999999999',
    },
  ],
  null,
  2,
)

export function BulkImportDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function parseRows(): Partial<Employee>[] | null {
    try {
      const parsed = JSON.parse(raw || '[]');
      if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of rows');
      return parsed as Partial<Employee>[]
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
      return null
    }
  }

  async function runImport(dryRun: boolean) {
    setError(null)
    const rows = parseRows()
    if (!rows) return
    setSubmitting(true)
    try {
      const res = await bulkImportEmployees(rows, dryRun)
      setResult(res)
      if (!dryRun) onImported()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bulk import failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setResult(null)
          setError(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline">Bulk Import</Button>} />
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import Employees</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Paste a JSON array of employee rows, run a dry-run validation first, then commit.
        </p>

        <Textarea
          rows={12}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={PLACEHOLDER}
          className="font-mono text-xs"
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="rounded-md border p-3 text-sm">
            <p>
              {result.dryRun ? 'Dry-run' : 'Import'} result: {result.successCount}/
              {result.totalRows} succeeded, {result.failureCount} failed.
            </p>
            <ul className="mt-2 list-disc pl-5">
              {result.results
                .filter((r) => !r.success)
                .map((r) => (
                  <li key={r.row}>
                    Row {r.row + 1}: {r.errors?.join('; ')}
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" disabled={submitting} onClick={() => runImport(true)}>
            Dry Run
          </Button>
          <Button
            disabled={submitting || !result?.dryRun}
            onClick={() => runImport(false)}
          >
            Commit Import
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
