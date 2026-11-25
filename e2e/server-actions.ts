/**
 * Server Action を画面を通さずに呼ぶ（第14章）。画面のボタンは
 * .bind で引数（スラッグ・ID）を埋めて送るが、引数は利用者が書き換えて
 * 送れる。攻撃者と同じく、HTTP のリクエストを直接組み立てて確かめる。
 *
 * Action の ID は next build が出力する manifest から引く
 * （E2E は next build → next start で動くので、テストの時点でできている）。
 * 引数が文字列だけの Action は、本文を JSON の配列で送れる
 * （React の encodeReply が文字列だけの引数に使う形）。
 */
import { readFileSync } from "node:fs";
import type {
  APIRequestContext,
  APIResponse,
} from "@playwright/test";

type Manifest = {
  node: Record<string, { filename: string; exportedName: string }>;
};

let manifest: Manifest | undefined;

export function serverActionId(
  filename: string,
  exportedName: string,
): string {
  manifest ??= JSON.parse(
    readFileSync(
      ".next/server/server-reference-manifest.json",
      "utf8",
    ),
  ) as Manifest;
  const found = Object.entries(manifest.node).find(
    ([, v]) =>
      v.filename === filename && v.exportedName === exportedName,
  );
  if (!found) {
    throw new Error(
      `Server Action がない：${filename} ${exportedName}`,
    );
  }
  return found[0];
}

export async function callServerAction(
  request: APIRequestContext,
  input: {
    /** Action を呼ぶページ（ブラウザが POST する先） */
    path: string;
    actionId: string;
    args: string[];
    /** 既定は自分のオリジン。別のサイトからの送信を試すときに変える */
    origin?: string;
    baseURL: string;
  },
): Promise<APIResponse> {
  return request.post(input.path, {
    headers: {
      "Next-Action": input.actionId,
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: input.origin ?? input.baseURL,
    },
    data: JSON.stringify(input.args),
    maxRedirects: 0,
  });
}
