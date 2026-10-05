import { modelStep, agentStep } from './workflow-fixtures';
import { openAgentEditor } from './agent-editing';
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import fs from 'node:fs/promises';
import path from 'node:path';

const artifactDir = path.resolve('artifacts/agentic-mvp');

test('Agentic use case, conditional models, delegated work, tools, harness, saved view and workbook reconcile', async ({
  page,
  request,
}) => {
  await fs.mkdir(artifactDir, { recursive: true });
  const estimate = await (await request.get('/api/new')).json();
  estimate.id = `agentic-fixture-${Date.now()}`;
  estimate.name = 'Agentic fixture';
  estimate.prices = {
    'Fixture A': {
      id: 'Fixture A',
      provider: 'Fixture vendor A',
      input: '2',
      output: '8',
      cache_read: null,
      cache_write: null,
      tiers: [],
      max_input: null,
      max_output: null,
      source: 'Versioned architect fixture',
      retrieved_at: '2026-10-02',
      custom: true,
      unsupported: [],
    },
    'Fixture B': {
      id: 'Fixture B',
      provider: 'Fixture vendor B',
      input: '1',
      output: '4',
      cache_read: null,
      cache_write: null,
      tiers: [],
      max_input: null,
      max_output: null,
      source: 'Versioned architect fixture',
      retrieved_at: '2026-10-02',
      custom: true,
      unsupported: [],
    },
  };
  const call = (
    id: string,
    model_id: string,
    calls: string,
    input_tokens: string,
    output_tokens: string,
    probability: string,
  ) => ({
    id,
    role: 'reasoning',
    probability,
    calls,
    input_tokens,
    output_tokens,
    retry_rate: '0',
    cache_fraction: '0',
    cache_write_fraction: '0',
    model_id,
  });
  const step = (id: string, name: string, probability: string, model_calls: unknown[]) => ({
    id,
    name,
    execution_probability: probability,
    model_calls,
    action_type: 'model',
    agent_calls: [],
  });
  const agent = (id: string, name: string, source: 'daily_users' | 'derived', steps: unknown[]) => ({
    id,
    name,
    description: '',
    use_case_name: name,
    use_case_description: '',
    complexity: 'simple',
    count: 1,
    invocations: '0',
    volume_source: source,
    prior_volume_source: source === 'derived' ? 'daily_users' : null,
    users_per_day: source === 'derived' ? '0' : '1',
    invocations_per_user_per_agent_per_day:
      source === 'derived' ? '0' : '3.33333333333333333333333333333333333333333333333333',
    overrides: {},
    steps,
    tool_costs: [],
  });
  estimate.agents = [
    agent('router', 'Resolve inquiry', 'daily_users', [
      step('classify', 'Classify', '1', [call('primary', 'Fixture A', '1', '1000', '100', '1')]),
      step('verify', 'Verify', '0.125', [call('optional', 'Fixture A', '1', '200', '50', '1')]),
      agentStep('delegation', 'specialist', '0.25'),
      agentStep('delegation-again', 'specialist', '0.25'),
    ]),
    agent('specialist', 'Research documents', 'derived', [
      step('research', 'Research', '1', [call('research-call', 'Fixture B', '2', '500', '100', '1')]),
    ]),
  ];
  estimate.agents[0].tool_costs = [
    {
      id: 'search-tool',
      name: 'Search API',
      unit_cost: '0.1',
      expected_units_per_invocation: '1',
      probability: '1',
      step_id: 'verify',
    },
  ];
  estimate.harness = {
    name: 'Shared runtime',
    harness_type: 'managed_platform',
    fixed_monthly: '10',
    per_invocation: '0.01',
    per_step_execution: '0.001',
    allocation: 'by_invocations',
    include_in_cost_per_use_case: true,
  };
  await fs.writeFile(path.join(artifactDir, 'input.json'), JSON.stringify(estimate, null, 2));

  const calculatedResponse = await request.post('/api/calculate', { data: estimate });
  expect(calculatedResponse.ok()).toBe(true);
  const results = await calculatedResponse.json();
  const expected = results.scenarios.find((scenario: { name: string }) => scenario.name === 'Expected');
  const independent = {
    completions: 100,
    childCompletions: 50,
    model: 0.38,
    tools: 1.25,
    harness: 11.7125,
    total: 13.3425,
    loadedPerRoot: 0.133425,
  };
  expect(Number(expected.volumes.router.total)).toBeCloseTo(independent.completions, 9);
  expect(Number(expected.volumes.specialist.total)).toBeCloseTo(independent.childCompletions, 9);
  expect(Number(expected.llm_cost)).toBeCloseTo(independent.model, 9);
  expect(Number(expected.tool_cost)).toBeCloseTo(independent.tools, 9);
  expect(Number(expected.harness_cost)).toBeCloseTo(independent.harness, 9);
  expect(Number(expected.monthly_total)).toBeCloseTo(independent.total, 9);
  expect(Number(expected.use_case_costs.router.loaded_cost_per_completion)).toBeCloseTo(
    independent.loadedPerRoot,
    9,
  );

  const invalid = structuredClone(estimate);
  invalid.agents[0].steps[1].model_calls.push({
    ...call('extra', 'Fixture B', '1', '100', '100', '0.6'),
  });
  expect((await request.post('/api/calculate', { data: invalid })).status()).toBe(422);
  const unpriced = structuredClone(estimate);
  unpriced.agents[1].steps[0].model_calls[0].model_id = 'Unknown';
  const incomplete = await (await request.post('/api/calculate', { data: unpriced })).json();
  expect(incomplete.scenarios[1].complete).toBe(false);
  expect(Number(incomplete.scenarios[1].llm_cost)).toBeCloseTo(0.29, 9);
  const converted = structuredClone(estimate);
  converted.prices['Fixture B'] = {
    ...converted.prices['Fixture B'],
    currency: 'EUR',
    fx_to_usd: '2',
    fx_source: 'Versioned architect fixture',
    fx_retrieved_at: '2026-10-02',
  };
  const convertedResult = await (await request.post('/api/calculate', { data: converted })).json();
  expect(Number(convertedResult.scenarios[1].llm_cost)).toBeCloseTo(0.47, 9);
  const missingFx = structuredClone(converted);
  delete missingFx.prices['Fixture B'].fx_to_usd;
  expect((await request.post('/api/calculate', { data: missingFx })).status()).toBe(422);
  const cyclic = structuredClone(estimate);
  cyclic.agents[0].volume_source = 'derived';
  cyclic.agents[1].steps.push(agentStep('back-edge', 'router'));
  const cycleResponse = await request.post('/api/calculate', { data: cyclic });
  expect(cycleResponse.status()).toBe(422);
  expect(await cycleResponse.text()).toContain('Resolve inquiry');

  expect((await request.post('/api/estimates', { data: estimate })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Agentic fixture/ })
    .first()
    .click();
  await expect(page.getByTestId('cost-expected')).toContainText('$0.38');
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await openAgentEditor(page, 'Resolve inquiry');
  const costEditor = page.getByRole('dialog', { name: 'Edit agent' });
  const conditionalStepCost = costEditor.getByRole('region', { name: 'Step 2 cost', exact: true });
  await expect(
    costEditor.getByRole('region', { name: 'Step 1 cost', exact: true }).getByRole('cell'),
  ).toHaveText(['≈100,000', '$0.20', '≈10,000', '$0.08', '$0.28']);
  await expect(conditionalStepCost.getByRole('cell')).toHaveText([
    '2,500',
    '$0.005',
    '625',
    '$0.005',
    '$0.01',
  ]);
  const conditionalStepCostActual = await conditionalStepCost.getByRole('cell').allTextContents();
  await conditionalStepCost.screenshot({ path: path.join(artifactDir, 'conditional-step-cost.png') });
  await fs.writeFile(
    path.join(artifactDir, 'step-cost-report.json'),
    JSON.stringify(
      {
        command: 'npm run test:e2e',
        assumptions:
          '100 monthly invocations; 0.125 step execution probability and one model option; 200 input and 50 output tokens per call; USD 2/M input and 8/M output; excludes tools, harness and delegated specialist',
        expected: ['2,500', '$0.005', '625', '$0.005', '$0.01'],
        actual: conditionalStepCostActual,
        failures: [],
      },
      null,
      2,
    ),
  );
  await costEditor.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page
    .getByRole('region', { name: 'Agent inventory', exact: true })
    .getByRole('button', { name: 'Export JSON' })
    .click();
  const jsonFile = path.join(artifactDir, 'agentic-export.json');
  await (await jsonDownloadPromise).saveAs(jsonFile);
  const exportedJson = JSON.parse(await fs.readFile(jsonFile, 'utf8'));
  expect(exportedJson.prices['Fixture A'].input).toBe('2');
  expect(exportedJson.agents[0].steps[1].model_calls[0].probability).toBe('1');
  await page.getByRole('button', { name: 'Agent harness' }).click();
  await expect(page.getByText('$11.71', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await page.getByRole('button', { name: 'Select agent Resolve inquiry', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Edit agent' })
    .getByRole('button', { name: 'Copy agent', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Edit agent' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Edit agent' })
    .getByRole('button', { name: 'Apply changes' })
    .click();
  await expect(page.getByTestId('cost-expected')).toContainText('$0.38');
  const copyDraft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  const copyResult = await (await request.post('/api/calculate', { data: copyDraft })).json();
  const copiedAgent = copyDraft.agents.find(
    (agent: { name: string }) => agent.name === 'Resolve inquiry (copy)',
  );
  expect(copiedAgent).toBeTruthy();
  expect(
    Number(copyResult.scenarios[1].use_case_costs[copiedAgent.id].loaded_cost_per_completion),
  ).toBeCloseTo(0.06, 2);
  await openAgentEditor(page, 'Resolve inquiry');
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await page.screenshot({ path: path.join(artifactDir, 'edit-agent-dialog.png'), fullPage: true });
  await editor.getByLabel('Step 2 execution probability (0–1)').fill('0');
  await editor.getByRole('button', { name: 'Add model to step' }).first().click();
  await editor.getByRole('button', { name: /Step 1 model 2 name:/ }).click();
  await page
    .getByRole('dialog', { name: 'Choose a model' })
    .getByRole('button', { name: /Fixture B/ })
    .click();
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('cost-expected')).toContainText('$0.37');
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  const jsonChooser = page.waitForEvent('filechooser');
  await page
    .getByRole('region', { name: 'Agent inventory', exact: true })
    .getByRole('button', { name: 'Import JSON', exact: true })
    .click();
  await (await jsonChooser).setFiles(jsonFile);
  await expect(page.getByTestId('cost-expected')).toContainText('$0.38');

  const workbookResponse = await request.post('/api/export', { data: estimate });
  expect(workbookResponse.ok()).toBe(true);
  const workbookFile = path.join(artifactDir, 'agentic-budget.xlsx');
  await fs.writeFile(workbookFile, await workbookResponse.body());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookFile);
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  workbook.eachSheet((sheet) => {
    const grid: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: (string | number | boolean | null)[] = [];
      for (let col = 1; col <= sheet.columnCount; col++) {
        const value = row.getCell(col).value;
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
  const formulaEngine = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const summary = formulaEngine.getSheetId('Summary')!;
  const exported = {
    model: Number(formulaEngine.getCellValue({ sheet: summary, row: 2, col: 1 })),
    tools: Number(formulaEngine.getCellValue({ sheet: summary, row: 2, col: 8 })),
    harness: Number(formulaEngine.getCellValue({ sheet: summary, row: 2, col: 9 })),
    total: Number(formulaEngine.getCellValue({ sheet: summary, row: 2, col: 3 })),
  };
  expect(exported.model).toBeCloseTo(independent.model, 9);
  expect(exported.tools).toBeCloseTo(independent.tools, 9);
  expect(exported.harness).toBeCloseTo(independent.harness, 9);
  expect(exported.total).toBeCloseTo(independent.total, 9);
  formulaEngine.destroy();
  await fs.writeFile(
    path.join(artifactDir, 'verification.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/agentic.spec.ts',
        fixture: 'Architect-authored prices, not provider benchmarks; input.json',
        expected: independent,
        actual: {
          completions: Number(expected.volumes.router.total),
          childCompletions: Number(expected.volumes.specialist.total),
          model: Number(expected.llm_cost),
          tools: Number(expected.tool_cost),
          harness: Number(expected.harness_cost),
          total: Number(expected.monthly_total),
          loadedPerRoot: Number(expected.use_case_costs.router.loaded_cost_per_completion),
        },
        exported,
        checks: [
          'calculate',
          'validation',
          'FX conversion',
          'cycle path',
          'save/open',
          'calculated unit economics',
          'copy without volume and loaded cost',
          'model probability edit',
          'model row add with zero probability',
          'JSON snapshot round trip',
          'Excel formula recalculation',
        ],
      },
      null,
      2,
    ),
  );
});

test('Linked group members become independently editable without changing graph totals', async ({
  page,
  request,
}) => {
  const outputDir = path.resolve('artifacts/agent-customization');
  await fs.mkdir(outputDir, { recursive: true });
  let estimate = await (await request.get('/api/new')).json();
  estimate.id = `linked-customization-${Date.now()}`;
  estimate.name = 'Linked customization fixture';
  estimate.profiles.simple = {
    calls: '1',
    input_tokens: '1000',
    output_tokens: '100',
    retry_rate: '0',
    cache_fraction: '0',
    cache_write_fraction: '0',
  };
  estimate.prices = {
    'Fixture A': {
      id: 'Fixture A',
      provider: 'Synthetic fixture',
      input: '2',
      output: '8',
      cache_read: null,
      cache_write: null,
      tiers: [],
      max_input: null,
      max_output: null,
      source: 'Architect fixture',
      retrieved_at: '2026-10-02',
      custom: true,
      unsupported: [],
    },
    'Fixture B': {
      id: 'Fixture B',
      provider: 'Synthetic fixture',
      input: '1',
      output: '4',
      cache_read: null,
      cache_write: null,
      tiers: [],
      max_input: null,
      max_output: null,
      source: 'Architect fixture',
      retrieved_at: '2026-10-02',
      custom: true,
      unsupported: [],
    },
  };
  const row = (id: string, name: string, count: number, source: 'daily_users' | 'derived') => ({
    id,
    name,
    description: '',
    use_case_name: name,
    use_case_description: '',
    complexity: 'simple',
    count,
    members: Array.from({ length: count }, (_, i) => ({
      id: `${id}-${i + 1}`,
      name: count === 1 ? name : `${name} ${i + 1}`,
      business_use_case_description: 'Fixture use case',
    })),
    invocations: '0',
    volume_source: source,
    prior_volume_source: source === 'derived' ? 'daily_users' : null,
    users_per_day: source === 'derived' ? '0' : '1',
    invocations_per_user_per_agent_per_day: source === 'derived' ? '0' : '10',
    overrides: { model_id: 'Fixture A' },
    steps: [],
    tool_costs: [],
  });
  estimate.agents = [
    row('planner', 'Planner', 2, 'daily_users'),
    row('research', 'Research group', 2, 'derived'),
    row('reviewer', 'Reviewer', 1, 'derived'),
  ];
  estimate.agents[0].steps = [
    modelStep('planner-model', { ...estimate.profiles.simple, model_id: 'Fixture A' }),
    {
      ...agentStep('to-research', 'research-1', '0.5'),
      agent_calls: [
        { id: 'to-research-1', child_agent_id: 'research-1', probability: '0.5' },
        { id: 'to-research-2', child_agent_id: 'research-2', probability: '0.5' },
      ],
      low_execution_probability: '0.2',
      high_execution_probability: '1',
    },
  ];
  estimate.agents[0].steps.push({
    ...structuredClone(estimate.agents[0].steps[1]),
    id: 'to-research-again',
    agent_calls: estimate.agents[0].steps[1].agent_calls.map((option: { id: string }) => ({
      ...option,
      id: `${option.id}-again`,
    })),
  });
  estimate.agents[1].steps = [
    modelStep('research-model', { ...estimate.profiles.simple, model_id: 'Fixture A' }),
    agentStep('research-step', 'reviewer-1', '0.4'),
  ];
  const validated = await request.post('/api/validate', { data: estimate });
  expect(validated.ok(), await validated.text()).toBe(true);
  estimate = await validated.json();
  const researchOne = estimate.agents.find(
    (row: { members: { id: string }[] }) => row.members[0]?.id === 'research-1',
  ).id;
  const researchTwo = estimate.agents.find(
    (row: { members: { id: string }[] }) => row.members[0]?.id === 'research-2',
  ).id;
  await fs.writeFile(path.join(outputDir, 'input.json'), JSON.stringify(estimate, null, 2));
  const baseline = await (await request.post('/api/calculate', { data: estimate })).json();
  const expectedMonthly = [1.9656, 4.032, 9.576];
  baseline.scenarios.forEach((scenario: { llm_cost: string }, index: number) =>
    expect(Number(scenario.llm_cost)).toBeCloseTo(expectedMonthly[index], 9),
  );
  expect(Number(baseline.scenarios[1].volumes[researchOne].total)).toBe(300);
  expect(Number(baseline.scenarios[1].volumes[researchTwo].total)).toBe(300);
  expect(Number(baseline.scenarios[1].volumes.reviewer.total)).toBe(240);

  const splitResponse = await request.post('/api/agents/split', { data: { estimate, row_id: 'planner' } });
  expect(splitResponse.ok(), await splitResponse.text()).toBe(true);
  const split = await splitResponse.json();
  const afterSplit = await (await request.post('/api/calculate', { data: split.estimate })).json();
  afterSplit.scenarios.forEach(
    (scenario: { llm_cost: string; volumes: Record<string, { total: string }> }, index: number) => {
      expect(Number(scenario.llm_cost)).toBeCloseTo(expectedMonthly[index], 9);
      expect(Number(scenario.volumes[researchOne].total)).toBeCloseTo([120, 300, 600][index], 9);
      expect(Number(scenario.volumes[researchTwo].total)).toBeCloseTo([120, 300, 600][index], 9);
      expect(Number(scenario.volumes.reviewer.total)).toBeCloseTo([96, 240, 480][index], 9);
    },
  );
  const copiedCaller = split.estimate.agents.find(
    (agent: { id: string }) => agent.id === split.individual_id,
  );
  const copiedOutgoing = split.estimate.links.filter(
    (edge: { parent_id: string }) => edge.parent_id === copiedCaller.id,
  );
  expect(copiedOutgoing).toHaveLength(4);
  expect(
    copiedOutgoing.every((edge: { step_id: string }) =>
      copiedCaller.steps.slice(1).some((step: { id: string }) => edge.step_id === step.id),
    ),
  ).toBe(true);
  expect(
    copiedCaller.steps[1].agent_calls.map((option: { child_agent_id: string; probability: string }) => [
      option.child_agent_id,
      option.probability,
    ]),
  ).toEqual([
    ['research-1', '0.5'],
    ['research-2', '0.5'],
  ]);

  expect((await request.post('/api/estimates', { data: estimate })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Linked customization fixture/ })
    .first()
    .click();
  const graph = page.getByRole('region', { name: 'Agent invocation graph' });
  await expect(graph).toBeHidden();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await expect(graph).toBeVisible();
  await expect(
    graph.getByLabel('Agent canvas').getByRole('button', { name: 'Select agent Research group 2' }),
  ).toBeVisible();
  await expect(page.getByTestId('cost-expected')).toContainText('$4.03');
  await page.screenshot({ path: path.join(outputDir, 'graph-workspace.png') });
  await graph.screenshot({ path: path.join(outputDir, 'graph-before.png') });
  await graph.getByRole('button', { name: 'Select agent Research group 2' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await expect(editor.getByText(/This agent receives work from agent links/)).toBeVisible();
  await expect(editor.getByLabel('Agent name')).toHaveValue('Research group 2');
  await expect(page.getByTestId('cost-expected')).toContainText('$4.03');
  await editor.getByLabel('Agent name').fill('Research tuned');
  await editor
    .locator('article')
    .filter({ has: page.getByLabel('Step 1 name') })
    .getByText('Step execution details', { exact: true })
    .click();
  await editor.getByLabel('Output tokens / call').fill('200');
  await editor.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toContainText('$4.27');
  const afterModalEstimate = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  const afterModalResult = await (await request.post('/api/calculate', { data: afterModalEstimate })).json();
  expect(Number(afterModalResult.scenarios[1].llm_cost)).toBeCloseTo(4.272, 9);
  await expect(graph.getByRole('button', { name: 'Select agent Research tuned' })).toBeVisible();
  await graph.screenshot({ path: path.join(outputDir, 'graph-after.png') });
  await graph.getByRole('button', { name: 'Select agent Research tuned' }).click();
  const settings = page.getByRole('dialog', { name: 'Edit agent' });
  const expandExecution = async () => {
    const details = settings.locator('details.step-details').first();
    if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  };
  await expandExecution();
  await settings.getByLabel('Output tokens / call').fill('-1');
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settings.getByRole('alert')).toBeVisible();
  await expect(settings.getByLabel('Output tokens / call')).toHaveValue('-1');
  await expect(page.getByTestId('cost-expected')).toContainText('$4.27');
  await settings.getByLabel('Output tokens / call').fill('250');
  await settings.getByLabel('Business use case name').fill('Analyze documents');
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByTestId('cost-expected')).toContainText('$4.39');
  await graph.getByRole('button', { name: 'Select agent Research tuned' }).click();
  await expect(settings.getByLabel('Business use case name')).toHaveValue('Analyze documents');
  await settings.getByRole('button', { name: 'Step 1 model name: Fixture A' }).click();
  await page
    .getByRole('dialog', { name: 'Choose a model' })
    .getByRole('button', { name: /Fixture B/ })
    .click();
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toContainText('$3.79');
  await graph.getByRole('button', { name: 'Select agent Research tuned' }).click();
  await settings.getByLabel('Step 1 complexity profile').selectOption('medium');
  await settings.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('cost-expected')).toContainText('$3.79');
  await expect(graph.getByRole('button', { name: 'Select agent Research group 1' })).toContainText(
    '$0.84/mo',
  );
  await graph.screenshot({ path: path.join(outputDir, 'graph-editor-after.png') });
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(graph).toBeHidden();
  await page.screenshot({ path: path.join(outputDir, 'suite-without-graph.png'), fullPage: true });
  const savedDraft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
  );
  const verified = await (await request.post('/api/calculate', { data: savedDraft })).json();
  expect(Number(verified.scenarios[1].llm_cost)).toBeCloseTo(3.792, 9);
  expect(Number(verified.scenarios[1].volumes.reviewer.total)).toBe(240);
  expect(savedDraft.profiles.simple).not.toHaveProperty('model_id');
  expect(
    savedDraft.agents.find((agent: { name: string }) => agent.name === 'Research tuned').steps[0]
      .model_calls[0].model_id,
  ).toBe('Fixture B');
  const remainingResearchOverrides = savedDraft.agents.find(
    (agent: { id: string }) => agent.id === researchOne,
  ).overrides;
  expect(remainingResearchOverrides.model_id).toBe('Fixture A');
  expect(
    Object.entries(remainingResearchOverrides)
      .filter(([key]) => key !== 'model_id')
      .every(([, value]) => value === null),
  ).toBe(true);
  await fs.writeFile(path.join(outputDir, 'customized.json'), JSON.stringify(savedDraft, null, 2));
  const workbookResponse = await request.post('/api/export', { data: savedDraft });
  expect(workbookResponse.ok()).toBe(true);
  const workbookFile = path.join(outputDir, 'customized-budget.xlsx');
  await fs.writeFile(workbookFile, await workbookResponse.body());
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
  const formulaEngine = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const summaryId = formulaEngine.getSheetId('Summary')!;
  expect(Number(formulaEngine.getCellValue({ sheet: summaryId, row: 2, col: 1 }))).toBeCloseTo(3.792, 9);
  formulaEngine.destroy();
  await fs.writeFile(
    path.join(outputDir, 'verification.json'),
    JSON.stringify(
      {
        command: 'npm run test:e2e',
        fixture:
          'Synthetic Fixture A $2/M input and $8/M output; Fixture B $1/M input and $4/M output; 30-day planning month',
        expected: {
          scenarioModelCosts: expectedMonthly,
          expectedBeforeCustomization: 4.032,
          expectedAfterCustomization: 4.272,
          expectedAfterGraphInspector: 3.792,
          researchMonthly: 600,
          reviewerMonthly: 240,
        },
        actual: {
          scenarioModelCosts: baseline.scenarios.map((scenario: { llm_cost: string }) =>
            Number(scenario.llm_cost),
          ),
          expectedBeforeCustomization: Number(afterSplit.scenarios[1].llm_cost),
          expectedAfterCustomization: Number(afterModalResult.scenarios[1].llm_cost),
          expectedAfterGraphInspector: Number(verified.scenarios[1].llm_cost),
          researchMonthly:
            Number(afterSplit.scenarios[1].volumes[researchOne].total) +
            Number(afterSplit.scenarios[1].volumes[researchTwo].total),
          reviewerMonthly: Number(verified.scenarios[1].volumes.reviewer.total),
        },
        navigation: {
          checked: 'Graph absent from Dashboard, present on Agent suite graph view, absent after return',
          screenshots: [
            'graph-workspace.png',
            'graph-before.png',
            'graph-after.png',
            'graph-editor-after.png',
            'suite-without-graph.png',
          ],
        },
        failures: [],
      },
      null,
      2,
    ),
  );
});
