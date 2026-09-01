import { api } from '@/lib/api'
import type { Role } from '@/shared/auth/role'

export interface Permission {
  id: string
  key: string
  name: string
  description: string | null
  category: string
}

export interface PermissionWithState extends Permission {
  enabled: boolean
}

export interface RolePermissionsResponse {
  role: Role
  editable: boolean
  permissions: PermissionWithState[]
}

export function listRoles() {
  return api<{ role: Role }[]>('/roles')
}

export function listPermissions() {
  return api<Permission[]>('/permissions')
}

export function getRolePermissions(role: Role) {
  return api<RolePermissionsResponse>(`/roles/${role}/permissions`)
}

export function updateRolePermissions(role: Role, permissionIds: string[]) {
  return api<RolePermissionsResponse>(`/roles/${role}/permissions`, {
    method: 'PATCH',
    body: { permissionIds },
  })
}
