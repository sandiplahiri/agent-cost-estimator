import { test, expect } from '@playwright/test';
import { modelStep } from './workflow-fixtures';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import fs from 'node:fs/promises';
import path from 'node:path';

test('agent steps select named individuals and retain untargeted workload through editing and Excel', async ({
  page,
  request,
}) => {
  const dir = path.resolve('artifacts/individual-agent-targets');
  await fs.mkdir(dir, { recursive: true });
  const estimate = await (await request.get('/api/new')).json();
  estimate.name = 'Individual target fixture';
  estimate.id = `individual-targets-${Date.now()}`;
  const execution = {
    calls: '1',
    input_tokens: '1000',
    output_tokens: '0',
    retry_rate: '0',
    cache_fraction: '0',
    cache_write_fraction: '0',
  };
  estimate.profiles.simple = execution;
  estimate.prices = Object.fromEntries(
    ['A', 'B'].map((id) => [
      id,
      {
        id,
        provider: 'Synthetic fixture',
        input: id === 'A' ? '2' : '10',
        output: '0',
        source: 'Individual targets v1',
        retrieved_at: '2026-10-05',
        custom: true,
      },
    ]),
  );
  const member = (name: string) => ({
    id: name.toLowerCase(),
    name,
    business_use_case_description: `${name} handles a request`,
  });
  estimate.agents = [
    {
      id: 'root-row',
      name: 'Root',
      complexity: 'simple',
      count: 1,
      members: [member('Root')],
      volume_source: 'daily_users',
      users_per_day: '10',
      invocations_per_user_per_agent_per_day: '1',
      overrides: {},
      steps: [modelStep('root-model', { ...execution, model_id: 'A' })],
    },
    {
      id: 'shared-row',
      name: 'Simple agents',
      complexity: 'simple',
      count: 3,
      members: ['Alice', 'Bob', 'Cara'].map(member),
      volume_source: 'daily_users',
      users_per_day: '1',
      invocations_per_user_per_agent_per_day: '1',
      overrides: { model_id: 'A' },
      steps: [],
    },
  ];
  await fs.writeFile(path.join(dir, 'input.json'), JSON.stringify(estimate, null, 2));
  expect((await request.post('/api/estimates', { data: estimate })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Individual target fixture/ })
    .click();
  await expect(page.getByTestId('cost-expected')).toContainText('$0.78');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Root', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  const configure = async () => {
    await editor.getByRole('button', { name: 'Add step', exact: true }).click();
    await editor.getByLabel('Step 2 action', { exact: true }).selectOption('agent');
    const picker = editor.getByLabel('Step 2 agent 1', { exact: true });
    await expect(picker.locator('option')).toHaveText(['Choose an agent', 'Alice', 'Bob', 'Cara']);
    await picker.selectOption('alice');
    await editor.getByLabel('Step 2 agent 1 probability (0–1)').fill('0.8');
    await editor.getByRole('button', { name: 'Add agent option', exact: true }).click();
    await editor.getByLabel('Step 2 agent 2', { exact: true }).selectOption('bob');
    await editor.getByLabel('Step 2 agent 2 probability (0–1)').fill('0.2');
  };
  await configure();
  const actionCost = editor.getByRole('region', { name: 'Step 2 weighted cost' });
  await expect(actionCost.getByRole('listitem').nth(0)).toContainText('Alice: 0.8 × $0.002 = $0.0016');
  await expect(actionCost.getByRole('listitem').nth(1)).toContainText('Bob: 0.2 × $0.002 = $0.0004');
  await editor.getByRole('button', { name: 'Close dialog' }).click();
  const cancelled = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!));
  expect(cancelled.agents).toHaveLength(2);
  expect(cancelled.agents[1].count).toBe(3);
  await expect(page.getByTestId('cost-expected')).toContainText('$0.78');
  await page.getByRole('button', { name: 'Edit Root', exact: true }).click();
  await configure();
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.26');
  const routed = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!));
  const routedResult = await (await request.post('/api/calculate', { data: routed })).json();
  const scenario = routedResult.scenarios[1];
  const rowId = (data: typeof routed, id: string) =>
    data.agents.find((row: { members: { id: string }[] }) => row.members.some((member) => member.id === id))
      .id;
  for (const [id, volume] of [
    ['alice', 240],
    ['bob', 60],
    ['cara', 30],
  ] as const)
    expect(Number(scenario.volumes[rowId(routed, id)].total)).toBeCloseTo(volume, 10);
  expect(routed.agents.reduce((sum: number, row: { count: number }) => sum + row.count, 0)).toBe(4);
  expect(Number(scenario.use_case_costs['root-row'].loaded_cost_per_completion)).toBeCloseTo(0.004, 10);
  expect(
    routed.agents[0].steps[1].agent_calls.map((option: { child_agent_id: string }) => option.child_agent_id),
  ).toEqual(['alice', 'bob']);
  await page.getByRole('button', { name: 'Edit Bob', exact: true }).click();
  await editor.getByRole('button', { name: 'Step 1 model name: A' }).click();
  await page
    .getByRole('dialog', { name: 'Choose a model' })
    .getByRole('button', { name: /B/ })
    .filter({ hasText: 'Synthetic fixture' })
    .click();
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.74');
  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  const saved = await (await request.get(`/api/estimates/${estimate.id}`)).json();
  const savedResult = await (await request.post('/api/calculate', { data: saved })).json();
  expect(Number(savedResult.scenarios[1].llm_cost)).toBeCloseTo(1.74, 10);
  const detached = structuredClone(saved);
  detached.agents.find(
    (row: { id: string }) => row.id === 'root-row',
  ).steps[1].agent_calls[0].child_agent_id = 'cara';
  const detachedResponse = await request.post('/api/calculate', { data: detached });
  expect(detachedResponse.ok(), await detachedResponse.text()).toBe(true);
  const detachedResult = await detachedResponse.json();
  expect(Number(detachedResult.scenarios[1].volumes[rowId(saved, 'alice')].total)).toBe(30);
  const invalid = structuredClone(estimate);
  invalid.agents[0].steps.push({
    id: 'invalid',
    name: 'Call category',
    action_type: 'agent',
    execution_probability: '1',
    model_calls: [],
    agent_calls: [{ id: 'bad-target', child_agent_id: 'shared-row', probability: '1' }],
  });
  expect((await request.post('/api/calculate', { data: invalid })).status()).toBe(422);
  const self = structuredClone(saved);
  self.agents[0].steps[1].agent_calls[0].child_agent_id = 'root';
  expect((await request.post('/api/calculate', { data: self })).status()).toBe(422);
  const exported = await request.post('/api/export', { data: saved });
  expect(exported.ok(), await exported.text()).toBe(true);
  const workbookFile = path.join(dir, 'budget.xlsx');
  await fs.writeFile(workbookFile, await exported.body());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(workbookFile);
  const grids: Record<string, (string | number | boolean | null)[][]> = {};
  wb.eachSheet((sheet) => {
    const rows: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      rows.push(
        Array.from({ length: sheet.columnCount }, (_, i) => {
          const value = row.getCell(i + 1).value;
          return value && typeof value === 'object' && 'formula' in value
            ? `=${value.formula}`
            : typeof value === 'string'
              ? `'${value}`
              : typeof value === 'number' || typeof value === 'boolean'
                ? value
                : null;
        }),
      );
    });
    grids[sheet.name] = rows;
  });
  const formulas = HyperFormula.buildFromSheets(grids, { licenseKey: 'gpl-v3' });
  const excel = Number(formulas.getCellValue({ sheet: formulas.getSheetId('Summary')!, row: 2, col: 1 }));
  expect(excel).toBeCloseTo(1.74, 10);
  formulas.destroy();
  const imported = await request.post('/api/import/preview', {
    data: await fs.readFile(workbookFile),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(imported.ok()).toBe(true);
  const preview = await imported.json();
  expect(preview.errors).toEqual([]);
  const restored = { ...saved, agents: preview.agents, links: [] };
  const restoredResponse = await request.post('/api/calculate', { data: restored });
  expect(restoredResponse.ok(), await restoredResponse.text()).toBe(true);
  const importedUsd = Number((await restoredResponse.json()).scenarios[1].llm_cost);
  expect(importedUsd).toBeCloseTo(1.74, 10);
  await page.reload();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.74');
  await expect(page.getByRole('region', { name: 'Agent invocation graph' })).toContainText('Alice');
  await page.screenshot({ path: path.join(dir, 'graph.png'), fullPage: true });
  await fs.writeFile(path.join(dir, 'saved.json'), JSON.stringify(saved, null, 2));
  await fs.writeFile(
    path.join(dir, 'verification.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/individual-agent-targets.spec.ts',
        fixture:
          'input.json; A USD 2/M input, B USD 10/M; 1000 input tokens/call; 30-day month; no retries/cache',
        expected: {
          initial: 0.78,
          routed: 1.26,
          edited: 1.74,
          alice: 240,
          bob: 60,
          cara: 30,
          restoredAlice: 30,
          agentCount: 4,
        },
        actual: {
          routed: Number(scenario.llm_cost),
          edited: Number(savedResult.scenarios[1].llm_cost),
          excel,
          imported: importedUsd,
          alice: Number(scenario.volumes[rowId(routed, 'alice')].total),
          bob: Number(scenario.volumes[rowId(routed, 'bob')].total),
          cara: Number(scenario.volumes[rowId(routed, 'cara')].total),
          restoredAlice: Number(detachedResult.scenarios[1].volumes[rowId(saved, 'alice')].total),
        },
        failures: [],
      },
      null,
      2,
    ),
  );
});
