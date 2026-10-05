import { modelStep, agentStep } from './workflow-fixtures';
import { test, expect } from '@playwright/test';
import { HyperFormula } from 'hyperformula';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';

test('inventory edits one linked group member and preserves reconciled costs', async ({ page, request }) => {
  const directory = path.resolve('artifacts/agent-inventory');
  await fs.mkdir(directory, { recursive: true });
  const estimate = await (await request.get('/api/new')).json();
  estimate.id = `inventory-${Date.now()}`;
  estimate.name = 'Inventory journey fixture';
  estimate.prices = {
    'Fixture model': {
      id: 'Fixture model',
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
    'Fixture review model': {
      id: 'Fixture review model',
      provider: 'Synthetic fixture',
      input: '1',
      output: '4',
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
  estimate.prices['Fixture unpriced model'] = {
    ...estimate.prices['Fixture review model'],
    id: 'Fixture unpriced model',
    input: null,
    output: null,
  };
  const step = (id: string) =>
    modelStep(id, {
      calls: '1',
      input_tokens: '1000',
      output_tokens: '100',
      retry_rate: '0',
      cache_fraction: '0',
      cache_write_fraction: '0',
      model_id: 'Fixture model',
    });
  const row = (id: string, name: string, members: string[], source: 'daily_users' | 'derived') => ({
    id,
    name,
    description: '',
    use_case_name: name,
    use_case_description: '',
    members: members.map((member, index) => ({
      id: `${id}-${index + 1}`,
      name: member,
      business_use_case_description: `${member} business use case`,
    })),
    complexity: 'simple',
    count: members.length,
    invocations: '0',
    volume_source: source,
    prior_volume_source: source === 'derived' ? 'daily_users' : null,
    users_per_day: source === 'derived' ? '0' : '1',
    invocations_per_user_per_agent_per_day: source === 'derived' ? '0' : '10',
    overrides: {},
    steps: [step(`${id}-step`)],
    tool_costs: [],
  });
  estimate.agents = [
    row('planner', 'Planner group', ['Planner A', 'Planner B'], 'daily_users'),
    row('research', 'Research', ['Research'], 'derived'),
    row('reviewer', 'Reviewer', ['Reviewer'], 'derived'),
  ];
  estimate.agents[0].steps.push(agentStep('planner-research', 'research-1', '0.5'));
  estimate.agents[1].steps.push(agentStep('research-reviewer', 'reviewer-1', '0.4'));
  await fs.writeFile(path.join(directory, 'input.json'), JSON.stringify(estimate, null, 2));
  const initialResult = await (await request.post('/api/calculate', { data: estimate })).json();
  const baselineCost = Number(
    initialResult.scenarios.find((scenario: { name: string }) => scenario.name === 'Expected').llm_cost,
  );
  expect(baselineCost).toBeCloseTo(2.856, 9);
  await page.addInitScript((draft) => {
    if (!localStorage.getItem('agent-ledger-draft-v1'))
      localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft));
  }, estimate);
  await page.goto('/');
  await expect(page.getByTestId('cost-expected')).toContainText('$2.86');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  const inventory = page.getByRole('region', { name: 'Agent inventory' });
  await expect(inventory.locator('tbody tr')).toHaveCount(4);
  await expect(inventory.getByRole('columnheader', { name: 'USE CASE NAME' })).toBeVisible();
  await expect(inventory.getByRole('columnheader', { name: 'TOTAL COST' })).toBeVisible();
  const plannerA = inventory.locator('tr').filter({ hasText: 'Planner A' });
  const plannerB = inventory.locator('tr').filter({ hasText: 'Planner B' });
  const research = inventory.locator('tr').filter({ hasText: 'Research' });
  const reviewer = inventory.locator('tr').filter({ hasText: 'Reviewer' });
  await expect(plannerA.locator('td').nth(1)).toHaveText('Planner group');
  await expect(plannerA.locator('td').nth(7)).toHaveText('$0.84/mo');
  await expect(plannerB.locator('td').nth(7)).toHaveText('$0.84/mo');
  await expect(research.locator('td').nth(7)).toHaveText('$0.84/mo');
  await expect(reviewer.locator('td').nth(7)).toHaveText('$0.34/mo');
  await expect(plannerA.locator('td').nth(2)).toHaveText('2');
  await expect(plannerA.locator('td').nth(4)).toHaveText('1');
  await expect(plannerA.locator('td').nth(5)).toHaveText('1');
  await expect(plannerA.locator('td').nth(6)).toHaveText('10');
  await expect(research.locator('td').nth(3)).toHaveText('2');
  await expect(research.locator('td').nth(4)).toHaveText('1');
  const researchCallers = Number(await research.locator('td').nth(3).innerText());

  await inventory.getByRole('button', { name: 'Edit Planner A' }).click();
  await page
    .getByRole('dialog', { name: 'Edit agent' })
    .getByRole('button', { name: 'Close dialog' })
    .click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!).agents.length),
  ).toBe(3);
  await inventory.getByRole('button', { name: 'Edit Planner A' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await expect(editor.getByLabel('Agent name')).toHaveValue('Planner A');
  await expect(editor.getByLabel('Agent count')).toHaveCount(0);
  await expect(editor.getByLabel('Business use case name')).toBeVisible();
  await expect(editor.getByLabel('Business use case completed by one invocation')).toHaveCount(0);
  await expect(editor.getByLabel('Complexity', { exact: true })).toHaveCount(0);
  await expect(editor.getByText('Agent identities')).toHaveCount(0);
  await expect(editor.getByLabel('Agent 1 ID')).toHaveCount(0);
  await expect(editor.getByText('Execution assumptions')).toHaveCount(0);
  await expect(editor.getByRole('region', { name: 'Agent steps' })).toBeVisible();
  const agentCost = editor.getByRole('region', { name: 'Agent cost' });
  const readAgentCost = async (values: string[]) => {
    await expect(agentCost.getByRole('cell')).toHaveText(values);
    return agentCost.getByRole('cell').allTextContents();
  };
  const initialAgentCost = await readAgentCost(['300,000', '$0.60', '30,000', '$0.24', '$0.84']);
  const stepCost = (index: number) => editor.getByRole('region', { name: `Step ${index} cost`, exact: true });
  await expect(stepCost(1).getByRole('cell')).toHaveText(initialAgentCost);
  await expect(editor.getByRole('button', { name: 'Step 1 model name: Fixture model' })).toBeVisible();
  await editor.screenshot({ path: path.join(directory, 'edit-agent-panel.png') });
  await editor.getByLabel('Agent name').fill('Planner A tuned');
  await editor.getByLabel('Business use case name').fill('Plan support response');
  await editor.getByLabel('Business use case description', { exact: true }).fill('Plans complex requests');
  await editor.getByLabel('Users per agent per day *').fill('2');
  await editor.getByRole('button', { name: 'Copy step' }).first().click();
  await editor.getByLabel('Step 2 name').fill('Review plan');
  await editor.getByLabel('Step 2 complexity profile').selectOption('medium');
  await editor.getByRole('button', { name: 'Step 2 model name: Fixture model' }).click();
  await page
    .getByRole('dialog', { name: 'Choose a model' })
    .getByRole('button', { name: /Fixture review model/ })
    .click();
  const editedAgentCost = await readAgentCost(['1,200,000', '$1.80', '120,000', '$0.72', '$2.52']);
  const mainStepCost = ['600,000', '$1.20', '60,000', '$0.48', '$1.68'];
  const reviewStepCost = ['600,000', '$0.60', '60,000', '$0.24', '$0.84'];
  await expect(stepCost(1).getByRole('cell')).toHaveText(mainStepCost);
  await expect(stepCost(2).getByRole('cell')).toHaveText(reviewStepCost);
  const editedStepCosts = [
    await stepCost(1).getByRole('cell').allTextContents(),
    await stepCost(2).getByRole('cell').allTextContents(),
  ];
  await editor.getByRole('button', { name: 'Step 2 model name: Fixture review model' }).click();
  await page
    .getByRole('dialog', { name: 'Choose a model' })
    .getByRole('button', { name: /Fixture unpriced model/ })
    .click();
  await expect(stepCost(1).getByRole('cell')).toHaveText(mainStepCost);
  await expect(stepCost(2).getByRole('cell')).toHaveText([
    '600,000',
    'Incomplete',
    '60,000',
    'Incomplete',
    'Incomplete',
  ]);
  await readAgentCost(['1,200,000', '$1.20 (partial)', '120,000', '$0.48 (partial)', '$1.68 (partial)']);
  await editor.getByRole('button', { name: 'Step 2 model name: Fixture unpriced model' }).click();
  await page
    .getByRole('dialog', { name: 'Choose a model' })
    .getByRole('button', { name: /Fixture review model/ })
    .click();
  await expect(stepCost(2).getByRole('cell')).toHaveText(reviewStepCost);
  const reviewStep = editor.locator('article').filter({ has: page.getByLabel('Step 2 name') });
  await reviewStep.getByText('Step execution details', { exact: true }).click();
  await editor.getByLabel('Step 2 execution probability (0–1)').fill('0.5');
  await expect(stepCost(2).getByRole('cell')).toHaveText(['300,000', '$0.30', '30,000', '$0.12', '$0.42']);
  await readAgentCost(['900,000', '$1.50', '90,000', '$0.60', '$2.10']);
  await editor.getByLabel('Step 2 execution probability (0–1)').fill('0');
  await expect(stepCost(2).getByRole('cell')).toHaveText(['0', '$0.00', '0', '$0.00', '$0.00']);
  await readAgentCost(mainStepCost);
  await editor.getByLabel('Step 2 execution probability (0–1)').fill('1');
  await expect(stepCost(2).getByRole('cell')).toHaveText(reviewStepCost);
  await reviewStep.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(editor.getByLabel('Step 1 name')).toHaveValue('Review plan');
  await expect(stepCost(1).getByRole('cell')).toHaveText(reviewStepCost);
  await expect(stepCost(2).getByRole('cell')).toHaveText(mainStepCost);
  await editor
    .locator('article')
    .filter({ has: page.getByLabel('Step 2 name') })
    .getByRole('button', { name: 'Move up', exact: true })
    .click();
  await expect(stepCost(1).getByRole('cell')).toHaveText(mainStepCost);
  await expect(stepCost(2).getByRole('cell')).toHaveText(reviewStepCost);
  await reviewStep.screenshot({ path: path.join(directory, 'edit-step-cost.png') });
  // Previewing must not split or persist the selected member before Apply.
  const previewDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!));
  expect(previewDraft.agents).toHaveLength(3);
  expect(previewDraft.agents[0].users_per_day).toBe('1');
  await agentCost.screenshot({ path: path.join(directory, 'edit-agent-cost.png') });
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByTestId('cost-expected')).toContainText('$5.12');
  const tuned = inventory.locator('tr').filter({ hasText: 'Planner A tuned' });
  await expect(tuned.locator('td').nth(1)).toHaveText('Plan support response');
  await expect(tuned.locator('td').nth(7)).toHaveText('$2.52/mo');
  await expect(plannerB.locator('td').nth(7)).toHaveText('$0.84/mo');
  await expect(research.locator('td').nth(7)).toHaveText('$1.26/mo');
  await expect(reviewer.locator('td').nth(7)).toHaveText('$0.50/mo');
  await expect(tuned.locator('td').nth(2)).toHaveText('3');
  await expect(tuned.locator('td').nth(5)).toHaveText('2');
  await expect(research.locator('td').nth(3)).toHaveText('2');

  await inventory.getByRole('button', { name: 'Edit Research', exact: true }).click();
  const derivedAgentCost = await readAgentCost(['450,000', '$0.90', '45,000', '$0.36', '$1.26']);
  await expect(stepCost(1).getByRole('cell')).toHaveText(derivedAgentCost);
  await editor.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const monthlySummary = page.getByRole('region', { name: 'Monthly token and cost summary' });
  await expect(monthlySummary.locator('tbody tr')).toHaveCount(3);
  const scenarioSummaryExpected = [
    ['Low', ['1,597,500', '$2.745', '159,750', '$1.098', '1,757,250', '$3.843', '$0.00', '$0.00', '$3.843']],
    [
      'Expected',
      ['2,130,000', '$3.66', '213,000', '$1.464', '2,343,000', '$5.124', '$0.00', '$0.00', '$5.124'],
    ],
    ['High', ['3,195,000', '$5.49', '319,500', '$2.196', '3,514,500', '$7.686', '$0.00', '$0.00', '$7.686']],
  ] as const;
  const displayedScenarioSummaries: Record<string, string[]> = {};
  for (const [name, values] of scenarioSummaryExpected) {
    const row = monthlySummary.getByRole('row', { name, exact: true });
    await expect(row.getByRole('cell')).toHaveText([...values]);
    displayedScenarioSummaries[name] = await row.getByRole('cell').allTextContents();
  }
  await expect(monthlySummary.getByTestId('monthly-summary-expected-input-tokens')).toHaveText('2,130,000');
  await expect(monthlySummary.getByTestId('monthly-summary-expected-output-tokens')).toHaveText('213,000');
  await expect(monthlySummary.getByTestId('monthly-summary-expected-total-tokens')).toHaveText('2,343,000');
  await expect(monthlySummary.getByTestId('monthly-summary-expected-input-cost')).toHaveText('$3.66');
  await expect(monthlySummary.getByTestId('monthly-summary-expected-output-cost')).toHaveText('$1.464');
  await expect(monthlySummary.getByTestId('monthly-summary-expected-total-cost')).toHaveText('$5.124');
  const dashboardMonthlySummaryUsd = Number(
    (await monthlySummary.getByTestId('monthly-summary-expected-total-cost').innerText()).replace(
      /[^\d.]/g,
      '',
    ),
  );
  await page.screenshot({ path: path.join(directory, 'dashboard-summary.png'), fullPage: true });

  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  const saved = await (await request.get(`/api/estimates/${estimate.id}`)).json();
  await fs.writeFile(path.join(directory, 'saved.json'), JSON.stringify(saved, null, 2));
  expect(saved.agents.reduce((sum: number, agent: { count: number }) => sum + agent.count, 0)).toBe(4);
  expect(saved.agents.find((agent: { name: string }) => agent.name === 'Planner A tuned').steps).toHaveLength(
    3,
  );
  expect(saved.agents.find((agent: { name: string }) => agent.name === 'Planner A tuned').use_case_name).toBe(
    'Plan support response',
  );
  expect(
    saved.agents.find((agent: { name: string }) => agent.name === 'Planner A tuned').steps[1].complexity,
  ).toBe('medium');
  expect(
    saved.agents.find((agent: { name: string }) => agent.name === 'Planner A tuned').steps[1].model_calls[0]
      .model_id,
  ).toBe('Fixture review model');
  const calculated = await (await request.post('/api/calculate', { data: saved })).json();
  const editedCost = Number(
    calculated.scenarios.find((scenario: { name: string }) => scenario.name === 'Expected').llm_cost,
  );
  const expectedScenario = calculated.scenarios.find(
    (scenario: { name: string }) => scenario.name === 'Expected',
  );
  const monthlyByAgent = Object.values(expectedScenario.agent_costs) as {
    monthly_total: string;
    complete: boolean;
  }[];
  expect(monthlyByAgent.every((item) => item.complete)).toBe(true);
  expect(monthlyByAgent.reduce((sum, item) => sum + Number(item.monthly_total), 0)).toBeCloseTo(5.124, 9);
  expect(editedCost).toBeCloseTo(5.124, 9);
  expect(Number(calculated.category_costs.simple.monthly_cost)).toBeCloseTo(4.284, 9);
  expect(Number(calculated.category_costs.medium.monthly_cost)).toBeCloseTo(0.84, 9);

  await page.reload();
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Inventory journey fixture/ })
    .click();
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Agent inventory' }).getByText('Planner A tuned'),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const download = await downloadPromise;
  const workbookFile = path.join(directory, 'inventory-budget.xlsx');
  await download.saveAs(workbookFile);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookFile);
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  workbook.eachSheet((sheet) => {
    const grid: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: (string | number | boolean | null)[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const value = row.getCell(column).value;
        cells.push(
          value && typeof value === 'object' && 'formula' in value
            ? `=${value.formula}`
            : typeof value === 'string'
              ? `'${value}`
              : typeof value === 'number' || typeof value === 'boolean'
                ? value
                : null,
        );
      }
      grid.push(cells);
    });
    sheets[sheet.name] = grid;
  });
  const formulas = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const summary = formulas.getSheetId('Summary')!;
  const workbookCost = Number(formulas.getCellValue({ sheet: summary, row: 2, col: 1 }));
  expect(workbookCost).toBeCloseTo(5.124, 9);
  const scenarioSheet = formulas.getSheetId('Monthly scenario summary')!;
  const scenarioWorkbookExpected = [
    [1597500, 2.745, 159750, 1.098, 1757250, 3.843, 0, 0, 3.843],
    [2130000, 3.66, 213000, 1.464, 2343000, 5.124, 0, 0, 5.124],
    [3195000, 5.49, 319500, 2.196, 3514500, 7.686, 0, 0, 7.686],
  ];
  const scenarioWorkbookActual = scenarioWorkbookExpected.map((values, row) =>
    values.map((expectedValue, column) => {
      const actual = Number(formulas.getCellValue({ sheet: scenarioSheet, row: row + 1, col: column + 1 }));
      expect(actual).toBeCloseTo(expectedValue, 9);
      return actual;
    }),
  );
  formulas.destroy();
  await fs.writeFile(
    path.join(directory, 'run-report.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/agent-inventory.spec.ts',
        pricing:
          'Synthetic Fixture model: USD 2/M input, USD 8/M output; Fixture review model: USD 1/M input, USD 4/M output; 1,000 input and 100 output tokens per call; 30 planning days',
        expected: {
          baselineMonthlyLlm: 2.856,
          editedMonthlyLlm: 5.124,
          dashboardMonthlySummaryUsd: 5.124,
          scenarioWorkbookExpected,
          agentCount: 4,
          researchCallers: 2,
          editorCosts: {
            initial: ['300,000', '$0.60', '30,000', '$0.24', '$0.84'],
            edited: ['1,200,000', '$1.80', '120,000', '$0.72', '$2.52'],
            derived: ['450,000', '$0.90', '45,000', '$0.36', '$1.26'],
          },
          stepCosts: [mainStepCost, reviewStepCost],
          perAgentMonthlyUsd: {
            'Planner A tuned': 2.52,
            'Planner B': 0.84,
            Research: 1.26,
            Reviewer: 0.504,
          },
        },
        actual: {
          baselineMonthlyLlm: baselineCost,
          editedMonthlyLlm: editedCost,
          dashboardMonthlySummaryUsd,
          displayedScenarioSummaries,
          editorCosts: { initial: initialAgentCost, edited: editedAgentCost, derived: derivedAgentCost },
          stepCosts: editedStepCosts,
          scenarioWorkbookActual,
          workbookMonthlyLlm: workbookCost,
          agentCount: saved.agents.reduce((sum: number, agent: { count: number }) => sum + agent.count, 0),
          researchCallers,
          perAgentMonthlyUsd: Object.fromEntries(
            saved.agents.flatMap((agent: { id: string; members: { name: string }[] }) =>
              agent.members.map((member) => [
                member.name,
                Number(expectedScenario.agent_costs[agent.id].per_agent_monthly),
              ]),
            ),
          ),
        },
        failures: [],
      },
      null,
      2,
    ),
  );
});

