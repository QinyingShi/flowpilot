'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Bug,
  CheckCircle2,
  Clock3,
  GitBranch,
  MessageSquare,
  PlugZap,
  RefreshCw,
  Sheet,
  ShieldAlert,
  Users,
  Video,
} from 'lucide-react';

import { SectionTitle } from '@/components/section-title';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';

type ConnectorId = 'feishu' | 'dingtalk' | 'sheet' | 'git' | 'jira';
type ConnectorStatus = 'configured' | 'connected' | 'error';

type ConnectorConfig = {
  connector: ConnectorId;
  mode: 'sandbox' | 'live';
  status: ConnectorStatus;
  display_name: string;
  base_url: string;
  config_json: string;
  last_tested_at?: string | null;
  last_synced_at?: string | null;
  last_error?: string | null;
};

type AutomationRule = {
  rule_key: string;
  enabled: number;
  channel: string;
  rule_json: string;
  updated_at: string;
};

type SyncEvent = {
  connector: string;
  direction: string;
  entity_type: string;
  status: string;
  detail: string;
  occurred_at: string;
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
  resolution_note?: string | null;
  last_detected_at: string;
};

type InspectionRun = {
  id: string;
  trigger_type: 'manual' | 'scheduled';
  status: string;
  summary_json: string;
  started_at: string;
};

type ExternalWorkEvidence = {
  connector: string;
  external_id: string;
  task_id?: string | null;
  evidence_type: 'commit' | 'pull_request';
  title: string;
  url: string;
  state: string;
  author: string;
  occurred_at: string;
};

type WorkspacePayload = {
  user: { role: string };
  projectId: string;
  projects: { id: string; name: string }[];
  snapshot: {
    connectorConfigs?: ConnectorConfig[];
    automationRules?: AutomationRule[];
    syncEvents?: SyncEvent[];
    members?: { display_name: string; email: string }[];
    inspectionFindings?: InspectionFinding[];
    inspectionRuns?: InspectionRun[];
    externalWorkEvidence?: ExternalWorkEvidence[];
  };
};

type ConnectorDefinition = {
  id: ConnectorId;
  name: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  defaultUrl: string;
  optionLabel: string;
  optionPlaceholder: string;
};

const connectorDefinitions: ConnectorDefinition[] = [
  {
    id: 'feishu',
    name: '飞书',
    description: '通讯录、日历、会议室、消息与多维表格',
    icon: MessageSquare,
    tone: 'bg-blue-100 text-blue-700',
    defaultUrl: 'https://open.feishu.cn',
    optionLabel: '租户标识',
    optionPlaceholder: '例如：acme-feishu',
  },
  {
    id: 'dingtalk',
    name: '钉钉',
    description: '组织成员、日程、群机器人与待办通知',
    icon: Video,
    tone: 'bg-sky-100 text-sky-700',
    defaultUrl: 'https://api.dingtalk.com',
    optionLabel: '组织标识',
    optionPlaceholder: '例如：acme-dingtalk',
  },
  {
    id: 'sheet',
    name: '在线表格',
    description: 'Excel Online、飞书表格与任务记录表同步',
    icon: Sheet,
    tone: 'bg-emerald-100 text-emerald-700',
    defaultUrl: '',
    optionLabel: '表格标识',
    optionPlaceholder: 'Spreadsheet ID / Base ID',
  },
  {
    id: 'git',
    name: 'Git',
    description: '提交、分支、PR、流水线与任务进度核验',
    icon: GitBranch,
    tone: 'bg-slate-200 text-slate-800',
    defaultUrl: 'https://github.com',
    optionLabel: '仓库',
    optionPlaceholder: 'org/repository',
  },
  {
    id: 'jira',
    name: 'Jira',
    description: '缺陷、版本、迭代与质量风险指标',
    icon: Bug,
    tone: 'bg-violet-100 text-violet-700',
    defaultUrl: '',
    optionLabel: '项目代码',
    optionPlaceholder: '例如：NEBULA',
  },
];

