"use client"

import { useRef, useState } from 'react'
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
import {
  bulkImportEmployees,
  bulkImportEmployeesFromFile,
  downloadEmployeeBulkImportTemplate,
  type BulkImportResult,
  type Employee,
} from '../api'

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
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Which specific button is running — submitting alone can't tell "JSON
  // dry run" from "file commit", since both share the same busy flag.
  const [runningAction, setRunningAction] = useState<{ source: 'file' | 'json'; dryRun: boolean } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setMessage(null)
    const rows = parseRows()
    if (!rows) return
    setSubmitting(true)
    setRunningAction({ source: 'json', dryRun })
    try {
      const res = await bulkImportEmployees(rows, dryRun)
      setResult(res)
      if (!dryRun) onImported()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bulk import failed')
    } finally {
      setSubmitting(false)
      setRunningAction(null)
    }
  }

  async function handleDownloadTemplate() {
    setError(null)
    setMessage(null)
    setDownloading(true)
    try {
      await downloadEmployeeBulkImportTemplate()
      setMessage("Template downloaded — check your browser's downloads.")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to download template')
    } finally {
      setDownloading(false)
    }
  }

  async function runFileImport(dryRun: boolean) {
    if (!file) {
      setError('Choose an Excel file first')
      return
    }
    setError(null)
    setMessage(null)
    setSubmitting(true)
    setRunningAction({ source: 'file', dryRun })
    try {
      const res = await bulkImportEmployeesFromFile(file, dryRun)
      setResult(res)
      if (!dryRun) onImported()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bulk import failed')
    } finally {
      setSubmitting(false)
      setRunningAction(null)
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
          setMessage(null)
          setFile(null)
          if (fileInputRef.current) fileInputRef.current.value = ''
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline">Bulk Import</Button>} />
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import Employees</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-md border p-3">
          <h3 className="font-medium">Upload an Excel file</h3>
          <p className="text-sm text-muted-foreground">
            Download the template, fill it in, then run a dry-run validation before committing.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={downloading}
            onClick={handleDownloadTemplate}
          >
            {downloading ? 'Downloading…' : 'Download Template'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setResult(null)
            }}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button variant="outline" disabled={submitting || !file} onClick={() => runFileImport(true)}>
              {runningAction?.source === 'file' && runningAction.dryRun ? 'Running…' : 'Dry Run'}
            </Button>
            <Button disabled={submitting || !file || !result?.dryRun} onClick={() => runFileImport(false)}>
              {runningAction?.source === 'file' && !runningAction.dryRun ? 'Importing…' : 'Commit Import'}
            </Button>
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground">— or —</p>

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

        {message && <p className="text-sm text-primary">{message}</p>}
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
            {runningAction?.source === 'json' && runningAction.dryRun ? 'Running…' : 'Dry Run'}
          </Button>
          <Button
            disabled={submitting || !result?.dryRun}
            onClick={() => runImport(false)}
          >
            {runningAction?.source === 'json' && !runningAction.dryRun ? 'Importing…' : 'Commit Import'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
