import { api } from '@/lib/api'

// Auth Phase 2: the invitation token itself is the authorization mechanism
// — deliberately called with no access token attached (these run before the
// employee has any account/session at all).
export interface ActivationIdentity {
  firstName: string
  lastName: string
  employeeCode: string
  email: string | null
  expiresAt: string
}

export function validateActivationToken(token: string) {
  return api<ActivationIdentity>(`/auth/activate/${token}`)
}

export function activateAccount(data: { token: string; password: string; confirmPassword: string }) {
  return api<{ success: true }>('/auth/activate', { method: 'POST', body: data })
}

export interface PasswordResetIdentity {
  firstName: string
  lastName: string
  employeeCode: string
  expiresAt: string
}

export function validatePasswordResetToken(token: string) {
  return api<PasswordResetIdentity>(`/auth/reset-password/${token}`)
}

export function consumePasswordReset(data: { token: string; password: string; confirmPassword: string }) {
  return api<{ success: true }>('/auth/reset-password', { method: 'POST', body: data })
}

// Always resolves with the same generic message regardless of whether the
// email matched an employee — never used to enumerate which emails exist.
export function forgotPassword(email: string) {
  return api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email } })
}
