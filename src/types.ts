export type Complexity = string;
export type PredefinedComplexity = 'simple' | 'medium' | 'high';
export type ScenarioName = 'Low' | 'Expected' | 'High';
export type Numeric = string;
export interface ComplexityProfile {
  calls: Numeric;
  input_tokens: Numeric;
  output_tokens: Numeric;
  retry_rate: Numeric;
  cache_fraction: Numeric;
  cache_write_fraction: Numeric;
}
export interface Execution extends ComplexityProfile {
  model_id: string;
}
export interface Step {
  id: string;
  name: string;
  complexity?: Complexity | null;
  execution_probability: Numeric;
  action_type: 'model' | 'agent';
  low_execution_probability?: Numeric | null;
  high_execution_probability?: Numeric | null;
  model_calls: ModelCall[];
  agent_calls: AgentCall[];
}
export interface AgentCall {
  id: string;
  child_agent_id: string;
  probability: Numeric;
  low?: AgentLink['low'];
  high?: AgentLink['high'];
}
export interface StepActionCost {
  action_type: string;
  cost_per_execution: Numeric;
  cost_per_invocation: Numeric;
  monthly_cost: Numeric;
  complete: boolean;
  options: {
    id: string;
    target_id: string;
    probability: Numeric;
    cost: Numeric;
    weighted_cost: Numeric;
    complete: boolean;
  }[];
}
export interface ModelCall extends Execution {
  id: string;
  role: string;
  probability: Numeric;
}
export interface ToolCost {
  id: string;
  name: string;
  unit_cost: Numeric;
  expected_units_per_invocation: Numeric;
  probability: Numeric;
  step_id: string | null;
}
export interface Harness {
  name: string;
  harness_type: 'none' | 'managed_platform' | 'self_built' | 'hybrid';
  fixed_monthly: Numeric;
  per_invocation: Numeric;
  per_step_execution: Numeric;
  allocation: 'by_invocations';
  include_in_cost_per_use_case: boolean;
}
export interface AgentIdentity {
  id: string;
  name: string;
  business_use_case_description: string;
}
export interface AgentRow {
  id: string;
  name: string;
  description: string;
  use_case_name: string;
  use_case_description: string;
  members: AgentIdentity[];
  complexity: Complexity;
  count: number;
  invocations: Numeric;
  volume_source: 'manual' | 'daily_users' | 'derived';
  prior_volume_source: 'manual' | 'daily_users' | null;
  users_per_day: Numeric | null;
  invocations_per_user_per_agent_per_day: Numeric | null;
  overrides: Partial<Execution>;
  steps: Step[];
  tool_costs: ToolCost[];
}
export interface AgentLink {
  id: string;
  parent_id: string;
  child_id: string;
  trigger_probability: Numeric;
  step_id: string;
  low: { trigger_probability: Numeric | null };
  high: { trigger_probability: Numeric | null };
}
export interface Price {
  id: string;
  provider: string;
  source_type?: 'vendor_api' | 'cloud_marketplace' | 'self_hosted' | 'fine_tuned' | 'custom';
  channel?: string;
  region?: string;
  currency?: string;
  fx_to_usd?: Numeric;
  fx_source?: string;
  fx_retrieved_at?: string;
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
  schema_version: 10;
  defaults_version: 1;
  id: string;
  name: string;
  notes: string;
  profiles: Record<string, ComplexityProfile>;
  agents: AgentRow[];
  links: AgentLink[];
  scenarios: Scenario[];
  prices: Record<string, Price>;
  additional_costs: AdditionalCost[];
  harness: Harness;
}
export interface Catalog {
  prices: Record<string, Price>;
  source: string;
  retrieved_at: string;
  skipped: number;
  scope: string;
}
export interface GlobalCategory {
  name: string;
  profile: ComplexityProfile;
}
export interface Line {
  row_id: string;
  name: string;
  step: string;
  step_id: string | null;
  role: string;
  execution_probability: Numeric;
  model_id: string;
  provider: string;
  count: number;
  invocations: Numeric;
  base_invocations: Numeric;
  base_total_invocations: Numeric;
  calls_per_invocation: Numeric;
  input_per_call: Numeric;
  output_per_call: Numeric;
  retry_rate: Numeric;
  cache_fraction: Numeric;
  cache_write_fraction: Numeric;
  cost: Numeric | null;
  unit_cost: Numeric | null;
  unit_issues: string[];
  input_tokens: Numeric;
  output_tokens: Numeric;
  monthly_calls: Numeric;
  issues: string[];
}
export interface MonthlyTokenSummary {
  input_tokens: Numeric;
  output_tokens: Numeric;
  total_tokens: Numeric;
  input_cost: Numeric;
  output_cost: Numeric;
  total_cost: Numeric;
  tokens_complete: boolean;
  input_complete: boolean;
  output_complete: boolean;
  complete: boolean;
}
export interface AgentCostPreview extends MonthlyTokenSummary {
  steps: Record<string, MonthlyTokenSummary>;
  step_actions: Record<string, StepActionCost>;
}
export interface ScenarioResult {
  monthly_token_summary: MonthlyTokenSummary;
  name: ScenarioName;
  complete: boolean;
  llm_cost: Numeric;
  tool_cost: Numeric;
  harness_cost: Numeric;
  harness_complete: boolean;
  other_cost: Numeric;
  other_complete: boolean;
  monthly_total: Numeric;
  annual_total: Numeric;
  first_month: Numeric;
  input_tokens: Numeric;
  output_tokens: Numeric;
  monthly_calls: Numeric;
  lines: Line[];
  tool_lines: {
    row_id: string;
    agent: string;
    name: string;
    step_id: string | null;
    step_probability: Numeric;
    probability: Numeric;
    expected_units_per_invocation: Numeric;
    unit_cost: Numeric;
    monthly_cost: Numeric;
    cost_per_invocation: Numeric;
  }[];
  harness_allocations: Record<string, Numeric>;
  agent_costs: Record<string, { monthly_total: Numeric; per_agent_monthly: Numeric; complete: boolean }>;
  step_costs: Record<string, Record<string, StepActionCost>>;
  use_case_costs: Record<
    string,
    {
      name: string;
      monthly_invocations: Numeric;
      direct_cost_per_completion: Numeric;
      harness_per_completion: Numeric;
      loaded_cost_per_completion: Numeric;
      complete: boolean;
    }
  >;
  vendor_costs: {
    provider: string;
    source_type: string;
    channel: string;
    monthly_cost: Numeric;
    complete: boolean;
  }[];
  harness_drivers: { invocations: Numeric; step_executions: Numeric };
  volumes: Record<string, VolumeResult>;
  link_contributions: Record<string, LinkContribution>;
}
export interface VolumeResult {
  per_agent: Numeric;
  total: Numeric;
  complete: boolean;
  issues: string[];
}
export interface LinkContribution {
  link_id: string;
  parent_id: string;
  child_id: string;
  parent_total: Numeric;
  trigger_probability: Numeric;
  step_probability: Numeric;
  child_total: Numeric;
  complete: boolean;
}
export interface Results {
  top_agents: {
    agent_id: string;
    name: string;
    use_case_name: string;
    monthly_token_cost: Numeric;
    complete: boolean;
  }[];
  scenarios: ScenarioResult[];
  base_volumes: Record<string, VolumeResult>;
  base_links: Record<string, LinkContribution>;
  cost_drivers: {
    row_id: string;
    name: string;
    complexity: Complexity;
    count: number;
    known_cost: Numeric;
    complete: boolean;
    issues: string[];
  }[];
  category_invocations: Record<string, { total: Numeric; complete: boolean }>;
  category_tokens: Record<
    string,
    {
      monthly_input: Numeric;
      monthly_output: Numeric;
      monthly_total: Numeric;
      daily_total: Numeric;
      complete: boolean;
    }
  >;
  category_costs: Record<
    string,
    {
      monthly_cost: Numeric;
      daily_cost: Numeric;
      monthly_input_cost: Numeric;
      monthly_output_cost: Numeric;
      input_complete: boolean;
      output_complete: boolean;
      complete: boolean;
      types: Record<
        'input' | 'cache_read' | 'cache_write' | 'output',
        {
          monthly_tokens: Numeric;
          daily_tokens: Numeric;
          monthly_cost: Numeric;
          daily_cost: Numeric;
          complete: boolean;
        }
      >;
      entries: {
        token_type: 'input' | 'cache_read' | 'cache_write' | 'output';
        model_id: string;
        rate_per_million: Numeric | null;
        monthly_tokens: Numeric;
        monthly_cost: Numeric;
        complete: boolean;
        issues: string[];
      }[];
    }
  >;
  monthly_token_summary: MonthlyTokenSummary;
  agent_count: number;
  recurring: Numeric;
  one_time: Numeric;
  warnings: string[];
}

