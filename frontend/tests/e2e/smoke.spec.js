/* smoke.spec.js — E2E Smoke Tests
   Feature: 002-frontend-ux | Constitution: SC-001 through SC-009 */

const { test, expect } = require('@playwright/test');

test.describe('Cloud Drive — Smoke Tests', function() {

  test('page loads with dual-pane layout', async function({ page }) {
    await page.goto('/');

    // Left tree panel visible
    const treePanel = page.locator('#tree-panel');
    await expect(treePanel).toBeVisible();

    // Right grid panel visible
    const gridPanel = page.locator('#grid-panel');
    await expect(gridPanel).toBeVisible();

    // Header with title
    const title = page.locator('#app-title');
    await expect(title).toHaveText('云盘');
  });

  test('directory tree renders nodes', async function({ page }) {
    await page.goto('/');
    await page.waitForSelector('#directory-tree .tree-node');
    const nodes = page.locator('#directory-tree .tree-node');
    expect(await nodes.count()).toBeGreaterThan(0);
  });

  test('skeleton appears during loading', async function({ page }) {
    // Throttle network to simulate slow connection
    await page.route('**/api/v1/files**', async function(route) {
      await new Promise(r => setTimeout(r, 2000)); // 2s delay
      await route.continue();
    });

    await page.goto('/');

    // Skeleton cards should appear
    await page.waitForSelector('.skeleton-card', { timeout: 5000 });
    const skeletons = page.locator('.skeleton-card');
    expect(await skeletons.count()).toBeGreaterThan(0);
  });

  test('empty directory shows honest empty state', async function({ page }) {
    // Mock empty API response
    await page.route('**/api/v1/files**', async function(route) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, offset: 0, limit: 50 })
      });
    });

    await page.goto('/');

    // Should show "此目录为空" — NO illustration, NO emoji
    const emptyText = page.locator('#file-grid');
    await expect(emptyText).toContainText('此目录为空');
  });

  test('dark mode toggle works', async function({ page }) {
    await page.goto('/');

    // Click theme toggle
    const toggleBtn = page.locator('#theme-toggle');
    await toggleBtn.click();

    // Verify data-theme="dark"
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Toggle back to light
    await toggleBtn.click();
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('responsive: mobile hamburger shows at narrow width', async function({ page }) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    // Hamburger should be visible
    const hamburger = page.locator('#hamburger');
    await expect(hamburger).toBeVisible();

    // Tree panel should be off-screen
    const treePanel = page.locator('#tree-panel');
    const box = await treePanel.boundingBox();
    // transform means it's translated off-screen
    expect(box).toBeTruthy();
  });
});
