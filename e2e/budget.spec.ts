import { modelStep, agentStep } from './workflow-fixtures';
import { openAgentEditor, expectBaseVolume } from './agent-editing';
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
  await picker.locator('.model-choice').filter({ hasText: name }).first().click();
}

async function assignGroupModel(page: Page, groupName: string, modelName = 'Fixture A') {
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await openAgentEditor(page, groupName);
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await chooseModel(page, editor.getByRole('button', { name: /^Model:/ }), modelName);
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor).not.toBeVisible();
}

async function setup(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your agent suite, budgeted.' })).toBeVisible();
  await page.getByLabel('Estimate name').fill('Mortgage fixture');
  await addModel(page);
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
  await quick
    .getByLabel('Simple invocations per user per agent per day *')
    .fill('33.3333333333333333333333333333');
  await quick.getByRole('button', { name: 'Create suite' }).click();
  await assignGroupModel(page, 'Simple agents');
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  await expectBaseVolume(page, 'Simple agents', 1000, 2000);
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
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
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByTestId('monthly-summary-high-total-cost')).toHaveText('$48.96');
  await expect(page.getByTestId('monthly-summary-expected-total-cost')).toHaveText('$16.32');
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
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await page.screenshot({ path: path.join(artifacts, 'suite-desktop.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
  records.push({
    journey: 'Scenario edits, reset, undo',
    evidence: 'UI plus suite-desktop.png',
    expected: [24.48, 73.44],
    actual: [24.48, 73.44],
  });
});

test('Top agents by cost follows scenario and individual edits and reconciles with Excel', async ({
  page,
}) => {
  await setup(page);
  const baselineUi = await page.getByTestId('cost-expected').innerText();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const impact = page.getByRole('region', { name: 'Top agents by cost' });
  await expect(impact.locator('tbody tr').first()).toContainText('$8.16');

  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  const expectedEditor = page
    .locator('.scenario-editor-grid article')
    .filter({ has: page.getByRole('heading', { name: 'Expected', exact: true }) });
  await expectedEditor.getByLabel('Invocation volume ×').fill('2');
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$32.64/mo');
  await expect(impact.locator('tbody tr').first()).toContainText('$16.32');
  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  await expectedEditor.getByLabel('Invocation volume ×').fill('1');
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');

  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await openAgentEditor(page, 'Simple agents');
  await page
    .getByRole('dialog', { name: 'Edit agent' })
    .getByRole('button', { name: 'Customize one agent', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Edit agent' })
    .getByRole('button', { name: 'Apply changes' })
    .click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(impact.locator('tbody tr')).toHaveCount(2);
  await expect(impact.locator('tbody tr').first()).toContainText('$8.16');
  await expect(impact.locator('tbody tr').last()).toContainText('$8.16');
  const fixture = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  await fs.writeFile(path.join(artifacts, 'sensitivity-fixture.json'), JSON.stringify(fixture, null, 2));
  const invalid = await page.request.post('/api/sensitivity', {
    data: {
      estimate: fixture,
      row_id: fixture.agents[0].id,
      field: 'cache_fraction',
      value: '1.5',
    },
  });
  expect(invalid.status()).toBe(422);
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const file = path.join(artifacts, 'sensitivity-budget.xlsx');
  await (await download).saveAs(file);
  const { engine, summary } = await recalculateWorkbook(file);
  const workbookCost = engine.getCellValue({ sheet: summary, col: 1, row: 2 });
  expect(workbookCost).toBeCloseTo(16.32, 8);
  engine.destroy();
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await openAgentEditor(page, 'Simple agent 2');
  const individualEditor = page.getByRole('dialog', { name: 'Edit agent' });
  await individualEditor.getByLabel('Output tokens / call', { exact: true }).fill('0');
  await individualEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$12.24/mo');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(impact.locator('tbody tr').first()).toContainText('Simple agent 1');
  await expect(impact.locator('tbody tr').first()).toContainText('$8.16');
  await expect(impact.locator('tbody tr').last()).toContainText('Simple agent 2');
  await expect(impact.locator('tbody tr').last()).toContainText('$4.08');
  const rankedDrivers = await impact.locator('tbody tr').allInnerTexts();
  await page.screenshot({ path: path.join(artifacts, 'top-agents-without-preview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Cached read fraction', { exact: true }).first().fill('0.5');
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await expect(page.getByTestId('cost-expected')).toContainText('Incomplete');
  await expect(impact.locator('tbody tr').first()).toContainText('Incomplete');
  await expect(impact).toContainText('Ranking uses known costs');
  const incompleteRanking = await impact.innerText();
  records.push({
    journey:
      'Top agent ranking, scenario changes, split ownership, incomplete prices, and Excel reconciliation',
    evidence: 'sensitivity-fixture.json and sensitivity-budget.xlsx',
    expected: {
      baselineUsd: 16.32,
      workbookUsd: 16.32,
      invalidFractionStatus: 422,
      incompleteRanking: true,
      rankedCostsUsd: [8.16, 4.08],
    },
    actual: {
      baselineUi,
      workbookUsd: workbookCost,
      invalidFractionStatus: invalid.status(),
      incompleteRanking,
      rankedDrivers,
    },
  });
});

test('top five ranks individual members by token cost rather than group or tool costs', async ({
  page,
  request,
}) => {
  const directory = path.join(artifacts, 'top-five-agents');
  await fs.mkdir(directory, { recursive: true });
  const fixture = await (await request.get('/api/new')).json();
  fixture.name = 'Top five individual agents fixture';
  fixture.prices = {
    'Rank fixture': {
      id: 'Rank fixture',
      provider: 'Synthetic fixture',
      input: '2',
      output: '8',
      cache_read: null,
      cache_write: null,
      tiers: [],
      max_input: null,
      max_output: null,
      source: 'Versioned E2E fixture',
      retrieved_at: '2026-10-04',
      custom: true,
      unsupported: [],
    },
  };
  fixture.profiles.simple.input_tokens = '1000';
  fixture.profiles.simple.output_tokens = '0';
  fixture.profiles.simple.calls = '1';
  fixture.profiles.simple.retry_rate = '0';
  const row = (id: string, names: string[], invocations: string, useCase: string) => ({
    id,
    name: `${id} group`,
    description: '',
    use_case_name: useCase,
    use_case_description: '',
    members: names.map((name, index) => ({
      id: `${id}-${index}`,
      name,
      business_use_case_description: useCase,
    })),
    complexity: 'simple',
    count: names.length,
    invocations,
    volume_source: 'manual',
    prior_volume_source: null,
    users_per_day: null,
    invocations_per_user_per_agent_per_day: null,
    overrides: { model_id: 'Rank fixture' },
    steps: [],
    tool_costs: [],
  });
  fixture.agents = [
    row('group', ['Group C', 'Group B', 'Group A'], '3000', 'Shared analysis'),
    row('middle', ['Middle'], '4000', 'Review cases'),
    row('highest', ['Highest'], '6000', 'Plan responses'),
    row('tools', ['Tool spender'], '2000', 'Look up records'),
    row('second', ['Second'], '5000', 'Draft responses'),
  ];
  fixture.agents[3].tool_costs = [
    {
      id: 'lookup',
      name: 'Lookup',
      unit_cost: '0.05',
      expected_units_per_invocation: '1',
      probability: '1',
      step_id: null,
    },
  ];
  fixture.links = [];
  fixture.additional_costs = [];
  fixture.harness.harness_type = 'none';
  await fs.writeFile(path.join(directory, 'input.json'), JSON.stringify(fixture, null, 2));
  await page.addInitScript((draft) => {
    if (!localStorage.getItem('agent-ledger-draft-v1'))
      localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft));
  }, fixture);
  await page.goto('/');
  const table = page.getByRole('region', { name: 'Top agents by cost' }).getByRole('table');
  const expectedRows = [
    ['1', 'Highest', 'Plan responses', '$12.00'],
    ['2', 'Second', 'Draft responses', '$10.00'],
    ['3', 'Middle', 'Review cases', '$8.00'],
    ['4', 'Group A', 'Shared analysis', '$6.00'],
    ['5', 'Group B', 'Shared analysis', '$6.00'],
  ];
  await expect(table.locator('tbody tr')).toHaveCount(5);
  for (const [index, values] of expectedRows.entries()) {
    await expect(table.locator('tbody tr').nth(index).locator('th, td')).toHaveText(values);
  }
  const actualRows = await table
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent)),
    );
  await expect(page.getByTestId('monthly-summary-expected-total-cost')).toHaveText('$52.00');
  await expect(page.getByTestId('monthly-summary-expected-other-costs')).toHaveText('$100.00');
  await page.screenshot({ path: path.join(directory, 'dashboard.png'), fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const workbookFile = path.join(directory, 'ranked-agents.xlsx');
  await (await download).saveAs(workbookFile);
  const { engine, summary } = await recalculateWorkbook(workbookFile);
  const workbookTokens = Number(engine.getCellValue({ sheet: summary, row: 2, col: 1 }));
  const workbookTotal = Number(engine.getCellValue({ sheet: summary, row: 2, col: 3 }));
  expect(workbookTokens).toBeCloseTo(52, 9);
  expect(workbookTotal).toBeCloseTo(152, 9);
  engine.destroy();
  await fs.writeFile(
    path.join(directory, 'run-report.json'),
    JSON.stringify(
      {
        command: "npm run test:e2e -- e2e/budget.spec.ts --grep 'top five ranks'",
        pricing: 'Fixed USD 2/M input and USD 8/M output; 1000 input and zero output per call; no retries',
        assumptions:
          'Manual monthly invocations per member: 6000/5000/4000/3000/2000. Three 3000-invocation members share a group; tools cost USD 100 on the USD 4 token agent.',
        expected: { rows: expectedRows, suiteTokenCost: 52, suiteTotal: 152 },
        actual: { rows: actualRows, suiteTokenCost: workbookTokens, suiteTotal: workbookTotal },
        calculationEngine: 'HyperFormula',
        failures: [],
      },
      null,
      2,
    ),
  );
});

test('Agent steps derive individual child volume, preserve scenarios, and export a reproducible graph', async ({
  page,
  request,
}) => {
  const fixture = await (await request.get('/api/new')).json();
  fixture.name = 'Delegated work fixture';
  fixture.prices['Graph Fixture'] = {
    id: 'Graph Fixture',
    provider: 'Synthetic provider',
    input: '2',
    output: '8',
    cache_read: null,
    cache_write: null,
    tiers: [],
    max_input: null,
    max_output: null,
    source: 'Fixed E2E fixture; not provider prices',
    retrieved_at: '2026-01-01T00:00:00Z',
    custom: true,
    unsupported: [],
  };
  fixture.agents = [
    {
      id: 'planner',
      name: 'Planner',
      complexity: 'simple',
      count: 1,
      invocations: '0',
      volume_source: 'daily_users',
      prior_volume_source: null,
      users_per_day: '10',
      invocations_per_user_per_agent_per_day: '1',
      overrides: { model_id: 'Graph Fixture' },
      steps: [],
    },
    {
      id: 'researcher',
      name: 'Researcher',
      complexity: 'simple',
      count: 1,
      invocations: '0',
      volume_source: 'daily_users',
      prior_volume_source: null,
      users_per_day: '1',
      invocations_per_user_per_agent_per_day: '1',
      overrides: { model_id: 'Graph Fixture' },
      steps: [],
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      complexity: 'simple',
      count: 1,
      invocations: '0',
      volume_source: 'daily_users',
      prior_volume_source: null,
      users_per_day: '1',
      invocations_per_user_per_agent_per_day: '1',
      overrides: { model_id: 'Graph Fixture' },
      steps: [],
    },
  ];
  fixture.agents[0].steps = [
    modelStep('planner-model', { ...fixture.profiles.simple, model_id: 'Graph Fixture' }),
    {
      ...agentStep('to-researcher', 'researcher', '0.6'),
      low_execution_probability: '0.2',
      high_execution_probability: '1',
    },
    agentStep('to-reviewer', 'reviewer', '0.25'),
    {
      ...agentStep('to-researcher-again', 'researcher', '0.6'),
      low_execution_probability: '0.2',
      high_execution_probability: '1',
    },
  ];
  expect((await request.post('/api/estimates', { data: fixture })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Delegated work fixture/ })
    .click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$6.00/mo');
  const graph = page.getByRole('region', { name: 'Agent invocation graph' });
  await expect(graph).toBeHidden();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await expect(graph).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(graph).toBeHidden();
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await expectBaseVolume(page, 'Researcher', 360, 360);
  const researcherEditor = await openAgentEditor(page, 'Researcher');
  await expect(researcherEditor.getByLabel('Users per agent per day *')).toHaveCount(0);
  await expect(researcherEditor).toContainText('This agent receives work from agent links.');
  await researcherEditor.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();

  await expect(page.getByTestId('cost-expected')).toHaveText('$6.00/mo');
  await expect(page.getByTestId('cost-low')).toHaveText('$3.03/mo');
  await expect(page.getByTestId('cost-high')).toHaveText('$11.93/mo');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  const expectedScenarioEditor = page
    .locator('.scenario-editor-grid article')
    .filter({ has: page.getByRole('heading', { name: 'Expected', exact: true }) });
  await expectedScenarioEditor.getByLabel('Invocation volume ×').fill('2');
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$12.00/mo');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await expectBaseVolume(page, 'Researcher', 360, 360);
  const doubled = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  const doubledResult = await (await request.post('/api/calculate', { data: doubled })).json();
  expect(
    Number(
      doubledResult.scenarios.find((item: { name: string }) => item.name === 'Expected').volumes.researcher
        .total,
    ),
  ).toBeCloseTo(720, 8);
  await page.getByRole('button', { name: 'Scenarios', exact: true }).click();
  await expectedScenarioEditor.getByLabel('Invocation volume ×').fill('1');
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$6.00/mo');

  const savedGraph = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  await fs.writeFile(path.join(artifacts, 'agent-graph-fixture.json'), JSON.stringify(savedGraph, null, 2));
  const cycle = structuredClone(savedGraph);
  cycle.agents[0].prior_volume_source = 'daily_users';
  cycle.agents[0].volume_source = 'derived';
  cycle.agents[2].steps = [agentStep('cycle', 'planner')];
  const cycleResponse = await request.post('/api/calculate', { data: cycle });
  expect(cycleResponse.status()).toBe(422);
  expect(JSON.stringify(await cycleResponse.json())).toContain('cycle');
  const exclusive = structuredClone(savedGraph);
  exclusive.agents[0].steps[1].agent_calls[0].probability = '0.7';
  expect((await request.post('/api/calculate', { data: exclusive })).status()).toBe(422);
  const unsupportedRepetition = structuredClone(savedGraph);
  unsupportedRepetition.agents[0].steps[1].agent_calls[0].multiplicity = '2';
  expect((await request.post('/api/calculate', { data: unsupportedRepetition })).status()).toBe(422);
  const incomplete = structuredClone(savedGraph);
  incomplete.agents[0].users_per_day = null;
  const incompleteResponse = await request.post('/api/calculate', { data: incomplete });
  expect(incompleteResponse.ok()).toBe(true);
  const incompleteResult = await incompleteResponse.json();
  expect(incompleteResult.base_volumes.researcher.complete).toBe(false);
  expect(incompleteResult.scenarios.find((item: { name: string }) => item.name === 'Expected').complete).toBe(
    false,
  );
  const twoCallers = structuredClone(savedGraph);
  twoCallers.agents[2].steps = [
    modelStep('reviewer-model', { ...fixture.profiles.simple, model_id: 'Graph Fixture' }),
    agentStep('reviewer-researcher', 'researcher', '0.5'),
  ];
  const twoCallerResult = await (await request.post('/api/calculate', { data: twoCallers })).json();
  expect(Number(twoCallerResult.base_volumes.researcher.total)).toBeCloseTo(397.5, 8);
  expect(
    Number(twoCallerResult.scenarios.find((item: { name: string }) => item.name === 'Expected').llm_cost),
  ).toBeCloseTo(6.3036, 8);
  const zeroOverride = structuredClone(savedGraph);
  zeroOverride.agents[0].steps[1].low_execution_probability = '0';
  zeroOverride.agents[0].steps[3].low_execution_probability = '0';
  const zeroResult = await (await request.post('/api/calculate', { data: zeroOverride })).json();
  expect(
    Number(
      zeroResult.scenarios.find((item: { name: string }) => item.name === 'Low').volumes.researcher.total,
    ),
  ).toBe(0);

  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  await expect(page.locator('.alert.notice')).toContainText('saved on this computer');
  await page.reload();
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Delegated work fixture/ })
    .click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$6.00/mo');
  await expect(graph).toBeHidden();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await expect(graph.locator('.graph-edge')).toHaveCount(3);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const file = path.join(artifacts, 'agent-graph-budget.xlsx');
  await (await download).saveAs(file);
  const { engine, summary } = await recalculateWorkbook(file);
  const actualScenarioCosts = [1, 2, 3].map((row) => engine.getCellValue({ sheet: summary, col: 1, row }));
  expect(actualScenarioCosts[0]).toBeCloseTo(3.0294, 8);
  expect(actualScenarioCosts[1]).toBeCloseTo(5.9976, 8);
  expect(actualScenarioCosts[2]).toBeCloseTo(11.934, 8);
  const volumeSheet = engine.getSheetId('Volume')!;
  const linksSheet = engine.getSheetId('Agent links')!;
  const researcherPerAgent = engine.getCellValue({ sheet: volumeSheet, col: 8, row: 2 });
  const researcherTotal = engine.getCellValue({ sheet: volumeSheet, col: 9, row: 2 });
  const researcherLink = engine.getCellValue({ sheet: linksSheet, col: 6, row: 4 });
  const repeatedResearcherLink = engine.getCellValue({ sheet: linksSheet, col: 6, row: 6 });
  const reviewerLink = engine.getCellValue({ sheet: linksSheet, col: 6, row: 5 });
  expect(researcherPerAgent).toBeCloseTo(360, 8);
  expect(researcherTotal).toBeCloseTo(360, 8);
  expect(researcherLink).toBeCloseTo(180, 8);
  expect(repeatedResearcherLink).toBeCloseTo(180, 8);
  expect(reviewerLink).toBeCloseTo(75, 8);
  engine.destroy();
  const reimport = await request.post('/api/import/preview', {
    data: await fs.readFile(file),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  expect(reimport.ok()).toBe(true);
  expect((await reimport.json()).errors).toEqual([]);

  await graph
    .locator('.graph-edge')
    .filter({ hasText: 'Researcher' })
    .first()
    .getByRole('button', { name: 'Edit link' })
    .click();
  const callerEditor = page.getByRole('dialog', { name: 'Edit agent' });
  await callerEditor
    .locator('article')
    .filter({ has: page.getByLabel('Step 2 name') })
    .getByText('Step execution details', { exact: true })
    .click();
  await callerEditor.getByLabel('Step 2 execution probability (0–1)').fill('0.5');
  await callerEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(callerEditor).toBeHidden();
  await expect(page.getByTestId('cost-expected')).toHaveText('$5.75/mo');
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$6.00/mo');
  await graph
    .locator('.graph-edge')
    .filter({ hasText: 'Reviewer' })
    .getByRole('button', { name: 'Edit link' })
    .click();
  await callerEditor.getByLabel('Remove step 3').click();
  await callerEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(callerEditor).toBeHidden();
  await expect(page.getByTestId('cost-expected')).toHaveText('$5.63/mo');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  const reviewerEditor = await openAgentEditor(page, 'Reviewer');
  await expect(reviewerEditor.getByLabel('Users per agent per day *')).toBeEnabled();
  await reviewerEditor.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$6.00/mo');
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  const replacement = new ExcelJS.Workbook();
  const replacementSheet = replacement.addWorksheet('Agents');
  replacementSheet.addRow([
    'name',
    'complexity',
    'count',
    'volume_source',
    'users_per_day',
    'invocations_per_user_per_agent_per_day',
    'model_id',
  ]);
  replacementSheet.addRow(['Direct replacement', 'simple', 1, 'daily_users', 1, 1, 'Graph Fixture']);
  const replacementFile = path.join(artifacts, 'agent-graph-replacement.xlsx');
  await replacement.xlsx.writeFile(replacementFile);
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByLabel('Import agent spreadsheet').setInputFiles(replacementFile);
  const importPreview = page.getByRole('dialog', { name: 'Review spreadsheet import' });
  await expect(importPreview).toContainText('3 agent links will be removed');
  await importPreview.getByRole('button', { name: 'Replace inventory' }).click();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await expect(graph.locator('.graph-edge')).toHaveCount(0);
  await expect(page.getByTestId('cost-expected')).toHaveText('$0.24/mo');
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(graph.locator('.graph-edge')).toHaveCount(3);
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByRole('button', { name: 'Reset parameters', exact: true }).click();
  const resetDialog = page.getByRole('dialog', { name: 'Reset execution parameters' });
  await expect(resetDialog).toContainText('link scenario overrides');
  await resetDialog.getByRole('button', { name: 'Reset parameters', exact: true }).click();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await expect(graph.locator('.graph-edge')).toHaveCount(3);
  await expect(page.getByTestId('cost-low')).toHaveText('$4.50/mo');
  await expect(page.getByTestId('cost-high')).toHaveText('$9.00/mo');
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(page.getByTestId('cost-low')).toHaveText('$3.03/mo');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(graph).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'agent-graph-mobile.png'), fullPage: true });
  records.push({
    journey: 'Agent steps, individual volume, scenarios, graph validation, save/reopen, undo, and workbook',
    evidence: 'agent-graph-fixture.json, agent-graph-budget.xlsx, and agent-graph-replacement.xlsx',
    expected: {
      lowUsd: 3.0294,
      expectedUsd: 5.9976,
      highUsd: 11.934,
      researcherTotal: 360,
      reviewerTotal: 75,
      cycleStatus: 422,
      replacementClearsLinks: true,
      doubledExpectedResearcherTotal: 720,
      twoCallerResearcherTotal: 397.5,
      twoCallerExpectedUsd: 6.3036,
      explicitZeroLowResearcherTotal: 0,
    },
    actual: {
      scenarioCosts: actualScenarioCosts,
      researcherPerAgent,
      researcherTotal,
      researcherLink,
      repeatedResearcherLink,
      reviewerLink,
      cycleStatus: cycleResponse.status(),
      doubledExpectedResearcherTotal: Number(
        doubledResult.scenarios.find((item: { name: string }) => item.name === 'Expected').volumes.researcher
          .total,
      ),
      twoCallerResearcherTotal: Number(twoCallerResult.base_volumes.researcher.total),
      twoCallerExpectedUsd: Number(
        twoCallerResult.scenarios.find((item: { name: string }) => item.name === 'Expected').llm_cost,
      ),
      explicitZeroLowResearcherTotal: Number(
        zeroResult.scenarios.find((item: { name: string }) => item.name === 'Low').volumes.researcher.total,
      ),
    },
  });
});

