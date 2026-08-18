import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { PrismaService } from '../database/prisma.service';
import { EmployeeService } from '../../modules/employee/employee.service';
import { MagicLinkService } from './magic-link.service';
import { RefreshTokenService } from './refresh-token.service';
import { TrustedDeviceService } from './trusted-device.service';
import { hashPassword } from './password.util';

function createMockPrisma() {
  return { employee: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() } };
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
function createMockMagicLink() {
  return {
    sign: jest.fn().mockReturnValue('signed-mfa-token'),
    verify: jest.fn(),
  };
}
function createMockMfa() {
  return {
    generateSecret: jest.fn().mockReturnValue('generated-secret'),
    buildEnrollment: jest.fn().mockResolvedValue({
      secret: 'generated-secret',
      qrCodeDataUrl: 'data:image/png;base64,xyz',
    }),
    verify: jest.fn(),
  };
}
function createMockRefreshTokens() {
  return {
    issue: jest.fn().mockResolvedValue('issued-refresh-token'),
    rotate: jest.fn(),
    revoke: jest.fn(),
  };
}
function createMockTrustedDevices() {
  return {
    issue: jest.fn().mockResolvedValue('issued-device-token'),
    isTrusted: jest.fn().mockResolvedValue(false),
  };
}

describe('AuthController (Auth Phase 1)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwt: ReturnType<typeof createMockJwt>;
  let config: ReturnType<typeof createMockConfig>;
  let employeeService: ReturnType<typeof createMockEmployeeService>;
  let magicLink: ReturnType<typeof createMockMagicLink>;
  let mfa: ReturnType<typeof createMockMfa>;
  let refreshTokens: ReturnType<typeof createMockRefreshTokens>;
  let trustedDevices: ReturnType<typeof createMockTrustedDevices>;
  let controller: AuthController;

  beforeEach(() => {
    prisma = createMockPrisma();
    jwt = createMockJwt();
    config = createMockConfig();
    employeeService = createMockEmployeeService();
    magicLink = createMockMagicLink();
    mfa = createMockMfa();
    refreshTokens = createMockRefreshTokens();
    trustedDevices = createMockTrustedDevices();
    controller = new AuthController(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      employeeService as unknown as EmployeeService,
      magicLink as unknown as MagicLinkService,
      mfa,
      refreshTokens as unknown as RefreshTokenService,
      trustedDevices as unknown as TrustedDeviceService,
    );
  });

  describe('login (email + password)', () => {
    it('logs a non-MFA role (EMPLOYEE) straight in with access + refresh tokens', async () => {
      const passwordHash = await hashPassword('CorrectHorse123!');
      prisma.employee.findFirst.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Rahul',
        lastName: 'Verma',
        role: 'EMPLOYEE',
        passwordHash,
      });

      const result = await controller.login({
        email: 'rahul.verma@redrob.seed',
        password: 'CorrectHorse123!',
      });

      expect(result).toEqual({
        status: 'OK',
        accessToken: 'signed.jwt.token',
        refreshToken: 'issued-refresh-token',
        user: { id: 'emp-1', name: 'Rahul Verma', role: 'EMPLOYEE' },
      });
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: 'emp-1',
        role: 'EMPLOYEE',
      });
    });

    it('rejects an incorrect password with a generic message', async () => {
      const passwordHash = await hashPassword('CorrectHorse123!');
      prisma.employee.findFirst.mockResolvedValue({
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
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        controller.login({ email: 'nobody@redrob.seed', password: 'anything' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an employee that has no password set yet (not activated for password login)', async () => {
      prisma.employee.findFirst.mockResolvedValue({
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
      prisma.employee.findFirst.mockResolvedValue({
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

    describe('Section 11: MFA is mandatory for HR_ADMIN/SUPER_ADMIN', () => {
      it('starts enrollment for a Super Admin with no MFA set up yet, without issuing a session', async () => {
        const passwordHash = await hashPassword('CorrectHorse123!');
        prisma.employee.findFirst.mockResolvedValue({
          id: 'admin-1',
          firstName: 'Aditi',
          lastName: 'Rao',
          workEmail: 'aditi.rao@redrob.seed',
          role: 'SUPER_ADMIN',
          passwordHash,
          mfaEnabled: false,
        });

        const result = await controller.login({
          email: 'aditi.rao@redrob.seed',
          password: 'CorrectHorse123!',
        });

        expect(result).toEqual({
          status: 'MFA_ENROLL_REQUIRED',
          mfaToken: 'signed-mfa-token',
          secret: 'generated-secret',
          qrCodeDataUrl: 'data:image/png;base64,xyz',
        });
        expect(prisma.employee.update).toHaveBeenCalledWith({
          where: { id: 'admin-1' },
          data: { mfaSecret: 'generated-secret' },
        });
        expect(refreshTokens.issue).not.toHaveBeenCalled();
      });

      it('this task: re-enrolls a Super Admin whose mfaEnabled is true but has no secret, instead of sending them to a verify screen they can never pass', async () => {
        const passwordHash = await hashPassword('CorrectHorse123!');
        prisma.employee.findFirst.mockResolvedValue({
          id: 'admin-1',
          firstName: 'Aditi',
          lastName: 'Rao',
          workEmail: 'aditi.rao@redrob.seed',
          role: 'SUPER_ADMIN',
          passwordHash,
          mfaEnabled: true,
          mfaSecret: null,
        });

        const result = await controller.login({
          email: 'aditi.rao@redrob.seed',
          password: 'CorrectHorse123!',
        });

        expect(result).toEqual({
          status: 'MFA_ENROLL_REQUIRED',
          mfaToken: 'signed-mfa-token',
          secret: 'generated-secret',
          qrCodeDataUrl: 'data:image/png;base64,xyz',
        });
        expect(refreshTokens.issue).not.toHaveBeenCalled();
      });

      it('requires MFA verification for an HR Admin who already enrolled', async () => {
        const passwordHash = await hashPassword('CorrectHorse123!');
        prisma.employee.findFirst.mockResolvedValue({
          id: 'hr-1',
          role: 'HR_ADMIN',
          passwordHash,
          mfaEnabled: true,
          mfaSecret: 'existing-secret',
        });

        const result = await controller.login({
          email: 'priya.sharma@redrob.seed',
          password: 'CorrectHorse123!',
        });

        expect(result).toEqual({
          status: 'MFA_REQUIRED',
          mfaToken: 'signed-mfa-token',
        });
        expect(refreshTokens.issue).not.toHaveBeenCalled();
      });
    });

    describe('a recognized device token skips MFA entirely', () => {
      it('logs a Super Admin straight in when the presented device token is trusted', async () => {
        const passwordHash = await hashPassword('CorrectHorse123!');
        prisma.employee.findFirst.mockResolvedValue({
          id: 'admin-1',
          firstName: 'Aditi',
          lastName: 'Rao',
          role: 'SUPER_ADMIN',
          passwordHash,
          mfaEnabled: false,
        });
        trustedDevices.isTrusted.mockResolvedValue(true);

        const result = await controller.login({
          email: 'aditi.rao@redrob.seed',
          password: 'CorrectHorse123!',
          deviceToken: 'my-machine-token',
        });

        expect(trustedDevices.isTrusted).toHaveBeenCalledWith(
          'admin-1',
          'my-machine-token',
        );
        expect(result).toEqual({
          status: 'OK',
          accessToken: 'signed.jwt.token',
          refreshToken: 'issued-refresh-token',
          user: { id: 'admin-1', name: 'Aditi Rao', role: 'SUPER_ADMIN' },
        });
        expect(prisma.employee.update).not.toHaveBeenCalled();
      });

      it('still requires MFA when no device token is presented', async () => {
        const passwordHash = await hashPassword('CorrectHorse123!');
        prisma.employee.findFirst.mockResolvedValue({
          id: 'hr-1',
          role: 'HR_ADMIN',
          passwordHash,
          mfaEnabled: true,
          mfaSecret: 'existing-secret',
        });

        const result = await controller.login({
          email: 'priya.sharma@redrob.seed',
          password: 'CorrectHorse123!',
        });

        expect(trustedDevices.isTrusted).not.toHaveBeenCalled();
        expect(result).toEqual({
          status: 'MFA_REQUIRED',
          mfaToken: 'signed-mfa-token',
        });
      });

      it('still requires MFA when the device token is unrecognized/expired', async () => {
        const passwordHash = await hashPassword('CorrectHorse123!');
        prisma.employee.findFirst.mockResolvedValue({
          id: 'hr-1',
          role: 'HR_ADMIN',
          passwordHash,
          mfaEnabled: true,
          mfaSecret: 'existing-secret',
        });
        trustedDevices.isTrusted.mockResolvedValue(false);

        const result = await controller.login({
          email: 'priya.sharma@redrob.seed',
          password: 'CorrectHorse123!',
          deviceToken: 'some-other-machine-token',
        });

        expect(result).toEqual({
          status: 'MFA_REQUIRED',
          mfaToken: 'signed-mfa-token',
        });
      });
    });
  });

  describe('mfa/verify (second step for an already-enrolled account)', () => {
    it('issues a session when the code is correct', async () => {
      magicLink.verify.mockReturnValue({ sub: 'hr-1' });
      prisma.employee.findUnique.mockResolvedValue({
        id: 'hr-1',
        firstName: 'Priya',
        lastName: 'Sharma',
        role: 'HR_ADMIN',
        mfaEnabled: true,
        mfaSecret: 'existing-secret',
      });
      mfa.verify.mockReturnValue(true);

      const result = await controller.verifyMfa({
        mfaToken: 'mfa-token',
        code: '123456',
      });

      expect(result.status).toBe('OK');
      expect(mfa.verify).toHaveBeenCalledWith('123456', 'existing-secret');
      expect(trustedDevices.issue).toHaveBeenCalledWith('hr-1');
      expect(result).toMatchObject({ deviceToken: 'issued-device-token' });
    });

    it('rejects an incorrect code', async () => {
      magicLink.verify.mockReturnValue({ sub: 'hr-1' });
      prisma.employee.findUnique.mockResolvedValue({
        id: 'hr-1',
        mfaEnabled: true,
        mfaSecret: 'existing-secret',
      });
      mfa.verify.mockReturnValue(false);

      await expect(
        controller.verifyMfa({ mfaToken: 'mfa-token', code: '000000' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('mfa/enroll/confirm (completes the enrollment started in login)', () => {
    it('enables MFA and issues a session on a correct code', async () => {
      magicLink.verify.mockReturnValue({ sub: 'admin-1' });
      prisma.employee.findUnique.mockResolvedValue({
        id: 'admin-1',
        firstName: 'Aditi',
        lastName: 'Rao',
        role: 'SUPER_ADMIN',
        mfaSecret: 'generated-secret',
      });
      mfa.verify.mockReturnValue(true);

      const result = await controller.confirmMfaEnrollment({
        mfaToken: 'mfa-token',
        code: '123456',
      });

      expect(result.status).toBe('OK');
      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { mfaEnabled: true },
      });
      expect(trustedDevices.issue).toHaveBeenCalledWith('admin-1');
      expect(result).toMatchObject({ deviceToken: 'issued-device-token' });
    });

    it('rejects an incorrect enrollment code', async () => {
      magicLink.verify.mockReturnValue({ sub: 'admin-1' });
      prisma.employee.findUnique.mockResolvedValue({
        id: 'admin-1',
        mfaSecret: 'generated-secret',
      });
      mfa.verify.mockReturnValue(false);

      await expect(
        controller.confirmMfaEnrollment({
          mfaToken: 'mfa-token',
          code: '000000',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh + logout', () => {
    it('rotates the refresh token and issues a fresh access token', async () => {
      refreshTokens.rotate.mockResolvedValue({
        employeeId: 'emp-1',
        token: 'new-refresh-token',
      });
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        role: 'EMPLOYEE',
      });

      const result = await controller.refresh({
        refreshToken: 'old-refresh-token',
      });

      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('logout revokes the given refresh token', async () => {
      const result = await controller.logout({ refreshToken: 'some-token' });
      expect(refreshTokens.revoke).toHaveBeenCalledWith('some-token');
      expect(result).toEqual({ success: true });
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
