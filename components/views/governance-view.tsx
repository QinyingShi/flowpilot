'use client';
/* oxlint-disable next/no-html-link-for-pages */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  KeyRound,
  Plus,
  ShieldAlert,
  UserCog,
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

type MemberRole = 'admin' | 'project_manager' | 'member' | 'viewer';
type MemberStatus = 'active' | 'invited' | 'disabled';
type Member = {
  id: string;
  email: string;
  display_name: string;
  role: MemberRole;
  status: MemberStatus;
};
type AuditLog = {
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  detail?: string;
  created_at: string;
};
type PermissionName = 'manage_version' | 'approve_change' | 'approve_release';
type PermissionRecord = {
  member_id: string;
  permission: PermissionName;
  version_id: string;
};

const roleLabels: Record<MemberRole, string> = {
  admin: '系统管理员',
  project_manager: '项目经理',
  member: '项目成员',
  viewer: '只读访客',
};
const statusLabels: Record<MemberStatus, string> = {
  active: '正常',
  invited: '待接受邀请',
  disabled: '已停用',
};

export default function GovernanceView() {
  const [systemState, setSystemState] = useState<
    'checking' | 'ready' | 'signin' | 'database'
  >('checking');
  const [identity, setIdentity] = useState('当前用户');
  const [projectName, setProjectName] = useState('当前项目');
  const [versionIds, setVersionIds] = useState(['v1.0']);
  const [currentRole, setCurrentRole] = useState<MemberRole>('viewer');
  const [members, setMembers] = useState<Member[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [permissionTarget, setPermissionTarget] = useState<Member | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<PermissionRecord[]>(
    [],
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState({
    displayName: '',
    email: '',
    role: 'member' as MemberRole,
  });

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) {
        setSystemState('signin');
        return;
      }
      if (!response.ok) {
        setSystemState('database');
        return;
      }
      const result = (await response.json()) as {
        projectId?: string;
        projects?: Array<{ id: string; name: string }>;
        user?: { displayName?: string; email?: string; role?: MemberRole };
        snapshot?: {
          members?: Member[];
          auditLogs?: AuditLog[];
          permissions?: PermissionRecord[];
          versionConfigs?: Array<{ version: string }>;
        };
      };
      setProjectName(
        result.projects?.find((project) => project.id === result.projectId)
          ?.name ?? '当前项目',
      );
      setVersionIds(
        result.snapshot?.versionConfigs?.length
          ? result.snapshot.versionConfigs.map((config) => config.version)
          : ['v1.0'],
      );
      setIdentity(
        result.user?.displayName ?? result.user?.email ?? '已登录用户',
      );
      setCurrentRole(result.user?.role ?? 'viewer');
      setMembers(result.snapshot?.members ?? []);
      setAuditLogs(result.snapshot?.auditLogs ?? []);
      setPermissions(result.snapshot?.permissions ?? []);
      setSystemState('ready');
    } catch {
      setSystemState('database');
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function saveMember(input: {
    id?: string;
    email: string;
    displayName: string;
    role: MemberRole;
    status: MemberStatus;
  }) {
    setSaving(input.id ?? 'new');
    setMessage('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_workspace_member',
          member: input,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        detail?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          result?.detail === 'last_admin_required'
            ? '至少需要保留一名正常状态的系统管理员。'
            : result?.detail === 'admin_required'
              ? '只有系统管理员可以调整成员权限。'
              : '成员信息保存失败。',
        );
      }
      setMessage(
        input.status === 'invited'
          ? '已创建 ' + input.email + ' 的邀请记录。'
          : '成员权限已更新。',
      );
      setInviteOpen(false);
      setDraft({ displayName: '', email: '', role: 'member' });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '成员信息保存失败。');
    } finally {
      setSaving('');
    }
  }

  function openPermissions(member: Member) {
    setPermissionTarget(member);
    setPermissionDraft(
      permissions.filter((item) => item.member_id === member.id),
    );
  }

  function togglePermission(permission: PermissionName, versionId: string) {
    const exists = permissionDraft.some(
      (item) => item.permission === permission && item.version_id === versionId,
    );
    setPermissionDraft((current) =>
      exists
        ? current.filter(
            (item) =>
              item.permission !== permission || item.version_id !== versionId,
          )
        : [
            ...current,
            {
              member_id: permissionTarget?.id ?? '',
              permission,
              version_id: versionId,
            },
          ],
    );
  }

  async function savePermissions() {
    if (!permissionTarget) return;
    setSaving('permissions-' + permissionTarget.id);
    setMessage('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'replace_member_permissions',
          memberId: permissionTarget.id,
          permissions: permissionDraft.map((item) => ({
            permission: item.permission,
            versionId: item.version_id,
          })),
        }),
      });
      if (!response.ok) throw new Error('项目与版本授权保存失败。');
      setPermissionTarget(null);
      setMessage('项目与版本授权已更新。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '授权保存失败。');
    } finally {
      setSaving('');
    }
  }

  const activeCount = members.filter(
    (member) => member.status === 'active',
  ).length;
  const invitedCount = members.filter(
    (member) => member.status === 'invited',
  ).length;
  const stateLabel = {
    checking: '正在检查',
    ready: '身份与权限已连接',
    signin: '需要登录或加入工作区',
    database: '等待后端服务',
  }[systemState];

  return (
    <>
      <SectionTitle
        eyebrow="Identity · Permission · Traceability"
        title="成员与权限中心"
        action={
          <div className="flex gap-2">
            <Badge
              className={
                systemState === 'ready'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-800'
              }
            >
              {stateLabel}
            </Badge>
            {currentRole === 'admin' && (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <Plus />
                邀请成员
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        {[
          ['当前身份', identity, roleLabels[currentRole]],
          ['正常成员', String(activeCount), '可访问工作台'],
          ['待接受邀请', String(invitedCount), '首次登录后激活'],
          ['权限策略', '4 个角色', '服务端强制校验'],
        ].map(([label, value, note]) => (
          <Card key={label} size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-base font-bold">{value}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {systemState === 'signin' && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert className="size-5" />
          当前账号未登录、未被邀请，或者已经停用。
          <a
            href="/signin-with-chatgpt?return_to=/"
            target="_top"
            className="ml-auto rounded-lg bg-amber-900 px-3 py-2 text-xs font-medium text-white"
          >
            登录工作台
          </a>
        </div>
      )}
      {message && (
        <p className="mb-5 rounded-lg border bg-card p-3 text-sm">{message}</p>
      )}

      <Card className="mb-5">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <UserCog className="size-4 text-primary" />
            工作区成员
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            正式环境默认采用邀请制；停用后立即失去接口访问权限。
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                {['成员', '邮箱', '状态', '角色', '操作'].map((item) => (
                  <th key={item} className="px-4 py-3 font-medium">
                    {item}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t">
                  <td className="px-4 py-3 font-medium">
                    {member.display_name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {member.email}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">
                      {statusLabels[member.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <NativeSelect
                      className="w-36"
                      value={member.role}
                      disabled={currentRole !== 'admin' || saving === member.id}
                      onChange={(event) =>
                        void saveMember({
                          id: member.id,
                          email: member.email,
                          displayName: member.display_name,
                          role: event.target.value as MemberRole,
                          status: member.status,
                        })
                      }
                      aria-label={'调整' + member.display_name + '的角色'}
                    >
                      {Object.entries(roleLabels).map(([value, label]) => (
                        <NativeSelectOption key={value} value={value}>
                          {label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={currentRole !== 'admin'}
                        aria-label={`配置${member.display_name}的项目与版本权限`}
                        onClick={() => openPermissions(member)}
                      >
                        授权
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          currentRole !== 'admin' || saving === member.id
                        }
                        aria-label={`${member.status === 'disabled' ? '重新启用' : '停用'}${member.display_name}的账号`}
                        onClick={() =>
                          void saveMember({
                            id: member.id,
                            email: member.email,
                            displayName: member.display_name,
                            role: member.role,
                            status:
                              member.status === 'disabled'
                                ? 'active'
                                : 'disabled',
                          })
                        }
                      >
                        {member.status === 'disabled' ? '重新启用' : '停用账号'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!members.length && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    暂无成员记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_1.2fr]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>角色权限矩阵</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            <table className="w-full min-w-[520px] text-center text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  {['角色', '查看', '更新本人任务', '调整计划', '管理成员'].map(
                    (item) => (
                      <th key={item} className="px-3 py-3">
                        {item}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {[
                  ['系统管理员', true, true, true, true],
                  ['项目经理', true, true, true, false],
                  ['项目成员', true, true, false, false],
                  ['只读访客', true, false, false, false],
                ].map((row) => (
                  <tr key={String(row[0])} className="border-t">
                    <td className="px-3 py-3 text-left font-medium">
                      {row[0]}
                    </td>
                    {row.slice(1).map((allowed, index) => (
                      <td key={index} className="px-3 py-3">
                        {allowed ? (
                          <CheckCircle2 className="mx-auto size-4 text-emerald-500" />
                        ) : (
                          '—'
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="size-4 text-primary" />
              最近权限与操作审计
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {auditLogs.slice(0, 8).map((log, index) => (
              <div
                key={log.created_at + '-' + index}
                className="rounded-lg border p-3 text-xs"
              >
                <p className="font-semibold">
                  {log.actor_id} · {log.action}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {log.created_at} · {log.entity_type} {log.entity_id ?? ''} ·{' '}
                  {log.detail ?? '—'}
                </p>
              </div>
            ))}
            {!auditLogs.length && (
              <p className="py-10 text-center text-xs text-muted-foreground">
                暂无审计记录
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>邀请工作区成员</DialogTitle>
            <DialogDescription>
              该邮箱首次登录后自动激活，并继承指定角色。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="姓名"
              value={draft.displayName}
              onChange={(event) =>
                setDraft({ ...draft, displayName: event.target.value })
              }
            />
            <Input
              type="email"
              placeholder="企业邮箱"
              value={draft.email}
              onChange={(event) =>
                setDraft({ ...draft, email: event.target.value })
              }
            />
            <NativeSelect
              className="w-full"
              value={draft.role}
              onChange={(event) =>
                setDraft({ ...draft, role: event.target.value as MemberRole })
              }
            >
              <NativeSelectOption value="project_manager">
                项目经理
              </NativeSelectOption>
              <NativeSelectOption value="member">项目成员</NativeSelectOption>
              <NativeSelectOption value="viewer">只读访客</NativeSelectOption>
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                saving === 'new' ||
                !draft.displayName.trim() ||
                !draft.email.includes('@')
              }
              onClick={() =>
                void saveMember({
                  email: draft.email,
                  displayName: draft.displayName,
                  role: draft.role,
                  status: 'invited',
                })
              }
            >
              {saving === 'new' ? '正在创建…' : '创建邀请'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(permissionTarget)}
        onOpenChange={(open) => !open && setPermissionTarget(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" />
              配置项目与版本授权
            </DialogTitle>
            <DialogDescription>
              {permissionTarget?.display_name} · {projectName}
              。系统管理员天然拥有全部权限，无需重复授权。
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-center text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-3 py-3 text-left">授权能力</th>
                  {[...versionIds, '*'].map((version) => (
                    <th key={version} className="px-3 py-3">
                      {version === '*' ? '全部版本' : version}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['manage_version', '版本负责人'],
                  ['approve_change', '需求变更审核'],
                  ['approve_release', '发布审批'],
                ].map(([permission, label]) => (
                  <tr key={permission} className="border-t">
                    <td className="px-3 py-3 text-left font-medium">{label}</td>
                    {[...versionIds, '*'].map((version) => {
                      const checked = permissionDraft.some(
                        (item) =>
                          item.permission === permission &&
                          item.version_id === version,
                      );
                      return (
                        <td key={version} className="px-3 py-3">
                          <button
                            type="button"
                            className={
                              checked
                                ? 'mx-auto flex size-7 items-center justify-center rounded-md bg-primary text-white'
                                : 'mx-auto flex size-7 items-center justify-center rounded-md border text-muted-foreground'
                            }
                            onClick={() =>
                              togglePermission(
                                permission as PermissionName,
                                version,
                              )
                            }
                            aria-label={label + ' ' + version}
                          >
                            {checked ? '✓' : '—'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermissionTarget(null)}>
              取消
            </Button>
            <Button
              onClick={savePermissions}
              disabled={saving.startsWith('permissions-')}
            >
              保存授权
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
