import ExcelJS from 'exceljs';

export interface ActiveEmployeeExportRow {
  employeeCode: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  location: string | null;
  employmentType: string | null;
  dateOfJoining: Date | null;
  status: string;
}

const COLUMNS: Array<{ header: string; key: keyof ActiveEmployeeExportRow; width: number }> = [
  { header: 'Employee Code', key: 'employeeCode', width: 18 },
  { header: 'First Name', key: 'firstName', width: 16 },
  { header: 'Last Name', key: 'lastName', width: 16 },
  { header: 'Work Email', key: 'workEmail', width: 28 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Designation', key: 'designation', width: 20 },
  { header: 'Location', key: 'location', width: 16 },
  { header: 'Employment Type', key: 'employmentType', width: 16 },
  { header: 'Date Of Joining', key: 'dateOfJoining', width: 16 },
  { header: 'Status', key: 'status', width: 16 },
];

// Super Admin-only export of the active roster (ACTIVE + ACTIVE_PROBATION —
// same definition EmployeeService.ACTIVE_STATUSES already uses elsewhere).
// PAN/Aadhaar/bank details are deliberately excluded, same as every other
// non-self/non-privileged view of an employee record masks them (see
// EmployeeService.maskSensitiveFields) — this is a roster export, not a
// statutory-data dump.
export async function buildActiveEmployeesWorkbook(
  rows: ActiveEmployeeExportRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Active Employees');
  sheet.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  for (const row of rows) {
    sheet.addRow({
      ...row,
      dateOfJoining: row.dateOfJoining
        ? row.dateOfJoining.toISOString().slice(0, 10)
        : null,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
