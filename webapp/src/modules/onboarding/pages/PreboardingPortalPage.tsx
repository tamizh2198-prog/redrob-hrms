"use client"

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ApiError } from '@/lib/api'
import {
  getPortalProgress,
  completeTaskViaPortal,
  submitPreboarding,
  MANDATORY_FIELD_LABELS,
  type OnboardingProgress,
} from '../api'

const MANDATORY_FIELDS = Object.keys(MANDATORY_FIELD_LABELS)

// Public preboarding portal (Section 7.7): the new hire's own pre-Day-1
// checklist and document submission, reached via the magic-link token from
// the offer-accept flow — no employee login exists yet at this point.
export function PreboardingPortalPage() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [progress, setProgress] = useState<OnboardingProgress | null>(null)
  const [fieldType, setFieldType] = useState(MANDATORY_FIELDS[0])
  const [valueRef, setValueRef] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function refresh() {
    if (!token) return
    getPortalProgress(token)
      .then(setProgress)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'This link is invalid or has expired'))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleCompleteTask(taskId: string) {
    if (completingTaskId) return
    setError(null)
    setCompletingTaskId(taskId)
    try {
      await completeTaskViaPortal(taskId, token)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to complete task')
    } finally {
      setCompletingTaskId(null)
    }
  }

  async function handleSubmit() {
    if (submitting) return
    setError(null)
    setMessage(null)
    setSubmitting(true)
    try {
      await submitPreboarding(token, fieldType, valueRef)
      setMessage(`${MANDATORY_FIELD_LABELS[fieldType] ?? fieldType} submitted.`)
      setValueRef('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit document')
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return <div className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Missing portal link.</div>
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Welcome — Preboarding Portal</h1>
      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {progress && (
        <div className="rounded-md border p-4 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Your Checklist</h2>
            <Badge variant="outline">{progress.completionPercent}% complete</Badge>
          </div>
          <ul className="flex flex-col gap-1">
            {progress.checklist.tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between">
                <span>{t.description}</span>
                {t.status === 'COMPLETED' ? (
                  <Badge>Done</Badge>
                ) : t.ownerRole === 'NEW_HIRE' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={completingTaskId !== null}
                    onClick={() => handleCompleteTask(t.id)}
                  >
                    {completingTaskId === t.id ? 'Completing…' : 'Mark Complete'}
                  </Button>
                ) : (
                  <span className="text-muted-foreground">Handled by {t.ownerRole}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {progress && (
        <div className="rounded-md border p-4 text-sm">
          <h2 className="mb-2 font-medium">
            Documents ({MANDATORY_FIELDS.length - progress.missingMandatoryFields.length} of{' '}
            {MANDATORY_FIELDS.length} submitted)
          </h2>
          <ul className="flex flex-col gap-1">
            {MANDATORY_FIELDS.map((f) => {
              const isMissing = progress.missingMandatoryFields.includes(f)
              return (
                <li key={f} className="flex items-center justify-between">
                  <span>{MANDATORY_FIELD_LABELS[f]}</span>
                  {isMissing ? (
                    <span className="text-muted-foreground">Not yet submitted</span>
                  ) : (
                    <Badge>Submitted</Badge>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Submit a Document</h2>
        <div className="flex flex-col gap-2">
          <Label>Document type</Label>
          <Select value={fieldType} onValueChange={(v) => setFieldType(v ?? MANDATORY_FIELDS[0])}>
            <SelectTrigger>
              <SelectValue placeholder="Select type">
                {(v: string) => MANDATORY_FIELD_LABELS[v] ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MANDATORY_FIELDS.map((f) => (
                <SelectItem key={f} value={f}>
                  {MANDATORY_FIELD_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label>Reference / link to the document</Label>
          <Input value={valueRef} onChange={(e) => setValueRef(e.target.value)} />
          <Button disabled={submitting} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </div>
    </div>
  )
}
