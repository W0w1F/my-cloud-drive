/* anti-slop.spec.js — Anti AI Slop Audit Tests
   Feature: 002-frontend-ux | Constitution: SC-008 (zero slop hit) */

const { test, expect } = require('@playwright/test');

test.describe('Anti AI Slop Audit', function() {

  test('no purple gradients', async function({ page }) {
    await page.goto('/');

    // Scan all computed styles for purple gradient patterns
    const hasPurpleGradient = await page.evaluate(function() {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const bg = getComputedStyle(el).backgroundImage;
        const color = getComputedStyle(el).backgroundColor;
        // Check for purple hex values or oklch purple
        if ((bg && bg.includes('gradient') && (
          bg.includes('#7C3AED') || bg.includes('#A855F7') ||
          bg.includes('#8B5CF6') || bg.includes('#9333EA')
        )) || color.includes('oklch(50% 0.2 300')) {
          return true;
        }
      }
      return false;
    });
    expect(hasPurpleGradient).toBe(false);
  });

  test('no emoji used as functional icons', async function({ page }) {
    await page.goto('/');
    await page.waitForSelector('#directory-tree');

    // Scan for emoji characters in UI elements (not user content)
    const hasEmojiIcons = await page.evaluate(function() {
      const emojiPattern = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      const uiElements = document.querySelectorAll('.tree-node-name, .file-name, button, #app-title');
      for (const el of uiElements) {
        if (emojiPattern.test(el.textContent)) return true;
      }
      return false;
    });
    expect(hasEmojiIcons).toBe(false);
  });

  test('no Inter/Roboto/Arial as display font', async function({ page }) {
    await page.goto('/');

    const hasBannedFonts = await page.evaluate(function() {
      const displayElements = document.querySelectorAll('.file-name, .tree-node-name, #app-title');
      const banned = ['Inter', 'Roboto', 'Arial'];
      for (const el of displayElements) {
        const fontFamily = getComputedStyle(el).fontFamily;
        for (const bannedFont of banned) {
          if (fontFamily.includes(bannedFont)) return bannedFont;
        }
      }
      return false;
    });
    expect(hasBannedFonts).toBe(false);
  });

  test('no CDN or external script imports', async function({ page }) {
    await page.goto('/');

    // Verify no scripts from CDN
    const scripts = await page.locator('script[src]').evaluateAll(function(els) {
      return els.map(el => el.src);
    });

    for (const src of scripts) {
      expect(src).not.toContain('unpkg.com');
      expect(src).not.toContain('cdn.jsdelivr');
      expect(src).not.toContain('cdnjs.cloudflare.com');
    }
  });

  test('CSP header present', async function({ page }) {
    const response = await page.goto('/');
    const csp = response.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
  });

  test('no card border-left accent pattern', async function({ page }) {
    await page.goto('/');

    const hasBorderAccent = await page.evaluate(function() {
      const cards = document.querySelectorAll('.file-card');
      for (const card of cards) {
        const borderLeft = getComputedStyle(card).borderLeftWidth;
        const borderColor = getComputedStyle(card).borderLeftColor;
        // If border-left is non-zero and colorful (not gray/transparent), it's slop
        if (parseFloat(borderLeft) > 2) return true;
        if (borderLeft !== '0px' && !borderColor.includes('oklch(88%') && borderColor !== 'rgb(224, 224, 224)') {
          return true;
        }
      }
      return false;
    });
    expect(hasBorderAccent).toBe(false);
  });
});
