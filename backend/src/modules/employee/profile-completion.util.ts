import { Employee } from '@prisma/client';

// Auth Phase 3: the ONLY source of truth for what counts toward profile
// completion — deliberately excludes admin-set fields (department,
// designation, reportingManager, dateOfJoining, employeeCode, role) even
// though some of those are also "mandatory for Active" per Section 7.1;
// those are shown read-only and are never something the employee can be
// blocked on filling in themselves.
export const REQUIRED_PROFILE_FIELDS: Array<{
  field: keyof Employee;
  label: string;
}> = [
  { field: 'dob', label: 'Date of Birth' },
  { field: 'gender', label: 'Gender' },
  { field: 'phone', label: 'Phone Number' },
  { field: 'addressLine', label: 'Address' },
  { field: 'city', label: 'City' },
  { field: 'state', label: 'State' },
  { field: 'postalCode', label: 'Postal Code' },
  { field: 'pan', label: 'PAN' },
  { field: 'bankAccountNumber', label: 'Bank Account Number' },
  { field: 'emergencyContactName', label: 'Emergency Contact Name' },
  { field: 'emergencyContactPhone', label: 'Emergency Contact Phone' },
];

export interface ProfileCompletion {
  completionPercentage: number;
  isComplete: boolean;
  requiredFields: string[];
  missingFields: string[];
}

export function computeProfileCompletion(
  employee: Employee,
): ProfileCompletion {
  const missingFields: string[] = [];
  for (const { field, label } of REQUIRED_PROFILE_FIELDS) {
    const value = employee[field];
    if (value === null || value === undefined || value === '') {
      missingFields.push(label);
    }
  }

  const total = REQUIRED_PROFILE_FIELDS.length;
  const completed = total - missingFields.length;
  const completionPercentage =
    total === 0 ? 100 : Math.round((completed / total) * 100);

  return {
    completionPercentage,
    isComplete: missingFields.length === 0,
    requiredFields: REQUIRED_PROFILE_FIELDS.map((f) => f.label),
    missingFields,
  };
}
