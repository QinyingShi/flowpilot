'use client';
/* oxlint-disable next/no-html-link-for-pages */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Bell,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  FileChartColumn,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  Link2,
  ListTree,
  LogIn,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Users,
  UserRoundCog,
  WandSparkles,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import {
  WorkspaceConnectionBadge,
  WorkspaceFallbackAlert,
  type WorkspaceSourceState,
} from '@/components/workspace-connection-status';
import { SectionTitle } from '@/components/section-title';
import { StatusBadge } from '@/components/status-badge';
import {
  requireTaskRecords,
  type TaskPriority,
  type TaskRecord,
} from '@/lib/task-model';
import { createRecordId } from '@/lib/record-id';
import type {
  ProjectSummary,
  WorkspaceMemberSummary,
} from '@/components/views/project-center-view';
import {
  addCalendarDays,
  isoDateToMonthDay,
  shanghaiNow,
} from '@/lib/shanghai-time';

type View =
  | '项目中心'
  | '项目概览'
  | '我的工作'
  | 'WBS与任务'
  | '计划与里程碑'
  | '资源与负载'
  | '风险与变更'
  | '版本与报告'
  | '会议协同'
  | '集成与自动化'
  | '成员与权限';

const nav: { label: View; icon: LucideIcon }[] = [
  { label: '项目中心', icon: FolderKanban },
  { label: '项目概览', icon: LayoutDashboard },
  { label: '我的工作', icon: ClipboardCheck },
  { label: 'WBS与任务', icon: ListTree },
  { label: '计划与里程碑', icon: CalendarDays },
  { label: '资源与负载', icon: Users },
  { label: '风险与变更', icon: ShieldAlert },
  { label: '版本与报告', icon: FileChartColumn },
  { label: '会议协同', icon: Users },
  { label: '集成与自动化', icon: Link2 },
  { label: '成员与权限', icon: Settings },
];

const GovernanceView = lazy(() => import('@/components/views/governance-view'));
const ProjectCenterView = lazy(
  () => import('@/components/views/project-center-view'),
);
const IntegrationView = lazy(
  () => import('@/components/views/integration-view'),
);
const MyWorkView = lazy(() => import('@/components/views/my-work-view'));
const ReportsView = lazy(() => import('@/components/views/reports-view'));
const MeetingsView = lazy(() => import('@/components/views/meetings-view'));
const PlanView = lazy(() => import('@/components/views/plan-view'));
const WbsView = lazy(() => import('@/components/views/wbs-view'));

type VersionScope = 'portfolio' | 'v0.9' | 'v1.0' | 'v1.1';
type VersionId = Exclude<VersionScope, 'portfolio'>;
const subscribeToClient = () => () => undefined;
type DeliveryMode = 'agile' | 'waterfall';

function suggestedChangeTarget(sourceVersion: VersionId): VersionId {
  return sourceVersion === 'v0.9' ? 'v1.0' : 'v1.1';
}

type WorkspaceUser = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'project_manager' | 'member' | 'viewer';
};
type DevelopmentIdentity = Omit<WorkspaceUser, 'role'>;
type ProjectPermissionRecord = {
  member_id: string;
  project_id: string;
  permission: 'manage_version' | 'approve_change' | 'approve_release';
  version_id: VersionId | '*';
  created_at: string;
};

type InspectionFinding = {
  fingerprint: string;
  finding_type: 'progress' | 'resource' | 'risk';
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  owner: string;
  recommendation: string;
  status: 'open' | 'acknowledged' | 'resolved';
};

type VersionConfig = {
  version: Exclude<VersionScope, 'portfolio'>;
  mode: DeliveryMode;
  label: string;
  locked: boolean;
  releaseDate?: string;
};

const defaultVersionConfigs: VersionConfig[] = [
  { version: 'v0.9', mode: 'waterfall', label: '传统瀑布', locked: true },
  { version: 'v1.0', mode: 'agile', label: '敏捷迭代', locked: true },
  { version: 'v1.1', mode: 'agile', label: '敏捷迭代', locked: true },
];

type StoredPlanSnapshot = {
  development?: string;
  integration?: string;
  testEntry?: string;
  testing?: string;
  release?: string;
  reason?: string;
};

function parseStoredPlan(value: string): StoredPlanSnapshot {
  try {
    return JSON.parse(value) as StoredPlanSnapshot;
  } catch {
    return {};
  }
}

const versionScopeLabels: Record<VersionScope, string> = {
  portfolio: '并行版本总览',
  'v0.9': 'v0.9 Alpha',
  'v1.0': 'v1.0 Beta',
  'v1.1': 'v1.1 Growth',
};

const chinaHolidays2026 = new Set([
  '2026-01-01',
  '2026-01-02',
  '2026-01-03',
  '2026-02-15',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-21',
  '2026-02-22',
  '2026-02-23',
  '2026-04-04',
  '2026-04-05',
  '2026-04-06',
  '2026-05-01',
  '2026-05-02',
  '2026-05-03',
  '2026-05-04',
  '2026-05-05',
  '2026-06-19',
  '2026-06-20',
  '2026-06-21',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
]);

const chinaMakeupWorkdays2026 = new Set([
  '2026-01-04',
  '2026-02-14',
  '2026-02-28',
  '2026-05-09',
  '2026-09-20',
  '2026-10-10',
]);

const versionPlanSettings: Record<
  VersionScope,
  {
    version: Exclude<VersionScope, 'portfolio'>;
    start: string;
    offsets: number[];
  }
> = {
  portfolio: {
    version: 'v1.0',
    start: '2026-09-02',
    offsets: [1, 3, 6, 11, 13, 20],
  },
  'v0.9': {
    version: 'v0.9',
    start: '2026-08-19',
    offsets: [1, 3, 6, 10, 13, 18],
  },
  'v1.0': {
    version: 'v1.0',
    start: '2026-09-02',
    offsets: [1, 3, 6, 11, 13, 20],
  },
  'v1.1': {
    version: 'v1.1',
    start: '2026-09-17',
    offsets: [1, 3, 7, 12, 15, 20],
  },
};

const versionReleasePlans: Record<
  Exclude<VersionScope, 'portfolio'>,
  {
    scope: string;
    development: string;
    integration: string;
    testEntry: string;
    testing: string;
    release: string;
    buffer: string;
    risk: string;
  }
> = {
  'v0.9': {
    scope: '核心会员与订单闭环',
    development: '08/20–09/02',
    integration: '09/03–09/04',
    testEntry: '09/06',
    testing: '09/06–09/11',
    release: '09/14',
    buffer: '2 个工作日',
    risk: '遗留缺陷关闭',
  },
  'v1.0': {
    scope: '支付、数据看板、运营配置',
    development: '09/03–09/17',
    integration: '09/18–09/24',
    testEntry: '09/28',
    testing: '09/28–09/29',
    release: '09/30',
    buffer: '1 个工作日',
    risk: '支付沙箱与测试负载',
  },
  'v1.1': {
    scope: '营销规则与自动化触达',
    development: '09/18–09/30',
    integration: '10/08–10/12',
    testEntry: '10/13',
    testing: '10/13–10/19',
    release: '10/20',
    buffer: '3 个工作日',
    risk: '共享测试资源归还',
  },
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function isChinaWorkday(date: Date) {
  const key = dateKey(date);
  if (chinaMakeupWorkdays2026.has(key)) return true;
  if (chinaHolidays2026.has(key)) return false;
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function addChinaWorkdays(start: string, workdays: number) {
  const date = parseDate(start);
  let completed = 0;
  while (completed < workdays) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isChinaWorkday(date)) completed += 1;
  }
  return date;
}

function getCalendarImpact(start: string, end: Date) {
  const cursor = parseDate(start);
  const impact = { holidays: 0, weekends: 0, makeupWorkdays: 0 };
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const key = dateKey(cursor);
    if (chinaMakeupWorkdays2026.has(key)) impact.makeupWorkdays += 1;
    else if (chinaHolidays2026.has(key)) impact.holidays += 1;
    else if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6)
      impact.weekends += 1;
  }
  return impact;
}

const versionMetrics: Record<
  VersionScope,
  {
    progress: string;
    progressNote: string;
    milestones: string;
    milestoneNote: string;
    effort: string;
    effortNote: string;
    health: number;
    pulse: string;
  }
> = {
  portfolio: {
    progress: '54%',
    progressNote: '按计划工时加权 · 计划 58%',
    milestones: '11 / 18',
    milestoneNote: '3 个版本并行 · 1 个存在风险',
    effort: '2,146h',
    effortNote: '跨版本共享资源冲突 2 项',
    health: 76,
    pulse:
      'v1.0 关键路径落后 4%，并占用 v1.1 的测试资源；建议先保障 09月27日 Beta 发布。',
  },
  'v0.9': {
    progress: '92%',
    progressNote: '计划 94% · 落后 2%',
    milestones: '4 / 5',
    milestoneNote: 'Alpha 验收还有 3 天',
    effort: '516h',
    effortNote: '剩余验收投入 42h',
    health: 88,
    pulse: 'Alpha 已进入验收，主要关注遗留缺陷关闭率，不建议再扩大版本范围。',
  },
  'v1.0': {
    progress: '68%',
    progressNote: '计划 72% · 落后 4%',
    milestones: '7 / 10',
    milestoneNote: '下个节点还有 8 天',
    effort: '1,284h',
    effortNote: '本月可用 1,520h',
    health: 78,
    pulse:
      '支付联调落后 4%，建议今天确认备选网关，并从 v1.1 调配 24 小时测试资源。',
  },
  'v1.1': {
    progress: '8%',
    progressNote: '计划 10% · 落后 2%',
    milestones: '0 / 3',
    milestoneNote: '需求冻结还有 12 天',
    effort: '346h',
    effortNote: '24h 测试资源可能被 v1.0 占用',
    health: 72,
    pulse:
      '需求仍在收敛，且共享测试资源受 v1.0 挤占；建议冻结 P0，P1 进入下一版本池。',
  },
};

type ProgressPoint = {
  day: string;
  plan: number;
  actual: number | null;
  forecast: number | null;
};

