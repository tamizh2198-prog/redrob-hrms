"use client"

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { getOfferPortal, respondOffer } from '../api'

// Public offer-accept page reached via the magic-link token emailed to the
// candidate ("candidate accepts an offer letter online").
export function OfferResponsePage() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [offer, setOffer] = useState<{
    status: string
    ctcBreakup: Record<string, unknown>
    candidateName: string
    requisitionTitle: string
  } | null>(null)
  const [result, setResult] = useState<{ status: string; preboardingLink?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    getOfferPortal(token)
      .then(setOffer)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'This link is invalid or has expired'))
  }, [token])

  async function respond(decision: 'ACCEPT' | 'DECLINE') {
    setError(null)
    try {
      const res = await respondOffer(token, decision)
      setResult(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record your response')
    }
  }

  if (!token) {
    return <div className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Missing offer link.</div>
  }

  if (result) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">
          {result.status === 'ACCEPTED' ? 'Welcome aboard!' : 'Offer declined'}
        </h1>
        {result.status === 'ACCEPTED' && result.preboardingLink && (
          <div className="mt-4 text-sm">
            <p className="text-muted-foreground">
              Continue to your preboarding portal to complete your joining formalities:
            </p>
            <a
              className="mt-2 block break-all text-primary underline"
              href={`/preboard?token=${result.preboardingLink}`}
            >
              Go to preboarding portal
            </a>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Your Offer</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {offer && (
        <div className="rounded-md border p-4 text-sm">
          <p>
            <span className="font-medium">{offer.candidateName}</span> — {offer.requisitionTitle}
          </p>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
            {JSON.stringify(offer.ctcBreakup, null, 2)}
          </pre>
        </div>
      )}
      {offer?.status === 'SENT' && (
        <div className="flex gap-2">
          <Button onClick={() => respond('ACCEPT')}>Accept Offer</Button>
          <Button variant="outline" onClick={() => respond('DECLINE')}>
            Decline
          </Button>
        </div>
      )}
      {offer && offer.status !== 'SENT' && (
        <p className="text-sm text-muted-foreground">
          This offer has already been responded to.
        </p>
      )}
    </div>
  )
}
