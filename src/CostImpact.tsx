import { useState } from 'react';
import { api, effective, money, type AgentRow, type Estimate, type Results } from './types';

type SensitivityField =
  | 'users_per_day'
  | 'invocations_per_user_per_agent_per_day'
  | 'invocations'
  | 'calls'
  | 'input_tokens'
  | 'output_tokens'
  | 'retry_rate'
  | 'cache_fraction'
  | 'cache_write_fraction';

interface ImpactResult {
  row_id: string;
  field: SensitivityField;
  value: string;
  baseline_row_cost: string | null;
  proposed_row_cost: string | null;
  row_delta: string | null;
  baseline_suite_cost: string | null;
  proposed_suite_cost: string | null;
  suite_delta: string | null;
  issues: string[];
  suite_complete: boolean;
}

const executionFields: { field: SensitivityField; label: string; unit: string }[] = [
  { field: 'calls', label: 'Model calls per invocation', unit: 'calls / invocation' },
  { field: 'input_tokens', label: 'Input tokens per model call', unit: 'tokens / call' },
  { field: 'output_tokens', label: 'Output tokens per model call', unit: 'tokens / call' },
  { field: 'retry_rate', label: 'Additional attempt rate', unit: 'extra attempts / normal call' },
  { field: 'cache_fraction', label: 'Cached-read share of input', unit: 'fraction, 0–1' },
  { field: 'cache_write_fraction', label: 'Cache-write share of input', unit: 'fraction, 0–1' },
];

function fieldsFor(row: AgentRow) {
  const volumeFields: typeof executionFields =
    row.volume_source === 'daily_users'
      ? [
          { field: 'users_per_day', label: 'Users per agent per day', unit: 'users / agent / day' },
          {
            field: 'invocations_per_user_per_agent_per_day',
            label: 'Invocations per user per agent per day',
            unit: 'invocations / user / agent / day',
          },
        ]
      : [
          {
            field: 'invocations',
            label: 'Legacy monthly invocations per agent',
            unit: 'invocations / agent / month',
          },
        ];
  return row.steps.length ? volumeFields : [...volumeFields, ...executionFields];
}

function currentValue(estimate: Estimate, row: AgentRow, field: SensitivityField) {
  if (field === 'users_per_day') return row.users_per_day ?? '';
  if (field === 'invocations_per_user_per_agent_per_day')
    return row.invocations_per_user_per_agent_per_day ?? '';
  if (field === 'invocations') return row.invocations;
  return effective(estimate, row)[field];
}

function source(row: AgentRow, field: SensitivityField) {
  if (field === 'users_per_day' || field === 'invocations_per_user_per_agent_per_day')
    return 'Daily workload input';
  if (field === 'invocations') return 'Legacy monthly workload input';
  return row.overrides[field] != null ? 'Agent row override' : `${row.complexity} profile`;
}

function scenarioMultiplier(estimate: Estimate, field: SensitivityField) {
  const scenario = estimate.scenarios.find((item) => item.name === 'Expected');
  if (!scenario) return null;
  if (
    field === 'users_per_day' ||
    field === 'invocations_per_user_per_agent_per_day' ||
    field === 'invocations'
  )
    return scenario.volume_factor;
  if (field === 'calls') return scenario.calls_factor;
  if (field === 'input_tokens') return scenario.input_factor;
  if (field === 'output_tokens') return scenario.output_factor;
  if (field === 'retry_rate') return scenario.retry_factor;
  return null;
}

const signedMoney = (value: string) => (Number(value) > 0 ? `+${money(value)}` : money(value));