test('Daily users derive per-agent monthly volume across all complexity groups', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Estimate name').fill('Daily volume fixture');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page
    .getByRole('region', { name: 'Agent inventory', exact: true })
    .getByRole('button', { name: 'Bulk add', exact: true })
    .click();
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
  await assignGroupModel(page, 'Simple agents');
  await assignGroupModel(page, 'Medium agents');
  await assignGroupModel(page, 'High agents');
  await expect(page.getByTestId('cost-expected')).toHaveText('$38.34/mo');

  const volumeEditor = await openAgentEditor(page, 'Simple agents');
  await volumeEditor.getByLabel('Users per agent per day *').fill('');
  await expect(volumeEditor.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  const incompleteDraft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  incompleteDraft.agents.find((agent: { name: string }) => agent.name === 'Simple agents').users_per_day =
    null;
  const invalidSave = await page.request.post('/api/estimates', { data: incompleteDraft });
  expect(invalidSave.status()).toBe(422);
  expect((await invalidSave.json()).detail).toContain('required');
  await volumeEditor.getByLabel('Users per agent per day *').fill('2');
  await volumeEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expectBaseVolume(page, 'Simple agents', 180, 360);
  await expectBaseVolume(page, 'Medium agents', 60, 60);
  await expectBaseVolume(page, 'High agents', 60, 60);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const expectedMonthlyTokens = [918000, 1764000, 11220000];
  const expectedDailyTokens = [30600, 58800, 374000];
  await expect(page.getByTestId('cost-expected')).toHaveText('$38.34/mo');
  const expectedCategoryCosts = [2.9376, 5.04, 30.36];
  const expectedDailyCategoryCosts = [0.09792, 0.168, 1.012];
  const expectedInputTokens = [734400, 1512000, 9900000];
  const expectedOutputTokens = [183600, 252000, 1320000];
  const expectedInputCosts = [1.4688, 3.024, 19.8];
  const expectedOutputCosts = [1.4688, 2.016, 10.56];
  await expect(page.getByTestId('monthly-summary-expected-total-tokens')).toHaveText('13,902,000');
  await expect(page.getByTestId('monthly-summary-expected-input-tokens')).toHaveText('12,146,400');
  await expect(page.getByTestId('monthly-summary-expected-output-tokens')).toHaveText('1,755,600');
  await expect(page.getByTestId('monthly-summary-expected-input-cost')).toHaveText('$24.2928');
  await expect(page.getByTestId('monthly-summary-expected-output-cost')).toHaveText('$14.0448');
  await expect(page.getByTestId('monthly-summary-expected-total-cost')).toHaveText('$38.3376');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await openAgentEditor(page, 'Medium agents');
  await volumeEditor.getByLabel('Invocations per user per agent per day *').fill('0');
  await volumeEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$33.30/mo');
  await expectBaseVolume(page, 'Medium agents', 0, 0);
  await openAgentEditor(page, 'Medium agents');
  await volumeEditor.getByLabel('Invocations per user per agent per day *').fill('2');
  await volumeEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$38.34/mo');

  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Daily volume fixture/ })
    .click();
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await expectBaseVolume(page, 'High agents', 60, 60);
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
  const costSheet = engine.getSheetId('Category costs')!;
  const monthlySummary = engine.getSheetId('Monthly category summary')!;
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
  const expectedCategoryCostRows = [5, 10, 15];
  for (const [i, row] of expectedCategoryCostRows.entries()) {
    expect(engine.getCellValue({ sheet: costSheet, col: 3, row })).toBeCloseTo(expectedCategoryCosts[i], 8);
    expect(engine.getCellValue({ sheet: costSheet, col: 7, row })).toBeCloseTo(
      expectedDailyCategoryCosts[i],
      8,
    );
    const summaryRow = i + 1;
    expect(engine.getCellValue({ sheet: monthlySummary, col: 1, row: summaryRow })).toBeCloseTo(
      expectedInputTokens[i],
      8,
    );
    expect(engine.getCellValue({ sheet: monthlySummary, col: 2, row: summaryRow })).toBeCloseTo(
      expectedInputCosts[i],
      8,
    );
    expect(engine.getCellValue({ sheet: monthlySummary, col: 3, row: summaryRow })).toBeCloseTo(
      expectedOutputTokens[i],
      8,
    );
    expect(engine.getCellValue({ sheet: monthlySummary, col: 4, row: summaryRow })).toBeCloseTo(
      expectedOutputCosts[i],
      8,
    );
    expect(engine.getCellValue({ sheet: monthlySummary, col: 6, row: summaryRow })).toBeCloseTo(
      expectedCategoryCosts[i],
      8,
    );
  }
  expect(engine.getCellValue({ sheet: monthlySummary, col: 1, row: 4 })).toBeCloseTo(12146400, 8);
  expect(engine.getCellValue({ sheet: monthlySummary, col: 2, row: 4 })).toBeCloseTo(24.2928, 8);
  expect(engine.getCellValue({ sheet: monthlySummary, col: 3, row: 4 })).toBeCloseTo(1755600, 8);
  expect(engine.getCellValue({ sheet: monthlySummary, col: 4, row: 4 })).toBeCloseTo(14.0448, 8);
  expect(engine.getCellValue({ sheet: monthlySummary, col: 6, row: 4 })).toBeCloseTo(38.3376, 8);
  expect(engine.getCellValue({ sheet: costSheet, col: 2, row: 1 })).toBeCloseTo(734400, 6);
  expect(engine.getCellValue({ sheet: costSheet, col: 3, row: 1 })).toBeCloseTo(1.4688, 8);
  expect(engine.getCellValue({ sheet: costSheet, col: 6, row: 1 })).toBeCloseTo(24480, 8);
  expect(engine.getCellValue({ sheet: costSheet, col: 7, row: 1 })).toBeCloseTo(0.04896, 8);
  expect(engine.getCellValue({ sheet: costSheet, col: 4, row: 1 })).toBeCloseTo(2, 8);
  expect(engine.getCellValue({ sheet: costSheet, col: 2, row: 4 })).toBeCloseTo(183600, 6);
  expect(engine.getCellValue({ sheet: costSheet, col: 3, row: 4 })).toBeCloseTo(1.4688, 8);
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
      categoryCosts: expectedCategoryCosts,
      dailyCategoryCosts: expectedDailyCategoryCosts,
      monthlyInputTokens: expectedInputTokens,
      monthlyOutputTokens: expectedOutputTokens,
      monthlyInputCosts: expectedInputCosts,
      monthlyOutputCosts: expectedOutputCosts,
      suiteMonthlySummary: {
        inputTokens: 12146400,
        inputUsd: 24.2928,
        outputTokens: 1755600,
        outputUsd: 14.0448,
        llmUsd: 38.3376,
      },
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
      categoryCosts: expectedCategoryCostRows.map((row) =>
        engine.getCellValue({ sheet: costSheet, col: 3, row }),
      ),
      dailyCategoryCosts: expectedCategoryCostRows.map((row) =>
        engine.getCellValue({ sheet: costSheet, col: 7, row }),
      ),
      monthlyInputTokens: expectedInputTokens.map((_, i) =>
        engine.getCellValue({ sheet: monthlySummary, col: 1, row: i + 1 }),
      ),
      monthlyOutputTokens: expectedOutputTokens.map((_, i) =>
        engine.getCellValue({ sheet: monthlySummary, col: 3, row: i + 1 }),
      ),
      monthlyInputCosts: expectedInputCosts.map((_, i) =>
        engine.getCellValue({ sheet: monthlySummary, col: 2, row: i + 1 }),
      ),
      monthlyOutputCosts: expectedOutputCosts.map((_, i) =>
        engine.getCellValue({ sheet: monthlySummary, col: 4, row: i + 1 }),
      ),
      suiteMonthlySummary: {
        inputTokens: engine.getCellValue({ sheet: monthlySummary, col: 1, row: 4 }),
        inputUsd: engine.getCellValue({ sheet: monthlySummary, col: 2, row: 4 }),
        outputTokens: engine.getCellValue({ sheet: monthlySummary, col: 3, row: 4 }),
        outputUsd: engine.getCellValue({ sheet: monthlySummary, col: 4, row: 4 }),
        llmUsd: engine.getCellValue({ sheet: monthlySummary, col: 6, row: 4 }),
      },
    },
  });
  engine.destroy();

  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
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
    'model_id',
  ]);
  agents.addRow(['Imported daily', 'simple', 1, 'daily_users', 2, 3, 'Fixture A']);
  await inputWorkbook.xlsx.writeFile(inputFile);
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByLabel('Import agent spreadsheet').setInputFiles(inputFile);
  const dailyPreview = page.getByRole('dialog', { name: 'Review spreadsheet import' });
  await dailyPreview.getByRole('button', { name: 'Replace inventory' }).click();
  await expectBaseVolume(page, 'Imported daily', 180, 180);
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

  await page
    .getByRole('region', { name: 'Agent inventory', exact: true })
    .getByRole('button', { name: 'Add agent', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: 'Add agent' });
  await editor.getByLabel('Agent name').fill('Another simple group');
  await editor.getByLabel('Users per agent per day *').fill('1');
  await editor.getByLabel('Invocations per user per agent per day *').fill('1');
  await chooseModel(page, editor.getByRole('button', { name: 'Step 1 model name: Select model' }));
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expectBaseVolume(page, 'Another simple group', 30, 30);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$1.71/mo');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  const countEditor = await openAgentEditor(page, 'Another simple group');
  await countEditor.getByLabel('Agent count').fill('2');
  await countEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expectBaseVolume(page, 'Another simple group', 30, 60);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
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

  await addModel(page, 'Fixture B', '4', '10');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await openAgentEditor(page, 'Another simple group');
  const mixedEditor = page.getByRole('dialog', { name: 'Edit agent' });
  await chooseModel(
    page,
    mixedEditor.getByRole('button', { name: 'Step 1 model name: Fixture A' }),
    'Fixture B',
  );
  await mixedEditor.getByRole('button', { name: 'Apply changes' }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByTestId('monthly-summary-expected-input-tokens')).toHaveText('489,600');
  await expect(page.getByTestId('monthly-summary-expected-input-cost')).toHaveText('$1.224');
  await expect(page.getByTestId('monthly-summary-expected-output-tokens')).toHaveText('122,400');
  await expect(page.getByTestId('monthly-summary-expected-output-cost')).toHaveText('$1.0404');
  await expect(page.getByTestId('monthly-summary-expected-total-cost')).toHaveText('$2.2644');
  const mixedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const mixedFile = path.join(artifacts, 'mixed-model-category-budget.xlsx');
  await (await mixedDownload).saveAs(mixedFile);
  const { engine: mixedEngine, summary: mixedSummary } = await recalculateWorkbook(mixedFile);
  const mixedCosts = mixedEngine.getSheetId('Category costs')!;
  const mixedMonthlySummary = mixedEngine.getSheetId('Monthly category summary')!;
  const mixedCalculations = mixedEngine.getSheetId('Calculations')!;
  const mixedSuiteCost = mixedEngine.getCellValue({ sheet: mixedSummary, col: 1, row: 2 });
  const mixedCategoryCost = mixedEngine.getCellValue({ sheet: mixedCosts, col: 3, row: 5 });
  const mixedDailyCategoryCost = mixedEngine.getCellValue({ sheet: mixedCosts, col: 7, row: 5 });
  const mixedDailyInputCost = mixedEngine.getCellValue({ sheet: mixedCosts, col: 7, row: 1 });
  const modelBInputTokens = mixedEngine.getCellValue({ sheet: mixedCalculations, col: 32, row: 4 });
  expect(mixedSuiteCost).toBeCloseTo(2.2644, 8);
  expect(mixedCategoryCost).toBeCloseTo(2.2644, 8);
  expect(mixedDailyCategoryCost).toBeCloseTo(0.07548, 8);
  expect(mixedDailyInputCost).toBeCloseTo(0.0408, 8);
  expect(mixedEngine.getCellValue({ sheet: mixedMonthlySummary, col: 1, row: 1 })).toBeCloseTo(489600, 8);
  expect(mixedEngine.getCellValue({ sheet: mixedMonthlySummary, col: 2, row: 1 })).toBeCloseTo(1.224, 8);
  expect(mixedEngine.getCellValue({ sheet: mixedMonthlySummary, col: 3, row: 1 })).toBeCloseTo(122400, 8);
  expect(mixedEngine.getCellValue({ sheet: mixedMonthlySummary, col: 4, row: 1 })).toBeCloseTo(1.0404, 8);
  expect(mixedEngine.getCellValue({ sheet: mixedMonthlySummary, col: 6, row: 4 })).toBeCloseTo(2.2644, 8);
  expect(modelBInputTokens).toBeCloseTo(122400, 8);
  records.push({
    journey: 'Two models with different rates in one category',
    evidence: mixedFile,
    expected: {
      suiteUsd: 2.2644,
      categoryUsd: 2.2644,
      dailyCategoryUsd: 0.07548,
      dailyInputUsd: 0.0408,
      modelBInputTokens: 122400,
    },
    actual: {
      suiteUsd: mixedSuiteCost,
      categoryUsd: mixedCategoryCost,
      dailyCategoryUsd: mixedDailyCategoryCost,
      dailyInputUsd: mixedDailyInputCost,
      modelBInputTokens,
    },
  });
  mixedEngine.destroy();
});