const ruleDefinitions = [
  [
    'task_assignment',
    '任务分配通知',
    '设置负责人后立即发送任务卡片',
    'sendImmediately',
    '即时发送',
  ],
  [
    'progress_drift',
    '进度偏差提醒',
    '实际进度落后计划时提醒',
    'thresholdPercent',
    '偏差阈值（%）',
  ],
  [
    'due_reminder',
    '到期时间提醒',
    '到期前及逾期后重复提醒',
    'leadHours',
    '提前小时数',
  ],
  [
    'git_verification',
    'Git 进度核验',
    '提交与 PR 未覆盖计划任务时预警',
    'staleHours',
    '无提交小时数',
  ],
  [
    'quality_warning',
    '版本质量预警',
    '高优缺陷与重开率异常时提醒',
    'p1Limit',
    'P1 缺陷阈值',
  ],
  [
    'ai_inspection',
    'AI 自动巡检',
    '按周期扫描进度、负载与风险',
    'intervalMinutes',
    '巡检间隔（分钟）',
  ],
] as const;

function parseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readableTime(value?: string | null) {
  if (!value) return '尚未执行';
  return value.replace('T', ' ').slice(0, 16);
}

function scalarText(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

export default function IntegrationView() {
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [configuring, setConfiguring] = useState<ConnectorId | null>(null);
  const [configMode, setConfigMode] = useState<'sandbox' | 'live'>('sandbox');
  const [displayName, setDisplayName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [optionValue, setOptionValue] = useState('');
  const [lookbackDays, setLookbackDays] = useState(30);
  const [resolving, setResolving] = useState<InspectionFinding | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [ruleDrafts, setRuleDrafts] = useState<
    Record<string, Record<string, unknown>>
  >({});

  async function loadWorkspace() {
    setLoading(true);
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      if (!response.ok) throw new Error('工作台数据读取失败');
      const payload = (await response.json()) as WorkspacePayload;
      setWorkspace(payload);
      setRuleDrafts(
        Object.fromEntries(
          (payload.snapshot.automationRules ?? []).map((rule) => [
            rule.rule_key,
            parseJson(rule.rule_json),
          ]),
        ),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetch('/api/workspace', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('工作台数据读取失败');
        return (await response.json()) as WorkspacePayload;
      })
      .then((payload) => {
        if (!active) return;
        setWorkspace(payload);
        setRuleDrafts(
          Object.fromEntries(
            (payload.snapshot.automationRules ?? []).map((rule) => [
              rule.rule_key,
              parseJson(rule.rule_json),
            ]),
          ),
        );
      })
      .catch((error: unknown) => {
        if (active)
          setNotice(error instanceof Error ? error.message : '加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const configMap = useMemo(
    () =>
      new Map(
        (workspace?.snapshot.connectorConfigs ?? []).map((config) => [
          config.connector,
          config,
        ]),
      ),
    [workspace],
  );
  const ruleMap = useMemo(
    () =>
      new Map(
        (workspace?.snapshot.automationRules ?? []).map((rule) => [
          rule.rule_key,
          rule,
        ]),
      ),
    [workspace],
  );
  const activeProject = workspace?.projects.find(
    (project) => project.id === workspace.projectId,
  );
  const canManage = ['admin', 'project_manager'].includes(
    workspace?.user.role ?? '',
  );

  async function mutate(body: Record<string, unknown>) {
    const response = await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as {
      detail?: string;
      message?: string;
      ok?: boolean;
      count?: number;
      total?: number;
    };
    if (!response.ok)
      throw new Error(result.detail ?? result.message ?? '操作失败');
    return result;
  }

  function openConfiguration(definition: ConnectorDefinition) {
    const saved = configMap.get(definition.id);
    const options = saved ? parseJson(saved.config_json) : {};
    setConfiguring(definition.id);
    setConfigMode(saved?.mode ?? 'sandbox');
    setDisplayName(saved?.display_name ?? `${definition.name}连接`);
    setBaseUrl(saved?.base_url ?? definition.defaultUrl);
    setOptionValue(scalarText(options.scope));
    setLookbackDays(Number(options.lookbackDays) || 30);
    setNotice('');
  }

  async function saveConfiguration() {
    if (!configuring) return;
    setBusy(`save-${configuring}`);
    try {
      await mutate({
        action: 'save_connector_config',
        connector: configuring,
        connectorConfig: {
          mode: configMode,
          displayName,
          baseUrl,
          options: {
            scope: optionValue,
            ...(configuring === 'git' ? { lookbackDays } : {}),
          },
        },
      });
      setNotice('配置已保存。下一步请执行连接测试。');
      await loadWorkspace();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '配置保存失败');
    } finally {
      setBusy('');
    }
  }

  async function runConnectorAction(
    connector: ConnectorId,
    action: 'test_connector' | 'sync_connector' | 'disconnect_connector',
  ) {
    setBusy(`${action}-${connector}`);
    try {
      const result = await mutate({ action, connector });
      if (action === 'test_connector') {
        setNotice(result.detail ?? '连接验证完成。');
      } else if (action === 'sync_connector') {
        setNotice(
          result.detail ?? `同步完成，共处理 ${result.count ?? 0} 条记录。`,
        );
      } else {
        setNotice('连接已停用，配置仍保留。');
      }
      await loadWorkspace();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy('');
    }
  }

  async function saveRule(
    ruleKey: string,
    enabled?: boolean,
    channel?: string,
  ) {
    const saved = ruleMap.get(ruleKey);
    setBusy(`rule-${ruleKey}`);
    try {
      await mutate({
        action: 'update_automation_rule',
        automationRule: {
          ruleKey,
          enabled: enabled ?? Boolean(saved?.enabled),
          channel: channel ?? saved?.channel ?? 'workspace',
          config: ruleDrafts[ruleKey] ?? {},
        },
      });
      setNotice('自动化规则已保存并立即生效。');
      await loadWorkspace();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '规则保存失败');
    } finally {
      setBusy('');
    }
  }

  async function runInspection() {
    setBusy('inspection');
    try {
      const result = await mutate({ action: 'run_ai_inspection' });
      setNotice(
        `巡检完成：识别 ${result.total ?? 0} 项异常，结果已进入闭环台账。`,
      );
      await loadWorkspace();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '巡检失败');
    } finally {
      setBusy('');
    }
  }

  async function updateFinding(
    finding: InspectionFinding,
    status: 'acknowledged' | 'resolved',
    note = '',
  ) {
    setBusy(`finding-${finding.fingerprint}`);
    try {
      await mutate({
        action: 'update_inspection_finding',
        finding: { fingerprint: finding.fingerprint, status, note },
      });
      setNotice(
        status === 'resolved'
          ? '告警已闭环并保存处理说明。'
          : '告警已确认，进入处理中。',
      );
      setResolving(null);
      setResolutionNote('');
      await loadWorkspace();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '告警状态保存失败');
    } finally {
      setBusy('');
    }
  }

  const activeFindings = (workspace?.snapshot.inspectionFindings ?? []).filter(
    (finding) => finding.status !== 'resolved',
  );
  const latestRun = workspace?.snapshot.inspectionRuns?.[0];
  const gitEvidence = workspace?.snapshot.externalWorkEvidence ?? [];
  const linkedGitEvidence = gitEvidence.filter((item) => item.task_id);

  return (
    <>
      <SectionTitle
        eyebrow="Connect · Observe · Automate"
        title="集成与自动化中心"
        action={
          <div className="flex items-center gap-2">
            <Badge className="bg-blue-100 text-blue-800">
              {activeProject?.name ?? '当前项目'} · 项目级配置
            </Badge>
            <Button
              size="sm"
              onClick={() => void runInspection()}
              disabled={!canManage || busy === 'inspection'}
            >
              <Bot className={busy === 'inspection' ? 'animate-pulse' : ''} />
              {busy === 'inspection' ? '巡检中…' : '立即巡检'}
            </Button>
          </div>
        }
      />

      <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-950">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">连接状态现在会真实保存</p>
            <p className="mt-1 text-xs leading-5 text-blue-800">
              沙箱用于本地演练，所有记录都会标明“未访问真实第三方”；实时模式只有完成服务端凭证和适配器验证后才会显示已连接。密钥不会写入业务数据库。
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadWorkspace()}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} /> 刷新状态
          </Button>
        </div>
      </div>

      {notice && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          {notice}
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {connectorDefinitions.map((definition) => {
          const config = configMap.get(definition.id);
          const active = config?.status === 'connected';
          const errored = config?.status === 'error';
          const statusLabel = !config
            ? '未配置'
            : active
              ? config.mode === 'sandbox'
                ? '沙箱已连接'
                : '实时已连接'
              : errored
                ? '验证失败'
                : '待验证';
          const Icon = definition.icon;
          return (
            <Card key={definition.id} size="sm">
              <CardContent className="flex h-full flex-col">
                <div className="mb-3 flex items-center justify-between">
                  <span className={`rounded-lg p-2 ${definition.tone}`}>
                    <Icon className="size-4" />
                  </span>
                  <Badge
                    className={
                      active
                        ? 'bg-emerald-100 text-emerald-700'
                        : errored
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-slate-100 text-slate-600'
                    }
                  >
                    {statusLabel}
                  </Badge>
                </div>
                <p className="text-sm font-semibold">{definition.name}</p>
                <p className="mt-1 min-h-10 text-[11px] leading-5 text-muted-foreground">
                  {definition.description}
                </p>
                <p className="mt-3 text-[10px] text-muted-foreground">
                  最近同步：{readableTime(config?.last_synced_at)}
                </p>
                {config?.last_error && (
                  <p className="mt-2 text-[10px] leading-4 text-rose-600">
                    {config.last_error}
                  </p>
                )}
                <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openConfiguration(definition)}
                    disabled={!canManage}
                  >
                    配置
                  </Button>
                  {active ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        void runConnectorAction(definition.id, 'sync_connector')
                      }
                      disabled={Boolean(busy)}
                    >
                      同步
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() =>
                        void runConnectorAction(definition.id, 'test_connector')
                      }
                      disabled={!config || Boolean(busy)}
                    >
                      测试
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <PlugZap className="size-4 text-primary" />
              自动化巡检与通知规则
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              开关、阈值和通知渠道均按当前项目持久化
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {ruleDefinitions.map(
              ([key, name, description, configKey, configLabel]) => {
                const rule = ruleMap.get(key);
                const config = ruleDrafts[key] ?? {};
                const enabled = Boolean(rule?.enabled);
                return (
                  <div
                    key={key}
                    className="grid gap-3 rounded-xl border p-3 md:grid-cols-[1fr_150px_150px_auto] md:items-center"
                  >
                    <div>
                      <p className="text-sm font-medium">{name}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {description}
                      </p>
                    </div>
                    {configKey === 'sendImmediately' ? (
                      <div className="text-xs text-muted-foreground">
                        {configLabel}
                      </div>
                    ) : (
                      <label className="text-[10px] text-muted-foreground">
                        {configLabel}
                        <Input
                          className="mt-1 h-8"
                          type="number"
                          min={1}
                          value={scalarText(config[configKey])}
                          onChange={(event) =>
                            setRuleDrafts((current) => ({
                              ...current,
                              [key]: {
                                ...current[key],
                                [configKey]: Number(event.target.value),
                              },
                            }))
                          }
                          onBlur={() => void saveRule(key)}
                          disabled={!canManage}
                        />
                      </label>
                    )}
                    <NativeSelect
                      className="w-full"
                      value={rule?.channel ?? 'workspace'}
                      onChange={(event) =>
                        void saveRule(key, undefined, event.target.value)
                      }
                      disabled={!canManage}
                    >
                      <NativeSelectOption value="workspace">
                        工作台内
                      </NativeSelectOption>
                      <NativeSelectOption value="feishu">
                        飞书消息
                      </NativeSelectOption>
                      <NativeSelectOption value="dingtalk">
                        钉钉消息
                      </NativeSelectOption>
                      <NativeSelectOption value="email">
                        邮件
                      </NativeSelectOption>
                    </NativeSelect>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(checked) => void saveRule(key, checked)}
                      disabled={!canManage || busy === `rule-${key}`}
                      aria-label={`${name}开关`}
                    />
                  </div>
                );
              },
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="size-4 text-primary" />
              最近连接与同步记录
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              测试、同步成功与失败均保留证据
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {(workspace?.snapshot.syncEvents ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                暂无记录。配置连接并执行测试后会出现在这里。
              </div>
            ) : (
              (workspace?.snapshot.syncEvents ?? [])
                .slice(0, 8)
                .map((event, index) => (
                  <div
                    key={`${event.connector}-${event.occurred_at}-${index}`}
                    className="flex gap-3 rounded-lg border p-3"
                  >
                    {event.status === 'success' ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-600" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium">
                        {event.connector} · {event.entity_type}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        {event.detail}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {readableTime(event.occurred_at)}
                      </p>
                    </div>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-5">
        <CardHeader className="border-b">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <ShieldAlert className="size-4 text-amber-600" />
            巡检告警闭环
            <Badge className="bg-rose-100 text-rose-700">
              {activeFindings.length} 项待闭环
            </Badge>
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              最近巡检：{readableTime(latestRun?.started_at)} ·{' '}
              {latestRun?.trigger_type === 'scheduled'
                ? '后台定时'
                : latestRun
                  ? '手动执行'
                  : '尚未运行'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {activeFindings.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground lg:col-span-2">
              暂无未闭环告警。点击“立即巡检”生成最新检查结果。
            </div>
          ) : (
            activeFindings.slice(0, 10).map((finding) => (
              <div key={finding.fingerprint} className="rounded-xl border p-4">
                <div className="flex items-start gap-2">
                  <Badge
                    className={
                      finding.severity === 'high'
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-amber-100 text-amber-700'
                    }
                  >
                    {finding.severity === 'high' ? '高' : '中'}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{finding.title}</p>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {finding.detail}
                    </p>
                  </div>
                </div>
                <div className="mt-3 rounded-lg bg-muted/60 p-3 text-[11px] leading-5">
                  <strong>AI 建议：</strong>
                  {finding.recommendation}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    责任人：{finding.owner}
                  </span>
                  {finding.status === 'open' && (
                    <Button
                      className="ml-auto"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void updateFinding(finding, 'acknowledged')
                      }
                      disabled={Boolean(busy)}
                    >
                      确认处理
                    </Button>
                  )}
                  {finding.status === 'acknowledged' && (
                    <Badge className="ml-auto bg-blue-100 text-blue-700">
                      处理中
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      setResolving(finding);
                      setResolutionNote('');
                    }}
                    disabled={Boolean(busy)}
                  >
                    提交闭环
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              成员与字段映射
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs leading-6 text-muted-foreground">
              通讯录连接后，以邮箱/手机号为首选键，Git 用户名与 Jira Account ID
              作为外部身份。冲突项进入人工确认，确认动作写入审计日志。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(workspace?.snapshot.members ?? []).slice(0, 6).map((member) => (
                <Badge key={member.email} variant="secondary">
                  {member.display_name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="size-4 text-slate-700" />
              进度与质量数据
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs leading-6 text-muted-foreground">
            {gitEvidence.length === 0 ? (
              <p>
                Git/Jira 未连接时不展示伪造指标。GitHub
                真实同步后，会按提交信息和 PR 标题/描述中的 WBS
                编号生成进度证据。
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    ['同步证据', gitEvidence.length],
                    ['已关联任务', linkedGitEvidence.length],
                    [
                      '待人工关联',
                      gitEvidence.length - linkedGitEvidence.length,
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-muted/60 p-2">
                      <p className="text-base font-semibold text-foreground">
                        {value}
                      </p>
                      <p className="text-[10px]">{label}</p>
                    </div>
                  ))}
                </div>
                {gitEvidence.slice(0, 5).map((item) => (
                  <a
                    key={`${item.external_id}-${item.task_id ?? 'unlinked'}`}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-lg border p-2 transition-colors hover:bg-muted/60"
                  >
                    <span className="font-medium text-foreground">
                      {item.task_id ? `${item.task_id} · ` : ''}
                      {item.title}
                    </span>
                    <span className="mt-1 block text-[10px]">
                      {item.evidence_type === 'pull_request' ? 'PR' : '提交'} ·{' '}
                      {item.state} · {item.author || '未知作者'} ·{' '}
                      {readableTime(item.occurred_at)}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(configuring)}
        onOpenChange={(open) => !open && setConfiguring(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              配置{' '}
              {
                connectorDefinitions.find((item) => item.id === configuring)
                  ?.name
              }
            </DialogTitle>
            <DialogDescription>
              配置按当前项目保存。数据库只保存地址、范围等非敏感元数据。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="block text-xs font-medium">
              运行模式
              <NativeSelect
                className="mt-1 w-full"
                value={configMode}
                onChange={(event) =>
                  setConfigMode(event.target.value as 'sandbox' | 'live')
                }
              >
                <NativeSelectOption value="sandbox">
                  沙箱模拟（推荐本地调试）
                </NativeSelectOption>
                <NativeSelectOption value="live">真实第三方</NativeSelectOption>
              </NativeSelect>
            </div>
            <label
              className="block text-xs font-medium"
              htmlFor="connector-display-name"
            >
              连接名称
              <Input
                id="connector-display-name"
                className="mt-1"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label
              className="block text-xs font-medium"
              htmlFor="connector-base-url"
            >
              服务地址
              <Input
                id="connector-base-url"
                className="mt-1"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://..."
              />
            </label>
            <label
              className="block text-xs font-medium"
              htmlFor="connector-scope"
            >
              {
                connectorDefinitions.find((item) => item.id === configuring)
                  ?.optionLabel
              }
              <Input
                id="connector-scope"
                className="mt-1"
                value={optionValue}
                onChange={(event) => setOptionValue(event.target.value)}
                placeholder={
                  connectorDefinitions.find((item) => item.id === configuring)
                    ?.optionPlaceholder
                }
              />
            </label>
            {configuring === 'git' && (
              <label
                className="block text-xs font-medium"
                htmlFor="connector-lookback-days"
              >
                同步回溯天数
                <Input
                  id="connector-lookback-days"
                  className="mt-1"
                  type="number"
                  min={1}
                  max={90}
                  value={lookbackDays}
                  onChange={(event) =>
                    setLookbackDays(
                      Math.max(
                        1,
                        Math.min(90, Number(event.target.value) || 1),
                      ),
                    )
                  }
                />
              </label>
            )}
            <div
              className={
                configMode === 'sandbox'
                  ? 'rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900'
                  : 'rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900'
              }
            >
              {configMode === 'sandbox'
                ? '沙箱只生成明确标记的本地连接测试和同步演练日志，不会访问或修改真实第三方数据。'
                : '真实凭证请通过服务端环境变量配置；页面不会收集 App Secret、Token 或密码。当前适配器未启用时测试会明确失败。'}
            </div>
          </div>
          <DialogFooter>
            {configuring && configMap.has(configuring) && (
              <Button
                variant="outline"
                onClick={() =>
                  void runConnectorAction(configuring, 'disconnect_connector')
                }
                disabled={Boolean(busy)}
              >
                停用连接
              </Button>
            )}
            <Button variant="outline" onClick={() => setConfiguring(null)}>
              取消
            </Button>
            <Button
              onClick={() => void saveConfiguration()}
              disabled={Boolean(busy)}
            >
              {busy.startsWith('save-') ? '保存中…' : '保存配置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(resolving)}
        onOpenChange={(open) => !open && setResolving(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>提交告警闭环</DialogTitle>
            <DialogDescription>
              {resolving?.title}
              。闭环后若异常条件仍存在，下次巡检会自动重新打开。
            </DialogDescription>
          </DialogHeader>
          <label
            className="text-xs font-medium"
            htmlFor="finding-resolution-note"
          >
            处理结果与证据
            <Input
              id="finding-resolution-note"
              className="mt-1"
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
              placeholder="例如：任务已重新排期，负责人确认于 09/14 完成"
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>
              取消
            </Button>
            <Button
              onClick={() =>
                resolving &&
                void updateFinding(resolving, 'resolved', resolutionNote)
              }
              disabled={!resolutionNote.trim() || Boolean(busy)}
            >
              确认闭环
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
