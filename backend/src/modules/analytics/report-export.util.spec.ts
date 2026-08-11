import { toCsv, toExcelXml, toPdf, exportReport } from './report-export.util';

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

  describe('toExcelXml', () => {
    it('produces well-formed SpreadsheetML with one Row per record plus header', () => {
      const xml = toExcelXml(sample);
      expect(xml).toContain('<Workbook');
      expect((xml.match(/<Row>/g) ?? []).length).toBe(sample.rows.length + 1);
      expect(xml).toContain('<Data ss:Type="String">Ada</Data>');
    });

    it('XML-escapes cell values', () => {
      const xml = toExcelXml(sample);
      expect(xml).toContain('Grace, &quot;Hopper&quot;');
    });

    it('handles zero rows without throwing', () => {
      expect(() =>
        toExcelXml({ entity: 'Employee', total: 0, rows: [] }),
      ).not.toThrow();
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
    it('routes csv/excel/pdf to the correct content type and extension', () => {
      expect(exportReport(sample, 'csv').contentType).toBe('text/csv');
      expect(exportReport(sample, 'excel').contentType).toBe(
        'application/vnd.ms-excel',
      );
      expect(exportReport(sample, 'pdf').contentType).toBe('application/pdf');
      expect(exportReport(sample, 'pdf').extension).toBe('pdf');
    });
  });
});
