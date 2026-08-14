import ExcelJS from 'exceljs';
import {
  buildEmployeeImportTemplate,
  parseEmployeeImportWorkbook,
} from './bulk-import-upload.util';

describe('bulk-import-upload.util', () => {
  it('round-trips the generated template into the example row', async () => {
    const buffer = await buildEmployeeImportTemplate();
    const rows = await parseEmployeeImportWorkbook(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      firstName: 'Jane',
      lastName: 'Doe',
      dob: '1992-05-01',
      gender: 'FEMALE',
      dateOfJoining: '2026-01-15',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE_PROBATION',
      pan: 'ABCDE1234F',
      bankAccountNumber: '000111222333',
      emergencyContactName: 'John Doe',
      emergencyContactPhone: '9999999999',
    });
  });

  it('skips blank rows and ignores unrecognized columns', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Employees');
    sheet.columns = [
      { header: 'First Name', key: 'firstName' },
      { header: 'Last Name', key: 'lastName' },
      { header: 'Employee Code', key: 'employeeCode' },
    ];
    sheet.addRow({ firstName: 'A', lastName: 'B', employeeCode: 'MNR-2026-9999' });
    sheet.addRow({});
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const rows = await parseEmployeeImportWorkbook(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ firstName: 'A', lastName: 'B' });
  });

  it('coerces CTC (LPA) to a number', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Employees');
    sheet.columns = [
      { header: 'First Name', key: 'firstName' },
      { header: 'CTC (LPA)', key: 'ctcLpa' },
    ];
    sheet.addRow({ firstName: 'A', ctcLpa: 12 });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const rows = await parseEmployeeImportWorkbook(buffer);

    expect(rows[0].ctcLpa).toBe(12);
    expect(typeof rows[0].ctcLpa).toBe('number');
  });

  it('returns an empty array for an empty workbook', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Employees');
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const rows = await parseEmployeeImportWorkbook(buffer);

    expect(rows).toEqual([]);
  });
});
