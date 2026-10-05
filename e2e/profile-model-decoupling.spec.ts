import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import fs from 'node:fs/promises';
import path from 'node:path';

test('a shared profile prices independent agent model choices', async ({ page, request }) => {
  const directory = path.resolve('artifacts/profile-model-decoupling');
  await fs.mkdir(directory, { recursive: true });
  const fixture = await (await request.get('/api/new')).json();
  fixture.id = `profile-choice-${Date.now()}`;
  fixture.name = 'Profile model choice fixture';
  fixture.profiles.simple = {
    ...fixture.profiles.simple,
    calls: '1',
    input_tokens: '1000',
    output_tokens: '100',
    retry_rate: '0',
  };
  const price = (id: string, input: string, output: string) => ({
    id,
    provider: 'Synthetic fixture',
    input,
    output,
    cache_read: null,
    cache_write: null,
    tiers: [],
    max_input: null,
    max_output: null,
    source: 'Versioned E2E fixture',
    retrieved_at: '2026-10-04',
    custom: true,
    unsupported: [],
  });
  fixture.prices = {
    'Fixture A': price('Fixture A', '2', '8'),
    'Fixture B': price('Fixture B', '1', '4'),
  };
  const row = (name: string, overrides: { model_id?: string }, users = '1') => ({
    id: name,
    name,
    description: '',
    use_case_name: name,
    use_case_description: 'Fixed model choice fixture',
    members: [{ id: `${name}-member`, name, business_use_case_description: 'Fixture' }],
    complexity: 'simple',
    count: 1,
    invocations: '0',
    volume_source: 'daily_users',
    prior_volume_source: null,
    users_per_day: users,
    invocations_per_user_per_agent_per_day: '1',
    overrides,
    steps: [],
    tool_costs: [],
  });
  fixture.agents = [
    row('Agent A', { model_id: 'Fixture A' }),
    row('Agent B', { model_id: 'Fixture B' }),
    row('Unselected agent', { model_id: '' }, '0'),
  ];

  const savedResponse = await request.post('/api/estimates', { data: fixture });
  expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
  const saved = await (await request.get(`/api/estimates/${fixture.id}`)).json();
  expect(saved.schema_version).toBe(10);
  expect(saved.profiles.simple).not.toHaveProperty('model_id');
  expect(saved.agents.map((agent: { overrides: { model_id: string } }) => agent.overrides.model_id)).toEqual([
    'Fixture A',
    'Fixture B',
    '',
  ]);
  expect(saved.prices['Fixture A'].input).toBe('2');
  expect(saved.prices['Fixture B'].output).toBe('4');
  await fs.writeFile(path.join(directory, 'fixture-input.json'), JSON.stringify(fixture, null, 2));
  await fs.writeFile(path.join(directory, 'saved-estimate.json'), JSON.stringify(saved, null, 2));

  const priced = await (await request.post('/api/calculate', { data: saved })).json();
  const expected = priced.scenarios.find((scenario: { name: string }) => scenario.name === 'Expected');
  // 30 calls each: A = 30 × (1000 × 2 + 100 × 8) / 1M = 0.084;
  // B = 30 × (1000 × 1 + 100 × 4) / 1M = 0.042.
  expect(Number(expected.llm_cost)).toBeCloseTo(0.126, 9);

  const rejected = await request.post('/api/categories', {
    data: { name: 'Model coupled', profile: { ...fixture.profiles.simple, model_id: 'Fixture A' } },
  });
  expect(rejected.status()).toBe(422);
  const invalidCurrent = structuredClone(saved);
  invalidCurrent.profiles.simple.model_id = 'Fixture A';
  expect((await request.post('/api/calculate', { data: invalidCurrent })).status()).toBe(422);

  await page.addInitScript((draft) => {
    if (!localStorage.getItem('agent-ledger-draft-v1'))
      localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(draft));
  }, fixture);
  await page.goto('/');
  await expect(page.getByTestId('cost-expected')).toContainText('$0.13');
  const browserDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!));
  expect(browserDraft.schema_version).toBe(10);
  expect(browserDraft.profiles.simple).not.toHaveProperty('model_id');
  expect(browserDraft.agents[0].overrides.model_id).toBe('Fixture A');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const workbookFile = path.join(directory, 'profile-model-budget.xlsx');
  await (await downloadPromise).saveAs(workbookFile);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookFile);
  const profileHeaders = workbook.getWorksheet('Profiles')!.getRow(1).values;
  expect(profileHeaders).not.toContain('model_id');
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  workbook.eachSheet((sheet) => {
    const rows: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (item) => {
      const cells: (string | number | boolean | null)[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const value = item.getCell(column).value;
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
      rows.push(cells);
    });
    sheets[sheet.name] = rows;
  });
  const formulas = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const workbookTotal = formulas.getCellValue({ sheet: formulas.getSheetId('Summary')!, row: 2, col: 1 });
  expect(workbookTotal).toBeCloseTo(0.126, 9);
  formulas.destroy();
  await fs.writeFile(
    path.join(directory, 'run-report.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/profile-model-decoupling.spec.ts',
        pricingFixture:
          'Fixture A USD 2/M input and USD 8/M output; Fixture B USD 1/M input and USD 4/M output',
        assumptions:
          '30 calls per agent per month; 1000 input and 100 output tokens per call; no retries or cache',
        expectedUsd: 0.126,
        actualUsd: Number(expected.llm_cost),
        workbookUsd: workbookTotal,
        sharedProfileUsesIndependentModels: true,
        browserDraftReproduced: true,
        profileModelRejected: true,
        failures: [],
      },
      null,
      2,
    ),
  );
});
