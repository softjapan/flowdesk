"use client";

import { Upload } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
} from "@/server/validation/upload";
import type { CompleteUploadState } from "../actions";

type PresignResponse = {
  attachmentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

/**
 * 顧客の写真・添付ファイルのアップロード（F-12）。
 * 1. /api/uploads/presign で署名付き URL を受け取る
 * 2. ファイルを S3 に直接 PUT する（アプリのサーバーを通さない）
 * 3. Server Action で完了を知らせる（サーバーが S3 のファイルを確かめる）
 * 形式とサイズはここでも確かめるが、本当の判定はサーバーと S3 の署名で行う。
 */
export function AttachmentUploader({
  slug,
  customerId,
  complete,
}: {
  slug: string;
  customerId: string;
  complete: (attachmentId: string) => Promise<CompleteUploadState>;
}) {
  const inputId = useId();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  // アップロードのたびに input を作り直し、選んだファイルを消す
  const [inputKey, setInputKey] = useState(0);

  async function upload(file: File): Promise<string | undefined> {
    if (
      !(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)
    ) {
      return "アップロードできるのは画像（JPEG・PNG・WebP・GIF）と PDF です。";
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return "ファイルは 10MB 以下にしてください。";
    }
    const presign = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org: slug,
        customerId,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      }),
    });
    if (!presign.ok) {
      const body = (await presign.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
      };
      return (
        Object.values(body.fields ?? {})[0] ??
        body.error ??
        "アップロードを開始できませんでした。"
      );
    }
    const ticket = (await presign.json()) as PresignResponse;
    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: ticket.headers,
      body: file,
    });
    if (!put.ok) {
      return "ファイルを送信できませんでした。時間をおいて、もう一度お試しください。";
    }
    const result = await complete(ticket.attachmentId);
    return result.form;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setMessage("ファイルを選んでください。");
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      const error = await upload(file).catch(
        () => "通信に失敗しました。もう一度お試しください。",
      );
      setMessage(error);
      if (!error) setInputKey((k) => k + 1);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="grid gap-1.5">
        <Label htmlFor={inputId}>ファイルを追加</Label>
        <Input
          key={inputKey}
          id={inputId}
          name="file"
          type="file"
          accept={ALLOWED_UPLOAD_TYPES.join(",")}
          className="w-80"
        />
        <p className="text-xs text-muted-foreground">
          画像（JPEG・PNG・WebP・GIF）と PDF、10MB まで
        </p>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        <Upload aria-hidden="true" />
        {pending ? "アップロードしています…" : "アップロード"}
      </Button>
      <div role="alert" className="text-sm text-destructive">
        {message}
      </div>
    </form>
  );
}
