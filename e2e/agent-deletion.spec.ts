import { test, expect } from '@playwright/test';
import { modelStep, agentStep } from './workflow-fixtures';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import fs from 'node:fs/promises';
import path from 'node:path';

test('delete removes one individual, protects references, restores child workload and survives undo and export', async ({
  page,
  request,
}) => {
  const dir = path.resolve('artifacts/agent-deletion');
  await fs.mkdir(dir, { recursive: true });
  const estimate = await (await request.get('/api/new')).json();
  estimate.id = `agent-deletion-${Date.now()}`;
  estimate.name = 'Agent deletion fixture';
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
        source: 'Agent deletion v1',
        retrieved_at: '2026-10-05',
        custom: true,
      },
    ]),
  );
  const member = (id: string, name: string) => ({
    id,
    name,
    business_use_case_description: `${name} handles a request`,
  });
  const row = (id: string, members: ReturnType<typeof member>[], users: string, model: string) => ({
    id,
    name: members.length === 1 ? members[0].name : `${id} shared settings`,
    complexity: 'simple',
    count: members.length,
    members,
    volume_source: 'daily_users',
    users_per_day: users,
    invocations_per_user_per_agent_per_day: '1',
    overrides: {},
    steps: [modelStep(`${id}-model`, { ...execution, model_id: model })],
    tool_costs: [] as unknown[],
  });
  estimate.agents = [
    row('roots', [member('root-one', 'Root one'), member('root-two', 'Root two')], '10', 'A'),
    row('specialist-row', [member('specialist', 'Specialist')], '3', 'B'),
    row('independent', [member('free-one', 'Free one'), member('free-two', 'Free two')], '1', 'A'),
    row('solo-row', [member('solo', 'Solo')], '1', 'A'),
  ];
  estimate.agents[0].steps.push(agentStep('delegate', 'specialist', '0.5'));
  estimate.agents[0].tool_costs.push({
    id: 'delegation-tool',
    name: 'Delegation fee',
    unit_cost: '0.001',
    probability: '1',
    expected_units_per_invocation: '1',
    step_id: 'delegate',
  });
  const normalized = await request.post('/api/validate', { data: estimate });
  expect(normalized.ok(), await normalized.text()).toBe(true);
  const fixture = await normalized.json();
  await fs.writeFile(path.join(dir, 'input.json'), JSON.stringify(fixture, null, 2));
  const calculate = async (data: unknown) => {
    const response = await request.post('/api/calculate', { data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).scenarios[1];
  };
  const initial = await calculate(fixture);
  expect(Number(initial.monthly_total)).toBeCloseTo(4.68, 10);
  const blocked = await request.post('/api/agents/delete', {
    data: { estimate: fixture, member_id: 'specialist' },
  });
  expect(blocked.status()).toBe(409);
  expect(await blocked.text()).toContain('Root one');
  const zeroReference = structuredClone(fixture);
  zeroReference.agents[0].steps[1].agent_calls[0].probability = '0';
  zeroReference.agents[0].steps[1].agent_calls.push({
    id: 'zero-alternative',
    child_agent_id: 'solo',
    probability: '1',
  });
  expect(
    (
      await request.post('/api/agents/delete', { data: { estimate: zeroReference, member_id: 'specialist' } })
    ).status(),
  ).toBe(409);
  expect(
    (await request.post('/api/agents/delete', { data: { estimate: fixture, member_id: 'roots' } })).status(),
  ).toBe(422);
  expect(
    (
      await request.post('/api/agents/delete', { data: { estimate: fixture, member_id: 'missing' } })
    ).status(),
  ).toBe(422);
  const emptyCaller = structuredClone(fixture);
  emptyCaller.agents[0].count = 0;
  emptyCaller.agents[0].members = [];
  emptyCaller.agents[0].name = 'Unused definition';
  const unusedReference = await request.post('/api/agents/delete', {
    data: { estimate: emptyCaller, member_id: 'specialist' },
  });
  expect(unusedReference.status()).toBe(409);
  expect(await unusedReference.text()).toContain('Unused definition');
  expect((await request.post('/api/estimates', { data: fixture })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /Open estimate/ }).click();
  await page
    .getByRole('dialog', { name: 'Saved estimates' })
    .getByRole('button', { name: /Agent deletion fixture/ })
    .click();
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await expect(page.getByTestId('cost-expected')).toContainText('$4.38');
  await page.getByRole('button', { name: 'Delete Specialist', exact: true }).click();
  const protectedDialog = page.getByRole('dialog', { name: 'Delete Specialist', exact: true });
  await expect(protectedDialog).toContainText('Root one');
  await expect(protectedDialog).toContainText('Root two');
  await expect(protectedDialog).toContainText('Call specialist');
  await expect(protectedDialog.getByRole('button', { name: 'Delete agent', exact: true })).toBeDisabled();
  await protectedDialog.screenshot({ path: path.join(dir, 'referenced-agent.png') });
  await protectedDialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Delete Free one', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete Free one', exact: true })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(page.getByRole('button', { name: 'Edit Free one', exact: true })).toBeVisible();
  const confirm = async (name: string) => {
    await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Delete ${name}`, exact: true });
    await dialog.getByRole('button', { name: 'Delete agent', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: `Edit ${name}`, exact: true })).toHaveCount(0);
  };
  await page.route('**/api/agents/delete', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Deletion unavailable. Try again.' }),
    }),
  );
  await page.getByRole('button', { name: 'Delete Free one', exact: true }).click();
  const unavailable = page.getByRole('dialog', { name: 'Delete Free one', exact: true });
  await unavailable.getByRole('button', { name: 'Delete agent', exact: true }).click();
  await expect(unavailable.getByRole('alert')).toContainText('Deletion unavailable');
  await unavailable.getByRole('button', { name: 'Cancel' }).click();
  await page.unroute('**/api/agents/delete');
  await expect(page.getByRole('button', { name: 'Edit Free one', exact: true })).toBeVisible();
  await expect(page.getByTestId('cost-expected')).toContainText('$4.38');
  await confirm('Free one');
  await expect(page.getByTestId('cost-expected')).toContainText('$4.32');
  const draft = async () => page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!));
  const reduced = await draft();
  const remaining = reduced.agents.find((r: { id: string }) => r.id === 'independent');
  expect(remaining.count).toBe(1);
  expect(remaining.members).toEqual([fixture.agents[2].members[1]]);
  expect(remaining.steps).toEqual(fixture.agents[2].steps);
  expect(Number((await calculate(reduced)).monthly_total)).toBeCloseTo(4.62, 10);
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(page.getByRole('button', { name: 'Edit Free one', exact: true })).toBeVisible();
  await expect(page.getByTestId('cost-expected')).toContainText('$4.38');
  expect((await draft()).agents).toEqual(fixture.agents);
  await confirm('Root one');
  await expect(page.getByTestId('cost-expected')).toContainText('$2.28');
  const firstDeletion = await draft();
  const firstCost = await calculate(firstDeletion);
  expect(Number(firstCost.monthly_total)).toBeCloseTo(2.43, 10);
  expect(Number(firstCost.volumes['specialist-row'].total)).toBe(150);
  expect(firstDeletion.agents.find((r: { id: string }) => r.id === 'roots').members[0].id).toBe('root-two');
  await confirm('Root two');
  await expect(page.getByTestId('cost-expected')).toContainText('$1.08');
  const after = await draft();
  const child = after.agents.find((r: { id: string }) => r.id === 'specialist-row');
  expect(child.volume_source).toBe('daily_users');
  expect(child.users_per_day).toBe('3');
  expect(after.links).toEqual([]);
  const actual = await calculate(after);
  expect(after.agents.reduce((sum: number, row: { count: number }) => sum + row.count, 0)).toBe(4);
  expect(Number(actual.volumes['specialist-row'].total)).toBe(90);
  expect(Number(actual.monthly_total)).toBeCloseTo(1.08, 10);
  expect(Number(actual.tool_cost)).toBe(0);
  // The transform changes only the draft; saved input stays reproducible until Save.
  const unchangedSaved = await (await request.get(`/api/estimates/${fixture.id}`)).json();
  expect(Number((await calculate(unchangedSaved)).monthly_total)).toBeCloseTo(4.68, 10);
  await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
  await expect(page.locator('.alert.notice')).toContainText('saved on this computer');
  await page.reload();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.08');
  const saved = await (await request.get(`/api/estimates/${fixture.id}`)).json();
  await fs.writeFile(path.join(dir, 'saved.json'), JSON.stringify(saved, null, 2));
  const response = await request.post('/api/export', { data: saved });
  expect(response.ok(), await response.text()).toBe(true);
  const file = path.join(dir, 'budget.xlsx');
  await fs.writeFile(file, await response.body());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheets: Record<string, (string | number | boolean | null)[][]> = {};
  workbook.eachSheet((sheet) => {
    const grid: (string | number | boolean | null)[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: (string | number | boolean | null)[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const v = row.getCell(c).value;
        cells.push(
          v && typeof v === 'object' && 'formula' in v
            ? `=${v.formula}`
            : ((v ?? null) as string | number | boolean | null),
        );
      }
      grid.push(cells);
    });
    sheets[sheet.name] = grid;
  });
  const engine = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
  const excel = Number(engine.getCellValue({ sheet: engine.getSheetId('Summary')!, row: 2, col: 3 }));
  expect(excel).toBeCloseTo(1.08, 10);
  const identities: string[] = [];
  workbook.getWorksheet('Agent identities')!.eachRow((row, number) => {
    if (number > 1) identities.push(String(row.getCell(3).value));
  });
  expect(identities).toEqual(['specialist', 'free-one', 'free-two', 'solo']);
  engine.destroy();
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select agent Root two', exact: true })).toHaveCount(0);
  // Individual editor uses the same confirmation, including a shared member.
  await page.getByRole('button', { name: 'Agent inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Free one', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await editor.getByRole('button', { name: 'Delete agent', exact: true }).click();
  const memberDialog = page.getByRole('dialog', { name: 'Delete Free one', exact: true });
  await memberDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Delete agent', exact: true }).click();
  await memberDialog.getByRole('button', { name: 'Delete agent', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('cost-expected')).toContainText('$1.02');
  await confirm('Free two');
  await confirm('Solo');
  await confirm('Specialist');
  await expect(page.getByRole('region', { name: 'Agent inventory', exact: true })).toContainText(
    'No agents yet',
  );
  await expect(page.getByTestId('cost-expected')).toContainText('$0.00');
  const empty = await draft();
  empty.harness.harness_type = 'self_built';
  empty.harness.fixed_monthly = '5';
  await fs.writeFile(path.join(dir, 'empty-fixed-harness.json'), JSON.stringify(empty, null, 2));
  const emptyCost = await calculate(empty);
  expect(Number(emptyCost.monthly_total)).toBe(5);
  await page.getByRole('button', { name: 'Undo last replacement / reset' }).click();
  await expect(page.getByRole('button', { name: 'Edit Specialist', exact: true })).toBeVisible();
  await fs.writeFile(
    path.join(dir, 'verification.json'),
    JSON.stringify(
      {
        command: 'npx playwright test e2e/agent-deletion.spec.ts',
        fixture:
          'input.json; A USD 2/M, B USD 10/M input; 1000 tokens/call; no retries/cache/output; delegation tool USD 0.001/executed step',
        expected: {
          initial: 4.68,
          oneRoot: 2.43,
          finalRootsDeleted: 1.08,
          childAfterOne: 150,
          retainedChild: 90,
          remainingAgents: 4,
          emptyFixedHarness: 5,
        },
        actual: {
          initial: Number(initial.monthly_total),
          oneRoot: Number(firstCost.monthly_total),
          finalRootsDeleted: Number(actual.monthly_total),
          childAfterOne: Number(firstCost.volumes['specialist-row'].total),
          retainedChild: Number(actual.volumes['specialist-row'].total),
          remainingAgents: saved.agents.reduce((sum: number, r: { count: number }) => sum + r.count, 0),
          excel,
          emptyFixedHarness: Number(emptyCost.monthly_total),
        },
        failures: [],
      },
      null,
      2,
    ),
  );
});
