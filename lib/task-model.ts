export const taskStatuses = ['未开始', '进行中', '有阻塞', '已完成'] as const;
export const taskPriorities = ['低', '中', '高'] as const;
export const taskVersions = ['v0.9', 'v1.0', 'v1.1'] as const;

export type TaskStatus = (typeof taskStatuses)[number];
export type TaskPriority = (typeof taskPriorities)[number];
export type TaskVersion = (typeof taskVersions)[number];

/**
 * Legacy-compatible task transport tuple.
 *
 * The API still exchanges arrays, but every position now has a checked meaning.
 * New storage/API versions can migrate to objects without spreading numeric
 * indexes further through the UI.
 */
export type TaskRecord = [
  id: string,
  title: string,
  project: string,
  version: TaskVersion,
  owner: string,
  status: TaskStatus,
  priority: TaskPriority,
  plannedStart: string,
  plannedEnd: string,
  progress: string,
  estimatedEffort: string,
  dependencies: string,
  risk: TaskPriority,
];

export const TaskField = {
  id: 0,
  title: 1,
  project: 2,
  version: 3,
  owner: 4,
  status: 5,
  priority: 6,
  plannedStart: 7,
  plannedEnd: 8,
  progress: 9,
  estimatedEffort: 10,
  dependencies: 11,
  risk: 12,
} as const;

export function isTaskRecord(value: unknown): value is TaskRecord {
  if (
    !Array.isArray(value) ||
    value.length !== 13 ||
    !value.every((field) => typeof field === 'string')
  ) {
    return false;
  }
  const progress = Number(value[TaskField.progress].replace('%', ''));
  return (
    taskVersions.includes(value[TaskField.version] as TaskVersion) &&
    taskStatuses.includes(value[TaskField.status] as TaskStatus) &&
    taskPriorities.includes(value[TaskField.priority] as TaskPriority) &&
    taskPriorities.includes(value[TaskField.risk] as TaskPriority) &&
    Number.isFinite(progress) &&
    progress >= 0 &&
    progress <= 100
  );
}

export function requireTaskRecords(value: unknown): TaskRecord[] {
  if (!Array.isArray(value) || !value.every(isTaskRecord)) {
    throw new Error('后端返回了无法识别的任务数据');
  }
  return value;
}

export function cloneTask(task: TaskRecord): TaskRecord {
  return [...task];
}
