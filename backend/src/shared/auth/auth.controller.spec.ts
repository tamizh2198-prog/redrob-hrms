import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { PrismaService } from '../database/prisma.service';
import { EmployeeService } from '../../modules/employee/employee.service';
import { hashPassword } from './password.util';

function createMockPrisma() {
  return { employee: { findUnique: jest.fn() } };
}
function createMockJwt() {
  return { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
}
function createMockEmployeeService() {
  return {
    validateInvitationToken: jest.fn(),
    activateAccount: jest.fn(),
  };
}
function createMockConfig(nodeEnv = 'test') {
  return { get: jest.fn().mockReturnValue(nodeEnv) };
}

describe('AuthController (Auth Phase 1)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwt: ReturnType<typeof createMockJwt>;
  let config: ReturnType<typeof createMockConfig>;
  let employeeService: ReturnType<typeof createMockEmployeeService>;
  let controller: AuthController;

  beforeEach(() => {
    prisma = createMockPrisma();
    jwt = createMockJwt();
    config = createMockConfig();
    employeeService = createMockEmployeeService();
    controller = new AuthController(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      employeeService as unknown as EmployeeService,
    );
  });

  describe('login (email + password)', () => {
    it('returns an access token and user for valid Super Admin credentials', async () => {
      const passwordHash = await hashPassword('CorrectHorse123!');
      prisma.employee.findUnique.mockResolvedValue({
        id: 'admin-1',
        firstName: 'Aditi',
        lastName: 'Rao',
        role: 'SUPER_ADMIN',
        passwordHash,
      });

      const result = await controller.login({
        email: 'aditi.rao@redrob.seed',
        password: 'CorrectHorse123!',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toEqual({
        id: 'admin-1',
        name: 'Aditi Rao',
        role: 'SUPER_ADMIN',
      });
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: 'admin-1',
        role: 'SUPER_ADMIN',
      });
    });

    it('rejects an incorrect password with a generic message', async () => {
      const passwordHash = await hashPassword('CorrectHorse123!');
      prisma.employee.findUnique.mockResolvedValue({
        id: 'admin-1',
        passwordHash,
      });

      await expect(
        controller.login({
          email: 'aditi.rao@redrob.seed',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown email with the same generic message (no account enumeration)', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(
        controller.login({ email: 'nobody@redrob.seed', password: 'anything' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an employee that has no password set yet (not activated for password login)', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        passwordHash: null,
      });

      await expect(
        controller.login({
          email: 'rahul.verma@redrob.seed',
          password: 'anything',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('this task: rejects login for a TERMINATED employee even with the correct password', async () => {
      const passwordHash = await hashPassword('CorrectHorse123!');
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        role: 'EMPLOYEE',
        status: 'TERMINATED',
        passwordHash,
      });

      await expect(
        controller.login({
          email: 'terminated@redrob.seed',
          password: 'CorrectHorse123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('dev-login (unchanged, existing mechanism)', () => {
    it('still resolves by employeeCode and signs the same token shape', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Rahul',
        lastName: 'Verma',
        role: 'EMPLOYEE',
      });

      const result = await controller.devLogin({
        employeeCode: 'EMP-SEED-0004',
      });

      expect(result.user).toEqual({
        id: 'emp-1',
        name: 'Rahul Verma',
        role: 'EMPLOYEE',
      });
    });

    it('throws NotFoundException for an unknown employee code', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(
        controller.devLogin({ employeeCode: 'NOPE' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('this task: rejects dev-login for a TERMINATED employee', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Rahul',
        lastName: 'Verma',
        role: 'EMPLOYEE',
        status: 'TERMINATED',
      });
      await expect(
        controller.devLogin({ employeeCode: 'EMP-SEED-0004' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('super-admin/status (Phase 1 requirement #5)', () => {
    it('returns a confirmation payload — RBAC enforcement itself is the global RolesGuard, covered in roles.guard.spec.ts', () => {
      expect(controller.superAdminStatus()).toEqual({
        ok: true,
        message: 'Super Admin access confirmed',
      });
    });
  });

  describe('Auth Phase 2: activation endpoints delegate to EmployeeService', () => {
    it('validateActivationToken passes the token through unchanged', async () => {
      employeeService.validateInvitationToken.mockResolvedValue({
        firstName: 'Jane',
      });
      const result = await controller.validateActivationToken('raw-token');
      expect(employeeService.validateInvitationToken).toHaveBeenCalledWith(
        'raw-token',
      );
      expect(result).toEqual({ firstName: 'Jane' });
    });

    it('activateAccount passes the dto through unchanged', async () => {
      employeeService.activateAccount.mockResolvedValue({ success: true });
      const dto = {
        token: 'raw-token',
        password: 'Secret123!',
        confirmPassword: 'Secret123!',
      };
      const result = await controller.activateAccount(dto);
      expect(employeeService.activateAccount).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ success: true });
    });
  });
});
