export type Complexity = 'simple' | 'medium' | 'high';
export type ScenarioName = 'Low' | 'Expected' | 'High';
export type Numeric = string;
export interface Execution {
  calls: Numeric;
  input_tokens: Numeric;
  output_tokens: Numeric;
  retry_rate: Numeric;
  cache_fraction: Numeric;
  cache_write_fraction: Numeric;
  model_id: string;
}
export interface Step extends Execution {
  name: string;
}
export interface AgentRow {
  id: string;
  name: string;
  complexity: Complexity;
  count: number;
  invocations: Numeric;
  overrides: Partial<Execution>;
  steps: Step[];
}
export interface Price {
  id: string;
  provider: string;
  input: Numeric | null;
  output: Numeric | null;
  cache_read: Numeric | null;
  cache_write: Numeric | null;
  tiers: {
    above: Numeric;
    input: Numeric | null;
    output: Numeric | null;
    cache_read: Numeric | null;
    cache_write: Numeric | null;
  }[];
  max_input: Numeric | null;
  max_output: Numeric | null;
  source: string;
  retrieved_at: string;
  custom: boolean;
  unsupported: string[];
}
export interface Scenario {
  name: ScenarioName;
  volume_factor: Numeric;
  calls_factor: Numeric;
  input_factor: Numeric;
  output_factor: Numeric;
  retry_factor: Numeric;
  model_id: string | null;
}
export interface AdditionalCost {
  id: string;
  name: string;
  amount: Numeric;
  quantity: Numeric;
  frequency: 'monthly' | 'one-time';
}
export interface Estimate {
  schema_version: 1;
  defaults_version: 1;
  id: string;
  name: string;
  notes: string;
  profiles: Record<Complexity, Execution>;
  agents: AgentRow[];
  scenarios: Scenario[];
  prices: Record<string, Price>;
  additional_costs: AdditionalCost[];
}
export interface Catalog {
  prices: Record<string, Price>;
  source: string;
  retrieved_at: string;
  skipped: number;
  scope: string;
}
export interface Line {
  row_id: string;
  name: string;
  step: string;
  model_id: string;
  provider: string;
  count: number;
  invocations: Numeric;
  calls_per_invocation: Numeric;
  input_per_call: Numeric;
  output_per_call: Numeric;
  retry_rate: Numeric;
  cache_fraction: Numeric;
  cache_write_fraction: Numeric;
  cost: Numeric | null;
  input_tokens: Numeric;
  output_tokens: Numeric;
  monthly_calls: Numeric;
  issues: string[];
}
export interface ScenarioResult {
  name: ScenarioName;
  complete: boolean;
  llm_cost: Numeric;
  monthly_total: Numeric;
  annual_total: Numeric;
  first_month: Numeric;
  input_tokens: Numeric;
  output_tokens: Numeric;
  monthly_calls: Numeric;
  lines: Line[];
}
export interface Results {
  scenarios: ScenarioResult[];
  agent_count: number;
  recurring: Numeric;
  one_time: Numeric;
  warnings: string[];
}

export const complexities: Complexity[] = ['simple', 'medium', 'high'];
export const id = () => crypto.randomUUID();
export const effective = (estimate: Estimate, row: AgentRow): Execution => ({
  ...estimate.profiles[row.complexity],
  ...Object.fromEntries(Object.entries(row.overrides).filter(([, v]) => v != null)),
});
export const money = (value: string | number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Number(value) > 0 && Number(value) < 0.01 ? 6 : 2,
  }).format(Number(value));
export const rateMoney = (value: string | number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(Number(value));
export const number = (value: string | number) =>
  new Intl.NumberFormat('en-US', {
    notation: Number(value) >= 1000000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Number(value));

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = data.detail;
    throw new Error(
      Array.isArray(detail)
        ? detail
            .map((e: { loc: string[]; msg: string }) => `${e.loc.slice(1).join(' → ')}: ${e.msg}`)
            .join('; ')
        : detail || 'The request failed. Please try again.',
    );
  }
  return data;
}
