import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { DevLoginDto } from './dto/dev-login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

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
}
