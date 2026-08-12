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
import { ActivateAccountDto } from './dto/activate-account.dto';
import { Public } from './public.decorator';
import { verifyPassword } from './password.util';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly employeeService: EmployeeService,
  ) {}

  // Phase 1: real email+password login. Same token/response shape as
  // dev-login so the frontend can share one AuthUser/JWT contract. A single
  // "invalid credentials" message is used for both an unknown email and a
  // wrong password, so failed attempts can't be used to enumerate accounts.
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

    const accessToken = await this.jwt.signAsync({
      sub: employee.id,
      role: employee.role,
    });

    return {
      accessToken,
      user: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        role: employee.role,
      },
    };
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

    const accessToken = await this.jwt.signAsync({
      sub: employee.id,
      role: employee.role,
    });

    return {
      accessToken,
      user: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        role: employee.role,
      },
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
