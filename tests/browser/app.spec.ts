import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test('upload, review, literal download, filtering, privacy and reset', async ({ page }, testInfo) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', r => requests.push(r.url()));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('starting environment');
  await page.locator('#file').setInputFiles({ name: 'fixture.sh', mimeType: 'text/plain', buffer: Buffer.from('# $IGNORED\nINTERNAL=fixed\necho "$INPUT ${TOKEN:?needed} $INTERNAL $HOME"\n') });
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.locator('#status')).toContainText('Analysis complete');
  await expect(page.locator('.variable')).toHaveCount(4);
  await expect(page.getByLabel('Include INTERNAL', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Include HOME', { exact: true })).not.toBeChecked();
  await page.getByLabel('Test value for INPUT', { exact: true }).fill("literal'$(touch MUST_NOT_EXIST)");
  await page.getByLabel('Reviewed INPUT', { exact: true }).check();
  await page.getByLabel('Include TOKEN', { exact: true }).uncheck();
  await page.getByLabel('Search variable names').fill('INPUT');
  await expect(page.locator('.variable')).toHaveCount(1);
  await page.getByLabel('Search variable names').fill('');
  await page.getByLabel('Filter variables').selectOption('assigned');
  await expect(page.locator('.variable')).toHaveCount(1);
  await page.getByLabel('Filter variables').selectOption('all');
  await page.getByLabel('I reviewed the values and understand').check();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .env' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('variables.env');
  const text = await readFile((await download.path())!, 'utf8');
  expect(text).toContain("export INPUT='literal'\\''$(touch MUST_NOT_EXIST)'");
  expect(text).not.toContain('TOKEN='); expect(text).not.toContain('INTERNAL=');
  await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie }))).toEqual({ local: 0, session: 0, cookies: '' });
  // Some managed hosts inject a system web-filter script. Only explicitly
  // declared host injections are separated; CI allows no off-origin hosts.
  const injectedHost = process.env.BROWSER_INJECTED_HOST;
  const unexpected = requests.filter(url => {
    const parsed = new URL(url);
    return parsed.origin !== new URL(page.url()).origin && parsed.hostname !== injectedHost;
  });
  expect(unexpected).toEqual([]);
  const beforeReset = requests.length;
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.locator('#source')).toHaveValue('');
  await expect(page.locator('#preview')).not.toContainText('INPUT=');
  await expect(page.getByRole('button', { name: 'Download .env' })).toBeDisabled();
  await expect(page.locator('#variables')).toBeEmpty();
  expect(requests.length).toBe(beforeReset); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('invalid syntax, manual inputs, export errors and stale parsing', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Or paste your script').fill('if then');
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.locator('#status')).toContainText('line 1, column');
  await expect(page.getByRole('button', { name: 'Download .env' })).toBeDisabled();
  await page.getByLabel('Or paste your script').fill('echo hello');
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.locator('#status')).toContainText('No named variables');
  await page.getByLabel('New variable name').fill('MANUAL');
  await page.getByRole('button', { name: '+ Add input' }).click();
  await page.getByLabel('Test value for MANUAL').fill('safe literal');
  await page.getByLabel('Reviewed MANUAL', { exact: true }).check();
  await page.getByLabel('I reviewed the values and understand').check();
  await expect(page.getByRole('button', { name: 'Download .env' })).toBeEnabled();
  await page.getByLabel('New variable name').fill('MANUAL');
  await page.getByRole('button', { name: '+ Add input' }).click();
  await expect(page.locator('#status')).toContainText('already exists');
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.waitForTimeout(700);
  await expect(page.locator('#variables')).toBeEmpty();
  await expect(page.locator('#status')).toContainText('Cleared');
});

test('limits, sensitive defaults, keyboard and clipboard failure', async ({ page, context, browserName }) => {
  await page.goto('./');
  await page.locator('#file').setInputFiles({ name: 'too-large.sh', mimeType: 'text/plain', buffer: Buffer.alloc(256 * 1024 + 1, 65) });
  await expect(page.locator('#status')).toContainText('exceeds');
  await page.getByLabel('Or paste your script').fill('echo "${SECRET_TOKEN:-fixture-embedded-credential}"');
  await page.getByLabel('Or paste your script').press('Tab');
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.locator('#status')).toContainText('Analysis complete');
  await expect(page.getByLabel('Test value for SECRET_TOKEN', { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.locator('#preview')).not.toContainText('fixture-embedded-credential');
  await page.getByLabel('I reviewed the values and understand').check();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await page.getByRole('button', { name: 'Copy contents' }).click();
  await expect(page.locator('#export-status')).toContainText('Clipboard access failed');
  expect(browserName).toBe('chromium');
  expect((await context.cookies()).length).toBe(0);
});

test('copy succeeds, editing invalidates review, literal HTML stays data', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Or paste your script').fill('echo "$VALUE"');
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.locator('#status')).toContainText('Analysis complete');
  await page.getByLabel('Test value for VALUE', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.getByLabel('Reviewed VALUE', { exact: true }).check();
  await page.getByLabel('I reviewed the values and understand').check();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { document.documentElement.dataset.copied = text; } },
  }));
  await page.getByRole('button', { name: 'Copy contents' }).click();
  await expect(page.locator('#export-status')).toContainText('Environment copied');
  expect(await page.locator('html').getAttribute('data-copied')).toContain("export VALUE='<img src=x onerror=alert(1)>'");
  await expect(page.locator('#preview img')).toHaveCount(0);
  await page.getByLabel('Test value for VALUE', { exact: true }).fill('changed');
  await expect(page.getByLabel('Reviewed VALUE', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Download .env' })).toBeDisabled();
  await page.getByLabel('Or paste your script').fill('echo "$NEW"');
  await expect(page.locator('#status')).toContainText('Analyze again');
  await expect(page.locator('#variables')).toBeEmpty();
});

test('accessible initial and review states', async ({ page }) => {
  await page.goto('./');
  const audit = async () => {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  };
  await audit();
  await page.getByRole('button', { name: 'Try an example' }).click();
  await page.getByRole('button', { name: 'Analyze script' }).click();
  await expect(page.locator('#status')).toContainText('Analysis complete');
  await audit();
});
