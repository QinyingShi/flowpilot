'use client';

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileText,
  KanbanSquare,
  Link2,
  ListTree,
  Plus,
  RefreshCw,
  Sparkles,
  UploadCloud,
  Users,
} from 'lucide-react';

import { SectionTitle } from '@/components/section-title';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { cloneTask, type TaskRecord, type TaskStatus } from '@/lib/task-model';
import { createRecordId, createRecordToken, futureIso } from '@/lib/record-id';
import {
  addCalendarDays,
  isoDateToMonthDay,
  shanghaiNow,
} from '@/lib/shanghai-time';

type VersionScope = 'portfolio' | 'v0.9' | 'v1.0' | 'v1.1';
type VersionId = Exclude<VersionScope, 'portfolio'>;
type DeliveryMode = 'agile' | 'waterfall';

type VersionConfig = {
  version: VersionId;
  mode: DeliveryMode;
  label: string;
  locked: boolean;
  releaseDate?: string;
};

type ResourceRecord = {
  name: string;
  role: string;
  level: string;
  project: string;
  load: number;
  available: number;
  allocation: Record<VersionId, number>;
  skills: string[];
  domains: string[];
  risk: string;
  memberStatus?: '在职' | '新入职' | '离职待交接' | '已离职';
  source?: string;
  joinedAt?: string;
  statusChangedAt?: string;
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

type TaskBlocker = {
  id: string;
  taskId: string;
  version: VersionId;
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

type RequirementDraftTask = {
  sequence: number;
  name: string;
  type: string;
  stage: string;
  owner: string;
  estimateHours: number;
  dependencySequences: number[];
  acceptance: string;
  start: string;
  end: string;
};

type RequirementAnalysis = {
  id: string;
  topic: string;
  featureCount: number;
  clarifications: string[];
  risks: string[];
  assumptions?: string[];
  confidence?: number;
  excerpt: string;
  parserMode: string;
  textExtracted?: boolean;
  aiProvider?: 'openai' | 'local';
  aiModel?: string | null;
  aiResponseId?: string | null;
  aiElapsedMs?: number;
  aiFallbackReason?: string | null;
  tasks: RequirementDraftTask[];
};

type RequirementHistoryItem = {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  status: string;
  created_at: string;
  draft?: {
    id: string;
    version_id: string;
    delivery_mode: DeliveryMode;
    status: string;
    applied_at?: string | null;
  };
};

const defaultVersionConfigs: VersionConfig[] = [
  { version: 'v0.9', mode: 'waterfall', label: '传统瀑布', locked: true },
  { version: 'v1.0', mode: 'agile', label: '敏捷迭代', locked: true },
  { version: 'v1.1', mode: 'agile', label: '敏捷迭代', locked: true },
];

const versionScopeLabels: Record<VersionScope, string> = {
  portfolio: '并行版本总览',
  'v0.9': 'v0.9 Alpha',
  'v1.0': 'v1.0 Beta',
  'v1.1': 'v1.1 Growth',
};

function monthDay(date = new Date()) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

const currentDay = monthDay();

function scheduleTimestamp(day: string) {
  const [month, date] = day.split('/').map(Number);
  return new Date(2026, month - 1, date).getTime();
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
    timeZone: 'Asia/Shanghai',
  }).format(date);
}

function dateTimeLocalValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const shanghaiOffset = 8 * 60 * 60 * 1000;
  return new Date(date.getTime() + shanghaiOffset).toISOString().slice(0, 16);
}

