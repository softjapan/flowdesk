/**
 * Better Auth の設定。
 * テーブル（user・session・account・verification・organization・member・
 * invitation）は CLI で Prisma スキーマに出力する：
 *   npx auth@1.7.27 generate --config src/server/auth-cli.ts
 * HTTP の入口は src/app/api/auth/[...all]/route.ts。
 * サーバー側でのセッションの取得は src/server/session.ts から行う。
 * staff ロールの定義（createAccessControl）は第10章で追加する。
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import { buildResetPasswordMail } from "@/server/auth-mails";
import { getPrisma } from "@/server/db";
import { sendMail } from "@/server/mail";

const RESET_PASSWORD_EXPIRES_IN_SECONDS = 60 * 60;

/**
 * Better Auth の設定を作る。prismaAdapter は作る時点で Client を使うので、
 * モジュールの読み込み時には呼ばない（DATABASE_URL のない CI のビルドで
 * 失敗するため）。アプリからは getAuth() を使う
 */
export function createAuth() {
  return betterAuth({
    // 署名・暗号化の鍵と、メールのリンクなどに使う公開 URL（.env.example）
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_EXPIRES_IN_SECONDS,
      // 再設定したら、他の端末に残っているセッションもすべて無効にする
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // 送信を待つと、登録済みのアドレスかどうかが応答時間から
        // 分かってしまうので、待たずに返す。失敗はログに残す
        void sendMail(
          buildResetPasswordMail({
            to: user.email,
            name: user.name,
            url,
            expiresInMinutes: RESET_PASSWORD_EXPIRES_IN_SECONDS / 60,
          }),
        ).catch((error: unknown) => {
          console.error("パスワード再設定メールの送信に失敗", error);
        });
      },
    },
    // nextCookies は Server Action から呼んだときに Cookie を設定する。
    // プラグインの最後に置く
    plugins: [organization(), nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** 最初に使うときに作り、以降は同じものを返す */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
