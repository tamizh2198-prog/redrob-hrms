import ExcelJS from 'exceljs';
import { BiometricRowDto } from './dto/import-biometric.dto';

// Excel counterpart to the JSON-paste biometric import — same column shape
// as SAMPLE_BIOMETRIC_ROWS in AttendanceLeavePage.tsx.
const COLUMNS: Array<{ header: string; key: keyof BiometricRowDto }> = [
  { header: 'Employee Code', key: 'employeeCode' },
  { header: 'Date (YYYY-MM-DD)', key: 'date' },
  { header: 'Check-In Time (YYYY-MM-DDTHH:mm:ss)', key: 'checkInTime' },
  { header: 'Check-Out Time (YYYY-MM-DDTHH:mm:ss)', key: 'checkOutTime' },
];

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

// Excel auto-formats anything that looks like a date/time as a real Date
// cell even when the template wrote it as plain text, so a cell can come
// back as either a string or a Date depending on what the user typed —
// normalize both to the ISO shape importBiometric()'s @IsDateString expects.
function cellToIsoString(raw: unknown, dateOnly: boolean): string {
  if (raw instanceof Date) {
    return dateOnly ? raw.toISOString().slice(0, 10) : raw.toISOString();
  }
  return String(raw).trim();
}

export async function parseBiometricImportWorkbook(
  buffer: Buffer,
): Promise<Partial<BiometricRowDto>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const columnIndex = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    columnIndex.set(normalizeHeader(cell.value), colNumber);
  });

  const colForKey = new Map<keyof BiometricRowDto, number>();
  for (const { header, key } of COLUMNS) {
    const col = columnIndex.get(header.toLowerCase());
    if (col !== undefined) colForKey.set(key, col);
  }

  const rows: Partial<BiometricRowDto>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const dto: Record<string, unknown> = {};
    let hasAnyValue = false;
    for (const [key, col] of colForKey) {
      const raw = row.getCell(col).value;
      if (raw === null || raw === undefined || raw === '') continue;
      hasAnyValue = true;
      dto[key] = cellToIsoString(raw, key === 'date');
    }
    if (!hasAnyValue) return;

    rows.push(dto as Partial<BiometricRowDto>);
  });

  return rows;
}

export async function buildBiometricImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Biometric');
  sheet.columns = COLUMNS.map(({ header, key }) => ({
    header,
    key,
    width: Math.max(header.length + 2, 20),
  }));
  sheet.addRow({
    employeeCode: 'EMP-2026-0001',
    date: '2026-08-06',
    checkInTime: '2026-08-06T09:00:00',
    checkOutTime: '2026-08-06T18:00:00',
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
