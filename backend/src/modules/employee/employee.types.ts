import { Role } from '@prisma/client';

export interface RequesterContext {
  userId?: string;
  role?: Role;
}

// Section 7.1 Business Rules: "Employee-submitted profile changes never
// write directly to the master record" — every field an employee can touch
// via update() lands as a ProfileChangeRequest for HR Admin review, never a
// direct write, regardless of how sensitive the field is. This is also the
// set of "Step 2" fields a new hire completes themselves once HR has created
// their record with just the Step 1 (employment) details.
export const SELF_SERVICE_FIELDS = [
  'dob',
  'personalEmail',
  'workEmail',
  'phone',
  'pan',
  'aadhaar',
  'bankAccountNumber',
  'ifscCode',
  'bloodGroup',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

export type SelfServiceField = (typeof SELF_SERVICE_FIELDS)[number];
