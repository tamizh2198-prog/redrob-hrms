import { useState } from 'react'
import { X } from 'lucide-react'
import logo from '@/assets/logo.jpg'
import { AssistantPanel } from './AssistantPanel'

// Replaces the old sidebar "AI Assistant" nav item — a persistent bubble
// mounted once at the AppShell level (not swapped by the router), so the
// conversation survives navigating between modules instead of resetting
// on every route change.
export function AssistantBubble() {
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[520px] w-[360px] flex-col rounded-lg border border-border bg-background p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={logo} alt="" className="h-6 w-6 rounded-md" />
              <h2 className="font-semibold">AI Assistant</h2>
            </div>
            <button
              type="button"
              aria-label="Close AI Assistant"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </button>
          </div>
          <AssistantPanel />
        </div>
      )}
      <button
        type="button"
        aria-label={open ? 'Close AI Assistant' : 'Open AI Assistant'}
        onClick={() => setOpen((v) => !v)}
        className="flex size-14 items-center justify-center overflow-hidden rounded-full border border-border bg-background shadow-lg transition-transform hover:scale-105"
      >
        <img src={logo} alt="AI Assistant" className="h-full w-full object-cover" />
      </button>
    </div>
  )
}