function monthDay(date = new Date()) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function formatMilestoneDateTime(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value.replaceAll('-', '/')}（未记录时分）`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

const currentDay = monthDay();

function scheduleTimestamp(day: string) {
  const [month, date] = day.split('/').map(Number);
  return new Date(2026, month - 1, date).getTime();
}

function trendWithCurrentDay(points: ProgressPoint[]) {
  if (points.some((point) => point.day === currentDay)) return points;
  const currentTime = scheduleTimestamp(currentDay);
  const previous = [...points]
    .reverse()
    .find((point) => scheduleTimestamp(point.day) < currentTime);
  const next = points.find(
    (point) => scheduleTimestamp(point.day) > currentTime,
  );
  if (!previous || !next) return points;
  const ratio =
    (currentTime - scheduleTimestamp(previous.day)) /
    (scheduleTimestamp(next.day) - scheduleTimestamp(previous.day));
  const interpolate = (start: number, end: number) =>
    Math.round(start + (end - start) * ratio);
  const previousActual = previous.actual ?? previous.forecast ?? previous.plan;
  const nextActual = next.forecast ?? next.plan;
  const currentPoint: ProgressPoint = {
    day: currentDay,
    plan: interpolate(previous.plan, next.plan),
    actual: interpolate(previousActual, nextActual),
    forecast: interpolate(previousActual, nextActual),
  };
  return [...points, currentPoint].sort(
    (a, b) => scheduleTimestamp(a.day) - scheduleTimestamp(b.day),
  );
}

function taskEffort(task: TaskRecord) {
  const parsed = Number(task[10]?.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

function progressTimelineDays(tasksData: TaskRecord[]) {
  if (!tasksData.length) return [currentDay];
  const timestamps = tasksData.flatMap((task) => [
    scheduleTimestamp(task[7]),
    scheduleTimestamp(task[8]),
  ]);
  const start = Math.min(...timestamps);
  const end = Math.max(...timestamps, scheduleTimestamp(currentDay));
  const totalDays = Math.max(1, Math.round((end - start) / 86_400_000));
  const step = Math.max(1, Math.ceil(totalDays / 16));
  const values = new Set<string>([currentDay]);
  for (let offset = 0; offset <= totalDays; offset += step) {
    values.add(monthDay(new Date(start + offset * 86_400_000)));
  }
  values.add(monthDay(new Date(end)));
  tasksData.forEach((task) => {
    values.add(task[7]);
    values.add(task[8]);
  });
  return [...values].sort(
    (left, right) => scheduleTimestamp(left) - scheduleTimestamp(right),
  );
}

function buildTaskProgressTrend(
  tasksData: TaskRecord[],
  scope: VersionScope,
  forcedDays?: string[],
): ProgressPoint[] {
  const scoped =
    scope === 'portfolio'
      ? tasksData
      : tasksData.filter((task) => task[3] === scope);
  if (!scoped.length) return trendWithCurrentDay(trendByVersion[scope]);
  const days = forcedDays ?? progressTimelineDays(scoped);
  const todayTime = scheduleTimestamp(currentDay);
  const totalEffort = Math.max(
    1,
    scoped.reduce((sum, task) => sum + taskEffort(task), 0),
  );
  const weightedPercent = (
    dayTime: number,
    mode: 'plan' | 'actual' | 'forecast',
  ) =>
    Math.round(
      (scoped.reduce((sum, task) => {
        const start = scheduleTimestamp(task[7]);
        const end = Math.max(start + 86_400_000, scheduleTimestamp(task[8]));
        const effort = taskEffort(task);
        const progress = Math.min(
          1,
          Math.max(0, Number(task[9]?.replace('%', '')) / 100),
        );
        let completion = 0;
        if (mode === 'plan') {
          completion =
            dayTime < start
              ? 0
              : dayTime >= end
                ? 1
                : (dayTime - start) / (end - start);
        } else if (mode === 'actual') {
          const observedEnd = Math.max(
            start + 86_400_000,
            Math.min(todayTime, end),
          );
          completion =
            dayTime < start
              ? 0
              : dayTime >= todayTime
                ? progress
                : progress *
                  Math.min(1, (dayTime - start) / (observedEnd - start));
        } else {
          const delayDays =
            task[5] === '有阻塞' ? 3 : task[12] === '高' ? 1 : 0;
          const forecastEnd = end + delayDays * 86_400_000;
          const forecastStart = Math.max(todayTime, start);
          completion =
            dayTime <= todayTime
              ? progress
              : dayTime >= forecastEnd
                ? 1
                : forecastEnd <= forecastStart
                  ? 1
                  : progress +
                    (1 - progress) *
                      Math.max(
                        0,
                        (dayTime - forecastStart) /
                          (forecastEnd - forecastStart),
                      );
        }
        return sum + effort * Math.min(1, Math.max(0, completion));
      }, 0) /
        totalEffort) *
        100,
    );
  return days.map((day) => {
    const dayTime = scheduleTimestamp(day);
    const actual = weightedPercent(dayTime, 'actual');
    return {
      day,
      plan: weightedPercent(dayTime, 'plan'),
      actual: dayTime <= todayTime ? actual : null,
      forecast:
        dayTime >= todayTime ? weightedPercent(dayTime, 'forecast') : null,
    };
  });
}

function buildParallelTaskProgress(tasksData: TaskRecord[]) {
  const days = progressTimelineDays(tasksData);
  const alpha = buildTaskProgressTrend(tasksData, 'v0.9', days);
  const beta = buildTaskProgressTrend(tasksData, 'v1.0', days);
  const growth = buildTaskProgressTrend(tasksData, 'v1.1', days);
  return days.map((day, index) => ({
    day,
    alphaActual: alpha[index].actual,
    alphaForecast: alpha[index].forecast,
    betaActual: beta[index].actual,
    betaForecast: beta[index].forecast,
    growthActual: growth[index].actual,
    growthForecast: growth[index].forecast,
  }));
}

const trendByVersion: Record<VersionScope, ProgressPoint[]> = {
  portfolio: [
    { day: '08/20', plan: 0, actual: 0, forecast: null },
    { day: '08/28', plan: 14, actual: 13, forecast: null },
    { day: '09/06', plan: 30, actual: 28, forecast: null },
    { day: '09/10', plan: 40, actual: 36, forecast: 36 },
    { day: '09/18', plan: 56, actual: null, forecast: 49 },
    { day: '09/27', plan: 72, actual: null, forecast: 63 },
    { day: '10/08', plan: 88, actual: null, forecast: 78 },
    { day: '10/18', plan: 100, actual: null, forecast: 91 },
    { day: '10/20', plan: 100, actual: null, forecast: 100 },
  ],
  'v0.9': [
    { day: '08/20', plan: 0, actual: 0, forecast: null },
    { day: '08/24', plan: 18, actual: 16, forecast: null },
    { day: '08/28', plan: 42, actual: 40, forecast: null },
    { day: '09/02', plan: 65, actual: 61, forecast: null },
    { day: '09/06', plan: 82, actual: 78, forecast: null },
    { day: '09/10', plan: 94, actual: 92, forecast: 92 },
    { day: '09/13', plan: 100, actual: null, forecast: 100 },
  ],
  'v1.0': [
    { day: '09/03', plan: 0, actual: 0, forecast: null },
    { day: '09/06', plan: 12, actual: 11, forecast: null },
    { day: '09/10', plan: 32, actual: 28, forecast: 28 },
    { day: '09/14', plan: 48, actual: null, forecast: 42 },
    { day: '09/18', plan: 66, actual: null, forecast: 55 },
    { day: '09/22', plan: 84, actual: null, forecast: 72 },
    { day: '09/27', plan: 100, actual: null, forecast: 88 },
    { day: '09/30', plan: 100, actual: null, forecast: 100 },
  ],
  'v1.1': [
    { day: '09/10', plan: 10, actual: 8, forecast: 8 },
    { day: '09/15', plan: 20, actual: null, forecast: 16 },
    { day: '09/22', plan: 38, actual: null, forecast: 30 },
    { day: '10/02', plan: 58, actual: null, forecast: 48 },
    { day: '10/08', plan: 72, actual: null, forecast: 61 },
    { day: '10/13', plan: 88, actual: null, forecast: 76 },
    { day: '10/18', plan: 100, actual: null, forecast: 91 },
    { day: '10/20', plan: 100, actual: null, forecast: 100 },
  ],
};

const milestones = [
  {
    name: '需求评审',
    version: 'v0.9',
    date: '08月20日',
    owner: '林夏',
    state: '已完成',
    progress: 100,
  },
  {
    name: '技术评审',
    version: 'v0.9',
    date: '08月23日',
    owner: '王璟',
    state: '已完成',
    progress: 100,
  },
  {
    name: '用例评审',
    version: 'v0.9',
    date: '08月28日',
    owner: '周琪',
    state: '已完成',
    progress: 100,
  },
  {
    name: '联合联调',
    version: 'v0.9',
    date: '09月04日',
    owner: '王璟',
    state: '延迟完成',
    progress: 100,
  },
  {
    name: '提测',
    version: 'v0.9',
    date: '09月06日',
    owner: '赵一',
    state: '已完成',
    progress: 100,
  },
  {
    name: 'Alpha 发布',
    version: 'v0.9',
    date: '09月14日',
    owner: '林夏',
    state: '有风险',
    progress: 92,
  },
  {
    name: '需求评审',
    version: 'v1.0',
    date: '09月03日',
    owner: '林夏',
    state: '已完成',
    progress: 100,
  },
  {
    name: '技术评审',
    version: 'v1.0',
    date: '09月07日',
    owner: '陈默',
    state: '延迟完成',
    progress: 100,
  },
  {
    name: '用例评审',
    version: 'v1.0',
    date: '09月11日',
    owner: '周琪',
    state: '有风险',
    progress: 76,
  },
  {
    name: '联合联调',
    version: 'v1.0',
    date: '09月21日',
    owner: '陈默',
    state: '有风险',
    progress: 64,
  },
  {
    name: '提测',
    version: 'v1.0',
    date: '09月24日',
    owner: '赵一',
    state: '有风险',
    progress: 35,
  },
  {
    name: 'Beta 发布',
    version: 'v1.0',
    date: '09月30日',
    owner: '周琪',
    state: '有风险',
    progress: 42,
  },
  {
    name: '需求评审',
    version: 'v1.1',
    date: '09月18日',
    owner: '林夏',
    state: '待开始',
    progress: 18,
  },
  {
    name: '技术评审',
    version: 'v1.1',
    date: '09月21日',
    owner: '韩策',
    state: '待开始',
    progress: 10,
  },
  {
    name: '用例评审',
    version: 'v1.1',
    date: '09月28日',
    owner: '赵一',
    state: '待开始',
    progress: 0,
  },
  {
    name: '联合联调',
    version: 'v1.1',
    date: '10月08日',
    owner: '宋扬',
    state: '待开始',
    progress: 0,
  },
  {
    name: '提测',
    version: 'v1.1',
    date: '10月13日',
    owner: '周琪',
    state: '待开始',
    progress: 0,
  },
  {
    name: 'Growth 发布',
    version: 'v1.1',
    date: '10月20日',
    owner: '杨帆',
    state: '有风险',
    progress: 8,
  },
];
const tasks: TaskRecord[] = [
  [
    '0.1',
    'Alpha 产品需求评审',
    '星云客户平台',
    'v0.9',
    '林夏',
    '已完成',
    '高',
    '08/20',
    '08/20',
    '100%',
    '12h',
    '—',
    '低',
  ],
  [
    '0.2',
    '核心会员流程原型',
    '星云客户平台',
    'v0.9',
    '苏禾',
    '已完成',
    '高',
    '08/20',
    '08/24',
    '100%',
    '32h',
    '0.1',
    '低',
  ],
  [
    '0.3',
    '会员服务 API 初版',
    '星云客户平台',
    'v0.9',
    '王璟、方宁',
    '已完成',
    '高',
    '08/23',
    '09/02',
    '100%',
    '96h',
    '0.1',
    '低',
  ],
  [
    '0.4',
    'Alpha 前后端联合联调',
    '星云客户平台',
    'v0.9',
    '王璟、顾言、赵一',
    '已完成',
    '高',
    '09/03',
    '09/04',
    '100%',
    '48h',
    '0.2、0.3',
    '中',
  ],
  [
    '0.5',
    'Alpha 验收与遗留缺陷关闭',
    '星云客户平台',
    'v0.9',
    '林夏、周琪',
    '进行中',
    '高',
    '09/05',
    '09/13',
    '92%',
    '56h',
    '0.4',
    '中',
  ],
  [
    '1.1',
    '用户旅程与需求基线',
    '星云客户平台',
    'v0.9',
    '林夏',
    '已完成',
    '高',
    '09/01',
    '09/05',
    '100%',
    '40h',
    '—',
    '低',
  ],
  [
    '1.2',
    '会员中心交互设计',
    '星云客户平台',
    'v1.0',
    '苏禾',
    '进行中',
    '高',
    '09/04',
    '09/12',
    '78%',
    '56h',
    '1.1',
    '低',
  ],
  [
    '2.1',
    '订单服务 API 改造',
    '星云客户平台',
    'v1.0',
    '陈默',
    '有阻塞',
    '高',
    '09/06',
    '09/16',
    '62%',
    '88h',
    '1.1',
    '高',
  ],
  [
    '2.2',
    '支付网关联调',
    '星云客户平台',
    'v1.0',
    '赵一',
    '有阻塞',
    '高',
    '09/10',
    '09/18',
    '35%',
    '64h',
    '2.1',
    '高',
  ],
  [
    '3.1',
    '数据看板指标模型',
    '增长数据中台',
    'v1.0',
    '许清',
    '进行中',
    '中',
    '09/08',
    '09/20',
    '48%',
    '72h',
    '1.1',
    '中',
  ],
  [
    '3.2',
    '回归测试与验收',
    '增长数据中台',
    'v1.0',
    '周琪',
    '未开始',
    '中',
    '09/19',
    '09/26',
    '0%',
    '80h',
    '2.2',
    '中',
  ],
  [
    '1.3',
    '收银台前端流程改造',
    '星云客户平台',
    'v1.0',
    '顾言',
    '进行中',
    '高',
    '09/06',
    '09/16',
    '70%',
    '80h',
    '1.2',
    '中',
  ],
  [
    '1.4',
    '订单领域服务拆分',
    '星云客户平台',
    'v1.0',
    '宋扬',
    '进行中',
    '高',
    '09/06',
    '09/15',
    '66%',
    '72h',
    '1.1',
    '中',
  ],
  [
    '2.3',
    '支付回调幂等与补偿',
    '星云客户平台',
    'v1.0',
    '陈默、方宁',
    '进行中',
    '高',
    '09/10',
    '09/17',
    '55%',
    '64h',
    '2.1',
    '高',
  ],
  [
    '2.4',
    '支付链路多系统联合联调',
    '星云客户平台',
    'v1.0',
    '陈默、宋扬、顾言、赵一',
    '有阻塞',
    '高',
    '09/14',
    '09/19',
    '38%',
    '128h',
    '1.3、1.4、2.2、2.3',
    '高',
  ],
  [
    '2.5',
    '支付性能压测与容量评估',
    '星云客户平台',
    'v1.0',
    '陈默、赵一',
    '未开始',
    '高',
    '09/19',
    '09/22',
    '0%',
    '48h',
    '2.4',
    '高',
  ],
  [
    '3.3',
    '运营配置后台开发',
    '星云客户平台',
    'v1.0',
    '陆川',
    '进行中',
    '中',
    '09/08',
    '09/18',
    '58%',
    '72h',
    '1.2',
    '低',
  ],
  [
    '3.4',
    '经营数据看板前端开发',
    '增长数据中台',
    'v1.0',
    '唐禾',
    '进行中',
    '中',
    '09/09',
    '09/20',
    '52%',
    '88h',
    '3.1',
    '中',
  ],
  [
    '3.5',
    '指标服务与看板联合联调',
    '增长数据中台',
    'v1.0',
    '许清、韩策、唐禾',
    '有阻塞',
    '高',
    '09/18',
    '09/22',
    '24%',
    '72h',
    '3.1、3.4',
    '高',
  ],
  [
    '3.6',
    '全链路回归与缺陷清零',
    '星云客户平台',
    'v1.0',
    '周琪、赵一',
    '未开始',
    '高',
    '09/22',
    '09/26',
    '0%',
    '112h',
    '2.4、3.5',
    '高',
  ],
  [
    '3.7',
    'Beta 发布检查与灰度验证',
    '星云客户平台',
    'v1.0',
    '林夏、陈默、顾言、赵一',
    '未开始',
    '高',
    '09/26',
    '09/27',
    '0%',
    '40h',
    '2.5、3.6',
    '中',
  ],
  [
    '4.1',
    '营销规则与自动触达',
    '星云客户平台',
    'v1.1',
    '林夏',
    '未开始',
    '中',
    '09/22',
    '10/10',
    '0%',
    '96h',
    '1.2',
    '中',
  ],
  [
    '4.2',
    '营销规则引擎升级',
    '增长数据中台',
    'v1.1',
    '韩策',
    '进行中',
    '高',
    '09/18',
    '10/02',
    '18%',
    '96h',
    '4.1',
    '中',
  ],
  [
    '4.3',
    '会员权益服务重构',
    '星云客户平台',
    'v1.1',
    '王璟、方宁',
    '未开始',
    '高',
    '09/22',
    '10/05',
    '0%',
    '112h',
    '4.1',
    '中',
  ],
  [
    '4.4',
    '营销活动页面与组件',
    '星云客户平台',
    'v1.1',
    '陆川',
    '未开始',
    '中',
    '09/24',
    '10/06',
    '0%',
    '80h',
    '4.1',
    '低',
  ],
  [
    '4.5',
    '自动触达服务开发',
    '星云客户平台',
    'v1.1',
    '宋扬',
    '未开始',
    '中',
    '09/25',
    '10/07',
    '0%',
    '88h',
    '4.2',
    '中',
  ],
  [
    '4.6',
    '营销链路多人联合联调',
    '星云客户平台',
    'v1.1',
    '韩策、王璟、宋扬、陆川、周琪',
    '未开始',
    '高',
    '10/06',
    '10/11',
    '0%',
    '136h',
    '4.2、4.3、4.4、4.5',
    '中',
  ],
  [
    '4.7',
    '增长场景回归与数据核对',
    '增长数据中台',
    'v1.1',
    '许清、赵一、周琪',
    '未开始',
    '高',
    '10/11',
    '10/16',
    '0%',
    '96h',
    '4.6',
    '中',
  ],
  [
    '4.8',
    'Growth 灰度发布与指标观察',
    '星云客户平台',
    'v1.1',
    '林夏、韩策、陆川、许清',
    '未开始',
    '高',
    '10/17',
    '10/18',
    '0%',
    '48h',
    '4.7',
    '中',
  ],
];
type ResourceRecord = {
  name: string;
  role: string;
  level: string;
  project: string;
  load: number;
  available: number;
  allocation: Record<Exclude<VersionScope, 'portfolio'>, number>;
  skills: string[];
  domains: string[];
  risk: string;
  memberStatus?: '在职' | '新入职' | '离职待交接' | '已离职';
  source?: string;
  joinedAt?: string;
  statusChangedAt?: string;
};

const resources: ResourceRecord[] = [
  {
    name: '陈默',
    role: '后端开发',
    level: '资深 · P7',
    project: '星云客户平台',
    load: 118,
    available: 0,
    allocation: { 'v0.9': 24, 'v1.0': 86, 'v1.1': 8 },
    skills: ['Java', '支付网关', '高并发'],
    domains: ['订单域', '支付域'],
    risk: '支付域单点',
  },
  {
    name: '王璟',
    role: '后端开发',
    level: '高级 · P6',
    project: '星云客户平台',
    load: 84,
    available: 24,
    allocation: { 'v0.9': 12, 'v1.0': 58, 'v1.1': 14 },
    skills: ['Java', 'Spring Cloud', '会员服务'],
    domains: ['会员域', '权益域'],
    risk: '',
  },
  {
    name: '宋扬',
    role: '后端开发',
    level: '中级 · P5',
    project: '星云客户平台',
    load: 72,
    available: 36,
    allocation: { 'v0.9': 10, 'v1.0': 42, 'v1.1': 20 },
    skills: ['Go', '接口适配', '消息队列'],
    domains: ['订单域', '集成平台'],
    risk: '',
  },
  {
    name: '韩策',
    role: '后端开发',
    level: '高级 · P6',
    project: '增长数据中台',
    load: 91,
    available: 14,
    allocation: { 'v0.9': 8, 'v1.0': 52, 'v1.1': 31 },
    skills: ['Python', '数据服务', '规则引擎'],
    domains: ['营销域', '指标平台'],
    risk: '规则引擎主责',
  },
  {
    name: '方宁',
    role: '后端开发',
    level: '初级 · P4',
    project: '星云客户平台',
    load: 66,
    available: 42,
    allocation: { 'v0.9': 6, 'v1.0': 38, 'v1.1': 22 },
    skills: ['Java', '单元测试', '运营配置'],
    domains: ['配置中心', '会员域'],
    risk: '',
  },
  {
    name: '顾言',
    role: '前端开发',
    level: '资深 · P7',
    project: '星云客户平台',
    load: 96,
    available: 8,
    allocation: { 'v0.9': 18, 'v1.0': 64, 'v1.1': 14 },
    skills: ['React', '微前端', '性能优化'],
    domains: ['会员中心', '收银台'],
    risk: '收银台单点',
  },
  {
    name: '唐禾',
    role: '前端开发',
    level: '高级 · P6',
    project: '增长数据中台',
    load: 78,
    available: 30,
    allocation: { 'v0.9': 8, 'v1.0': 48, 'v1.1': 22 },
    skills: ['React', '数据可视化', 'ECharts'],
    domains: ['数据看板', '运营后台'],
    risk: '',
  },
  {
    name: '陆川',
    role: '前端开发',
    level: '中级 · P5',
    project: '星云客户平台',
    load: 69,
    available: 39,
    allocation: { 'v0.9': 10, 'v1.0': 36, 'v1.1': 23 },
    skills: ['Vue', 'React', '组件库'],
    domains: ['营销活动', '移动端'],
    risk: '',
  },
  {
    name: '赵一',
    role: '测试工程师',
    level: '高级 · P6',
    project: '3 个项目',
    load: 112,
    available: 0,
    allocation: { 'v0.9': 18, 'v1.0': 82, 'v1.1': 12 },
    skills: ['接口自动化', '性能测试', '质量门禁'],
    domains: ['支付域', '订单域'],
    risk: '持续过载',
  },
  {
    name: '周琪',
    role: '测试工程师',
    level: '中级 · P5',
    project: '星云客户平台',
    load: 74,
    available: 34,
    allocation: { 'v0.9': 20, 'v1.0': 40, 'v1.1': 14 },
    skills: ['回归测试', 'Web自动化', '验收测试'],
    domains: ['会员域', '运营后台'],
    risk: '',
  },
  {
    name: '许清',
    role: '数据开发',
    level: '高级 · P6',
    project: '增长数据中台',
    load: 84,
    available: 26,
    allocation: { 'v0.9': 8, 'v1.0': 54, 'v1.1': 22 },
    skills: ['SQL', '指标模型', '数据质量'],
    domains: ['指标平台', '用户画像'],
    risk: '',
  },
];

const resourceMatchScenarios = {
  payment: {
    label: '支付网关接口改造',
    role: '后端开发',
    needs: ['Java', '支付网关', '订单域', '支付域'],
  },
  dashboard: {
    label: '经营数据看板开发',
    role: '前端开发',
    needs: ['React', '数据可视化', 'ECharts', '数据看板'],
  },
  membership: {
    label: '会员权益规则重构',
    role: '后端开发',
    needs: ['Java', '会员服务', '规则引擎', '权益域'],
  },
};
const risks = [
  {
    id: 'R-023',
    version: 'v1.0',
    level: '高',
    title: '支付网关接口交付延迟',
    owner: '陈默',
    impact: '核心联调里程碑可能延迟 3 天',
    trigger: '9月13日仍未完成沙箱验证',
    status: '处理中',
    plan: '切换备用聚合支付通道；并行准备接口适配层',
  },
  {
    id: 'R-019',
    version: 'v1.0',
    level: '高',
    title: '测试资源连续两周过载',
    owner: '赵一',
    impact: 'Beta 回归缺口约 24 人时',
    trigger: '测试负载连续 3 日 > 105%',
    status: '待决策',
    plan: '从数据中台借调 0.5 人周；下调非核心兼容性范围',
  },
  {
    id: 'R-027',
    version: 'v1.1',
    level: '中',
    title: '会员规则需求仍在变动',
    owner: '林夏',
    impact: '返工概率 42%，影响 4 个任务',
    trigger: '规则字段本周再次变化',
    status: '监控中',
    plan: '冻结 P0 规则，P1 规则进入 v1.1 版本池',
  },
];
const versions = [
  {
    name: 'v0.9 Alpha',
    scope: '核心会员与订单闭环',
    date: '09/13',
    progress: 92,
    state: '验收中',
  },
  {
    name: 'v1.0 Beta',
    scope: '支付、数据看板、运营配置',
    date: '09/27',
    progress: 42,
    state: '开发中',
  },
  {
    name: 'v1.1 Growth',
    scope: '营销规则与自动化触达',
    date: '10/18',
    progress: 8,
    state: '规划中',
  },
];

type MeetingRecord = {
  id: string;
  title: string;
  date: string;
  time: string;
  attendees: string;
  agenda: string;
  status: string;
  minutes?: {
    mode: '线上' | '线下';
    notes: string;
    transcript: string;
    decisions: string;
    actionItems: string;
    followUps?: Array<{
      id: string;
      title: string;
      owner: string;
      dueDate: string;
      linkedType: 'WBS任务' | '风险' | '需求变更';
      linkedId: string;
      status: '待执行' | '执行中' | '待验收' | '已闭环';
      evidence: string;
      history: Array<{
        status: string;
        at: string;
        note: string;
      }>;
    }>;
    recordingName?: string;
    recordedAt?: string;
  };
};

type ReportRecord = {
  id: string;
  type: string;
  version: VersionScope;
  summary: string;
  createdAt: string;
};

type ChangeHistoryEntry = {
  step: number;
  action: string;
  actor: string;
  at: string;
  note: string;
};

type ChangeRecord = {
  id: string;
  title: string;
  description: string;
  sourceVersion: Exclude<VersionScope, 'portfolio'>;
  targetVersion: Exclude<VersionScope, 'portfolio'>;
  status: string;
  currentStep: number;
  owner: string;
  reviewer: string;
  scheduleImpact: string;
  resourceImpact: string;
  affectedTasks: string[];
  recommendation: string;
  updatedAt: string;
  history: ChangeHistoryEntry[];
  wbsDraft?: ChangeWbsDraftItem[];
  wbsAppliedAt?: string;
  wbsAppliedTaskIds?: string[];
};

type ChangeWbsDraftItem = {
  id: string;
  operation: '新增';
  phase: string;
  task: TaskRecord;
  linkedTasks: string[];
  reason: string;
  parentTaskId: string | null;
  workType: string;
  acceptanceCriteria: string;
};

type ChangeTaskLink = {
  id: string;
  project_id: string;
  change_id: string;
  task_id: string;
  relation_type: string;
  note?: string;
  created_at: string;
};

type TaskHierarchyRecord = {
  task_id: string;
  project_id: string;
  parent_task_id: string | null;
  root_task_id: string;
  level: number;
  sort_order: number;
  work_type: string;
  acceptance_criteria?: string;
  created_at: string;
  updated_at: string;
};

function buildChangeWbsDraft(
  change: ChangeRecord,
  targetVersion: ChangeRecord['targetVersion'],
  projectName: string,
): ChangeWbsDraftItem[] {
  const firstStart = dateKey(addChinaWorkdays(shanghaiNow().date, 1));
  const inclusiveEnd = (start: string, duration: number) =>
    dateKey(addChinaWorkdays(start, Math.max(0, duration - 1)));
  const nextStart = (end: string) => dateKey(addChinaWorkdays(end, 1));
  const requirementEnd = inclusiveEnd(firstStart, 2);
  const developmentStart = nextStart(requirementEnd);
  const backendEnd = inclusiveEnd(developmentStart, 5);
  const frontendEnd = inclusiveEnd(developmentStart, 5);
  const integrationStart = nextStart(backendEnd);
  const integrationEnd = inclusiveEnd(integrationStart, 3);
  const acceptanceStart = nextStart(integrationEnd);
  const acceptanceEnd = inclusiveEnd(acceptanceStart, 5);
  const windows = [
    [firstStart, requirementEnd],
    [developmentStart, backendEnd],
    [developmentStart, frontendEnd],
    [integrationStart, integrationEnd],
    [acceptanceStart, acceptanceEnd],
  ].map(([start, end]) => [isoDateToMonthDay(start), isoDateToMonthDay(end)]);
  const parentTaskId = `${change.id}-WBS`;
  const phases: Array<[string, string, string, TaskPriority, string, string]> =
    [
      [
        '需求澄清与验收标准',
        change.owner,
        '16h',
        '中',
        '需求',
        '业务范围、验收口径和不做范围完成评审确认',
      ],
      [
        '后端规则与接口实现',
        '王璟、方宁',
        '56h',
        '高',
        '后端',
        '接口契约、单元测试和异常补偿链路通过',
      ],
      [
        '前端交互与状态适配',
        '顾言',
        '40h',
        '中',
        '前端',
        '正常、异常和权限状态均按交互稿验收通过',
      ],
      [
        '多方联合联调',
        '王璟、顾言、赵一',
        '32h',
        '高',
        '联调',
        '前后端与关联域主链路、补偿链路联调通过',
      ],
      [
        '功能验收与版本回归',
        '周琪',
        '40h',
        '中',
        '测试',
        '验收用例通过且无 P0/P1 遗留缺陷',
      ],
    ];
  const children = phases.map<ChangeWbsDraftItem>(
    ([phase, owner, estimate, risk, workType, acceptanceCriteria], index) => {
      const taskId = `${change.id}-W${index + 1}`;
      const dependency =
        index === 0
          ? '—'
          : index === 1 || index === 2
            ? `${change.id}-W1`
            : index === 3
              ? `${change.id}-W2、${change.id}-W3`
              : `${change.id}-W4`;
      const linkedTasks =
        index === 0
          ? change.affectedTasks
          : change.affectedTasks.slice(
              Math.max(0, index - 1),
              Math.min(change.affectedTasks.length, index + 1),
            );
      return {
        id: `${change.id}-DRAFT-${index + 1}`,
        operation: '新增' as const,
        phase,
        linkedTasks,
        parentTaskId,
        workType,
        acceptanceCriteria,
        reason:
          index === 0
            ? '承接已采纳变更并冻结验收边界'
            : `落实 ${change.id} 对 ${linkedTasks.join('、') || '版本范围'} 的影响`,
        task: [
          taskId,
          `${change.title} · ${phase}`,
          projectName,
          targetVersion,
          owner,
          '未开始',
          index === 0 ? '中' : '高',
          windows[index][0],
          windows[index][1],
          '0%',
          estimate,
          dependency,
          risk,
        ],
      };
    },
  );
  return [
    {
      id: `${change.id}-DRAFT-PARENT`,
      operation: '新增',
      phase: '需求/用户故事',
      linkedTasks: change.affectedTasks,
      parentTaskId: null,
      workType: '父任务',
      acceptanceCriteria: '全部子任务完成并通过版本验收',
      reason: `承接 ${change.id} 的整体交付责任与进度汇总`,
      task: [
        parentTaskId,
        change.title,
        projectName,
        targetVersion,
        change.owner,
        '未开始',
        '高',
        windows[0][0],
        windows[windows.length - 1][1],
        '0%',
        '0h',
        '—',
        '中',
      ],
    },
    ...children,
  ];
}

function effectiveChangeWbsDraft(
  change: ChangeRecord,
  targetVersion: ChangeRecord['targetVersion'],
  projectName: string,
) {
  return change.wbsDraft?.some((item) => item.parentTaskId === null)
    ? change.wbsDraft
    : buildChangeWbsDraft(change, targetVersion, projectName);
}

type TaskBlocker = {
  id: string;
  taskId: string;
  version: Exclude<VersionScope, 'portfolio'>;
  category: string;
  reason: string;
  source: string;
  owner: string;
  discoveredAt: string;
  expectedResolveAt: string;
  status: string;
  impact: string;
  resolutionPlan: string;
  updatedAt: string;
};

const changeSteps = [
  '登记变更',
  '分析评估',
  '审核采纳',
  '计划调整',
  '实施跟踪',
  '验收确认',
  '归档',
];

const defaultMeetings: MeetingRecord[] = [
  {
    id: 'MEETING-DEMO-H1',
    title: 'v0.9 Alpha 需求评审会',
    date: '2026-08-20',
    time: '10:00',
    attendees: '林夏、陈默、王琼、业务代表',
    agenda: '确认会员、订单闭环范围与验收口径',
    status: '纪要已归档',
    minutes: {
      mode: '线上',
      notes: '逐项核对 v0.9 需求范围，确认核心流程优先级和暂缓项。',
      transcript: '林夏：本期必须跑通会员注册到订单完成的主链路。',
      decisions: '冻结 v0.9 核心范围；营销自动化能力转入 v1.1。',
      actionItems: '林夏｜发布需求基线｜08/20\n陈默｜补充技术风险清单｜08/21',
    },
  },
  {
    id: 'MEETING-DEMO-H2',
    title: 'v0.9 Alpha 技术方案评审',
    date: '2026-08-26',
    time: '14:00',
    attendees: '陈默、王琼、韩森、赵一',
    agenda: '服务拆分、订单状态机与测试策略评审',
    status: '纪要已归档',
    minutes: {
      mode: '线下',
      notes: '评审订单状态机、幂等方案以及联调环境准备计划。',
      transcript: '王琼：订单回调需要增加幂等键和失败补偿任务。',
      decisions: '采用事件驱动的订单状态流转；保留人工补偿入口。',
      actionItems: '王琼｜提交状态机设计｜08/27\n赵一｜准备异常链路用例｜08/28',
      recordingName: 'MEETING-DEMO-H2-recording.webm',
      recordedAt: '2026-08-26T14:03:00+08:00',
    },
  },
  {
    id: 'MEETING-DEMO-H3',
    title: 'v1.0 Beta 用例评审会',
    date: '2026-09-06',
    time: '15:30',
    attendees: '赵一、周琪、林夏、陈默',
    agenda: '支付、数据看板与运营配置的测试用例覆盖',
    status: '纪要已归档',
    minutes: {
      mode: '线上',
      notes: '核对主流程、异常场景及回归范围，发现支付沙箱依赖风险。',
      transcript: '赵一：支付回调异常和重复扣款场景仍需补充。',
      decisions: '补齐 12 条支付异常用例；提测前完成沙箱连通性验证。',
      actionItems: '赵一｜补齐支付异常用例｜09/08\n陈默｜验证备用沙箱｜09/09',
    },
  },
  {
    id: 'MEETING-DEMO-1',
    title: 'v1.0 Beta 风险决策会',
    date: '2026-09-11',
    time: '14:30',
    attendees: '林夏、陈默、赵一、周琪',
    agenda: '支付接口备选方案、测试资源调配、CR-018 版本归属',
    status: '纪要已归档',
    minutes: {
      mode: '线上',
      notes: '围绕支付备选通道、测试资源借调和需求变更归属完成讨论。',
      transcript:
        '陈默：建议启用备用支付沙箱。赵一：需要增加 24 小时回归资源。',
      decisions: '启用备用支付沙箱；CR-018 并入 v1.1。',
      actionItems: '陈默｜配置备用沙箱｜09/12\n赵一｜补充回归用例｜09/13',
      followUps: [
        {
          id: 'DEC-001',
          title: '启用支付备用通道并完成连通性验证',
          owner: '陈默',
          dueDate: '2026-09-12',
          linkedType: 'WBS任务',
          linkedId: '2.2',
          status: '执行中',
          evidence: '备用沙箱配置已完成，等待回调链路验证。',
          history: [
            { status: '待执行', at: '09/11 15:20', note: '会议决策转行动项' },
            { status: '执行中', at: '09/11 16:00', note: '负责人已确认执行' },
          ],
        },
        {
          id: 'DEC-002',
          title: '调配 24 小时支付回归测试资源',
          owner: '赵一',
          dueDate: '2026-09-13',
          linkedType: '风险',
          linkedId: 'R-019',
          status: '待执行',
          evidence: '',
          history: [
            { status: '待执行', at: '09/11 15:22', note: '会议决策转行动项' },
          ],
        },
        {
          id: 'DEC-003',
          title: '将 CR-018 调整至 v1.1 版本计划',
          owner: '林夏',
          dueDate: '2026-09-12',
          linkedType: '需求变更',
          linkedId: 'CR-018',
          status: '待验收',
          evidence: '已完成版本归属调整并生成新的计划基线。',
          history: [
            { status: '待执行', at: '09/11 15:25', note: '会议决策转行动项' },
            { status: '执行中', at: '09/11 16:10', note: '开始调整版本计划' },
            {
              status: '待验收',
              at: '09/12 09:30',
              note: '已提交版本负责人验收',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'MEETING-DEMO-2',
    title: '产品与研发周例会',
    date: '2026-09-12',
    time: '10:00',
    attendees: '项目核心组',
    agenda: '版本进展、阻塞项和下周计划',
    status: '会议中',
  },
  {
    id: 'MEETING-DEMO-3',
    title: 'Alpha 验收复盘',
    date: '2026-09-13',
    time: '16:00',
    attendees: '业务、产品、研发、测试',
    agenda: '验收结论、遗留缺陷与改进项',
    status: '待确认',
  },
];

type TimelineNode = {
  name: string;
  plan: string;
  actual: string;
  state: '已完成' | '延迟完成' | '有风险' | '待开始';
};

const versionTimelines: Record<VersionScope, TimelineNode[]> = {
  portfolio: [
    { name: 'v0.9 技术评审', plan: '08/26', actual: '08/26', state: '已完成' },
    { name: 'v0.9 发布', plan: '09/13', actual: '预计 09/13', state: '有风险' },
    {
      name: 'v1.0 技术评审',
      plan: '09/06',
      actual: '09/07',
      state: '延迟完成',
    },
    { name: 'v1.0 联调', plan: '09/18', actual: '预计 09/21', state: '有风险' },
    { name: 'v1.0 发布', plan: '09/27', actual: '预计 09/30', state: '有风险' },
    { name: 'v1.1 发布', plan: '10/18', actual: '预计 10/20', state: '待开始' },
  ],
  'v0.9': [
    { name: '需求评审', plan: '08/20', actual: '08/20', state: '已完成' },
    { name: '技术评审', plan: '08/23', actual: '08/23', state: '已完成' },
    { name: '用例评审', plan: '08/28', actual: '08/28', state: '已完成' },
    { name: '联调', plan: '09/03', actual: '09/04', state: '延迟完成' },
    { name: '提测', plan: '09/06', actual: '09/06', state: '已完成' },
    { name: '发版', plan: '09/13', actual: '预计 09/13', state: '有风险' },
  ],
  'v1.0': [
    { name: '需求评审', plan: '09/03', actual: '09/03', state: '已完成' },
    { name: '技术评审', plan: '09/06', actual: '09/07', state: '延迟完成' },
    { name: '用例评审', plan: '09/11', actual: '预计 09/12', state: '有风险' },
    { name: '联调', plan: '09/18', actual: '预计 09/21', state: '有风险' },
    { name: '提测', plan: '09/22', actual: '预计 09/25', state: '有风险' },
    { name: '发版', plan: '09/27', actual: '预计 09/30', state: '有风险' },
  ],
  'v1.1': [
    { name: '需求评审', plan: '09/18', actual: '预计 09/18', state: '待开始' },
    { name: '技术评审', plan: '09/22', actual: '预计 09/23', state: '待开始' },
    { name: '用例评审', plan: '09/28', actual: '预计 09/29', state: '待开始' },
    { name: '联调', plan: '10/06', actual: '预计 10/08', state: '有风险' },
    { name: '提测', plan: '10/11', actual: '预计 10/13', state: '有风险' },
    { name: '发版', plan: '10/18', actual: '预计 10/20', state: '有风险' },
  ],
};

type BaselineKey = 'initial' | 'change1' | 'current';

const baselineSnapshots: Record<
  BaselineKey,
  { label: string; savedAt: string; note: string }
> = {
  initial: {
    label: '初始基线 B0',
    savedAt: '08/25 18:30',
    note: '立项评审通过后冻结的首版计划',
  },
  change1: {
    label: '变更基线 B1',
    savedAt: '09/06 16:20',
    note: '支付接口范围变更后重新排期',
  },
  current: {
    label: '当前执行计划',
    savedAt: '09/10 10:24',
    note: '结合最新进度与风险预测滚动更新',
  },
};

const baselinePlans: Record<VersionScope, Record<BaselineKey, string[]>> = {
  portfolio: {
    initial: ['08/26', '09/12', '09/06', '09/18', '09/27', '10/18'],
    change1: ['08/26', '09/13', '09/07', '09/19', '09/28', '10/19'],
    current: ['08/26', '09/13', '09/07', '09/21', '09/30', '10/20'],
  },
  'v0.9': {
    initial: ['08/25', '08/28', '09/02', '09/06', '09/10', '09/12'],
    change1: ['08/25', '08/29', '09/03', '09/07', '09/11', '09/13'],
    current: ['08/25', '08/29', '09/03', '09/08', '09/11', '09/13'],
  },
  'v1.0': {
    initial: ['09/03', '09/06', '09/11', '09/18', '09/22', '09/27'],
    change1: ['09/03', '09/07', '09/12', '09/19', '09/23', '09/28'],
    current: ['09/03', '09/07', '09/12', '09/21', '09/25', '09/30'],
  },
  'v1.1': {
    initial: ['09/10', '09/15', '09/20', '10/05', '10/10', '10/18'],
    change1: ['09/11', '09/16', '09/21', '10/06', '10/11', '10/19'],
    current: ['09/12', '09/18', '09/22', '10/08', '10/13', '10/20'],
  },
};

function timelineDay(value: string) {
  const match = value.match(/(\d{2})\/(\d{2})/);
  return match ? Number(match[1]) * 31 + Number(match[2]) : 0;
}

function ViewLoading({ label }: { label: string }) {
  return (
    <output className="flex min-h-48 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
      正在加载{label}…
    </output>
  );
}

export default function Home() {
  const clientReady = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  );
  const [view, setView] = useState<View>('项目概览');
  const [versionScope, setVersionScope] = useState<VersionScope>('v1.0');
  const [wbsOwnerFocus, setWbsOwnerFocus] = useState('全部');
  const [wbsStatusFocus, setWbsStatusFocus] = useState('全部');
  const [wbsChangeFocus, setWbsChangeFocus] = useState('');
  const [milestoneFocus, setMilestoneFocus] = useState('');
  const [riskFocus, setRiskFocus] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [dialog, setDialog] = useState<
    'inspection' | 'change' | 'report' | 'meeting' | null
  >(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState('');
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [workspaceSourceState, setWorkspaceSourceState] =
    useState<WorkspaceSourceState>('loading');
  const [workspaceLoadError, setWorkspaceLoadError] = useState('');
  const [workspaceAccessDenied, setWorkspaceAccessDenied] = useState('');
  const [currentProjectId, setCurrentProjectId] = useState(
    'nebula-customer-platform',
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<
    WorkspaceMemberSummary[]
  >([]);
  const [workspacePermissions, setWorkspacePermissions] = useState<
    ProjectPermissionRecord[]
  >([]);
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0);
  const [workspaceUser, setWorkspaceUser] = useState<WorkspaceUser>({
    id: 'local-user',
    email: 'admin@flowpilot.local',
    displayName: 'Demo Admin',
    role: 'admin',
  });
  const [developmentAuth, setDevelopmentAuth] = useState(false);
  const [developmentIdentities, setDevelopmentIdentities] = useState<
    DevelopmentIdentity[]
  >([]);
  const [identityDialogOpen, setIdentityDialogOpen] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityError, setIdentityError] = useState('');
  const [identityDraft, setIdentityDraft] = useState({
    displayName: '',
    email: '',
  });
  const [workspaceTasks, setWorkspaceTasks] = useState<TaskRecord[]>(tasks);
  const [workspaceResources, setWorkspaceResources] = useState(resources);
  const [workspaceRisks, setWorkspaceRisks] = useState(risks);
  const [workspaceMeetings, setWorkspaceMeetings] =
    useState<MeetingRecord[]>(defaultMeetings);
  const [workspaceReports, setWorkspaceReports] = useState<ReportRecord[]>([]);
  const [workspaceChanges, setWorkspaceChanges] = useState<ChangeRecord[]>([]);
  const [workspaceBlockers, setWorkspaceBlockers] = useState<TaskBlocker[]>([]);
  const [inspectionFindings, setInspectionFindings] = useState<
    InspectionFinding[]
  >([]);
  const [workspaceChangeTaskLinks, setWorkspaceChangeTaskLinks] = useState<
    ChangeTaskLink[]
  >([]);
  const [workspaceTaskHierarchy, setWorkspaceTaskHierarchy] = useState<
    TaskHierarchyRecord[]
  >([]);
  const [workspaceVersionConfigs, setWorkspaceVersionConfigs] = useState<
    VersionConfig[]
  >(defaultVersionConfigs);
  const [reportType, setReportType] = useState('周报');
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [availabilityNote, setAvailabilityNote] = useState('');
  const [changeDraft, setChangeDraft] = useState({
    title: '',
    description: '',
    priority: 'P1',
    sourceVersion: 'v1.0' as ChangeRecord['sourceVersion'],
    targetVersion: 'v1.1' as ChangeRecord['targetVersion'],
    owner: '林夏',
    reviewer: '版本委员会',
  });
  const [meetingDraft, setMeetingDraft] = useState({
    title: 'v1.0 Beta 风险决策会',
    date: '2026-09-11',
    time: '14:30',
    attendees: '林夏、陈默、赵一、周琪',
    agenda: '1. 支付接口备选方案决策\n2. 测试资源调配\n3. CR-018 是否进入 v1.0',
  });

  const pendingDecisionCount = workspaceMeetings
    .flatMap((meeting) => meeting.minutes?.followUps ?? [])
    .filter((item) => item.status !== '已闭环').length;
  const activeInspectionFindings = inspectionFindings.filter(
    (item) => item.status !== 'resolved',
  );
  const inspectionCounts = {
    progress: activeInspectionFindings.filter(
      (item) => item.finding_type === 'progress',
    ).length,
    resource: activeInspectionFindings.filter(
      (item) => item.finding_type === 'resource',
    ).length,
    risk: activeInspectionFindings.filter(
      (item) => item.finding_type === 'risk',
    ).length,
  };
  const headerNotifications = [
    {
      id: 'blocked-task',
      title: '支付网关联调仍有阻塞',
      detail: 'WBS 2.2 等待沙箱链路恢复，已影响关键路径。',
      tone: 'text-rose-600',
    },
    {
      id: 'meeting-decision',
      title: `${pendingDecisionCount} 项会议决策待跟进`,
      detail: '包含待执行、执行中和待验收的会议行动项。',
      tone: 'text-amber-600',
    },
    {
      id: 'resource-load',
      title: '2 名成员负载超过阈值',
      detail: '陈默与赵一当前负载超过 105%，建议调整资源。',
      tone: 'text-blue-600',
    },
  ];
  const unreadNotificationCount = headerNotifications.filter(
    (item) => !readNotifications.includes(item.id),
  ).length;

  const globalSearchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('zh-CN');
    if (!query) return [];
    return [
      ...nav.map((item) => ({
        key: `view-${item.label}`,
        title: item.label,
        detail: '功能页面',
        kind: 'view' as const,
        view: item.label,
      })),
      ...workspaceTasks.map((task) => ({
        key: `task-${task[0]}`,
        title: `${task[0]} ${task[1]}`,
        detail: `${task[3]} · ${task[4]} · ${task[5]}`,
        kind: 'task' as const,
        task,
      })),
      ...milestones.map((milestone, index) => ({
        key: `milestone-${milestone.version}-${milestone.name}-${index}`,
        title: milestone.name,
        detail: `${versionScopeLabels[milestone.version as VersionId]} · ${milestone.date} · ${milestone.owner}`,
        kind: 'milestone' as const,
        milestone,
      })),
      ...workspaceResources.map((resource, index) => ({
        key: `resource-${resource.name}-${index}`,
        title: resource.name,
        detail: `${resource.role} · 当前负载 ${resource.load}%`,
        kind: 'resource' as const,
        resource,
      })),
    ]
      .filter((item) =>
        `${item.title} ${item.detail}`
          .toLocaleLowerCase('zh-CN')
          .includes(query),
      )
      .slice(0, 12);
  }, [searchQuery, workspaceResources, workspaceTasks]);

  useEffect(() => {
    function openGlobalSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', openGlobalSearch);
    return () => window.removeEventListener('keydown', openGlobalSearch);
  }, []);

  function selectGlobalSearchResult(
    result: (typeof globalSearchResults)[number],
  ) {
    setSearchOpen(false);
    setSearchQuery('');
    if (result.kind === 'view') {
      setView(result.view);
      return;
    }
    if (result.kind === 'task') {
      setVersionScope(result.task[3]);
      setWbsOwnerFocus(result.task[4]);
      setWbsStatusFocus('全部');
      setWbsChangeFocus('');
      setView('WBS与任务');
      return;
    }
    if (result.kind === 'milestone') {
      setVersionScope(result.milestone.version as VersionId);
      setMilestoneFocus(result.milestone.name);
      setView('计划与里程碑');
      return;
    }
    setVersionScope('portfolio');
    setView('资源与负载');
  }

  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as {
          developmentAuth?: boolean;
          identities?: DevelopmentIdentity[];
        };
        setDevelopmentAuth(result.developmentAuth === true);
        setDevelopmentIdentities(result.identities ?? []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch(`/api/workspace?projectId=${encodeURIComponent(currentProjectId)}`)
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          const detail = (await response.json().catch(() => null)) as {
            error?: string;
            detail?: string;
          } | null;
          setWorkspaceAccessDenied(
            detail?.detail ?? detail?.error ?? 'authentication_required',
          );
          return;
        }
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as {
            message?: string;
            detail?: string;
          } | null;
          throw new Error(
            detail?.message ??
              detail?.detail ??
              `项目数据加载失败（HTTP ${response.status}）`,
          );
        }
        const data = (await response.json()) as {
          user?: WorkspaceUser;
          projectId?: string;
          projects?: ProjectSummary[];
          workspaceMembers?: WorkspaceMemberSummary[];
          snapshot?: {
            tasks?: unknown;
            resources?: typeof resources;
            risks?: typeof risks;
            meetings?: MeetingRecord[];
            reports?: ReportRecord[];
            changes?: ChangeRecord[];
            blockers?: TaskBlocker[];
            changeTaskLinks?: ChangeTaskLink[];
            taskHierarchy?: TaskHierarchyRecord[];
            versionConfigs?: VersionConfig[];
            inspectionFindings?: InspectionFinding[];
            permissions?: ProjectPermissionRecord[];
          };
        };
        if (data.user) setWorkspaceUser(data.user);
        if (data.projectId) setCurrentProjectId(data.projectId);
        setProjects(data.projects ?? []);
        setWorkspaceMembers(data.workspaceMembers ?? []);
        setWorkspacePermissions(data.snapshot?.permissions ?? []);
        if (data.snapshot?.tasks !== undefined) {
          const taskRecords = requireTaskRecords(data.snapshot.tasks);
          setWorkspaceTasks(taskRecords);
        }
        if (data.snapshot?.resources !== undefined) {
          setWorkspaceResources(data.snapshot.resources ?? []);
        }
        if (data.snapshot?.risks !== undefined) {
          setWorkspaceRisks(data.snapshot.risks ?? []);
        }
        if (data.snapshot?.meetings !== undefined) {
          setWorkspaceMeetings(data.snapshot.meetings ?? []);
        }
        if (data.snapshot?.reports) {
          setWorkspaceReports(data.snapshot.reports);
        }
        if (data.snapshot?.changes) {
          setWorkspaceChanges(data.snapshot.changes);
        }
        if (data.snapshot?.blockers) {
          setWorkspaceBlockers(data.snapshot.blockers);
        }
        if (data.snapshot?.changeTaskLinks) {
          setWorkspaceChangeTaskLinks(data.snapshot.changeTaskLinks);
        }
        if (data.snapshot?.taskHierarchy) {
          setWorkspaceTaskHierarchy(data.snapshot.taskHierarchy);
        }
        if (data.snapshot?.versionConfigs !== undefined) {
          const configs = data.snapshot.versionConfigs ?? [];
          setWorkspaceVersionConfigs(configs);
          if (configs.length > 0) {
            setVersionScope(configs[0].version);
          }
        }
        setInspectionFindings(data.snapshot?.inspectionFindings ?? []);
        setWorkspaceSourceState('live');
        setWorkspaceAccessDenied('');
        setWorkspaceLoadError('');
      })
      .catch((error: unknown) => {
        setWorkspaceSourceState('demo');
        setWorkspaceLoadError(
          error instanceof Error ? error.message : '项目数据加载失败',
        );
      });
  }, [currentProjectId, workspaceRefresh]);

  async function selectDevelopmentIdentity(identity: DevelopmentIdentity) {
    setIdentitySaving(true);
    setIdentityError('');
    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identity),
      });
      if (!response.ok) throw new Error('身份切换失败');
      window.location.reload();
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : '身份切换失败');
      setIdentitySaving(false);
    }
  }

  async function loginDevelopmentIdentity() {
    const email = identityDraft.email.trim();
    const displayName = identityDraft.displayName.trim();
    if (!email || !displayName) {
      setIdentityError('请填写姓名和邮箱');
      return;
    }
    await selectDevelopmentIdentity({ id: '', email, displayName });
  }

  async function signOut() {
    if (!developmentAuth) {
      window.location.href = '/signout-with-chatgpt?return_to=/';
      return;
    }
    setIdentitySaving(true);
    try {
      await fetch('/api/auth/session', { method: 'DELETE' });
    } finally {
      window.location.reload();
    }
  }

  async function switchProject(projectId: string) {
    setWorkspaceSourceState('loading');
    setCurrentProjectId(projectId);
    setView('项目概览');
    setWbsOwnerFocus('全部');
    setWbsStatusFocus('全部');
    setWbsChangeFocus('');
    setMilestoneFocus('');
    setRiskFocus('');
  }

  function hasProjectPermission(
    permission: ProjectPermissionRecord['permission'],
    versionId: VersionId,
  ) {
    if (workspaceUser.role === 'admin') return true;
    return workspacePermissions.some(
      (record) =>
        record.member_id === workspaceUser.id &&
        record.project_id === currentProjectId &&
        record.permission === permission &&
        (record.version_id === '*' || record.version_id === versionId),
    );
  }

  async function projectChanged(projectId?: string) {
    if (projectId) {
      await switchProject(projectId);
      return;
    }
    setWorkspaceRefresh((current) => current + 1);
  }

  async function runInspection() {
    setRunning(true);
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run_ai_inspection',
          entityType: 'workspace_inspection',
          entityId: createRecordId('INSPECTION'),
          detail: '规则巡检完成：进度偏差 1，资源过载 1，风险超时 1',
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        total?: number;
        progress?: number;
        resource?: number;
        risk?: number;
        detail?: string;
      } | null;
      if (!response.ok) throw new Error(result?.detail ?? '巡检记录写入失败');
      setDialog(null);
      setWorkspaceRefresh((current) => current + 1);
      setToast(
        `巡检完成：发现 ${result?.total ?? 0} 项，进度 ${result?.progress ?? 0}、资源 ${result?.resource ?? 0}、风险 ${result?.risk ?? 0}。`,
      );
      setTimeout(() => setToast(''), 3200);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '巡检失败');
    } finally {
      setRunning(false);
    }
  }

  function findCommonAvailability() {
    const now = shanghaiNow();
    const [hour, minute] = now.time.split(':').map(Number);
    const roundedMinutes = minute < 30 ? 30 : 60;
    const suggestedHour = (hour + Math.floor(roundedMinutes / 60)) % 24;
    const suggestedTime = `${String(suggestedHour).padStart(2, '0')}:${roundedMinutes % 60 === 0 ? '00' : '30'}`;
    const suggestedDate =
      suggestedHour < hour ? addCalendarDays(now.date, 1) : now.date;
    const suggestedStartMinutes = suggestedHour * 60 + (roundedMinutes % 60);
    const suggestedEndMinutes = (suggestedStartMinutes + 45) % (24 * 60);
    const suggestedEndTime = `${String(Math.floor(suggestedEndMinutes / 60)).padStart(2, '0')}:${String(suggestedEndMinutes % 60).padStart(2, '0')}`;
    setMeetingDraft((current) => ({
      ...current,
      date: suggestedDate,
      time: suggestedTime,
    }));
    setAvailabilityNote(
      `已按当前演示日历推荐最近空闲时段：${suggestedDate} ${suggestedTime}–${suggestedEndTime}。接入飞书/钉钉后将改用真实忙闲数据。`,
    );
  }

  function openHeaderNotification(id: string) {
    setReadNotifications((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setNotificationOpen(false);
    if (id === 'blocked-task') {
      setVersionScope('v1.0');
      setWbsOwnerFocus('全部');
      setWbsStatusFocus('有阻塞');
      setView('WBS与任务');
      return;
    }
    if (id === 'meeting-decision') {
      setView('会议协同');
      return;
    }
    setVersionScope('portfolio');
    setView('资源与负载');
  }

  function openInspectionTarget(target: 'progress' | 'resource' | 'risk') {
    setDialog(null);
    if (target === 'progress') {
      setVersionScope('v1.0');
      setWbsOwnerFocus('全部');
      setWbsStatusFocus('有阻塞');
      setView('WBS与任务');
      return;
    }
    if (target === 'resource') {
      setVersionScope('portfolio');
      setView('资源与负载');
      return;
    }
    setVersionScope('v1.0');
    setRiskFocus('R-019');
    setView('风险与变更');
  }

  async function createMeeting() {
    const meeting: MeetingRecord = {
      id: createRecordId('MEETING'),
      ...meetingDraft,
      status: '已预约',
    };
    setRunning(true);
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_meeting', meeting }),
      });
      if (!response.ok) throw new Error('会议创建失败');
      setWorkspaceMeetings((current) => [...current, meeting]);
      setDialog(null);
      setToast('会议已预约并写入协同记录。');
      setTimeout(() => setToast(''), 3200);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '会议创建失败');
    } finally {
      setRunning(false);
    }
  }

  function openMeetingCreation() {
    const now = shanghaiNow();
    setMeetingDraft((current) => ({
      ...current,
      date: now.date,
      time: now.time,
    }));
    setDialog('meeting');
  }

  async function createReport() {
    const report: ReportRecord = {
      id: createRecordId('REPORT'),
      type: reportType,
      version: versionScope,
      summary: `${versionScopeLabels[versionScope]}：汇总进展、偏差、里程碑、风险和下阶段计划。`,
      createdAt: new Date().toISOString(),
    };
    setRunning(true);
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_report', report }),
      });
      if (!response.ok) throw new Error('报告生成失败');
      setWorkspaceReports((current) => [...current, report]);
      setDialog(null);
      setToast(`${reportType}已生成并写入报告中心。`);
      setTimeout(() => setToast(''), 3200);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '报告生成失败');
    } finally {
      setRunning(false);
    }
  }

  function openChangeCreation() {
    const sourceVersion = versionScope === 'portfolio' ? 'v1.0' : versionScope;
    setChangeDraft((current) => ({
      ...current,
      sourceVersion,
      targetVersion: suggestedChangeTarget(sourceVersion),
    }));
    setDialog('change');
  }

  async function createChangeDraft() {
    const change: ChangeRecord = {
      id: createRecordId('CR'),
      title: changeDraft.title.trim(),
      description: changeDraft.description.trim(),
      sourceVersion: changeDraft.sourceVersion,
      targetVersion: changeDraft.targetVersion,
      status: '待分析',
      currentStep: 0,
      owner: changeDraft.owner,
      reviewer: changeDraft.reviewer,
      scheduleImpact: '待 AI 评估',
      resourceImpact: '待 AI 评估',
      affectedTasks: [],
      recommendation: '待 AI 沿 WBS 依赖链完成评估。',
      updatedAt: new Date().toISOString(),
      history: [
        {
          step: 0,
          action: '登记变更',
          actor: changeDraft.owner,
          at: new Date().toLocaleString('zh-CN'),
          note: `${changeDraft.priority} · 从 ${versionScopeLabels[changeDraft.sourceVersion]} 提交`,
        },
      ],
    };
    setRunning(true);
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_change', change }),
      });
      if (!response.ok) throw new Error('需求变更创建失败');
      setWorkspaceChanges((current) => [...current, change]);
      setChangeDraft({
        ...changeDraft,
        title: '',
        description: '',
      });
      setDialog(null);
      setView('风险与变更');
      setToast('需求变更已创建，请在闭环台账中启动 AI 分析。');
      setTimeout(() => setToast(''), 3200);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '需求变更创建失败');
    } finally {
      setRunning(false);
    }
  }

  const currentProject = projects.find(
    (project) => project.id === currentProjectId,
  );
  const visibleVersionConfigs = workspaceVersionConfigs.length
    ? workspaceVersionConfigs
    : defaultVersionConfigs;
  const projectRoadmap = visibleVersionConfigs.map((config) => {
    const versionTasks = workspaceTasks.filter(
      (task) => task[3] === config.version,
    );
    const progress = versionTasks.length
      ? Math.round(
          versionTasks.reduce(
            (total, task) => total + Number(task[9].replace('%', '')),
            0,
          ) / versionTasks.length,
        )
      : 0;
    return {
      name: versionScopeLabels[config.version],
      scope: currentProject?.description || '项目范围待补充',
      date: config.releaseDate?.slice(5).replace('-', '/') || '待排期',
      progress,
      state: progress >= 100 ? '已发布' : progress > 0 ? '执行中' : '规划中',
    };
  });

  if (
    !clientReady ||
    (workspaceSourceState === 'loading' && !workspaceAccessDenied)
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-3 rounded-xl border bg-card px-5 py-4 shadow-sm">
          <RefreshCw className="size-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-semibold">正在加载项目工作台</p>
            <p className="mt-1 text-xs text-muted-foreground">
              正在同步当前日期与项目数据…
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (workspaceAccessDenied) {
    const requiresLogin = workspaceAccessDenied === 'authentication_required';
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-foreground">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-amber-600" />
              {requiresLogin ? '请先登录工作台' : '尚未获得工作区权限'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              {requiresLogin
                ? '登录后系统会校验你的工作区成员身份。'
                : '请让系统管理员使用你的企业邮箱创建邀请，或者确认该账号未被停用。'}
            </p>
            {developmentAuth ? (
              <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                <p className="font-medium text-foreground">本地开发账号登录</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label="登录姓名"
                    placeholder="姓名"
                    value={identityDraft.displayName}
                    onChange={(event) =>
                      setIdentityDraft({
                        ...identityDraft,
                        displayName: event.target.value,
                      })
                    }
                  />
                  <Input
                    aria-label="登录邮箱"
                    type="email"
                    placeholder="name@example.com"
                    value={identityDraft.email}
                    onChange={(event) =>
                      setIdentityDraft({
                        ...identityDraft,
                        email: event.target.value,
                      })
                    }
                  />
                </div>
                {identityError && (
                  <p className="text-xs text-rose-600">{identityError}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={identitySaving}
                    onClick={() => void loginDevelopmentIdentity()}
                  >
                    <LogIn />
                    {identitySaving ? '正在登录…' : '登录 / 注册'}
                  </Button>
                  {developmentIdentities.slice(0, 4).map((identity) => (
                    <Button
                      key={identity.id}
                      variant="outline"
                      disabled={identitySaving}
                      onClick={() => void selectDevelopmentIdentity(identity)}
                    >
                      {identity.displayName}
                    </Button>
                  ))}
                </div>
                <p className="text-xs leading-5">
                  开放模式下，新邮箱首次登录会成为只读访客；邀请制下必须先由管理员邀请。
                </p>
              </div>
            ) : requiresLogin ? (
              <a
                href="/signin-with-chatgpt?return_to=/"
                target="_top"
                className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                登录工作台
              </a>
            ) : (
              <a
                href="/signout-with-chatgpt?return_to=/"
                target="_top"
                className="inline-flex rounded-lg border px-4 py-2 text-sm font-medium text-foreground"
              >
                退出并更换账号
              </a>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:px-7">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="打开导航"
            onClick={() => setMobileNav(!mobileNav)}
          >
            <Menu />
          </Button>
          <button
            className="flex items-center gap-3"
            onClick={() => setView('项目概览')}
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </span>
            <span className="text-left">
              <span className="block text-[15px] font-semibold leading-tight">
                FlowPilot
              </span>
              <span className="block text-[11px] text-muted-foreground">
                AI 项目指挥中心
              </span>
            </span>
          </button>
        </div>
        <button
          type="button"
          aria-label="全局搜索"
          onClick={() => setSearchOpen(true)}
          className="hidden w-[360px] items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-left text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-muted md:flex"
        >
          <Search className="size-4" />
          搜索任务、里程碑或负责人…{' '}
          <span className="ml-auto rounded border bg-background px-1.5 text-xs">
            ⌘K
          </span>
        </button>
        <div className="flex items-center gap-2">
          <WorkspaceConnectionBadge state={workspaceSourceState} />
          <Popover open={notificationOpen} onOpenChange={setNotificationOpen}>
            <PopoverTrigger
              className="relative inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`通知，${unreadNotificationCount} 条未读`}
            >
              <Bell className="size-4" />
              {unreadNotificationCount > 0 && (
                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
                  {unreadNotificationCount}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <PopoverHeader className="border-b p-3">
                <div className="flex items-center gap-2">
                  <PopoverTitle>通知中心</PopoverTitle>
                  <Badge variant="outline" className="ml-auto">
                    {unreadNotificationCount} 条未读
                  </Badge>
                </div>
              </PopoverHeader>
              <div className="space-y-1 p-2">
                {headerNotifications.map((item) => {
                  const isRead = readNotifications.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`查看通知：${item.title}`}
                      onClick={() => openHeaderNotification(item.id)}
                      className="block w-full rounded-lg p-3 text-left transition hover:bg-muted"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-1.5 size-2 shrink-0 rounded-full ${isRead ? 'bg-slate-300' : 'bg-rose-500'}`}
                        />
                        <div>
                          <p className={`text-sm font-medium ${item.tone}`}>
                            {item.title}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {item.detail}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="border-t p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    setReadNotifications(
                      headerNotifications.map((item) => item.id),
                    )
                  }
                >
                  全部标为已读
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="打开用户菜单"
            >
              {workspaceUser.displayName.slice(0, 2).toUpperCase()}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <span className="block text-sm font-semibold text-foreground">
                    {workspaceUser.displayName}
                  </span>
                  <span className="mt-0.5 block font-normal">
                    {workspaceUser.email} ·{' '}
                    {
                      {
                        admin: '系统管理员',
                        project_manager: '项目经理',
                        member: '项目成员',
                        viewer: '只读访客',
                      }[workspaceUser.role]
                    }
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setView('我的工作')}>
                  <ClipboardCheck /> 我的工作
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView('集成与自动化')}>
                  <Link2 /> 集成与自动化
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView('成员与权限')}>
                  <Settings /> 成员与权限
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {developmentAuth && (
                  <DropdownMenuItem
                    onClick={() => {
                      setIdentityError('');
                      setIdentityDialogOpen(true);
                    }}
                  >
                    <UserRoundCog /> 切换测试身份
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => void signOut()}>
                  <LogOut /> 退出登录
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {mobileNav && (
        <button
          aria-label="关闭导航"
          className="fixed inset-0 z-20 bg-black/20 lg:hidden"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="flex">
        <aside
          className={`fixed bottom-0 left-0 top-16 z-20 w-[235px] border-r bg-sidebar p-3 transition-transform lg:sticky lg:h-[calc(100vh-4rem)] lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'} lg:flex lg:flex-col`}
        >
          <button
            type="button"
            className="mb-3 w-full rounded-xl border bg-card p-3 text-left transition hover:border-primary/40"
            onClick={() => {
              setView('项目中心');
              setMobileNav(false);
            }}
          >
            <p className="text-[11px] text-muted-foreground">当前项目群</p>
            <p className="mt-1 flex items-center justify-between text-sm font-semibold">
              <span className="truncate">
                {currentProject?.name ?? '数字化增长项目群'}
              </span>
              <ChevronDown className="size-4 shrink-0" />
            </p>
          </button>
          <nav className="space-y-1">
            {nav.map(({ label, icon: Icon }) => (
              <button
                key={label}
                onClick={() => {
                  setView(label);
                  setMobileNav(false);
                  setWbsOwnerFocus('全部');
                  setWbsStatusFocus('全部');
                  setMilestoneFocus('');
                  setRiskFocus('');
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${view === label ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-auto">
            <button
              className="mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
              onClick={() => {
                setView('成员与权限');
                setMobileNav(false);
              }}
            >
              <Settings className="size-4" />
              成员与权限
            </button>
            <button
              onClick={() => setDialog('inspection')}
              className="w-full rounded-xl border bg-card p-3 text-left transition hover:border-primary/40"
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <Bot className="size-4 text-primary" />
                AI 巡检助手{' '}
                <span className="ml-auto size-2 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                每 30 分钟巡检 · {activeInspectionFindings.length} 项需关注
              </p>
              <p className="mt-1 text-[10px] leading-4 text-amber-700">
                进度偏差 {inspectionCounts.progress} · 资源过载{' '}
                {inspectionCounts.resource} · 风险超时 {inspectionCounts.risk}
              </p>
            </button>
          </div>
        </aside>

        <section className="min-w-0 flex-1 p-4 lg:p-7">
          <div className="mx-auto max-w-[1440px]">
            {workspaceSourceState === 'demo' && (
              <WorkspaceFallbackAlert error={workspaceLoadError} />
            )}
            {workspaceSourceState === 'live' &&
              workspaceUser.role === 'viewer' && (
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  当前为只读访客：可以查看项目数据，但不能修改任务、计划、风险或成员权限。
                </div>
              )}
            {workspaceSourceState === 'live' &&
              workspaceUser.role === 'member' && (
                <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                  当前为项目成员：可以更新本人任务、本人负责的阻塞和参与会议的纪要；计划及成员权限由项目经理或管理员维护。
                </div>
              )}
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  当前数据范围
                </p>
                <p className="text-sm font-semibold">
                  {currentProject?.name ?? '星云客户平台'}
                </p>
              </div>
              <span className="hidden h-8 w-px bg-border sm:block" />
              <NativeSelect
                value={versionScope}
                onChange={(event) =>
                  setVersionScope(event.target.value as VersionScope)
                }
                aria-label="选择版本数据范围"
                className="min-w-[180px]"
              >
                {visibleVersionConfigs.length > 1 && (
                  <NativeSelectOption value="portfolio">
                    并行版本总览
                  </NativeSelectOption>
                )}
                {visibleVersionConfigs.map((config) => (
                  <NativeSelectOption
                    key={config.version}
                    value={config.version}
                  >
                    {versionScopeLabels[config.version]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Badge
                className={
                  versionScope === 'portfolio'
                    ? 'bg-violet-100 text-violet-700'
                    : 'bg-blue-100 text-blue-700'
                }
              >
                {versionScope === 'portfolio'
                  ? `${visibleVersionConfigs.length} 个版本并行`
                  : '版本级口径'}
              </Badge>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span className="hidden text-xs text-muted-foreground xl:inline">
                  任务、里程碑、资源、风险与报告统一按此范围联动
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openChangeCreation}
                >
                  <Plus />
                  新建需求变更
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setView('版本与报告')}
                >
                  <FileChartColumn />
                  报告中心
                </Button>
              </div>
            </div>
            {view === '项目中心' && (
              <Suspense fallback={<ViewLoading label="项目中心" />}>
                <ProjectCenterView
                  projects={projects}
                  members={workspaceMembers}
                  currentProjectId={currentProjectId}
                  currentRole={workspaceUser.role}
                  onSwitch={switchProject}
                  onChanged={projectChanged}
                />
              </Suspense>
            )}
            {view === '项目概览' && (
              <Dashboard
                projectName={currentProject?.name ?? '星云客户平台'}
                tasksData={workspaceTasks}
                risksData={workspaceRisks}
                onAction={(action) =>
                  action === 'change' ? openChangeCreation() : setDialog(action)
                }
                versionScope={versionScope}
                onVersionChange={setVersionScope}
                onOpenTasks={(status = '全部') => {
                  setWbsOwnerFocus('全部');
                  setWbsStatusFocus(status);
                  setView('WBS与任务');
                }}
                onOpenMilestones={(milestone = '') => {
                  setMilestoneFocus(milestone);
                  setView('计划与里程碑');
                }}
                onOpenResources={() => setView('资源与负载')}
                onOpenRisk={(riskId = '') => {
                  setRiskFocus(riskId);
                  setView('风险与变更');
                }}
              />
            )}
            {view === '我的工作' && (
              <Suspense fallback={<ViewLoading label="我的工作" />}>
                <MyWorkView
                  onNotificationPreferences={() => setView('集成与自动化')}
                  tasksData={workspaceTasks}
                  projectName={currentProject?.name ?? '星云客户平台'}
                  currentUserName={workspaceUser.displayName}
                />
              </Suspense>
            )}
            {view === 'WBS与任务' && (
              <WbsView
                projectId={currentProjectId}
                projectName={currentProject?.name ?? '星云客户平台'}
                tasksData={workspaceTasks}
                blockersData={workspaceBlockers}
                onBlockersChange={setWorkspaceBlockers}
                resourcesData={workspaceResources}
                onTasksChange={setWorkspaceTasks}
                changeTaskLinks={workspaceChangeTaskLinks}
                taskHierarchy={workspaceTaskHierarchy}
                onTaskHierarchyChange={setWorkspaceTaskHierarchy}
                versionConfigs={workspaceVersionConfigs}
                onVersionConfigsChange={setWorkspaceVersionConfigs}
                changeFocus={wbsChangeFocus}
                onClearChangeFocus={() => setWbsChangeFocus('')}
                versionScope={versionScope}
                ownerFocus={wbsOwnerFocus}
                statusFocus={wbsStatusFocus}
                onClearOwnerFocus={() => setWbsOwnerFocus('全部')}
                onClearStatusFocus={() => setWbsStatusFocus('全部')}
              />
            )}
            {view === '计划与里程碑' && (
              <Suspense fallback={<ViewLoading label="计划与里程碑" />}>
                <PlanView
                  versionScope={versionScope}
                  tasksData={workspaceTasks}
                  versionConfigs={workspaceVersionConfigs}
                  milestoneFocus={milestoneFocus}
                  onClearMilestoneFocus={() => setMilestoneFocus('')}
                  domain={{
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
                  }}
                />
              </Suspense>
            )}
            {view === '资源与负载' && (
              <ResourceView
                projectName={currentProject?.name ?? '星云客户平台'}
                resourcesData={workspaceResources}
                tasksData={workspaceTasks}
                onResourcesChange={setWorkspaceResources}
                onTasksChange={setWorkspaceTasks}
                versionScope={versionScope}
                onOpenMemberTasks={(owner) => {
                  setWbsOwnerFocus(owner);
                  setVersionScope('portfolio');
                  setView('WBS与任务');
                }}
              />
            )}
            {view === '风险与变更' && (
              <RiskView
                projectName={currentProject?.name ?? '星云客户平台'}
                risksData={workspaceRisks}
                onRisksChange={setWorkspaceRisks}
                changesData={workspaceChanges}
                onChangesChange={setWorkspaceChanges}
                tasksData={workspaceTasks}
                onTasksChange={setWorkspaceTasks}
                changeTaskLinks={workspaceChangeTaskLinks}
                onChangeTaskLinksChange={setWorkspaceChangeTaskLinks}
                taskHierarchy={workspaceTaskHierarchy}
                onTaskHierarchyChange={setWorkspaceTaskHierarchy}
                onOpenChangeTasks={(changeId) => {
                  setWbsChangeFocus(changeId);
                  setWbsOwnerFocus('全部');
                  setWbsStatusFocus('全部');
                  setVersionScope('portfolio');
                  setView('WBS与任务');
                }}
                onReportCreated={(report) =>
                  setWorkspaceReports((current) => [...current, report])
                }
                onChange={openChangeCreation}
                versionScope={versionScope}
                riskFocus={riskFocus}
                canApproveChange={(versionId) =>
                  hasProjectPermission('approve_change', versionId)
                }
                canManageVersion={(versionId) =>
                  hasProjectPermission('manage_version', versionId)
                }
                onClearRiskFocus={() => setRiskFocus('')}
              />
            )}
            {view === '版本与报告' && (
              <Suspense fallback={<ViewLoading label="版本与报告" />}>
                <ReportsView
                  reportsData={workspaceReports}
                  onReport={() => setDialog('report')}
                  versionScope={versionScope}
                  versionsData={projectRoadmap}
                />
              </Suspense>
            )}
            {view === '会议协同' && (
              <Suspense fallback={<ViewLoading label="会议协同" />}>
                <MeetingsView
                  meetingsData={workspaceMeetings}
                  onMeeting={openMeetingCreation}
                  onMeetingUpdated={(meeting) =>
                    setWorkspaceMeetings((current) =>
                      current.map((item) =>
                        item.id === meeting.id ? meeting : item,
                      ),
                    )
                  }
                />
              </Suspense>
            )}
            {view === '集成与自动化' && (
              <Suspense fallback={<ViewLoading label="集成与自动化" />}>
                <IntegrationView />
              </Suspense>
            )}
            {view === '成员与权限' && (
              <Suspense fallback={<ViewLoading label="成员与权限" />}>
                <GovernanceView />
              </Suspense>
            )}
          </div>
        </section>
      </div>

      <Dialog
        open={searchOpen}
        onOpenChange={(open) => {
          setSearchOpen(open);
          if (!open) setSearchQuery('');
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>全局搜索</DialogTitle>
            <DialogDescription>
              搜索任务编号或名称、里程碑、负责人和功能页面。
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="搜索关键词"
            placeholder="例如：2.2、支付、陈默、提测"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {!searchQuery.trim() ? (
              <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                输入关键词开始搜索
              </p>
            ) : globalSearchResults.length === 0 ? (
              <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                没有找到匹配结果
              </p>
            ) : (
              globalSearchResults.map((result) => (
                <button
                  key={result.key}
                  type="button"
                  onClick={() => selectGlobalSearchResult(result)}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:border-primary/40 hover:bg-primary/[0.03]"
                >
                  <Search className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {result.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {result.detail}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'inspection'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="text-primary" />
              AI 项目巡检
            </DialogTitle>
            <DialogDescription>
              将检查计划偏差、依赖阻塞、资源负载和风险闭环状态。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            {[
              `${workspaceTasks.length} 个任务`,
              `${workspaceResources.length} 名成员`,
              `${activeInspectionFindings.length} 项告警`,
            ].map((x) => (
              <div
                key={x}
                className="rounded-lg border bg-muted/40 p-3 text-sm font-medium"
              >
                {x}
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {activeInspectionFindings.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                尚无巡检结果，点击“立即巡检”按当前任务、资源和风险数据生成。
              </div>
            ) : (
              activeInspectionFindings.slice(0, 5).map((item, index) => (
                <div key={item.fingerprint} className="rounded-xl border p-3">
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${item.severity === 'high' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{item.title}</p>
                        <StatusBadge
                          value={item.severity === 'high' ? '高' : '中'}
                        />
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {item.detail}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          责任人：{item.owner}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto h-7 text-xs"
                          onClick={() =>
                            openInspectionTarget(item.finding_type)
                          }
                        >
                          查看对应数据
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            触发口径：版本进度偏差 &gt; 3%；成员负载 &gt; 105%；高风险超过 24
            小时未更新。相同根因合并为一项，避免重复告警。
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button onClick={runInspection} disabled={running}>
              <RefreshCw className={running ? 'animate-spin' : ''} />
              {running ? '巡检中…' : '立即巡检'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'change'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建需求变更</DialogTitle>
            <DialogDescription>
              先登记为“待分析”，随后在闭环台账中启动 AI 评估、审核与版本决策。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              className="sm:col-span-2"
              placeholder="变更标题"
              value={changeDraft.title}
              onChange={(event) =>
                setChangeDraft({ ...changeDraft, title: event.target.value })
              }
              aria-label="变更标题"
            />
            <NativeSelect
              value={changeDraft.priority}
              onChange={(event) =>
                setChangeDraft({ ...changeDraft, priority: event.target.value })
              }
              aria-label="变更优先级"
            >
              <NativeSelectOption value="P0">P0 紧急</NativeSelectOption>
              <NativeSelectOption value="P1">P1 高</NativeSelectOption>
              <NativeSelectOption value="P2">P2 中</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              value={changeDraft.owner}
              onChange={(event) =>
                setChangeDraft({ ...changeDraft, owner: event.target.value })
              }
              aria-label="变更负责人"
            >
              {['林夏', '陈默', '苏禾', '赵一'].map((owner) => (
                <NativeSelectOption key={owner} value={owner}>
                  负责人：{owner}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              value={changeDraft.sourceVersion}
              onChange={(event) => {
                const sourceVersion = event.target
                  .value as ChangeRecord['sourceVersion'];
                setChangeDraft({
                  ...changeDraft,
                  sourceVersion,
                  targetVersion: suggestedChangeTarget(sourceVersion),
                });
              }}
              aria-label="变更来源版本"
            >
              <NativeSelectOption value="v0.9">
                来源：v0.9 Alpha
              </NativeSelectOption>
              <NativeSelectOption value="v1.0">
                来源：v1.0 Beta
              </NativeSelectOption>
              <NativeSelectOption value="v1.1">
                来源：v1.1 Growth
              </NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              value={changeDraft.reviewer}
              onChange={(event) =>
                setChangeDraft({ ...changeDraft, reviewer: event.target.value })
              }
              aria-label="变更审核人"
            >
              <NativeSelectOption value="版本委员会">
                审核：版本委员会
              </NativeSelectOption>
              <NativeSelectOption value="林夏">审核：林夏</NativeSelectOption>
              <NativeSelectOption value="项目委员会">
                审核：项目委员会
              </NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            初始建议目标版本：
            <strong>{versionScopeLabels[changeDraft.targetVersion]}</strong>
            。AI 评估后仍可在闭环台账中调整。
          </div>
          <Textarea
            className="min-h-24"
            placeholder="描述变更内容、业务原因、期望时间和验收目标"
            value={changeDraft.description}
            onChange={(event) =>
              setChangeDraft({
                ...changeDraft,
                description: event.target.value,
              })
            }
            aria-label="变更描述"
          />
          <div className="rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
            创建时只登记原始需求，不直接采纳或修改计划。AI
            分析完成后，审核人才能决定并入当前版本或后续版本。
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button
              onClick={createChangeDraft}
              disabled={
                running ||
                !changeDraft.title.trim() ||
                !changeDraft.description.trim()
              }
            >
              <Plus />
              {running ? '正在创建…' : '创建并进入待分析'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'report'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>生成 AI 项目报告</DialogTitle>
            <DialogDescription>
              自动汇总进展、偏差、里程碑、风险和下阶段计划。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {['日报', '周报', '版本简报'].map((x) => (
              <button
                key={x}
                onClick={() => setReportType(x)}
                className={`rounded-lg border p-3 text-sm font-medium ${reportType === x ? 'border-primary bg-blue-50 text-primary' : ''}`}
              >
                {x}
              </button>
            ))}
          </div>
          <Textarea
            className="min-h-24"
            defaultValue="收件人：项目组、业务负责人\n重点关注：Beta 里程碑、支付接口风险、测试资源缺口"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReportPreviewOpen((current) => !current)}
            >
              预览模板
            </Button>
            <Button onClick={createReport} disabled={running}>
              <Sparkles />
              {running ? '正在生成…' : `生成${reportType}`}
            </Button>
          </DialogFooter>
          {reportPreviewOpen && (
            <div className="rounded-lg border bg-muted/40 p-4 text-xs leading-6">
              <p className="font-semibold">{reportType}模板预览</p>
              <p>1. 本期进展与计划偏差</p>
              <p>2. 里程碑达成与关键路径</p>
              <p>3. 风险、阻塞与资源负载</p>
              <p>4. 下阶段计划及待决策事项</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'meeting'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>预约项目会议</DialogTitle>
            <DialogDescription>
              AI 会结合参会人空闲时间推荐时段并准备议程。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={meetingDraft.title}
            onChange={(event) =>
              setMeetingDraft({ ...meetingDraft, title: event.target.value })
            }
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="date"
              value={meetingDraft.date}
              onChange={(event) =>
                setMeetingDraft({ ...meetingDraft, date: event.target.value })
              }
            />
            <Input
              type="time"
              value={meetingDraft.time}
              onChange={(event) =>
                setMeetingDraft({ ...meetingDraft, time: event.target.value })
              }
            />
          </div>
          <Input
            value={meetingDraft.attendees}
            onChange={(event) =>
              setMeetingDraft({
                ...meetingDraft,
                attendees: event.target.value,
              })
            }
          />
          <Textarea
            value={meetingDraft.agenda}
            onChange={(event) =>
              setMeetingDraft({ ...meetingDraft, agenda: event.target.value })
            }
          />
          <DialogFooter>
            <Button variant="outline" onClick={findCommonAvailability}>
              查找共同空闲
            </Button>
            <Button
              onClick={createMeeting}
              disabled={running || !meetingDraft.title.trim()}
            >
              <CalendarDays />
              {running ? '正在创建…' : '创建会议'}
            </Button>
          </DialogFooter>
          {availabilityNote && (
            <p className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">
              {availabilityNote}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={identityDialogOpen} onOpenChange={setIdentityDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>切换本地测试身份</DialogTitle>
            <DialogDescription>
              仅开发环境可见，用于验证不同角色的页面与操作权限。正式环境不能冒充其他成员。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {developmentIdentities.map((identity) => {
              const isCurrent = identity.id === workspaceUser.id;
              const role =
                identity.id === 'local-user' ? '系统管理员' : '项目经理';
              return (
                <button
                  key={identity.id}
                  type="button"
                  disabled={identitySaving || isCurrent}
                  onClick={() => void selectDevelopmentIdentity(identity)}
                  className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition hover:border-primary/40 hover:bg-primary/[0.03] disabled:cursor-default disabled:bg-muted/40"
                >
                  <span className="flex size-9 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
                    {identity.displayName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {identity.displayName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {identity.email} · {role}
                    </span>
                  </span>
                  {isCurrent && <Badge variant="secondary">当前身份</Badge>}
                </button>
              );
            })}
          </div>
          <div className="border-t pt-4">
            <p className="mb-3 text-sm font-medium">新用户登录</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                aria-label="新用户姓名"
                placeholder="姓名"
                value={identityDraft.displayName}
                onChange={(event) =>
                  setIdentityDraft({
                    ...identityDraft,
                    displayName: event.target.value,
                  })
                }
              />
              <Input
                aria-label="新用户邮箱"
                type="email"
                placeholder="name@example.com"
                value={identityDraft.email}
                onChange={(event) =>
                  setIdentityDraft({
                    ...identityDraft,
                    email: event.target.value,
                  })
                }
              />
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              已邀请邮箱会自动激活；开放模式下的新邮箱会以只读访客加入；邀请制下会被拒绝并提示联系管理员。
            </p>
          </div>
          {identityError && (
            <p className="text-sm text-rose-600">{identityError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIdentityDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={identitySaving}
              onClick={() => void loginDevelopmentIdentity()}
            >
              <LogIn />
              {identitySaving ? '正在登录…' : '以新用户登录'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <output className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-slate-900 p-4 text-sm text-white shadow-2xl">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />
          {toast}
        </output>
      )}
    </main>
  );
}

function Dashboard({
  projectName,
  tasksData,
  risksData,
  onAction,
  versionScope,
  onVersionChange,
  onOpenTasks,
  onOpenMilestones,
  onOpenResources,
  onOpenRisk,
}: {
  projectName: string;
  tasksData: TaskRecord[];
  risksData: typeof risks;
  onAction: (d: 'inspection' | 'change' | 'report' | 'meeting') => void;
  versionScope: VersionScope;
  onVersionChange: (scope: VersionScope) => void;
  onOpenTasks: (status?: string) => void;
  onOpenMilestones: (milestone?: string) => void;
  onOpenResources: () => void;
  onOpenRisk: (riskId?: string) => void;
}) {
  const [baselineKey, setBaselineKey] = useState<BaselineKey>('initial');
  const dynamicProgressTrend = buildTaskProgressTrend(tasksData, versionScope);
  const metrics = versionMetrics[versionScope];
  const scopedTasks =
    versionScope === 'portfolio'
      ? tasksData
      : tasksData.filter((task) => task[3] === versionScope);
  const scopedMilestones =
    versionScope === 'portfolio'
      ? milestones
      : milestones.filter((milestone) => milestone.version === versionScope);
  const dashboardMilestones =
    versionScope === 'portfolio'
      ? scopedMilestones.filter((milestone) => milestone.name.includes('发布'))
      : scopedMilestones.slice(-3);
  const scopedRisks =
    versionScope === 'portfolio'
      ? risksData
      : risksData.filter((risk) => risk.version === versionScope);
  const workState = [
    {
      name: '已完成',
      value: scopedTasks.filter((task) => task[5] === '已完成').length,
      fill: '#10b981',
    },
    {
      name: '进行中',
      value: scopedTasks.filter((task) => task[5] === '进行中').length,
      fill: '#2563eb',
    },
    {
      name: '有阻塞',
      value: scopedTasks.filter((task) => task[5] === '有阻塞').length,
      fill: '#f43f5e',
    },
    {
      name: '未开始',
      value: scopedTasks.filter((task) => task[5] === '未开始').length,
      fill: '#cbd5e1',
    },
  ];
  const timelineAnalysis = versionTimelines[versionScope].map((node, index) => {
    const plan = baselinePlans[versionScope][baselineKey][index];
    const drift = timelineDay(node.actual) - timelineDay(plan);
    return { ...node, plan, drift };
  });
  const cumulativeDelay = timelineAnalysis.reduce(
    (total, node) => total + Math.max(0, node.drift),
    0,
  );
  const delayedNodes = timelineAnalysis.filter((node) => node.drift > 0).length;
  const metricCards: Array<
    [string, string, string, LucideIcon, string, string]
  > = [
    [
      versionScope === 'portfolio' ? '跨版本综合进度' : '版本进度',
      metrics.progress,
      metrics.progressNote,
      Clock3,
      'text-amber-600',
      'bg-amber-50',
    ],
    [
      '里程碑达成',
      metrics.milestones,
      metrics.milestoneNote,
      CheckCircle2,
      'text-emerald-600',
      'bg-emerald-50',
    ],
    [
      '资源投入',
      metrics.effort,
      metrics.effortNote,
      Users,
      'text-blue-600',
      'bg-blue-50',
    ],
  ];

  if (tasksData.length === 0) {
    return (
      <>
        <SectionTitle
          eyebrow={`2026 · ${projectName} · ${versionScopeLabels[versionScope]}`}
          title="项目概览"
          action={<Badge variant="outline">项目初始化完成</Badge>}
        />
        <Card className="border-dashed">
          <CardContent className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <FolderKanban className="size-12 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">开始建立项目执行基线</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              当前项目已经创建了版本空间，但还没有 WBS
              任务。可以先录入任务，或从需求文档自动拆分，再生成里程碑与计划基线。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={() => onOpenTasks('全部')}>
                <ListTree /> 进入 WBS 建任务
              </Button>
              <Button variant="outline" onClick={() => onOpenMilestones()}>
                <CalendarDays /> 配置里程碑
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <SectionTitle
        eyebrow={`2026 · 数字化增长项目群 · ${versionScopeLabels[versionScope]}`}
        title={versionScope === 'portfolio' ? '并行版本概览' : '项目概览'}
        action={
          <div className="flex gap-2">
            <Badge variant="outline" className="px-3 py-2 text-sm">
              {projectName}
            </Badge>
            <Button onClick={() => onAction('report')}>
              <Sparkles />
              生成项目简报
            </Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900">
        <Bot className="size-4 text-primary" />
        <strong>AI 项目脉搏：</strong>
        <span>
          健康度 {metrics.health} 分；{metrics.pulse}
        </span>
        <Button
          size="xs"
          variant="outline"
          className="ml-auto bg-white"
          onClick={() => onAction('inspection')}
        >
          立即巡检
        </Button>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {metricCards.map(([label, value, note, Icon, tone, bg]) => {
          const openDetail = label.includes('进度')
            ? () => onOpenTasks()
            : label.includes('里程碑')
              ? () => onOpenMilestones()
              : onOpenResources;
          return (
            <button
              key={label}
              type="button"
              onClick={openDetail}
              className="rounded-xl text-left outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`查看${label}明细`}
            >
              <Card className="h-full gap-3 transition hover:border-primary/40 hover:shadow-md">
                <CardHeader className="flex-row items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {label}
                  </span>
                  <span className={`rounded-lg p-2 ${bg} ${tone}`}>
                    <Icon className="size-4" />
                  </span>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tracking-tight">{value}</p>
                  <p className={`mt-1 text-xs ${tone}`}>{note}</p>
                  <p className="mt-2 text-[11px] font-medium text-primary">
                    查看明细 →
                  </p>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
      <Card className="mb-5">
        <CardHeader className="flex-row items-start justify-between border-b">
          <div>
            <CardTitle>并行版本态势</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              单击版本查看明细；总览进度按版本计划工时加权，避免简单平均失真
            </p>
          </div>
          <Button
            size="sm"
            variant={versionScope === 'portfolio' ? 'default' : 'outline'}
            onClick={() => onVersionChange('portfolio')}
          >
            查看总览
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {versions.map((version) => {
            const scope = version.name.startsWith('v0.9')
              ? 'v0.9'
              : version.name.startsWith('v1.0')
                ? 'v1.0'
                : 'v1.1';
            const active = versionScope === scope;
            return (
              <button
                key={version.name}
                onClick={() => onVersionChange(scope)}
                className={`rounded-xl border p-4 text-left transition hover:border-primary/50 ${active ? 'border-primary bg-blue-50/60 ring-1 ring-primary/20' : 'bg-background'}`}
              >
                <div className="flex items-center gap-2">
                  <GitBranch className="size-4 text-primary" />
                  <span className="text-sm font-semibold">{version.name}</span>
                  <StatusBadge value={version.state} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {version.scope}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={version.progress} className="flex-1" />
                  <span className="text-xs font-semibold tabular-nums">
                    {version.progress}%
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  目标 {version.date}
                </p>
              </button>
            );
          })}
        </CardContent>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader className="border-b">
            <button
              type="button"
              onClick={() => onOpenMilestones()}
              className="text-left"
            >
              <CardTitle className="transition hover:text-primary">
                计划与实际进度 →
              </CardTitle>
            </button>
            <p className="text-xs text-muted-foreground">
              {versionScope === 'portfolio'
                ? `按当前 WBS ${scopedTasks.length} 项任务、${scopedTasks.reduce((sum, task) => sum + taskEffort(task), 0)}h 动态加权`
                : `${versionScopeLabels[versionScope]} 按当前 WBS 工时、进度和阻塞状态动态重算`}
            </p>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                plan: { label: '计划', color: '#94a3b8' },
                actual: { label: '实际', color: '#2563eb' },
                forecast: { label: 'AI预测', color: '#f59e0b' },
              }}
              className="h-[230px] w-full aspect-auto"
            >
              <AreaChart
                data={dynamicProgressTrend}
                margin={{ left: 0, right: 8, top: 10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="actual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="plan"
                  stroke="#94a3b8"
                  strokeDasharray="5 5"
                  fill="transparent"
                />
                <Area
                  type="monotone"
                  dataKey="actual"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  fill="url(#actual)"
                />
                <Area
                  type="monotone"
                  dataKey="forecast"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  fill="transparent"
                />
              </AreaChart>
            </ChartContainer>
            <div className="mt-1 flex flex-wrap justify-end gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-slate-400" />
                计划基线
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-blue-600" />
                实际进度（截至 {currentDay}）
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 border-t-2 border-dashed border-amber-500" />
                AI 预测
              </span>
            </div>
            <div className="mt-2 border-t pt-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div>
                  <p className="text-sm font-semibold">基准节点时间轴</p>
                  <p className="text-[11px] text-muted-foreground">
                    回溯任一计划快照，对比不可变的实际事件与 AI 预测日期
                  </p>
                </div>
                <NativeSelect
                  className="ml-auto min-w-[170px]"
                  value={baselineKey}
                  onChange={(event) =>
                    setBaselineKey(event.target.value as BaselineKey)
                  }
                  aria-label="选择历史计划基线"
                >
                  {(
                    Object.entries(baselineSnapshots) as [
                      BaselineKey,
                      (typeof baselineSnapshots)[BaselineKey],
                    ][]
                  ).map(([key, snapshot]) => (
                    <NativeSelectOption key={key} value={key}>
                      {snapshot.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    已完成
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-amber-500" />
                    有偏差
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-slate-300" />
                    待开始
                  </span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
                <Badge variant="outline">
                  快照 {baselineSnapshots[baselineKey].savedAt}
                </Badge>
                <span>{baselineSnapshots[baselineKey].note}</span>
                <span className="ml-auto">历史基线只读，不随当前计划覆盖</span>
              </div>
              <div className="overflow-x-auto pb-1">
                <div className="relative mt-5 grid min-w-[760px] grid-cols-6">
                  <div className="absolute left-[8%] right-[8%] top-2 h-px bg-border" />
                  {timelineAnalysis.map((node) => {
                    const tone =
                      node.state === '已完成'
                        ? 'bg-emerald-500 ring-emerald-100'
                        : node.state === '待开始'
                          ? 'bg-slate-300 ring-slate-100'
                          : 'bg-amber-500 ring-amber-100';
                    return (
                      <div
                        key={`${node.name}-${node.plan}`}
                        className="relative px-2 pt-7 text-center"
                      >
                        <span
                          className={`absolute left-1/2 top-0 size-4 -translate-x-1/2 rounded-full border-2 border-white ring-4 ${tone}`}
                        />
                        <p className="text-xs font-semibold">{node.name}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          基线 {node.plan}
                        </p>
                        <p
                          className={`mt-1 text-[11px] font-medium ${node.state === '已完成' ? 'text-emerald-700' : node.state === '待开始' ? 'text-slate-500' : 'text-amber-700'}`}
                        >
                          {node.actual}
                        </p>
                        <p
                          className={`mt-1 text-[10px] font-semibold ${node.drift > 0 ? 'text-rose-600' : node.drift < 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}
                        >
                          {node.drift > 0
                            ? `较基线 +${node.drift} 天`
                            : node.drift < 0
                              ? `较基线提前 ${Math.abs(node.drift)} 天`
                              : '与基线一致'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-[11px] text-muted-foreground">
                    累计节点漂移
                  </p>
                  <p
                    className={`mt-1 text-lg font-bold ${cumulativeDelay > 0 ? 'text-rose-600' : 'text-emerald-600'}`}
                  >
                    +{cumulativeDelay} 天
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[11px] text-muted-foreground">
                    发生延期的节点
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    {delayedNodes} / {timelineAnalysis.length}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] text-amber-700">AI 风险传导判断</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-amber-900">
                    技术评审偏差已传导至联调；若支付沙箱再晚 1
                    天，发版延期概率将升至 71%。
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <button
              type="button"
              onClick={() => onOpenTasks()}
              className="text-left"
            >
              <CardTitle className="transition hover:text-primary">
                任务状态分布 →
              </CardTitle>
            </button>
            <p className="text-xs text-muted-foreground">
              {scopedTasks.length} 项任务 ·{' '}
              {scopedTasks.filter((task) => task[5] === '有阻塞').length} 项阻塞
            </p>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <ChartContainer
              config={{}}
              className="h-[190px] w-[55%] aspect-auto"
            >
              <PieChart>
                <Pie
                  data={workState}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={47}
                  outerRadius={72}
                  paddingAngle={3}
                  className="cursor-pointer"
                  onClick={(entry) => onOpenTasks(String(entry.name))}
                />
                <ChartTooltip
                  content={<ChartTooltipContent nameKey="name" />}
                />
              </PieChart>
            </ChartContainer>
            <div className="flex-1 space-y-3">
              {workState.map((x) => (
                <button
                  key={x.name}
                  type="button"
                  onClick={() => onOpenTasks(x.name)}
                  className="flex w-full items-center rounded-md p-1 text-left text-xs transition hover:bg-muted"
                >
                  <span
                    className="mr-2 size-2 rounded-full"
                    style={{ background: x.fill }}
                  />
                  <span className="text-muted-foreground">{x.name}</span>
                  <strong className="ml-auto">{x.value}</strong>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <button
              type="button"
              onClick={() => onOpenMilestones()}
              className="text-left"
            >
              <CardTitle className="transition hover:text-primary">
                关键里程碑 →
              </CardTitle>
            </button>
          </CardHeader>
          <CardContent className="space-y-4">
            {dashboardMilestones.map((x) => (
              <button
                key={`${x.version}-${x.name}`}
                type="button"
                onClick={() => onOpenMilestones(x.name)}
                className="block w-full rounded-lg p-2 text-left transition hover:bg-muted"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium">{x.name}</span>
                  <StatusBadge value={x.state} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {x.date}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Progress value={x.progress} className="flex-1" />
                  <span className="w-8 text-xs tabular-nums">
                    {x.progress}%
                  </span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card className="border-rose-200">
          <CardHeader className="border-b bg-rose-50/60">
            <button
              type="button"
              onClick={() => onOpenRisk()}
              className="text-left"
            >
              <CardTitle className="flex items-center gap-2 transition hover:text-primary">
                <Activity className="size-4 text-rose-600" />
                AI 风险雷达 →
              </CardTitle>
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            {scopedRisks.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => onOpenRisk(x.id)}
                className="block w-full rounded-lg border p-3 text-left transition hover:border-rose-300 hover:bg-rose-50/50"
              >
                <div className="flex gap-2">
                  <StatusBadge value={x.level} />
                  <p className="text-sm font-medium">{x.title}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {x.impact} · {x.owner}
                </p>
              </button>
            ))}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onAction('change')}
            >
              新建需求变更
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ResourceView({
  projectName,
  resourcesData,
  tasksData,
  onResourcesChange,
  onTasksChange,
  versionScope,
  onOpenMemberTasks,
}: {
  projectName: string;
  resourcesData: typeof resources;
  tasksData: TaskRecord[];
  onResourcesChange: (records: ResourceRecord[]) => void;
  onTasksChange: (records: TaskRecord[]) => void;
  versionScope: VersionScope;
  onOpenMemberTasks: (owner: string) => void;
}) {
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [savingSuggestion, setSavingSuggestion] = useState(false);
  const [suggestionMessage, setSuggestionMessage] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [directorySource, setDirectorySource] = useState('飞书');
  const [syncingDirectory, setSyncingDirectory] = useState(false);
  const [directoryMessage, setDirectoryMessage] = useState('');
  const [memberDraft, setMemberDraft] = useState({
    name: '',
    role: '前端开发',
    level: '中级 · P5',
    project: projectName,
    joinedAt: '2026-09-11',
    skills: 'React',
    domains: '会员中心',
  });
  const [roleFilter, setRoleFilter] = useState('全部角色');
  const [matchScenario, setMatchScenario] =
    useState<keyof typeof resourceMatchScenarios>('payment');
  const scenario = resourceMatchScenarios[matchScenario];
  const allocationTaskId = 'AI-ALLOC-20H';
  const allocationTask = tasksData.find((task) => task[0] === allocationTaskId);
  const suggestionAdopted = Boolean(allocationTask);
  const normalizedResources = resourcesData.map((resource) => ({
    ...resource,
    memberStatus: resource.memberStatus ?? ('在职' as const),
    source: resource.source ?? '工作台',
  }));
  const visibleResources = normalizedResources.filter(
    (resource) => roleFilter === '全部角色' || resource.role === roleFilter,
  );
  const matches = normalizedResources
    .filter((resource) => resource.role === scenario.role)
    .map((resource) => {
      const matchedTags = [...resource.skills, ...resource.domains].filter(
        (tag) => scenario.needs.includes(tag),
      );
      const score = Math.min(
        98,
        48 +
          matchedTags.length * 12 +
          Math.round(resource.available / 6) -
          (resource.load > 100 ? 18 : 0),
      );
      return { resource, matchedTags, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const handoverMembers = normalizedResources
    .filter((resource) => resource.memberStatus === '离职待交接')
    .map((resource) => ({
      resource,
      tasks: tasksData.filter(
        (task) =>
          task[5] !== '已完成' && task[4].split('、').includes(resource.name),
      ),
    }));

  async function saveResources(
    records: ResourceRecord[],
    action: 'upsert_resource' | 'sync_directory_members',
  ) {
    const response = await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        resource: action === 'upsert_resource' ? records[0] : undefined,
        resources: action === 'sync_directory_members' ? records : undefined,
      }),
    });
    if (!response.ok) throw new Error('成员信息保存失败');
  }

  async function addMember() {
    const resource: ResourceRecord = {
      name: memberDraft.name.trim(),
      role: memberDraft.role,
      level: memberDraft.level,
      project: memberDraft.project,
      load: 0,
      available: 80,
      allocation: { 'v0.9': 0, 'v1.0': 0, 'v1.1': 0 },
      skills: memberDraft.skills
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
      domains: memberDraft.domains
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
      risk: '',
      memberStatus: '新入职',
      source: '工作台',
      joinedAt: memberDraft.joinedAt,
    };
    try {
      await saveResources([resource], 'upsert_resource');
      onResourcesChange([
        ...resourcesData.filter((item) => item.name !== resource.name),
        resource,
      ]);
      setMemberDraft({ ...memberDraft, name: '' });
      setDirectoryMessage(
        `${resource.name} 已添加，当前按 50% 爬坡产能参与 AI 调配。`,
      );
    } catch (error) {
      setDirectoryMessage(
        error instanceof Error ? error.message : '成员信息保存失败',
      );
    }
  }

  async function syncDirectory() {
    setSyncingDirectory(true);
    setDirectoryMessage('');
    const now = new Date().toISOString();
    const updated: ResourceRecord[] = normalizedResources.map((resource) =>
      resource.name === '顾言'
        ? {
            ...resource,
            memberStatus: '离职待交接' as const,
            source: directorySource,
            statusChangedAt: now,
          }
        : resource,
    );
    const newcomer: ResourceRecord = {
      name: '沈知',
      role: '前端开发',
      level: '高级 · P6',
      project: projectName,
      load: 0,
      available: 40,
      allocation: { 'v0.9': 0, 'v1.0': 0, 'v1.1': 0 },
      skills: ['React', 'TypeScript', '微前端'],
      domains: ['会员中心', '收银台'],
      risk: '',
      memberStatus: '新入职',
      source: directorySource,
      joinedAt: shanghaiNow().date,
      statusChangedAt: now,
    };
    if (!updated.some((resource) => resource.name === newcomer.name)) {
      updated.push(newcomer);
    }
    try {
      await saveResources(updated, 'sync_directory_members');
      onResourcesChange(updated);
      const openTasks = tasksData.filter(
        (task) => task[5] !== '已完成' && task[4].split('、').includes('顾言'),
      ).length;
      setDirectoryMessage(
        `${directorySource}同步完成：新增沈知；顾言标记为离职待交接，发现 ${openTasks} 项未完成任务。`,
      );
    } catch (error) {
      setDirectoryMessage(
        error instanceof Error ? error.message : '通讯录同步失败',
      );
    } finally {
      setSyncingDirectory(false);
    }
  }

  async function adoptResourceSuggestion() {
    const source = normalizedResources.find((item) => item.name === '赵一');
    const target = normalizedResources.find((item) => item.name === '周琪');
    if (!source || !target) {
      setSuggestionMessage('缺少赵一或周琪的资源记录，无法生成调配任务。');
      return;
    }
    const now = shanghaiNow();
    const task: TaskRecord = [
      allocationTaskId,
      '兼容性测试资源交接与执行',
      projectName,
      'v1.0',
      '周琪',
      '未开始',
      '高',
      now.monthDay,
      isoDateToMonthDay(addCalendarDays(now.date, 3)),
      '0%',
      '20h',
      '3.2',
      '中',
    ];
    const updatedResources = normalizedResources.map((resource) => {
      if (resource.name === source.name) {
        return {
          ...resource,
          load: Math.max(0, resource.load - 20),
          available: resource.available + 20,
          allocation: {
            ...resource.allocation,
            'v1.0': Math.max(0, resource.allocation['v1.0'] - 20),
          },
          risk: resource.load - 20 > 105 ? resource.risk : '',
        };
      }
      if (resource.name === target.name) {
        return {
          ...resource,
          load: resource.load + 20,
          available: Math.max(0, resource.available - 20),
          allocation: {
            ...resource.allocation,
            'v1.0': resource.allocation['v1.0'] + 20,
          },
        };
      }
      return resource;
    });
    setSavingSuggestion(true);
    setSuggestionMessage('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply_resource_reallocation',
          task,
          resources: updatedResources.filter((resource) =>
            ['赵一', '周琪'].includes(resource.name),
          ),
          detail: '将 20h 兼容性测试从赵一转交周琪',
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          detail?: string;
          message?: string;
        } | null;
        throw new Error(
          body?.message ?? body?.detail ?? '资源调配任务创建失败',
        );
      }
      onResourcesChange(updatedResources);
      onTasksChange([
        ...tasksData.filter((item) => item[0] !== allocationTaskId),
        task,
      ]);
      setSuggestionMessage(
        '调配已生效：WBS 任务已创建，两人的负载与 v1.0 分配已更新。',
      );
    } catch (error) {
      setSuggestionMessage(
        error instanceof Error ? error.message : '资源调配任务创建失败',
      );
    } finally {
      setSavingSuggestion(false);
    }
  }

  return (
    <>
      <SectionTitle
        eyebrow="Capacity · Allocation · Forecast"
        title="资源与负载"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMemberDraft((current) => ({
                  ...current,
                  joinedAt: shanghaiNow().date,
                }));
                setMemberDialogOpen(true);
              }}
            >
              <Settings />
              成员管理
            </Button>
            <Button variant="outline" onClick={() => setProfileOpen(true)}>
              <Users />
              成员能力画像
            </Button>
            <Button
              variant={showSuggestion ? 'default' : 'outline'}
              onClick={() => setShowSuggestion(!showSuggestion)}
            >
              <Sparkles />
              {showSuggestion ? '收起建议' : 'AI 调配建议'}
            </Button>
          </div>
        }
      />
      {handoverMembers.length > 0 && (
        <Card className="mb-5 border-rose-200 bg-rose-50/50">
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-rose-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-rose-900">
                  人员变动提醒：发现离职待交接成员
                </p>
                <p className="mt-1 text-xs text-rose-800">
                  系统已停止向其分配新任务；历史记录保留，未完成任务需要确认接手人后才能完成离职归档。
                </p>
              </div>
            </div>
            {handoverMembers.map(({ resource, tasks }) => (
              <div
                key={resource.name}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-white p-3 text-xs"
              >
                <strong>{resource.name}</strong>
                <Badge className="bg-rose-100 text-rose-700">离职待交接</Badge>
                <span className="text-muted-foreground">
                  {tasks.length} 项未完成任务 · {resource.risk || '无单点风险'}
                </span>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => onOpenMemberTasks(resource.name)}
                >
                  查看任务并发起交接
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {showSuggestion && (
        <Card className="mb-5 border-blue-200 bg-blue-50/40">
          <CardContent className="flex flex-wrap items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-blue-100 text-primary">
              <WandSparkles className="size-5" />
            </div>
            <div className="min-w-[260px] flex-1">
              <p className="text-sm font-semibold">
                推荐将 20h 兼容性测试从赵一转交周琪
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                赵一总负载预计从 112% 降至 92%，v1.0 按期发布概率从 63% 提升至
                78%；不影响 v1.1 范围冻结。
              </p>
            </div>
            <Button
              disabled={suggestionAdopted || savingSuggestion}
              onClick={adoptResourceSuggestion}
            >
              <ClipboardCheck />
              {savingSuggestion
                ? '正在写入…'
                : suggestionAdopted
                  ? '调配任务已生效'
                  : '采纳并生成任务'}
            </Button>
            {suggestionMessage && (
              <p
                className={`w-full text-xs ${suggestionAdopted ? 'text-emerald-700' : 'text-rose-600'}`}
              >
                {suggestionMessage}
              </p>
            )}
            {suggestionAdopted && (
              <div className="flex w-full flex-wrap items-center gap-2 border-t border-blue-200 pt-3 text-xs text-blue-800">
                <Badge variant="outline">WBS {allocationTaskId}</Badge>
                <span>周琪 · 20h · v1.0 · 截止 {allocationTask?.[8]}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto bg-white"
                  onClick={() => onOpenMemberTasks('周琪')}
                >
                  查看调配任务
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[min(1180px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="text-primary" />
              成员能力画像与 AI 匹配
            </DialogTitle>
            <DialogDescription>
              按角色查看技术能力、业务经验、可用产能和单点风险，并针对具体任务生成候选人排序。
            </DialogDescription>
          </DialogHeader>
          <Card>
            <CardHeader className="flex-row flex-wrap items-center gap-3 border-b">
              <div>
                <CardTitle>成员能力画像与 AI 匹配</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  标签来自履历、历史任务、代码贡献和负责人校准；AI
                  推荐必须同时考虑能力与可用产能
                </p>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <NativeSelect
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                  aria-label="筛选成员角色"
                >
                  {[
                    '全部角色',
                    '前端开发',
                    '后端开发',
                    '测试工程师',
                    '数据开发',
                  ].map((role) => (
                    <NativeSelectOption key={role} value={role}>
                      {role}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect
                  value={matchScenario}
                  onChange={(event) =>
                    setMatchScenario(
                      event.target.value as keyof typeof resourceMatchScenarios,
                    )
                  }
                  aria-label="选择待匹配任务"
                  className="min-w-[190px]"
                >
                  {Object.entries(resourceMatchScenarios).map(
                    ([key, value]) => (
                      <NativeSelectOption key={key} value={key}>
                        匹配：{value.label}
                      </NativeSelectOption>
                    ),
                  )}
                </NativeSelect>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 xl:grid-cols-[1.45fr_0.8fr]">
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {visibleResources.map((resource) => (
                  <div key={resource.name} className="rounded-xl border p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
                        {resource.name.slice(0, 1)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">
                            {resource.name}
                          </p>
                          <span className="text-[11px] text-muted-foreground">
                            {resource.level}
                          </span>
                          {resource.memberStatus !== '在职' && (
                            <StatusBadge value={resource.memberStatus} />
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {resource.role} · 可用 {resource.available}h
                        </p>
                      </div>
                      {resource.risk && (
                        <Badge className="bg-amber-100 text-amber-700">
                          {resource.risk}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {resource.skills.map((skill) => (
                        <Badge
                          key={skill}
                          variant="outline"
                          className="bg-blue-50 text-blue-700"
                        >
                          {skill}
                        </Badge>
                      ))}
                      {resource.domains.map((domain) => (
                        <Badge key={domain} variant="outline">
                          {domain}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border bg-slate-950 p-4 text-white">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-blue-300" />
                  <p className="text-sm font-semibold">
                    AI 推荐 · {scenario.label}
                  </p>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-400">
                  所需标签：{scenario.needs.join('、')}
                </p>
                <div className="mt-4 space-y-3">
                  {matches.map(({ resource, matchedTags, score }, index) => (
                    <div
                      key={resource.name}
                      className="rounded-lg border border-slate-700 bg-slate-900 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex size-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold">
                          {index + 1}
                        </span>
                        <p className="text-sm font-semibold">{resource.name}</p>
                        <span className="text-xs text-slate-400">
                          {resource.level}
                        </span>
                        <strong className="ml-auto text-emerald-400">
                          {score}%
                        </strong>
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-slate-300">
                        命中{' '}
                        {matchedTags.length
                          ? matchedTags.join('、')
                          : '同岗位基础能力'}
                        ；当前可用 {resource.available}h
                        {resource.risk
                          ? `；注意 ${resource.risk}`
                          : '；无关键约束'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>
      <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>成员管理与通讯录同步</DialogTitle>
            <DialogDescription>
              新增成员、同步飞书/钉钉任职状态，并识别需要交接的未完成任务。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-3">
            <NativeSelect
              value={directorySource}
              onChange={(event) => setDirectorySource(event.target.value)}
              aria-label="通讯录来源"
            >
              <NativeSelectOption value="飞书">飞书通讯录</NativeSelectOption>
              <NativeSelectOption value="钉钉">钉钉通讯录</NativeSelectOption>
            </NativeSelect>
            <Button onClick={syncDirectory} disabled={syncingDirectory}>
              <RefreshCw className={syncingDirectory ? 'animate-spin' : ''} />
              {syncingDirectory ? '正在同步…' : '立即同步通讯录'}
            </Button>
            <span className="text-xs text-muted-foreground">
              演示同步：新增沈知，并检测顾言进入离职待交接
            </span>
          </div>
          {directoryMessage && (
            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
              {directoryMessage}
            </div>
          )}
          <Card>
            <CardHeader className="border-b">
              <CardTitle>手工新增成员</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                placeholder="成员姓名"
                value={memberDraft.name}
                onChange={(event) =>
                  setMemberDraft({ ...memberDraft, name: event.target.value })
                }
              />
              <NativeSelect
                value={memberDraft.role}
                onChange={(event) =>
                  setMemberDraft({ ...memberDraft, role: event.target.value })
                }
              >
                {[
                  '前端开发',
                  '后端开发',
                  '测试工程师',
                  '数据开发',
                  '产品经理',
                ].map((role) => (
                  <NativeSelectOption key={role} value={role}>
                    {role}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Input
                value={memberDraft.level}
                onChange={(event) =>
                  setMemberDraft({ ...memberDraft, level: event.target.value })
                }
                aria-label="成员职级"
              />
              <Input
                type="date"
                value={memberDraft.joinedAt}
                onChange={(event) =>
                  setMemberDraft({
                    ...memberDraft,
                    joinedAt: event.target.value,
                  })
                }
                aria-label="入职日期"
              />
              <Input
                value={memberDraft.skills}
                onChange={(event) =>
                  setMemberDraft({ ...memberDraft, skills: event.target.value })
                }
                placeholder="技能标签，用逗号分隔"
              />
              <Input
                value={memberDraft.domains}
                onChange={(event) =>
                  setMemberDraft({
                    ...memberDraft,
                    domains: event.target.value,
                  })
                }
                placeholder="业务领域，用逗号分隔"
              />
              <Button
                className="lg:col-span-2"
                onClick={addMember}
                disabled={!memberDraft.name.trim()}
              >
                <Plus /> 新增成员
              </Button>
            </CardContent>
          </Card>
          <div className="space-y-2">
            {normalizedResources.map((resource) => {
              const openTasks = tasksData.filter(
                (task) =>
                  task[5] !== '已完成' &&
                  task[4].split('、').includes(resource.name),
              ).length;
              return (
                <div
                  key={resource.name}
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-xs"
                >
                  <strong className="text-sm">{resource.name}</strong>
                  <span>{resource.role}</span>
                  <StatusBadge value={resource.memberStatus} />
                  <span className="text-muted-foreground">
                    来源：{resource.source} · 未完成任务 {openTasks} 项
                  </span>
                  {resource.memberStatus === '离职待交接' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => onOpenMemberTasks(resource.name)}
                    >
                      发起任务交接
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>团队负载</CardTitle>
            <p className="text-xs text-muted-foreground">
              {versionScope === 'portfolio'
                ? '跨版本总负载 · AI 已识别 2 名成员过载 · 点击成员查看任务'
                : `${versionScopeLabels[versionScope]} 的成员投入占比 · 点击成员查看任务`}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {visibleResources.map((r) =>
              (() => {
                const load =
                  versionScope === 'portfolio'
                    ? r.load
                    : r.allocation[versionScope];
                return (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => onOpenMemberTasks(r.name)}
                    aria-label={`查看${r.name}的 WBS 任务`}
                    className="grid w-full grid-cols-[100px_1fr_56px] items-center gap-3 rounded-lg p-2 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div>
                      <div className="flex items-center gap-1">
                        <p className="text-sm font-medium">{r.name}</p>
                        {r.memberStatus !== '在职' && (
                          <span className="size-2 rounded-full bg-rose-500" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {r.role}
                      </p>
                    </div>
                    <div>
                      <Progress value={Math.min(load, 100)} />
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {versionScope === 'portfolio'
                          ? r.project
                          : `${versionScopeLabels[versionScope]} · 跨版本总负载 ${r.load}%`}
                      </p>
                    </div>
                    <span
                      className={`text-right text-xs font-semibold ${load > 100 ? 'text-rose-600' : 'text-foreground'}`}
                    >
                      {load}%
                    </span>
                  </button>
                );
              })(),
            )}
            <div className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">
              <strong>AI 建议：</strong>
              将赵一负责的“数据看板兼容性测试”转交周琪，可释放 20 小时并把 Beta
              按期概率提升至 78%。
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>角色可用产能</CardTitle>
            <p className="text-xs text-muted-foreground">
              未来两周剩余可用工时
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              ['产品与设计', 50, 32],
              ['前端开发', 96, 18],
              ['后端开发', 112, 0],
              ['测试与质量', 80, 8],
              ['数据开发', 72, 26],
            ].map(([name, total, free]) => (
              <div key={String(name)}>
                <div className="mb-2 flex items-center text-sm">
                  <span>{name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    可用 {free}h / {total}h
                  </span>
                </div>
                <Progress
                  value={((Number(total) - Number(free)) / Number(total)) * 100}
                />
              </div>
            ))}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              <strong>产能预警：</strong>
              后端开发暂无空余产能，测试角色仅余 8
              小时；建议优先处理关键路径任务。
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function RiskView({
  projectName,
  risksData,
  onRisksChange,
  changesData,
  onChangesChange,
  tasksData,
  onTasksChange,
  changeTaskLinks,
  onChangeTaskLinksChange,
  taskHierarchy,
  onTaskHierarchyChange,
  onOpenChangeTasks,
  onReportCreated,
  onChange,
  versionScope,
  riskFocus,
  canApproveChange,
  canManageVersion,
  onClearRiskFocus,
}: {
  projectName: string;
  risksData: typeof risks;
  onRisksChange: (records: typeof risks) => void;
  changesData: ChangeRecord[];
  onChangesChange: (changes: ChangeRecord[]) => void;
  tasksData: TaskRecord[];
  onTasksChange: (tasks: TaskRecord[]) => void;
  changeTaskLinks: ChangeTaskLink[];
  onChangeTaskLinksChange: (links: ChangeTaskLink[]) => void;
  taskHierarchy: TaskHierarchyRecord[];
  onTaskHierarchyChange: (records: TaskHierarchyRecord[]) => void;
  onOpenChangeTasks: (changeId: string) => void;
  onReportCreated: (report: ReportRecord) => void;
  onChange: () => void;
  versionScope: VersionScope;
  riskFocus: string;
  canApproveChange: (versionId: VersionId) => boolean;
  canManageVersion: (versionId: VersionId) => boolean;
  onClearRiskFocus: () => void;
}) {
  const [scenarioDays, setScenarioDays] = useState(4);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [savingRecommendation, setSavingRecommendation] = useState(false);
  const [riskDialogOpen, setRiskDialogOpen] = useState(false);
  const [savingRisk, setSavingRisk] = useState(false);
  const [savingChange, setSavingChange] = useState('');
  const [changeTargets, setChangeTargets] = useState<Record<string, string>>(
    {},
  );
  const [riskSaveError, setRiskSaveError] = useState('');
  const autoAdvancedChanges = useRef(new Set<string>());
  const [riskDraft, setRiskDraft] = useState({
    title: '',
    owner: '林夏',
    version: versionScope === 'portfolio' ? 'v1.0' : versionScope,
    impact: '',
  });
  const allRisks = risksData;
  const versionRisks =
    versionScope === 'portfolio'
      ? allRisks
      : allRisks.filter((risk) => risk.version === versionScope);
  const visibleRisks = riskFocus
    ? versionRisks.filter((risk) => risk.id === riskFocus)
    : versionRisks;
  const visibleChanges = changesData.filter(
    (change) =>
      versionScope === 'portfolio' ||
      change.sourceVersion === versionScope ||
      change.targetVersion === versionScope,
  );
  const selectedTargetVersion = (change: ChangeRecord) =>
    (changeTargets[change.id] ??
      change.targetVersion) as ChangeRecord['targetVersion'];
  const changePermissionHint = (change: ChangeRecord) => {
    const targetVersion = selectedTargetVersion(change);
    if (change.currentStep === 1 && !canApproveChange(targetVersion)) {
      return `当前身份没有 ${versionScopeLabels[targetVersion]} 的需求变更审核权限，请系统管理员在“成员与权限”中授权。`;
    }
    if (change.currentStep === 2 && !canManageVersion(targetVersion)) {
      return `当前身份没有 ${versionScopeLabels[targetVersion]} 的版本计划调整权限，请系统管理员在“成员与权限”中授权。`;
    }
    return '';
  };

  const persistChange = useCallback(
    async (newChange: ChangeRecord) => {
      setSavingChange(newChange.id);
      setRiskSaveError('');
      try {
        const response = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_change', change: newChange }),
        });
        if (!response.ok) {
          const result = (await response.json().catch(() => null)) as {
            detail?: string;
            message?: string;
          } | null;
          const detail = result?.detail ?? result?.message ?? '';
          if (
            response.status === 403 &&
            (detail.includes('approve_change') ||
              detail === 'project_permission_required')
          ) {
            throw new Error(
              `当前身份没有 ${newChange.targetVersion} 需求变更审核权限，请联系系统管理员授权。`,
            );
          }
          if (response.status === 403) {
            throw new Error('当前身份无权执行此操作，请联系系统管理员授权。');
          }
          throw new Error(detail || '变更流程更新失败');
        }
        onChangesChange(
          changesData.map((change) =>
            change.id === newChange.id ? newChange : change,
          ),
        );
        return true;
      } catch (error) {
        setRiskSaveError(
          error instanceof Error ? error.message : '变更流程更新失败',
        );
        return false;
      } finally {
        setSavingChange('');
      }
    },
    [changesData, onChangesChange],
  );

  useEffect(() => {
    const readyChange = changesData.find((change) => {
      if (
        change.currentStep !== 4 ||
        !change.wbsAppliedTaskIds?.length ||
        autoAdvancedChanges.current.has(change.id)
      ) {
        return false;
      }
      return change.wbsAppliedTaskIds.every(
        (taskId) =>
          tasksData.find((task) => task[0] === taskId)?.[5] === '已完成',
      );
    });
    const appliedCount = readyChange?.wbsAppliedTaskIds?.length;
    if (!readyChange || !appliedCount) return;
    autoAdvancedChanges.current.add(readyChange.id);
    const nextChange: ChangeRecord = {
      ...readyChange,
      currentStep: 5,
      status: '待验收',
      updatedAt: new Date().toISOString(),
      history: [
        ...readyChange.history,
        {
          step: 5,
          action: 'WBS 实施任务全部完成',
          actor: 'AI 巡检助手',
          at: new Date().toLocaleString('zh-CN'),
          note: `关联 ${appliedCount} 项任务已全部完成，自动提交验收`,
        },
      ],
    };
    void persistChange(nextChange).then((saved) => {
      if (!saved) autoAdvancedChanges.current.delete(readyChange.id);
    });
  }, [changesData, persistChange, tasksData]);

  async function advanceChange(change: ChangeRecord) {
    const nextStep = Math.min(6, change.currentStep + 1);
    const statuses = [
      '待补充',
      '待审核',
      '已采纳',
      '计划已调整',
      '实施中',
      '待归档',
      '已归档',
    ];
    const actions = [
      '重新分析',
      'AI 分析评估',
      '审核采纳',
      '调整版本计划',
      '开始实施',
      '实施完成并验收',
      '验收归档',
    ];
    const targetVersion = (changeTargets[change.id] ??
      change.targetVersion) as ChangeRecord['targetVersion'];
    const wbsDraft = effectiveChangeWbsDraft(
      change,
      targetVersion,
      projectName,
    );
    if (nextStep === 3) {
      await applyChangeWbs(change, targetVersion, wbsDraft);
      return;
    }
    const nextChange: ChangeRecord = {
      ...change,
      ...(nextStep === 1
        ? {
            scheduleImpact: '+5 工作日',
            resourceImpact: '4 项任务 / 3 人',
            affectedTasks: ['2.1', '3.2', '4.1', '4.2'],
            recommendation: `建议并入 ${versionScopeLabels[targetVersion]}，通过并行实施和资源调配降低当前版本延期风险。`,
          }
        : {}),
      targetVersion,
      ...(nextStep >= 2 ? { wbsDraft } : {}),
      currentStep: nextStep,
      status: statuses[nextStep],
      updatedAt: new Date().toISOString(),
      history: [
        ...change.history,
        {
          step: nextStep,
          action: actions[nextStep],
          actor:
            nextStep === 1
              ? 'AI'
              : nextStep === 2
                ? change.reviewer
                : change.owner,
          at: new Date().toLocaleString('zh-CN'),
          note:
            nextStep === 2
              ? `审核通过，并入 ${versionScopeLabels[targetVersion]}`
              : nextStep === 3
                ? `已确认 WBS 调整草案并生成 ${targetVersion} 变更后版本计划基线`
                : nextStep === 4
                  ? `关联 ${change.affectedTasks.join('、')} 进入实施跟踪`
                  : nextStep === 6
                    ? '实施结果验收通过，材料完整归档'
                    : actions[nextStep],
        },
      ],
    };
    if (!(await persistChange(nextChange))) return;
    if (nextStep === 1) {
      const report: ReportRecord = {
        id: createRecordId(`REPORT-${change.id}`),
        type: '需求变更分析',
        version: change.sourceVersion,
        summary: `${change.id} ${change.title}：工期预计 +5 工作日，波及 4 项任务与 3 名成员；建议并入 ${versionScopeLabels[targetVersion]}。`,
        createdAt: new Date().toISOString(),
      };
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_report', report }),
      });
      if (response.ok) onReportCreated(report);
      else setRiskSaveError('分析已完成，但分析报告归档失败');
    }
    if (nextStep === 3) {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_plan_baseline',
          versionId: targetVersion,
          baselineKey: `CHANGE-${change.id}`,
          label: `${change.id} 采纳后计划`,
          snapshot: {
            ...versionReleasePlans[targetVersion],
            changeId: change.id,
            reason: change.title,
            scheduleImpact: change.scheduleImpact,
            adjustedAt: new Date().toISOString(),
          },
        }),
      });
      if (!response.ok) setRiskSaveError('变更已推进，但计划基线写入失败');
    }
  }

  async function applyChangeWbs(
    change: ChangeRecord,
    targetVersion: ChangeRecord['targetVersion'],
    draft: ChangeWbsDraftItem[],
  ) {
    setSavingChange(change.id);
    setRiskSaveError('');
    const now = new Date().toISOString();
    const newTasks = draft.map((item) => item.task);
    const appliedTaskIds = draft
      .filter((item) => item.parentTaskId !== null)
      .map((item) => item.task[0]);
    const nextChange: ChangeRecord = {
      ...change,
      targetVersion,
      currentStep: 3,
      status: '计划已调整',
      wbsDraft: draft,
      wbsAppliedAt: now,
      wbsAppliedTaskIds: appliedTaskIds,
      updatedAt: now,
      history: [
        ...change.history,
        {
          step: 3,
          action: '确认 WBS 草案并调整计划',
          actor: change.owner,
          at: new Date().toLocaleString('zh-CN'),
          note: `新增 1 项父任务与 ${appliedTaskIds.length} 项子任务，目标版本 ${versionScopeLabels[targetVersion]}`,
        },
      ],
    };
    const sourceLinks = change.affectedTasks.map((taskId) => ({
      id: `${change.id}-${taskId}-impact`,
      taskId,
      relationType: '受影响',
      note: `${change.id} AI 影响分析识别`,
    }));
    const createdLinks = draft.map((item) => ({
      id: `${change.id}-${item.task[0]}-created`,
      taskId: item.task[0],
      relationType: '变更新增',
      note: item.reason,
    }));
    const hierarchy = draft.map((item, index) => ({
      taskId: item.task[0],
      parentTaskId: item.parentTaskId,
      rootTaskId: `${change.id}-WBS`,
      level: item.parentTaskId ? 1 : 0,
      sortOrder: index,
      workType: item.workType,
      acceptanceCriteria: item.acceptanceCriteria,
    }));
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply_change_wbs',
          change: nextChange,
          tasks: newTasks,
          links: [...sourceLinks, ...createdLinks],
          hierarchy,
        }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          detail?: string;
          message?: string;
        } | null;
        if (response.status === 403) {
          throw new Error(
            `当前身份没有 ${versionScopeLabels[targetVersion]} 的版本计划调整权限，请联系系统管理员授权。`,
          );
        }
        throw new Error(
          result?.detail ?? result?.message ?? 'WBS 调整草案写入失败',
        );
      }
      const existingIds = new Set(tasksData.map((task) => task[0]));
      onTasksChange([
        ...tasksData,
        ...newTasks.filter((task) => !existingIds.has(task[0])),
      ]);
      onChangesChange(
        changesData.map((item) =>
          item.id === nextChange.id ? nextChange : item,
        ),
      );
      const localLinks: ChangeTaskLink[] = [
        ...sourceLinks,
        ...createdLinks,
      ].map((link) => ({
        id: link.id,
        project_id: 'nebula-customer-platform',
        change_id: change.id,
        task_id: link.taskId,
        relation_type: link.relationType,
        note: link.note,
        created_at: now,
      }));
      const linkIds = new Set(localLinks.map((link) => link.id));
      onChangeTaskLinksChange([
        ...changeTaskLinks.filter((link) => !linkIds.has(link.id)),
        ...localLinks,
      ]);
      const localHierarchy = hierarchy.map((record) => ({
        task_id: record.taskId,
        project_id: 'nebula-customer-platform',
        parent_task_id: record.parentTaskId,
        root_task_id: record.rootTaskId,
        level: record.level,
        sort_order: record.sortOrder,
        work_type: record.workType,
        acceptance_criteria: record.acceptanceCriteria,
        created_at: now,
        updated_at: now,
      }));
      const hierarchyIds = new Set(
        localHierarchy.map((record) => record.task_id),
      );
      onTaskHierarchyChange([
        ...taskHierarchy.filter((record) => !hierarchyIds.has(record.task_id)),
        ...localHierarchy,
      ]);
      const baselineResponse = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_plan_baseline',
          versionId: targetVersion,
          baselineKey: `CHANGE-${change.id}`,
          label: `${change.id} 采纳后计划`,
          snapshot: {
            ...versionReleasePlans[targetVersion],
            changeId: change.id,
            reason: change.title,
            scheduleImpact: change.scheduleImpact,
            wbsTaskIds: newTasks.map((task) => task[0]),
            adjustedAt: now,
          },
        }),
      });
      if (!baselineResponse.ok) {
        setRiskSaveError('WBS 已写入，但版本计划基线保存失败');
      }
    } catch (error) {
      setRiskSaveError(
        error instanceof Error ? error.message : 'WBS 调整草案写入失败',
      );
    } finally {
      setSavingChange('');
    }
  }

  async function returnChange(change: ChangeRecord) {
    await persistChange({
      ...change,
      status: '待补充',
      currentStep: 0,
      updatedAt: new Date().toISOString(),
      history: [
        ...change.history,
        {
          step: 0,
          action: '审核退回',
          actor: change.reviewer,
          at: new Date().toLocaleString('zh-CN'),
          note: '影响范围或验收标准需要补充后重新分析',
        },
      ],
    });
  }

  async function persistRisk(newRisk: (typeof risks)[number]) {
    setSavingRisk(true);
    setRiskSaveError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_risk', risk: newRisk }),
      });
      if (!response.ok) throw new Error('风险写入失败');
      onRisksChange([
        ...risksData.filter((risk) => risk.id !== newRisk.id),
        newRisk,
      ]);
      return true;
    } catch (error) {
      setRiskSaveError(error instanceof Error ? error.message : '风险写入失败');
      return false;
    } finally {
      setSavingRisk(false);
    }
  }

  async function saveRisk() {
    const newRisk = {
      id: createRecordId('R'),
      version: riskDraft.version,
      level: '中',
      title: riskDraft.title.trim(),
      owner: riskDraft.owner,
      impact: riskDraft.impact.trim() || '待 AI 评估具体影响范围',
      trigger: '达到人工登记的监控条件',
      status: '监控中',
      plan: 'AI 将在下一次巡检中生成应急预案并分派行动项',
    };
    if (await persistRisk(newRisk)) {
      setRiskDraft({ ...riskDraft, title: '', impact: '' });
      setRiskDialogOpen(false);
    }
  }

  const recommendationTaskId = 'AI-RISK-R023';
  const recommendationAdopted = tasksData.some(
    (task) => task[0] === recommendationTaskId,
  );

  async function adoptRiskRecommendation() {
    if (recommendationAdopted) return;
    const now = shanghaiNow();
    const task: TaskRecord = [
      recommendationTaskId,
      '启用支付备用通道并完成连通性验证',
      projectName,
      'v1.0',
      '陈默、赵一',
      '未开始',
      '高',
      now.monthDay,
      isoDateToMonthDay(addCalendarDays(now.date, 2)),
      '0%',
      '20h',
      '2.2',
      '高',
    ];
    setSavingRecommendation(true);
    setRiskSaveError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_task', task }),
      });
      if (!response.ok) throw new Error('风险行动项创建失败');
      onTasksChange([...tasksData, task]);
    } catch (error) {
      setRiskSaveError(
        error instanceof Error ? error.message : '风险行动项创建失败',
      );
    } finally {
      setSavingRecommendation(false);
    }
  }

  async function submitPredictionFeedback() {
    setRiskSaveError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_ai_prediction_feedback',
          entityType: 'risk_prediction',
          entityId: 'R-023-PREDICTION',
          detail: '用户标记支付联调按期概率预测不准确，等待模型复核',
        }),
      });
      if (!response.ok) throw new Error('预测反馈提交失败');
      setFeedbackSent(true);
    } catch (error) {
      setRiskSaveError(
        error instanceof Error ? error.message : '预测反馈提交失败',
      );
    }
  }
  return (
    <>
      <SectionTitle
        eyebrow="Detect · Respond · Close"
        title="风险与需求变更"
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRiskDraft((current) => ({
                  ...current,
                  version: versionScope === 'portfolio' ? 'v1.0' : versionScope,
                }));
                setRiskDialogOpen(true);
              }}
            >
              <Plus />
              登记风险
            </Button>
            <Button onClick={onChange}>
              <WandSparkles />
              新建需求变更
            </Button>
          </div>
        }
      />
      {riskFocus && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-900">
          <ShieldAlert className="size-4" />
          从 AI 风险雷达下钻：风险编号 <strong>{riskFocus}</strong>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto bg-white"
            onClick={onClearRiskFocus}
          >
            查看全部风险
          </Button>
        </div>
      )}
      {riskSaveError && !riskDialogOpen && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {riskSaveError}
        </div>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        {[
          ['当前范围风险', String(visibleRisks.length)],
          [
            '高风险',
            String(visibleRisks.filter((risk) => risk.level === '高').length),
          ],
          [
            '待闭环',
            String(
              visibleRisks.filter((risk) => risk.status !== '已关闭').length,
            ),
          ],
          ['跨版本影响', versionScope === 'portfolio' ? '2' : '1'],
        ].map((x, i) => (
          <Card key={x[0]} size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{x[0]}</p>
              <p
                className={`mt-1 text-xl font-bold ${i === 1 ? 'text-rose-600' : ''}`}
              >
                {x[1]}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mb-5 border-blue-200">
        <CardHeader className="flex-row items-start justify-between border-b bg-blue-50/50">
          <div>
            <CardTitle>需求变更闭环台账</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              每次采纳都必须确定目标版本；计划调整会生成新的只读版本基线
            </p>
          </div>
          <Badge className="bg-blue-100 text-blue-700">
            {
              visibleChanges.filter((change) => change.status !== '已归档')
                .length
            }{' '}
            项处理中
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {visibleChanges.map((change) => (
            <div key={change.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{change.id}</Badge>
                    <p className="font-semibold">{change.title}</p>
                    <StatusBadge value={change.status} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {change.description}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>负责人：{change.owner}</p>
                  <p className="mt-1">审核人：{change.reviewer}</p>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto pb-1">
                <div className="grid min-w-[760px] grid-cols-7 gap-1">
                  {changeSteps.map((step, index) => (
                    <div key={step} className="text-center">
                      <div
                        className={`mb-2 h-1.5 rounded-full ${index <= change.currentStep ? 'bg-primary' : 'bg-muted'}`}
                      />
                      <p
                        className={`text-[11px] ${index === change.currentStep ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
                      >
                        {index + 1}. {step}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-muted/40 p-3 text-xs">
                  <p className="text-muted-foreground">AI 评估</p>
                  <p className="mt-1 font-medium">
                    工期 {change.scheduleImpact} · {change.resourceImpact}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    波及任务：{change.affectedTasks.join('、')}
                  </p>
                </div>
                <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
                  <p className="font-medium">AI 建议</p>
                  <p className="mt-1 leading-5">{change.recommendation}</p>
                </div>
                <div className="rounded-lg border p-3 text-xs">
                  <p className="text-muted-foreground">版本决策</p>
                  <p className="mt-1">
                    来源：{versionScopeLabels[change.sourceVersion]}
                  </p>
                  <NativeSelect
                    className="mt-2 w-full"
                    value={changeTargets[change.id] ?? change.targetVersion}
                    disabled={change.currentStep > 1}
                    onChange={(event) =>
                      setChangeTargets({
                        ...changeTargets,
                        [change.id]: event.target.value,
                      })
                    }
                    aria-label={`${change.id} 目标版本`}
                  >
                    <NativeSelectOption value="v0.9">
                      v0.9 Alpha（当前/历史）
                    </NativeSelectOption>
                    <NativeSelectOption value="v1.0">
                      v1.0 Beta（当前版本）
                    </NativeSelectOption>
                    <NativeSelectOption value="v1.1">
                      v1.1 Growth（后续版本）
                    </NativeSelectOption>
                  </NativeSelect>
                </div>
              </div>
              {change.currentStep >= 1 &&
                (change.currentStep < 6 ||
                  Boolean(change.wbsDraft?.length)) && (
                  <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                    <div className="flex flex-wrap items-start gap-2">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-semibold text-indigo-950">
                          <ListTree className="size-4 text-indigo-600" />
                          WBS 调整草案
                        </p>
                        <p className="mt-1 text-xs text-indigo-800/80">
                          审核采纳后先确认任务差异，再一次性写入
                          WBS；不会直接覆盖已有任务。
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="ml-auto border-indigo-200 bg-white text-indigo-700"
                      >
                        {change.wbsAppliedAt
                          ? `已写入 ${change.wbsAppliedTaskIds?.length ?? 0} 项`
                          : change.currentStep >= 2
                            ? '待确认写入'
                            : 'AI 预览'}
                      </Badge>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[880px] text-left text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            {[
                              '层级',
                              'WBS / 任务',
                              '阶段',
                              '负责人',
                              '计划时间',
                              '工时',
                              '关联原任务',
                            ].map((header) => (
                              <th
                                key={header}
                                className="px-2 py-2 font-medium"
                              >
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {effectiveChangeWbsDraft(
                            change,
                            (changeTargets[change.id] ??
                              change.targetVersion) as ChangeRecord['targetVersion'],
                            projectName,
                          ).map((item) => (
                            <tr
                              key={item.id}
                              className={`border-t border-indigo-100 ${item.parentTaskId === null ? 'bg-white/80' : ''}`}
                            >
                              <td className="px-2 py-2">
                                <Badge
                                  className={
                                    item.parentTaskId === null
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-emerald-100 text-emerald-700'
                                  }
                                >
                                  {item.parentTaskId === null
                                    ? '父任务'
                                    : '子任务'}
                                </Badge>
                              </td>
                              <td className="px-2 py-2">
                                <p className="font-medium">{item.task[0]}</p>
                                <p className="mt-0.5 text-muted-foreground">
                                  {item.task[1]}
                                </p>
                              </td>
                              <td className="px-2 py-2">
                                {item.workType} · {item.phase}
                              </td>
                              <td className="px-2 py-2">{item.task[4]}</td>
                              <td className="px-2 py-2 whitespace-nowrap">
                                {item.task[7]}–{item.task[8]}
                              </td>
                              <td className="px-2 py-2">{item.task[10]}</td>
                              <td className="px-2 py-2">
                                {item.linkedTasks.length
                                  ? item.linkedTasks.join('、')
                                  : '版本范围'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {change.wbsAppliedTaskIds?.length ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-indigo-100 pt-3">
                        <span className="text-xs text-indigo-900">
                          实施完成度：
                          <strong>
                            {
                              change.wbsAppliedTaskIds.filter(
                                (taskId) =>
                                  tasksData.find(
                                    (task) => task[0] === taskId,
                                  )?.[5] === '已完成',
                              ).length
                            }
                            /{change.wbsAppliedTaskIds.length}
                          </strong>
                        </span>
                        <Progress
                          className="w-36"
                          value={
                            (change.wbsAppliedTaskIds.filter(
                              (taskId) =>
                                tasksData.find(
                                  (task) => task[0] === taskId,
                                )?.[5] === '已完成',
                            ).length /
                              change.wbsAppliedTaskIds.length) *
                            100
                          }
                        />
                        <span className="text-[11px] text-indigo-800/70">
                          全部完成后，AI 自动把变更推进到待验收
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto bg-white"
                          onClick={() => onOpenChangeTasks(change.id)}
                        >
                          <Link2 /> 在 WBS 查看关联任务
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="text-[11px] text-muted-foreground">
                  最近记录：{change.history.at(-1)?.action} ·{' '}
                  {change.history.at(-1)?.actor} · {change.history.at(-1)?.at}
                </span>
                {changePermissionHint(change) && (
                  <p className="basis-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {changePermissionHint(change)}
                  </p>
                )}
                {change.currentStep === 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={savingChange === change.id}
                    onClick={() => returnChange(change)}
                  >
                    退回补充
                  </Button>
                )}
                {change.currentStep < 6 && change.currentStep !== 4 && (
                  <Button
                    size="sm"
                    className={change.currentStep !== 1 ? 'ml-auto' : ''}
                    disabled={
                      savingChange === change.id ||
                      (change.currentStep === 1 &&
                        !canApproveChange(selectedTargetVersion(change))) ||
                      (change.currentStep === 2 &&
                        !canManageVersion(selectedTargetVersion(change)))
                    }
                    onClick={() => advanceChange(change)}
                  >
                    {savingChange === change.id
                      ? '正在更新…'
                      : change.currentStep === 0
                        ? '重新分析评估'
                        : change.currentStep === 1
                          ? '审核通过并采纳'
                          : change.currentStep === 2
                            ? '确认草案并写入 WBS'
                            : change.currentStep === 3
                              ? '开始实施'
                              : '验收通过并归档'}
                  </Button>
                )}
                {change.currentStep === 4 && (
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() => onOpenChangeTasks(change.id)}
                  >
                    <ListTree /> 跟踪 WBS 实施任务
                  </Button>
                )}
                {change.currentStep === 6 && (
                  <Badge className="ml-auto bg-emerald-100 text-emerald-700">
                    流程已闭环
                  </Badge>
                )}
              </div>
              <details className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium">
                  查看完整操作轨迹（{change.history.length} 条）
                </summary>
                <div className="mt-3 space-y-2">
                  {[...change.history].reverse().map((entry, index) => (
                    <div
                      key={`${entry.at}-${entry.action}-${index}`}
                      className="flex gap-3 border-l-2 border-primary/25 pl-3"
                    >
                      <span className="shrink-0 text-muted-foreground">
                        {entry.at}
                      </span>
                      <div>
                        <p className="font-medium">
                          {entry.action} · {entry.actor}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          {entry.note}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ))}
        </CardContent>
      </Card>
      <h2 className="mb-3 text-base font-semibold">风险闭环台账</h2>
      <div className="space-y-4">
        {visibleRisks.map((r) => (
          <Card key={r.id}>
            <CardContent className="grid gap-4 lg:grid-cols-[1.1fr_1fr_1.2fr_auto]">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <StatusBadge value={r.level} />
                  <span className="text-xs text-muted-foreground">{r.id}</span>
                  <Badge variant="outline">{r.version}</Badge>
                </div>
                <p className="font-semibold">{r.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  负责人：{r.owner}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  影响与触发条件
                </p>
                <p className="text-sm">{r.impact}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  触发：{r.trigger}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="mb-1 text-xs font-semibold">应急预案</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {r.plan}
                </p>
              </div>
              <div className="flex flex-col items-end justify-center gap-2">
                <StatusBadge value={r.status} />
                {r.status !== '已关闭' && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {r.status !== '处理中' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingRisk}
                        onClick={() => persistRisk({ ...r, status: '处理中' })}
                      >
                        开始处理
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={savingRisk}
                      onClick={() => persistRisk({ ...r, status: '已关闭' })}
                    >
                      关闭风险
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center gap-3">
            <ClipboardCheck className="text-emerald-600" />
            <div>
              <p className="text-sm font-semibold">闭环规则已启用</p>
              <p className="text-xs text-muted-foreground">
                风险触发 → 自动通知 → 执行预案 → 验证效果 → 关闭归档
              </p>
            </div>
            <Badge className="ml-auto bg-emerald-100 text-emerald-700">
              自动追踪中
            </Badge>
          </CardContent>
        </Card>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        <Card className="border-rose-200">
          <CardHeader className="border-b bg-rose-50/50">
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4 text-rose-600" />
              可解释 AI 预警
              <Badge className="ml-auto bg-rose-100 text-rose-700">
                可信度 89%
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              支付联调按期完成概率下降至 38%
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="mb-2 text-xs font-semibold">触发依据</p>
                <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
                  <li>• 实际进度落后基线 18%，超过 5% 阈值</li>
                  <li>• Git 分支已连续 2 天没有有效提交</li>
                  <li>• Jira 新增 3 个关联 P1 缺陷</li>
                  <li>• 前置任务 2.1 晚于计划 1.5 天</li>
                </ul>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="mb-2 text-xs font-semibold">影响范围</p>
                <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
                  <li>• 影响 WBS 2.2、3.2 与 Beta 发布节点</li>
                  <li>• 关键路径预计增加 3–4 个工作日</li>
                  <li>• 赵一与陈默的负载将超过 110%</li>
                  <li>• 数据更新时间：今天 10:24</li>
                </ul>
              </div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
              <strong>建议动作：</strong>
              今天确认备用通道，先冻结非核心支付能力；将周琪的 20
              小时测试产能转入支付回归，并在 48 小时后重新评估。
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={adoptRiskRecommendation}
                disabled={recommendationAdopted || savingRecommendation}
              >
                <CheckCircle2 />
                {recommendationAdopted
                  ? '已采纳并创建行动项'
                  : savingRecommendation
                    ? '正在创建…'
                    : '采纳建议'}
              </Button>
              <Button variant="outline" onClick={() => setEvidenceOpen(true)}>
                查看原始证据
              </Button>
              <Button
                variant="ghost"
                disabled={feedbackSent}
                onClick={submitPredictionFeedback}
              >
                {feedbackSent ? '已提交复核' : '标记判断不准确'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="size-4 text-primary" />
              计划变更情景模拟
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              调整延迟天数，实时观察关键路径和交付概率
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 flex items-center text-xs font-medium">
                假设：支付接口延迟
                <span className="ml-auto text-lg font-bold text-rose-600">
                  {scenarioDays} 天
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={scenarioDays}
                onChange={(event) =>
                  setScenarioDays(Number(event.target.value))
                }
                className="w-full accent-blue-600"
                aria-label="支付接口延迟天数"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[10px] text-muted-foreground">原始基线</p>
                <p className="mt-1 text-sm font-bold">09月27日</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3 text-amber-800">
                <p className="text-[10px] opacity-70">无调整预测</p>
                <p className="mt-1 text-sm font-bold">+{scenarioDays + 1} 天</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 text-emerald-800">
                <p className="text-[10px] opacity-70">采用建议后</p>
                <p className="mt-1 text-sm font-bold">
                  +{Math.max(0, scenarioDays - 3)} 天
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <ScenarioMetric
                label="Beta 按期概率"
                value={Math.max(18, 78 - scenarioDays * 8)}
                suffix="%"
              />
              <ScenarioMetric
                label="受影响任务"
                value={3 + scenarioDays}
                suffix=" 项"
              />
              <ScenarioMetric
                label="资源缺口"
                value={16 + scenarioDays * 4}
                suffix=" 小时"
              />
            </div>
            <div className="rounded-lg bg-slate-900 p-3 text-xs leading-5 text-slate-100">
              推荐方案：启用备用支付通道 + 并行回归，可吸收约 3 天延迟；超过 6
              天时建议把营销规则移入 v1.1。
            </div>
          </CardContent>
        </Card>
      </div>
      <Dialog open={riskDialogOpen} onOpenChange={setRiskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记项目风险</DialogTitle>
            <DialogDescription>
              新风险会归入当前版本，并进入 AI 巡检与闭环跟踪范围。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="风险名称"
              value={riskDraft.title}
              onChange={(event) =>
                setRiskDraft({ ...riskDraft, title: event.target.value })
              }
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <NativeSelect
                className="w-full"
                value={riskDraft.version}
                onChange={(event) =>
                  setRiskDraft({
                    ...riskDraft,
                    version: event.target.value as VersionId,
                  })
                }
                aria-label="风险所属版本"
              >
                <NativeSelectOption value="v0.9">v0.9 Alpha</NativeSelectOption>
                <NativeSelectOption value="v1.0">v1.0 Beta</NativeSelectOption>
                <NativeSelectOption value="v1.1">
                  v1.1 Growth
                </NativeSelectOption>
              </NativeSelect>
              <NativeSelect
                className="w-full"
                value={riskDraft.owner}
                onChange={(event) =>
                  setRiskDraft({ ...riskDraft, owner: event.target.value })
                }
                aria-label="风险负责人"
              >
                {['林夏', '陈默', '赵一', '周琪'].map((owner) => (
                  <NativeSelectOption key={owner} value={owner}>
                    {owner}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Textarea
              placeholder="描述可能造成的工期、范围或质量影响"
              value={riskDraft.impact}
              onChange={(event) =>
                setRiskDraft({ ...riskDraft, impact: event.target.value })
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRiskDialogOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!riskDraft.title.trim() || savingRisk}
              onClick={saveRisk}
            >
              {savingRisk ? '正在保存…' : '保存并开始监控'}
            </Button>
          </DialogFooter>
          {riskSaveError && (
            <p className="text-sm text-rose-600">{riskSaveError}</p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 预警原始证据</DialogTitle>
            <DialogDescription>
              预测由以下任务、代码与缺陷信号综合计算，接入第三方后可跳转原系统记录。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {[
              'WBS 2.2：实际进度 35%，计划进度 53%，偏差 -18%',
              'Git payment-integration：连续 2 天无有效提交',
              'Jira PAY-381 / PAY-386 / PAY-392：3 个关联 P1 缺陷',
              'WBS 2.1：前置 API 改造晚于计划 1.5 天',
            ].map((item) => (
              <div key={item} className="rounded-lg border p-3">
                {item}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setEvidenceOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScenarioMetric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center text-xs">
        <span className="text-muted-foreground">{label}</span>
        <strong className="ml-auto">
          {value}
          {suffix}
        </strong>
      </div>
      <Progress value={Math.min(value, 100)} />
    </div>
  );
}
