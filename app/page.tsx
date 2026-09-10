'use client';

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity, AlertTriangle, Bell, Bot, CalendarDays, CheckCircle2, ChevronDown,
  CircleDollarSign, ClipboardCheck, Clock3, FileChartColumn, GitBranch, KanbanSquare,
  LayoutDashboard, ListTree, Menu, Plus, RefreshCw, Search, Settings, ShieldAlert,
  Sparkles, Users, WalletCards, WandSparkles, XCircle,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';

type View = '驾驶舱' | 'WBS与任务' | '计划与里程碑' | '资源与预算' | '风险与变更' | '版本与报告' | '会议协同';

const nav: { label: View; icon: LucideIcon }[] = [
  { label: '驾驶舱', icon: LayoutDashboard }, { label: 'WBS与任务', icon: ListTree },
  { label: '计划与里程碑', icon: CalendarDays }, { label: '资源与预算', icon: WalletCards },
  { label: '风险与变更', icon: ShieldAlert }, { label: '版本与报告', icon: FileChartColumn },
  { label: '会议协同', icon: Users },
];

const trend = [
  { day: '09/01', plan: 50, actual: 49 }, { day: '09/03', plan: 56, actual: 55 },
  { day: '09/05', plan: 62, actual: 59 }, { day: '09/07', plan: 66, actual: 62 },
  { day: '09/09', plan: 70, actual: 66 }, { day: '今天', plan: 72, actual: 68 },
];
const workState = [
  { name: '已完成', value: 36, fill: '#10b981' }, { name: '进行中', value: 24, fill: '#2563eb' },
  { name: '有阻塞', value: 7, fill: '#f43f5e' }, { name: '未开始', value: 18, fill: '#cbd5e1' },
];
const milestones = [
  { name: '需求基线确认', date: '09月05日', owner: '林夏', state: '已完成', progress: 100 },
  { name: '核心流程联调', date: '09月18日', owner: '陈默', state: '有风险', progress: 64 },
  { name: 'Beta 版本发布', date: '09月27日', owner: '周琪', state: '正常', progress: 42 },
  { name: '生产验收上线', date: '10月15日', owner: '杨帆', state: '正常', progress: 18 },
];
const tasks = [
  ['1.1', '用户旅程与需求基线', '星云客户平台', '林夏', '已完成', '高', '09/01', '09/05', '100%', '40h', '—', '低'],
  ['1.2', '会员中心交互设计', '星云客户平台', '苏禾', '进行中', '高', '09/04', '09/12', '78%', '56h', '1.1', '低'],
  ['2.1', '订单服务 API 改造', '星云客户平台', '陈默', '有阻塞', '高', '09/06', '09/16', '62%', '88h', '1.1', '高'],
  ['2.2', '支付网关联调', '星云客户平台', '赵一', '有阻塞', '高', '09/10', '09/18', '35%', '64h', '2.1', '高'],
  ['3.1', '数据看板指标模型', '增长数据中台', '许清', '进行中', '中', '09/08', '09/20', '48%', '72h', '1.1', '中'],
  ['3.2', '回归测试与验收', '增长数据中台', '周琪', '未开始', '中', '09/19', '09/26', '0%', '80h', '2.2', '中'],
];
const resources = [
  { name: '陈默', role: '后端开发', project: '星云客户平台', load: 118, available: 0, cost: 9.6 },
  { name: '林夏', role: '产品经理', project: '2 个项目', load: 92, available: 12, cost: 8.2 },
  { name: '苏禾', role: '体验设计', project: '星云客户平台', load: 76, available: 38, cost: 7.4 },
  { name: '赵一', role: '测试工程师', project: '3 个项目', load: 112, available: 0, cost: 6.8 },
  { name: '许清', role: '数据开发', project: '增长数据中台', load: 84, available: 26, cost: 8.9 },
];
const budgetBars = [
  { name: '人力', plan: 76, actual: 52 }, { name: '采购', plan: 22, actual: 15 },
  { name: '云资源', plan: 14, actual: 7.8 }, { name: '其他', plan: 8, actual: 2 },
];
const risks = [
  { id: 'R-023', level: '高', title: '支付网关接口交付延迟', owner: '陈默', impact: '核心联调里程碑可能延迟 3 天', trigger: '9月13日仍未完成沙箱验证', status: '处理中', plan: '切换备用聚合支付通道；并行准备接口适配层' },
  { id: 'R-019', level: '高', title: '测试资源连续两周过载', owner: '赵一', impact: 'Beta 回归缺口约 24 人时', trigger: '测试负载连续 3 日 > 105%', status: '待决策', plan: '从数据中台借调 0.5 人周；下调非核心兼容性范围' },
  { id: 'R-027', level: '中', title: '会员规则需求仍在变动', owner: '林夏', impact: '返工概率 42%，影响 4 个任务', trigger: '规则字段本周再次变化', status: '监控中', plan: '冻结 P0 规则，P1 规则进入 v1.1 版本池' },
];
const versions = [
  { name: 'v0.9 Alpha', scope: '核心会员与订单闭环', date: '09/13', progress: 92, state: '验收中' },
  { name: 'v1.0 Beta', scope: '支付、数据看板、运营配置', date: '09/27', progress: 42, state: '开发中' },
  { name: 'v1.1 Growth', scope: '营销规则与自动化触达', date: '10/18', progress: 8, state: '规划中' },
];

