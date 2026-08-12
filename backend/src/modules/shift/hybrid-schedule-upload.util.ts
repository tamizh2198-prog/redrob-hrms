import ExcelJS from 'exceljs';

export interface BulkHybridScheduleRow {
  employeeCode: string;
  year: number;
  month: number;
  officeWeekdays: number[];
}

// Same 0=Sun..6=Sat convention as SetHybridScheduleDto.officeWeekdays and
// the single-employee "Assign WFO Days" checkbox grid in the UI.
const WEEKDAY_COLUMNS: Array<{ header: string; day: number }> = [
  { header: 'Sun', day: 0 },
  { header: 'Mon', day: 1 },
  { header: 'Tue', day: 2 },
  { header: 'Wed', day: 3 },
  { header: 'Thu', day: 4 },
  { header: 'Fri', day: 5 },
  { header: 'Sat', day: 6 },
];

const FALSY_CELL_VALUES = new Set(['', '0', 'n', 'no', 'false']);

function isOfficeDay(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return !FALSY_CELL_VALUES.has(String(value).trim().toLowerCase());
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

// Section 7.4 bulk-upload counterpart to the single-employee "Assign WFO
// Days" form: one row per employee, one column per weekday — the exact
// same checkbox grid the UI already shows for a single employee, just
// spread across a spreadsheet instead of repeated by hand.
export async function parseHybridScheduleWorkbook(
  buffer: Buffer,
): Promise<BulkHybridScheduleRow[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled type defs predate the generic Buffer<T> signature in
  // current @types/node — a structurally-identical Buffer still fails the
  // nominal check, hence the cast.
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const columnIndex = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    columnIndex.set(normalizeHeader(cell.value), colNumber);
  });

  const employeeCodeCol = columnIndex.get('employee code');
  const yearCol = columnIndex.get('year');
  const monthCol = columnIndex.get('month');
  const weekdayCols = WEEKDAY_COLUMNS.map(({ header, day }) => ({
    day,
    col: columnIndex.get(header.toLowerCase()),
  }));

  const rows: BulkHybridScheduleRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const employeeCode = employeeCodeCol
      ? String(row.getCell(employeeCodeCol).value ?? '').trim()
      : '';
    if (!employeeCode) return;

    const year = yearCol ? Number(row.getCell(yearCol).value) : NaN;
    const month = monthCol ? Number(row.getCell(monthCol).value) : NaN;
    const officeWeekdays = weekdayCols
      .filter(
        ({ col }) => col !== undefined && isOfficeDay(row.getCell(col).value),
      )
      .map(({ day }) => day);

    rows.push({ employeeCode, year, month, officeWeekdays });
  });

  return rows;
}

export async function buildHybridScheduleTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('WFO Days');
  sheet.columns = [
    { header: 'Employee Code', key: 'employeeCode', width: 18 },
    { header: 'Year', key: 'year', width: 8 },
    { header: 'Month', key: 'month', width: 8 },
    ...WEEKDAY_COLUMNS.map(({ header }) => ({
      header,
      key: header,
      width: 6,
    })),
  ];
  sheet.addRow({
    employeeCode: 'EMP-2026-0001',
    year: new Date().getUTCFullYear(),
    month: new Date().getUTCMonth() + 1,
    Mon: 'Y',
    Wed: 'Y',
    Fri: 'Y',
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
