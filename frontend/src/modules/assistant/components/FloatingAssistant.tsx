import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssistantAvatar } from './AssistantAvatar'
import { AssistantChat } from './AssistantChat'

// The ONE AI Assistant surface in the app — a floating button that expands
// into the same chat panel (AssistantChat, same api.ts calls) used
// everywhere else. No sidebar entry, no separate full-page route: this is
// the only place the assistant lives, so there's no second AI system to
// keep in sync.
export function FloatingAssistant() {
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed right-4 bottom-4 z-50 sm:right-6 sm:bottom-6">
      {open ? (
        <div className="flex max-h-[80vh] w-[92vw] max-w-sm flex-col overflow-hidden rounded-lg border bg-background shadow-xl sm:w-96">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h2 className="text-sm font-semibold">AI Assistant</h2>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              aria-label="Close AI Assistant"
            >
              <X />
            </Button>
          </div>
          <div className="overflow-y-auto">
            <AssistantChat />
          </div>
        </div>
      ) : (
        <div className="relative flex size-14 items-center justify-center">
          {/* Attention-getting pulse ring — only while closed, so it never
              distracts during an actual conversation. */}
          <span
            aria-hidden="true"
            className="animate-bubble-ring absolute inset-0 rounded-full bg-primary"
          />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open AI Assistant"
            className="animate-bubble-bob relative flex size-14 items-center justify-center overflow-hidden rounded-full border border-border bg-background shadow-lg transition-transform hover:scale-110"
          >
            <AssistantAvatar className="h-full w-full" />
          </button>
        </div>
      )}
    </div>
  )
}
