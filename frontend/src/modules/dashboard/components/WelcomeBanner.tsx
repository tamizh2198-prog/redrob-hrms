import { useEffect, useRef, useState } from 'react'
import logo from '@/assets/logo.jpg'
import { getMyProfile, updateMyProfile } from '@/modules/employee/api'

function getGreeting(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  HR_ADMIN: 'HR Admin',
  SUPER_ADMIN: 'Super Admin',
}

const AVATAR_MAX_DIMENSION = 160
const AVATAR_JPEG_QUALITY = 0.85

// Downscales/re-encodes any dropped-in image to a small square JPEG data
// URI client-side — keeps the stored row small (see UpdateMyProfileDto's
// 500K-char cap) without needing a file-storage backend, and avoids
// shipping a multi-megabyte phone photo over the wire untouched.
function readAndDownscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a readable image'))
      img.onload = () => {
        const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(img.width, img.height))
        const width = Math.round(img.width * scale)
        const height = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not process image'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function initialsOf(name?: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '')
}

// Shown to every role at the top of the Dashboard — a dark navy-to-blue
// gradient hero (echoing redrob.io's own hero treatment) rather than a
// plain text card, so every user from the organization gets the same
// welcoming first impression regardless of role.
export function WelcomeBanner({ name, role }: { name?: string; role?: string }) {
  const greeting = getGreeting(new Date().getHours())
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMyProfile()
      .then((r) => setPhotoUrl(r.employee.photoUrl))
      .catch(() => setPhotoUrl(null))
  }, [])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const dataUrl = await readAndDownscaleImage(file)
      const result = await updateMyProfile({ photoUrl: dataUrl })
      setPhotoUrl(result.employee.photoUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="animate-welcome-banner-in relative overflow-hidden rounded-xl bg-gradient-to-br from-[#0b1220] via-[#122a52] to-[#2563eb] px-6 py-8 text-white shadow-lg">
      <span
        aria-hidden="true"
        className="animate-welcome-glow-a absolute -left-10 -top-16 size-56 rounded-full bg-blue-400/30 blur-3xl"
      />
      <span
        aria-hidden="true"
        className="animate-welcome-glow-b absolute -bottom-20 right-0 size-64 rounded-full bg-indigo-400/25 blur-3xl"
      />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <img
            src={logo}
            alt=""
            className="hidden size-12 rounded-xl border border-white/20 bg-white/10 p-1 sm:block"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Click to update your profile photo"
            className="group relative size-14 shrink-0 overflow-hidden rounded-full border-2 border-white/30 bg-white/10 text-lg font-semibold"
          >
            {photoUrl ? (
              <img src={photoUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center">{initialsOf(name)}</span>
            )}
            <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-[10px] font-normal group-hover:flex">
              {uploading ? '...' : 'Change'}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelected}
          />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting}{name ? `, ${name}` : ''} 👋
            </h1>
            <p className="mt-1 text-sm text-blue-100/80">
              Welcome to Redrob HRMS{role ? ` — ${ROLE_LABEL[role] ?? role}` : ''}
            </p>
            {error && <p className="mt-1 text-xs text-red-200">{error}</p>}
          </div>
        </div>
        <p className="text-sm font-medium text-blue-100/70">{today}</p>
      </div>
    </div>
  )
}
