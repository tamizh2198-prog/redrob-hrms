import { Employee } from '@prisma/client';
import { computeProfileCompletion } from './profile-completion.util';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    dob: null,
    gender: null,
    phone: null,
    addressLine: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    pan: null,
    aadhaar: null,
    bankAccountNumber: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    personalEmail: null,
    ...overrides,
  } as Employee;
}

const ALL_REQUIRED_FILLED: Partial<Employee> = {
  dob: new Date('1990-01-01'),
  gender: 'MALE',
  phone: '9999999999',
  addressLine: '123 Main St',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  pan: 'ABCDE1234F',
  bankAccountNumber: '000111222333',
  emergencyContactName: 'John Doe',
  emergencyContactPhone: '8888888888',
};

describe('computeProfileCompletion (Auth Phase 3)', () => {
  it('returns 0% and isComplete=false for a brand-new employee with nothing filled in', () => {
    const result = computeProfileCompletion(makeEmployee());
    expect(result.completionPercentage).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toHaveLength(11);
  });

  it('returns 100% and isComplete=true once every required field is filled', () => {
    const result = computeProfileCompletion(makeEmployee(ALL_REQUIRED_FILLED));
    expect(result.completionPercentage).toBe(100);
    expect(result.isComplete).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('calculates a partial percentage and lists exactly the missing fields', () => {
    const result = computeProfileCompletion(
      makeEmployee({
        dob: new Date(),
        gender: 'FEMALE' as never,
        phone: '123',
      }),
    );
    // 3 of 11 required fields filled -> 27% (rounded)
    expect(result.completionPercentage).toBe(Math.round((3 / 11) * 100));
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('PAN');
    expect(result.missingFields).toContain('Bank Account Number');
    expect(result.missingFields).not.toContain('Phone Number');
  });

  it('treats an empty string the same as missing (not just null)', () => {
    const result = computeProfileCompletion(
      makeEmployee({ ...ALL_REQUIRED_FILLED, addressLine: '' }),
    );
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toEqual(['Address']);
  });

  it('never counts admin-only fields (department/designation/manager/dateOfJoining) toward completion', () => {
    const result = computeProfileCompletion(makeEmployee());
    expect(result.requiredFields).not.toContain('Department');
    expect(result.requiredFields).not.toContain('Designation');
    expect(result.requiredFields).not.toContain('Reporting Manager');
    expect(result.requiredFields).not.toContain('Date of Joining');
  });
});
