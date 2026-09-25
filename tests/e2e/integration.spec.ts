import { expect, test } from '@playwright/test';

import {
  collectBrowserErrors,
  expectNoBrowserErrors,
  openNavigation,
  openWorkspace,
} from './helpers';

test('Jira 沙箱可配置、同步并关联 WBS', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await openWorkspace(page);
  await openNavigation(page, '集成与自动化');

  const jiraCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: 'Jira' })
    .first();
  await jiraCard.getByRole('button', { name: '配置' }).click();
  const configDialog = page.getByRole('dialog');
  await expect(configDialog.getByText('配置 Jira')).toBeVisible();
  await configDialog.getByLabel('连接名称').fill('Jira E2E 沙箱');
  await configDialog
    .getByLabel('服务地址')
    .fill('https://example.atlassian.net');
  await configDialog.getByLabel('项目代码').fill('NEBULA');
  await configDialog.getByRole('button', { name: '保存配置' }).click();
  await expect(
    page.getByText('配置已保存。下一步请执行连接测试。'),
  ).toBeVisible();
  await configDialog.getByRole('button', { name: '取消' }).click();

  await expect(jiraCard.getByRole('button', { name: '测试' })).toBeEnabled();
  await jiraCard.getByRole('button', { name: '测试' }).click();
  await expect(jiraCard.getByText('沙箱已连接')).toBeVisible();
  await jiraCard.getByRole('button', { name: '同步' }).click();
  await expect(page.getByText(/Jira 沙箱同步完成/)).toBeVisible();

  await expect(page.getByText('NEBULA-191', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '关联 WBS' }).first().click();
  await expect(
    page.getByRole('dialog').getByText('关联 Jira 缺陷到 WBS'),
  ).toBeVisible();
  await expect(
    page.getByLabel('选择 Jira 缺陷要关联的 WBS 任务'),
  ).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expectNoBrowserErrors(browserErrors);
});
