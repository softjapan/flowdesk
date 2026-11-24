/**
 * Better Auth の設定。
 * テーブル（user・session・account・verification・organization・member・
 * invitation）は CLI で Prisma スキーマに出力する：
 *   npx auth@1.7.27 generate --config src/server/auth-cli.ts
 * HTTP の入口は src/app/api/auth/[...all]/route.ts。
 * サーバー側でのセッションの取得は src/server/session.ts から行う。
 * ロール（owner・admin・staff）は src/server/access-control.ts で定義する。
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { ac, roles } from "@/server/access-control";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import { buildResetPasswordMail } from "@/server/auth-mails";
import { getPrisma } from "@/server/db";
import { sendMail } from "@/server/mail";

const RESET_PASSWORD_EXPIRES_IN_SECONDS = 60 * 60;

/**
 * organization プラグインの、組織とメンバーを変更する HTTP の入口。
 * 組織の作成・招待・ロール変更・削除は Service 層
 * （src/server/services/organizations.ts・members.ts・invitations.ts）で
 * docs/authz-matrix.md に従って判定し、監査ログと同じトランザクションで
 * 確定させる。プラグインの入口を開けておくと、Admin が Admin を削除する
 * など表と異なる操作や、監査ログに残らない変更ができてしまうので閉じる。
 * disabledPaths は HTTP のリクエストだけを止める（サーバーからの
 * getAuth().api の呼び出しは止めない）
 */
const DISABLED_ORGANIZATION_PATHS = [
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/update-member-role",
  "/organization/remove-member",
  "/organization/leave",
];

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
    disabledPaths: DISABLED_ORGANIZATION_PATHS,
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
    plugins: [
      // 既定の owner・admin・member の代わりに owner・admin・staff を使う
      organization({ ac, roles, creatorRole: "owner" }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** 最初に使うときに作り、以降は同じものを返す */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