export function CostImpact({ estimate, result }: { estimate: Estimate; result: Results | null }) {
  const [selectedId, setSelectedId] = useState('');
  const [selectedField, setSelectedField] = useState<SensitivityField>('input_tokens');
  const [value, setValue] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ estimate: Estimate; result: ImpactResult } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');

  const drivers = result?.cost_drivers || [];
  const selectedDriver = drivers.find((item) => item.row_id === selectedId) || drivers[0];
  const row = estimate.agents.find((item) => item.id === selectedDriver?.row_id);
  const choices = row ? fieldsFor(row) : [];
  const field = choices.some((choice) => choice.field === selectedField) ? selectedField : choices[0]?.field;
  const choice = choices.find((item) => item.field === field);
  const baselineValue = row && field ? currentValue(estimate, row, field) : '';
  const proposedValue = value ?? baselineValue;
  const activePreview =
    preview?.estimate === estimate &&
    preview.result.row_id === row?.id &&
    preview.result.field === field &&
    preview.result.value === proposedValue
      ? preview.result
      : null;
  const expected = result?.scenarios.find((scenario) => scenario.name === 'Expected');
  const maxCost = Math.max(...drivers.map((item) => Number(item.known_cost)), 0);
  const filtered = drivers.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  const visible = showAll || search ? filtered : filtered.slice(0, 8);

  function selectRow(rowId: string) {
    setSelectedId(rowId);
    setValue(null);
    setPreview(null);
    setError('');
  }

  async function calculateImpact() {
    if (!row || !field || proposedValue === '') return;
    const base = estimate;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const response = await api<ImpactResult>('/sensitivity', {
        estimate: base,
        row_id: row.id,
        field,
        value: proposedValue,
      });
      setPreview({ estimate: base, result: response });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not calculate the impact.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel impact-panel" aria-label="Cost drivers and impact">
      <div className="section-heading">
        <div>
          <h2>Cost drivers &amp; impact</h2>
          <p>Expected monthly LLM spend · Preview one assumption at a time</p>
        </div>
      </div>
      {drivers.length === 0 ? (
        <div className="empty-inline">
          {estimate.agents.some((agent) => agent.count > 0)
            ? 'Cost drivers will appear when this estimate finishes calculating.'
            : 'Add agents to explore their cost drivers.'}
        </div>
      ) : (
        <div className="impact-grid">
          <div className="impact-drivers">
            <label className="field">
              <span>Find an agent group</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search cost drivers…"
              />
            </label>
            <div className="impact-driver-list">
              {visible.map((driver, index) => {
                const share =
                  expected?.complete && Number(expected.llm_cost) > 0
                    ? (100 * Number(driver.known_cost)) / Number(expected.llm_cost)
                    : null;
                return (
                  <button
                    key={driver.row_id}
                    className={`impact-driver ${driver.row_id === row?.id ? 'selected' : ''}`}
                    aria-pressed={driver.row_id === row?.id}
                    onClick={() => selectRow(driver.row_id)}
                  >
                    <span className="impact-driver-top">
                      <span>
                        <strong>{driver.name}</strong>
                        <small>
                          {driver.count} {driver.count === 1 ? 'agent' : 'agents'} · {driver.complexity}
                        </small>
                      </span>
                      <span className="impact-driver-cost">
                        {driver.complete ? money(driver.known_cost) : 'Incomplete'}
                        <small>
                          {driver.complete
                            ? share === null
                              ? 'monthly LLM'
                              : `${share.toFixed(1)}% of suite`
                            : `${money(driver.known_cost)} known`}
                        </small>
                      </span>
                    </span>
                    <span className="bar-track" aria-hidden="true">
                      <span
                        className={driver.complexity}
                        style={{ width: `${maxCost ? (100 * Number(driver.known_cost)) / maxCost : 0}%` }}
                      />
                    </span>
                    <span className="sr-only">Rank {index + 1} of visible cost drivers.</span>
                  </button>
                );
              })}
              {visible.length === 0 && <p className="muted">No matching agent groups.</p>}
            </div>
            {!showAll && !search && filtered.length > 8 && (
              <button className="text-button" onClick={() => setShowAll(true)}>
                Show all {filtered.length} groups
              </button>
            )}
            {!expected?.complete && (
              <p className="muted small">Ranking uses known costs; unpriced groups may rank differently.</p>
            )}
          </div>
          {row && choice && field && (
            <div className="impact-preview">
              <h3>Preview a change to {row.name}</h3>
              <p className="muted">
                This comparison uses the current Expected scenario and estimate pricing snapshot.
              </p>
              <label className="field">
                <span>Assumption to change</span>
                <select
                  value={field}
                  onChange={(event) => {
                    setSelectedField(event.target.value as SensitivityField);
                    setValue(null);
                    setPreview(null);
                    setError('');
                  }}
                >
                  {choices.map((item) => (
                    <option key={item.field} value={item.field}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="impact-values">
                <div>
                  <span>Current row value</span>
                  <strong>{baselineValue === '' ? 'Missing' : baselineValue}</strong>
                  <small>{source(row, field)}</small>
                  {scenarioMultiplier(estimate, field) !== null && (
                    <small>Expected scenario multiplier: {scenarioMultiplier(estimate, field)}×</small>
                  )}
                </div>
                <label className="field">
                  <span>Proposed value · {choice.unit}</span>
                  <input
                    type="number"
                    min="0"
                    max={field === 'cache_fraction' || field === 'cache_write_fraction' ? '1' : undefined}
                    step="any"
                    value={proposedValue}
                    onChange={(event) => {
                      setValue(event.target.value);
                      setPreview(null);
                      setError('');
                    }}
                  />
                </label>
              </div>
              {row.steps.length > 0 && (
                <p className="muted small">
                  Detailed steps define execution; preview their workload volume here.
                </p>
              )}
              <button
                className="button dark"
                disabled={busy || proposedValue === ''}
                onClick={() => void calculateImpact()}
              >
                {busy ? 'Calculating…' : 'Calculate impact'}
              </button>
              {error && (
                <p className="invalid-text" role="alert">
                  {error}
                </p>
              )}
              {activePreview && (
                <div className="impact-result" role="status">
                  {activePreview.row_delta === null ? (
                    <p>Group comparison is incomplete. {activePreview.issues.join(' ')}</p>
                  ) : (
                    <>
                      <div className="impact-result-row">
                        <span>Group monthly LLM</span>
                        <strong>
                          {money(activePreview.baseline_row_cost!)} →{' '}
                          {money(activePreview.proposed_row_cost!)}
                        </strong>
                        <span className="impact-delta">{signedMoney(activePreview.row_delta)} / month</span>
                      </div>
                      {activePreview.suite_delta === null ? (
                        <p>
                          Full suite impact is incomplete because another group has missing inputs or prices.
                        </p>
                      ) : (
                        <div className="impact-result-row">
                          <span>Suite monthly LLM</span>
                          <strong>
                            {money(activePreview.baseline_suite_cost!)} →{' '}
                            {money(activePreview.proposed_suite_cost!)}
                          </strong>
                          <span className="impact-delta">
                            {signedMoney(activePreview.suite_delta)} / month
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  <small>Preview only. The estimate and Excel export still use the current value.</small>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