function StatusBadge({ value }: { value: string }) {
  const cls = value.includes('阻塞') || value === '高' ? 'bg-rose-100 text-rose-700' : value.includes('完成') || value === '正常' ? 'bg-emerald-100 text-emerald-700' : value.includes('进行') || value.includes('开发') ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700';
  return <Badge className={cls}>{value}</Badge>;
}

function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="mb-1 text-xs font-semibold uppercase tracking-[.12em] text-primary">{eyebrow}</p><h1 className="text-2xl font-bold tracking-tight">{title}</h1></div>{action}</div>;
}

export default function Home() {
  const [view, setView] = useState<View>('驾驶舱');
  const [mobileNav, setMobileNav] = useState(false);
  const [dialog, setDialog] = useState<'inspection' | 'change' | 'report' | 'meeting' | null>(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState('');

  function completeAction(message: string) {
    setRunning(true);
    setTimeout(() => { setRunning(false); setDialog(null); setToast(message); setTimeout(() => setToast(''), 3200); }, 900);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:px-7">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开导航" onClick={() => setMobileNav(!mobileNav)}><Menu /></Button>
          <button className="flex items-center gap-3" onClick={() => setView('驾驶舱')}><span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"><Sparkles className="size-5" /></span><span className="text-left"><span className="block text-[15px] font-semibold leading-tight">FlowPilot</span><span className="block text-[11px] text-muted-foreground">AI 项目指挥中心</span></span></button>
        </div>
        <div className="hidden w-[360px] items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground md:flex"><Search className="size-4" />搜索任务、里程碑或负责人… <span className="ml-auto rounded border bg-background px-1.5 text-xs">⌘K</span></div>
        <div className="flex items-center gap-2"><Badge className="hidden bg-emerald-100 text-emerald-700 hover:bg-emerald-100 sm:flex"><span className="size-1.5 rounded-full bg-emerald-500" />实时监控中</Badge><Button variant="ghost" size="icon" aria-label="通知"><Bell /></Button><div className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">YX</div></div>
      </header>

      {mobileNav && <button aria-label="关闭导航" className="fixed inset-0 z-20 bg-black/20 lg:hidden" onClick={() => setMobileNav(false)} />}
      <div className="flex">
        <aside className={`fixed bottom-0 left-0 top-16 z-20 w-[235px] border-r bg-sidebar p-3 transition-transform lg:sticky lg:h-[calc(100vh-4rem)] lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'} lg:flex lg:flex-col`}>
          <div className="mb-3 rounded-xl border bg-card p-3"><p className="text-[11px] text-muted-foreground">当前项目群</p><p className="mt-1 flex items-center justify-between text-sm font-semibold">数字化增长项目群 <ChevronDown className="size-4" /></p></div>
          <nav className="space-y-1">{nav.map(({ label, icon: Icon }) => <button key={label} onClick={() => { setView(label); setMobileNav(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${view === label ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="size-4" />{label}</button>)}</nav>
          <div className="mt-auto"><button className="mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"><Settings className="size-4" />工作台设置</button><button onClick={() => setDialog('inspection')} className="w-full rounded-xl border bg-card p-3 text-left transition hover:border-primary/40"><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><Bot className="size-4 text-primary" />AI 巡检助手 <span className="ml-auto size-2 rounded-full bg-emerald-500" /></div><p className="text-[11px] leading-5 text-muted-foreground">每 30 分钟巡检 · 发现 3 项需关注</p></button></div>
        </aside>

        <section className="min-w-0 flex-1 p-4 lg:p-7"><div className="mx-auto max-w-[1440px]">
          {view === '驾驶舱' && <Dashboard onAction={setDialog} />}
          {view === 'WBS与任务' && <WbsView />}
          {view === '计划与里程碑' && <PlanView />}
          {view === '资源与预算' && <ResourceView />}
          {view === '风险与变更' && <RiskView onChange={() => setDialog('change')} />}
          {view === '版本与报告' && <ReportsView onReport={() => setDialog('report')} />}
          {view === '会议协同' && <MeetingsView onMeeting={() => setDialog('meeting')} />}
        </div></section>
      </div>

      <Dialog open={dialog === 'inspection'} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Bot className="text-primary" />AI 项目巡检</DialogTitle><DialogDescription>将检查计划偏差、依赖阻塞、资源负载、预算异常和风险闭环状态。</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-3">{['85 个任务', '10 个里程碑', '9 名成员', '¥120 万预算'].map(x => <div key={x} className="rounded-lg border bg-muted/40 p-3 text-sm font-medium">{x}</div>)}</div><div className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">巡检规则：进度偏差 &gt; 3%、负载 &gt; 105%、高风险未更新 &gt; 24h、预算预测超支 &gt; 5%。</div><DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>取消</Button><Button onClick={() => completeAction('巡检完成：发现 2 项新增预警，已加入风险台账。')} disabled={running}><RefreshCw className={running ? 'animate-spin' : ''} />{running ? '巡检中…' : '立即巡检'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={dialog === 'change'} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>AI 需求变更影响分析</DialogTitle><DialogDescription>录入变更后，AI 将沿 WBS 依赖链评估工期、成本、资源和版本影响。</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><Input defaultValue="CR-018 会员等级动态权益" aria-label="变更标题" /><Input defaultValue="P1 · v1.0 候选" aria-label="优先级与版本" /></div><Textarea className="min-h-24" defaultValue="新增按会员等级动态配置支付优惠、积分倍率及展示规则，并支持运营后台即时生效。" aria-label="变更描述"/><div className="grid gap-3 sm:grid-cols-3"><Impact label="工期影响" value="+5 工作日" tone="rose" /><Impact label="预算影响" value="+¥4.8 万" tone="amber" /><Impact label="波及任务" value="4 项 / 3 人" tone="blue" /></div><div className="rounded-xl border border-primary/20 bg-blue-50/60 p-4"><p className="mb-2 text-sm font-semibold text-blue-900">AI 调整建议</p><ul className="space-y-1 text-xs leading-5 text-blue-800"><li>• 将动态权益拆入 v1.1，可保持 v1.0 Beta 日期不变。</li><li>• 若必须进入 v1.0，建议增加 1 名前端 3 天并并行测试。</li><li>• 冻结原会员规则接口，避免 2.1 与 3.2 两项任务返工。</li></ul></div><DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>保存草稿</Button><Button onClick={() => completeAction('影响分析已完成，调整方案已提交至变更评审。')} disabled={running}><WandSparkles />生成完整分析</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={dialog === 'report'} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>生成 AI 项目报告</DialogTitle><DialogDescription>自动汇总进展、偏差、里程碑、风险、预算和下阶段计划。</DialogDescription></DialogHeader><div className="grid grid-cols-3 gap-2">{['日报', '周报', '版本简报'].map((x, i) => <button key={x} className={`rounded-lg border p-3 text-sm font-medium ${i === 1 ? 'border-primary bg-blue-50 text-primary' : ''}`}>{x}</button>)}</div><Textarea className="min-h-24" defaultValue="收件人：项目组、业务负责人\n重点关注：Beta 里程碑、支付接口风险、测试资源缺口" /><DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>预览模板</Button><Button onClick={() => completeAction('周报已生成，可在报告中心查看并分享。')} disabled={running}><Sparkles />生成周报</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={dialog === 'meeting'} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>预约项目会议</DialogTitle><DialogDescription>AI 会结合参会人空闲时间推荐时段并准备议程。</DialogDescription></DialogHeader><Input defaultValue="v1.0 Beta 风险决策会" /><div className="grid grid-cols-2 gap-3"><Input type="date" defaultValue="2026-09-11" /><Input type="time" defaultValue="14:30" /></div><Input defaultValue="林夏、陈默、赵一、周琪" /><Textarea defaultValue="1. 支付接口备选方案决策\n2. 测试资源调配\n3. CR-018 是否进入 v1.0" /><DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>查找共同空闲</Button><Button onClick={() => completeAction('会议已预约，议程与会前材料已发送。')} disabled={running}><CalendarDays />创建会议</Button></DialogFooter></DialogContent></Dialog>

      {toast && <div role="status" className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-slate-900 p-4 text-sm text-white shadow-2xl"><CheckCircle2 className="size-5 shrink-0 text-emerald-400" />{toast}</div>}
    </main>
  );
}

function Dashboard({ onAction }: { onAction: (d: 'inspection' | 'change' | 'report' | 'meeting') => void }) {
  return <>
    <SectionTitle eyebrow="2026 · 数字化增长项目群" title="项目全景驾驶舱" action={<div className="flex gap-2"><Button variant="outline">星云客户平台 <ChevronDown /></Button><Button onClick={() => onAction('report')}><Sparkles />生成项目简报</Button></div>} />
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900"><Bot className="size-4 text-primary" /><strong>AI 项目脉搏：</strong>整体健康度 78 分；进度落后 4%，预算可控。建议今天确认支付网关备选方案，并调配 24 小时测试资源。<Button size="xs" variant="outline" className="ml-auto bg-white" onClick={() => onAction('inspection')}>立即巡检</Button></div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ['整体进度','68%','计划 72% · 落后 4%',Clock3,'text-amber-600','bg-amber-50'], ['里程碑达成','7 / 10','下个节点还有 8 天',CheckCircle2,'text-emerald-600','bg-emerald-50'], ['资源投入','1,284h','本月可用 1,520h',Users,'text-blue-600','bg-blue-50'], ['预算消耗','¥76.8万','总预算 ¥120万 · 64%',CircleDollarSign,'text-violet-600','bg-violet-50'],
    ].map(([label,value,note,Icon,tone,bg]) => <Card key={String(label)} className="gap-3"><CardHeader className="flex-row items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{label as string}</span><span className={`rounded-lg p-2 ${bg} ${tone}`}><Icon className="size-4" /></span></CardHeader><CardContent><p className="text-2xl font-bold tracking-tight">{value as string}</p><p className={`mt-1 text-xs ${tone}`}>{note as string}</p></CardContent></Card>)}</div>
    <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
      <Card><CardHeader className="border-b"><CardTitle>计划与实际进度</CardTitle><p className="text-xs text-muted-foreground">AI 预测 9月18日核心联调完成概率为 63%</p></CardHeader><CardContent><ChartContainer config={{ plan:{label:'计划',color:'#94a3b8'}, actual:{label:'实际',color:'#2563eb'} }} className="h-[230px] w-full aspect-auto"><AreaChart data={trend} margin={{left:0,right:8,top:10,bottom:0}}><defs><linearGradient id="actual" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={.28}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="day" tickLine={false} axisLine={false}/><YAxis domain={[40,80]} tickLine={false} axisLine={false}/><ChartTooltip content={<ChartTooltipContent />} /><Area type="monotone" dataKey="plan" stroke="#94a3b8" strokeDasharray="5 5" fill="transparent" /><Area type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={2.5} fill="url(#actual)" /></AreaChart></ChartContainer></CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>任务状态分布</CardTitle><p className="text-xs text-muted-foreground">85 项任务 · 7 项阻塞</p></CardHeader><CardContent className="flex items-center gap-4"><ChartContainer config={{}} className="h-[190px] w-[55%] aspect-auto"><PieChart><Pie data={workState} dataKey="value" nameKey="name" innerRadius={47} outerRadius={72} paddingAngle={3}>{workState.map(x => <Cell key={x.name} fill={x.fill} />)}</Pie><ChartTooltip content={<ChartTooltipContent nameKey="name" />} /></PieChart></ChartContainer><div className="flex-1 space-y-3">{workState.map(x => <div key={x.name} className="flex items-center text-xs"><span className="mr-2 size-2 rounded-full" style={{background:x.fill}} /><span className="text-muted-foreground">{x.name}</span><strong className="ml-auto">{x.value}</strong></div>)}</div></CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>关键里程碑</CardTitle></CardHeader><CardContent className="space-y-4">{milestones.slice(0,3).map(x => <div key={x.name}><div className="mb-2 flex items-center gap-2"><span className="text-sm font-medium">{x.name}</span><StatusBadge value={x.state}/><span className="ml-auto text-xs text-muted-foreground">{x.date}</span></div><div className="flex items-center gap-3"><Progress value={x.progress} className="flex-1"/><span className="w-8 text-xs tabular-nums">{x.progress}%</span></div></div>)}</CardContent></Card>
      <Card className="border-rose-200"><CardHeader className="border-b bg-rose-50/60"><CardTitle className="flex items-center gap-2"><Activity className="size-4 text-rose-600"/>AI 风险雷达</CardTitle></CardHeader><CardContent className="space-y-3">{risks.map(x => <div key={x.id} className="rounded-lg border p-3"><div className="flex gap-2"><StatusBadge value={x.level}/><p className="text-sm font-medium">{x.title}</p></div><p className="mt-1 text-xs text-muted-foreground">{x.impact} · {x.owner}</p></div>)}<Button variant="outline" className="w-full" onClick={() => onAction('change')}>分析需求变更影响</Button></CardContent></Card>
    </div>
  </>;
}

function WbsView() { return <><SectionTitle eyebrow="Scope · Schedule · Ownership" title="WBS 与任务中心" action={<div className="flex gap-2"><Button variant="outline"><KanbanSquare/>切换看板</Button><Button><Plus/>新增任务</Button></div>}/><div className="mb-4 grid gap-3 sm:grid-cols-4">{[['任务总数','85'],['按期完成','91%'],['进行中','24'],['阻塞任务','7']].map(x=><Card key={x[0]} size="sm"><CardContent><p className="text-xs text-muted-foreground">{x[0]}</p><p className="mt-1 text-xl font-bold">{x[1]}</p></CardContent></Card>)}</div><Card><CardHeader className="border-b"><div className="flex flex-wrap gap-2"><Input className="max-w-xs" placeholder="筛选任务…"/><Button variant="outline">全部状态 <ChevronDown/></Button><Button variant="outline">全部负责人 <ChevronDown/></Button></div></CardHeader><CardContent className="overflow-x-auto px-0"><table className="w-full min-w-[1180px] text-left text-xs"><thead className="bg-muted/60 text-muted-foreground"><tr>{['WBS','任务名称','所属项目','负责人','状态','优先级','计划开始','计划完成','进度','工时','前置','风险'].map(h=><th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{tasks.map((r,i)=><tr key={r[0]} className="border-t hover:bg-muted/30">{r.map((c,j)=><td key={j} className="px-4 py-3 whitespace-nowrap">{j===4||j===11?<StatusBadge value={c}/>:j===8?<div className="flex items-center gap-2"><Progress value={Number(c.replace('%',''))} className="w-16"/><span>{c}</span></div>:<span className={j===1?'font-medium':''}>{c}</span>}</td>)}</tr>)}</tbody></table></CardContent></Card></>; }

function PlanView() { return <><SectionTitle eyebrow="Baseline · Forecast · Dependencies" title="计划与里程碑" action={<Button><Plus/>生成版本计划</Button>}/><div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]"><Card><CardHeader className="border-b"><CardTitle>项目时间轴</CardTitle><p className="text-xs text-muted-foreground">基准计划与预测完成日期对比</p></CardHeader><CardContent className="space-y-6">{milestones.map((m,i)=><div key={m.name} className="grid grid-cols-[84px_1fr] gap-4"><div className="text-xs text-muted-foreground">{m.date}</div><div className="relative border-l-2 border-muted pl-5"><span className={`absolute -left-[7px] top-0 size-3 rounded-full ring-4 ring-background ${m.state==='有风险'?'bg-rose-500':m.state==='已完成'?'bg-emerald-500':'bg-blue-500'}`}/><div className="flex items-center gap-2"><p className="text-sm font-semibold">{m.name}</p><StatusBadge value={m.state}/></div><p className="mt-1 text-xs text-muted-foreground">负责人 {m.owner} · 完成度 {m.progress}%</p><Progress value={m.progress} className="mt-3"/></div></div>)}</CardContent></Card><div className="space-y-5"><Card><CardHeader><CardTitle>关键路径</CardTitle></CardHeader><CardContent><div className="flex flex-wrap items-center gap-2 text-xs">{['2.1 API改造','2.2 支付联调','3.2 回归测试','Beta发布'].map((x,i)=><span key={x} className="contents"><span className="rounded-lg border bg-muted/40 px-3 py-2 font-medium">{x}</span>{i<3&&<span>→</span>}</span>)}</div><p className="mt-4 rounded-lg bg-rose-50 p-3 text-xs leading-5 text-rose-800">关键路径浮动时间仅 1 天。支付联调每延迟 1 天，Beta 发布延期概率增加 18%。</p></CardContent></Card><Card><CardHeader><CardTitle>AI 完成预测</CardTitle></CardHeader><CardContent className="space-y-3">{[['09/27 按期发布','63%'],['延迟 1–3 天','29%'],['延迟 4 天以上','8%']].map(x=><div key={x[0]} className="flex items-center text-sm"><span>{x[0]}</span><strong className="ml-auto">{x[1]}</strong></div>)}</CardContent></Card></div></div></>; }

function ResourceView() { return <><SectionTitle eyebrow="Capacity · Cost · Forecast" title="资源与预算" action={<Button variant="outline"><Sparkles/>AI 调配建议</Button>}/><div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]"><Card><CardHeader className="border-b"><CardTitle>团队负载</CardTitle><p className="text-xs text-muted-foreground">AI 已识别 2 名成员过载</p></CardHeader><CardContent className="space-y-4">{resources.map(r=><div key={r.name} className="grid grid-cols-[100px_1fr_56px] items-center gap-3"><div><p className="text-sm font-medium">{r.name}</p><p className="text-[11px] text-muted-foreground">{r.role}</p></div><div><Progress value={Math.min(r.load,100)} /><p className="mt-1 text-[10px] text-muted-foreground">{r.project}</p></div><span className={`text-right text-xs font-semibold ${r.load>100?'text-rose-600':'text-foreground'}`}>{r.load}%</span></div>)}<div className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800"><strong>AI 建议：</strong>将赵一负责的“数据看板兼容性测试”转交周琪，可释放 20 小时并把 Beta 按期概率提升至 78%。</div></CardContent></Card><Card><CardHeader className="border-b"><CardTitle>预算计划 vs 实际</CardTitle><p className="text-xs text-muted-foreground">单位：万元</p></CardHeader><CardContent><ChartContainer config={{plan:{label:'计划',color:'#cbd5e1'},actual:{label:'实际',color:'#2563eb'}}} className="h-[260px] w-full aspect-auto"><BarChart data={budgetBars}><CartesianGrid vertical={false}/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><ChartTooltip content={<ChartTooltipContent/>}/><Bar dataKey="plan" fill="#cbd5e1" radius={[5,5,0,0]}/><Bar dataKey="actual" fill="#2563eb" radius={[5,5,0,0]}/></BarChart></ChartContainer><div className="grid grid-cols-3 gap-2 border-t pt-4 text-center"><div><p className="text-xs text-muted-foreground">总预算</p><p className="font-bold">¥120万</p></div><div><p className="text-xs text-muted-foreground">已消耗</p><p className="font-bold">¥76.8万</p></div><div><p className="text-xs text-muted-foreground">完工预测</p><p className="font-bold text-amber-600">¥123.4万</p></div></div></CardContent></Card></div></>; }

function RiskView({onChange}:{onChange:()=>void}) { return <><SectionTitle eyebrow="Detect · Respond · Close" title="风险与需求变更" action={<div className="flex gap-2"><Button variant="outline"><Plus/>登记风险</Button><Button onClick={onChange}><WandSparkles/>分析需求变更</Button></div>}/><div className="mb-5 grid gap-3 sm:grid-cols-4">{[['开放风险','12'],['高风险','2'],['待闭环','5'],['本周新增','3']].map((x,i)=><Card key={x[0]} size="sm"><CardContent><p className="text-xs text-muted-foreground">{x[0]}</p><p className={`mt-1 text-xl font-bold ${i===1?'text-rose-600':''}`}>{x[1]}</p></CardContent></Card>)}</div><div className="space-y-4">{risks.map(r=><Card key={r.id}><CardContent className="grid gap-4 lg:grid-cols-[1.1fr_1fr_1.2fr_auto]"><div><div className="mb-2 flex items-center gap-2"><StatusBadge value={r.level}/><span className="text-xs text-muted-foreground">{r.id}</span></div><p className="font-semibold">{r.title}</p><p className="mt-1 text-xs text-muted-foreground">负责人：{r.owner}</p></div><div><p className="mb-1 text-xs text-muted-foreground">影响与触发条件</p><p className="text-sm">{r.impact}</p><p className="mt-1 text-xs text-muted-foreground">触发：{r.trigger}</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="mb-1 text-xs font-semibold">应急预案</p><p className="text-xs leading-5 text-muted-foreground">{r.plan}</p></div><div className="flex items-center"><StatusBadge value={r.status}/></div></CardContent></Card>)}<Card className="border-dashed"><CardContent className="flex flex-wrap items-center gap-3"><ClipboardCheck className="text-emerald-600"/><div><p className="text-sm font-semibold">闭环规则已启用</p><p className="text-xs text-muted-foreground">风险触发 → 自动通知 → 执行预案 → 验证效果 → 关闭归档</p></div><Badge className="ml-auto bg-emerald-100 text-emerald-700">自动追踪中</Badge></CardContent></Card></div></>; }

function ReportsView({onReport}:{onReport:()=>void}) { return <><SectionTitle eyebrow="Release · Narrative · Decisions" title="版本计划与报告" action={<Button onClick={onReport}><Sparkles/>生成报告</Button>}/><div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Card><CardHeader className="border-b"><CardTitle>版本路线图</CardTitle></CardHeader><CardContent className="space-y-4">{versions.map(v=><div key={v.name} className="rounded-xl border p-4"><div className="flex items-center gap-3"><GitBranch className="size-4 text-primary"/><p className="font-semibold">{v.name}</p><StatusBadge value={v.state}/><span className="ml-auto text-xs text-muted-foreground">{v.date}</span></div><p className="mb-3 mt-2 text-xs text-muted-foreground">{v.scope}</p><div className="flex items-center gap-3"><Progress value={v.progress} className="flex-1"/><span className="text-xs">{v.progress}%</span></div></div>)}</CardContent></Card><div className="space-y-5"><Card><CardHeader className="border-b"><CardTitle>自动报告中心</CardTitle></CardHeader><CardContent className="space-y-3">{[['项目日报','每天 18:00','今天 18:00'],['项目周报','每周五 17:30','明天 17:30'],['版本简报','版本节点触发','09月13日']].map(x=><div key={x[0]} className="flex items-center gap-3 rounded-lg border p-3"><FileChartColumn className="size-4 text-primary"/><div><p className="text-sm font-medium">{x[0]}</p><p className="text-[11px] text-muted-foreground">{x[1]}</p></div><span className="ml-auto text-xs text-muted-foreground">{x[2]}</span></div>)}</CardContent></Card><Card><CardHeader><CardTitle>本周 AI 摘要</CardTitle></CardHeader><CardContent className="text-xs leading-6 text-muted-foreground"><p>完成 11 项任务，整体进度提升 9%。核心联调受支付接口影响落后 4%，但预算仍在可控区间。</p><p className="mt-2 text-foreground"><strong>需管理层决策：</strong>是否启用备用支付通道；是否批准测试资源借调。</p></CardContent></Card></div></div></>; }

function MeetingsView({onMeeting}:{onMeeting:()=>void}) { const meetings=[['v1.0 Beta 风险决策会','09月11日 14:30','林夏、陈默、赵一、周琪','3 个决策项'],['产品与研发周例会','09月12日 10:00','项目核心组','AI 议程已生成'],['Alpha 验收复盘','09月13日 16:00','业务、产品、研发、测试','待确认']]; return <><SectionTitle eyebrow="Calendar · Decisions · Follow-up" title="会议与团队协同" action={<Button onClick={onMeeting}><Plus/>预约会议</Button>}/><div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]"><Card><CardHeader className="border-b"><CardTitle>近期会议</CardTitle></CardHeader><CardContent className="space-y-3">{meetings.map((m,i)=><div key={m[0]} className="flex flex-wrap items-center gap-4 rounded-xl border p-4"><div className={`flex size-11 flex-col items-center justify-center rounded-lg ${i===0?'bg-primary text-white':'bg-muted'}`}><span className="text-[10px]">9月</span><strong>{11+i}</strong></div><div><p className="text-sm font-semibold">{m[0]}</p><p className="mt-1 text-xs text-muted-foreground">{m[1]} · {m[2]}</p></div><Badge variant="outline" className="ml-auto">{m[3]}</Badge></div>)}</CardContent></Card><div className="space-y-5"><Card><CardHeader><CardTitle>AI 会议助手</CardTitle></CardHeader><CardContent className="space-y-3 text-xs"><div className="rounded-lg bg-blue-50 p-3 leading-5 text-blue-800">自动准备项目快照、风险清单和待决策项；会后提取纪要、决策与行动项并回写任务。</div>{['会前 30 分钟推送材料','自动记录决策与负责人','行动项逾期自动预警'].map(x=><div key={x} className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-500"/>{x}</div>)}</CardContent></Card><Card><CardHeader><CardTitle>待跟进决策</CardTitle></CardHeader><CardContent className="space-y-2">{['支付备用通道预算审批','测试资源借调确认','CR-018 版本归属'].map(x=><div key={x} className="flex items-center gap-2 rounded-lg border p-3 text-xs"><AlertTriangle className="size-4 text-amber-500"/>{x}<span className="ml-auto text-muted-foreground">待确认</span></div>)}</CardContent></Card></div></div></>; }

function Impact({label,value,tone}:{label:string;value:string;tone:'rose'|'amber'|'blue'}) { const c={rose:'bg-rose-50 text-rose-800',amber:'bg-amber-50 text-amber-800',blue:'bg-blue-50 text-blue-800'}[tone]; return <div className={`rounded-xl p-3 ${c}`}><p className="text-xs opacity-70">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>; }
