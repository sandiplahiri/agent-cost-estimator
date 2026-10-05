import { expect, type Page } from '@playwright/test';

// Shared settings remain available through the graph; inventory edits one member.
export async function openAgentEditor(page: Page, name: string) {
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  await page.getByRole('button', { name: `Select agent ${name}`, exact: true }).click();
  await page
    .locator('.graph-inspector-agent')
    .getByRole('button', { name: /^(Edit all \d+ agents|Edit steps and tools)$/ })
    .click();
  return page.getByRole('dialog', { name: 'Edit agent' });
}

export async function expectBaseVolume(page: Page, name: string, perAgent: number, total: number) {
  await expect
    .poll(async () => {
      const estimate = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('agent-ledger-draft-v1') || '{}'),
      );
      const response = await page.request.post('/api/calculate', { data: estimate });
      if (!response.ok()) return { status: response.status(), error: await response.text() };
      const result = await response.json();
      const row = estimate.agents.find((agent: { name: string }) => agent.name === name);
      if (!row) return null;
      const volume = result.base_volumes[row.id];
      return [Number(Number(volume.per_agent).toFixed(8)), Number(Number(volume.total).toFixed(8))];
    })
    .toEqual([perAgent, total]);
}
