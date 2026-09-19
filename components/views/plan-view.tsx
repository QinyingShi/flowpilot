'use client';

import { useState } from 'react';
import {
  CalendarDays,
  ClipboardCheck,
  Clock3,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import { SectionTitle } from '@/components/section-title';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { createRecordToken } from '@/lib/record-id';
import { shanghaiDateTimeToIso, shanghaiNow } from '@/lib/shanghai-time';
import type { TaskRecord } from '@/lib/task-model';

type VersionScope = 'portfolio' | 'v0.9' | 'v1.0' | 'v1.1';
type DeliveryMode = 'agile' | 'waterfall';
type VersionConfig = {
  version: Exclude<VersionScope, 'portfolio'>;
  mode: DeliveryMode;
  label: string;
  locked: boolean;
};
type StoredPlanBaseline = {
  id: string;
  project_id: string;
  version_id: Exclude<VersionScope, 'portfolio'>;
  baseline_key: string;
  label: string;
  snapshot_json: string;
  created_by: string;
  created_at: string;
};
type StoredMilestoneEvent = {
  id: number;
  project_id: string;
  version_id: Exclude<VersionScope, 'portfolio'>;
  milestone_key: string;
  event_type: 'planned' | 'replanned' | 'actual' | 'forecast';
  occurred_at: string;
  source_system: string;
  detail: string | null;
  created_at: string;
};
type VersionId = Exclude<VersionScope, 'portfolio'>;
type ReleasePlan = {
  scope: string;
  development: string;
  integration: string;
  testEntry: string;
  testing: string;
  release: string;
  buffer: string;
  risk: string;
};
type Milestone = {
  name: string;
  version: string;
  date: string;
  owner: string;
  state: string;
  progress: number;
};
type ParallelProgressPoint = {
  day: string;
  alphaActual: number | null;
  alphaForecast: number | null;
  betaActual: number | null;
  betaForecast: number | null;
  growthActual: number | null;
  growthForecast: number | null;
};
type StoredPlanSnapshot = {
  development?: string;
  integration?: string;
  testEntry?: string;
  testing?: string;
  release?: string;
  reason?: string;
};
type PlanDomain = {
  buildParallelTaskProgress: (tasks: TaskRecord[]) => ParallelProgressPoint[];
  versionPlanSettings: Record<VersionId, { start: string; offsets: number[] }>;
  addChinaWorkdays: (start: string, workdays: number) => Date;
  getCalendarImpact: (
    start: string,
    end: Date,
  ) => {
    holidays: number;
    weekends: number;
    makeupWorkdays: number;
  };
  versionReleasePlans: Record<VersionId, ReleasePlan>;
  defaultVersionConfigs: VersionConfig[];
  milestones: Milestone[];
  versionScopeLabels: Record<VersionScope, string>;
  currentDay: string;
  parseStoredPlan: (value: string) => StoredPlanSnapshot;
  formatMilestoneDateTime: (value: string) => string;
};

export default function PlanView({
  versionScope,
  tasksData,
  versionConfigs,
  milestoneFocus,
  onClearMilestoneFocus,
  domain,
}: {
  versionScope: VersionScope;
  tasksData: TaskRecord[];
  versionConfigs: VersionConfig[];
  milestoneFocus: string;
  onClearMilestoneFocus: () => void;
  domain: PlanDomain;
}) {
  const {
    addChinaWorkdays,
    buildParallelTaskProgress,
    currentDay,
    defaultVersionConfigs,
    formatMilestoneDateTime,
    getCalendarImpact,
    milestones,
    parseStoredPlan,
    versionPlanSettings,
    versionReleasePlans,
    versionScopeLabels,
  } = domain;
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState(false);
  const [planAdopted, setPlanAdopted] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [storedBaselines, setStoredBaselines] = useState<StoredPlanBaseline[]>(
    [],
  );
  const [storedEvents, setStoredEvents] = useState<StoredMilestoneEvent[]>([]);
  const [actualDraft, setActualDraft] = useState<{
    version: Exclude<VersionScope, 'portfolio'>;
    milestone: string;
    occurredAt: string;
    detail: string;
  } | null>(null);
  const [savingActual, setSavingActual] = useState(false);
  const dynamicParallelProgress = buildParallelTaskProgress(tasksData);
  const showAlpha = versionScope === 'portfolio' || versionScope === 'v0.9';
  const showBeta = versionScope === 'portfolio' || versionScope === 'v1.0';
  const showGrowth = versionScope === 'portfolio' || versionScope === 'v1.1';
  const planScopes: Exclude<VersionScope, 'portfolio'>[] =
    versionScope === 'portfolio' ? ['v0.9', 'v1.0', 'v1.1'] : [versionScope];
  const generatedPlanGroups = planScopes.map((scope) => {
    const settings = versionPlanSettings[scope];
    const dates = settings.offsets.map((offset) =>
      addChinaWorkdays(settings.start, offset),
    );
    return {
      scope,
      impact: getCalendarImpact(settings.start, dates[dates.length - 1]),
      plan: versionReleasePlans[scope],
      config:
        versionConfigs.find((config) => config.version === scope) ??
        defaultVersionConfigs.find((config) => config.version === scope)!,
    };
  });
  const calendarImpact = generatedPlanGroups.reduce(
    (total, group) => ({
      holidays: total.holidays + group.impact.holidays,
      weekends: total.weekends + group.impact.weekends,
      makeupWorkdays: total.makeupWorkdays + group.impact.makeupWorkdays,
    }),
    { holidays: 0, weekends: 0, makeupWorkdays: 0 },
  );
  const versionMilestones =
    versionScope === 'portfolio'
      ? milestones
      : milestones.filter((milestone) => milestone.version === versionScope);
  const visibleMilestones = milestoneFocus
    ? versionMilestones.filter((milestone) => milestone.name === milestoneFocus)
    : versionMilestones;
  const milestoneGroups = planScopes
    .map((scope) => ({
      scope,
      items: visibleMilestones.filter(
        (milestone) => milestone.version === scope,
      ),
    }))
    .filter((group) => group.items.length > 0);
  const analysisScope: Exclude<VersionScope, 'portfolio'> =
    versionScope === 'portfolio' ? 'v1.0' : versionScope;
  const criticalPathByVersion: Record<
    Exclude<VersionScope, 'portfolio'>,
    { nodes: string[]; note: string }
  > = {
    'v0.9': {
      nodes: ['0.3 会员API', '0.4 联合联调', '0.5 验收关闭', 'Alpha发布'],
      note: '关键路径浮动时间 2 天。遗留缺陷每增加 1 个 P1，Alpha 验收延期概率约增加 9%。',
    },
    'v1.0': {
      nodes: ['2.1 API改造', '2.2 支付联调', '3.2 回归测试', 'Beta发布'],
      note: '关键路径浮动时间仅 1 天。支付联调每延迟 1 天，Beta 发布延期概率增加 18%。',
    },
    'v1.1': {
      nodes: ['4.1 规则确认', '4.2 规则引擎', '4.6 联合联调', 'Growth发布'],
      note: '关键路径浮动时间 3 天。若共享测试资源未按时归还，Growth 提测可能顺延 2 天。',
    },
  };
  const predictionByVersion: Record<
    Exclude<VersionScope, 'portfolio'>,
    [string, string][]
  > = {
    'v0.9': [
      ['09/14 按期发布', '84%'],
      ['延迟 1–2 天', '14%'],
      ['延迟 3 天以上', '2%'],
    ],
    'v1.0': [
      ['09/30 按期发布', '63%'],
      ['延迟 1–3 天', '29%'],
      ['延迟 4 天以上', '8%'],
    ],
    'v1.1': [
      ['10/20 按期发布', '58%'],
      ['延迟 1–3 天', '34%'],
      ['延迟 4 天以上', '8%'],
    ],
  };
  const predictionScopes: Exclude<VersionScope, 'portfolio'>[] =
    versionScope === 'portfolio' ? ['v0.9', 'v1.0', 'v1.1'] : [analysisScope];
  const criticalPath = criticalPathByVersion[analysisScope];

  async function loadPlanHistory() {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await fetch('/api/workspace');
      if (!response.ok) throw new Error('历史数据读取失败');
      const data = (await response.json()) as {
        snapshot?: {
          planBaselines?: StoredPlanBaseline[];
          milestoneEvents?: StoredMilestoneEvent[];
        };
      };
      setStoredBaselines(data.snapshot?.planBaselines ?? []);
      setStoredEvents(data.snapshot?.milestoneEvents ?? []);
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : '历史数据读取失败',
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openPlanHistory() {
    setHistoryOpen(true);
    await loadPlanHistory();
  }

  async function saveGeneratedPlan() {
    setSavingPlan(true);
    setHistoryError('');
    try {
      const stamp = createRecordToken();
      await Promise.all(
        generatedPlanGroups.map(async (group) => {
          const response = await fetch('/api/workspace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'save_plan_baseline',
              versionId: group.scope,
              baselineKey: `AI-${stamp}`,
              label: 'AI 采纳版本计划',
              snapshot: {
                ...group.plan,
                deliveryMode: group.config.mode,
                deliveryModeLabel: group.config.label,
                calendarImpact: group.impact,
                adoptedAt: new Date().toISOString(),
              },
            }),
          });
          if (!response.ok) throw new Error('版本计划保存失败');
        }),
      );
      setPlanAdopted(true);
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : '版本计划保存失败',
      );
    } finally {
      setSavingPlan(false);
    }
  }

  async function saveMilestoneActual() {
    if (!actualDraft) return;
    setSavingActual(true);
    setHistoryError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_milestone_actual',
          versionId: actualDraft.version,
          milestoneKey: actualDraft.milestone,
          occurredAt: shanghaiDateTimeToIso(actualDraft.occurredAt),
          detail: actualDraft.detail,
        }),
      });
      if (!response.ok) throw new Error('实际完成时间保存失败');
      setActualDraft(null);
      if (historyOpen) await loadPlanHistory();
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : '实际完成时间保存失败',
      );
    } finally {
      setSavingActual(false);
    }
  }

  return (
    <>
      <SectionTitle
        eyebrow="Baseline · Forecast · Dependencies"
        title="计划与里程碑"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openPlanHistory}>
              <Clock3 />
              版本计划历史
            </Button>
            <Button
              disabled={generatingPlan}
              onClick={() => {
                setGeneratingPlan(true);
                setTimeout(() => {
                  setGeneratingPlan(false);
                  setGeneratedPlan(true);
                  setPlanAdopted(false);
                }, 700);
              }}
            >
              {generatingPlan ? (
                <RefreshCw className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {generatingPlan ? '生成中…' : '生成版本计划'}
            </Button>
          </div>
        }
      />
      {milestoneFocus && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
          <CalendarDays className="size-4" />
          从项目概览下钻：里程碑 <strong>{milestoneFocus}</strong>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto bg-white"
            onClick={onClearMilestoneFocus}
          >
            查看全部里程碑
          </Button>
        </div>
      )}
      <Card className="mb-5">
        <CardHeader className="border-b">
          <div>
            <CardTitle>
              {versionScope === 'portfolio'
                ? '并行版本进度趋势'
                : `${versionScopeLabels[versionScope]} 进度趋势`}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {versionScope === 'portfolio'
                ? `三条曲线按当前 ${tasksData.length} 项 WBS 任务实时重算；今天之前为实际，之后为 AI 滚动预测`
                : `${versionScopeLabels[versionScope]} 按计划工时、实际进度与阻塞状态动态计算`}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              alphaActual: { label: 'v0.9 Alpha 实际', color: '#2563eb' },
              alphaForecast: { label: 'v0.9 Alpha 预测', color: '#2563eb' },
              betaActual: { label: 'v1.0 Beta 实际', color: '#7c3aed' },
              betaForecast: { label: 'v1.0 Beta 预测', color: '#7c3aed' },
              growthActual: { label: 'v1.1 Growth 实际', color: '#f59e0b' },
              growthForecast: {
                label: 'v1.1 Growth 预测',
                color: '#f59e0b',
              },
            }}
            className="h-[280px] w-full aspect-auto"
          >
            <LineChart
              data={dynamicParallelProgress}
              margin={{ left: 0, right: 12, top: 18, bottom: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickLine={false}
                axisLine={false}
                unit="%"
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ReferenceLine
                x={currentDay}
                stroke="#64748b"
                strokeDasharray="3 3"
                label={{
                  value: '今天',
                  position: 'insideTopRight',
                  fill: '#64748b',
                  fontSize: 11,
                }}
              />
              {showAlpha && (
                <>
                  <Line
                    type="monotone"
                    dataKey="alphaActual"
                    stroke="#2563eb"
                    strokeWidth={3}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="alphaForecast"
                    stroke="#2563eb"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                  />
                </>
              )}
              {showBeta && (
                <>
                  <Line
                    type="monotone"
                    dataKey="betaActual"
                    stroke="#7c3aed"
                    strokeWidth={3}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="betaForecast"
                    stroke="#7c3aed"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                  />
                </>
              )}
              {showGrowth && (
                <>
                  <Line
                    type="monotone"
                    dataKey="growthActual"
                    stroke="#f59e0b"
                    strokeWidth={3}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="growthForecast"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                  />
                </>
              )}
            </LineChart>
          </ChartContainer>
          <div className="mt-2 flex flex-wrap justify-end gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
            {[
              ['v0.9 Alpha', 'bg-blue-600', 'v0.9'],
              ['v1.0 Beta', 'bg-violet-600', 'v1.0'],
              ['v1.1 Growth', 'bg-amber-500', 'v1.1'],
            ]
              .filter(
                ([, , scope]) =>
                  versionScope === 'portfolio' || versionScope === scope,
              )
              .map(([label, color]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className={`h-0.5 w-5 ${color}`} />
                  {label}
                </span>
              ))}
            <span className="flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed border-slate-400" />
              虚线为预测
            </span>
          </div>
        </CardContent>
      </Card>
      {generatedPlan && (
        <Card
          className={`mb-5 ${planAdopted ? 'border-emerald-200 bg-emerald-50/30' : 'border-blue-200 bg-blue-50/30'}`}
        >
          <CardHeader className="flex-row items-start justify-between border-b">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                AI 版本计划草案 · {versionScopeLabels[versionScope]}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                已结合各版本交付模式、任务依赖、成员负载、评审节奏、当前风险和中国工作日日历自动排期
              </p>
            </div>
            <StatusBadge value={planAdopted ? '已采纳' : '待确认'} />
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              <CalendarDays className="size-4" />
              <strong>中国工作日日历已启用</strong>
              <span>
                已跳过法定节假日 {calendarImpact.holidays} 天、常规周末{' '}
                {calendarImpact.weekends} 天；计入调休工作日{' '}
                {calendarImpact.makeupWorkdays} 天
              </span>
              <Badge variant="outline" className="ml-auto bg-white">
                国务院 2026 日历
              </Badge>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <strong className="text-foreground">版本计划口径：</strong>
              敏捷版本按 Sprint 与 DoD
              推进；瀑布版本按阶段门禁推进。版本执行开始后模式锁定，切换需经过影响分析并生成新基线。
            </div>
            <div className="overflow-x-auto rounded-xl border bg-background">
              <table className="w-full min-w-[1200px] text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    {[
                      '版本 / 范围',
                      '交付模式',
                      '开发周期',
                      '联调周期',
                      '提测时间',
                      '测试验收周期',
                      '发版时间',
                      '缓冲',
                      '主要风险',
                    ].map((header) => (
                      <th key={header} className="px-4 py-3 font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {generatedPlanGroups.map((group) => (
                    <tr key={group.scope} className="border-t align-top">
                      <td className="px-4 py-4">
                        <Badge>{versionScopeLabels[group.scope]}</Badge>
                        <p className="mt-2 max-w-[180px] text-muted-foreground">
                          {group.plan.scope}
                        </p>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className={
                            group.config.mode === 'waterfall'
                              ? 'border-amber-200 bg-amber-50 text-amber-800'
                              : 'border-blue-200 bg-blue-50 text-blue-800'
                          }
                        >
                          {group.config.label}
                        </Badge>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {group.config.mode === 'waterfall'
                            ? '六阶段顺序门禁'
                            : 'Sprint + DoD'}
                        </p>
                      </td>
                      <td className="px-4 py-4 font-medium whitespace-nowrap">
                        {group.plan.development}
                      </td>
                      <td className="px-4 py-4 font-medium whitespace-nowrap">
                        {group.plan.integration}
                      </td>
                      <td className="px-4 py-4 font-semibold whitespace-nowrap text-primary">
                        {group.plan.testEntry}
                      </td>
                      <td className="px-4 py-4 font-medium whitespace-nowrap">
                        {group.plan.testing}
                      </td>
                      <td className="px-4 py-4 font-semibold whitespace-nowrap">
                        {group.plan.release}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {group.plan.buffer}
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-rose-700">{group.plan.risk}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGeneratedPlan(false)}>
                关闭草案
              </Button>
              <Button
                disabled={planAdopted || savingPlan}
                onClick={saveGeneratedPlan}
              >
                {savingPlan ? (
                  <RefreshCw className="animate-spin" />
                ) : (
                  <ClipboardCheck />
                )}
                {savingPlan
                  ? '正在保存…'
                  : planAdopted
                    ? '已写入版本基线'
                    : '采纳并写入计划'}
              </Button>
            </div>
            {historyError && (
              <p className="mt-3 text-right text-xs text-rose-600">
                {historyError}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      <div className="space-y-5">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>
              {versionScope === 'portfolio'
                ? '并行版本时间轴'
                : `${versionScopeLabels[versionScope]} 时间轴`}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              每个版本独立展示需求评审、技术评审、用例评审、联调、提测和发布
            </p>
          </CardHeader>
          <CardContent className="space-y-7">
            {milestoneGroups.map((group) => (
              <section key={group.scope}>
                <div className="mb-3 flex items-center gap-2">
                  <Badge>{versionScopeLabels[group.scope]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {
                      group.items.filter((item) => item.state === '已完成')
                        .length
                    }{' '}
                    / {group.items.length} 已按期完成
                  </span>
                </div>
                <div className="overflow-x-auto pt-3 pb-2">
                  <div className="grid min-w-[960px] grid-cols-6 gap-3">
                    {group.items.map((milestone) => (
                      <div
                        key={`${group.scope}-${milestone.name}`}
                        className="relative border-t-2 border-muted pt-5"
                      >
                        <span
                          className={`absolute -top-2 left-1 size-4 rounded-full border-2 border-white ring-2 ring-background ${milestone.state === '有风险' ? 'bg-rose-500' : milestone.state === '已完成' ? 'bg-emerald-500' : milestone.state === '延迟完成' ? 'bg-amber-500' : 'bg-slate-300'}`}
                        />
                        <p className="text-sm font-semibold">
                          {milestone.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {milestone.date} · {milestone.owner}
                        </p>
                        <div className="mt-2">
                          <StatusBadge value={milestone.state} />
                        </div>
                        <Progress value={milestone.progress} className="mt-3" />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-2 h-7 px-2 text-[11px]"
                          onClick={() =>
                            setActualDraft({
                              version: group.scope,
                              milestone: milestone.name,
                              occurredAt: shanghaiNow().dateTime,
                              detail: '',
                            })
                          }
                        >
                          <Clock3 />
                          记录实际时间
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </CardContent>
        </Card>
        <div className="grid gap-5 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                关键路径
                <Badge variant="outline">
                  {versionScopeLabels[analysisScope]}
                </Badge>
                {versionScope === 'portfolio' && (
                  <Badge variant="secondary">组合关键版本</Badge>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {versionScope === 'portfolio'
                  ? 'AI 根据跨版本依赖、资源竞争与发布日期识别出的当前项目群关键链'
                  : '当前版本中决定最早发布日期的任务链'}
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {criticalPath.nodes.map((x, i) => (
                  <span key={x} className="contents">
                    <span className="rounded-lg border bg-muted/40 px-3 py-2 font-medium">
                      {x}
                    </span>
                    {i < criticalPath.nodes.length - 1 && <span>→</span>}
                  </span>
                ))}
              </div>
              <p className="mt-4 rounded-lg bg-rose-50 p-3 text-xs leading-5 text-rose-800">
                {criticalPath.note}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                AI 发布预测
                {versionScope !== 'portfolio' && (
                  <Badge variant="outline">
                    {versionScopeLabels[analysisScope]}
                  </Badge>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {versionScope === 'portfolio'
                  ? '并行版本分别预测，不使用混合概率'
                  : '基于当前进度、缺陷、资源负载和关键路径'}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {predictionScopes.map((scope) => (
                <section
                  key={scope}
                  className="rounded-lg border bg-muted/20 p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="outline">{versionScopeLabels[scope]}</Badge>
                    {versionScope === 'portfolio' &&
                      scope === analysisScope && (
                        <span className="text-[11px] font-medium text-rose-600">
                          当前组合关键版本
                        </span>
                      )}
                  </div>
                  <div className="space-y-2">
                    {predictionByVersion[scope].map((item) => (
                      <div key={item[0]} className="flex items-center text-sm">
                        <span>{item[0]}</span>
                        <strong className="ml-auto">{item[1]}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock3 className="size-5 text-primary" />
              版本计划历史与实际节点
            </DialogTitle>
            <DialogDescription>
              计划按不可变基线保存，实际时间按事件追加，用于后续偏差和风险分析。
            </DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="flex justify-center gap-2 py-16 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" /> 正在读取 D1
              历史数据…
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">版本计划基线</h3>
                    <p className="text-xs text-muted-foreground">
                      每次采纳生成新快照，不覆盖旧计划
                    </p>
                  </div>
                  <Badge variant="outline">
                    {storedBaselines.length} 个快照
                  </Badge>
                </div>
                <div className="space-y-3">
                  {storedBaselines
                    .filter(
                      (item) =>
                        versionScope === 'portfolio' ||
                        item.version_id === versionScope,
                    )
                    .map((item) => {
                      const snapshot = parseStoredPlan(item.snapshot_json);
                      return (
                        <div key={item.id} className="rounded-xl border p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge>{versionScopeLabels[item.version_id]}</Badge>
                            <strong className="text-sm">
                              {item.baseline_key} · {item.label}
                            </strong>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {item.created_at}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
                            {[
                              ['开发', snapshot.development],
                              ['联调', snapshot.integration],
                              ['提测', snapshot.testEntry],
                              ['测试', snapshot.testing],
                              ['发版', snapshot.release],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="rounded-lg bg-muted/50 p-2"
                              >
                                <p className="text-muted-foreground">{label}</p>
                                <p className="mt-1 font-medium">
                                  {value ?? '—'}
                                </p>
                              </div>
                            ))}
                          </div>
                          {snapshot.reason && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              变更原因：{snapshot.reason}
                            </p>
                          )}
                        </div>
                      );
                    })}
                </div>
              </section>
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">实际完成事件</h3>
                    <p className="text-xs text-muted-foreground">
                      保留发生时间、来源和偏差说明
                    </p>
                  </div>
                  <Badge variant="outline">{storedEvents.length} 条记录</Badge>
                </div>
                <div className="space-y-2">
                  {storedEvents
                    .filter(
                      (event) =>
                        event.event_type === 'actual' &&
                        (versionScope === 'portfolio' ||
                          event.version_id === versionScope),
                    )
                    .map((event) => (
                      <div key={event.id} className="rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full bg-emerald-500" />
                          <strong className="text-sm">
                            {event.milestone_key}
                          </strong>
                          <Badge variant="outline" className="ml-auto">
                            {event.version_id}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs">
                          实际完成：
                          <strong>
                            {formatMilestoneDateTime(event.occurred_at)}
                          </strong>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {event.detail || '无备注'} · 来源{' '}
                          {event.source_system}
                        </p>
                      </div>
                    ))}
                </div>
              </section>
            </div>
          )}
          {historyError && (
            <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              {historyError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={loadPlanHistory}>
              <RefreshCw /> 刷新记录
            </Button>
            <Button onClick={() => setHistoryOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(actualDraft)}
        onOpenChange={(open) => !open && setActualDraft(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>记录实际完成时间</DialogTitle>
            <DialogDescription>
              {actualDraft
                ? `${versionScopeLabels[actualDraft.version]} · ${actualDraft.milestone}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {actualDraft && (
            <div className="space-y-3">
              <Input
                type="datetime-local"
                aria-label="实际完成日期与时间"
                value={actualDraft.occurredAt}
                onChange={(event) =>
                  setActualDraft({
                    ...actualDraft,
                    occurredAt: event.target.value,
                  })
                }
              />
              <Textarea
                placeholder="完成说明或偏差原因"
                value={actualDraft.detail}
                onChange={(event) =>
                  setActualDraft({ ...actualDraft, detail: event.target.value })
                }
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActualDraft(null)}>
              取消
            </Button>
            <Button
              disabled={savingActual || !actualDraft?.occurredAt}
              onClick={saveMilestoneActual}
            >
              {savingActual ? (
                <RefreshCw className="animate-spin" />
              ) : (
                <Clock3 />
              )}
              {savingActual ? '正在保存…' : '保存实际时间'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
