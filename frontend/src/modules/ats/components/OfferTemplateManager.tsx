import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ApiError } from '@/lib/api'
import {
  createOfferTemplate,
  updateOfferTemplate,
  deleteOfferTemplate,
  type OfferTemplate,
} from '../api'

const PLACEHOLDER_HELP =
  'Placeholders: {{candidateName}}, {{requisitionTitle}}, {{ctc}}, {{responseLink}}'

// HR Admin/Super Admin only — lets HR customize the subject/body emailed
// to a candidate when an offer is sent, instead of the one hardcoded copy
// every offer used before this existed. Templates list itself lives in
// AtsPage (so the "Create Offer" template picker shares the same data);
// this component only owns the create/edit form and issues the CRUD calls.
export function OfferTemplateManager({
  templates,
  onChange,
}: {
  templates: OfferTemplate[]
  onChange: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setEditingId(null)
    setName('')
    setSubject('')
    setBody('')
    setIsDefault(false)
  }

  function startEdit(template: OfferTemplate) {
    setEditingId(template.id)
    setName(template.name)
    setSubject(template.subject)
    setBody(template.body)
    setIsDefault(template.isDefault)
  }

  async function handleSave() {
    setError(null)
    try {
      if (editingId) {
        await updateOfferTemplate(editingId, { name, subject, body, isDefault })
      } else {
        await createOfferTemplate({ name, subject, body, isDefault })
      }
      resetForm()
      onChange()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save offer template')
    }
  }

  async function handleDelete(id: string) {
    setError(null)
    try {
      await deleteOfferTemplate(id)
      if (editingId === id) resetForm()
      onChange()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete offer template')
    }
  }

  return (
    <div className="rounded-md border p-4">
      <h2 className="mb-2 font-medium">Offer Letter Templates</h2>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

      <ul className="mb-3 flex flex-col gap-2 text-sm">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center justify-between rounded border p-2">
            <div>
              <span className="font-medium">{t.name}</span>{' '}
              {t.isDefault && <Badge variant="default">Default</Badge>}
              <p className="text-muted-foreground">{t.subject}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => startEdit(t)}>
                Edit
              </Button>
              <Button size="sm" variant="destructive" onClick={() => handleDelete(t.id)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
        {templates.length === 0 && (
          <p className="text-muted-foreground">
            No templates yet — offers will use a built-in default letter until you add one.
          </p>
        )}
      </ul>

      <div className="flex flex-col gap-2 border-t pt-3">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard Offer" />
        <Label>Subject</Label>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Your offer for {{requisitionTitle}}"
        />
        <Label>Body</Label>
        <Textarea
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hi {{candidateName}}, ..."
        />
        <p className="text-xs text-muted-foreground">{PLACEHOLDER_HELP}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Use as the default template for new offers
        </label>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={!name || !subject || !body}
          >
            {editingId ? 'Save Changes' : 'Create Template'}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
