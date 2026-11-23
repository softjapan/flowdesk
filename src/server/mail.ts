/**
 * メールの送信（SMTP）。ローカルでは docker compose の Mailpit に送り、
 * http://localhost:8025 で中身を確認する。本番は SES の SMTP を想定し、
 * SMTP_USER・SMTP_PASSWORD があれば認証する。
 */
import nodemailer, { type Transporter } from "nodemailer";

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

const globalForMail = globalThis as unknown as {
  mailTransport?: Transporter;
};

function getTransport(): Transporter {
  globalForMail.mailTransport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 1025),
    // 465 のときだけ最初から TLS。それ以外は STARTTLS（Mailpit は平文）
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
  });
  return globalForMail.mailTransport;
}

export async function sendMail(mail: Mail): Promise<void> {
  const from = process.env.MAIL_FROM;
  if (!from) {
    throw new Error(
      "MAIL_FROM が設定されていない（.env.example を参照）",
    );
  }
  await getTransport().sendMail({ from, ...mail });
}
