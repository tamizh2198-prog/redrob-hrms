import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ApiError } from '@/lib/api'
import {
  bulkUploadWfoSchedule,
  downloadWfoTemplate,
  type BulkWfoUploadResult,
} from '../api'

export function BulkWfoUploadDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BulkWfoUploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function runUpload(dryRun: boolean) {
    if (!file) {
      setError('Choose a file first')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await bulkUploadWfoSchedule(file, dryRun)
      setResult(res)
      if (!dryRun) onImported()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bulk upload failed')
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
          setFile(null)
          setResult(null)
          setError(null)
          if (fileInputRef.current) fileInputRef.current.value = ''
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline">Bulk Upload WFO Days</Button>} />
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Upload WFO Days</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          One row per employee, each with their own office weekdays for the month — download the
          template below, fill it in, then run a dry-run validation before committing.
        </p>

        <Button variant="outline" size="sm" className="self-start" onClick={downloadWfoTemplate}>
          Download Template
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

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="rounded-md border p-3 text-sm">
            <p>
              {result.dryRun ? 'Dry-run' : 'Upload'} result: {result.successCount}/
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
          <Button variant="outline" disabled={submitting || !file} onClick={() => runUpload(true)}>
            Dry Run
          </Button>
          <Button disabled={submitting || !result?.dryRun} onClick={() => runUpload(false)}>
            Commit Upload
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
