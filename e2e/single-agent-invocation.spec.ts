import { test, expect } from '@playwright/test';
import { modelStep } from './workflow-fixtures';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import fs from 'node:fs/promises';
import path from 'node:path';

test('each agent step invokes once and repeated steps reconcile through save and Excel', async ({
  page,
  request,
}) => {
  const dir = path.resolve('artifacts/single-agent-invocation');
  await fs.mkdir(dir, { recursive: true });
  const estimate = await (await request.get('/api/new')).json();
  estimate.id = `single-invocation-${Date.now()}`;
  estimate.name = 'One invocation per step fixture';
  const execution = {
    calls: '1',
    input_tokens: '1000',
    output_tokens: '0',
    retry_rate: '0',
    cache_fraction: '0',
    cache_write_fraction: '0',
  };
  estimate.prices = Object.fromEntries(
    ['A', 'B'].map((id) => [
      id,
      {
        id,
        provider: 'Synthetic fixture',
        input: id === 'A' ? '2' : '10',
        output: '0',
        source: 'Single agent invocation v1',
        retrieved_at: '2026-10-05',
        custom: true,
      },
    ]),
  );
  const row = (name: string, model: string, users: string) => ({
    id: name,
    name,
    complexity: 'simple',
    count: 1,
    members: [{ id: name, name, business_use_case_description: `${name} handles a request` }],
    volume_source: 'daily_users',
    users_per_day: users,
    invocations_per_user_per_agent_per_day: '1',
    overrides: {},
    steps: [modelStep(`${name}-model`, { ...execution, model_id: model })],
  });
  estimate.agents = [row('Root', 'A', '10'), row('Alice', 'A', '0'), row('Bob', 'B', '0')];
  estimate.agents[0].steps.push({
    id: 'delegate',
    name: 'Delegate',
    action_type: 'agent',
    execution_probability: '0.5',
    model_calls: [],
    agent_calls: [
      { id: 'to-alice', child_agent_id: 'Alice', probability: '0.8' },
      { id: 'to-bob', child_agent_id: 'Bob', probability: '0.2' },
    ],
  });
  await fs.writeFile(path.join(dir, 'input.json'), JSON.stringify(estimate, null, 2));
  const calculate = async (data: unknown) => {
    const response = await request.post('/api/calculate', { data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).scenarios[1];
  };
  const initial = await calculate(estimate);
  expect(Number(initial.llm_cost)).toBeCloseTo(1.14, 10);
  expect(Number(initial.volumes.Alice.total)).toBe(120);
  expect(Number(initial.volumes.Bob.total)).toBe(30);
  expect(Number(initial.step_costs.Root.delegate.cost_per_execution)).toBeCloseTo(0.0036, 10);
  expect(Number(initial.use_case_costs.Root.loaded_cost_per_completion)).toBeCloseTo(0.0038, 10);
  for (const multiplicity of ['0', '0.5', '1', '2', 'Infinity']) {
    const invalid = structuredClone(estimate);
    invalid.agents[0].steps[1].agent_calls[0].multiplicity = multiplicity;
    expect((await request.post('/api/estimates', { data: invalid })).status()).toBe(422);
  }
  for (const scenario of ['low', 'high']) {
    const invalid = structuredClone(estimate);
    invalid.agents[0].steps[1].agent_calls[0][scenario] = { invocations_per_trigger: '2' };
    expect((await request.post('/api/calculate', { data: invalid })).status()).toBe(422);
  }
  const duplicate = structuredClone(estimate);
  duplicate.agents[0].steps[1].agent_calls[1].child_agent_id = 'Alice';
  expect((await request.post('/api/calculate', { data: duplicate })).status()).toBe(422);
  expect((await request.post('/api/estimates', { data: estimate })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /One invocation per step fixture/ })
    .click();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.14');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Root', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await editor.getByRole('button', { name: 'Copy step', exact: true }).nth(1).click();
  await expect(editor.getByLabel('Step 3 action', { exact: true })).toHaveValue('agent');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.68');
  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  await expect(page.locator('.alert.notice')).toContainText('saved on this computer');
  await page.reload();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.68');
  const saved = await (await request.get(`/api/estimates/${estimate.id}`)).json();
  await fs.writeFile(path.join(dir, 'saved.json'), JSON.stringify(saved, null, 2));
  const actual = await calculate(saved);
  expect(Number(actual.volumes.Alice.total)).toBe(240);
  expect(Number(actual.volumes.Bob.total)).toBe(60);
  expect(Number(actual.use_case_costs.Root.loaded_cost_per_completion)).toBeCloseTo(0.0056, 10);
  const exported = await request.post('/api/export', { data: saved });
  expect(exported.ok(), await exported.text()).toBe(true);
  const file = path.join(dir, 'budget.xlsx');
  await fs.writeFile(file, await exported.body());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  workbook.eachSheet((sheet) => {
    const grid: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: (string | number | boolean | null)[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const value = row.getCell(c).value;
        cells.push(
          value && typeof value === 'object' && 'formula' in value
            ? `=${value.formula}`
            : ((value ?? null) as string | number | boolean | null),
        );
      }
      grid.push(cells);
    });
    sheets[sheet.name] = grid;
  });
  const engine = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const excelTotal = Number(engine.getCellValue({ sheet: engine.getSheetId('Summary')!, row: 2, col: 1 }));
  expect(excelTotal).toBeCloseTo(1.68, 10);
  const links = workbook.getWorksheet('Agent links')!;
  const headers = links.getRow(1).values as ExcelJS.CellValue[];
  const scenarioColumn = headers.indexOf('Scenario');
  const volumeColumn = headers.indexOf('Child invocations/month');
  const contributionVolumes: number[] = [];
  links.eachRow((row, number) => {
    if (row.getCell(scenarioColumn).value === 'Expected') {
      contributionVolumes.push(
        Number(
          engine.getCellValue({
            sheet: engine.getSheetId('Agent links')!,
            row: number - 1,
            col: volumeColumn - 1,
          }),
        ),
      );
    }
  });
  expect(contributionVolumes).toEqual([120, 30, 120, 30]);
  const imported = await request.post('/api/import/preview', {
    data: await fs.readFile(file),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const preview = await imported.json();
  expect(preview.errors).toEqual([]);
  const restored = await calculate({ ...saved, agents: preview.agents, links: [] });
  expect(Number(restored.llm_cost)).toBeCloseTo(1.68, 10);
  const options = workbook.getWorksheet('Step options')!;
  options.getRow(1).getCell(options.columnCount + 1).value = 'multiplicity';
  options.getRow(3).getCell(options.columnCount).value = '2';
  const invalidFile = path.join(dir, 'invalid-import.xlsx');
  await workbook.xlsx.writeFile(invalidFile);
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByLabel('Import agent spreadsheet').setInputFiles(invalidFile);
  await expect(page.getByRole('alert')).toContainText('Step options');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.68');
  await fs.writeFile(
    path.join(dir, 'verification.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/single-agent-invocation.spec.ts',
        fixture:
          'input.json; A USD 2/M, B USD 10/M input; 1000 input tokens/call; 300 monthly root invocations; no output/retries/cache',
        expected: {
          initial: 1.14,
          repeated: 1.68,
          alice: 240,
          bob: 60,
          loaded: 0.0056,
          contributions: [120, 30, 120, 30],
        },
        actual: {
          initial: Number(initial.llm_cost),
          repeated: Number(actual.llm_cost),
          alice: Number(actual.volumes.Alice.total),
          bob: Number(actual.volumes.Bob.total),
          loaded: Number(actual.use_case_costs.Root.loaded_cost_per_completion),
          contributions: contributionVolumes,
          excel: excelTotal,
          imported: Number(restored.llm_cost),
        },
        failures: [],
      },
      null,
      2,
    ),
  );
});
