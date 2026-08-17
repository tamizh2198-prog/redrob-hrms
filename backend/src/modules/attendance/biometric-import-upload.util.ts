import ExcelJS from 'exceljs';

// Bulk-upload counterpart to the existing JSON-paste Biometric Attendance
// import (POST /attendance/import, ImportBiometricDto) — same row shape
// (employeeCode/date/checkInTime/checkOutTime), just sourced from an .xlsx
// workbook instead of a hand-pasted JSON array. Mirrors the Shift module's
// hybrid-schedule-upload.util.ts pattern (parse workbook → plain row array,
// build a starter template workbook).
export interface BulkBiometricRow {
  employeeCode: string;
  date: string;
  checkInTime?: string;
  checkOutTime?: string;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function cellText(row: ExcelJS.Row, col: number | undefined): string {
  if (!col) return '';
  const value = row.getCell(col).value;
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '').trim();
}

export async function parseBiometricWorkbook(
  buffer: Buffer,
): Promise<BulkBiometricRow[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled type defs predate the generic Buffer<T> signature in
  // current @types/node — a structurally-identical Buffer still fails the
  // nominal check, hence the cast (same as hybrid-schedule-upload.util.ts).
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const columnIndex = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    columnIndex.set(normalizeHeader(cell.value), colNumber);
  });

  const employeeCodeCol = columnIndex.get('employee code');
  const dateCol = columnIndex.get('date');
  const checkInCol =
    columnIndex.get('check-in time') ?? columnIndex.get('check in time');
  const checkOutCol =
    columnIndex.get('check-out time') ?? columnIndex.get('check out time');

  const rows: BulkBiometricRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const employeeCode = cellText(row, employeeCodeCol);
    if (!employeeCode) return;

    rows.push({
      employeeCode,
      date: cellText(row, dateCol),
      checkInTime: cellText(row, checkInCol) || undefined,
      checkOutTime: cellText(row, checkOutCol) || undefined,
    });
  });

  return rows;
}

export async function buildBiometricImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Biometric Attendance');
  sheet.columns = [
    { header: 'Employee Code', key: 'employeeCode', width: 18 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Check-In Time', key: 'checkInTime', width: 22 },
    { header: 'Check-Out Time', key: 'checkOutTime', width: 22 },
  ];
  sheet.addRow({
    employeeCode: 'EMP-2026-0001',
    date: '2026-08-06',
    checkInTime: '2026-08-06T09:00:00',
    checkOutTime: '2026-08-06T18:00:00',
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
