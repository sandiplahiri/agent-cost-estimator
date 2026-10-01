import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import fs from 'node:fs/promises';
import path from 'node:path';

const artifacts = path.resolve('artifacts');
const records: { journey: string; evidence: string; expected: unknown; actual: unknown }[] = [];

test.beforeAll(async () => {
  await fs.mkdir(artifacts, { recursive: true });
});
test.afterAll(async () => {
  await fs.writeFile(
    path.join(artifacts, 'verification.json'),
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        command: 'npm run test:e2e',
        prerequisites: 'npm run build and npm run check completed before this run.',
        fixture: 'Architect-defined Fixture A: $2/M input, $8/M output. Not provider prices.',
        note: 'Workbook formulas independently recalculated with HyperFormula; Excel desktop UI was not automated.',
        checks: records,
      },
      null,
      2,
    ),
  );
});

async function addModel(page: Page, name = 'Fixture A', input = '2', output = '8', cache = '') {
  await page.getByRole('button', { name: 'Model pricing', exact: true }).click();
  await page.getByRole('button', { name: 'Add custom rates' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add custom model rates' });
  await dialog.getByLabel('Custom model ID').fill(name);
  await dialog.getByLabel('input USD / 1M', { exact: true }).fill(input);
  await dialog.getByLabel('output USD / 1M', { exact: true }).fill(output);
  if (cache) await dialog.getByLabel('cache read USD / 1M').fill(cache);
  await dialog.getByRole('button', { name: 'Add model', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function chooseModel(page: Page, locator: ReturnType<Page['getByRole']>, name = 'Fixture A') {
  await locator.click();
  const picker = page.getByRole('dialog', { name: 'Choose a model' });
  await picker.getByLabel('Search models').fill(name);
  await picker.getByRole('button', { name: new RegExp(`^${name} `) }).click();
}

async function setup(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your agent suite, budgeted.' })).toBeVisible();
  await page.getByLabel('Estimate name').fill('Mortgage fixture');
  await addModel(page);
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await chooseModel(page, page.getByRole('button', { name: 'Model: Select model', exact: true }).first());
  await page.getByRole('button', { name: /Suite planner/ }).click();
  await page.getByRole('button', { name: 'Quick setup', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Set up your agent suite' });
  await quick.getByLabel('Total agent count').fill('2');
  await quick.getByLabel('Simple agents', { exact: true }).fill('2');
  await quick.getByLabel('Medium agents', { exact: true }).fill('0');
  await quick.getByLabel('High agents', { exact: true }).fill('0');
  await quick.getByLabel('Simple users per agent per day *').fill('1');
  await quick
    .getByLabel('Simple invocations per user per agent per day *')
    .fill('33.3333333333333333333333333333');
  await quick.getByRole('button', { name: 'Create suite' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  const derived = page.getByLabel('Simple agents total monthly invocations per agent');
  await expect(derived).toHaveText('≈1,000');
  expect(await derived.evaluate((element) => element.tagName)).toBe('OUTPUT');
}

async function recalculateWorkbook(file: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  workbook.eachSheet((sheet) => {
    const grid: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: (string | number | boolean | null)[] = [];
      for (let col = 1; col <= sheet.columnCount; col++) {
        const v = row.getCell(col).value;
        cells.push(
          v && typeof v === 'object' && 'formula' in v
            ? `=${v.formula}`
            : typeof v === 'string'
              ? `'${v}`
              : typeof v === 'number' || typeof v === 'boolean'
                ? v
                : null,
        );
      }
      grid.push(cells);
    });
    sheets[sheet.name] = grid;
  });
  const engine = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  return { workbook, engine, summary: engine.getSheetId('Summary')! };
}

test('Budget, explicit scenarios, save/reopen, Excel formulas, reset and undo', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (e) => browserErrors.push(e.message));
  await setup(page);
  await expect(page.getByTestId('cost-low')).toHaveText('$12.24/mo');
  await expect(page.getByTestId('cost-high')).toHaveText('$24.48/mo');

  await page.getByRole('button', { name: 'Additional costs', exact: true }).click();
  await page.getByRole('button', { name: 'Add cost item' }).click();
  await page.getByLabel('Cost item', { exact: true }).fill('Storage');
  await page.getByLabel('Unit cost (USD)').fill('25');
  await page.getByRole('button', { name: 'Add cost item' }).click();
  await page.getByLabel('Cost item', { exact: true }).nth(1).fill('Setup');
  await page.getByLabel('Unit cost (USD)').nth(1).fill('100');
  await page.getByLabel('Frequency').nth(1).selectOption('one-time');
  await expect(page.locator('.totals-grid')).toContainText('$595.84');
  await expect(page.locator('.totals-grid')).toContainText('$141.32');
  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  await expect(page.locator('.alert.notice')).toContainText('saved on this computer');
  await page.reload();
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Mortgage fixture/ })
    .click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const download = await downloadPromise;
  const file = path.join(artifacts, 'mortgage-budget.xlsx');
  await download.saveAs(file);
  const { engine, summary, workbook } = await recalculateWorkbook(file);
  const llm = [1, 2, 3].map((row) => engine.getCellValue({ sheet: summary, col: 1, row }));
  expect(llm[0]).toBeCloseTo(12.24, 8);
  expect(llm[1]).toBeCloseTo(16.32, 8);
  expect(llm[2]).toBeCloseTo(24.48, 8);
  expect(engine.getCellValue({ sheet: summary, col: 6, row: 2 })).toBeCloseTo(595.84, 8);
  expect(workbook.getWorksheet('Pricing')!.getCell('A2').value).toBe('Fixture A');
  // Editing a documented calculation input must propagate into the customer summary.
  const calc = engine.getSheetId('Calculations')!;
  engine.setCellContents({ sheet: calc, row: 4, col: 8 }, [[4000]]);
  expect(engine.getCellValue({ sheet: summary, row: 2, col: 1 })).toBeCloseTo(24.48, 8);
  records.push({
    journey: 'Suite budget and Excel',
    evidence: file,
    expected: [12.24, 16.32, 24.48, 595.84],
    actual: [...llm, 595.84],
  });
  engine.destroy();

  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  const high = page
    .locator('.scenario-editor-grid article')
    .filter({ has: page.getByRole('heading', { name: 'High', exact: true }) });
  await high.getByLabel('Invocation volume ×').fill('2');
  await expect(page.getByTestId('cost-high')).toHaveText('$48.96/mo');
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');

  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Output tokens / call', { exact: true }).first().fill('1000');
  await expect(page.getByTestId('cost-expected')).toHaveText('$24.48/mo');
  await page.getByRole('button', { name: 'Reset parameters', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset parameters', exact: true }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  await expect(page.getByTestId('cost-high')).toHaveText('$24.48/mo');
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$24.48/mo');
  await expect(page.getByTestId('cost-high')).toHaveText('$73.44/mo');
  await page.getByRole('button', { name: /Suite planner/ }).click();
  await page.screenshot({ path: path.join(artifacts, 'suite-desktop.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
  records.push({
    journey: 'Scenario edits, reset, undo',
    evidence: 'UI plus suite-desktop.png',
    expected: [24.48, 73.44],
    actual: [24.48, 73.44],
  });
});

test('Daily users derive per-agent monthly volume across all complexity groups', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Estimate name').fill('Daily volume fixture');
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await chooseModel(page, page.getByRole('button', { name: 'Model: Select model', exact: true }).first());
  await chooseModel(page, page.getByRole('button', { name: 'Model: Select model', exact: true }).first());
  await page.getByRole('button', { name: /Suite planner/ }).click();
  await page.getByRole('button', { name: 'Quick setup', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Set up your agent suite' });
  await quick.getByLabel('Total agent count').fill('4');
  await quick.getByLabel('Simple agents', { exact: true }).fill('2');
  await quick.getByLabel('Medium agents', { exact: true }).fill('1');
  await quick.getByLabel('High agents', { exact: true }).fill('1');
  await expect(quick.getByRole('button', { name: 'Create suite' })).toBeDisabled();
  for (const [category, users, perUser] of [
    ['Simple', '2', '3'],
    ['Medium', '1', '2'],
    ['High', '4', '0.5'],
  ]) {
    await quick.getByLabel(`${category} users per agent per day *`).fill(users);
    await quick.getByLabel(`${category} invocations per user per agent per day *`).fill(perUser);
  }
  await quick.getByRole('button', { name: 'Create suite' }).click();

  await page.getByLabel('Simple agents users per day').fill('');
  await expect(page.locator('.agent-table tbody tr').first()).toContainText('Incomplete');
  await expect(page.getByTestId('category-invocations-simple')).toHaveText('Incomplete');
  await expect(page.getByTestId('category-tokens-monthly-simple')).toHaveText('Incomplete');
  await expect(page.getByRole('button', { name: 'Save estimate', exact: true })).toBeDisabled();
  const incompleteDraft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  const invalidSave = await page.request.post('/api/estimates', { data: incompleteDraft });
  expect(invalidSave.status()).toBe(422);
  expect((await invalidSave.json()).detail).toContain('required');
  await page.getByLabel('Simple agents users per day').fill('2');

  await expect(page.getByLabel('Simple agents total monthly invocations per agent')).toHaveText('180');
  await expect(page.getByLabel('Simple agents total monthly invocations all agents')).toHaveText('360');
  await expect(page.getByLabel('Medium agents total monthly invocations per agent')).toHaveText('60');
  await expect(page.getByLabel('Medium agents total monthly invocations all agents')).toHaveText('60');
  await expect(page.getByLabel('High agents total monthly invocations per agent')).toHaveText('60');
  await expect(page.getByLabel('High agents total monthly invocations all agents')).toHaveText('60');
  await expect(page.getByTestId('category-invocations-simple')).toHaveText('360');
  await expect(page.getByTestId('category-invocations-medium')).toHaveText('60');
  await expect(page.getByTestId('category-invocations-high')).toHaveText('60');
  const expectedMonthlyTokens = [918000, 1764000, 11220000];
  const expectedDailyTokens = [30600, 58800, 374000];
  for (const [i, complexity] of ['simple', 'medium', 'high'].entries()) {
    await expect(page.getByTestId(`category-tokens-monthly-${complexity}`)).toHaveText(
      expectedMonthlyTokens[i].toLocaleString('en-US'),
    );
    await expect(page.getByTestId(`category-tokens-daily-${complexity}`)).toHaveText(
      expectedDailyTokens[i].toLocaleString('en-US'),
    );
  }
  await expect(page.getByTestId('cost-expected')).toHaveText('$38.34/mo');

  await page.getByLabel('Medium agents invocations per user per agent per day').fill('0');
  await expect(page.getByTestId('cost-expected')).toHaveText('$33.30/mo');
  await expect(page.locator('.agent-table tbody tr').nth(1)).not.toContainText('Incomplete');
  await page.getByLabel('Medium agents invocations per user per agent per day').fill('2');
  await expect(page.getByTestId('cost-expected')).toHaveText('$38.34/mo');

  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Daily volume fixture/ })
    .click();
  await expect(page.getByLabel('High agents total monthly invocations per agent')).toHaveText('60');
  await expect(page.getByTestId('cost-expected')).toHaveText('$38.34/mo');
  await fs.writeFile(
    path.join(artifacts, 'daily-volume-fixture.json'),
    JSON.stringify(
      await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}')),
      null,
      2,
    ),
  );

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const file = path.join(artifacts, 'daily-volume-budget.xlsx');
  await (await download).saveAs(file);
  const { engine, summary, workbook } = await recalculateWorkbook(file);
  const actual = engine.getCellValue({ sheet: summary, col: 1, row: 2 });
  expect(actual).toBeCloseTo(38.3376, 8);
  const calc = engine.getSheetId('Calculations')!;
  const expectedVolumes = [180, 60, 60];
  for (let i = 0; i < 3; i++) {
    expect(engine.getCellValue({ sheet: calc, col: 5, row: 4 + i })).toBe(expectedVolumes[i]);
  }
  const volumeSheet = engine.getSheetId('Volume')!;
  const categorySheet = engine.getSheetId('Category totals')!;
  const usageSheet = engine.getSheetId('Category usage')!;
  expect(engine.getCellValue({ sheet: volumeSheet, col: 9, row: 1 })).toBe(360);
  const expectedCategoryTotals = [360, 60, 60];
  for (let i = 0; i < 3; i++) {
    expect(engine.getCellValue({ sheet: categorySheet, col: 1, row: 1 + i })).toBe(expectedCategoryTotals[i]);
    expect(engine.getCellValue({ sheet: usageSheet, col: 3, row: 1 + i })).toBeCloseTo(
      expectedMonthlyTokens[i],
      6,
    );
    expect(engine.getCellValue({ sheet: usageSheet, col: 4, row: 1 + i })).toBeCloseTo(
      expectedDailyTokens[i],
      6,
    );
  }
  expect(engine.getCellValue({ sheet: usageSheet, col: 1, row: 1 })).toBeCloseTo(734400, 6);
  expect(engine.getCellValue({ sheet: usageSheet, col: 2, row: 1 })).toBeCloseTo(183600, 6);
  expect(workbook.getWorksheet('Agents')!.getCell('L2').value).toBe('daily_users');
  records.push({
    journey: 'Daily volume for simple, medium, and high groups survives save and Excel export',
    evidence: file,
    expected: {
      daysPerMonth: 30,
      perAgentVolumes: expectedVolumes,
      categoryTotals: expectedCategoryTotals,
      monthlyTokens: expectedMonthlyTokens,
      dailyTokens: expectedDailyTokens,
      monthlyUsd: 38.3376,
    },
    actual: {
      perAgentVolumes: expectedVolumes.map((_, i) =>
        engine.getCellValue({ sheet: calc, col: 5, row: 4 + i }),
      ),
      categoryTotals: expectedCategoryTotals.map((_, i) =>
        engine.getCellValue({ sheet: categorySheet, col: 1, row: 1 + i }),
      ),
      monthlyTokens: expectedMonthlyTokens.map((_, i) =>
        engine.getCellValue({ sheet: usageSheet, col: 3, row: 1 + i }),
      ),
      dailyTokens: expectedDailyTokens.map((_, i) =>
        engine.getCellValue({ sheet: usageSheet, col: 4, row: 1 + i }),
      ),
      monthlyUsd: actual,
    },
  });
  engine.destroy();

  await page.getByLabel('Import agent spreadsheet').setInputFiles(file);
  const preview = page.getByRole('dialog', { name: 'Review spreadsheet import' });
  await expect(preview).toContainText('2 users/day × 3 invocations/user/agent/day × 30 days');
  await preview.getByRole('button', { name: 'Replace inventory' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$38.34/mo');

  const inputFile = path.join(artifacts, 'daily-volume-import.xlsx');
  const inputWorkbook = new ExcelJS.Workbook();
  const agents = inputWorkbook.addWorksheet('Agents');
  agents.addRow([
    'name',
    'complexity',
    'count',
    'volume_source',
    'users_per_day',
    'invocations_per_user_per_agent_per_day',
  ]);
  agents.addRow(['Imported daily', 'simple', 1, 'daily_users', 2, 3]);
  await inputWorkbook.xlsx.writeFile(inputFile);
  await page.getByLabel('Import agent spreadsheet').setInputFiles(inputFile);
  const dailyPreview = page.getByRole('dialog', { name: 'Review spreadsheet import' });
  await dailyPreview.getByRole('button', { name: 'Replace inventory' }).click();
  await expect(page.getByLabel('Imported daily total monthly invocations per agent')).toHaveText('180');
  await expect(page.getByTestId('cost-expected')).toHaveText('$1.47/mo');
  const importedSnapshot = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  const importedResult = await (await page.request.post('/api/calculate', { data: importedSnapshot })).json();
  const importedUsd = Number(
    importedResult.scenarios.find((s: { name: string }) => s.name === 'Expected').llm_cost,
  );
  expect(importedUsd).toBeCloseTo(1.4688, 8);
  records.push({
    journey: 'Daily spreadsheet import without manual fallback',
    evidence: inputFile,
    expected: { monthlyInvocationsPerAgent: 180, monthlyUsd: 1.4688, manualFallback: 0 },
    actual: {
      monthlyInvocationsPerAgent: 180,
      monthlyUsd: importedUsd,
      manualFallback: Number(importedSnapshot.agents[0].invocations),
    },
  });

  await page.getByRole('button', { name: 'Add group' }).click();
  const editor = page.getByRole('dialog', { name: 'Configure agent group' });
  await editor.getByLabel('Agent / group name').fill('Another simple group');
  await editor.getByLabel('Users per agent per day *').fill('1');
  await editor.getByLabel('Invocations per user per agent per day *').fill('1');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByLabel('Another simple group total monthly invocations all agents')).toHaveText('30');
  await expect(page.getByTestId('category-invocations-simple')).toHaveText('210');
  await expect(page.getByTestId('cost-expected')).toHaveText('$1.71/mo');
  await page.getByLabel('Another simple group count').fill('2');
  await expect(page.getByLabel('Another simple group total monthly invocations all agents')).toHaveText('60');
  await expect(page.getByTestId('category-invocations-simple')).toHaveText('240');
  await expect(page.getByTestId('cost-expected')).toHaveText('$1.96/mo');
  const groupedSnapshot = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  const groupedResult = await (await page.request.post('/api/calculate', { data: groupedSnapshot })).json();
  const groupedUsd = Number(
    groupedResult.scenarios.find((s: { name: string }) => s.name === 'Expected').llm_cost,
  );
  expect(groupedUsd).toBeCloseTo(1.9584, 8);
  records.push({
    journey: 'Category total sums multiple simple groups and updates with agent count',
    evidence: inputFile,
    expected: { categoryInvocations: 240, monthlyUsd: 1.9584 },
    actual: {
      categoryInvocations: Number(groupedResult.category_invocations.simple.total),
      monthlyUsd: groupedUsd,
    },
  });
});

test('Individual overrides, zero output, detailed replacement and incomplete prices', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Edit Simple agents', exact: true }).click();
  await page.getByRole('button', { name: 'Customize one agent', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Configure agent group' });
  await editor.getByLabel('Output tokens / call', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$12.24/mo');
  await expect(page.locator('.count-chip')).toHaveText('2 agents');

  await page.getByRole('button', { name: 'Edit Simple agents', exact: true }).click();
  await page.getByRole('button', { name: 'Use detailed workflow' }).click();
  await editor.getByLabel('Model calls / invocation', { exact: true }).fill('2');
  await editor.getByLabel('Input tokens / call', { exact: true }).fill('1000');
  await editor.getByLabel('Output tokens / call', { exact: true }).fill('250');
  await editor.getByLabel('Additional attempt rate', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$12.08/mo');
  records.push({
    journey: 'Split + zero override + detailed replacement',
    evidence: 'Browser interactions',
    expected: 12.08,
    actual: 12.08,
  });

  await page.getByRole('button', { name: 'Edit Simple agents · individual', exact: true }).click();
  await editor.getByLabel('Cached read fraction', { exact: true }).fill('0.5');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('.scenario-card.featured')).toContainText('Incomplete');
  await expect(page.getByTestId('cost-expected')).toHaveText('$8.00/mo');
  await expect(page.locator('.count-chip')).toHaveText('2 agents');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Export Excel', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'suite-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Spreadsheet import, literal text export, invalid import recovery and unpriced models', async ({
  page,
}) => {
  await setup(page);
  const fixture = new ExcelJS.Workbook();
  const sheet = fixture.addWorksheet('Agents');
  sheet.addRow([
    'name',
    'complexity',
    'count',
    'invocations',
    'model_id',
    'calls',
    'input_tokens',
    'output_tokens',
    'retry_rate',
  ]);
  sheet.addRow(['=literal agent name', 'simple', 2, 1000, 'Fixture A', 1, 2000, 500, 0.02]);
  const valid = path.join(artifacts, 'agent-import.xlsx');
  await fixture.xlsx.writeFile(valid);
  await page.getByLabel('Import agent spreadsheet').setInputFiles(valid);
  await expect(page.getByRole('dialog', { name: 'Review spreadsheet import' })).toContainText('2 agents');
  await page.getByRole('button', { name: 'Replace inventory' }).click();
  await expect(page.getByRole('button', { name: '=literal agent name', exact: true })).toBeVisible();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const exported = path.join(artifacts, 'literal-text-budget.xlsx');
  await (await downloaded).saveAs(exported);
  const safe = new ExcelJS.Workbook();
  await safe.xlsx.readFile(exported);
  expect(safe.getWorksheet('Calculations')!.getCell('B2').value).toBe('=literal agent name');

  sheet.getCell('F2').value = { formula: '1+1' };
  const invalid = path.join(artifacts, 'invalid-import.xlsx');
  await fixture.xlsx.writeFile(invalid);
  await page.getByLabel('Import agent spreadsheet').setInputFiles(invalid);
  await expect(page.getByRole('dialog', { name: 'Review spreadsheet import' })).toContainText(
    'formulas are not allowed',
  );
  await expect(page.getByRole('button', { name: 'Replace inventory' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Cached read fraction', { exact: true }).first().fill('0.8');
  await page.getByRole('button', { name: /Suite planner/ }).click();
  sheet.getCell('F2').value = 1;
  const cacheFixture = new ExcelJS.Workbook();
  const cacheSheet = cacheFixture.addWorksheet('Agents');
  cacheSheet.addRow([...sheet.getRow(1).values.slice(1), 'cache_write_fraction']);
  cacheSheet.addRow([...sheet.getRow(2).values.slice(1), 0.3]);
  const invalidCombination = path.join(artifacts, 'invalid-cache-import.xlsx');
  await cacheFixture.xlsx.writeFile(invalidCombination);
  await page.getByLabel('Import agent spreadsheet').setInputFiles(invalidCombination);
  const cachePreview = page.getByRole('dialog', { name: 'Review spreadsheet import' });
  await expect(cachePreview).toContainText('Row 2, cache_fraction/cache_write_fraction');
  await expect(cachePreview.getByRole('button', { name: 'Replace inventory' })).toBeDisabled();
  await cachePreview.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Cached read fraction', { exact: true }).first().fill('0');
  await page.getByRole('button', { name: /Suite planner/ }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  sheet.getCell('E2').value = 'unknown/provider-model';
  const unknown = path.join(artifacts, 'unpriced-import.xlsx');
  await fixture.xlsx.writeFile(unknown);
  await page.getByLabel('Import agent spreadsheet').setInputFiles(unknown);
  await page.getByRole('button', { name: 'Replace inventory' }).click();
  await expect(page.locator('.scenario-card.featured')).toContainText('Incomplete');
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  records.push({
    journey: 'Spreadsheet import and recovery',
    evidence: 'agent-import.xlsx, invalid-import.xlsx, invalid-cache-import.xlsx, literal-text-budget.xlsx',
    expected:
      'No partial mutation; names remain text; invalid merged cache fractions identified at row 2; unpriced rows flagged',
    actual: 'Verified through browser and exported workbook',
  });
  sheet.getCell('E2').value = 'Fixture A';
  sheet.getCell('C2').value = 300;
  sheet.getCell('D2').value = 100;
  const large = path.join(artifacts, '300-agents-import.xlsx');
  await fixture.xlsx.writeFile(large);
  await page.getByLabel('Import agent spreadsheet').setInputFiles(large);
  await page.getByRole('button', { name: 'Replace inventory' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$244.80/mo');
  await expect(page.locator('.count-chip')).toHaveText('300 agents');
  records.push({
    journey: 'Hundreds of agents',
    evidence: '300-agents-import.xlsx',
    expected: 244.8,
    actual: 244.8,
  });
});

test('Request-level tiers and cache partitions reconcile in the app and workbook', async ({
  page,
  request,
}) => {
  // Seed a saved architecture through the real API; all pricing is a frozen synthetic fixture.
  const baseResponse = await request.get('/api/new');
  const fixture = await baseResponse.json();
  fixture.name = 'Tier and cache fixture';
  fixture.prices['Tier Fixture'] = {
    id: 'Tier Fixture',
    provider: 'Synthetic provider',
    input: '2',
    output: '8',
    cache_read: '0.5',
    cache_write: '3',
    tiers: [{ above: '200000', input: '4', output: '12', cache_read: '1', cache_write: '6' }],
    max_input: null,
    max_output: null,
    source: 'Fixed E2E fixture; not provider prices',
    retrieved_at: '2026-01-01T00:00:00Z',
    custom: true,
    unsupported: [],
  };
  fixture.profiles.simple = {
    calls: '1',
    input_tokens: '200000',
    output_tokens: '1000',
    retry_rate: '0',
    cache_fraction: '0.25',
    cache_write_fraction: '0.25',
    model_id: 'Tier Fixture',
  };
  fixture.agents = [
    {
      id: 'tier-agent',
      name: 'Tiered agent',
      complexity: 'simple',
      count: 1,
      invocations: '10',
      overrides: {},
      steps: [],
    },
  ];
  expect((await request.post('/api/estimates', { data: fixture })).ok()).toBe(true);
  await fs.writeFile(path.join(artifacts, 'tier-cache-fixture.json'), JSON.stringify(fixture, null, 2));
  await page.goto('/');
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Tier and cache fixture/ })
    .click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$3.83/mo');
  await expect(page.getByTestId('cost-low')).toHaveText('$2.87/mo');
  await expect(page.getByTestId('cost-high')).toHaveText('$11.43/mo');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const exported = path.join(artifacts, 'tier-cache-budget.xlsx');
  await (await download).saveAs(exported);
  const { engine, summary } = await recalculateWorkbook(exported);
  const actual = [1, 2, 3].map((row) => engine.getCellValue({ sheet: summary, col: 1, row }));
  expect(actual[0]).toBeCloseTo(2.8725, 8);
  expect(actual[1]).toBeCloseTo(3.83, 8);
  expect(actual[2]).toBeCloseTo(11.43, 8);
  engine.destroy();
  records.push({
    journey: 'Per-call context tiers + cache reads/writes',
    evidence: exported,
    expected: [2.8725, 3.83, 11.43],
    actual,
  });
  await page.getByRole('button', { name: 'Edit Tiered agent', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Configure agent group' });
  await editor.getByLabel('Cached read fraction', { exact: true }).fill('0.9');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor.getByRole('alert')).toContainText('cannot exceed 100%');
  await expect(page.getByTestId('cost-expected')).toHaveText('$3.83/mo');
  await editor.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  const expected = page
    .locator('.scenario-editor-grid article')
    .filter({ has: page.getByRole('heading', { name: 'Expected', exact: true }) });
  await expected.getByLabel('Invocation volume ×').fill('-1');
  await expect(page.getByRole('alert')).toContainText('greater than or equal to 0');
  await expect(page.getByRole('button', { name: 'Export Excel', exact: true })).toBeDisabled();
  await expected.getByLabel('Invocation volume ×').fill('1');
  await expect(page.getByTestId('cost-expected')).toHaveText('$3.83/mo');
});

test('Edits made during save and catalog refresh remain in the draft', async ({ page, request }) => {
  await setup(page);
  const notes = page.getByLabel('Customer assumptions & notes');
  await notes.fill('Before save');
  let releaseSave!: () => void;
  let saveIntercepted!: () => void;
  const saveGate = new Promise<void>((resolve) => (releaseSave = resolve));
  const saveSeen = new Promise<void>((resolve) => (saveIntercepted = resolve));
  await page.route('**/api/estimates', async (route) => {
    if (route.request().method() === 'POST') {
      saveIntercepted();
      await saveGate;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  await saveSeen;
  await notes.fill('Edited while saving');
  releaseSave();
  await expect(page.locator('.save-status')).toContainText('Browser draft');
  await expect(page.locator('.alert.notice')).toContainText('recent edits still need to be saved');
  const saved = await (await request.get('/api/estimates')).json();
  const stored = await (await request.get(`/api/estimates/${saved[0].id}`)).json();
  expect(stored.notes).toBe('Before save');
  await page.unroute('**/api/estimates');

  let releaseRefresh!: () => void;
  let refreshIntercepted!: () => void;
  const refreshGate = new Promise<void>((resolve) => (releaseRefresh = resolve));
  const refreshSeen = new Promise<void>((resolve) => (refreshIntercepted = resolve));
  await page.route('**/api/catalog/refresh', async (route) => {
    refreshIntercepted();
    await refreshGate;
    await route.fulfill({
      json: {
        prices: {},
        retrieved_at: '2026-01-01T00:00:00Z',
        source: 'Fixed E2E refresh fixture',
        skipped: 0,
        scope: 'Text token pricing',
      },
    });
  });
  await page.getByRole('button', { name: 'Model pricing', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh catalog' }).click();
  await refreshSeen;
  await notes.fill('Edited while refreshing');
  releaseRefresh();
  const preview = page.getByRole('dialog', { name: 'Review refreshed pricing' });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Apply refreshed prices' }).click();
  await expect(notes).toHaveValue('Edited while refreshing');
  await expect(page.locator('.save-status')).toContainText('Browser draft');
  records.push({
    journey: 'Concurrent draft edits during save and refresh',
    evidence: 'Browser interactions and saved estimate API',
    expected: ['Before save', 'Edited while refreshing', 'Browser draft'],
    actual: [stored.notes, await notes.inputValue(), await page.locator('.save-status').innerText()],
  });
});

test('Bundled cache-hit pricing is used in the browser and exported workbook', async ({ page, request }) => {
  const catalog = await (await request.get('/api/catalog')).json();
  const model = catalog.prices['deepseek/deepseek-coder'];
  expect(Number(model.input)).toBeCloseTo(0.14, 8);
  expect(Number(model.output)).toBeCloseTo(0.28, 8);
  expect(Number(model.cache_read)).toBeCloseTo(0.014, 8);
  await setup(page);
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await chooseModel(
    page,
    page.getByRole('button', { name: 'Model: Fixture A', exact: true }).first(),
    'deepseek/deepseek-coder',
  );
  await page.getByLabel('Cached read fraction', { exact: true }).first().fill('0.5');
  await expect(page.getByTestId('cost-expected')).toHaveText('$0.60/mo');
  await expect(page.locator('.scenario-card.featured')).not.toContainText('Incomplete');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const exported = path.join(artifacts, 'cache-hit-budget.xlsx');
  await (await download).saveAs(exported);
  const { engine, summary } = await recalculateWorkbook(exported);
  const actual = engine.getCellValue({ sheet: summary, col: 1, row: 2 });
  expect(actual).toBeCloseTo(0.59976, 8);
  engine.destroy();
  records.push({
    journey: 'Bundled cache-hit price fallback',
    evidence: exported,
    expected: 0.59976,
    actual,
  });
});

test('Gemini cache-write gap identifies the missing rate and recovers when unused', async ({
  page,
  request,
}) => {
  const modelId = 'gemini/gemini-3.8-flash';
  const catalog = await (await request.get('/api/catalog')).json();
  const price = catalog.prices[modelId];
  expect(price.input).toBe('0.75000000');
  expect(price.output).toBe('3.75000000');
  expect(price.cache_read).toBe('0.075000000');
  expect(price.cache_write).toBeNull();

  await page.goto('/');
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByRole('button', { name: 'Model: Select model', exact: true }).first().click();
  const picker = page.getByRole('dialog', { name: 'Choose a model' });
  await picker.getByLabel('Search models').fill(modelId);
  await picker.getByText(modelId, { exact: true }).click();
  await page.getByRole('button', { name: /Suite planner/ }).click();
  await page.getByRole('button', { name: 'Quick setup', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Set up your agent suite' });
  await quick.getByLabel('Total agent count').fill('1');
  await quick.getByLabel('Simple agents', { exact: true }).fill('1');
  await quick.getByLabel('Medium agents', { exact: true }).fill('0');
  await quick.getByLabel('High agents', { exact: true }).fill('0');
  await quick.getByLabel('Simple users per agent per day *').fill('1');
  await quick
    .getByLabel('Simple invocations per user per agent per day *')
    .fill('33.3333333333333333333333333333');
  await quick.getByRole('button', { name: 'Create suite' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$3.44/mo');

  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Cached read fraction', { exact: true }).first().fill('0.5');
  await expect(page.getByTestId('cost-expected')).toHaveText('$2.75/mo');
  await page.getByLabel('Cache write fraction', { exact: true }).first().fill('0.25');
  await expect(page.getByTestId('cost-expected')).toContainText('Incomplete');
  await expect(page.getByRole('alert')).toContainText('Missing cache write price');
  await page.getByRole('button', { name: 'Model pricing', exact: true }).click();
  const pricingRow = page.getByRole('row').filter({ hasText: modelId }).first();
  await expect(pricingRow).toContainText('Unavailable');
  await expect(pricingRow).toContainText('$0.075');

  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Cache write fraction', { exact: true }).first().fill('0');
  await expect(page.getByTestId('cost-expected')).toHaveText('$2.75/mo');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const snapshot = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  const calculated = await (await request.post('/api/calculate', { data: snapshot })).json();
  const expected = calculated.scenarios.find((s: { name: string }) => s.name === 'Expected');
  expect(Number(expected.llm_cost)).toBeCloseTo(2.754, 10);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const file = path.join(artifacts, 'gemini-cache-budget.xlsx');
  await (await download).saveAs(file);
  const { engine, summary } = await recalculateWorkbook(file);
  const workbookTotal = engine.getCellValue({ sheet: summary, col: 1, row: 2 });
  expect(workbookTotal).toBeCloseTo(2.754, 10);
  engine.destroy();
  records.push({
    journey: 'Gemini cached-read pricing and missing cache-write recovery',
    evidence: file,
    expected: { noCache: 3.4425, cachedRead: 2.754, missingCacheWrite: 'Incomplete' },
    actual: { cachedRead: Number(expected.llm_cost), workbook: workbookTotal },
  });
});

test('Typing into prefilled numeric fields replaces their values', async ({ page, request }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Quick setup', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Set up your agent suite' });
  const totalCount = quick.getByLabel('Total agent count');
  await totalCount.click();
  await page.keyboard.type('3');
  await expect(totalCount).toHaveValue('3');
  const enteredCount = await totalCount.inputValue();
  await quick.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  const inputTokens = page.getByLabel('Input tokens / call', { exact: true }).first();
  await inputTokens.click();
  await page.keyboard.type('3000');
  await expect(inputTokens).toHaveValue('3000');
  await expect(page.getByTestId('cost-expected')).toHaveText('$20.40/mo');
  const enteredTokens = await inputTokens.inputValue();

  await page.getByRole('button', { name: /Suite planner/ }).click();
  await page.getByLabel('Simple agents invocations per user per agent per day').fill('1');
  const users = page.getByLabel('Simple agents users per day');
  await users.click();
  await page.keyboard.type('25');
  await expect(users).toHaveValue('25');
  await expect(page.getByLabel('Simple agents total monthly invocations per agent')).toHaveText('750');
  await expect(page.getByTestId('cost-expected')).toHaveText('$15.30/mo');
  const enteredUsers = await users.inputValue();

  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  const expected = page
    .locator('.scenario-editor-grid article')
    .filter({ has: page.getByRole('heading', { name: 'Expected', exact: true }) });
  const volume = expected.getByLabel('Invocation volume ×');
  await volume.focus();
  await page.keyboard.type('0.5');
  await expect(volume).toHaveValue('0.5');
  await expect(page.getByTestId('cost-expected')).toHaveText('$7.65/mo');
  const snapshot = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  const calculated = await (await request.post('/api/calculate', { data: snapshot })).json();
  const monthlyUsd = Number(
    calculated.scenarios.find((s: { name: string }) => s.name === 'Expected').llm_cost,
  );
  expect(monthlyUsd).toBeCloseTo(7.65, 10);
  await page.screenshot({ path: path.join(artifacts, 'numeric-replacement.png'), fullPage: true });
  records.push({
    journey: 'Replace prefilled numeric values with mouse and keyboard focus',
    evidence: 'artifacts/numeric-replacement.png',
    expected: {
      totalCount: 3,
      inputTokens: 3000,
      usersPerDay: 25,
      invocationsPerAgentPerMonth: 750,
      volumeFactor: 0.5,
      monthlyUsd: 7.65,
    },
    actual: {
      totalCount: Number(enteredCount),
      inputTokens: Number(enteredTokens),
      usersPerDay: Number(enteredUsers),
      invocationsPerAgentPerMonth: 750,
      volumeFactor: Number(await volume.inputValue()),
      monthlyUsd,
      displayedMonthlyUsd: await page.getByTestId('cost-expected').innerText(),
    },
  });
});
