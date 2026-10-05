import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';

test('Exclusive steps preserve weighted costs through editing, persistence and Excel', async ({
  page,
  request,
}) => {
  const dir = path.resolve('artifacts/step-actions');
  await fs.mkdir(dir, { recursive: true });
  const estimate = await (await request.get('/api/new')).json();
  estimate.id = `step-actions-${Date.now()}`;
  estimate.name = 'Exclusive step acceptance';
  estimate.prices = Object.fromEntries(
    ['A', 'B'].map((id) => [
      id,
      {
        id,
        provider: 'Synthetic fixture',
        input: id === 'A' ? '2' : '10',
        output: '0',
        source: 'Fixed step-actions v1 fixture',
        retrieved_at: '2026-10-05',
        custom: true,
      },
    ]),
  );
  const execution = {
    model_id: 'A',
    calls: '1',
    input_tokens: '1000',
    output_tokens: '0',
    retry_rate: '0',
    cache_fraction: '0',
    cache_write_fraction: '0',
  };
  const model = (id: string, probability = '1') => ({
    ...execution,
    id: `call-${id}`,
    model_id: id,
    probability,
    role: '',
  });
  const step = (id: string, calls = [model('A')]) => ({
    id,
    name: id,
    action_type: 'model',
    execution_probability: '1',
    model_calls: calls,
    agent_calls: [],
  });
  const row = (id: string, steps: unknown[]) => ({
    id,
    name: id,
    complexity: 'simple',
    count: 1,
    invocations: '100',
    volume_source: 'daily_users',
    users_per_day: '0',
    invocations_per_user_per_agent_per_day: '1',
    steps,
    overrides: {},
    use_case_name: id,
  });
  // Only Root has direct workload; children retain zero direct volume for recovery.
  const root = row('Root', [
    step('Choose model', [model('A', '0.8'), model('B', '0.2')]),
    {
      id: 'delegate',
      name: 'Delegate',
      action_type: 'agent',
      execution_probability: '0.5',
      model_calls: [],
      agent_calls: [
        { id: 'to-a', child_agent_id: 'Child A', probability: '0.7' },
        { id: 'to-b', child_agent_id: 'Child B', probability: '0.3' },
      ],
    },
  ]);
  root.users_per_day = '10';
  root.invocations_per_user_per_agent_per_day = '1';
  // 300 invocations/month gives independent costs .36*3 + .07*3 + .15*3 = 1.74.
  estimate.agents = [
    root,
    row('Child A', [step('Child A work')]),
    row('Child B', [step('Child B work', [model('B')])]),
  ];
  await fs.writeFile(path.join(dir, 'input.json'), JSON.stringify(estimate, null, 2));
  const calculate = async (data: unknown) => {
    const response = await request.post('/api/calculate', { data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).scenarios[1];
  };
  const actual = await calculate(estimate);
  expect(Number(actual.llm_cost)).toBeCloseTo(1.74, 10);
  expect(Number(actual.volumes['Child A'].total)).toBe(105);
  expect(Number(actual.volumes['Child B'].total)).toBe(45);
  expect(Number(actual.use_case_costs.Root.loaded_cost_per_completion)).toBeCloseTo(0.0058, 10);
  expect(Number(actual.step_costs.Root.delegate.cost_per_execution)).toBeCloseTo(0.0044, 10);
  for (const probability of ['0.1', '0.9', '', '-1', 'Infinity']) {
    const invalid = structuredClone(estimate);
    invalid.agents[0].steps[0].model_calls[0].probability = probability;
    expect((await request.post('/api/calculate', { data: invalid })).status()).toBe(422);
  }
  for (const target of ['Root', 'missing']) {
    const invalid = structuredClone(estimate);
    invalid.agents[0].steps[1].agent_calls[0].child_agent_id = target;
    expect((await request.post('/api/estimates', { data: invalid })).status()).toBe(422);
  }
  const unsupported = structuredClone(estimate);
  unsupported.schema_version = 8;
  expect((await request.post('/api/calculate', { data: unsupported })).status()).toBe(422);
  const invalidAction = structuredClone(estimate);
  invalidAction.agents[0].steps[0].action_type = 'legacy';
  expect((await request.post('/api/calculate', { data: invalidAction })).status()).toBe(422);
  const mixed = structuredClone(estimate);
  mixed.agents[0].steps[1].model_calls = [model('A')];
  expect((await request.post('/api/calculate', { data: mixed })).status()).toBe(422);
  const missing = structuredClone(estimate);
  delete missing.prices.B;
  expect((await calculate(missing)).complete).toBe(false);
  const shared = structuredClone(estimate);
  shared.agents.push({
    ...structuredClone(root),
    id: 'Second root',
    name: 'Second root',
    steps: [
      {
        ...root.steps[1],
        id: 'shared',
        execution_probability: '1',
        agent_calls: [{ id: 'shared-a', child_agent_id: 'Child A', probability: '1' }],
      },
    ],
  });
  const sharedResult = await calculate(shared);
  expect(Number(sharedResult.volumes['Child A'].total)).toBe(405);
  expect(Number(sharedResult.llm_cost)).toBeCloseTo(2.34, 10);
  const zero = structuredClone(missing);
  zero.agents[0].steps[0].model_calls[0].probability = '1';
  zero.agents[0].steps[0].model_calls[1].probability = '0';
  zero.agents[0].steps[1].agent_calls[0].probability = '1';
  zero.agents[0].steps[1].agent_calls[1].probability = '0';
  const zeroResult = await calculate(zero);
  expect(zeroResult.complete).toBe(true);
  expect(Number(zeroResult.llm_cost)).toBeCloseTo(0.9, 10);
  const cycle = structuredClone(estimate);
  cycle.agents[1].steps.push({
    ...root.steps[1],
    id: 'cycle',
    execution_probability: '1',
    agent_calls: [{ id: 'cycle-option', child_agent_id: 'Root', probability: '1' }],
  });
  expect((await request.post('/api/calculate', { data: cycle })).status()).toBe(422);
  const missingProbability = structuredClone(estimate);
  delete missingProbability.agents[0].steps[0].model_calls[0].probability;
  expect((await request.post('/api/calculate', { data: missingProbability })).status()).toBe(422);
  const almostOne = structuredClone(estimate);
  almostOne.agents[0].steps[0].model_calls[0].probability = '0.8000000000000000000000000000001';
  expect((await request.post('/api/calculate', { data: almostOne })).status()).toBe(422);
  const scenarioRouting = structuredClone(estimate);
  scenarioRouting.agents[0].steps[1].agent_calls[0].low = { trigger_probability: '0.6' };
  scenarioRouting.agents[0].steps[1].agent_calls[1].low = { trigger_probability: '0.4' };
  const scenarioResponse = await request.post('/api/calculate', { data: scenarioRouting });
  expect(scenarioResponse.ok(), await scenarioResponse.text()).toBe(true);
  const low = (await scenarioResponse.json()).scenarios[0];
  // Low tokens are 75%; root .81 + child A .135 + child B .45 = 1.395.
  expect(Number(low.llm_cost)).toBeCloseTo(1.395, 10);
  const overridden = structuredClone(estimate);
  overridden.scenarios[1].model_id = 'B';
  const overriddenResult = await calculate(overridden);
  expect(Number(overriddenResult.llm_cost)).toBeCloseTo(4.5, 10);
  expect(
    overriddenResult.step_costs.Root['Choose model'].options.map(
      (option: { target_id: string }) => option.target_id,
    ),
  ).toEqual(['B', 'B']);
  for (const value of [null, 'invalid', {}]) {
    const malformed = structuredClone(estimate);
    malformed.agents[0].steps[1].agent_calls = value;
    expect((await request.post('/api/calculate', { data: malformed })).status()).toBe(422);
  }
  const malformedTarget = structuredClone(estimate);
  malformedTarget.agents[0].steps[1].agent_calls[0].child_agent_id = [];
  expect((await request.post('/api/calculate', { data: malformedTarget })).status()).toBe(422);
  const counted = structuredClone(estimate);
  counted.agents[1].count = 3;
  counted.agents[1].members = ['Selected child', 'Other child 1', 'Other child 2'].map((name) => ({
    id: name,
    name,
    business_use_case_description: 'Independent child fixture',
  }));
  counted.agents[0].steps[1].agent_calls[0].child_agent_id = 'Selected child';
  const beforeSplit = await calculate(counted);
  const splitResponse = await request.post('/api/agents/split', {
    data: { estimate: counted, row_id: 'Child A' },
  });
  expect(splitResponse.ok(), await splitResponse.text()).toBe(true);
  const split = await splitResponse.json();
  const afterSplit = await calculate(split.estimate);
  expect(Number(beforeSplit.llm_cost)).toBeCloseTo(1.74, 10);
  expect(Number(afterSplit.llm_cost)).toBeCloseTo(1.74, 10);
  expect(Number(afterSplit.volumes[split.individual_id].total)).toBeCloseTo(0, 10);
  expect((await request.post('/api/estimates', { data: estimate })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Exclusive step acceptance/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Root', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await expect(editor.getByLabel('Step 2 action', { exact: true })).toHaveValue('agent');
  await expect(editor.getByText('Probability total: 100%')).toHaveCount(2);
  await editor.getByLabel('Step 1 model 1 probability (0–1)').fill('0.7');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor.getByRole('alert').last()).toContainText('total 1.0');
  await editor.getByLabel('Step 1 model 1 probability (0–1)').fill('0.8');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agent invocation graph' })).toContainText('Delegate');
  await expect(page.getByTestId('cost-expected')).toContainText('$1.74');
  await page.screenshot({ path: path.join(dir, 'graph.png'), fullPage: true });
  const reopened = await (await request.get(`/api/estimates/${estimate.id}`)).json();
  expect(Number((await calculate(reopened)).llm_cost)).toBeCloseTo(1.74, 10);
  const response = await request.post('/api/export', { data: reopened });
  expect(response.ok(), await response.text()).toBe(true);
  const file = path.join(dir, 'budget.xlsx');
  await fs.writeFile(file, await response.body());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  expect(wb.getWorksheet('Step actions')).toBeTruthy();
  const spreadsheetPreview = await request.post('/api/import/preview', {
    data: await fs.readFile(file),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(spreadsheetPreview.ok()).toBe(true);
  const imported = await spreadsheetPreview.json();
  expect(imported.errors).toEqual([]);
  const restored = { ...reopened, agents: imported.agents, links: [] };
  expect(Number((await calculate(restored)).llm_cost)).toBeCloseTo(1.74, 10);
  const invalidWorkbook = new ExcelJS.Workbook();
  await invalidWorkbook.xlsx.readFile(file);
  const optionSheet = invalidWorkbook.getWorksheet('Step options')!;
  const probabilityColumn = optionSheet.getRow(1).values.indexOf('probability');
  optionSheet.getRow(2).getCell(probabilityColumn).value = '0.7';
  const invalidFile = path.join(dir, 'invalid-import.xlsx');
  await invalidWorkbook.xlsx.writeFile(invalidFile);
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByLabel('Import agent spreadsheet').setInputFiles(invalidFile);
  const importDialog = page.getByRole('dialog', { name: 'Review spreadsheet import' });
  await expect(importDialog.getByRole('alert')).toContainText('total 1.0');
  await expect(importDialog.getByRole('button', { name: 'Replace inventory' })).toBeDisabled();
  await importDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.74');
  await page.getByRole('button', { name: 'Edit Root', exact: true }).click();
  await editor.getByLabel('Step 2 action', { exact: true }).selectOption('model');
  await expect(editor.getByLabel('Step 2 agent 1', { exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Undo action change' }).click();
  await expect(editor.getByLabel('Step 2 action', { exact: true })).toHaveValue('agent');
  await editor.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByRole('button', { name: 'Reset parameters', exact: true }).click();
  const resetDialog = page.getByRole('dialog', { name: 'Reset execution parameters' });
  await resetDialog.getByRole('button', { name: 'Reset parameters', exact: true }).click();
  const resetDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!));
  expect(
    resetDraft.agents[0].steps[1].agent_calls.map((o: { probability: string }) => o.probability),
  ).toEqual(['0.7', '0.3']);
  expect(resetDraft.links).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.74');
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  wb.eachSheet((sheet) => {
    const grid: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: (string | number | boolean | null)[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const v = row.getCell(c).value;
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
  const exported = Number(engine.getCellValue({ sheet: engine.getSheetId('Summary')!, row: 2, col: 1 }));
  expect(exported).toBeCloseTo(1.74, 10);
  engine.destroy();
  await fs.writeFile(
    path.join(dir, 'verification.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/step-actions.spec.ts',
        fixture:
          'input.json; synthetic prices A $2/M input, B $10/M; 30 days; no retries/cache/tools/harness',
        expected: { suite: 1.74, childA: 105, childB: 45, loadedRoot: 0.0058, sharedSuite: 2.34 },
        actual: {
          suite: Number(actual.llm_cost),
          childA: Number(actual.volumes['Child A'].total),
          childB: Number(actual.volumes['Child B'].total),
          loadedRoot: Number(actual.use_case_costs.Root.loaded_cost_per_completion),
          sharedSuite: Number(sharedResult.llm_cost),
          exported,
        },
        checks: [
          'exact probability validation',
          'exclusive actions',
          'cycle rejection',
          'zero-weight missing price',
          'scenario routing',
          'shared children',
          'counted-member split',
          'save/reopen',
          'Excel formula recalculation',
          'step-option spreadsheet round trip',
          'invalid import recovery',
          'action-switch undo',
          'reset preserves distributions',
        ],
        failures: [],
      },
      null,
      2,
    ),
  );
});
