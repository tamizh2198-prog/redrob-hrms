import { Role } from '@prisma/client';

export interface RequesterContext {
  userId?: string;
  role?: Role;
}

export const SELF_SERVICE_FIELDS = [
  'personalEmail',
  'phone',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

export type SelfServiceField = (typeof SELF_SERVICE_FIELDS)[number];
