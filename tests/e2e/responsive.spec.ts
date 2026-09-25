import { expect, test } from '@playwright/test';

import { openNavigation, openWorkspace } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

test('窄屏通过菜单访问主要页面', async ({ page }) => {
  await openWorkspace(page);
  await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
  await openNavigation(page, '资源与负载');
  await expect(page.getByRole('heading', { name: '资源与负载' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
});
