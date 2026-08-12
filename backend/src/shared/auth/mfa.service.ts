import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

const ISSUER = 'Redrob HRMS';

@Injectable()
export class MfaService {
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  async buildEnrollment(
    accountLabel: string,
    secret: string,
  ): Promise<{ secret: string; qrCodeDataUrl: string }> {
    const uri = authenticator.keyuri(accountLabel, ISSUER, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(uri);
    return { secret, qrCodeDataUrl };
  }

  verify(code: string, secret: string): boolean {
    try {
      return authenticator.check(code, secret);
    } catch {
      return false;
    }
  }
}
