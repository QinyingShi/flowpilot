import { expect, type Page } from '@playwright/test';

export function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByText('AI 项目脉搏')).toBeVisible();
}

export async function openNavigation(page: Page, label: string) {
  const mobileMenu = page.getByRole('button', { name: '打开导航' });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page
    .locator('nav')
    .getByRole('button', { name: label, exact: true })
    .click();
}

export async function expectNoBrowserErrors(errors: string[]) {
  expect(errors, errors.join('\n')).toEqual([]);
}
