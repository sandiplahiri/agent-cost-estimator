import { openAgentEditor } from './agent-editing';
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import fs from 'node:fs/promises';
import path from 'node:path';

test('global custom category is assignable and reconciles through save, import and Excel', async ({
  page,
  request,
}) => {
  const directory = path.resolve('artifacts/custom-categories');
  await fs.mkdir(directory, { recursive: true });
  await page.goto('/');
  await page.getByLabel('Estimate name').fill('Custom category fixture');

  await page.getByRole('button', { name: 'Model pricing', exact: true }).click();
  await page.getByRole('button', { name: 'Add custom rates' }).click();
  const rateDialog = page.getByRole('dialog', { name: 'Add custom model rates' });
  await rateDialog.getByLabel('Custom model ID').fill('Category Fixture');
  await rateDialog.getByLabel('input USD / 1M', { exact: true }).fill('2');
  await rateDialog.getByLabel('output USD / 1M', { exact: true }).fill('8');
  await rateDialog.getByRole('button', { name: 'Add model', exact: true }).click();

  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Additional attempt rate', { exact: true }).first().fill('0');
  await expect(page.locator('.profile-card').getByRole('button', { name: /^Model:/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add custom category' }).click();
  const categoryDialog = page.getByRole('dialog', { name: 'Add custom complexity category' });
  await categoryDialog.getByLabel('Custom category name').fill('Research intensive');
  await categoryDialog.getByLabel('Model calls / invocation').fill('2');
  await categoryDialog.getByLabel('Input tokens / call').fill('1000');
  await categoryDialog.getByLabel('Output tokens / call').fill('500');
  await expect(categoryDialog.getByRole('button', { name: /^Model:/ })).toHaveCount(0);
  await categoryDialog.getByRole('button', { name: 'Create category' }).click();
  await expect(categoryDialog).not.toBeVisible();
  await expect(page.locator('.profile-card')).toHaveCount(4);
  await expect(page.locator('.profile-card').getByRole('button', { name: /^Model:/ })).toHaveCount(0);
  const globalCategories = await (await request.get('/api/categories')).json();
  expect(
    globalCategories.find((category: { name: string }) => category.name === 'Research intensive').profile,
  ).not.toHaveProperty('model_id');

  const duplicate = await request.post('/api/categories', {
    data: {
      name: ' RESEARCH INTENSIVE ',
      profile: {
        calls: '1',
        input_tokens: '1000',
        output_tokens: '500',
        retry_rate: '0',
        cache_fraction: '0',
        cache_write_fraction: '0',
        model_id: 'Category Fixture',
      },
    },
  });
  expect(duplicate.status()).toBe(422);
  const reserved = await request.post('/api/categories', {
    data: {
      name: 'SIMPLE',
      profile: {
        calls: '1',
        input_tokens: '1000',
        output_tokens: '500',
        retry_rate: '0',
        cache_fraction: '0',
        cache_write_fraction: '0',
        model_id: 'Category Fixture',
      },
    },
  });
  expect(reserved.status()).toBe(422);

  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page
    .getByRole('region', { name: 'Agent inventory', exact: true })
    .getByRole('button', { name: 'Bulk add', exact: true })
    .click();
  const quick = page.getByRole('dialog', { name: 'Set up your agent suite' });
  await quick.getByLabel('Total agent count').fill('2');
  await quick.getByLabel('Simple agents', { exact: true }).fill('2');
  await quick.getByLabel('Medium agents', { exact: true }).fill('0');
  await quick.getByLabel('High agents', { exact: true }).fill('0');
  await quick.getByLabel('Simple users per agent per day *').fill('1');
  await quick.getByLabel('Simple invocations per user per agent per day *').fill('1');
  await quick.getByRole('button', { name: 'Create suite' }).click();
  await openAgentEditor(page, 'Simple agents');
  const modelEditor = page.getByRole('dialog', { name: 'Edit agent' });
  await modelEditor.getByRole('button', { name: 'Model: Select model' }).click();
  await page
    .getByRole('dialog', { name: 'Choose a model' })
    .getByRole('button', { name: /^Category Fixture / })
    .click();
  await modelEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$0.48/mo');

  await openAgentEditor(page, 'Simple agents');
  await page
    .getByRole('dialog', { name: 'Edit agent' })
    .getByRole('button', { name: 'Customize one agent' })
    .click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await expect(editor.getByLabel('Agent name')).toHaveValue('Simple agent 2');
  await editor.getByLabel('Complexity').selectOption('Research intensive');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$0.60/mo');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const monthlySummary = page.getByRole('region', { name: 'Monthly token and cost summary' });
  await expect(monthlySummary.locator('tbody tr')).toHaveCount(3);
  await expect(monthlySummary.getByTestId('monthly-summary-expected-total-tokens')).toHaveText('165,000');
  await expect(monthlySummary.getByTestId('monthly-summary-expected-total-cost')).toHaveText('$0.60');
  const dashboardSuiteUsd = Number(
    (await monthlySummary.getByTestId('monthly-summary-expected-total-cost').innerText()).replace(
      /[^\d.]/g,
      '',
    ),
  );

  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  const savedList = await (await request.get('/api/estimates')).json();
  const savedId = savedList.find((item: { name: string }) => item.name === 'Custom category fixture').id;
  const fixture = await (await request.get(`/api/estimates/${savedId}`)).json();
  await fs.writeFile(path.join(directory, 'estimate-fixture.json'), JSON.stringify(fixture, null, 2));
  expect(fixture.schema_version).toBe(8);
  expect(
    Object.values(fixture.profiles).every((profile) => !Object.hasOwn(profile as object, 'model_id')),
  ).toBe(true);
  expect(fixture.profiles['Research intensive'].calls).toBe('2');
  expect(
    fixture.agents.filter((row: { complexity: string }) => row.complexity === 'Research intensive'),
  ).toHaveLength(1);
  const missingCategory = structuredClone(fixture);
  missingCategory.agents.find(
    (row: { complexity: string }) => row.complexity === 'Research intensive',
  ).complexity = 'Not defined';
  const invalidAssignment = await request.post('/api/calculate', { data: missingCategory });
  expect(invalidAssignment.status()).toBe(422);
  expect(await invalidAssignment.text()).toContain('add the Not defined category');

  await page.getByRole('button', { name: 'New estimate' }).click();
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await expect(page.locator('.profile-card')).toHaveCount(4);
  const fresh = await (await request.get('/api/new')).json();
  expect(fresh.profiles['Research intensive'].calls).toBe('2');
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Custom category fixture/ })
    .click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$0.60/mo');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const workbookFile = path.join(directory, 'custom-category-budget.xlsx');
  await (await downloadPromise).saveAs(workbookFile);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookFile);
  const grid: Record<string, (string | number | boolean | null)[][]> = {};
  workbook.eachSheet((sheet) => {
    const rows: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values: (string | number | boolean | null)[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const value = row.getCell(column).value;
        values.push(
          value && typeof value === 'object' && 'formula' in value
            ? `=${value.formula}`
            : typeof value === 'string'
              ? `'${value}`
              : typeof value === 'number' || typeof value === 'boolean'
                ? value
                : null,
        );
      }
      rows.push(values);
    });
    grid[sheet.name] = rows;
  });
  const engine = HyperFormula.buildFromSheets(grid, { licenseKey: 'gpl-v3' });
  const monthly = engine.getSheetId('Monthly category summary')!;
  const summary = engine.getSheetId('Summary')!;
  const workbookCustom = engine.getCellValue({ sheet: monthly, row: 4, col: 6 });
  const workbookSuite = engine.getCellValue({ sheet: monthly, row: 5, col: 6 });
  expect(workbookCustom).toBeCloseTo(0.36, 8);
  expect(workbookSuite).toBeCloseTo(0.6, 8);
  const actualSimple = engine.getCellValue({ sheet: monthly, row: 1, col: 6 });
  const actualCustom = workbookCustom;
  const actualTokens = engine.getCellValue({ sheet: monthly, row: 4, col: 5 });
  expect(actualSimple).toBeCloseTo(0.24, 8);
  expect(actualTokens).toBeCloseTo(90000, 8);
  expect(engine.getCellValue({ sheet: summary, row: 2, col: 1 })).toBeCloseTo(0.6, 8);
  engine.destroy();
  expect(workbook.getWorksheet('Profiles')!.getColumn(1).values).toContain('Research intensive');

  const importPreview = await request.post('/api/import/preview', {
    headers: { 'Content-Type': 'application/octet-stream' },
    data: await fs.readFile(workbookFile),
  });
  expect(importPreview.ok(), await importPreview.text()).toBe(true);
  const imported = await importPreview.json();
  expect(imported.errors).toEqual([]);
  expect(imported.agents.some((row: { complexity: string }) => row.complexity === 'Research intensive')).toBe(
    true,
  );

  const olderEstimate = {
    ...fresh,
    id: `older-category-${Date.now()}`,
    name: 'Older category fixture',
    profiles: {
      simple: fresh.profiles.simple,
      medium: fresh.profiles.medium,
      high: fresh.profiles.high,
    },
  };
  expect((await request.post('/api/estimates', { data: olderEstimate })).ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Older category fixture/ })
    .click();
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await expect(page.locator('.profile-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Use Research intensive' }).click();
  await expect(page.locator('.profile-card')).toHaveCount(4);
  const olderCustomProfile = page.locator('.profile-card').filter({ hasText: 'Research intensive' });
  await olderCustomProfile.getByLabel('Model calls / invocation').fill('3');
  await page.getByRole('button', { name: 'Reset parameters' }).click();
  await page
    .getByRole('dialog', { name: 'Reset execution parameters' })
    .getByRole('button', { name: 'Reset parameters' })
    .click();
  await expect(olderCustomProfile.getByLabel('Model calls / invocation')).toHaveValue('2');
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(olderCustomProfile.getByLabel('Model calls / invocation')).toHaveValue('3');

  await fs.writeFile(
    path.join(directory, 'run-report.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/custom-categories.spec.ts',
        fixture:
          'Fixed custom model USD 2/M input and USD 8/M output; 30 invocations/agent/month; no retries or cache',
        expected: {
          simpleUsd: 0.24,
          customUsd: 0.36,
          suiteUsd: 0.6,
          dashboardSuiteUsd: 0.6,
          customTokens: 90000,
        },
        actual: {
          simpleUsd: actualSimple,
          customUsd: actualCustom,
          suiteUsd: workbookSuite,
          dashboardSuiteUsd,
          customTokens: actualTokens,
        },
        duplicateNamesRejected: true,
        missingCategoryRejected: true,
        olderEstimateOptedIn: true,
        resetAndUndoVerified: true,
        savedSnapshotReopened: true,
        workbookRecalculated: true,
        importPreviewAccepted: true,
        profileModelControlAbsent: true,
        profilesContainNoModel: true,
        failures: [],
      },
      null,
      2,
    ),
  );
});
