'use client';

import { FileChartColumn, FileText, GitBranch, Sparkles } from 'lucide-react';

import { SectionTitle } from '@/components/section-title';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

type VersionScope = 'portfolio' | 'v0.9' | 'v1.0' | 'v1.1';
type ReportRecord = {
  id: string;
  type: string;
  version: VersionScope;
  summary: string;
  createdAt: string;
};
type VersionRoadmap = {
  name: string;
  state: string;
  date: string;
  scope: string;
  progress: number;
};
const versionScopeLabels: Record<VersionScope, string> = {
  portfolio: '并行版本总览',
  'v0.9': 'v0.9 Alpha',
  'v1.0': 'v1.0 Beta',
  'v1.1': 'v1.1 Growth',
};

export default function ReportsView({
  reportsData,
  onReport,
  versionScope,
  versionsData,
}: {
  reportsData: ReportRecord[];
  onReport: () => void;
  versionScope: VersionScope;
  versionsData: VersionRoadmap[];
}) {
  return (
    <>
      <SectionTitle
        eyebrow="Release · Narrative · Decisions"
        title={`版本计划与报告 · ${versionScopeLabels[versionScope]}`}
        action={
          <Button onClick={onReport}>
            <Sparkles />
            生成报告
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>版本路线图</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {versionsData.map((v) => (
              <div key={v.name} className="rounded-xl border p-4">
                <div className="flex items-center gap-3">
                  <GitBranch className="size-4 text-primary" />
                  <p className="font-semibold">{v.name}</p>
                  <StatusBadge value={v.state} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {v.date}
                  </span>
                </div>
                <p className="mb-3 mt-2 text-xs text-muted-foreground">
                  {v.scope}
                </p>
                <div className="flex items-center gap-3">
                  <Progress value={v.progress} className="flex-1" />
                  <span className="text-xs">{v.progress}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>自动报告中心</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                ['项目日报', '每天 18:00', '今天 18:00'],
                ['项目周报', '每周五 17:30', '明天 17:30'],
                ['版本简报', '版本节点触发', '09月13日'],
              ].map((x) => (
                <div
                  key={x[0]}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <FileChartColumn className="size-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{x[0]}</p>
                    <p className="text-[11px] text-muted-foreground">{x[1]}</p>
                  </div>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {x[2]}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>已生成报告与变更分析</CardTitle>
              <p className="text-xs text-muted-foreground">
                手工生成的日报、周报、版本简报和需求变更分析统一保存在这里
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {reportsData.length === 0 && (
                <div className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">
                  暂无归档。需求变更完成 AI
                  分析后会生成分析报告；也可通过这里的“生成报告”创建日报、周报或版本简报。
                </div>
              )}
              {[...reportsData]
                .reverse()
                .slice(0, 5)
                .map((report) => (
                  <div
                    key={report.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <FileText className="size-4 text-primary" />
                    <div>
                      <p className="text-sm font-medium">
                        {report.type} · {versionScopeLabels[report.version]}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(report.createdAt).toLocaleString('zh-CN')}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {report.summary}
                      </p>
                    </div>
                    <Badge variant="outline" className="ml-auto">
                      已归档
                    </Badge>
                  </div>
                ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>本周 AI 摘要</CardTitle>
            </CardHeader>
            <CardContent className="text-xs leading-6 text-muted-foreground">
              <p>
                完成 11 项任务，整体进度提升 9%。核心联调受支付接口影响落后
                4%，需优先解除关键路径阻塞。
              </p>
              <p className="mt-2 text-foreground">
                <strong>需管理层决策：</strong>
                是否启用备用支付通道；是否批准测试资源借调。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
