import ExcelJS from "exceljs";
import type { CreateEmployeeDto } from "./dto";

// One column per CreateEmployeeDto field bulkImport() actually accepts —
// header text is human-friendly, key is the exact DTO property the parsed
// value is assigned to.
const COLUMNS: Array<{ header: string; key: keyof CreateEmployeeDto }> = [
  { header: "First Name", key: "firstName" },
  { header: "Last Name", key: "lastName" },
  { header: "DOB (YYYY-MM-DD)", key: "dob" },
  { header: "Gender", key: "gender" },
  { header: "Personal Email", key: "personalEmail" },
  { header: "Work Email", key: "workEmail" },
  { header: "Phone", key: "phone" },
  { header: "Department ID", key: "departmentId" },
  { header: "Designation ID", key: "designationId" },
  { header: "Grade ID", key: "gradeId" },
  { header: "Location ID", key: "locationId" },
  { header: "Reporting Manager ID", key: "reportingManagerId" },
  { header: "Date Of Joining (YYYY-MM-DD)", key: "dateOfJoining" },
  { header: "Employment Type", key: "employmentType" },
  { header: "Status", key: "status" },
  { header: "PAN", key: "pan" },
  { header: "Aadhaar", key: "aadhaar" },
  { header: "Bank Account Number", key: "bankAccountNumber" },
  { header: "IFSC Code", key: "ifscCode" },
  { header: "Blood Group", key: "bloodGroup" },
  { header: "Emergency Contact Name", key: "emergencyContactName" },
  { header: "Emergency Contact Phone", key: "emergencyContactPhone" },
  { header: "CTC (LPA)", key: "ctcLpa" },
];

const NUMBER_FIELDS = new Set<keyof CreateEmployeeDto>(["ctcLpa"]);

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

// employeeCode is deliberately absent from COLUMNS — it's system-generated
// and immutable, never accepted from an upload.
export async function parseEmployeeImportWorkbook(buffer: Buffer): Promise<Partial<CreateEmployeeDto>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const columnIndex = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    columnIndex.set(normalizeHeader(cell.value), colNumber);
  });

  const colForKey = new Map<keyof CreateEmployeeDto, number>();
  for (const { header, key } of COLUMNS) {
    const col = columnIndex.get(header.toLowerCase());
    if (col !== undefined) colForKey.set(key, col);
  }

  const rows: Partial<CreateEmployeeDto>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const dto: Record<string, unknown> = {};
    let hasAnyValue = false;
    for (const [key, col] of colForKey) {
      const raw = row.getCell(col).value;
      if (raw === null || raw === undefined || raw === "") continue;
      hasAnyValue = true;
      dto[key] = NUMBER_FIELDS.has(key) ? Number(raw) : String(raw).trim();
    }
    if (!hasAnyValue) return;

    rows.push(dto as Partial<CreateEmployeeDto>);
  });

  return rows;
}

export async function buildEmployeeImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Employees");
  sheet.columns = COLUMNS.map(({ header, key }) => ({
    header,
    key,
    width: Math.max(header.length + 2, 14),
  }));
  sheet.addRow({
    firstName: "Jane",
    lastName: "Doe",
    dob: "1992-05-01",
    gender: "FEMALE",
    dateOfJoining: "2026-01-15",
    employmentType: "FULL_TIME",
    status: "ACTIVE_PROBATION",
    pan: "ABCDE1234F",
    bankAccountNumber: "000111222333",
    emergencyContactName: "John Doe",
    emergencyContactPhone: "9999999999",
  });

  const reference = workbook.addWorksheet("Reference");
  reference.columns = [
    { header: "Field", key: "field", width: 20 },
    { header: "Accepted values", key: "values", width: 50 },
  ];
  reference.addRows([
    { field: "Gender", values: "MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY" },
    { field: "Employment Type", values: "FULL_TIME, PART_TIME, CONTRACT, INTERN" },
    { field: "Status", values: "ACTIVE_PROBATION, ACTIVE, INVITED (default: ACTIVE_PROBATION)" },
    {
      field: "Blood Group",
      values: "A_POSITIVE, A_NEGATIVE, B_POSITIVE, B_NEGATIVE, AB_POSITIVE, AB_NEGATIVE, O_POSITIVE, O_NEGATIVE",
    },
    {
      field: "Department/Designation/Grade/Location/Reporting Manager ID",
      values: "Internal record id, not a name — look these up from the Employee Directory. Leave blank if unknown.",
    },
    { field: "Employee Code", values: "Do not include — system-generated automatically (MNR-<year>-<seq>)." },
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
