/**
 * メールの送信（SMTP）。ローカルでは docker compose の Mailpit に送り、
 * http://localhost:8025 で中身を確認する。本番は SES の SMTP を想定し、
 * SMTP_USER・SMTP_PASSWORD があれば認証する。
 *
 * 第11章から、SMTP に送るのは Worker（src/worker/index.ts）だけになった。
 * アプリはメールを送らず、送信の依頼をジョブとしてキューに積む
 * （src/server/services/jobs.ts の createMailJob・enqueueMail）。
 */
import nodemailer, { type Transporter } from "nodemailer";
import { SpanKind, withSpan } from "@/server/telemetry/tracing";

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

/**
 * messageId はジョブごとに固定の値を渡す。同じジョブを送り直したとき、
 * 受信側（メールソフト）が同じメールとして扱える
 */
export async function sendMail(
  mail: Mail,
  options: { messageId?: string } = {},
): Promise<void> {
  const from = process.env.MAIL_FROM;
  if (!from) {
    throw new Error(
      "MAIL_FROM が設定されていない（.env.example を参照）",
    );
  }
  // 宛先・件名・本文はスパンに載せない（個人情報。第18章）
  await withSpan(
    "smtp send",
    {
      "server.address": process.env.SMTP_HOST ?? "localhost",
      "server.port": Number(process.env.SMTP_PORT ?? 1025),
    },
    () =>
      getTransport().sendMail({
        from,
        ...mail,
        messageId: options.messageId,
      }),
    { kind: SpanKind.CLIENT },
  );
}
