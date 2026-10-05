import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import fs from 'node:fs/promises';
import path from 'node:path';

test('custom category deletion is blocked by draft and saved agents, then removes only unused starters', async ({
  page,
  request,
}) => {
  const directory = path.resolve('artifacts/category-deletion');
  await fs.mkdir(directory, { recursive: true });
  await page.goto('/');
  await page.getByLabel('Estimate name').fill('Category deletion fixture');

  await page.getByRole('button', { name: 'Model pricing', exact: true }).click();
  await page.getByRole('button', { name: 'Add custom rates' }).click();
  const rateDialog = page.getByRole('dialog', { name: 'Add custom model rates' });
  await rateDialog.getByLabel('Custom model ID').fill('Deletion Fixture');
  await rateDialog.getByLabel('input USD / 1M', { exact: true }).fill('2');
  await rateDialog.getByLabel('output USD / 1M', { exact: true }).fill('8');
  await rateDialog.getByRole('button', { name: 'Add model', exact: true }).click();

  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Additional attempt rate', { exact: true }).first().fill('0');
  await expect(page.locator('.profile-card').getByRole('button', { name: /^Model:/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add custom category' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add custom complexity category' });
  await addDialog.getByLabel('Custom category name').fill('Archive heavy');
  await addDialog.getByLabel('Model calls / invocation').fill('2');
  await addDialog.getByLabel('Input tokens / call').fill('1000');
  await addDialog.getByLabel('Output tokens / call').fill('500');
  await addDialog.getByRole('button', { name: 'Create category' }).click();
  await expect(page.locator('.profile-card')).toHaveCount(4);

  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Quick setup', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Set up your agent suite' });
  await quick.getByLabel('Total agent count').fill('1');
  await quick.getByLabel('Simple agents', { exact: true }).fill('1');
  await quick.getByLabel('Medium agents', { exact: true }).fill('0');
  await quick.getByLabel('High agents', { exact: true }).fill('0');
  await quick.getByLabel('Simple users per agent per day *').fill('1');
  await quick.getByLabel('Simple invocations per user per agent per day *').fill('1');
  await quick.getByRole('button', { name: 'Create suite' }).click();
  await page
    .getByRole('region', { name: 'Agent setup' })
    .getByRole('button', { name: 'Edit Simple agents' })
    .click();
  const modelEditor = page.getByRole('dialog', { name: 'Edit agent' });
  await modelEditor.getByRole('button', { name: 'Model: Select model' }).click();
  await page
    .getByRole('dialog', { name: 'Choose a model' })
    .getByRole('button', { name: /^Deletion Fixture / })
    .click();
  await modelEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$0.24/mo');
  await page
    .getByRole('region', { name: 'Agent setup' })
    .getByRole('button', { name: 'Edit Simple agents' })
    .click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await editor.getByLabel('Complexity').selectOption('Archive heavy');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$0.36/mo');

  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Archive heavy' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete Archive heavy' });
  await expect(deleteDialog).toContainText('Simple agents (1)');
  await expect(deleteDialog.getByRole('button', { name: 'Delete category' })).toBeDisabled();
  const unsavedDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!));
  const draftDeletion = await request.post('/api/categories/delete', {
    data: { name: 'Archive heavy', estimate: unsavedDraft },
  });
  expect(draftDeletion.status()).toBe(409);
  expect(await draftDeletion.text()).toContain('current draft: Simple agents');
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await request.get('/api/categories')).ok()).toBe(true);

  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  const savedList = await (await request.get('/api/estimates')).json();
  const savedId = savedList.find((item: { name: string }) => item.name === 'Category deletion fixture').id;
  const usedSnapshot = await (await request.get(`/api/estimates/${savedId}`)).json();
  await fs.writeFile(
    path.join(directory, 'used-category-fixture.json'),
    JSON.stringify(usedSnapshot, null, 2),
  );

  await page.getByRole('button', { name: 'New estimate' }).click();
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Archive heavy' }).click();
  await deleteDialog.getByRole('button', { name: 'Delete category' }).click();
  await expect(deleteDialog).toContainText('saved estimate Category deletion fixture: Simple agents');
  await expect(page.locator('.profile-card')).toHaveCount(4);
  const fresh = await (await request.get('/api/new')).json();
  const predefined = await request.post('/api/categories/delete', {
    data: { name: 'simple', estimate: fresh },
  });
  expect(predefined.status()).toBe(422);
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Category deletion fixture/ })
    .click();
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page
    .getByRole('region', { name: 'Agent setup' })
    .getByRole('button', { name: 'Edit Simple agents' })
    .click();
  await editor.getByLabel('Complexity').selectOption('simple');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$0.24/mo');
  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();

  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Archive heavy' }).click();
  await deleteDialog.getByRole('button', { name: 'Delete category' }).click();
  await expect(deleteDialog).not.toBeVisible();
  await expect(page.locator('.profile-card')).toHaveCount(3);
  const categories = await (await request.get('/api/categories')).json();
  expect(categories).toEqual([]);
  const afterNew = await (await request.get('/api/new')).json();
  expect(Object.keys(afterNew.profiles)).toEqual(['simple', 'medium', 'high']);
  const historical = await (await request.get(`/api/estimates/${savedId}`)).json();
  expect(historical.profiles['Archive heavy']).toBeDefined();
  expect(historical.agents[0].complexity).toBe('simple');
  const deletedAgain = await request.post('/api/categories/delete', {
    data: { name: 'Archive heavy', estimate: historical },
  });
  expect(deletedAgain.status()).toBe(404);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const workbookFile = path.join(directory, 'after-deletion-budget.xlsx');
  await (await downloadPromise).saveAs(workbookFile);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookFile);
  expect(workbook.getWorksheet('Profiles')!.getColumn(1).values).not.toContain('Archive heavy');
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
  const summary = engine.getSheetId('Summary')!;
  const actualUsd = engine.getCellValue({ sheet: summary, row: 2, col: 1 });
  expect(actualUsd).toBeCloseTo(0.24, 8);
  engine.destroy();

  await page.getByRole('button', { name: 'New estimate' }).click();
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await expect(page.locator('.profile-card')).toHaveCount(3);
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Category deletion fixture/ })
    .click();
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await expect(page.locator('.profile-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Delete Archive heavy' }).click();
  await expect(deleteDialog).toContainText('historical custom profile');
  await deleteDialog.getByRole('button', { name: 'Delete category' }).click();
  await expect(page.locator('.profile-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  const cleanedSnapshot = await (await request.get(`/api/estimates/${savedId}`)).json();
  expect(cleanedSnapshot.profiles['Archive heavy']).toBeUndefined();

  await fs.writeFile(
    path.join(directory, 'run-report.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/category-deletion.spec.ts',
        pricing: 'USD 2/M input and USD 8/M output; 30 invocations/month; no retries',
        expected: { beforeCustomUsd: 0.36, afterSimpleUsd: 0.24 },
        actual: { beforeCustomUsd: 0.36, afterSimpleWorkbookUsd: actualUsd },
        draftAssignmentBlocked: true,
        savedAssignmentBlocked: true,
        predefinedBlocked: true,
        globalStarterRemoved: true,
        savedUnusedSnapshotPreserved: true,
        historicalLocalProfileRemovedOnSave: true,
        repeatedDeletionRejected: true,
        workbookRecalculated: true,
        failures: [],
      },
      null,
      2,
    ),
  );
});