function taskEffort(task: TaskRecord) {
  const parsed = Number(task[10]?.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

export default function WbsView({
  projectId,
  projectName,
  tasksData,
  blockersData,
  onBlockersChange,
  resourcesData,
  onTasksChange,
  changeTaskLinks,
  taskHierarchy,
  onTaskHierarchyChange,
  versionConfigs,
  onVersionConfigsChange,
  changeFocus,
  onClearChangeFocus,
  versionScope,
  ownerFocus,
  statusFocus,
  onClearOwnerFocus,
  onClearStatusFocus,
}: {
  projectId: string;
  projectName: string;
  tasksData: TaskRecord[];
  blockersData: TaskBlocker[];
  onBlockersChange: (blockers: TaskBlocker[]) => void;
  resourcesData: ResourceRecord[];
  onTasksChange: (tasks: TaskRecord[]) => void;
  changeTaskLinks: ChangeTaskLink[];
  taskHierarchy: TaskHierarchyRecord[];
  onTaskHierarchyChange: (records: TaskHierarchyRecord[]) => void;
  versionConfigs: VersionConfig[];
  onVersionConfigsChange: (configs: VersionConfig[]) => void;
  changeFocus: string;
  onClearChangeFocus: () => void;
  versionScope: VersionScope;
  ownerFocus: string;
  statusFocus: string;
  onClearOwnerFocus: () => void;
  onClearStatusFocus: () => void;
}) {
  const [mode, setMode] = useState<'table' | 'board'>('table');
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [requirementFile, setRequirementFile] = useState<{
    name: string;
    size: string;
    file?: File;
    sampleContent?: string;
  } | null>(null);
  const [requirementAnalysis, setRequirementAnalysis] =
    useState<RequirementAnalysis | null>(null);
  const [requirementError, setRequirementError] = useState('');
  const [requirementHistory, setRequirementHistory] = useState<
    RequirementHistoryItem[]
  >([]);
  const [importStage, setImportStage] = useState<
    'select' | 'analyzing' | 'preview' | 'done'
  >('select');
  const [savingTasks, setSavingTasks] = useState(false);
  const [syncingTasks, setSyncingTasks] = useState(false);
  const [syncSummary, setSyncSummary] = useState('');
  const [taskSaveError, setTaskSaveError] = useState('');
  const [importMode, setImportMode] = useState<DeliveryMode>('agile');
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [blockerDraft, setBlockerDraft] = useState<TaskBlocker | null>(null);
  const [savingBlocker, setSavingBlocker] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(statusFocus || '全部');
  const [ownerFilter, setOwnerFilter] = useState(ownerFocus || '全部');
  const [taskDraft, setTaskDraft] = useState({
    name: '',
    owner: '林夏',
    version: versionScope === 'portfolio' ? 'v1.0' : versionScope,
    start: '09/11',
    end: '09/18',
    parentTaskId: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hierarchyByTask = new Map(
    taskHierarchy.map((record) => [record.task_id, record]),
  );
  const childTasksByParent = new Map<string, TaskRecord[]>();
  tasksData.forEach((task) => {
    const parentId = hierarchyByTask.get(task[0])?.parent_task_id;
    if (!parentId) return;
    childTasksByParent.set(parentId, [
      ...(childTasksByParent.get(parentId) ?? []),
      task,
    ]);
  });
  const allTasks = tasksData.map((task) => {
    const hierarchy = hierarchyByTask.get(task[0]);
    if (hierarchy?.level !== 0) return task;
    const children = childTasksByParent.get(task[0]) ?? [];
    if (!children.length) return task;
    const total = Math.max(
      1,
      children.reduce((sum, child) => sum + taskEffort(child), 0),
    );
    const completedEffort = children.reduce(
      (sum, child) =>
        sum +
        taskEffort(child) *
          Math.min(1, Math.max(0, Number(child[9].replace('%', '')) / 100)),
      0,
    );
    const progress = Math.round((completedEffort / total) * 100);
    const status = children.some((child) => child[5] === '有阻塞')
      ? '有阻塞'
      : children.every((child) => child[5] === '已完成')
        ? '已完成'
        : progress > 0
          ? '进行中'
          : '未开始';
    const derived = cloneTask(task);
    derived[5] = status;
    derived[7] = [...children].sort(
      (left, right) => scheduleTimestamp(left[7]) - scheduleTimestamp(right[7]),
    )[0][7];
    derived[8] = [...children].sort(
      (left, right) => scheduleTimestamp(right[8]) - scheduleTimestamp(left[8]),
    )[0][8];
    derived[9] = `${progress}%`;
    derived[10] = `${total}h`;
    return derived;
  });
  const focusedChangeTaskIds = new Set(
    changeTaskLinks
      .filter((link) => !changeFocus || link.change_id === changeFocus)
      .map((link) => link.task_id),
  );
  const assignableResourceNames = resourcesData
    .filter(
      (resource) =>
        resource.memberStatus !== '离职待交接' &&
        resource.memberStatus !== '已离职',
    )
    .map((resource) => resource.name);
  const visibleTasks = (
    versionScope === 'portfolio'
      ? allTasks
      : allTasks.filter((task) => task[3] === versionScope)
  ).filter(
    (task) =>
      (!query || task[1].toLowerCase().includes(query.toLowerCase())) &&
      (statusFilter === '全部' || task[5] === statusFilter) &&
      (ownerFilter === '全部' || task[4].split('、').includes(ownerFilter)) &&
      (!changeFocus || focusedChangeTaskIds.has(task[0])),
  );
  const completedTasks = visibleTasks.filter(
    (task) => task[5] === '已完成',
  ).length;
  const blockedTasks = visibleTasks.filter(
    (task) => task[5] === '有阻塞',
  ).length;
  const importVersion = versionScope === 'portfolio' ? 'v1.0' : versionScope;
  const currentVersionConfig =
    versionConfigs.find((config) => config.version === importVersion) ??
    defaultVersionConfigs.find((config) => config.version === importVersion)!;
  const requirementDrafts = requirementAnalysis?.tasks ?? [];

  async function openRequirementImport() {
    setRequirementFile(null);
    setRequirementAnalysis(null);
    setRequirementError('');
    setImportStage('select');
    setImportMode(currentVersionConfig.mode);
    setImportDialogOpen(true);
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      const payload = (await response.json()) as {
        snapshot?: {
          requirementDocuments?: Omit<RequirementHistoryItem, 'draft'>[];
          requirementDrafts?: Array<
            NonNullable<RequirementHistoryItem['draft']> & {
              document_id: string;
            }
          >;
        };
      };
      const drafts = payload.snapshot?.requirementDrafts ?? [];
      setRequirementHistory(
        (payload.snapshot?.requirementDocuments ?? []).map((document) => ({
          ...document,
          draft: drafts.find((draft) => draft.document_id === document.id),
        })),
      );
    } catch {
      setRequirementHistory([]);
    }
  }

  function selectRequirementFile(file: File) {
    setRequirementFile({
      name: file.name,
      size: `${Math.max(file.size / 1024 / 1024, 0.01).toFixed(2)} MB`,
      file,
    });
    setRequirementAnalysis(null);
    setRequirementError('');
  }

  async function analyzeRequirement() {
    if (!requirementFile) return;
    setImportStage('analyzing');
    setRequirementError('');
    try {
      const bytes = requirementFile.file
        ? new Uint8Array(await requirementFile.file.arrayBuffer())
        : new TextEncoder().encode(requirementFile.sampleContent ?? '');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 0x8000),
        );
      }
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze_requirement_document',
          requirementDocument: {
            fileName: requirementFile.name,
            contentBase64: btoa(binary),
            versionId: importVersion,
            deliveryMode: importMode,
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        draft?: RequirementAnalysis;
        detail?: string;
      } | null;
      if (!response.ok || !result?.draft) {
        throw new Error(result?.detail ?? '需求文档解析失败');
      }
      setRequirementAnalysis({
        ...result.draft,
        textExtracted: result.draft.textExtracted,
      });
      setImportStage('preview');
    } catch (error) {
      setRequirementError(
        error instanceof Error ? error.message : '需求文档解析失败',
      );
      setImportStage('select');
    }
  }

  async function persistTasks(
    newTasks: TaskRecord[],
    action?: 'sync_task_progress',
    hierarchy?: Array<{
      taskId: string;
      parentTaskId: string | null;
      rootTaskId: string;
      level: number;
      sortOrder: number;
      workType: string;
      acceptanceCriteria: string;
    }>,
    versionConfig?: VersionConfig,
  ) {
    setSavingTasks(true);
    setTaskSaveError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:
            action ?? (newTasks.length === 1 ? 'create_task' : 'create_tasks'),
          task: !action && newTasks.length === 1 ? newTasks[0] : undefined,
          tasks: action || newTasks.length > 1 ? newTasks : undefined,
          hierarchy,
          versionConfig,
        }),
      });
      if (!response.ok) throw new Error('任务写入失败');
      const updates = new Map(newTasks.map((task) => [task[0], task]));
      const existingIds = new Set(tasksData.map((task) => task[0]));
      onTasksChange([
        ...tasksData.map((task) => updates.get(task[0]) ?? task),
        ...newTasks.filter((task) => !existingIds.has(task[0])),
      ]);
      if (hierarchy?.length) {
        const now = new Date().toISOString();
        const records: TaskHierarchyRecord[] = hierarchy.map((record) => ({
          task_id: record.taskId,
          project_id: projectId,
          parent_task_id: record.parentTaskId,
          root_task_id: record.rootTaskId,
          level: record.level,
          sort_order: record.sortOrder,
          work_type: record.workType,
          acceptance_criteria: record.acceptanceCriteria,
          created_at: now,
          updated_at: now,
        }));
        const ids = new Set(records.map((record) => record.task_id));
        onTaskHierarchyChange([
          ...taskHierarchy.filter((record) => !ids.has(record.task_id)),
          ...records,
        ]);
      }
      if (versionConfig) {
        onVersionConfigsChange([
          ...versionConfigs.filter(
            (item) => item.version !== versionConfig.version,
          ),
          versionConfig,
        ]);
      }
      return true;
    } catch (error) {
      setTaskSaveError(error instanceof Error ? error.message : '任务写入失败');
      return false;
    } finally {
      setSavingTasks(false);
    }
  }

  async function importRequirementTasks() {
    if (!requirementAnalysis) return;
    setSavingTasks(true);
    setTaskSaveError('');
    try {
      const draftResponse = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_requirement_draft',
          requirementDraft: {
            id: requirementAnalysis.id,
            tasks: requirementDrafts,
          },
        }),
      });
      if (!draftResponse.ok) throw new Error('任务草案保存失败');
      const applyResponse = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply_requirement_draft',
          versionId: importVersion,
          requirementDraft: { id: requirementAnalysis.id },
        }),
      });
      const result = (await applyResponse.json().catch(() => null)) as {
        tasks?: TaskRecord[];
        hierarchy?: Array<{
          taskId: string;
          parentTaskId: string | null;
          rootTaskId: string;
          level: number;
          sortOrder: number;
          workType: string;
          acceptanceCriteria: string;
        }>;
        versionConfig?: VersionConfig;
        detail?: string;
      } | null;
      if (!applyResponse.ok || !result?.tasks || !result.hierarchy) {
        throw new Error(result?.detail ?? '需求任务写入失败');
      }
      const existingIds = new Set(tasksData.map((task) => task[0]));
      onTasksChange([
        ...tasksData,
        ...result.tasks.filter((task) => !existingIds.has(task[0])),
      ]);
      const now = new Date().toISOString();
      onTaskHierarchyChange([
        ...taskHierarchy,
        ...result.hierarchy.map((item) => ({
          task_id: item.taskId,
          project_id: projectId,
          parent_task_id: item.parentTaskId,
          root_task_id: item.rootTaskId,
          level: item.level,
          sort_order: item.sortOrder,
          work_type: item.workType,
          acceptance_criteria: item.acceptanceCriteria,
          created_at: now,
          updated_at: now,
        })),
      ]);
      if (result.versionConfig) {
        onVersionConfigsChange([
          ...versionConfigs.filter(
            (item) => item.version !== result.versionConfig?.version,
          ),
          result.versionConfig,
        ]);
      }
      setImportStage('done');
    } catch (error) {
      setTaskSaveError(
        error instanceof Error ? error.message : '需求任务写入失败',
      );
    } finally {
      setSavingTasks(false);
    }
  }

  async function saveDraftTask() {
    const parentTask = tasksData.find(
      (task) => task[0] === taskDraft.parentTaskId,
    );
    const parentHierarchy = parentTask
      ? hierarchyByTask.get(parentTask[0])
      : undefined;
    const taskId = parentTask
      ? `${parentTask[0]}.${createRecordToken(4)}`
      : createRecordId('USR');
    const newTask: TaskRecord = [
      taskId,
      taskDraft.name.trim(),
      projectName,
      parentTask?.[3] ?? taskDraft.version,
      taskDraft.owner,
      '未开始',
      '中',
      taskDraft.start,
      taskDraft.end,
      '0%',
      '40h',
      '—',
      '低',
    ];
    const hierarchy = parentTask
      ? [
          {
            taskId,
            parentTaskId: parentTask[0],
            rootTaskId: parentHierarchy?.root_task_id ?? parentTask[0],
            level: (parentHierarchy?.level ?? 0) + 1,
            sortOrder: (childTasksByParent.get(parentTask[0])?.length ?? 0) + 1,
            workType: '执行子任务',
            acceptanceCriteria: '完成交付物、自测并通过负责人确认',
          },
        ]
      : undefined;
    if (await persistTasks([newTask], undefined, hierarchy)) {
      setTaskDraft({ ...taskDraft, name: '', parentTaskId: '' });
      setTaskDialogOpen(false);
    }
  }

  async function saveTaskUpdate() {
    if (!editingTask) return;
    if (await persistTasks([editingTask])) setEditingTask(null);
  }

  function openTaskBlocker(task: string[]) {
    const existing = blockersData.find((blocker) => blocker.taskId === task[0]);
    setBlockerDraft(
      existing ?? {
        id: `BLK-${task[0]}`,
        taskId: task[0],
        version: task[3] as TaskBlocker['version'],
        category: '待分类',
        reason: '',
        source: '人工登记',
        owner: task[4],
        discoveredAt: new Date().toISOString(),
        expectedResolveAt: futureIso(24),
        status: '待处理',
        impact: '',
        resolutionPlan: '',
        updatedAt: new Date().toISOString(),
      },
    );
  }

  async function saveTaskBlocker() {
    if (!blockerDraft?.reason.trim()) return;
    setSavingBlocker(true);
    setTaskSaveError('');
    const blocker = { ...blockerDraft, updatedAt: new Date().toISOString() };
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert_task_blocker', blocker }),
      });
      if (!response.ok) throw new Error('阻塞信息保存失败');
      onBlockersChange([
        ...blockersData.filter((item) => item.id !== blocker.id),
        blocker,
      ]);
      if (blocker.status === '已解除') {
        const task = tasksData.find((item) => item[0] === blocker.taskId);
        if (task?.[5] === '有阻塞') {
          const resumedTask = cloneTask(task);
          resumedTask[5] = resumedTask[9] === '100%' ? '已完成' : '进行中';
          await persistTasks([resumedTask]);
        }
      }
      setBlockerDraft(null);
    } catch (error) {
      setTaskSaveError(
        error instanceof Error ? error.message : '阻塞信息保存失败',
      );
    } finally {
      setSavingBlocker(false);
    }
  }

  function getTaskDeliveryMeta(task: TaskRecord) {
    const hierarchy = hierarchyByTask.get(task[0]);
    if (hierarchy) {
      const deliveryMode =
        versionConfigs.find((config) => config.version === task[3])?.mode ??
        'agile';
      return {
        type: hierarchy.work_type,
        sprint:
          deliveryMode === 'waterfall'
            ? hierarchy.level === 0
              ? '全周期交付包'
              : `阶段 ${hierarchy.sort_order} · ${hierarchy.work_type}`
            : task[3] === 'v0.9'
              ? 'Sprint 5'
              : task[3] === 'v1.0'
                ? 'Sprint 6/7'
                : 'Sprint 8',
        acceptance:
          hierarchy.acceptance_criteria ||
          (hierarchy.level === 0
            ? '全部子任务完成并通过版本验收'
            : '完成交付物并通过验收'),
      };
    }
    const imported = requirementDrafts.find((draft) => draft.name === task[1]);
    if (imported) {
      return {
        type: imported.type,
        sprint: imported.stage,
        acceptance: imported.acceptance,
      };
    }
    const name = task[1];
    const type = name.includes('评审')
      ? '评审'
      : name.includes('测试') || name.includes('验收') || name.includes('回归')
        ? '测试验收'
        : name.includes('联调')
          ? '联合联调'
          : name.includes('设计') || name.includes('原型')
            ? '产品设计'
            : '研发实现';
    const sprint =
      task[3] === 'v0.9'
        ? 'Sprint 5'
        : task[3] === 'v1.0'
          ? Number(task[7].replace('/', '')) < 919
            ? 'Sprint 6'
            : 'Sprint 7'
          : 'Sprint 8';
    const acceptance =
      type === '测试验收'
        ? '验收用例通过，无 P0/P1 缺陷'
        : type === '联合联调'
          ? '接口契约与异常补偿链路验证通过'
          : type === '评审'
            ? '结论、待办和责任人完成确认'
            : '代码评审、自测及关联验收标准完成';
    return { type, sprint, acceptance };
  }

  function getTaskSignal(task: TaskRecord) {
    const type = getTaskDeliveryMeta(task).type;
    if (type === '联合联调' || type === '测试验收') {
      return {
        source: 'Jira',
        detail: '缺陷状态、测试执行与质量门禁',
      };
    }
    if (type === '评审' || type === '产品设计') {
      return {
        source: type === '评审' ? '飞书' : '在线表格',
        detail: '评审结论、交付物与待办完成度',
      };
    }
    return {
      source: 'Git',
      detail: '提交、PR、代码评审与流水线',
    };
  }

  function deriveTaskFromDemoSignal(task: TaskRecord): TaskRecord {
    const next = cloneTask(task);
    const currentProgress = Number(task[9].replace('%', ''));
    const hasStarted =
      scheduleTimestamp(task[7]) <= scheduleTimestamp(currentDay);
    const seed = Array.from(`${task[0]}${task[1]}`).reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    );
    const observedProgress = hasStarted ? 45 + (seed % 46) : 0;
    const progress =
      task[5] === '已完成'
        ? 100
        : task[5] === '有阻塞'
          ? currentProgress
          : Math.min(95, Math.max(currentProgress, observedProgress));
    next[9] = `${progress}%`;
    if (task[5] !== '有阻塞') {
      next[5] =
        progress === 100 ? '已完成' : progress > 0 ? '进行中' : '未开始';
    }
    return next;
  }

  async function syncTaskProgress() {
    setSyncingTasks(true);
    setSyncSummary('');
    const scopeTasks =
      versionScope === 'portfolio'
        ? tasksData
        : tasksData.filter((task) => task[3] === versionScope);
    const syncedTasks = scopeTasks.map(deriveTaskFromDemoSignal);
    const changed = syncedTasks.filter((task, index) =>
      task.some((value, field) => value !== scopeTasks[index][field]),
    ).length;
    const saved = await persistTasks(syncedTasks, 'sync_task_progress');
    if (saved) {
      setSyncSummary(
        `${new Date().toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })} 已巡检 ${scopeTasks.length} 项，更新 ${changed} 项；阻塞任务未被自动覆盖。`,
      );
    }
    setSyncingTasks(false);
  }

  return (
    <>
      <SectionTitle
        eyebrow="Scope · Schedule · Ownership"
        title="WBS 与任务中心"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void openRequirementImport()}
            >
              <UploadCloud />
              导入需求并拆分
            </Button>
            <Button
              variant="outline"
              onClick={syncTaskProgress}
              disabled={syncingTasks || savingTasks}
            >
              <RefreshCw className={syncingTasks ? 'animate-spin' : ''} />
              {syncingTasks ? '正在同步…' : '同步任务进度'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setMode(mode === 'table' ? 'board' : 'table')}
            >
              <KanbanSquare />
              {mode === 'table' ? '切换看板' : '切换列表'}
            </Button>
            <Button
              onClick={() => {
                const now = shanghaiNow();
                setTaskDraft((current) => ({
                  ...current,
                  parentTaskId: '',
                  version: versionScope === 'portfolio' ? 'v1.0' : versionScope,
                  start: now.monthDay,
                  end: isoDateToMonthDay(addCalendarDays(now.date, 7)),
                }));
                setTaskDialogOpen(true);
              }}
            >
              <Plus />
              新增任务
            </Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950">
        <Sparkles className="size-4 text-indigo-600" />
        <strong>
          {versionScope === 'portfolio'
            ? '交付模式：版本级混合管理'
            : `交付模式：${versionConfigs.find((config) => config.version === versionScope)?.label ?? '敏捷迭代'}`}
        </strong>
        <span className="text-indigo-800/80">
          {versionScope === 'portfolio'
            ? '各版本独立选择敏捷或瀑布，任务结构、阶段门禁和进度口径按版本分别计算。'
            : (versionConfigs.find((config) => config.version === versionScope)
                  ?.mode ?? 'agile') === 'waterfall'
              ? '需求冻结 → 方案设计 → 开发 → 联调 → 系统测试 → 业务验收，前一阶段通过门禁后进入下一阶段。'
              : '功能按 Sprint 拆分，完成即执行 DoD 验收；发布前再进行联合联调、全链路回归与业务验收。'}
        </span>
        {versionScope === 'portfolio' &&
          versionConfigs.map((config) => (
            <Badge key={config.version} variant="outline" className="bg-white">
              {config.version} · {config.label}
            </Badge>
          ))}
      </div>
      <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-blue-950">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="size-4 text-blue-600" />
          <strong>任务进度自动规则（演示信号）</strong>
          <span className="text-xs text-blue-800/80">
            Git 更新研发 · Jira 更新联调/测试 · 飞书/在线表格更新评审与设计
          </span>
          <Badge variant="outline" className="ml-auto bg-white">
            人工修正保留
          </Badge>
        </div>
        <p className="mt-2 text-xs leading-5 text-blue-800">
          阻塞优先且不自动覆盖；100% 自动完成，1%–99%
          自动进行中；没有新证据不回退。{syncSummary}
        </p>
      </div>
      {ownerFilter !== '全部' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-blue-900">
          <Users className="size-4" />
          正在查看 <strong>{ownerFilter}</strong> 在
          {versionScope === 'portfolio'
            ? '全部并行版本'
            : versionScopeLabels[versionScope]}
          中的任务
          <Button
            size="sm"
            variant="outline"
            className="ml-auto bg-white"
            onClick={() => {
              setOwnerFilter('全部');
              onClearOwnerFocus();
            }}
          >
            清除人员筛选
          </Button>
        </div>
      )}
      {statusFilter !== '全部' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm text-violet-900">
          <ListTree className="size-4" />
          从项目概览下钻：任务状态为 <strong>{statusFilter}</strong>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto bg-white"
            onClick={() => {
              setStatusFilter('全部');
              onClearStatusFocus();
            }}
          >
            清除状态筛选
          </Button>
        </div>
      )}
      {changeFocus && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-sm text-blue-950">
          <Link2 className="size-4 text-blue-600" />
          正在查看需求变更 <strong>{changeFocus}</strong> 关联的 WBS 任务
          <Badge variant="outline" className="bg-white">
            {focusedChangeTaskIds.size} 项
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto bg-white"
            onClick={onClearChangeFocus}
          >
            查看全部任务
          </Button>
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          ['当前范围任务', String(visibleTasks.length)],
          [
            '完成率',
            visibleTasks.length
              ? `${Math.round((completedTasks / visibleTasks.length) * 100)}%`
              : '0%',
          ],
          [
            '进行中',
            String(visibleTasks.filter((task) => task[5] === '进行中').length),
          ],
          ['阻塞任务', String(blockedTasks)],
        ].map((x) => (
          <Card
            key={x[0]}
            size="sm"
            className={
              x[0] === '阻塞任务' && blockedTasks > 0
                ? 'border-rose-200 bg-rose-50/40'
                : ''
            }
          >
            <CardContent>
              <p className="text-xs text-muted-foreground">{x[0]}</p>
              <p
                className={`mt-1 text-xl font-bold ${x[0] === '阻塞任务' && blockedTasks > 0 ? 'text-rose-600' : ''}`}
              >
                {x[1]}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder="筛选任务…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <NativeSelect
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="按任务状态筛选"
            >
              {['全部', '未开始', '进行中', '有阻塞', '已完成'].map(
                (status) => (
                  <NativeSelectOption key={status} value={status}>
                    {status === '全部' ? '全部状态' : status}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>
            <NativeSelect
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              aria-label="按负责人筛选"
            >
              <NativeSelectOption value="全部">全部负责人</NativeSelectOption>
              {[
                '林夏',
                '苏禾',
                ...resourcesData.map((resource) => resource.name),
              ].map((owner) => (
                <NativeSelectOption key={owner} value={owner}>
                  {owner}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </CardHeader>
        {mode === 'table' ? (
          <CardContent className="overflow-x-auto px-0">
            <table className="w-full min-w-[1680px] text-left text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  {[
                    'WBS',
                    '任务名称',
                    '所属项目',
                    '所属版本',
                    '负责人',
                    '状态',
                    '优先级',
                    '计划开始',
                    '计划完成',
                    '进度',
                    '工时',
                    '前置',
                    '风险',
                    '阻塞原因',
                    '任务类型',
                    versionScope === 'portfolio'
                      ? '迭代 / 阶段'
                      : (versionConfigs.find(
                            (config) => config.version === versionScope,
                          )?.mode ?? 'agile') === 'waterfall'
                        ? '阶段门禁'
                        : 'Sprint',
                    '完成定义 / 验收标准',
                    '需求变更来源',
                    '操作',
                  ].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((r) => (
                  <tr
                    key={r[0]}
                    className={`border-t hover:bg-muted/30 ${hierarchyByTask.get(r[0])?.level === 0 ? 'bg-blue-50/40' : ''}`}
                  >
                    {r.map((c, j) => (
                      <td key={j} className="px-4 py-3 whitespace-nowrap">
                        {j === 5 || j === 12 ? (
                          <StatusBadge value={c} />
                        ) : j === 3 ? (
                          <Badge variant="outline">{c}</Badge>
                        ) : j === 9 ? (
                          <div>
                            <div className="flex items-center gap-2">
                              <Progress
                                value={Number(c.replace('%', ''))}
                                className="w-16"
                              />
                              <span>{c}</span>
                            </div>
                            <span
                              className="mt-1 block text-[10px] text-muted-foreground"
                              title={getTaskSignal(r).detail}
                            >
                              {getTaskSignal(r).source} 信号
                            </span>
                          </div>
                        ) : j === 1 ? (
                          <div
                            className={
                              (hierarchyByTask.get(r[0])?.level ?? 0) > 0
                                ? 'flex items-start gap-2 pl-4'
                                : ''
                            }
                          >
                            {(hierarchyByTask.get(r[0])?.level ?? 0) > 0 && (
                              <span className="text-primary">↳</span>
                            )}
                            <div>
                              <span className="font-medium">{c}</span>
                              {hierarchyByTask.get(r[0])?.level === 0 && (
                                <p className="mt-1 text-[10px] text-primary">
                                  父任务 ·{' '}
                                  {childTasksByParent.get(r[0])?.length ?? 0}{' '}
                                  个子任务 · 进度自动汇总
                                </p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span>{c}</span>
                        )}
                      </td>
                    ))}
                    <td className="max-w-[260px] px-4 py-3">
                      {r[5] === '有阻塞' ? (
                        <button
                          type="button"
                          className="block text-left text-xs text-rose-700 hover:underline"
                          onClick={() => openTaskBlocker(r)}
                        >
                          {blockersData.find(
                            (blocker) => blocker.taskId === r[0],
                          )?.reason ?? '待补充阻塞原因'}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant="outline">
                        {getTaskDeliveryMeta(r).type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getTaskDeliveryMeta(r).sprint}
                    </td>
                    <td className="max-w-[280px] px-4 py-3 text-muted-foreground">
                      {getTaskDeliveryMeta(r).acceptance}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {changeTaskLinks.filter((link) => link.task_id === r[0])
                        .length ? (
                        <div className="flex flex-wrap gap-1">
                          {changeTaskLinks
                            .filter((link) => link.task_id === r[0])
                            .map((link) => (
                              <Badge key={link.id} variant="outline">
                                {link.change_id} · {link.relation_type}
                              </Badge>
                            ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {hierarchyByTask.get(r[0])?.level === 0 ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setTaskDraft((current) => ({
                                ...current,
                                parentTaskId: r[0],
                                version: r[3] as VersionId,
                                start: r[7],
                                end: r[8],
                              }));
                              setTaskDialogOpen(true);
                            }}
                          >
                            <Plus /> 新增子任务
                          </Button>
                          <Badge variant="secondary" className="ml-1">
                            自动汇总
                          </Badge>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingTask(cloneTask(r))}
                        >
                          编辑进度
                        </Button>
                      )}
                      {r[5] === '有阻塞' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-1 text-rose-700"
                          onClick={() => openTaskBlocker(r)}
                        >
                          阻塞详情
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleTasks.length === 0 && (
                  <tr className="border-t">
                    <td
                      colSpan={19}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      当前范围内没有分配给该成员的任务
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        ) : (
          <CardContent className="overflow-x-auto">
            <div className="grid min-w-[960px] grid-cols-4 gap-3">
              {['未开始', '进行中', '有阻塞', '已完成'].map((status) => {
                const columnTasks = visibleTasks.filter(
                  (task) => task[5] === status,
                );
                return (
                  <div key={status} className="rounded-xl bg-muted/50 p-3">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <StatusBadge value={status} />
                      <span className="ml-auto text-xs text-muted-foreground">
                        {columnTasks.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {columnTasks.map((task) => (
                        <div
                          key={task[0]}
                          className="rounded-lg border bg-card p-3 shadow-sm transition hover:border-primary/40"
                        >
                          <div className="flex items-start gap-2">
                            <span className="text-[11px] text-muted-foreground">
                              {task[0]}
                            </span>
                            <Badge variant="outline" className="ml-auto">
                              {task[3]}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm font-semibold">
                            {(hierarchyByTask.get(task[0])?.level ?? 0) > 0
                              ? '↳ '
                              : ''}
                            {task[1]}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge variant="outline">
                              {getTaskDeliveryMeta(task).type}
                            </Badge>
                            <Badge variant="secondary">
                              {getTaskDeliveryMeta(task).sprint}
                            </Badge>
                            {changeTaskLinks
                              .filter((link) => link.task_id === task[0])
                              .map((link) => (
                                <Badge key={link.id} variant="outline">
                                  {link.change_id}
                                </Badge>
                              ))}
                            {hierarchyByTask.get(task[0])?.level === 0 && (
                              <Badge>父任务 · 自动汇总</Badge>
                            )}
                          </div>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            {task[4]} · 截止 {task[8]}
                          </p>
                          <Progress
                            value={Number(task[9].replace('%', ''))}
                            className="mt-3"
                          />
                          {task[5] === '有阻塞' && (
                            <button
                              type="button"
                              className="mt-2 block text-left text-[11px] leading-4 text-rose-700 hover:underline"
                              onClick={(event) => {
                                event.stopPropagation();
                                openTaskBlocker(task);
                              }}
                            >
                              阻塞：
                              {blockersData.find(
                                (blocker) => blocker.taskId === task[0],
                              )?.reason ?? '待补充原因'}
                            </button>
                          )}
                          <p className="mt-2 text-[10px] text-muted-foreground">
                            {getTaskSignal(task).source} 信号 · 人工可修正
                          </p>
                          {hierarchyByTask.get(task[0])?.level === 0 ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 w-full"
                              onClick={(event) => {
                                event.stopPropagation();
                                setTaskDraft((current) => ({
                                  ...current,
                                  parentTaskId: task[0],
                                  version: task[3] as VersionId,
                                  start: task[7],
                                  end: task[8],
                                }));
                                setTaskDialogOpen(true);
                              }}
                            >
                              <Plus /> 新增子任务
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 w-full"
                              onClick={() => setEditingTask(cloneTask(task))}
                            >
                              编辑任务
                            </Button>
                          )}
                        </div>
                      ))}
                      {columnTasks.length === 0 && (
                        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                          暂无任务
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>
      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {taskDraft.parentTaskId ? '新增子任务' : '新增 WBS 任务'}
            </DialogTitle>
            <DialogDescription>
              {taskDraft.parentTaskId
                ? `父任务：${tasksData.find((task) => task[0] === taskDraft.parentTaskId)?.[1] ?? taskDraft.parentTaskId}。保存后由父任务自动汇总进度。`
                : '保存后会立即加入当前版本，并同步更新列表、看板和统计卡片。'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              className="sm:col-span-2"
              placeholder="任务名称"
              value={taskDraft.name}
              onChange={(event) =>
                setTaskDraft({ ...taskDraft, name: event.target.value })
              }
            />
            <NativeSelect
              className="w-full"
              value={taskDraft.version}
              disabled={Boolean(taskDraft.parentTaskId)}
              onChange={(event) =>
                setTaskDraft({
                  ...taskDraft,
                  version: event.target.value as VersionId,
                })
              }
              aria-label="任务所属版本"
            >
              <NativeSelectOption value="v0.9">v0.9 Alpha</NativeSelectOption>
              <NativeSelectOption value="v1.0">v1.0 Beta</NativeSelectOption>
              <NativeSelectOption value="v1.1">v1.1 Growth</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              className="w-full"
              value={taskDraft.owner}
              onChange={(event) =>
                setTaskDraft({ ...taskDraft, owner: event.target.value })
              }
              aria-label="任务负责人"
            >
              {['林夏', '苏禾', ...assignableResourceNames].map((owner) => (
                <NativeSelectOption key={owner} value={owner}>
                  {owner}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label="计划开始日期"
              value={taskDraft.start}
              onChange={(event) =>
                setTaskDraft({ ...taskDraft, start: event.target.value })
              }
            />
            <Input
              aria-label="计划完成日期"
              value={taskDraft.end}
              onChange={(event) =>
                setTaskDraft({ ...taskDraft, end: event.target.value })
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!taskDraft.name.trim() || savingTasks}
              onClick={saveDraftTask}
            >
              {savingTasks ? '正在保存…' : '保存任务'}
            </Button>
          </DialogFooter>
          {taskSaveError && (
            <p className="text-sm text-rose-600">{taskSaveError}</p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(editingTask)}
        onOpenChange={(open) => !open && setEditingTask(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>更新任务执行信息</DialogTitle>
            <DialogDescription>
              修改负责人、状态、实际进度或计划日期后，将写入 Python
              后端并同步刷新概览。
            </DialogDescription>
          </DialogHeader>
          {editingTask && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  {editingTask[0]} · {editingTask[3]}
                </p>
                <p className="mt-1 text-sm font-semibold">{editingTask[1]}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <NativeSelect
                  value={editingTask[4]}
                  onChange={(event) => {
                    const next = cloneTask(editingTask);
                    next[4] = event.target.value;
                    setEditingTask(next);
                  }}
                  aria-label="更新负责人"
                >
                  {['林夏', '苏禾', ...assignableResourceNames].map((owner) => (
                    <NativeSelectOption key={owner} value={owner}>
                      {owner}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect
                  value={editingTask[5]}
                  onChange={(event) => {
                    const next = cloneTask(editingTask);
                    next[5] = event.target.value as TaskStatus;
                    if (event.target.value === '已完成') next[9] = '100%';
                    if (event.target.value === '未开始') next[9] = '0%';
                    if (event.target.value === '进行中' && next[9] === '0%')
                      next[9] = '10%';
                    setEditingTask(next);
                  }}
                  aria-label="更新任务状态"
                >
                  {['未开始', '进行中', '有阻塞', '已完成'].map((status) => (
                    <NativeSelectOption key={status} value={status}>
                      {status}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  aria-label="更新任务进度"
                  value={editingTask[9].replace('%', '')}
                  onChange={(event) => {
                    const next = cloneTask(editingTask);
                    const progress = Math.min(
                      100,
                      Math.max(0, Number(event.target.value)),
                    );
                    next[9] = `${progress}%`;
                    if (next[5] !== '有阻塞') {
                      next[5] =
                        progress === 100
                          ? '已完成'
                          : progress > 0
                            ? '进行中'
                            : '未开始';
                    }
                    setEditingTask(next);
                  }}
                />
                <Input
                  aria-label="更新计划开始日期"
                  value={editingTask[7]}
                  onChange={(event) => {
                    const next = cloneTask(editingTask);
                    next[7] = event.target.value;
                    setEditingTask(next);
                  }}
                />
                <Input
                  aria-label="更新计划完成日期"
                  value={editingTask[8]}
                  onChange={(event) => {
                    const next = cloneTask(editingTask);
                    next[8] = event.target.value;
                    setEditingTask(next);
                  }}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTask(null)}>
              取消
            </Button>
            <Button disabled={savingTasks} onClick={saveTaskUpdate}>
              {savingTasks ? '正在保存…' : '保存并同步'}
            </Button>
          </DialogFooter>
          {taskSaveError && (
            <p className="text-sm text-rose-600">{taskSaveError}</p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(blockerDraft)}
        onOpenChange={(open) => !open && setBlockerDraft(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>任务阻塞详情</DialogTitle>
            <DialogDescription>
              {blockerDraft
                ? `${blockerDraft.taskId} · ${tasksData.find((task) => task[0] === blockerDraft.taskId)?.[1] ?? ''}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {blockerDraft && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <NativeSelect
                  value={blockerDraft.category}
                  onChange={(event) =>
                    setBlockerDraft({
                      ...blockerDraft,
                      category: event.target.value,
                    })
                  }
                  aria-label="阻塞类型"
                >
                  {[
                    '外部依赖',
                    '前置任务',
                    '多方协同',
                    '资源冲突',
                    '技术问题',
                    '待分类',
                  ].map((category) => (
                    <NativeSelectOption key={category} value={category}>
                      {category}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Input
                  value={blockerDraft.owner}
                  onChange={(event) =>
                    setBlockerDraft({
                      ...blockerDraft,
                      owner: event.target.value,
                    })
                  }
                  aria-label="阻塞处理责任人"
                  placeholder="处理责任人"
                />
                <NativeSelect
                  value={blockerDraft.status}
                  onChange={(event) =>
                    setBlockerDraft({
                      ...blockerDraft,
                      status: event.target.value,
                    })
                  }
                  aria-label="阻塞处理状态"
                >
                  {[
                    '待处理',
                    '待决策',
                    '待外部处理',
                    '待调配',
                    '处理中',
                    '已解除',
                  ].map((status) => (
                    <NativeSelectOption key={status} value={status}>
                      {status}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <Textarea
                value={blockerDraft.reason}
                onChange={(event) =>
                  setBlockerDraft({
                    ...blockerDraft,
                    reason: event.target.value,
                  })
                }
                placeholder="具体阻塞原因（必填）"
                aria-label="具体阻塞原因"
              />
              <Textarea
                value={blockerDraft.impact}
                onChange={(event) =>
                  setBlockerDraft({
                    ...blockerDraft,
                    impact: event.target.value,
                  })
                }
                placeholder="对任务、里程碑或版本的影响"
                aria-label="阻塞影响"
              />
              <Textarea
                value={blockerDraft.resolutionPlan}
                onChange={(event) =>
                  setBlockerDraft({
                    ...blockerDraft,
                    resolutionPlan: event.target.value,
                  })
                }
                placeholder="解决方案或应急预案"
                aria-label="阻塞解决方案"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={blockerDraft.source}
                  onChange={(event) =>
                    setBlockerDraft({
                      ...blockerDraft,
                      source: event.target.value,
                    })
                  }
                  aria-label="阻塞来源"
                  placeholder="来源：人工、Jira、Git、巡检等"
                />
                <Input
                  type="datetime-local"
                  value={dateTimeLocalValue(blockerDraft.expectedResolveAt)}
                  onChange={(event) =>
                    setBlockerDraft({
                      ...blockerDraft,
                      expectedResolveAt: new Date(
                        event.target.value,
                      ).toISOString(),
                    })
                  }
                  aria-label="预计解除时间"
                />
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                发现时间：{formatMilestoneDateTime(blockerDraft.discoveredAt)} ·
                最近更新：{formatMilestoneDateTime(blockerDraft.updatedAt)}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockerDraft(null)}>
              取消
            </Button>
            <Button
              onClick={saveTaskBlocker}
              disabled={savingBlocker || !blockerDraft?.reason.trim()}
            >
              {savingBlocker ? '正在保存…' : '保存阻塞记录'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              导入需求并生成 WBS
            </DialogTitle>
            <DialogDescription>
              AI
              先提取功能点、业务规则、页面与交互，再按当前版本交付模式、角色、依赖和验收门禁拆成任务草案。
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[180px]">
                <p className="text-sm font-semibold">
                  {importVersion} 交付模式
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  新版本首次拆分时可选；执行开始后锁定
                </p>
              </div>
              <NativeSelect
                value={importMode}
                disabled={currentVersionConfig.locked}
                onChange={(event) =>
                  setImportMode(event.target.value as DeliveryMode)
                }
                aria-label="选择版本交付模式"
              >
                <NativeSelectOption value="agile">敏捷迭代</NativeSelectOption>
                <NativeSelectOption value="waterfall">
                  传统瀑布
                </NativeSelectOption>
              </NativeSelect>
              <Badge
                variant="outline"
                className={
                  currentVersionConfig.locked
                    ? 'bg-slate-100 text-slate-700'
                    : 'bg-emerald-50 text-emerald-700'
                }
              >
                {currentVersionConfig.locked
                  ? '执行中 · 已锁定'
                  : '草案 · 可选择'}
              </Badge>
            </div>
            <p className="mt-3 text-xs leading-5 text-indigo-900/80">
              {importMode === 'agile'
                ? '敏捷：按用户故事拆为前端、后端、联调和测试子任务，可并行推进并按 Sprint 验收。'
                : '瀑布：按需求、设计、开发、联调、测试、验收六个阶段顺序拆分，每阶段设置准入与完成门禁。'}
              {currentVersionConfig.locked &&
                ' 当前版本已有执行数据；如需改变模式，应新建版本或先做影响分析并生成新基线。'}
            </p>
          </div>

          {importStage === 'select' && (
            <div className="space-y-4">
              <button
                type="button"
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/25 bg-primary/[0.03] px-6 py-9 text-center transition hover:border-primary/50 hover:bg-primary/[0.06]"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files?.[0];
                  if (file) selectRequirementFile(file);
                }}
              >
                <UploadCloud className="mb-3 size-8 text-primary" />
                <span className="text-sm font-semibold">
                  {requirementFile
                    ? requirementFile.name
                    : '选择本地需求文档或拖放到这里'}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {requirementFile
                    ? requirementFile.size
                    : '单文件最大 50MB；文件仅用于需求解析'}
                </span>
              </button>
              <Input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                accept=".doc,.docx,.rtf,.odt,.pdf,.md,.txt,.xls,.xlsx,.csv,.tsv,.ppt,.pptx,.xmind,.rp,.rplib,.zip"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) selectRequirementFile(file);
                }}
              />
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  支持的需求来源
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Word',
                    'PDF',
                    'Excel / CSV',
                    'PPT',
                    'Markdown',
                    'XMind',
                    'Axure RP',
                    '原型导出 ZIP',
                  ].map((format) => (
                    <Badge key={format} variant="outline">
                      {format}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                Axure
                文件会提取页面树、元件名称、交互说明和批注；若原型只有视觉稿，AI
                会把无法确认的业务规则列为“待澄清”，不会直接当作确定需求。
                启用云端 AI 后，文档内容会发送到已配置的模型服务进行分析；API
                Key 只保存在服务端，不会发送到浏览器。
              </div>
              {requirementError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  {requirementError}
                </p>
              )}
              <details className="rounded-lg border bg-card p-3">
                <summary className="cursor-pointer text-xs font-semibold">
                  历史需求拆分（{requirementHistory.length}）
                </summary>
                <div className="mt-3 space-y-2">
                  {requirementHistory.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      暂无历史记录。完成解析后会保存文档、草案及关联任务。
                    </p>
                  ) : (
                    requirementHistory.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-3 text-xs"
                      >
                        <FileText className="size-4 text-primary" />
                        <span className="font-medium">{item.file_name}</span>
                        <Badge variant="outline">
                          {item.draft?.version_id ?? '未指定版本'}
                        </Badge>
                        <Badge
                          className={
                            item.draft?.status === 'applied'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }
                        >
                          {item.draft?.status === 'applied'
                            ? '已写入 WBS'
                            : '待确认草案'}
                        </Badge>
                        <span className="ml-auto text-muted-foreground">
                          {item.created_at.replace('T', ' ').slice(0, 16)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </details>
            </div>
          )}

          {importStage === 'analyzing' && (
            <div className="flex flex-col items-center py-14 text-center">
              <RefreshCw className="size-8 animate-spin text-primary" />
              <p className="mt-4 font-semibold">
                正在理解需求结构并建立依赖图…
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                同时检查遗漏验收标准、跨系统依赖、资源冲突和非工作日
              </p>
            </div>
          )}

          {(importStage === 'preview' || importStage === 'done') && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="size-4 text-primary" />
                <span className="font-medium">
                  {requirementFile?.name ?? '需求文档'}
                </span>
                <Badge variant="secondary">解析完成</Badge>
                <Badge
                  variant="outline"
                  className={
                    requirementAnalysis?.aiProvider === 'openai'
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  }
                >
                  {requirementAnalysis?.aiProvider === 'openai'
                    ? `OpenAI · ${requirementAnalysis.aiModel ?? '结构化模型'}`
                    : '本地规则降级'}
                </Badge>
                {typeof requirementAnalysis?.confidence === 'number' && (
                  <Badge variant="outline">
                    置信度 {Math.round(requirementAnalysis.confidence * 100)}%
                  </Badge>
                )}
              </div>
              {requirementAnalysis?.aiProvider !== 'openai' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                  当前没有调用外部大模型，已自动使用本地内容分析，原因：
                  {requirementAnalysis?.aiFallbackReason === 'api_key_missing'
                    ? '尚未配置服务端 API Key'
                    : requirementAnalysis?.aiFallbackReason === 'ai_disabled'
                      ? 'AI 拆分尚未启用'
                      : requirementAnalysis?.aiFallbackReason?.startsWith(
                            'openai_http_',
                          )
                        ? '模型服务拒绝了本次请求'
                        : requirementAnalysis?.aiFallbackReason ===
                            'openai_invalid_output'
                          ? '模型结果未通过结构校验'
                          : requirementAnalysis?.aiFallbackReason ===
                              'no_readable_content'
                            ? '文档中没有提取到可供模型分析的内容'
                            : '模型服务暂时不可用'}
                  。草案仍可编辑和写入 WBS。
                </div>
              )}
              {requirementAnalysis?.textExtracted === false &&
                requirementAnalysis.aiProvider !== 'openai' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                    当前文件未提取到可读正文，任务名称仅参考文件名生成。请补充
                    Markdown/TXT 说明，或安装 PDF 解析依赖后重新分析；写入 WBS
                    前务必人工复核。
                  </div>
                )}
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  [
                    '识别功能点',
                    String(requirementAnalysis?.featureCount ?? 0),
                  ],
                  ['生成任务', String(requirementDrafts.length)],
                  [
                    '待澄清问题',
                    String(requirementAnalysis?.clarifications.length ?? 0),
                  ],
                  ['初始风险', String(requirementAnalysis?.risks.length ?? 0)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border bg-muted/30 p-3"
                  >
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-lg font-bold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="size-4" />
                待确认：
                {(requirementAnalysis?.clarifications ?? []).join('；')}
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900">
                初始风险：{(requirementAnalysis?.risks ?? []).join('；')}
              </div>
              {!!requirementAnalysis?.assumptions?.length && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
                  AI 推断（需人工确认）：
                  {requirementAnalysis.assumptions.join('；')}
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[840px] text-left text-xs">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      {[
                        '任务草案',
                        '类型',
                        importMode === 'agile' ? 'Sprint' : '阶段门禁',
                        '建议负责人',
                        '预估',
                        '前置',
                        '完成定义 / 验收标准',
                      ].map((header) => (
                        <th key={header} className="px-3 py-3 font-medium">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {requirementDrafts.map((draft, index) => (
                      <tr key={draft.sequence} className="border-t align-top">
                        <td className="px-3 py-3 font-medium">
                          <Input
                            aria-label={`任务 ${draft.sequence} 名称`}
                            value={draft.name}
                            onChange={(event) =>
                              setRequirementAnalysis((current) =>
                                current
                                  ? {
                                      ...current,
                                      tasks: current.tasks.map(
                                        (item, taskIndex) =>
                                          taskIndex === index
                                            ? {
                                                ...item,
                                                name: event.target.value,
                                              }
                                            : item,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="outline">{draft.type}</Badge>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {draft.stage}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <Input
                            className="min-w-28"
                            aria-label={`任务 ${draft.sequence} 负责人`}
                            value={draft.owner}
                            onChange={(event) =>
                              setRequirementAnalysis((current) =>
                                current
                                  ? {
                                      ...current,
                                      tasks: current.tasks.map(
                                        (item, taskIndex) =>
                                          taskIndex === index
                                            ? {
                                                ...item,
                                                owner: event.target.value,
                                              }
                                            : item,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-3">
                          <Input
                            className="w-20"
                            type="number"
                            min={1}
                            aria-label={`任务 ${draft.sequence} 预估工时`}
                            value={draft.estimateHours}
                            onChange={(event) =>
                              setRequirementAnalysis((current) =>
                                current
                                  ? {
                                      ...current,
                                      tasks: current.tasks.map(
                                        (item, taskIndex) =>
                                          taskIndex === index
                                            ? {
                                                ...item,
                                                estimateHours: Number(
                                                  event.target.value,
                                                ),
                                              }
                                            : item,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-3">
                          {draft.dependencySequences.length
                            ? draft.dependencySequences.join('、')
                            : '—'}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          <Textarea
                            className="min-w-52"
                            aria-label={`任务 ${draft.sequence} 验收标准`}
                            value={draft.acceptance}
                            onChange={(event) =>
                              setRequirementAnalysis((current) =>
                                current
                                  ? {
                                      ...current,
                                      tasks: current.tasks.map(
                                        (item, taskIndex) =>
                                          taskIndex === index
                                            ? {
                                                ...item,
                                                acceptance: event.target.value,
                                              }
                                            : item,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                          <div className="mt-1 text-[10px]">
                            {draft.start}–{draft.end}（已避开法定节假日）
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importStage === 'done' && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                  <CheckCircle2 className="size-4" />
                  已按{importMode === 'agile' ? '敏捷迭代' : '传统瀑布'}模式将{' '}
                  {requirementDrafts.length} 项子任务和 1 个交付包写入{' '}
                  {importVersion} WBS，列表、看板和统计已同步更新。
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {importStage === 'select' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRequirementFile({
                      name: '会员积分兑换需求说明_v1.2.md',
                      size: '2.1 KB · 内置示例文档',
                      sampleContent:
                        '# 会员积分兑换需求\n\n## 功能范围\n- 用户可以使用积分兑换优惠券\n- 兑换前校验会员等级和积分余额\n- 库存不足时禁止兑换\n- 第三方券码发放失败需要补偿\n\n## 验收标准\n1. 兑换成功后实时扣减积分\n2. 失败时积分自动返还\n3. 待确认：第三方券码失败重试上限\n4. 待确认：库存锁定时长\n\n## 非功能要求\n支付与库存接口需要支持并发和幂等。',
                    });
                    setRequirementAnalysis(null);
                    setRequirementError('');
                  }}
                >
                  <FileText />
                  载入示例需求
                </Button>
                <Button
                  disabled={!requirementFile}
                  onClick={analyzeRequirement}
                >
                  <Sparkles />
                  AI 解析并拆分
                </Button>
              </>
            )}
            {importStage === 'preview' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setImportStage('select')}
                >
                  重新选择
                </Button>
                <Button disabled={savingTasks} onClick={importRequirementTasks}>
                  <CheckCircle2 />
                  {savingTasks ? '正在写入…' : '确认并写入 WBS'}
                </Button>
              </>
            )}
            {importStage === 'done' && (
              <Button onClick={() => setImportDialogOpen(false)}>完成</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
