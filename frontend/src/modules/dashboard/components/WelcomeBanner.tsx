import logo from '@/assets/logo.jpg'

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
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting}{name ? `, ${name}` : ''} 👋
            </h1>
            <p className="mt-1 text-sm text-blue-100/80">
              Welcome to Redrob HRMS{role ? ` — ${ROLE_LABEL[role] ?? role}` : ''}
            </p>
          </div>
        </div>
        <p className="text-sm font-medium text-blue-100/70">{today}</p>
      </div>
    </div>
  )
}
