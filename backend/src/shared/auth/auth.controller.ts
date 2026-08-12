import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EmployeeStatus, Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { Roles } from '../rbac/roles.decorator';
import { EmployeeService } from '../../modules/employee/employee.service';
import { DevLoginDto } from './dto/dev-login.dto';
import { LoginDto } from './dto/login.dto';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { Public } from './public.decorator';
import { verifyPassword } from './password.util';
import { MagicLinkService } from './magic-link.service';
import { MfaService } from './mfa.service';
import { RefreshTokenService } from './refresh-token.service';

const MFA_VERIFY_PURPOSE = 'mfa-verify';
const MFA_ENROLL_PURPOSE = 'mfa-enroll';

// Section 6 Access Control Rule / Section 11: MFA is mandatory for these
// two roles, not optional — a password alone is never enough for them.
const MFA_REQUIRED_ROLES: Role[] = [Role.HR_ADMIN, Role.SUPER_ADMIN];

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly employeeService: EmployeeService,
    private readonly magicLink: MagicLinkService,
    private readonly mfa: MfaService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  private toUserView(employee: {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
  }) {
    return {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      role: employee.role,
    };
  }

  private async issueSession(employee: { id: string; role: Role }) {
    const accessToken = await this.jwt.signAsync({
      sub: employee.id,
      role: employee.role,
    });
    const refreshToken = await this.refreshTokens.issue(employee.id);
    return { accessToken, refreshToken };
  }

  // Phase 1: real email+password login. Same token/response shape as
  // dev-login so the frontend can share one AuthUser/JWT contract. A single
  // "invalid credentials" message is used for both an unknown email and a
  // wrong password, so failed attempts can't be used to enumerate accounts.
  //
  // Section 11: Super Admin/HR Admin never get a session from a password
  // alone — a correct password routes them into the MFA enroll/verify step
  // below instead of returning a token directly.
  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { workEmail: dto.email },
    });
    if (!employee?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await verifyPassword(
      dto.password,
      employee.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    this.assertNotTerminated(employee);

    if (MFA_REQUIRED_ROLES.includes(employee.role)) {
      if (!employee.mfaEnabled) {
        const secret = this.mfa.generateSecret();
        await this.prisma.employee.update({
          where: { id: employee.id },
          data: { mfaSecret: secret },
        });
        const enrollment = await this.mfa.buildEnrollment(
          employee.workEmail ?? employee.employeeCode,
          secret,
        );
        const mfaToken = this.magicLink.sign(
          { sub: employee.id, purpose: MFA_ENROLL_PURPOSE },
          '10m',
        );
        return {
          status: 'MFA_ENROLL_REQUIRED' as const,
          mfaToken,
          ...enrollment,
        };
      }

      const mfaToken = this.magicLink.sign(
        { sub: employee.id, purpose: MFA_VERIFY_PURPOSE },
        '5m',
      );
      return { status: 'MFA_REQUIRED' as const, mfaToken };
    }

    const { accessToken, refreshToken } = await this.issueSession(employee);
    return {
      status: 'OK' as const,
      accessToken,
      refreshToken,
      user: this.toUserView(employee),
    };
  }

  // Second step of login for an account with MFA already enrolled.
  @Public()
  @Post('mfa/verify')
  async verifyMfa(@Body() dto: MfaCodeDto) {
    const { sub: employeeId } = this.magicLink.verify(
      dto.mfaToken,
      MFA_VERIFY_PURPOSE,
    );
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee || !employee.mfaEnabled || !employee.mfaSecret) {
      throw new UnauthorizedException('MFA is not set up for this account');
    }
    if (!this.mfa.verify(dto.code, employee.mfaSecret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    const { accessToken, refreshToken } = await this.issueSession(employee);
    return {
      status: 'OK' as const,
      accessToken,
      refreshToken,
      user: this.toUserView(employee),
    };
  }

  // Confirms the enrollment started inline in login() above — the QR
  // code/secret were only ever shown to the caller who already proved
  // their password, so a correct code here is sufficient to both enable
  // MFA and complete this login.
  @Public()
  @Post('mfa/enroll/confirm')
  async confirmMfaEnrollment(@Body() dto: MfaCodeDto) {
    const { sub: employeeId } = this.magicLink.verify(
      dto.mfaToken,
      MFA_ENROLL_PURPOSE,
    );
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee || !employee.mfaSecret) {
      throw new UnauthorizedException('No MFA enrollment in progress');
    }
    if (!this.mfa.verify(dto.code, employee.mfaSecret)) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.prisma.employee.update({
      where: { id: employee.id },
      data: { mfaEnabled: true },
    });

    const { accessToken, refreshToken } = await this.issueSession(employee);
    return {
      status: 'OK' as const,
      accessToken,
      refreshToken,
      user: this.toUserView(employee),
    };
  }

  // Section 11: "short-lived access tokens; refresh-token rotation on
  // use." Rotation happens inside RefreshTokenService.rotate — the token
  // presented here is revoked and a new one issued in the same call.
  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    const { employeeId, token } = await this.refreshTokens.rotate(
      dto.refreshToken,
    );
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new UnauthorizedException('Account no longer exists');

    const accessToken = await this.jwt.signAsync({
      sub: employee.id,
      role: employee.role,
    });
    return { accessToken, refreshToken: token };
  }

  @Public()
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.refreshTokens.revoke(dto.refreshToken);
    return { success: true };
  }

  // Phase 1 requirement: at least one protected Super Admin-only endpoint,
  // to prove @Roles + the existing global RolesGuard/CurrentUser correctly
  // authorize by the JWT's role, never a client-supplied one.
  @Get('super-admin/status')
  @Roles(Role.SUPER_ADMIN)
  superAdminStatus() {
    return { ok: true, message: 'Super Admin access confirmed' };
  }

  // Auth Phase 2: the invitation token itself is the authorization
  // mechanism for these two endpoints — deliberately public, since the
  // employee has no account/JWT yet at this point.
  @Public()
  @Get('activate/:token')
  validateActivationToken(@Param('token') token: string) {
    return this.employeeService.validateInvitationToken(token);
  }

  @Public()
  @Post('activate')
  activateAccount(@Body() dto: ActivateAccountDto) {
    return this.employeeService.activateAccount(dto);
  }

  // Dev-only stand-in for the OIDC/SSO login flow (Section 10). Lets the
  // frontend sign in as one of the seeded demo employees so RBAC and
  // field-masking can be exercised end-to-end before real SSO is wired up.
  //
  // SECURITY: this issues a valid session for ANY employee given only their
  // employeeCode — no password, no MFA. It must never be reachable once
  // this app is actually deployed for real users; disabled outside
  // dev/test so a misconfigured deploy can't accidentally ship it live.
  // Real credentialed login (password/SSO per PRD Section 11) still needs
  // to replace this before go-live — see the security review summary.
  @Public()
  @Post('dev-login')
  async devLogin(@Body() dto: DevLoginDto) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new NotFoundException();
    }

    const employee = await this.prisma.employee.findUnique({
      where: { employeeCode: dto.employeeCode },
    });
    if (!employee) {
      throw new NotFoundException('No employee with that employee code');
    }
    this.assertNotTerminated(employee);

    const { accessToken, refreshToken } = await this.issueSession(employee);

    return {
      accessToken,
      refreshToken,
      user: this.toUserView(employee),
    };
  }

  // Dismissal (this task): a terminated employee must never be able to log
  // in again through any entry point, real or dev, regardless of whether
  // their old password/employee code still resolves to a real record.
  private assertNotTerminated(employee: { status: EmployeeStatus }): void {
    if (employee.status === EmployeeStatus.TERMINATED) {
      throw new UnauthorizedException(
        'This account has been deactivated. Contact HR for assistance.',
      );
    }
  }
}
