import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * 認証の画面の枠。フォームはクエリ（callbackUrl・token）を読むので
 * Suspense の内側に置き、見出しは静的なシェルとして先に返す
 */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 id="form-title">{title}</h1>
        </CardTitle>
        {description && (
          <CardDescription>{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <Suspense fallback={<FormFallback />}>{children}</Suspense>
      </CardContent>
    </Card>
  );
}

function FormFallback() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
