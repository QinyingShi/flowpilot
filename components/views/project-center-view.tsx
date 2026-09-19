'use client';

import { useMemo, useState } from 'react';
import {
  Archive,
  Boxes,
  CalendarDays,
  CheckCircle2,
  FolderKanban,
  Pencil,
  Plus,
  Users,
} from 'lucide-react';

import { SectionTitle } from '@/components/section-title';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { addCalendarDays, shanghaiNow } from '@/lib/shanghai-time';

export type ProjectSummary = {
  id: string;
  name: string;
  code: string;
  description: string;
  owner_id: string;
  owner_name: string;
  status: 'active' | 'archived';
  member_count: number;
  version_count: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceMemberSummary = {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'project_manager' | 'member' | 'viewer';
  status: 'active' | 'invited' | 'disabled';
};

type ProjectCenterViewProps = {
  projects: ProjectSummary[];
  members: WorkspaceMemberSummary[];
  currentProjectId: string;
  currentRole: WorkspaceMemberSummary['role'];
  onSwitch: (projectId: string) => Promise<void> | void;
  onChanged: (projectId?: string) => Promise<void> | void;
};

const roleLabel: Record<WorkspaceMemberSummary['role'], string> = {
  admin: '系统管理员',
  project_manager: '项目经理',
  member: '项目成员',
  viewer: '只读访客',
};

export default function ProjectCenterView({
  projects,
  members,
  currentProjectId,
  currentRole,
  onSwitch,
  onChanged,
}: ProjectCenterViewProps) {
  const defaultReleaseDate = useMemo(
    () => addCalendarDays(shanghaiNow().date, 30),
    [],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ProjectSummary | null>(
    null,
  );
  const [editTarget, setEditTarget] = useState<ProjectSummary | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState({
    name: '',
    code: '',
    description: '',
    initialVersion: 'v1.0',
    deliveryMode: 'agile',
    releaseDate: defaultReleaseDate,
    memberIds: [] as string[],
  });

  const activeProjects = projects.filter(
    (project) => project.status === 'active',
  );
  const archivedProjects = projects.filter(
    (project) => project.status === 'archived',
  );
  const selectableMembers = members.filter(
    (member) => member.status !== 'disabled',
  );

  function toggleMember(memberId: string) {
    setDraft((current) => ({
      ...current,
      memberIds: current.memberIds.includes(memberId)
        ? current.memberIds.filter((id) => id !== memberId)
        : [...current.memberIds, memberId],
    }));
  }

  async function createNewProject() {
    if (!draft.name.trim() || !draft.code.trim()) {
      setMessage('请填写项目名称和项目编码。');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_project',
          project: {
            name: draft.name.trim(),
            code: draft.code.trim().toUpperCase(),
            description: draft.description.trim(),
            initialVersion: draft.initialVersion,
            deliveryMode: draft.deliveryMode,
            releaseDate: draft.releaseDate,
          },
          memberIds: draft.memberIds,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        detail?: string;
        project?: { id: string };
      } | null;
      if (!response.ok || !result?.project?.id) {
        throw new Error(
          result?.detail === 'project_already_exists'
            ? '项目编码已存在，请更换后重试。'
            : result?.detail === 'admin_required'
              ? '只有系统管理员可以创建项目。'
              : '项目创建失败。',
        );
      }
      const projectId = result.project.id;
      setCreateOpen(false);
      setDraft({
        name: '',
        code: '',
        description: '',
        initialVersion: 'v1.0',
        deliveryMode: 'agile',
        releaseDate: defaultReleaseDate,
        memberIds: [],
      });
      setMessage('项目已创建，正在进入新项目。');
      await onChanged(projectId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '项目创建失败。');
    } finally {
      setSaving(false);
    }
  }

  async function archiveProject() {
    if (!archiveTarget) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_project_status',
          projectId: archiveTarget.id,
          projectStatus: 'archived',
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        detail?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          result?.detail === 'default_project_required'
            ? '演示主项目不能归档。'
            : '项目归档失败。',
        );
      }
      setArchiveTarget(null);
      setMessage('项目已归档，历史数据仍可由管理员回溯。');
      const fallbackProject = activeProjects.find(
        (project) => project.id !== archiveTarget.id,
      );
      await onChanged(
        archiveTarget.id === currentProjectId ? fallbackProject?.id : undefined,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '项目归档失败。');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(project: ProjectSummary) {
    setEditTarget(project);
    setEditDraft({ name: project.name, description: project.description });
  }

  async function saveProjectDetails() {
    if (!editTarget || !editDraft.name.trim()) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_project_details',
          projectId: editTarget.id,
          project: {
            name: editDraft.name.trim(),
            description: editDraft.description.trim(),
          },
        }),
      });
      if (!response.ok) throw new Error('项目信息保存失败。');
      setEditTarget(null);
      setMessage('项目信息已更新。');
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '项目保存失败。');
    } finally {
      setSaving(false);
    }
  }

  async function restoreProject(project: ProjectSummary) {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_project_status',
          projectId: project.id,
          projectStatus: 'active',
        }),
      });
      if (!response.ok) throw new Error('项目恢复失败。');
      setMessage('项目已恢复，可重新进入并继续执行。');
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '项目恢复失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        eyebrow="PROJECTS · MEMBERS · DELIVERY MODE"
        title="项目中心"
        action={
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={currentRole !== 'admin'}
          >
            <Plus /> 新建项目
          </Button>
        }
      />
      <p className="-mt-3 text-sm text-muted-foreground">
        统一创建、切换和归档项目，并在建项时确定团队、交付模式与首个版本。
      </p>

      {message && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {message}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <FolderKanban className="size-8 text-primary" />
            <div>
              <p className="text-2xl font-semibold">{activeProjects.length}</p>
              <p className="text-xs text-muted-foreground">进行中的项目</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Boxes className="size-8 text-blue-600" />
            <div>
              <p className="text-2xl font-semibold">
                {projects.reduce(
                  (total, project) => total + Number(project.version_count),
                  0,
                )}
              </p>
              <p className="text-xs text-muted-foreground">已配置版本</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Archive className="size-8 text-slate-500" />
            <div>
              <p className="text-2xl font-semibold">
                {archivedProjects.length}
              </p>
              <p className="text-xs text-muted-foreground">历史归档项目</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>进行中的项目</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {activeProjects.map((project) => (
            <article
              key={project.id}
              className={`rounded-xl border p-4 transition ${project.id === currentProjectId ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'hover:border-primary/40'}`}
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 font-semibold text-blue-700">
                  {project.code.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{project.name}</h3>
                    <Badge variant="outline">{project.code}</Badge>
                    {project.id === currentProjectId && (
                      <Badge className="bg-emerald-100 text-emerald-700">
                        当前项目
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {project.description || '暂无项目说明'}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="size-3.5" /> {project.member_count} 人
                </span>
                <span className="flex items-center gap-1">
                  <Boxes className="size-3.5" /> {project.version_count} 个版本
                </span>
                <span className="truncate">负责人：{project.owner_name}</span>
              </div>
              <div className="mt-4 flex justify-end gap-2 border-t pt-3">
                {(currentRole === 'admin' ||
                  (currentRole === 'project_manager' &&
                    project.id === currentProjectId)) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(project)}
                  >
                    <Pencil /> 编辑
                  </Button>
                )}
                {currentRole === 'admin' &&
                  project.id !== 'nebula-customer-platform' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setArchiveTarget(project)}
                    >
                      <Archive /> 归档
                    </Button>
                  )}
                <Button
                  size="sm"
                  variant={
                    project.id === currentProjectId ? 'secondary' : 'default'
                  }
                  disabled={project.id === currentProjectId}
                  onClick={() => void onSwitch(project.id)}
                >
                  {project.id === currentProjectId ? (
                    <CheckCircle2 />
                  ) : (
                    <FolderKanban />
                  )}
                  {project.id === currentProjectId ? '已进入' : '进入项目'}
                </Button>
              </div>
            </article>
          ))}
        </CardContent>
      </Card>

      {archivedProjects.length > 0 && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            历史归档项目（{archivedProjects.length}）
          </summary>
          <div className="mt-3 space-y-2">
            {archivedProjects.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm"
              >
                <span>
                  {project.name} · {project.code}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {project.member_count} 人 · {project.version_count} 个版本
                  </span>
                  {currentRole === 'admin' && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void restoreProject(project)}
                    >
                      恢复项目
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑项目信息</DialogTitle>
            <DialogDescription>
              项目编码保持不变，名称和项目说明会同步到所有业务页面。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-project-name">项目名称</Label>
              <Input
                id="edit-project-name"
                value={editDraft.name}
                onChange={(event) =>
                  setEditDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-project-description">项目说明</Label>
              <Textarea
                id="edit-project-description"
                value={editDraft.description}
                onChange={(event) =>
                  setEditDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              取消
            </Button>
            <Button
              disabled={saving || !editDraft.name.trim()}
              onClick={() => void saveProjectDetails()}
            >
              {saving ? '保存中…' : '保存修改'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              创建后会自动建立项目空间、成员关系和首个版本草案。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-name">项目名称</Label>
              <Input
                id="project-name"
                value={draft.name}
                placeholder="例如：智能客服升级"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-code">项目编码</Label>
              <Input
                id="project-code"
                value={draft.code}
                placeholder="例如：AICS"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    code: event.target.value.toUpperCase(),
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="project-description">项目说明</Label>
              <Textarea
                id="project-description"
                value={draft.description}
                placeholder="项目目标、范围和预期结果"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-version">首个版本</Label>
              <NativeSelect
                id="project-version"
                value={draft.initialVersion}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    initialVersion: event.target.value,
                  }))
                }
              >
                <NativeSelectOption value="v0.9">v0.9 Alpha</NativeSelectOption>
                <NativeSelectOption value="v1.0">v1.0 Beta</NativeSelectOption>
                <NativeSelectOption value="v1.1">
                  v1.1 Growth
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-mode">交付模式</Label>
              <NativeSelect
                id="project-mode"
                value={draft.deliveryMode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    deliveryMode: event.target.value,
                  }))
                }
              >
                <NativeSelectOption value="agile">敏捷迭代</NativeSelectOption>
                <NativeSelectOption value="waterfall">
                  瀑布交付
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-release-date">目标发布日期</Label>
              <Input
                id="project-release-date"
                type="date"
                value={draft.releaseDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    releaseDate: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>选择首批成员</Label>
              <div className="grid max-h-44 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
                {selectableMembers.map((member) => (
                  <label
                    key={member.id}
                    htmlFor={`project-member-${member.id}`}
                    className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted"
                  >
                    <Checkbox
                      id={`project-member-${member.id}`}
                      checked={draft.memberIds.includes(member.id)}
                      onCheckedChange={() => toggleMember(member.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {member.display_name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {roleLabel[member.role]} · {member.email}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-900">
            <CalendarDays className="mr-1 inline size-4" />
            建项后将生成首个版本草案。具体评审、联调、提测和发版节点可在“计划与里程碑”中继续完善。
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void createNewProject()} disabled={saving}>
              {saving ? '正在创建…' : '创建并进入项目'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>归档项目</DialogTitle>
            <DialogDescription>
              {archiveTarget?.name}{' '}
              将从进行中项目移入历史归档，任务、版本和审计记录不会删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void archiveProject()}
              disabled={saving}
            >
              确认归档
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
