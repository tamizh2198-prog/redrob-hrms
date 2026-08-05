import { PrismaClient, Role, Gender, EmploymentType, EmployeeStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.upsert({
    where: { id: 'seed-company' },
    update: {},
    create: { id: 'seed-company', name: 'Redrob' },
  });

  const department = await prisma.department.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ENG' } },
    update: {},
    create: { companyId: company.id, name: 'Engineering', code: 'ENG' },
  });

  const designationManager = await prisma.designation.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ENG-MGR' } },
    update: {},
    create: { companyId: company.id, name: 'Engineering Manager', code: 'ENG-MGR' },
  });

  const designationEngineer = await prisma.designation.upsert({
    where: { companyId_code: { companyId: company.id, code: 'SWE' } },
    update: {},
    create: { companyId: company.id, name: 'Software Engineer', code: 'SWE' },
  });

  const designationHr = await prisma.designation.upsert({
    where: { companyId_code: { companyId: company.id, code: 'HR-ADM' } },
    update: {},
    create: { companyId: company.id, name: 'HR Administrator', code: 'HR-ADM' },
  });

  const designationAdmin = await prisma.designation.upsert({
    where: { companyId_code: { companyId: company.id, code: 'SUPER-ADM' } },
    update: {},
    create: { companyId: company.id, name: 'Super Administrator', code: 'SUPER-ADM' },
  });

  const location = await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: 'BLR' } },
    update: {},
    create: { companyId: company.id, name: 'Bengaluru', code: 'BLR' },
  });

  const grade = await prisma.grade.upsert({
    where: { companyId_code: { companyId: company.id, code: 'L3' } },
    update: {},
    create: { companyId: company.id, name: 'L3', code: 'L3' },
  });

  const baseFields = {
    companyId: company.id,
    departmentId: department.id,
    locationId: location.id,
    gradeId: grade.id,
    dob: new Date('1990-01-01'),
    gender: Gender.PREFER_NOT_TO_SAY,
    dateOfJoining: new Date('2024-01-01'),
    employmentType: EmploymentType.FULL_TIME,
    status: EmployeeStatus.ACTIVE,
    pan: 'ABCDE1234F',
    bankAccountNumber: '000123456789',
    emergencyContactName: 'Emergency Contact',
    emergencyContactPhone: '9999999999',
  };

  const superAdmin = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-SEED-0001' },
    update: {},
    create: {
      ...baseFields,
      employeeCode: 'EMP-SEED-0001',
      firstName: 'Aditi',
      lastName: 'Rao',
      workEmail: 'aditi.rao@redrob.seed',
      role: Role.SUPER_ADMIN,
      designationId: designationAdmin.id,
    },
  });

  const hrAdmin = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-SEED-0002' },
    update: {},
    create: {
      ...baseFields,
      employeeCode: 'EMP-SEED-0002',
      firstName: 'Priya',
      lastName: 'Sharma',
      workEmail: 'priya.sharma@redrob.seed',
      role: Role.HR_ADMIN,
      designationId: designationHr.id,
      reportingManagerId: superAdmin.id,
    },
  });

  const manager = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-SEED-0003' },
    update: {},
    create: {
      ...baseFields,
      employeeCode: 'EMP-SEED-0003',
      firstName: 'Karan',
      lastName: 'Mehta',
      workEmail: 'karan.mehta@redrob.seed',
      role: Role.MANAGER,
      designationId: designationManager.id,
      reportingManagerId: superAdmin.id,
    },
  });

  await prisma.employee.upsert({
    where: { employeeCode: 'EMP-SEED-0004' },
    update: {},
    create: {
      ...baseFields,
      employeeCode: 'EMP-SEED-0004',
      firstName: 'Rahul',
      lastName: 'Verma',
      workEmail: 'rahul.verma@redrob.seed',
      role: Role.EMPLOYEE,
      designationId: designationEngineer.id,
      reportingManagerId: manager.id,
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
