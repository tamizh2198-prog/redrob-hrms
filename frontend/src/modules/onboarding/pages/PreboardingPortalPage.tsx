import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import { getPortalProgress, completeTaskViaPortal, submitPreboarding, type OnboardingProgress } from '../api'

const MANDATORY_FIELDS = ['ID_PROOF', 'EDUCATION_CERTIFICATE', 'BANK_DETAILS', 'BACKGROUND_CHECK_CONSENT']

// Public preboarding portal (Section 7.7): the new hire's own pre-Day-1
// checklist and document submission, reached via the magic-link token from
// the offer-accept flow — no employee login exists yet at this point.
export function PreboardingPortalPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [progress, setProgress] = useState<OnboardingProgress | null>(null)
  const [fieldType, setFieldType] = useState(MANDATORY_FIELDS[0])
  const [valueRef, setValueRef] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    setError(null)
    try {
      await completeTaskViaPortal(taskId, token)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to complete task')
    }
  }

  async function handleSubmit() {
    setError(null)
    setMessage(null)
    try {
      await submitPreboarding(token, fieldType, valueRef)
      setMessage(`${fieldType.replaceAll('_', ' ')} submitted.`)
      setValueRef('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit document')
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
                  <Button size="sm" variant="outline" onClick={() => handleCompleteTask(t.id)}>
                    Mark Complete
                  </Button>
                ) : (
                  <span className="text-muted-foreground">Handled by {t.ownerRole}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Submit a Document</h2>
        <div className="flex flex-col gap-2">
          <Label>Document type</Label>
          <Select value={fieldType} onValueChange={setFieldType}>
            <SelectTrigger>
              <SelectValue placeholder="Select type">
                {(v: string) => v.replaceAll('_', ' ')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MANDATORY_FIELDS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f.replaceAll('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label>Reference / link to the document</Label>
          <Input value={valueRef} onChange={(e) => setValueRef(e.target.value)} />
          <Button onClick={handleSubmit}>Submit</Button>
        </div>
      </div>
    </div>
  )
}
