import type { ReactNode } from 'react';

export function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[.12em] text-primary">
          {eyebrow}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      </div>
      {action}
    </div>
  );
}
