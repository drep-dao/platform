import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { decryptSecret, encryptSecret } from '../common/secret-cipher';
import { PrismaService } from '../prisma/prisma.service';

type EmailConfig = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (465); false = STARTTLS (587/25)
  user: string;
  from: string; // e.g. "DRep Council <noreply@drepcouncil.org>"
};

const DEFAULTS: EmailConfig = { enabled: false, host: '', port: 587, secure: false, user: '', from: '' };
const CONFIG_KEY = 'EMAIL_CONFIG';
const PASSWORD_KEY = 'SMTP_PASSWORD';

/**
 * §20.3 — OUTBOUND-ONLY email. The platform never receives mail (no inbox, no mailbox to burden the
 * board): it only sends notification emails over SMTP. The sysadmin configures the SMTP relay in the
 * admin section (works even before a board is elected); the password is stored encrypted in
 * platform_secret, the rest in platform_config. Sending is best-effort and never throws into a caller.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async loadConfig(): Promise<EmailConfig> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: CONFIG_KEY } });
    const v = (row?.value ?? {}) as Partial<EmailConfig>;
    return {
      enabled: !!v.enabled,
      host: typeof v.host === 'string' ? v.host : DEFAULTS.host,
      port: Number.isFinite(v.port) ? Number(v.port) : DEFAULTS.port,
      secure: !!v.secure,
      user: typeof v.user === 'string' ? v.user : DEFAULTS.user,
      from: typeof v.from === 'string' ? v.from : DEFAULTS.from,
    };
  }

  private async loadPassword(): Promise<string> {
    const row = await this.prisma.platformSecret.findUnique({ where: { key: PASSWORD_KEY } });
    return decryptSecret(row?.value) ?? '';
  }

  /** Admin view: the config with the password redacted (only whether one is set). */
  async adminStatus(): Promise<EmailConfig & { hasPassword: boolean; configured: boolean }> {
    const cfg = await this.loadConfig();
    const hasPassword = !!(await this.loadPassword());
    return { ...cfg, hasPassword, configured: this.configuredWith(cfg, hasPassword) };
  }

  private configuredWith(cfg: EmailConfig, hasPassword: boolean): boolean {
    return cfg.enabled && !!cfg.host && !!cfg.from && (!cfg.user || hasPassword);
  }

  async isConfigured(): Promise<boolean> {
    return this.configuredWith(await this.loadConfig(), !!(await this.loadPassword()));
  }

  /** Admin: save the SMTP config. A non-empty `password` replaces the stored secret; '' or undefined keeps it. */
  async saveConfig(dto: Partial<EmailConfig> & { password?: string }) {
    const cur = await this.loadConfig();
    const next: EmailConfig = {
      enabled: dto.enabled ?? cur.enabled,
      host: (dto.host ?? cur.host).trim(),
      port: dto.port != null ? Number(dto.port) : cur.port,
      secure: dto.secure ?? cur.secure,
      user: (dto.user ?? cur.user).trim(),
      from: (dto.from ?? cur.from).trim(),
    };
    await this.prisma.platformConfig.upsert({
      where: { key: CONFIG_KEY },
      update: { value: next as object },
      create: { key: CONFIG_KEY, value: next as object },
    });
    if (dto.password) {
      await this.prisma.platformSecret.upsert({
        where: { key: PASSWORD_KEY },
        update: { value: encryptSecret(dto.password) },
        create: { key: PASSWORD_KEY, value: encryptSecret(dto.password), updatedBy: null },
      });
    }
    return this.adminStatus();
  }

  private async transport(): Promise<{ tx: nodemailer.Transporter; from: string } | null> {
    const cfg = await this.loadConfig();
    const password = await this.loadPassword();
    if (!this.configuredWith(cfg, !!password)) return null;
    const tx = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: password } : undefined,
    });
    return { tx, from: cfg.from };
  }

  /** Best-effort send. Returns whether it went out; never throws (email must not break a request). */
  async send(params: { to: string; subject: string; text: string; html?: string }): Promise<{ sent: boolean; reason?: string }> {
    if (!params.to?.includes('@')) return { sent: false, reason: 'no recipient email' };
    const t = await this.transport();
    if (!t) return { sent: false, reason: 'email not configured' };
    try {
      await t.tx.sendMail({ from: t.from, to: params.to, subject: params.subject, text: params.text, html: params.html });
      return { sent: true };
    } catch (e) {
      this.logger.warn(`email send failed → ${params.to}: ${e instanceof Error ? e.message : e}`);
      return { sent: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Admin: send a test email so the operator can confirm the SMTP settings work. Throws the SMTP error
   *  (unlike send()) so the admin UI can show exactly what went wrong. */
  async sendTest(to: string): Promise<{ sent: boolean }> {
    const t = await this.transport();
    if (!t) throw new Error('email is not enabled/configured — fill in the SMTP settings and enable it first');
    await t.tx.sendMail({
      from: t.from,
      to,
      subject: 'DRep Council — test email',
      text: 'This is a test email from the DRep Council platform. If you received it, outbound email works.',
    });
    return { sent: true };
  }

  /** Public site URL for links inside emails (network-derived; overridable via PUBLIC_SITE_URL). */
  siteUrl(): string {
    const env = this.config.get<string>('PUBLIC_SITE_URL');
    if (env) return env.replace(/\/$/, '');
    return this.config.get<string>('CARDANO_NETWORK') === 'Mainnet' ? 'https://drepcouncil.org' : 'https://preprod.drepcouncil.org';
  }
}
