'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileAudio,
  History,
  Mic,
  Plus,
  Save,
  Search,
  Sparkles,
  Square,
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
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type MeetingMinutes = {
  mode: '线上' | '线下';
  notes: string;
  transcript: string;
  decisions: string;
  actionItems: string;
  recordingName?: string;
  recordedAt?: string;
  followUps?: DecisionFollowUp[];
};

type DecisionStatus = '待执行' | '执行中' | '待验收' | '已闭环';

type DecisionFollowUp = {
  id: string;
  title: string;
  owner: string;
  dueDate: string;
  linkedType: 'WBS任务' | '风险' | '需求变更';
  linkedId: string;
  status: DecisionStatus;
  evidence: string;
  history: Array<{ status: string; at: string; note: string }>;
};

type MeetingRecord = {
  id: string;
  title: string;
  date: string;
  time: string;
  attendees: string;
  agenda: string;
  status: string;
  minutes?: MeetingMinutes;
};

const emptyMinutes: MeetingMinutes = {
  mode: '线下',
  notes: '',
  transcript: '',
  decisions: '',
  actionItems: '',
};

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    detail?: string;
    message?: string;
  } | null;
  return new Error(body?.message ?? body?.detail ?? fallback);
}

export default function MeetingsView({
  meetingsData,
  onMeeting,
  onMeetingUpdated,
}: {
  meetingsData: MeetingRecord[];
  onMeeting: () => void;
  onMeetingUpdated: (meeting: MeetingRecord) => void;
}) {
  const [activeMeeting, setActiveMeeting] = useState<MeetingRecord | null>(
    null,
  );
  const [draft, setDraft] = useState<MeetingMinutes>(emptyMinutes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [meetingQuery, setMeetingQuery] = useState('');
  const [meetingFilter, setMeetingFilter] = useState<
    '全部会议' | '会议中' | '未开始' | '已归档'
  >('全部会议');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeFollowUp, setActiveFollowUp] = useState<{
    meetingId: string;
    item: DecisionFollowUp;
  } | null>(null);
  const [followUpEvidence, setFollowUpEvidence] = useState('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [recordingState, setRecordingState] = useState<
    'idle' | 'recording' | 'ready'
  >('idle');
  const [recordingUrl, setRecordingUrl] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingUrlRef = useRef('');

  const archivedCount = meetingsData.filter((meeting) =>
    Boolean(meeting.minutes),
  ).length;
  const filteredMeetings = [...meetingsData].filter((meeting) => {
    const category = meeting.minutes
      ? '已归档'
      : meeting.status === '会议中'
        ? '会议中'
        : '未开始';
    const query = meetingQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      [meeting.title, meeting.agenda, meeting.attendees, meeting.date].some(
        (value) => value.toLowerCase().includes(query),
      );
    return (
      matchesQuery &&
      (meetingFilter === '全部会议' || meetingFilter === category)
    );
  });
  const currentMeetings = filteredMeetings
    .filter((meeting) => !meeting.minutes)
    .sort((left, right) => {
      if (left.status === '会议中') return -1;
      if (right.status === '会议中') return 1;
      return `${left.date}T${left.time}`.localeCompare(
        `${right.date}T${right.time}`,
      );
    });
  const archivedMeetings = filteredMeetings
    .filter((meeting) => Boolean(meeting.minutes))
    .sort((left, right) =>
      `${right.date}T${right.time}`.localeCompare(`${left.date}T${left.time}`),
    );
  const showHistory =
    historyOpen || meetingFilter === '已归档' || Boolean(meetingQuery.trim());
  const allFollowUps = meetingsData.flatMap((meeting) =>
    (meeting.minutes?.followUps ?? []).map((item) => ({ meeting, item })),
  );
  const pendingFollowUps = allFollowUps.filter(
    ({ item }) => item.status !== '已闭环',
  );

  useEffect(
    () => () => {
      if (recorderRef.current?.state === 'recording')
        recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    },
    [],
  );

  function clearRecordingPreview() {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = '';
    }
    setRecordingUrl('');
  }

  function closeMinutes() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.onstop = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
      };
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    streamRef.current = null;
    clearRecordingPreview();
    setRecordingState('idle');
    setActiveMeeting(null);
  }

  function openMinutes(meeting: MeetingRecord) {
    clearRecordingPreview();
    setActiveMeeting(meeting);
    setDraft(meeting.minutes ?? emptyMinutes);
    setError('');
    setRecordingState('idle');
  }

  async function startRecording() {
    setError('');
    clearRecordingPreview();
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('当前浏览器不支持麦克风录音，请使用最新版浏览器。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (recordingUrlRef.current)
          URL.revokeObjectURL(recordingUrlRef.current);
        const url = URL.createObjectURL(blob);
        recordingUrlRef.current = url;
        setRecordingUrl(url);
        setRecordingState('ready');
        setDraft((current) => ({
          ...current,
          recordingName: `${activeMeeting?.id ?? 'meeting'}-recording.webm`,
          recordedAt: new Date().toISOString(),
        }));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
      };
      recorder.start(1000);
      setRecordingState('recording');
    } catch {
      setError('无法使用麦克风，请检查浏览器录音权限。');
    }
  }

  function generateDraft() {
    if (!activeMeeting) return;
    setDraft((current) => ({
      ...current,
      notes: current.notes || `围绕“${activeMeeting.agenda}”完成讨论。`,
      transcript:
        current.transcript || '等待接入语音识别服务后生成带时间戳的发言转写。',
      decisions: current.decisions || '待确认会议决策，并指定最终确认人。',
      actionItems:
        current.actionItems ||
        `${activeMeeting.attendees.split('、')[0] ?? '负责人'}｜整理会议结论｜次日 12:00`,
    }));
  }

  async function saveMinutes() {
    if (!activeMeeting) return;
    const updatedMeeting = {
      ...activeMeeting,
      status: '纪要已归档',
      minutes: draft,
    };
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_meeting_minutes',
          meeting: updatedMeeting,
        }),
      });
      if (!response.ok) throw await responseError(response, '会议纪要保存失败');
      onMeetingUpdated(updatedMeeting);
      setActiveMeeting(updatedMeeting);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '会议纪要保存失败');
    } finally {
      setSaving(false);
    }
  }

  function openFollowUp(meetingId: string, item: DecisionFollowUp) {
    setActiveFollowUp({ meetingId, item });
    setFollowUpEvidence(item.evidence);
    setError('');
  }

  async function updateFollowUp(nextStatus: DecisionStatus, note: string) {
    if (!activeFollowUp) return;
    if (
      (nextStatus === '待验收' || nextStatus === '已闭环') &&
      !followUpEvidence.trim()
    ) {
      setError('提交验收或关闭前，需要填写执行结果与证据。');
      return;
    }
    const sourceMeeting = meetingsData.find(
      (meeting) => meeting.id === activeFollowUp.meetingId,
    );
    if (!sourceMeeting?.minutes) return;
    const timestamp = new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }).format(new Date());
    const updatedItem: DecisionFollowUp = {
      ...activeFollowUp.item,
      status: nextStatus,
      evidence: followUpEvidence.trim(),
      history: [
        ...activeFollowUp.item.history,
        { status: nextStatus, at: timestamp, note },
      ],
    };
    const updatedMeeting: MeetingRecord = {
      ...sourceMeeting,
      minutes: {
        ...sourceMeeting.minutes,
        followUps: (sourceMeeting.minutes.followUps ?? []).map((item) =>
          item.id === updatedItem.id ? updatedItem : item,
        ),
      },
    };
    setSavingFollowUp(true);
    setError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_meeting_minutes',
          meeting: updatedMeeting,
        }),
      });
      if (!response.ok) {
        throw await responseError(response, '决策跟进状态保存失败');
      }
      onMeetingUpdated(updatedMeeting);
      setActiveFollowUp({ meetingId: sourceMeeting.id, item: updatedItem });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '决策跟进状态保存失败',
      );
    } finally {
      setSavingFollowUp(false);
    }
  }

  function meetingStage(meeting: MeetingRecord) {
    return meeting.status === '会议中' ? '进行中' : '未开始';
  }

  function renderMeetingRow(meeting: MeetingRecord) {
    const [, month, day] = meeting.date.split('-');
    return (
      <div
        key={meeting.id}
        className="flex flex-wrap items-center gap-4 rounded-xl border p-4"
      >
        <div
          className={`flex size-11 flex-col items-center justify-center rounded-lg ${meeting.status === '会议中' ? 'bg-primary text-white' : 'bg-muted'}`}
        >
          <span className="text-[10px]">{Number(month)}月</span>
          <strong>{Number(day)}</strong>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{meeting.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {meeting.time} · {meeting.attendees}
          </p>
          {meeting.minutes?.decisions && (
            <p className="mt-2 line-clamp-1 text-xs text-emerald-700">
              决策：{meeting.minutes.decisions}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {meeting.minutes ? '已归档' : meetingStage(meeting)}
          </Badge>
          <Badge
            className={
              meeting.minutes
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }
          >
            {meeting.minutes ? '纪要完整' : '待形成纪要'}
          </Badge>
          {meeting.minutes?.recordingName && (
            <Badge className="bg-blue-100 text-blue-700">含录音</Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => openMinutes(meeting)}
        >
          {meeting.status === '会议中'
            ? '进入会中记录'
            : meeting.minutes
              ? '查看当期纪要'
              : '会前准备'}
        </Button>
      </div>
    );
  }

  return (
    <>
      <SectionTitle
        eyebrow="Calendar · Minutes · Follow-up"
        title="会议与团队协同"
        action={
          <Button onClick={onMeeting}>
            <Plus />
            预约会议
          </Button>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <CalendarDays className="size-5 text-primary" />
            <div>
              <p className="text-2xl font-bold">{meetingsData.length}</p>
              <p className="text-xs text-muted-foreground">累计会议</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <History className="size-5 text-emerald-600" />
            <div>
              <p className="text-2xl font-bold">{archivedCount}</p>
              <p className="text-xs text-muted-foreground">已归档纪要</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="size-5 text-amber-500" />
            <div>
              <p className="text-2xl font-bold">
                {meetingsData.length - archivedCount}
              </p>
              <p className="text-xs text-muted-foreground">待形成纪要</p>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <CardTitle>会议安排与纪要</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  当前会议与历史归档分区展示
                </p>
              </div>
              <div className="relative ml-auto min-w-48 flex-1 sm:max-w-64">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="搜索会议、议题或参会人"
                  value={meetingQuery}
                  onChange={(event) => setMeetingQuery(event.target.value)}
                />
              </div>
              <NativeSelect
                value={meetingFilter}
                onChange={(event) =>
                  setMeetingFilter(event.target.value as typeof meetingFilter)
                }
                aria-label="会议档案状态"
              >
                <NativeSelectOption value="全部会议">
                  全部会议
                </NativeSelectOption>
                <NativeSelectOption value="会议中">会议中</NativeSelectOption>
                <NativeSelectOption value="未开始">未开始</NativeSelectOption>
                <NativeSelectOption value="已归档">已归档</NativeSelectOption>
              </NativeSelect>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {meetingFilter !== '已归档' && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <span className="size-2 rounded-full bg-blue-500" />
                  <h3 className="text-sm font-semibold">未开始与进行中</h3>
                  <Badge variant="outline">{currentMeetings.length}</Badge>
                </div>
                <div className="space-y-3">
                  {currentMeetings.map(renderMeetingRow)}
                  {!currentMeetings.length && (
                    <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                      当前筛选条件下没有未开始或进行中的会议
                    </div>
                  )}
                </div>
              </section>
            )}

            {meetingFilter !== '会议中' && meetingFilter !== '未开始' && (
              <section className="border-t pt-4">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left hover:bg-muted/50"
                  onClick={() => setHistoryOpen((current) => !current)}
                  aria-expanded={showHistory}
                >
                  {showHistory ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                  <History className="size-4 text-emerald-600" />
                  <span className="text-sm font-semibold">历史归档会议</span>
                  <Badge variant="outline">{archivedMeetings.length}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {meetingFilter === '已归档' || meetingQuery.trim()
                      ? '已按筛选展开'
                      : showHistory
                        ? '收起历史记录'
                        : '点击展开查看'}
                  </span>
                </button>
                {showHistory && (
                  <div className="mt-3 space-y-3">
                    {archivedMeetings.map(renderMeetingRow)}
                    {!archivedMeetings.length && (
                      <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                        没有匹配的历史归档会议
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>AI 会议助手</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <p className="rounded-lg bg-blue-50 p-3 leading-5 text-blue-800">
                会中记录原始纪要和录音，会后整理摘要、决策与行动项，并写回项目记录。
              </p>
              {[
                '线下会议可调用本机麦克风录音',
                '决策与行动项独立归档',
                '行动项可继续转为 WBS 任务',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                待跟进决策
                <Badge className="ml-auto bg-amber-100 text-amber-700">
                  {pendingFollowUps.length} 项
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pendingFollowUps.map(({ meeting, item }) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => openFollowUp(meeting.id, item)}
                  className="block w-full rounded-lg border p-3 text-left text-xs transition hover:border-blue-300 hover:bg-blue-50/50"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span className="font-medium">{item.title}</span>
                    <Badge variant="outline" className="ml-auto shrink-0">
                      {item.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    {item.owner} · 截止 {item.dueDate.slice(5)} ·{' '}
                    {item.linkedType} {item.linkedId}
                  </p>
                </button>
              ))}
              {!pendingFollowUps.length && (
                <div className="rounded-lg bg-emerald-50 p-4 text-xs text-emerald-700">
                  当前会议决策均已闭环。
                </div>
              )}
              <p className="pt-2 text-[11px] leading-5 text-muted-foreground">
                决策确认 → 执行跟踪 → 提交验收 → 关闭归档
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={Boolean(activeMeeting)}
        onOpenChange={(open) => !open && closeMinutes()}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{activeMeeting?.title} · 会议纪要</DialogTitle>
            <DialogDescription>
              会中持续记录；线下模式可直接启用本机麦克风录音。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl bg-muted/50 p-4 text-sm">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {activeMeeting?.date} {activeMeeting?.time}
                </span>
                <span>参会人：{activeMeeting?.attendees}</span>
              </div>
              <p className="mt-2 font-medium">议题：{activeMeeting?.agenda}</p>
            </div>
            <NativeSelect
              value={draft.mode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  mode: event.target.value as MeetingMinutes['mode'],
                })
              }
              aria-label="会议形式"
            >
              <NativeSelectOption value="线上">线上会议</NativeSelectOption>
              <NativeSelectOption value="线下">线下会议</NativeSelectOption>
            </NativeSelect>
            {draft.mode === '线下' && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <FileAudio className="size-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">线下会议录音</p>
                    <p className="text-xs text-muted-foreground">
                      当前录音可播放和下载；永久归档需接入对象存储。
                    </p>
                  </div>
                  {recordingState === 'recording' ? (
                    <Button
                      className="ml-auto"
                      variant="destructive"
                      onClick={() => recorderRef.current?.stop()}
                    >
                      <Square />
                      停止录音
                    </Button>
                  ) : (
                    <Button className="ml-auto" onClick={startRecording}>
                      <Mic />
                      {recordingState === 'ready' ? '重新录音' : '开始录音'}
                    </Button>
                  )}
                </div>
                {recordingState === 'recording' && (
                  <p className="mt-3 animate-pulse text-xs font-medium text-rose-600">
                    ● 正在录音，请勿关闭页面
                  </p>
                )}
                {recordingUrl && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <audio
                      controls
                      src={recordingUrl}
                      className="h-9 max-w-full"
                    >
                      <track kind="captions" />
                    </audio>
                    <a
                      href={recordingUrl}
                      download={draft.recordingName ?? 'meeting-recording.webm'}
                      className="inline-flex h-8 items-center gap-2 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted"
                    >
                      <Download className="size-4" />
                      下载录音
                    </a>
                  </div>
                )}
                {!recordingUrl && draft.recordingName && (
                  <div className="mt-3 rounded-lg border border-blue-200 bg-white/70 p-3 text-xs text-blue-800">
                    历史录音记录：{draft.recordingName}
                    {draft.recordedAt
                      ? ` · ${draft.recordedAt.replace('T', ' ').slice(0, 16)}`
                      : ''}
                    <p className="mt-1 text-blue-700/75">
                      已保留录音元数据；接入对象存储后可在此回放历史音频。
                    </p>
                  </div>
                )}
              </div>
            )}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <strong className="text-sm">实时会议记录</strong>
                <Button size="sm" variant="outline" onClick={generateDraft}>
                  <Sparkles />
                  AI 整理草稿
                </Button>
              </div>
              <Textarea
                className="min-h-28"
                placeholder="记录讨论过程、观点和上下文"
                value={draft.notes}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">录音转写</p>
              <Textarea
                className="min-h-24"
                placeholder="接入语音识别服务后自动生成，也可人工补充"
                value={draft.transcript}
                onChange={(event) =>
                  setDraft({ ...draft, transcript: event.target.value })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold">会议决策</p>
                <Textarea
                  className="min-h-24"
                  placeholder="决策、确认人和生效范围"
                  value={draft.decisions}
                  onChange={(event) =>
                    setDraft({ ...draft, decisions: event.target.value })
                  }
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold">行动项</p>
                <Textarea
                  className="min-h-24"
                  placeholder="负责人｜行动项｜截止时间"
                  value={draft.actionItems}
                  onChange={(event) =>
                    setDraft({ ...draft, actionItems: event.target.value })
                  }
                />
              </div>
            </div>
            {draft.followUps?.length ? (
              <div className="rounded-xl border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  <p className="text-sm font-semibold">决策闭环记录</p>
                  <Badge variant="outline">{draft.followUps.length} 项</Badge>
                </div>
                <div className="space-y-2">
                  {draft.followUps.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className="flex w-full items-center gap-2 rounded-lg bg-muted/50 p-3 text-left text-xs hover:bg-muted"
                      onClick={() => {
                        const meetingId = activeMeeting?.id;
                        closeMinutes();
                        if (meetingId) openFollowUp(meetingId, item);
                      }}
                    >
                      <span className="min-w-0 flex-1 font-medium">
                        {item.title}
                      </span>
                      <span className="text-muted-foreground">
                        {item.owner}
                      </span>
                      <Badge
                        className={
                          item.status === '已闭环'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }
                      >
                        {item.status}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {error && <p className="text-sm text-rose-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeMinutes}>
              关闭
            </Button>
            <Button
              disabled={saving || recordingState === 'recording'}
              onClick={saveMinutes}
            >
              <Save />
              {saving ? '正在归档…' : '保存并归档纪要'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(activeFollowUp)}
        onOpenChange={(open) => !open && setActiveFollowUp(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>会议决策闭环</DialogTitle>
            <DialogDescription>
              来源：
              {meetingsData.find(
                (meeting) => meeting.id === activeFollowUp?.meetingId,
              )?.title ?? '会议纪要'}
            </DialogDescription>
          </DialogHeader>
          {activeFollowUp && (
            <div className="space-y-4">
              <div className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <p className="min-w-0 flex-1 font-semibold">
                    {activeFollowUp.item.title}
                  </p>
                  <Badge>{activeFollowUp.item.status}</Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <span>负责人：{activeFollowUp.item.owner}</span>
                  <span>截止：{activeFollowUp.item.dueDate}</span>
                  <span>
                    关联：{activeFollowUp.item.linkedType}{' '}
                    {activeFollowUp.item.linkedId}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {(['待执行', '执行中', '待验收', '已闭环'] as const).map(
                  (status, index, statuses) => {
                    const currentIndex = statuses.indexOf(
                      activeFollowUp.item.status,
                    );
                    return (
                      <div key={status} className="text-center">
                        <div
                          className={`mx-auto mb-2 flex size-7 items-center justify-center rounded-full text-xs font-bold ${index <= currentIndex ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}
                        >
                          {index + 1}
                        </div>
                        <p className="text-xs font-medium">{status}</p>
                      </div>
                    );
                  },
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">执行结果与验收证据</p>
                <Textarea
                  className="min-h-24"
                  placeholder="填写完成结果、验证方式、相关链接或异常说明"
                  value={followUpEvidence}
                  disabled={activeFollowUp.item.status === '已闭环'}
                  onChange={(event) => setFollowUpEvidence(event.target.value)}
                />
              </div>

              <details className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium">
                  查看状态轨迹（{activeFollowUp.item.history.length} 条）
                </summary>
                <div className="mt-3 space-y-2">
                  {[...activeFollowUp.item.history]
                    .reverse()
                    .map((entry, index) => (
                      <div
                        key={`${entry.at}-${entry.status}-${index}`}
                        className="border-l-2 border-primary/30 pl-3"
                      >
                        <p className="font-medium">
                          {entry.status} · {entry.at}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          {entry.note}
                        </p>
                      </div>
                    ))}
                </div>
              </details>
              {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>
          )}
          <DialogFooter className="flex-wrap">
            <Button variant="outline" onClick={() => setActiveFollowUp(null)}>
              关闭
            </Button>
            {activeFollowUp?.item.status === '待执行' && (
              <Button
                disabled={savingFollowUp}
                onClick={() => updateFollowUp('执行中', '负责人开始执行')}
              >
                开始执行
              </Button>
            )}
            {activeFollowUp?.item.status === '执行中' && (
              <Button
                disabled={savingFollowUp}
                onClick={() =>
                  updateFollowUp('待验收', '提交执行结果，等待验收')
                }
              >
                提交验收
              </Button>
            )}
            {activeFollowUp?.item.status === '待验收' && (
              <>
                <Button
                  variant="outline"
                  disabled={savingFollowUp}
                  onClick={() =>
                    updateFollowUp('执行中', '验收未通过，退回整改')
                  }
                >
                  退回整改
                </Button>
                <Button
                  disabled={savingFollowUp}
                  onClick={() =>
                    updateFollowUp('已闭环', '验收通过，决策行动项关闭')
                  }
                >
                  <CheckCircle2 /> 验收通过并关闭
                </Button>
              </>
            )}
            {activeFollowUp?.item.status === '已闭环' && (
              <Badge className="bg-emerald-100 text-emerald-700">
                已完成闭环归档
              </Badge>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