test('inventory total includes tool and harness shares, excludes suite extras, and labels partial prices', async ({
  page,
  request,
}) => {
  const directory = path.resolve('artifacts/agent-inventory-cost');
  await fs.mkdir(directory, { recursive: true });
  const fixture = await (await request.get('/api/new')).json();
  fixture.id = `inventory-total-${Date.now()}`;
  fixture.name = 'Agent inventory total cost fixture';
  fixture.profiles.simple.retry_rate = '0';
  fixture.profiles.simple.input_tokens = '1000';
  fixture.profiles.simple.output_tokens = '100';
  fixture.prices = {
    'Fixture model': {
      id: 'Fixture model',
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
  fixture.agents = [
    {
      id: 'paired',
      name: 'Paired agents',
      description: '',
      use_case_name: 'Resolve customer request',
      use_case_description: '',
      members: [
        { id: 'paired-a', name: 'Agent A', business_use_case_description: 'First customer segment' },
        { id: 'paired-b', name: 'Agent B', business_use_case_description: 'Second customer segment' },
      ],
      complexity: 'simple',
      count: 2,
      invocations: '0',
      volume_source: 'daily_users',
      prior_volume_source: null,
      users_per_day: '1',
      invocations_per_user_per_agent_per_day: '1',
      overrides: { model_id: 'Fixture model' },
      steps: [],
      tool_costs: [
        {
          id: 'tool',
          name: 'External lookup',
          unit_cost: '0.5',
          expected_units_per_invocation: '1',
          probability: '1',
          step_id: null,
        },
      ],
    },
  ];
  fixture.harness.harness_type = 'managed_platform';
  fixture.harness.fixed_monthly = '6';
  fixture.harness.per_invocation = '0.1';
  fixture.scenarios.find((scenario: { name: string }) => scenario.name === 'Low').volume_factor = '0.5';
  fixture.scenarios.find((scenario: { name: string }) => scenario.name === 'High').volume_factor = '2';
  fixture.additional_costs = [
    { id: 'suite-extra', name: 'Suite storage', amount: '5', quantity: '1', frequency: 'monthly' },
    { id: 'setup', name: 'Setup', amount: '100', quantity: '1', frequency: 'one-time' },
  ];
  await fs.writeFile(path.join(directory, 'input.json'), JSON.stringify(fixture, null, 2));
  const calculated = await (await request.post('/api/calculate', { data: fixture })).json();
  const expected = calculated.scenarios.find((scenario: { name: string }) => scenario.name === 'Expected');
  // 60 invocations: model = 60 × (1000 × 2 + 100 × 8) / 1M = 0.168;
  // tools = 60 × 0.5 = 30; harness = 6 + 60 × 0.1 = 12; suite extra = 5.
  expect(Number(expected.llm_cost)).toBeCloseTo(0.168, 9);
  expect(Number(expected.tool_cost)).toBeCloseTo(30, 9);
  expect(Number(expected.harness_cost)).toBeCloseTo(12, 9);
  expect(Number(expected.agent_costs.paired.monthly_total)).toBeCloseTo(42.168, 9);
  expect(Number(expected.agent_costs.paired.per_agent_monthly)).toBeCloseTo(21.084, 9);
  expect(Number(expected.monthly_total)).toBeCloseTo(47.168, 9);

  await page.addInitScript((draft) => {
    if (!localStorage.getItem('agent-ledger-draft-v1'))
      localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft));
  }, fixture);
  await page.goto('/');
  const summaryTable = page.getByRole('region', { name: 'Monthly token and cost summary' });
  const scenarioCostsExpected = [
    ['Low', '$0.063', '$9.00', '$20.00', '$29.063'],
    ['Expected', '$0.168', '$12.00', '$35.00', '$47.168'],
    ['High', '$0.504', '$18.00', '$65.00', '$83.504'],
  ] as const;
  const displayedCosts: Record<string, string[]> = {};
  for (const [name, tokens, harness, other, total] of scenarioCostsExpected) {
    const row = summaryTable.getByRole('row', { name, exact: true });
    await expect(row.getByRole('cell').nth(5)).toHaveText(tokens);
    await expect(row.getByRole('cell').nth(6)).toHaveText(harness);
    await expect(row.getByRole('cell').nth(7)).toHaveText(other);
    await expect(row.getByRole('cell').nth(8)).toHaveText(total);
    displayedCosts[name] = (await row.getByRole('cell').allTextContents()).slice(5);
  }
  await page.screenshot({ path: path.join(directory, 'dashboard-harness-total.png'), fullPage: true });
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  const inventory = page.getByRole('region', { name: 'Agent inventory' });
  await expect(inventory.getByTestId('inventory-total-cost-paired-a')).toHaveText('$21.08/mo');
  await expect(inventory.getByTestId('inventory-total-cost-paired-b')).toHaveText('$21.08/mo');
  await inventory.getByRole('button', { name: 'Edit Agent A', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  const agentCost = editor.getByRole('region', { name: 'Agent cost' });
  await expect(agentCost.getByRole('cell')).toHaveText(['30,000', '$0.06', '3,000', '$0.024', '$0.084']);
  const stepCost = editor.getByRole('region', { name: 'Step 1 cost', exact: true });
  await expect(stepCost.getByRole('cell')).toHaveText(['30,000', '$0.06', '3,000', '$0.024', '$0.084']);
  const editorTokenCosts = await agentCost.getByRole('cell').allTextContents();
  await editor.getByLabel('Users per agent per day *').fill('-1');
  await expect(agentCost.getByRole('alert')).toContainText('greater than or equal to 0');
  await expect(stepCost.getByRole('alert')).toContainText('greater than or equal to 0');
  await expect(agentCost.getByRole('cell')).toHaveCount(0);
  await expect(editor.getByLabel('Agent name')).toHaveValue('Agent A');
  await editor.getByLabel('Users per agent per day *').fill('0');
  await expect(agentCost.getByRole('cell')).toHaveText(['0', '$0.00', '0', '$0.00', '$0.00']);
  await expect(stepCost.getByRole('cell')).toHaveText(['0', '$0.00', '0', '$0.00', '$0.00']);
  await editor.getByRole('button', { name: 'Close dialog' }).click();
  await expect(inventory.locator('tbody tr').first().locator('td').nth(1)).toHaveText(
    'Resolve customer request',
  );

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const workbookFile = path.join(directory, 'agent-total-cost.xlsx');
  await (await downloadPromise).saveAs(workbookFile);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookFile);
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  workbook.eachSheet((sheet) => {
    const grid: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: (string | number | boolean | null)[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const value = row.getCell(column).value;
        cells.push(
          value && typeof value === 'object' && 'formula' in value
            ? `=${value.formula}`
            : typeof value === 'string'
              ? `'${value}`
              : typeof value === 'number' || typeof value === 'boolean'
                ? value
                : null,
        );
      }
      grid.push(cells);
    });
    sheets[sheet.name] = grid;
  });
  const formulas = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const workbookTotal = Number(
    formulas.getCellValue({ sheet: formulas.getSheetId('Summary')!, row: 2, col: 3 }),
  );
  expect(workbookTotal).toBeCloseTo(47.168, 9);
  const scenarioSheet = formulas.getSheetId('Monthly scenario summary')!;
  const scenarioCostsWorkbook = [
    [9, 20, 29.063],
    [12, 35, 47.168],
    [18, 65, 83.504],
  ];
  const recalculatedCosts = scenarioCostsWorkbook.map((values, row) =>
    values.map((expectedValue, column) => {
      const actual = Number(formulas.getCellValue({ sheet: scenarioSheet, row: row + 1, col: column + 7 }));
      expect(actual).toBeCloseTo(expectedValue, 9);
      return actual;
    }),
  );
  formulas.destroy();

  const unpriced = structuredClone(fixture);
  unpriced.agents[0].overrides.model_id = 'Unpriced model';
  const incomplete = await (await request.post('/api/calculate', { data: unpriced })).json();
  const partial = incomplete.scenarios.find((scenario: { name: string }) => scenario.name === 'Expected');
  expect(partial.agent_costs.paired.complete).toBe(false);
  expect(Number(partial.agent_costs.paired.per_agent_monthly)).toBeCloseTo(21, 9);
  await page.evaluate(
    (draft) => localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft)),
    unpriced,
  );
  await page.reload();
  await expect(summaryTable.getByTestId('monthly-summary-expected-harness-cost')).toHaveText('$12.00');
  await expect(summaryTable.getByTestId('monthly-summary-expected-other-costs')).toHaveText('$35.00');
  await expect(summaryTable.getByTestId('monthly-summary-expected-suite-total-cost')).toHaveText(
    '$47.00 (partial)',
  );
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await expect(page.getByTestId('inventory-total-cost-paired-a')).toHaveText('$21.00/mo (partial)');
  await page.getByRole('button', { name: 'Edit Agent A', exact: true }).click();
  await expect(agentCost.getByRole('cell')).toHaveText([
    '30,000',
    'Incomplete',
    '3,000',
    'Incomplete',
    'Incomplete',
  ]);
  await expect(stepCost.getByRole('cell')).toHaveText([
    '30,000',
    'Incomplete',
    '3,000',
    'Incomplete',
    'Incomplete',
  ]);
  await editor.getByRole('button', { name: 'Close dialog' }).click();

  const missingVolume = structuredClone(fixture);
  missingVolume.agents[0].users_per_day = null;
  await page.evaluate(
    (draft) => localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft)),
    missingVolume,
  );
  await page.reload();
  await expect(summaryTable.getByTestId('monthly-summary-expected-harness-cost')).toHaveText(
    '$6.00 (partial)',
  );
  await expect(summaryTable.getByTestId('monthly-summary-expected-suite-total-cost')).toHaveText(
    '$11.00 (partial)',
  );
  await expect(summaryTable.getByTestId('monthly-summary-expected-other-costs')).toHaveText(
    '$5.00 (partial)',
  );
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Agent A', exact: true }).click();
  await expect(agentCost.getByRole('cell')).toHaveText(Array(5).fill('Incomplete'));
  await expect(stepCost.getByRole('cell')).toHaveText(Array(5).fill('Incomplete'));
  await editor.getByRole('button', { name: 'Close dialog' }).click();
  missingVolume.harness.per_invocation = '0';
  await page.evaluate(
    (draft) => localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft)),
    missingVolume,
  );
  await page.reload();
  await expect(summaryTable.getByTestId('monthly-summary-expected-harness-cost')).toHaveText('$6.00');
  missingVolume.harness.harness_type = 'none';
  await page.evaluate(
    (draft) => localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft)),
    missingVolume,
  );
  await page.reload();
  await expect(summaryTable.getByTestId('monthly-summary-expected-harness-cost')).toHaveText('$0.00');
  missingVolume.agents[0].tool_costs[0].probability = '0';
  await page.evaluate(
    (draft) => localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft)),
    missingVolume,
  );
  await page.reload();
  await expect(summaryTable.getByTestId('monthly-summary-expected-other-costs')).toHaveText('$5.00');

  await fs.writeFile(
    path.join(directory, 'run-report.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/agent-inventory.spec.ts',
        pricing: 'Synthetic USD 2/M input and USD 8/M output',
        assumptions:
          'Two agents, 30 invocations each/month, 1000 input and 100 output tokens/call, USD 0.50 tool/invocation, USD 6 fixed plus USD 0.10/invocation harness, USD 5 recurring suite extra, USD 100 one-time setup excluded from monthly costs; Low 0.5x volume/0.75x tokens, High 2x volume/1.5x tokens',
        expected: {
          model: 0.168,
          tools: 30,
          harness: 12,
          eachAgent: 21.084,
          suite: 47.168,
          editorTokenCosts: ['30,000', '$0.06', '3,000', '$0.024', '$0.084'],
          scenarioCostsWorkbook,
        },
        actual: {
          displayedCosts,
          editorTokenCosts,
          recalculatedCosts,
          model: Number(expected.llm_cost),
          tools: Number(expected.tool_cost),
          harness: Number(expected.harness_cost),
          eachAgent: Number(expected.agent_costs.paired.per_agent_monthly),
          suite: Number(expected.monthly_total),
          workbookSuite: workbookTotal,
        },
        unpricedModelPartial: true,
        failures: [],
      },
      null,
      2,
    ),
  );
});
