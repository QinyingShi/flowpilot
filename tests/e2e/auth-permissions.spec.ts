import { expect, test } from '@playwright/test';

import {
  collectBrowserErrors,
  expectNoBrowserErrors,
  openNavigation,
  openWorkspace,
} from './helpers';

test('开发身份切换后按项目经理权限展示操作', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await openWorkspace(page);

  await page.getByRole('button', { name: '打开用户菜单' }).click();
  await page.getByRole('menuitem', { name: '切换测试身份' }).click();
  const identityDialog = page.getByRole('dialog');
  await identityDialog.getByRole('button', { name: /Demo Manager/ }).click();

  await expect(page.getByText('AI 项目脉搏')).toBeVisible();
  await openNavigation(page, '成员与权限');
  await expect(page.getByText('成员与权限中心')).toBeVisible();
  await expect(page.getByText('Demo Manager').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '邀请成员' })).toHaveCount(0);
  await expect(page.getByLabel(/调整.*的角色/).first()).toBeDisabled();
  await expectNoBrowserErrors(browserErrors);
});
