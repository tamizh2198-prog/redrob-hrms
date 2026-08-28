import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Role } from '@/shared/auth/role'
import {
  getRolePermissions,
  updateRolePermissions,
  type PermissionWithState,
} from '../api'

const ROLES: Role[] = ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE']

function groupByCategory(permissions: PermissionWithState[]) {
  const groups = new Map<string, PermissionWithState[]>()
  for (const p of permissions) {
    const list = groups.get(p.category) ?? []
    list.push(p)
    groups.set(p.category, list)
  }
  return groups
}

export function RolesPermissionsPage() {
  const [selectedRole, setSelectedRole] = useState<Role>('HR_ADMIN')
  const [permissions, setPermissions] = useState<PermissionWithState[]>([])
  const [editable, setEditable] = useState(true)
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function load(role: Role) {
    setLoading(true)
    setError(null)
    setMessage(null)
    getRolePermissions(role)
      .then((res) => {
        setPermissions(res.permissions)
        setEditable(res.editable)
        setEnabledIds(new Set(res.permissions.filter((p) => p.enabled).map((p) => p.id)))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load(selectedRole)
  }, [selectedRole])

  function toggle(permissionId: string) {
    setEnabledIds((prev) => {
      const next = new Set(prev)
      if (next.has(permissionId)) next.delete(permissionId)
      else next.add(permissionId)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await updateRolePermissions(selectedRole, Array.from(enabledIds))
      setMessage('Permissions saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }

  const groups = groupByCategory(permissions)

  return (
    <div className="flex gap-6 p-6">
      <aside className="flex w-48 shrink-0 flex-col gap-1">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Roles</h2>
        {ROLES.map((role) => (
          <button
            key={role}
            onClick={() => setSelectedRole(role)}
            className={`rounded-md px-3 py-2 text-left text-sm ${
              role === selectedRole
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {role.replaceAll('_', ' ')}
          </button>
        ))}
      </aside>

      <div className="flex-1">
        <h1 className="text-xl font-semibold">Roles &amp; Permissions</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Role: <span className="font-medium">{selectedRole.replaceAll('_', ' ')}</span>
          {!editable &&
            (selectedRole === 'SUPER_ADMIN'
              ? ' — Full access, not editable'
              : ' — Access granted directly by role, not editable here')}
        </p>

        {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
        {message && <p className="mb-2 text-sm text-primary">{message}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            {Array.from(groups.entries()).map(([category, perms]) => (
              <div key={category} className="rounded-md border p-4">
                <h3 className="mb-2 font-medium">{category}</h3>
                <div className="flex flex-col gap-2">
                  {perms.map((p) => (
                    <label key={p.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={enabledIds.has(p.id)}
                        disabled={!editable}
                        onChange={() => toggle(p.id)}
                      />
                      <span>
                        <span className="font-medium">{p.name}</span>
                        {p.description && (
                          <span className="ml-1 text-muted-foreground">— {p.description}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {editable && (
              <Button disabled={saving} onClick={handleSave} className="w-fit">
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