export const complexities: PredefinedComplexity[] = ['simple', 'medium', 'high'];
export const categoryClass = (name: string) =>
  name === 'simple' || name === 'medium' || name === 'high' ? name : 'custom';
export const id = () => crypto.randomUUID();
export const pendingUseCase = 'Business use case pending description';
export const resizeMembers = (row: AgentRow, count: number): AgentIdentity[] => {
  if (!Number.isInteger(count) || count < 0 || count > 5000) return row.members;
  const members = row.members.slice(0, count);
  for (let index = members.length; index < count; index++) {
    members.push({
      id: id(),
      name: count === 1 ? row.name : `${row.name} ${index + 1}`,
      business_use_case_description: row.use_case_description || pendingUseCase,
    });
  }
  return members;
};
export const effective = (estimate: Estimate, row: AgentRow): Execution => ({
  ...estimate.profiles[row.complexity],
  model_id: '',
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
export const displayVolume = (value: string) => {
  const exact =
    value.includes('.') && !/[eE]/.test(value) ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  const numeric = Number(exact);
  if (!Number.isFinite(numeric) || (numeric > 0 && numeric < 0.000001)) return exact;
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(numeric);
  const decimals = exact.split('.')[1]?.length ?? 0;
  return decimals > 6 ? `≈${formatted}` : formatted;
};

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

// Graph links project step choices. Call only on a draft that is about to be
// validated/applied; the backend repeats this projection at its boundary.
export function syncAgentActions(estimate: Estimate): Estimate {
  const previousChildren = new Set(estimate.links.map((link) => link.child_id));
  estimate.links = [];
  const memberRows = new Map(
    estimate.agents.flatMap((row) => row.members.map((member) => [member.id, row] as const)),
  );
  for (const row of estimate.agents)
    for (const step of row.steps) {
      if (step.action_type !== 'agent') continue;
      for (const option of step.agent_calls ?? []) {
        const target = memberRows.get(option.child_agent_id);
        // The backend separates a targeted shared member when applying the candidate.
        if (!target || target.count !== 1) continue;
        estimate.links.push({
          id: option.id,
          parent_id: row.id,
          child_id: target.id,
          step_id: step.id,
          trigger_probability: option.probability,
          low: option.low ?? { trigger_probability: null },
          high: option.high ?? { trigger_probability: null },
        });
      }
    }
  const children = new Set(estimate.links.map((link) => link.child_id));
  for (const row of estimate.agents) {
    if (children.has(row.id) && row.volume_source !== 'derived') {
      row.prior_volume_source = row.volume_source;
      row.volume_source = 'derived';
    } else if (previousChildren.has(row.id) && !children.has(row.id) && row.volume_source === 'derived') {
      row.volume_source = row.prior_volume_source ?? 'daily_users';
      row.prior_volume_source = null;
    }
  }
  return estimate;
}
export function modelStep(execution: Execution, name: string, complexity: string): Step {
  return {
    id: id(),
    name,
    complexity,
    action_type: 'model',
    execution_probability: '1',
    agent_calls: [],
    model_calls: [{ ...execution, id: id(), role: '', probability: '1' }],
  };
}

// Validate selection totals with decimal integers, matching the backend boundary.
// Floating-point addition can hide a small excess above 1.0.
export function distributionTotal(values: string[]): { valid: boolean; percent: string } {
  const decimals: { units: bigint; scale: number }[] = [];
  for (const value of values) {
    const match = /^([+-]?)(\d*\.?\d+)(?:e([+-]?\d+))?$/i.exec(String(value).trim());
    if (!match) return { valid: false, percent: 'Invalid' };
    const [whole, fraction = ''] = match[2].split('.');
    const exponent = Number(match[3] ?? 0);
    const scale = fraction.length - exponent;
    if (!Number.isSafeInteger(exponent) || Math.abs(scale) > 1000)
      return { valid: false, percent: 'Invalid' };
    let units = BigInt(`${whole || '0'}${fraction}`);
    if (match[1] === '-' && units !== 0n) return { valid: false, percent: 'Invalid' };
    if (scale < 0) units *= 10n ** BigInt(-scale);
    const places = Math.max(scale, 0);
    if (units > 10n ** BigInt(places)) return { valid: false, percent: 'Invalid' };
    decimals.push({ units, scale: places });
  }
  const scale = Math.max(0, ...decimals.map((value) => value.scale));
  const one = 10n ** BigInt(scale);
  const sum = decimals.reduce((total, value) => total + value.units * 10n ** BigInt(scale - value.scale), 0n);
  const percentUnits = (sum * 100n).toString().padStart(scale + 1, '0');
  const percent =
    scale === 0
      ? percentUnits
      : `${percentUnits.slice(0, -scale)}.${percentUnits.slice(-scale)}`.replace(/\.?0+$/, '');
  return { valid: values.length > 0 && sum === one, percent: `${percent}%` };
}
