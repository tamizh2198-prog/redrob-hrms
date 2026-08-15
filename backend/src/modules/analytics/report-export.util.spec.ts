import ExcelJS from 'exceljs';
import { toCsv, toRealExcel, toPdf, exportReport } from './report-export.util';

const sample = {
  entity: 'Employee',
  total: 2,
  rows: [
    { id: 'e-1', firstName: 'Ada', status: 'ACTIVE' },
    { id: 'e-2', firstName: 'Grace, "Hopper"', status: 'INACTIVE' },
  ],
};

describe('report-export.util (Section 7.13 Phase 4)', () => {
  describe('toCsv', () => {
    it('returns an empty string for no rows', () => {
      expect(toCsv({ entity: 'Employee', total: 0, rows: [] })).toBe('');
    });

    it('writes a header row followed by one row per record', () => {
      const csv = toCsv(sample);
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe('id,firstName,status');
      expect(lines[1]).toBe('e-1,Ada,ACTIVE');
    });

    it('quotes and escapes values containing commas or quotes', () => {
      const csv = toCsv(sample);
      expect(csv).toContain('"Grace, ""Hopper"""');
    });
  });

  describe('toRealExcel', () => {
    it('produces a genuine, re-readable .xlsx with a header row plus one row per record', async () => {
      const buffer = await toRealExcel(sample);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as never);
      const sheet = workbook.worksheets[0];
      expect(sheet.getRow(1).values).toEqual([undefined, 'id', 'firstName', 'status']);
      expect(sheet.getRow(2).values).toEqual([undefined, 'e-1', 'Ada', 'ACTIVE']);
      expect(sheet.rowCount).toBe(sample.rows.length + 1);
    });

    it('preserves values containing commas/quotes as plain text, unescaped', async () => {
      const buffer = await toRealExcel(sample);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as never);
      const sheet = workbook.worksheets[0];
      expect(sheet.getRow(3).values).toEqual([
        undefined,
        'e-2',
        'Grace, "Hopper"',
        'INACTIVE',
      ]);
    });

    it('handles zero rows without throwing', async () => {
      await expect(
        toRealExcel({ entity: 'Employee', total: 0, rows: [] }),
      ).resolves.toBeInstanceOf(Buffer);
    });
  });

  describe('toPdf', () => {
    it('produces a buffer starting with the PDF magic header and a valid trailer', () => {
      const buffer = toPdf(sample);
      const text = buffer.toString('latin1');
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(text).toContain('%%EOF');
      expect(text).toContain('/Type /Catalog');
    });

    it('embeds the row text (escaped) inside the content stream', () => {
      const text = toPdf(sample).toString('latin1');
      expect(text).toContain('Ada');
      expect(text).toContain('ACTIVE');
    });

    it('paginates when there are more rows than fit on one page', () => {
      const manyRows = {
        entity: 'Employee',
        total: 100,
        rows: Array.from({ length: 100 }, (_, i) => ({
          id: `e-${i}`,
          name: `Person ${i}`,
        })),
      };
      const text = toPdf(manyRows).toString('latin1');
      const pageCount = (text.match(/\/Type \/Page(?!s)/g) ?? []).length;
      expect(pageCount).toBeGreaterThan(1);
    });

    it('never throws on zero rows', () => {
      expect(() =>
        toPdf({ entity: 'Employee', total: 0, rows: [] }),
      ).not.toThrow();
    });
  });

  describe('exportReport', () => {
    it('routes csv/excel/pdf to the correct content type and extension', async () => {
      expect((await exportReport(sample, 'csv')).contentType).toBe('text/csv');
      expect((await exportReport(sample, 'excel')).contentType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect((await exportReport(sample, 'excel')).extension).toBe('xlsx');
      expect((await exportReport(sample, 'pdf')).contentType).toBe('application/pdf');
      expect((await exportReport(sample, 'pdf')).extension).toBe('pdf');
    });
  });
});
