import { expect, test } from '@playwright/test';

import {
  collectBrowserErrors,
  expectNoBrowserErrors,
  openNavigation,
  openWorkspace,
} from './helpers';

test.describe('FlowPilot 核心验收', () => {
  test('工作台加载、通知和全局搜索可下钻到任务', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await openWorkspace(page);

    await expect(page.getByText('AI 项目脉搏')).toBeVisible();
    await expect(page.getByText('持久数据已连接')).toBeVisible();
    await page.getByRole('button', { name: /通知，3 条未读/ }).click();
    await expect(page.getByText('支付网关联调仍有阻塞')).toBeVisible();
    await page.getByRole('button', { name: /通知，3 条未读/ }).click();

    await page.getByRole('button', { name: '全局搜索' }).click();
    await page.getByRole('textbox', { name: '搜索关键词' }).fill('支付');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^2\.2 支付网关联调/ })
      .click();

    await expect(page.getByText('WBS 与任务中心')).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: '按负责人筛选' }),
    ).toHaveValue('赵一');
    await expectNoBrowserErrors(browserErrors);
  });

  test('WBS 支持阻塞筛选、详情、新增任务和看板切换', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await openWorkspace(page);
    await page
      .getByRole('combobox', { name: '选择版本数据范围' })
      .selectOption('portfolio');
    await openNavigation(page, 'WBS与任务');

    await page
      .getByRole('combobox', { name: '按任务状态筛选' })
      .selectOption('有阻塞');
    await expect(page.getByText(/任务状态为/)).toBeVisible();
    await page.getByRole('button', { name: '阻塞详情' }).first().click();
    await expect(
      page.getByRole('dialog').getByText('任务阻塞详情'),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: '具体阻塞原因' }),
    ).not.toHaveValue('');
    await page.getByRole('button', { name: '取消' }).click();

    await page.getByRole('button', { name: '新增任务' }).click();
    await expect(
      page.getByRole('dialog').getByText('新增 WBS 任务'),
    ).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await page.getByRole('button', { name: '切换看板' }).click();
    await expect(page.getByRole('button', { name: '切换列表' })).toBeVisible();
    await expectNoBrowserErrors(browserErrors);
  });

  test('计划、版本历史和实际完成时间入口可用', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await openWorkspace(page);
    await openNavigation(page, '计划与里程碑');

    await expect(page.getByText(/进度趋势/).first()).toBeVisible();
    await page.getByRole('button', { name: '版本计划历史' }).click();
    await expect(
      page.getByRole('dialog').getByText('版本计划历史与实际节点'),
    ).toBeVisible();
    await page.getByRole('button', { name: '关闭' }).click();

    await page.getByRole('button', { name: '记录实际时间' }).first().click();
    await expect(
      page.getByRole('dialog').getByText('记录实际完成时间'),
    ).toBeVisible();
    await expect(page.getByLabel('实际完成日期与时间')).not.toHaveValue('');
    await page.getByRole('button', { name: '取消' }).click();
    await expectNoBrowserErrors(browserErrors);
  });

  test('会议、报告和成员权限入口形成可操作闭环', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await openWorkspace(page);

    await openNavigation(page, '会议协同');
    const history = page.getByRole('button', { name: /历史归档会议/ });
    await expect(history).toHaveAttribute('aria-expanded', 'false');
    await history.click();
    await expect(
      page.getByRole('button', { name: '查看当期纪要' }).first(),
    ).toBeVisible();
    await page.getByRole('button', { name: '预约会议' }).click();
    await expect(
      page.getByRole('dialog').getByText('预约项目会议'),
    ).toBeVisible();
    await expect(
      page.getByRole('dialog').locator('input[type="date"]'),
    ).not.toHaveValue('');
    await page.getByRole('button', { name: 'Close' }).click();

    await openNavigation(page, '版本与报告');
    await page.getByRole('button', { name: '生成报告' }).click();
    await expect(
      page.getByRole('dialog').getByText('生成 AI 项目报告'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    await openNavigation(page, '成员与权限');
    await expect(page.getByText('成员与权限中心')).toBeVisible();
    await expect(page.getByRole('button', { name: '邀请成员' })).toBeEnabled();
    await page.getByRole('button', { name: '邀请成员' }).click();
    await expect(
      page.getByRole('dialog').getByText('邀请工作区成员'),
    ).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await expectNoBrowserErrors(browserErrors);
  });
});
