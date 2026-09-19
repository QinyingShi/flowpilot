'use client';

import { useState } from 'react';
import { Bell, Bot, CheckCircle2, MessageSquare } from 'lucide-react';

import { SectionTitle } from '@/components/section-title';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TaskRecord } from '@/lib/task-model';

export default function MyWorkView({
  onNotificationPreferences,
  tasksData,
  projectName,
  currentUserName,
}: {
  onNotificationPreferences: () => void;
  tasksData: TaskRecord[];
  projectName: string;
  currentUserName: string;
}) {
  const [done, setDone] = useState<string[]>([]);
  const [saving, setSaving] = useState('');
  const [saveError, setSaveError] = useState('');
  const personalTasks = tasksData
    .filter(
      (task) =>
        task[5] !== '已完成' &&
        task[4]
          .split('、')
          .map((owner) => owner.trim())
          .includes(currentUserName),
    )
    .slice(0, 8)
    .map((task) => ({
      id: task[0],
      title: task[1],
      project: projectName,
      due: task[8],
      state: task[5],
      source: 'WBS 任务',
    }));
  const blockedCount = personalTasks.filter(
    (task) => task.state === '有阻塞',
  ).length;
  return (
    <>
      <SectionTitle
        eyebrow="Focus · Decide · Deliver"
        title="我的工作"
        action={
          <Button variant="outline" onClick={onNotificationPreferences}>
            <Bell />
            通知偏好
          </Button>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        {[
          ['我的未完成', String(personalTasks.length), 'text-blue-600'],
          [
            '进行中',
            String(
              personalTasks.filter((task) => task.state === '进行中').length,
            ),
            'text-violet-600',
          ],
          [
            '尚未开始',
            String(
              personalTasks.filter((task) => task.state === '未开始').length,
            ),
            'text-amber-600',
          ],
          ['有阻塞', String(blockedCount), 'text-rose-600'],
        ].map(([label, value, tone]) => (
          <Card key={label} size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>优先事项</CardTitle>
            <p className="text-xs text-muted-foreground">
              AI 根据到期时间、关键路径、风险等级和依赖关系排序
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {personalTasks.map((task, index) => {
              const completed = done.includes(task.id);
              return (
                <div
                  key={task.id}
                  className={`flex gap-3 rounded-xl border p-4 transition ${completed ? 'opacity-50' : ''}`}
                >
                  <button
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}
                    disabled={saving === task.id}
                    onClick={async () => {
                      const nextCompleted = !completed;
                      setSaving(task.id);
                      setSaveError('');
                      try {
                        const response = await fetch('/api/workspace', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: nextCompleted
                              ? 'complete_personal_work_item'
                              : 'reopen_personal_work_item',
                            entityType: 'personal_work_item',
                            entityId: task.id,
                            detail: `${task.title} status=${nextCompleted ? '已完成' : '待处理'}`,
                          }),
                        });
                        if (!response.ok) throw new Error('待办状态保存失败');
                        setDone((current) =>
                          nextCompleted
                            ? [
                                ...current.filter((id) => id !== task.id),
                                task.id,
                              ]
                            : current.filter((id) => id !== task.id),
                        );
                      } catch (error) {
                        setSaveError(
                          error instanceof Error
                            ? error.message
                            : '待办状态保存失败',
                        );
                      } finally {
                        setSaving('');
                      }
                    }}
                    aria-label={`完成 ${task.title}`}
                  >
                    {completed && <CheckCircle2 className="size-3.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">P{index + 1}</Badge>
                      <p
                        className={`text-sm font-semibold ${completed ? 'line-through' : ''}`}
                      >
                        {task.title}
                      </p>
                      <StatusBadge value={task.state} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {task.id} · {task.project} · 来源：{task.source}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-medium ${task.state === '有阻塞' ? 'text-rose-600' : 'text-muted-foreground'}`}
                  >
                    {task.due}
                  </span>
                </div>
              );
            })}
            {personalTasks.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                当前项目没有分配给 {currentUserName} 的未完成任务。
              </div>
            )}
          </CardContent>
          {saveError && (
            <p className="px-6 pb-4 text-xs text-rose-600">{saveError}</p>
          )}
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4 text-primary" />
                今日建议
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs leading-5">
              <p className="rounded-lg bg-blue-50 p-3 text-blue-800">
                先处理支付网关方案。它位于关键路径，今天完成决策可使 Beta
                按期概率从 63% 提升至 76%。
              </p>
              <p className="rounded-lg border p-3 text-muted-foreground">
                15:00 后你与陈默、赵一都有 45 分钟空闲，可直接发起风险决策会。
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="border-b">
              <CardTitle>我的消息摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                ['飞书', '陈默更新了 TASK-156 的阻塞原因', '10:18'],
                ['Git', 'PR #291 请求你的评审', '09:42'],
                ['Jira', '支付模块新增 1 个 P1 缺陷', '09:16'],
              ].map(([source, message, time]) => (
                <div key={message} className="flex gap-3 text-xs">
                  <MessageSquare className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-medium">{message}</p>
                    <p className="mt-1 text-muted-foreground">
                      {source} · {time}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
