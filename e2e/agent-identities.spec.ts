import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';

test('suite members receive editable identities that survive save and Excel export', async ({
  page,
  request,
}) => {
  const directory = path.resolve('artifacts/agent-identities');
  await fs.mkdir(directory, { recursive: true });
  await page.goto('/');
  await page.getByLabel('Estimate name').fill('Identity fixture');
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await page.getByRole('button', { name: 'Quick setup', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Set up your agent suite' });
  await quick.getByLabel('Total agent count').fill('2');
  await quick.getByLabel('Simple agents', { exact: true }).fill('2');
  await quick.getByLabel('Medium agents', { exact: true }).fill('0');
  await quick.getByLabel('High agents', { exact: true }).fill('0');
  await quick.getByLabel('Simple users per agent per day *').fill('1');
  await quick.getByLabel('Simple invocations per user per agent per day *').fill('1');
  await quick.getByRole('button', { name: 'Create suite' }).click();
  await expect(page.getByLabel('Simple agents total monthly invocations all agents')).toHaveText('60');
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await page.getByRole('button', { name: 'Select agent Medium agents' }).click();
  await expect(page.getByText('This group has no agents. Edit the group to add members.')).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();

  await page.getByRole('button', { name: 'Edit Simple agents' }).click();
  const editor = page.getByRole('dialog', { name: 'Configure agent group' });
  await expect(editor.getByLabel('Agent 1 name')).toHaveValue('Simple agent 1');
  await expect(editor.getByLabel('Agent 2 name')).toHaveValue('Simple agent 2');
  await expect(editor.getByLabel('Agent 1 business use case description')).toHaveValue(
    'Business use case pending description',
  );
  await editor.getByLabel('Agent 1 ID').fill('triage-1');
  await editor.getByLabel('Agent 1 name').fill('Customer triage');
  await editor.getByLabel('Agent 1 business use case description').fill('Classifies support requests');
  await editor.getByLabel('Agent 2 ID').fill('draft-2');
  await editor.getByLabel('Agent 2 name').fill('Response drafter');
  await editor.getByLabel('Agent 2 business use case description').fill('Drafts a customer reply');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByLabel('Simple agents total monthly invocations all agents')).toHaveText('60');

  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  const list = await (await request.get('/api/estimates')).json();
  const savedId = list.find((item: { name: string }) => item.name === 'Identity fixture').id;
  const estimate = await (await request.get(`/api/estimates/${savedId}`)).json();
  await fs.writeFile(path.join(directory, 'input-fixture.json'), JSON.stringify(estimate, null, 2));
  expect(estimate.schema_version).toBe(8);
  expect(estimate.agents[0].members).toEqual([
    { id: 'triage-1', name: 'Customer triage', business_use_case_description: 'Classifies support requests' },
    { id: 'draft-2', name: 'Response drafter', business_use_case_description: 'Drafts a customer reply' },
  ]);

  const legacy = structuredClone(estimate);
  legacy.schema_version = 5;
  legacy.id = `legacy-identities-${Date.now()}`;
  legacy.name = 'Legacy identity migration fixture';
  delete legacy.agents[0].members;
  legacy.agents.push({
    ...legacy.agents[0],
    id: 'legacy-extra-row',
    name: 'Simple agents 2',
    count: 1,
  });
  const legacySave = await request.post('/api/estimates', { data: legacy });
  expect(legacySave.ok(), await legacySave.text()).toBe(true);
  const migrated = await (await request.get(`/api/estimates/${legacy.id}`)).json();
  expect(migrated.schema_version).toBe(8);
  const migratedNames = migrated.agents.flatMap((row: { members: { name: string }[] }) =>
    row.members.map((member) => member.name),
  );
  expect(new Set(migratedNames.map((name: string) => name.toLowerCase())).size).toBe(3);

  await page.reload();
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Identity fixture/ })
    .click();
  await page.getByRole('button', { name: 'Edit Simple agents' }).click();
  await expect(page.getByRole('dialog').getByLabel('Agent 1 ID')).toHaveValue('triage-1');
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const download = await downloadPromise;
  const workbookFile = path.join(directory, 'identity-suite.xlsx');
  await download.saveAs(workbookFile);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookFile);
  const sheet = workbook.getWorksheet('Agent identities')!;
  expect(sheet.rowCount).toBe(3);
  expect(sheet.getCell('C2').value).toBe('triage-1');
  expect(sheet.getCell('D2').value).toBe('Customer triage');
  expect(sheet.getCell('E2').value).toBe('Classifies support requests');
  expect(sheet.getCell('C3').value).toBe('draft-2');

  await page.getByRole('button', { name: 'Edit Simple agents' }).click();
  const duplicate = page.getByRole('dialog', { name: 'Configure agent group' });
  await duplicate.getByLabel('Agent 2 ID').fill('triage-1');
  await duplicate.getByRole('button', { name: 'Apply changes' }).click();
  await expect(duplicate.getByRole('alert')).toContainText('Agent IDs must be unique');
  await duplicate.getByLabel('Agent 2 ID').fill('draft-2');
  await duplicate.getByLabel('Agent 2 name').fill('Customer triage');
  await duplicate.getByRole('button', { name: 'Apply changes' }).click();
  await expect(duplicate.getByRole('alert')).toContainText('Agent names must be unique');

  await fs.writeFile(
    path.join(directory, 'run-report.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/agent-identities.spec.ts',
        fixture:
          'Two simple agents, one user per agent per day, one invocation per user per day, 30 planning days',
        expected: { memberCount: 2, monthlyInvocations: 60, workbookIdentityRows: 2 },
        actual: {
          memberCount: estimate.agents[0].members.length,
          monthlyInvocations: 60,
          workbookIdentityRows: sheet.rowCount - 1,
        },
        duplicateIdRejected: true,
        duplicateNameRejected: true,
        legacyMigrationNamesUnique: true,
        failures: [],
      },
      null,
      2,
    ),
  );
});
