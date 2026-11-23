import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

// shadcn が生成する版は effect の中で setState を呼び、
// eslint の react-hooks/set-state-in-effect に当たるので、
// 外部の状態（メディアクエリ）を購読する useSyncExternalStore で書き直す
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // サーバーとハイドレーション時はデスクトップとして描く（元の実装と同じ）
    () => false,
  );
}
