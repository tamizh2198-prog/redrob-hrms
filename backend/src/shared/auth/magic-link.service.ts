import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';

export interface MagicLinkPayload {
  sub: string;
  purpose: string;
  [key: string]: unknown;
}

// Stand-in for a candidate/new-hire auth system (Sections 7.6/7.7): a
// signed, short-lived, purpose-scoped token embedded in an emailed link so
// an external candidate or a new hire pre-Day-1 can act on their own record
// without a full employee login.
@Injectable()
export class MagicLinkService {
  constructor(private readonly jwt: JwtService) {}

  sign(
    payload: MagicLinkPayload,
    expiresIn: NonNullable<JwtSignOptions['expiresIn']> = '7d',
  ): string {
    return this.jwt.sign(payload, { expiresIn });
  }

  verify<T extends MagicLinkPayload>(token: string, purpose: string): T {
    let decoded: T;
    try {
      decoded = this.jwt.verify<T>(token);
    } catch {
      throw new UnauthorizedException('This link is invalid or has expired');
    }
    if (decoded.purpose !== purpose) {
      throw new UnauthorizedException('This link is invalid');
    }
    return decoded;
  }
}
