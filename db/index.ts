import { env } from 'cloudflare:workers';
import { schemaStatements } from './schema';

export async function initializeDb() {
  if (!env.DB) {
    throw new Error('D1 binding DB is unavailable');
  }
  await env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql)));
  await env.DB.prepare(
    `INSERT OR IGNORE INTO projects
      (id, name, code, description, owner_id, status)
     VALUES ('nebula-customer-platform', '星云客户平台', 'NEBULA',
             '客户、订单、支付与增长能力建设', 'local-user', 'active')`,
  ).run();
  const defaultRules = [
    ['task_assignment', 1, 'workspace', { sendImmediately: true }],
    ['progress_drift', 1, 'workspace', { thresholdPercent: 5 }],
    ['due_reminder', 1, 'workspace', { leadHours: 24, repeatHours: 12 }],
    ['git_verification', 1, 'workspace', { staleHours: 24 }],
    ['quality_warning', 1, 'workspace', { p1Limit: 3, reopenRate: 10 }],
    [
      'ai_inspection',
      1,
      'workspace',
      { intervalMinutes: 30, loadThreshold: 105, riskStaleHours: 24 },
    ],
  ] as const;
  await env.DB.batch(
    defaultRules.map(([key, enabled, channel, config]) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO automation_rules
          (project_id, rule_key, enabled, channel, rule_json, updated_by)
         VALUES ('nebula-customer-platform', ?, ?, ?, ?, 'system')`,
      ).bind(key, enabled, channel, JSON.stringify(config)),
    ),
  );
  await seedDemoHistory();
}

async function seedDemoHistory() {
  const demoBaselines = [
    {
      id: 'demo-v09-b0',
      versionId: 'v0.9',
      key: 'B0',
      label: '初始版本计划',
      snapshot: {
        development: '08/20–09/02',
        integration: '09/03–09/04',
        testEntry: '09/06',
        testing: '09/06–09/11',
        release: '09/14',
        reason: '立项范围确认',
      },
    },
    {
      id: 'demo-v10-b0',
      versionId: 'v1.0',
      key: 'B0',
      label: '初始版本计划',
      snapshot: {
        development: '09/03–09/16',
        integration: '09/17–09/22',
        testEntry: '09/23',
        testing: '09/23–09/26',
        release: '09/27',
        reason: '需求基线冻结',
      },
    },
    {
      id: 'demo-v10-b1',
      versionId: 'v1.0',
      key: 'B1',
      label: '支付变更后计划',
      snapshot: {
        development: '09/03–09/17',
        integration: '09/18–09/24',
        testEntry: '09/28',
        testing: '09/28–09/29',
        release: '09/30',
        reason: '支付接口范围变化并避开中秋假期',
      },
    },
    {
      id: 'demo-v11-b0',
      versionId: 'v1.1',
      key: 'B0',
      label: '初始版本计划',
      snapshot: {
        development: '09/18–09/30',
        integration: '10/08–10/12',
        testEntry: '10/13',
        testing: '10/13–10/19',
        release: '10/20',
        reason: '初始排期并避开国庆假期',
      },
    },
  ];
  const baselineStatements = demoBaselines.map((baseline) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO plan_baselines
        (id, project_id, version_id, baseline_key, label, snapshot_json, created_by)
       VALUES (?, 'nebula-customer-platform', ?, ?, ?, ?, 'ai-demo')`,
    ).bind(
      baseline.id,
      baseline.versionId,
      baseline.key,
      baseline.label,
      JSON.stringify(baseline.snapshot),
    ),
  );
  const demoActuals = [
    ['v0.9', '需求评审', '2026-08-20', '需求基线按期确认'],
    ['v0.9', '技术评审', '2026-08-23', '技术方案评审通过'],
    ['v0.9', '用例评审', '2026-08-28', '验收用例评审通过'],
    ['v0.9', '联合联调', '2026-09-04', '较计划晚 1 天完成'],
    ['v0.9', '提测', '2026-09-06', '准入检查通过'],
    ['v1.0', '需求评审', '2026-09-03', '需求基线按期确认'],
    ['v1.0', '技术评审', '2026-09-07', '较计划晚 1 天完成'],
  ];
  const actualStatements = demoActuals.map(
    ([versionId, milestone, date, detail]) =>
      env.DB.prepare(
        `INSERT INTO milestone_events
        (project_id, version_id, milestone_key, event_type, occurred_at, source_system, detail)
       SELECT 'nebula-customer-platform', ?, ?, 'actual', ?, 'workbench', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM milestone_events
         WHERE project_id = 'nebula-customer-platform'
           AND version_id = ? AND milestone_key = ?
           AND event_type = 'actual' AND occurred_at = ?
       )`,
      ).bind(versionId, milestone, date, detail, versionId, milestone, date),
  );
  await env.DB.batch([...baselineStatements, ...actualStatements]);
}

export async function ensureMember(input: {
  id: string;
  email: string;
  displayName: string;
}) {
  await env.DB.prepare(
    `INSERT INTO workspace_members (id, email, display_name, role)
     VALUES (?, ?, ?, 'project_manager')
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(input.id, input.email, input.displayName)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO project_memberships
      (member_id, project_id, status)
     VALUES (?, 'nebula-customer-platform', 'active')`,
  )
    .bind(input.id)
    .run();
}

