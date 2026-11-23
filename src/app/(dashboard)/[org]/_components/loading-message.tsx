export function LoadingMessage({ label }: { label: string }) {
  return (
    <p role="status" className="text-sm text-zinc-500">
      {label}を読み込んでいます…
    </p>
  );
}
