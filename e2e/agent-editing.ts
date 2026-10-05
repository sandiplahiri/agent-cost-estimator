import { expect, type Page } from '@playwright/test';

// Existing bulk journeys explicitly edit the stored shared settings. Individual
// graph journeys click the node directly, using the same editor as inventory.
export async function openAgentEditor(page: Page, name: string) {
  await page.getByRole('button', { name: 'Agent suite graph', exact: true }).click();
  const shared = page.locator('.graph-shared-settings');
  if ((await shared.getAttribute('open')) === null) await shared.locator('summary').click();
  await shared.getByRole('button', { name: `Edit shared settings for ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit agent' });
  for (const details of await dialog.locator('details.step-details').all())
    if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  return dialog;
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