test('Individual overrides, zero output, detailed replacement and incomplete prices', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await openAgentEditor(page, 'Simple agents');
  await page
    .getByRole('dialog', { name: 'Edit agent' })
    .getByRole('button', { name: 'Customize one agent', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await expect(editor.getByLabel('Agent name')).toHaveValue('Simple agent 2');
  await editor.getByLabel('Output tokens / call', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$12.24/mo');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Agent inventory', exact: true }).locator('.count-chip'),
  ).toHaveText('2');

  await openAgentEditor(page, 'Simple agents');
  await page.getByRole('button', { name: 'Use detailed workflow' }).click();
  await editor.getByText('Step execution details', { exact: true }).click();
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

  await openAgentEditor(page, 'Simple agent 2');
  await editor.getByLabel('Cached read fraction', { exact: true }).fill('0.5');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('.scenario-card.featured')).toContainText('Incomplete');
  await expect(page.getByTestId('cost-expected')).toHaveText('$8.00/mo');
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select agent Simple agent 2' })).toContainText(
    'Incomplete LLM cost',
  );
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Agent inventory', exact: true }).locator('.count-chip'),
  ).toHaveText('2');
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
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  const inventory = page.getByRole('region', { name: 'Agent inventory', exact: true });
  const spreadsheetChooser = page.waitForEvent('filechooser');
  await inventory.getByRole('button', { name: 'Import', exact: true }).click();
  await (await spreadsheetChooser).setFiles(valid);
  await expect(page.getByRole('dialog', { name: 'Review spreadsheet import' })).toContainText('2 agents');
  await page.getByRole('button', { name: 'Replace inventory' }).click();
  await expect(
    inventory.getByRole('button', { name: 'Edit =literal agent name 1', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  await inventory
    .locator('.section-heading')
    .screenshot({ path: path.join(artifacts, 'agents-actions-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await inventory
    .locator('.section-heading')
    .screenshot({ path: path.join(artifacts, 'agents-actions-mobile.png') });
  await page.setViewportSize({ width: 1512, height: 1050 });
  const templateDownload = page.waitForEvent('download');
  await inventory.getByRole('link', { name: 'Template', exact: true }).click();
  await (await templateDownload).saveAs(path.join(artifacts, 'agents-actions-template.xlsx'));
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
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByLabel('Import agent spreadsheet').setInputFiles(invalid);
  await expect(page.getByRole('dialog', { name: 'Review spreadsheet import' })).toContainText(
    'formulas are not allowed',
  );
  await expect(page.getByRole('button', { name: 'Replace inventory' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Cached read fraction', { exact: true }).first().fill('0.8');
  await page.getByRole('button', { name: /Dashboard/ }).click();
  sheet.getCell('F2').value = 1;
  const cacheFixture = new ExcelJS.Workbook();
  const cacheSheet = cacheFixture.addWorksheet('Agents');
  cacheSheet.addRow([...sheet.getRow(1).values.slice(1), 'cache_write_fraction']);
  cacheSheet.addRow([...sheet.getRow(2).values.slice(1), 0.3]);
  const invalidCombination = path.join(artifacts, 'invalid-cache-import.xlsx');
  await cacheFixture.xlsx.writeFile(invalidCombination);
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByLabel('Import agent spreadsheet').setInputFiles(invalidCombination);
  const cachePreview = page.getByRole('dialog', { name: 'Review spreadsheet import' });
  await expect(cachePreview).toContainText('Row 2, cache_fraction/cache_write_fraction');
  await expect(cachePreview.getByRole('button', { name: 'Replace inventory' })).toBeDisabled();
  await cachePreview.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Cached read fraction', { exact: true }).first().fill('0');
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$16.32/mo');
  sheet.getCell('E2').value = 'unknown/provider-model';
  const unknown = path.join(artifacts, 'unpriced-import.xlsx');
  await fixture.xlsx.writeFile(unknown);
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByLabel('Import agent spreadsheet').setInputFiles(large);
  await page.getByRole('button', { name: 'Replace inventory' }).click();
  await expect(page.getByTestId('cost-expected')).toHaveText('$244.80/mo');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Agent inventory', exact: true }).locator('.count-chip'),
  ).toHaveText('300');
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
  };
  fixture.agents = [
    {
      id: 'tier-agent',
      name: 'Tiered agent',
      complexity: 'simple',
      count: 1,
      invocations: '10',
      overrides: { model_id: 'Tier Fixture' },
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
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByTestId('monthly-summary-expected-total-cost')).toHaveText('$3.83');
  await expect(page.getByTestId('monthly-summary-expected-input-tokens')).toHaveText('2,000,000');
  await expect(page.getByTestId('monthly-summary-expected-input-cost')).toHaveText('$3.75');
  await expect(page.getByTestId('monthly-summary-expected-output-tokens')).toHaveText('10,000');
  await expect(page.getByTestId('monthly-summary-expected-output-cost')).toHaveText('$0.08');
  const scenarioSummary = page.getByRole('region', { name: 'Monthly token and cost summary' });
  for (const [name, values] of [
    ['Low', ['1,500,000', '$2.8125', '7,500', '$0.06', '1,507,500', '$2.8725', '$0.00', '$0.00', '$2.8725']],
    ['Expected', ['2,000,000', '$3.75', '10,000', '$0.08', '2,010,000', '$3.83', '$0.00', '$0.00', '$3.83']],
    ['High', ['3,000,000', '$11.25', '15,000', '$0.18', '3,015,000', '$11.43', '$0.00', '$0.00', '$11.43']],
  ] as const) {
    await expect(scenarioSummary.getByRole('row', { name, exact: true }).getByRole('cell')).toHaveText([
      ...values,
    ]);
  }
  const tierPreview = await request.post('/api/sensitivity', {
    data: { estimate: fixture, row_id: 'tier-agent', field: 'input_tokens', value: '200001' },
  });
  expect(tierPreview.ok()).toBe(true);
  const tierNumbers = await tierPreview.json();
  expect(Number(tierNumbers.proposed_suite_cost)).toBeCloseTo(7.6200375, 8);
  expect(Number(tierNumbers.suite_delta)).toBeCloseTo(3.7900375, 8);
  await expect(page.getByTestId('cost-expected')).toHaveText('$3.83/mo');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const exported = path.join(artifacts, 'tier-cache-budget.xlsx');
  await (await download).saveAs(exported);
  const { engine, summary } = await recalculateWorkbook(exported);
  const actual = [1, 2, 3].map((row) => engine.getCellValue({ sheet: summary, col: 1, row }));
  expect(actual[0]).toBeCloseTo(2.8725, 8);
  expect(actual[1]).toBeCloseTo(3.83, 8);
  expect(actual[2]).toBeCloseTo(11.43, 8);
  const categoryCosts = engine.getSheetId('Category costs')!;
  const scenarioSheet = engine.getSheetId('Monthly scenario summary')!;
  for (const [row, values] of [
    [1500000, 2.8125, 7500, 0.06, 1507500, 2.8725, 0, 0, 2.8725],
    [2000000, 3.75, 10000, 0.08, 2010000, 3.83, 0, 0, 3.83],
    [3000000, 11.25, 15000, 0.18, 3015000, 11.43, 0, 0, 11.43],
  ].entries()) {
    for (const [column, expectedValue] of values.entries()) {
      expect(engine.getCellValue({ sheet: scenarioSheet, row: row + 1, col: column + 1 })).toBeCloseTo(
        expectedValue,
        8,
      );
    }
  }
  const monthlySummary = engine.getSheetId('Monthly category summary')!;
  const expectedComponents = [2, 0.25, 1.5, 0.08];
  for (const [i, expectedCost] of expectedComponents.entries()) {
    expect(engine.getCellValue({ sheet: categoryCosts, col: 3, row: i + 1 })).toBeCloseTo(expectedCost, 8);
  }
  expect(engine.getCellValue({ sheet: categoryCosts, col: 3, row: 5 })).toBeCloseTo(3.83, 8);
  expect(engine.getCellValue({ sheet: categoryCosts, col: 7, row: 5 })).toBeCloseTo(3.83 / 30, 8);
  expect(engine.getCellValue({ sheet: categoryCosts, col: 6, row: 1 })).toBeCloseTo(1000000 / 30, 5);
  expect(engine.getCellValue({ sheet: categoryCosts, col: 7, row: 2 })).toBeCloseTo(0.25 / 30, 8);
  expect(engine.getCellValue({ sheet: monthlySummary, col: 1, row: 1 })).toBeCloseTo(2000000, 8);
  expect(engine.getCellValue({ sheet: monthlySummary, col: 2, row: 1 })).toBeCloseTo(3.75, 8);
  expect(engine.getCellValue({ sheet: monthlySummary, col: 3, row: 1 })).toBeCloseTo(10000, 8);
  expect(engine.getCellValue({ sheet: monthlySummary, col: 4, row: 1 })).toBeCloseTo(0.08, 8);
  expect(engine.getCellValue({ sheet: monthlySummary, col: 6, row: 4 })).toBeCloseTo(3.83, 8);
  const actualComponents = expectedComponents.map((_, i) =>
    engine.getCellValue({ sheet: categoryCosts, col: 3, row: i + 1 }),
  );
  engine.destroy();
  records.push({
    journey: 'Per-call context tiers + cache reads/writes',
    evidence: exported,
    expected: {
      scenarios: [2.8725, 3.83, 11.43],
      components: expectedComponents,
      thresholdPreviewUsd: 7.6200375,
      thresholdDeltaUsd: 3.7900375,
    },
    actual: {
      scenarios: actual,
      components: actualComponents,
      thresholdPreviewUsd: Number(tierNumbers.proposed_suite_cost),
      thresholdDeltaUsd: Number(tierNumbers.suite_delta),
    },
  });
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await openAgentEditor(page, 'Tiered agent');
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
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
  await assignGroupModel(page, 'Simple agents', 'deepseek/deepseek-coder');
  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
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
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page
    .getByRole('region', { name: 'Agent inventory', exact: true })
    .getByRole('button', { name: 'Bulk add', exact: true })
    .click();
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
  await assignGroupModel(page, 'Simple agents', modelId);
  await expect(page.getByTestId('cost-expected')).toHaveText('$3.44/mo');

  await page.getByRole('button', { name: 'Complexity profiles', exact: true }).click();
  await page.getByLabel('Cached read fraction', { exact: true }).first().fill('0.5');
  await expect(page.getByTestId('cost-expected')).toHaveText('$2.75/mo');
  await page.getByLabel('Cache write fraction', { exact: true }).first().fill('0.25');
  await expect(page.getByTestId('cost-expected')).toContainText('Incomplete');
  await expect(page.getByRole('alert')).toContainText('Missing cache write price');
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await expect(page.getByTestId('monthly-summary-expected-input-tokens')).toContainText('2,040,000');
  await expect(page.getByTestId('monthly-summary-expected-input-cost')).toHaveText('Incomplete');
  await expect(page.getByTestId('monthly-summary-expected-output-cost')).toHaveText('Incomplete');
  await expect(page.getByTestId('monthly-summary-expected-total-cost')).toHaveText('Incomplete');
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
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page
    .getByRole('region', { name: 'Agent inventory', exact: true })
    .getByRole('button', { name: 'Bulk add', exact: true })
    .click();
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

  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  const dailyEditor = await openAgentEditor(page, 'Simple agents');
  await dailyEditor.getByLabel('Invocations per user per agent per day *').fill('1');
  const users = dailyEditor.getByLabel('Users per agent per day *');
  await users.click();
  await page.keyboard.type('25');
  await expect(users).toHaveValue('25');
  const enteredUsers = await users.inputValue();
  await dailyEditor.getByRole('button', { name: 'Apply changes' }).click();
  await expectBaseVolume(page, 'Simple agents', 750, 1500);
  await expect(page.getByTestId('cost-expected')).toHaveText('$15.30/mo');

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
