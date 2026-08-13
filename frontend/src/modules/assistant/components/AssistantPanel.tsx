import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import {
  sendMessage,
  confirmAction,
  uploadPolicyDocument,
  type AssistantMessage,
} from '../api'

// Content-only chat UI, shared by whatever container renders it (today:
// the floating AssistantBubble popover) — no page heading/padding of its
// own, so it fits a small popover just as well as a full page would.
export function AssistantPanel() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [conversationId, setConversationId] = useState<string | undefined>()
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [policyTitle, setPolicyTitle] = useState('')
  const [policyContent, setPolicyContent] = useState('')
  const [policyMessage, setPolicyMessage] = useState<string | null>(null)
  const [showPolicyPanel, setShowPolicyPanel] = useState(false)

  async function handleSend() {
    if (!input.trim()) return
    setError(null)
    setLoading(true)
    const userMessage: AssistantMessage = {
      id: `local-${Date.now()}`,
      conversationId: conversationId ?? '',
      role: 'USER',
      message: input,
      groundedSources: null,
      proposedAction: null,
      actionTaken: null,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMessage])
    const text = input
    setInput('')
    try {
      const reply = await sendMessage({ conversationId, message: text })
      setConversationId(reply.conversationId)
      setMessages((prev) => [...prev, reply])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reach the assistant')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm(messageId: string) {
    setError(null)
    try {
      const updated = await confirmAction(messageId)
      setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to confirm action')
    }
  }

  async function handleUploadPolicy() {
    if (!policyTitle || !policyContent) return
    setError(null)
    setPolicyMessage(null)
    try {
      await uploadPolicyDocument({ title: policyTitle, content: policyContent })
      setPolicyMessage('Policy document indexed.')
      setPolicyTitle('')
      setPolicyContent('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to index policy document')
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Responses are AI-generated. Actions like applying leave or raising a ticket always require
        your explicit confirmation before anything is submitted.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-md p-2 text-sm ${
              m.role === 'USER' ? 'self-end bg-primary text-primary-foreground' : 'self-start bg-muted'
            }`}
          >
            <p className="whitespace-pre-wrap">{m.message}</p>
            {m.groundedSources && m.groundedSources.length > 0 && (
              <p className="mt-1 text-xs opacity-70">
                Source: {m.groundedSources.map((s) => s.title).join(', ')}
              </p>
            )}
            {m.proposedAction && !m.actionTaken && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => handleConfirm(m.id)}>
                Confirm
              </Button>
            )}
            {m.actionTaken && <p className="mt-1 text-xs opacity-70">Action completed.</p>}
          </div>
        ))}
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask a policy question, or say "apply 2 days leave next Friday" or "raise a ticket".
          </p>
        )}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          className="min-h-9 resize-none"
          rows={1}
          placeholder="Ask a question or request an action..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <Button size="sm" onClick={handleSend} disabled={loading || !input.trim()}>
          {loading ? '…' : 'Send'}
        </Button>
      </div>

      {isHrAdmin && (
        <div className="rounded-md border p-3 text-sm">
          <button
            type="button"
            className="w-full text-left font-medium"
            onClick={() => setShowPolicyPanel((v) => !v)}
          >
            Index a Policy Document {showPolicyPanel ? '▾' : '▸'}
          </button>
          {showPolicyPanel && (
            <div className="mt-2 flex flex-col gap-2">
              {policyMessage && <p className="text-primary">{policyMessage}</p>}
              <Label>Title</Label>
              <Input value={policyTitle} onChange={(e) => setPolicyTitle(e.target.value)} />
              <Label>Content</Label>
              <Textarea
                rows={4}
                value={policyContent}
                onChange={(e) => setPolicyContent(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={handleUploadPolicy}>
                Index Document
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
