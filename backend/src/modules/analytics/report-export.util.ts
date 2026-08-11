export interface ReportExportInput {
  entity: string;
  total: number;
  rows: Array<{ id: string } & Record<string, unknown>>;
}

export type ReportExportFormat = 'csv' | 'excel' | 'pdf';

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return JSON.stringify(value);
}

// Section 7.13 Phase 4: "minimum reasonable implementation... do not
// introduce unnecessary dependencies" — no csv/xlsx/pdf library exists
// anywhere in this codebase (offboarding's "generateLetters" only ever
// stores a *ref string*, never a real file), so all three formats below
// are hand-built rather than pulling in a new package.
export function toCsv(result: ReportExportInput): string {
  if (result.rows.length === 0) return '';
  const headers = Object.keys(result.rows[0]);
  const escape = (value: unknown) => {
    const str = formatCell(value);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(',')];
  for (const row of result.rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\r\n');
}

// SpreadsheetML 2003 XML — a plain-text, zero-dependency format that Excel
// opens natively, unlike a real .xlsx (a zip of multiple XML parts) which
// would require a library to produce correctly.
export function toExcelXml(result: ReportExportInput): string {
  const headers = result.rows.length ? Object.keys(result.rows[0]) : [];
  const escape = (value: unknown) =>
    formatCell(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const cell = (value: unknown) =>
    `<Cell><Data ss:Type="String">${escape(value)}</Data></Cell>`;
  const headerRow = `<Row>${headers.map(cell).join('')}</Row>`;
  const dataRows = result.rows
    .map((row) => `<Row>${headers.map((h) => cell(row[h])).join('')}</Row>`)
    .join('');
  return (
    '<?xml version="1.0"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    `<Worksheet ss:Name="${escape(result.entity) || 'Report'}">\n` +
    `<Table>${headerRow}${dataRows}</Table>\n` +
    '</Worksheet>\n</Workbook>'
  );
}

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 36;
const PDF_FONT_SIZE = 9;
const PDF_LINE_HEIGHT = 12;
const PDF_LINES_PER_PAGE = Math.floor(
  (PDF_PAGE_HEIGHT - 2 * PDF_MARGIN) / PDF_LINE_HEIGHT,
);

function pdfEscape(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, '?') // PDF content streams here are Latin-1/ASCII only
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildPageContentStream(lines: string[]): string {
  const body = lines.map((line) => `(${pdfEscape(line)}) Tj T*`).join('\n');
  return `BT /F1 ${PDF_FONT_SIZE} Tf ${PDF_MARGIN} ${PDF_PAGE_HEIGHT - PDF_MARGIN} Td ${PDF_LINE_HEIGHT} TL\n${body}\nET`;
}

// A hand-rolled, uncompressed multi-page PDF: one monospace text line per
// report row. No pdfkit/puppeteer — just the PDF object model + xref table.
export function toPdf(result: ReportExportInput): Buffer {
  const headers = result.rows.length ? Object.keys(result.rows[0]) : [];
  const textLines = [`Report: ${result.entity} (${result.total} records)`, ''];
  if (headers.length) textLines.push(headers.join(' | '));
  for (const row of result.rows) {
    textLines.push(headers.map((h) => formatCell(row[h])).join(' | '));
  }

  const pages: string[][] = [];
  for (let i = 0; i < textLines.length; i += PDF_LINES_PER_PAGE) {
    pages.push(textLines.slice(i, i + PDF_LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>'); // id 1
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ); // id 2
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'); // id 3

  pages.forEach((page, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const content = buildPageContentStream(page);
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  const totalObjects = objects.length + 1;
  pdf += `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;
  for (let i = 1; i < totalObjects; i++) {
    pdf += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

export function exportReport(
  result: ReportExportInput,
  format: ReportExportFormat,
): { buffer: Buffer; contentType: string; extension: string } {
  switch (format) {
    case 'csv':
      return {
        buffer: Buffer.from(toCsv(result), 'utf-8'),
        contentType: 'text/csv',
        extension: 'csv',
      };
    case 'excel':
      return {
        buffer: Buffer.from(toExcelXml(result), 'utf-8'),
        contentType: 'application/vnd.ms-excel',
        extension: 'xls',
      };
    case 'pdf':
      return {
        buffer: toPdf(result),
        contentType: 'application/pdf',
        extension: 'pdf',
      };
  }
}
