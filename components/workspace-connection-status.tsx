import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

export type WorkspaceSourceState = 'loading' | 'live' | 'demo';

export function WorkspaceConnectionBadge({
  state,
}: {
  state: WorkspaceSourceState;
}) {
  const connected = state === 'live';
  return (
    <Badge
      className={`hidden sm:flex ${
        connected
          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
          : 'bg-amber-100 text-amber-800 hover:bg-amber-100'
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${
          connected ? 'bg-emerald-500' : 'bg-amber-500'
        }`}
      />
      {state === 'loading'
        ? '同步数据中'
        : connected
          ? '持久数据已连接'
          : '演示数据'}
    </Badge>
  );
}

export function WorkspaceFallbackAlert({ error }: { error: string }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">当前展示内置演示数据</p>
        <p className="mt-1 text-xs leading-5 text-amber-800">
          Python 后端暂不可用，新增、更新和历史记录写入可能失败。
          {error && ` 原因：${error}`}
        </p>
      </div>
    </div>
  );
}
