import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { createCandidate } from '../api'

// Public careers-page-style application form (Section 7.6 Key Features):
// no login, linked to a specific open requisition via ?requisitionId=.
export function CareersApplyPage() {
  const [params] = useSearchParams()
  const requisitionId = params.get('requisitionId') ?? ''

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [resumeRef, setResumeRef] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    try {
      await createCandidate({
        requisitionId,
        name,
        email,
        phone: phone || undefined,
        resumeRef: resumeRef || undefined,
        source: 'career-site',
      })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit your application')
    }
  }

  if (!requisitionId) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-muted-foreground">
        This application link is missing its requisition reference.
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">Thanks for applying!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your application has been received. Our team will be in touch.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Apply for this role</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col gap-1">
        <Label>Full name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Phone</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Resume link</Label>
        <Input value={resumeRef} onChange={(e) => setResumeRef(e.target.value)} />
      </div>
      <Button onClick={handleSubmit}>Submit Application</Button>
    </div>
  )
}
