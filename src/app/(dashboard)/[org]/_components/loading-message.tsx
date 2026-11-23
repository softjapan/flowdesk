export function LoadingMessage({ label }: { label: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {label}を読み込んでいます…
    </p>
  );
}