export async function getWorkspaceSnapshot() {
  const [
    members,
    records,
    syncEvents,
    connectorConfigs,
    automationRules,
    inspectionRuns,
    inspectionFindings,
    requirementDocuments,
    requirementDrafts,
    requirementTaskLinks,
    auditLogs,
    planBaselines,
    milestoneEvents,
    permissions,
  ] = await env.DB.batch([
    env.DB.prepare(
      `SELECT wm.id, wm.email, wm.display_name, wm.role, wm.status
       FROM workspace_members wm
       JOIN project_memberships pm ON pm.member_id = wm.id
       WHERE pm.project_id = 'nebula-customer-platform'
       ORDER BY wm.created_at ASC LIMIT 50`,
    ),
    env.DB.prepare(
      `SELECT entity_type, status, COUNT(*) AS total
       FROM project_records
       WHERE project_id = 'nebula-customer-platform'
       GROUP BY entity_type, status`,
    ),
    env.DB.prepare(
      `SELECT connector, direction, entity_type, status, detail, occurred_at
       FROM sync_events
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY occurred_at DESC LIMIT 20`,
    ),
    env.DB.prepare(
      `SELECT project_id, connector, mode, status, display_name, base_url,
              config_json, last_tested_at, last_synced_at, last_error,
              updated_by, updated_at
       FROM connector_configs
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY connector`,
    ),
    env.DB.prepare(
      `SELECT project_id, rule_key, enabled, channel, rule_json,
              updated_by, updated_at
       FROM automation_rules
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY rule_key`,
    ),
    env.DB.prepare(
      `SELECT id, project_id, trigger_type, status, summary_json,
              created_by, started_at, completed_at
       FROM inspection_runs
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY started_at DESC LIMIT 20`,
    ),
    env.DB.prepare(
      `SELECT project_id, fingerprint, finding_type, severity, title, detail,
              owner, recommendation, source_refs_json, status, resolution_note,
              first_detected_at, last_detected_at, resolved_at, updated_by
       FROM inspection_findings
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                last_detected_at DESC`,
    ),
    env.DB.prepare(
      `SELECT id, project_id, file_name, file_type, file_size, sha256, status,
              parse_summary_json, uploaded_by, created_at, updated_at
       FROM requirement_documents
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY created_at DESC LIMIT 30`,
    ),
    env.DB.prepare(
      `SELECT id, project_id, document_id, version_id, delivery_mode, status,
              draft_json, created_by, created_at, applied_at
       FROM requirement_drafts
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY created_at DESC LIMIT 30`,
    ),
    env.DB.prepare(
      `SELECT project_id, document_id, draft_id, task_id, created_at
       FROM requirement_task_links
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY created_at DESC`,
    ),
    env.DB.prepare(
      `SELECT actor_id, actor_type, action, entity_type, entity_id, detail, created_at
       FROM audit_logs
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY created_at DESC LIMIT 30`,
    ),
    env.DB.prepare(
      `SELECT id, project_id, version_id, baseline_key, label, snapshot_json,
              created_by, created_at
       FROM plan_baselines
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY created_at DESC, version_id ASC LIMIT 50`,
    ),
    env.DB.prepare(
      `SELECT id, project_id, version_id, milestone_key, event_type, occurred_at,
              source_system, detail, created_at
       FROM milestone_events
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY occurred_at DESC, id DESC LIMIT 100`,
    ),
    env.DB.prepare(
      `SELECT member_id, project_id, permission, version_id, created_at
       FROM project_member_permissions
       WHERE project_id = 'nebula-customer-platform'
       ORDER BY member_id, permission, version_id`,
    ),
  ]);
  return {
    members: members.results,
    recordCounts: records.results,
    syncEvents: syncEvents.results,
    connectorConfigs: connectorConfigs.results,
    automationRules: automationRules.results,
    inspectionRuns: inspectionRuns.results,
    inspectionFindings: inspectionFindings.results,
    requirementDocuments: requirementDocuments.results,
    requirementDrafts: requirementDrafts.results,
    requirementTaskLinks: requirementTaskLinks.results,
    auditLogs: auditLogs.results,
    planBaselines: planBaselines.results,
    milestoneEvents: milestoneEvents.results,
    permissions: permissions.results,
  };
}

export async function savePlanBaseline(input: {
  id: string;
  projectId: string;
  versionId: string;
  baselineKey: string;
  label: string;
  snapshot: unknown;
  createdBy: string;
}) {
  await env.DB.prepare(
    `INSERT INTO plan_baselines
      (id, project_id, version_id, baseline_key, label, snapshot_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.projectId,
      input.versionId,
      input.baselineKey,
      input.label,
      JSON.stringify(input.snapshot),
      input.createdBy,
    )
    .run();
}

export async function recordMilestoneActual(input: {
  projectId: string;
  versionId: string;
  milestoneKey: string;
  occurredAt: string;
  detail?: string;
}) {
  await env.DB.prepare(
    `INSERT INTO milestone_events
      (project_id, version_id, milestone_key, event_type, occurred_at, source_system, detail)
     VALUES (?, ?, ?, 'actual', ?, 'workbench', ?)`,
  )
    .bind(
      input.projectId,
      input.versionId,
      input.milestoneKey,
      input.occurredAt,
      input.detail ?? null,
    )
    .run();
}

export async function appendAuditLog(input: {
  actorId: string;
  actorType: 'user' | 'ai' | 'connector';
  action: string;
  entityType: string;
  entityId?: string;
  detail?: string;
}) {
  await env.DB.prepare(
    `INSERT INTO audit_logs
      (actor_id, actor_type, action, entity_type, entity_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.actorId,
      input.actorType,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.detail ?? null,
    )
    .run();
}
