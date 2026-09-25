import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "../config/env";
import { logger } from "../lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** Same key → the provider sends at most once (safe queue retries). */
  idempotencyKey?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<{ messageId: string | null }>;
}

/** Primary provider (PRD §36): Resend via its official SDK. */
class ResendProvider implements EmailProvider {
  readonly name = "resend";
  private client = new Resend(env.RESEND_API_KEY);
  async send(msg: EmailMessage) {
    const { data, error } = await this.client.emails.send(
      { from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers },
      msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : undefined,
    );
    if (error) throw new Error(`Resend: ${error.message}`);
    return { messageId: data?.id ?? null };
  }
}

/** Optional alternative (any SMTP relay, or a local catcher such as Mailpit). */
class SmtpProvider implements EmailProvider {
  readonly name = "smtp";
  private transport = nodemailer.createTransport(env.SMTP_URL);
  async send(msg: EmailMessage) {
    const info = await this.transport.sendMail({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers });
    return { messageId: info.messageId ?? null };
  }
}

class ConsoleProvider implements EmailProvider {
  readonly name = "console";
  async send(msg: EmailMessage) {
    logger.info({ event: "EMAIL_CONSOLE", subject: msg.subject, bytes: msg.html.length }, "email (console provider, not delivered)");
    return { messageId: null };
  }
}

let provider: EmailProvider | null = null;
export function emailProvider(): EmailProvider {
  if (provider) return provider;
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) provider = new ResendProvider();
  else if (env.EMAIL_PROVIDER === "smtp") provider = new SmtpProvider();
  else {
    if (env.EMAIL_PROVIDER === "resend") logger.warn("EMAIL_PROVIDER=resend but RESEND_API_KEY is empty — emails are logged, not delivered");
    provider = new ConsoleProvider();
  }
  return provider;
}
