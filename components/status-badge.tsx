import { Badge } from '@/components/ui/badge';

export function StatusBadge({ value }: { value: string }) {
  const className =
    value.includes('阻塞') || value === '高'
      ? 'bg-rose-100 text-rose-700'
      : value.includes('完成') || value === '正常'
        ? 'bg-emerald-100 text-emerald-700'
        : value.includes('进行') || value.includes('开发')
          ? 'bg-blue-100 text-blue-700'
          : 'bg-amber-100 text-amber-700';
  return <Badge className={className}>{value}</Badge>;
}
