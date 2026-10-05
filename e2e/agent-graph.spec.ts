import { test, expect } from '@playwright/test';
import { modelStep } from './workflow-fixtures';
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import fs from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve('artifacts/individual-agent-graph');

test('individual graph edits preserve siblings, update routing and reconcile saved Excel costs', async ({
  page,
  request,
}) => {
  await fs.mkdir(directory, { recursive: true });
  const actual: Record<string, unknown> = {};
  const failures: string[] = [];
  const expected = {
    initialUsd: 2.52,
    editedCallerUsd: 3.72,
    reroutedUsd: 3.66,
    editedChildUsd: 4.26,
    agents: 6,
    aliceInvocations: 540,
    bobInvocations: 60,
    caraInvocations: 300,
    danaInvocations: 30,
  };
  try {
    const estimate = await (await request.get('/api/new')).json();
    estimate.name = 'Individual graph v1';
    estimate.id = `individual-graph-${Date.now()}`;
    const execution = {
      calls: '1',
      input_tokens: '1000',
      output_tokens: '0',
      retry_rate: '0',
      cache_fraction: '0',
      cache_write_fraction: '0',
    };
    estimate.profiles.simple = execution;
    estimate.prices = {
      A: {
        id: 'A',
        provider: 'Synthetic fixture',
        input: '2',
        output: '0',
        source: 'Individual graph v1, not provider prices',
        retrieved_at: '2026-10-05',
        custom: true,
      },
    };
    const members = (names: string[]) =>
      names.map((name) => ({
        id: name.toLowerCase().replaceAll(' ', '-'),
        name,
        business_use_case_description: `${name} handles a request`,
      }));
    const row = (id: string, name: string, names: string[], users: string) => ({
      id,
      name,
      complexity: 'simple',
      count: names.length,
      members: members(names),
      use_case_name: 'Handle request',
      volume_source: 'daily_users',
      users_per_day: users,
      invocations_per_user_per_agent_per_day: '1',
      overrides: { model_id: 'A' },
      steps: [modelStep(`${id}-model`, { ...execution, model_id: 'A' })],
    });
    estimate.agents = [
      row('roots', 'Root settings', ['Root one', 'Root two'], '10'),
      row('workers', 'Worker settings', ['Alice', 'Bob', 'Cara', 'Dana'], '1'),
    ];
    estimate.agents[0].steps.push({
      id: 'route',
      name: 'Route request',
      action_type: 'agent',
      execution_probability: '1',
      model_calls: [],
      agent_calls: [
        { id: 'alice-option', child_agent_id: 'alice', probability: '0.8' },
        { id: 'bob-option', child_agent_id: 'bob', probability: '0.2' },
      ],
    });
    await fs.writeFile(path.join(directory, 'input.json'), JSON.stringify(estimate, null, 2));
    const created = await request.post('/api/estimates', { data: estimate });
    expect(created.ok(), await created.text()).toBe(true);
    await page.goto('/');
    await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
    await page
      .getByRole('region', { name: 'Agent invocation graph' })
      .getByRole('button', { name: 'Add agent', exact: true })
      .click();
    const newAgent = page.getByRole('dialog', { name: 'Add agent' });
    await expect(newAgent.getByLabel('Agent name', { exact: true })).toHaveValue('New agent');
    await newAgent.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: /Open estimate/ }).click();
    await page
      .getByRole('dialog', { name: 'Saved estimates' })
      .getByRole('button', { name: /Individual graph v1/ })
      .click();
    await expect(page.getByTestId('cost-expected')).toHaveText('$2.52/mo');
    const suiteCost = async () =>
      Number((await page.getByTestId('cost-expected').innerText()).replace(/[^0-9.]/g, ''));
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('agent-ledger-draft-v1')!));
    const initial = await draft();
    await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
    const graph = page.getByRole('region', { name: 'Agent invocation graph' });
    const node = (name: string) => graph.getByRole('button', { name: `Select agent ${name}`, exact: true });
    const relationship = (source: string, target: string) =>
      graph.locator(`.graph-relationship[data-source="${source}"][data-target="${target}"]`);
    await expect(graph.locator('.graph-node')).toHaveCount(6);
    await expect(node('Root one')).toContainText('$0.60/mo');
    await expect(node('Alice')).toContainText('$0.96/mo');
    await expect(relationship('root-one', 'alice')).toContainText('80%');
    await expect(relationship('root-two', 'alice')).toHaveCount(1);
    actual.initialUsd = await suiteCost();

    await node('Dana').focus();
    await page.keyboard.press('Enter');
    const editor = page.getByRole('dialog', { name: 'Edit agent' });
    await expect(editor.getByLabel('Agent name', { exact: true })).toHaveValue('Dana');
    await editor.getByLabel('Agent name', { exact: true }).fill('Discarded name');
    await editor.getByRole('button', { name: 'Close dialog' }).click();
    expect(await draft()).toEqual(initial);
    await expect(node('Dana')).toBeVisible();

    await node('Root one').click();
    await editor.getByLabel('Agent name', { exact: true }).fill('Planner');
    await editor.getByLabel('Users per agent per day *', { exact: true }).fill('20');
    await editor.getByRole('button', { name: 'Apply changes' }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByTestId('cost-expected')).toHaveText('$3.72/mo');
    await expect(node('Planner')).toContainText('$1.20/mo');
    await expect(node('Root two')).toContainText('$0.60/mo');
    await expect(node('Alice')).toContainText('$1.44/mo');
    await expect(graph.locator('.graph-node')).toHaveCount(6);
    actual.editedCallerUsd = await suiteCost();

    await node('Planner').click();
    await editor.getByLabel('Step 2 agent 2', { exact: true }).selectOption('cara');
    await editor.getByLabel('Step 2 agent 1 probability (0–1)', { exact: true }).fill('0.4');
    await editor.getByLabel('Step 2 agent 2 probability (0–1)', { exact: true }).fill('0.5');
    await editor.getByRole('button', { name: 'Apply changes' }).click();
    await expect(editor.getByRole('alert')).toBeVisible();
    await expect(relationship('root-one', 'bob')).toHaveCount(1);
    await expect(page.getByTestId('cost-expected')).toHaveText('$3.72/mo');
    await editor.getByLabel('Step 2 agent 1 probability (0–1)', { exact: true }).fill('0.5');
    await editor.getByRole('button', { name: 'Apply changes' }).click();
    await expect(editor).toBeHidden();
    await expect(relationship('root-one', 'bob')).toHaveCount(0);
    await expect(relationship('root-one', 'cara')).toContainText('50%');
    await expect(relationship('root-two', 'bob')).toContainText('20%');
    await expect(node('Alice')).toContainText('$1.08/mo');
    await expect(node('Bob')).toContainText('$0.12/mo');
    await expect(node('Cara')).toContainText('$0.60/mo');
    await expect(node('Dana')).toContainText('$0.06/mo');
    await expect(page.getByTestId('cost-expected')).toHaveText('$3.66/mo');
    actual.reroutedUsd = await suiteCost();

    await node('Cara').click();
    await editor.getByLabel('Business use case name', { exact: true }).fill('Write response');
    await editor.locator('details.step-details').first().locator('summary').click();
    await editor.getByLabel('Input tokens / call', { exact: true }).fill('2000');
    await editor.getByRole('button', { name: 'Apply changes' }).click();
    await expect(editor).toBeHidden();
    await expect(node('Cara')).toContainText('$1.20/mo');
    await expect(node('Dana')).toContainText('$0.06/mo');
    await expect(page.getByTestId('cost-expected')).toHaveText('$4.26/mo');
    await page.getByRole('button', { name: 'Save estimate', exact: true }).click();
    const saved = await (await request.get(`/api/estimates/${estimate.id}`)).json();
    const result = await (await request.post('/api/calculate', { data: saved })).json();
    actual.editedChildUsd = Number(result.scenarios[1].llm_cost);
    expect(actual.editedChildUsd).toBeCloseTo(4.26, 10);
    actual.agents = saved.agents.reduce((sum: number, agent: { count: number }) => sum + agent.count, 0);
    expect(actual.agents).toBe(6);
    for (const [name, invocations] of [
      ['alice', 540],
      ['bob', 60],
      ['cara', 300],
      ['dana', 30],
    ] as const) {
      const owner = saved.agents.find((agent: { members: { id: string }[] }) =>
        agent.members.some((member) => member.id === name),
      );
      actual[`${name}Invocations`] = Number(result.scenarios[1].volumes[owner.id].per_agent);
      expect(actual[`${name}Invocations`]).toBe(invocations);
    }
    await fs.writeFile(path.join(directory, 'saved.json'), JSON.stringify(saved, null, 2));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
    const workbookPath = path.join(directory, 'budget.xlsx');
    await (await download).saveAs(workbookPath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const sheets: Record<string, (string | number | boolean | null)[][]> = {};
    workbook.eachSheet((sheet) => {
      const rows: (string | number | boolean | null)[][] = [];
      sheet.eachRow({ includeEmpty: true }, (row) =>
        rows.push(
          Array.from({ length: sheet.columnCount }, (_, index) => {
            const value = row.getCell(index + 1).value;
            return value && typeof value === 'object' && 'formula' in value
              ? `=${value.formula}`
              : typeof value === 'string'
                ? `'${value}`
                : typeof value === 'number' || typeof value === 'boolean'
                  ? value
                  : null;
          }),
        ),
      );
      sheets[sheet.name] = rows;
    });
    const formulas = HyperFormula.buildFromSheets(sheets, { licenseKey: 'gpl-v3' });
    actual.excelUsd = formulas.getCellValue({ sheet: formulas.getSheetId('Summary')!, row: 2, col: 1 });
    expect(actual.excelUsd).toBeCloseTo(4.26, 10);
    formulas.destroy();
    await page.reload();
    await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
    await expect(node('Planner')).toContainText('$1.20/mo');
    await expect(relationship('root-one', 'cara')).toContainText('50%');
    await node('Cara').click();
    await expect(editor.getByLabel('Business use case name', { exact: true })).toHaveValue('Write response');
    await editor.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByTestId('cost-expected')).toHaveText('$4.26/mo');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(directory, 'graph-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await node('Dana').click();
    await expect(editor.getByLabel('Agent name', { exact: true })).toHaveValue('Dana');
    await editor.getByRole('button', { name: 'Close dialog' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(directory, 'graph-mobile.png'), fullPage: true });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await fs.writeFile(
      path.join(directory, 'verification.json'),
      JSON.stringify(
        {
          command: 'npx playwright test e2e/agent-graph.spec.ts',
          fixture:
            'input.json; A USD 2/M input, 0/M output; 1000 tokens/call (Cara edited to 2000); 30-day month; no retries/cache/harness/tools',
          expected,
          actual,
          failures,
          completed: Object.hasOwn(actual, 'excelUsd'),
        },
        null,
        2,
      ),
    );
  }
});
