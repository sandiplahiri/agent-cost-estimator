import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ExecutionFields, Field, Modal, ModelPicker, Numeric } from './components';
import {
  effective,
  api,
  displayVolume,
  id,
  rateMoney,
  resizeMembers,
  type AgentRow,
  type AgentCostPreview,
  type Estimate,
  type Execution,
  type ModelCall,
  type MonthlyTokenSummary,
  type Price,
  type Step,
} from './types';
const clone = <T,>(value: T): T => structuredClone(value);

function useAgentCost(draft: AgentRow, estimate: Estimate, prices: Record<string, Price>, memberId?: string) {
  const [preview, setPreview] = useState<{
    draft: AgentRow;
    estimate: Estimate;
    prices: Record<string, Price>;
    summary?: AgentCostPreview;
    error?: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      // Fill only newly selected prices; retain every frozen estimate price.
      const snapshot = clone(estimate);
      const modelIds = [
        draft.overrides.model_id,
        ...draft.steps.flatMap((step) => [step.model_id, ...step.model_calls.map((call) => call.model_id)]),
      ];
      for (const modelId of modelIds)
        if (modelId && !snapshot.prices[modelId] && prices[modelId])
          snapshot.prices[modelId] = clone(prices[modelId]);
      try {
        const summary = await api<AgentCostPreview>(
          '/agents/cost',
          { estimate: snapshot, draft, member_id: memberId },
          controller.signal,
        );
        if (!controller.signal.aborted) setPreview({ draft, estimate, prices, summary });
      } catch (cause) {
        if (!controller.signal.aborted)
          setPreview({
            draft,
            estimate,
            prices,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, estimate, prices, memberId]);
  const current = preview?.draft === draft && preview.estimate === estimate && preview.prices === prices;
  return {
    summary: current ? preview.summary : undefined,
    error: current ? preview.error : undefined,
    pending: !current,
  };
}

type CostPreviewState = ReturnType<typeof useAgentCost>;

function CostSection({
  summary,
  error,
  pending,
  agentCount,
  stepNumber,
}: {
  summary?: MonthlyTokenSummary;
  error?: string;
  pending: boolean;
  agentCount: number;
  stepNumber?: number;
}) {
  const cost = (value: string, complete: boolean) =>
    complete ? rateMoney(value) : Number(value) === 0 ? 'Incomplete' : `${rateMoney(value)} (partial)`;
  const tokens = (value: string) =>
    summary?.tokens_complete
      ? displayVolume(value)
      : Number(value) === 0
        ? 'Incomplete'
        : `${displayVolume(value)} (partial)`;
  return (
    <section
      className={`editor-section ${stepNumber ? 'step-cost' : 'agent-cost'}`}
      aria-label={stepNumber ? `Step ${stepNumber} cost` : 'Agent cost'}
      aria-busy={pending}
    >
      {stepNumber ? <h4>Cost</h4> : <h3>Cost</h3>}
      <p className="muted small">
        Expected monthly · USD{agentCount > 1 ? ` · All ${agentCount} agents in this entry` : ''}. Updates
        with your edits. Token costs exclude harness, tools, and other costs.
      </p>
      {summary ? (
        <div className="table-scroll">
          <table className="agent-table">
            <thead>
              <tr>
                <th>Total input tokens</th>
                <th>Input token cost</th>
                <th>Total output tokens</th>
                <th>Output token cost</th>
                <th>Total token cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{tokens(summary.input_tokens)}</td>
                <td>{cost(summary.input_cost, summary.input_complete)}</td>
                <td>{tokens(summary.output_tokens)}</td>
                <td>{cost(summary.output_cost, summary.output_complete)}</td>
                <td>{cost(summary.total_cost, summary.complete)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : error ? (
        <p role="alert">Could not calculate cost: {error}</p>
      ) : (
        <p role="status" className="muted small">
          Calculating cost…
        </p>
      )}
    </section>
  );
}

export function AgentEditor({
  row,
  estimate,
  prices,
  onClose,
  onSave,
  onRemove,
  onSplit,
  singleAgent = false,
  pendingGroupMember = false,
}: {
  row: AgentRow;
  estimate: Estimate;
  prices: Record<string, Price>;
  onClose: () => void;
  onSave: (row: AgentRow) => Promise<void>;
  onRemove: () => void;
  onSplit: (draft: AgentRow) => Promise<void>;
  singleAgent?: boolean;
  pendingGroupMember?: boolean;
}) {
  const [draft, setDraft] = useState(() => {
    const initial = clone(row);
    if (singleAgent && initial.steps.length === 0) {
      initial.steps = [
        {
          ...effective(estimate, initial),
          id: id(),
          name: 'Main step',
          complexity: initial.complexity,
          execution_probability: '1',
          model_calls: [],
        },
      ];
    }
    return initial;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [memberPage, setMemberPage] = useState(0);
  const execution = effective(estimate, draft);
  const costPreview = useAgentCost(
    draft,
    estimate,
    prices,
    pendingGroupMember ? draft.members[0]?.id : undefined,
  );
  const hasLinks = estimate.links.some((link) => link.parent_id === row.id || link.child_id === row.id);
  const addingAgent = singleAgent && !estimate.agents.some((agent) => agent.id === row.id);
  return (
    <Modal title={addingAgent ? 'Add agent' : 'Edit agent'} onClose={onClose} wide>
      <div className="form-grid">
        <Field label="Agent name">
          <input
            value={draft.name}
            onChange={(e) =>
              setDraft({
                ...draft,
                name: e.target.value,
                members:
                  draft.count === 1
                    ? draft.members.map((member) => ({ ...member, name: e.target.value }))
                    : draft.members,
              })
            }
          />
        </Field>
        <Field label="Business use case name">
          <input
            value={draft.use_case_name}
            onChange={(e) => setDraft({ ...draft, use_case_name: e.target.value })}
            placeholder="e.g. Resolve a billing inquiry"
          />
        </Field>
        <Field label="Business use case description">
          <input
            value={draft.use_case_description}
            onChange={(e) =>
              setDraft({
                ...draft,
                use_case_description: e.target.value,
                members:
                  draft.count === 1
                    ? draft.members.map((member) => ({
                        ...member,
                        business_use_case_description: e.target.value,
                      }))
                    : draft.members,
              })
            }
          />
        </Field>
        {!singleAgent && (
          <Field label="Complexity">
            <select
              value={draft.complexity}
              onChange={(e) => setDraft({ ...draft, complexity: e.target.value })}
            >
              {Object.keys(estimate.profiles).map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!singleAgent && (
          <Numeric
            label="Agent count"
            integer
            value={draft.count}
            onChange={(v) => {
              const count = Number(v);
              setDraft({ ...draft, count, members: resizeMembers(draft, count) });
              setMemberPage(0);
            }}
          />
        )}
        {(draft.volume_source !== 'derived' || singleAgent) && (
          <>
            <Numeric
              label="Users per agent per day *"
              value={draft.users_per_day ?? ''}
              required
              onChange={(users_per_day) =>
                setDraft({
                  ...draft,
                  users_per_day: users_per_day || null,
                  volume_source: draft.volume_source === 'derived' ? 'derived' : 'daily_users',
                })
              }
              hint={
                singleAgent
                  ? 'Daily users of this agent. Uses a 30-day planning month.'
                  : 'Daily users of each agent in this row. Uses a 30-day planning month.'
              }
            />
            <Numeric
              label="Invocations per user per agent per day *"
              value={draft.invocations_per_user_per_agent_per_day ?? ''}
              required
              onChange={(invocations_per_user_per_agent_per_day) =>
                setDraft({
                  ...draft,
                  invocations_per_user_per_agent_per_day: invocations_per_user_per_agent_per_day || null,
                  volume_source: draft.volume_source === 'derived' ? 'derived' : 'daily_users',
                })
              }
              hint="Average per user for each agent, including calls from other agents."
            />
          </>
        )}
      </div>
      <p className="muted small">
        {draft.volume_source === 'derived'
          ? 'This agent receives work from agent links. Daily inputs are retained for recovery and do not change derived volume while links remain.'
          : singleAgent
            ? '* Required for a directly invoked agent. Monthly invocations are calculated from these inputs using 30 days/month.'
            : '* Required for directly invoked agents. Total monthly invocations per agent are calculated from these inputs using 30 days/month.'}
        {draft.volume_source === 'manual' &&
          ' This saved row still uses a legacy manual volume until both daily inputs are entered.'}
      </p>
      {!singleAgent && draft.count > 0 && (
        <div className="editor-section">
          <h3>Agent identities</h3>
          <p className="muted small">
            Each agent has its own editable ID, unique name, and short business use case description.
            Generated descriptions identify work that still needs definition.
          </p>
          {draft.members.slice(memberPage * 25, memberPage * 25 + 25).map((member, offset) => {
            const index = memberPage * 25 + offset;
            return (
              <div className="form-grid" key={index}>
                <Field label={`Agent ${index + 1} ID`}>
                  <input
                    value={member.id}
                    maxLength={100}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        members: draft.members.map((item, i) =>
                          i === index ? { ...item, id: e.target.value } : item,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label={`Agent ${index + 1} name`}>
                  <input
                    value={member.name}
                    maxLength={120}
                    onChange={(e) => {
                      const name = e.target.value;
                      setDraft({
                        ...draft,
                        name: draft.count === 1 ? name : draft.name,
                        members: draft.members.map((item, i) => (i === index ? { ...item, name } : item)),
                      });
                    }}
                  />
                </Field>
                <Field label={`Agent ${index + 1} business use case description`}>
                  <input
                    value={member.business_use_case_description}
                    maxLength={500}
                    onChange={(e) => {
                      const description = e.target.value;
                      setDraft({
                        ...draft,
                        use_case_description: draft.count === 1 ? description : draft.use_case_description,
                        members: draft.members.map((item, i) =>
                          i === index ? { ...item, business_use_case_description: description } : item,
                        ),
                      });
                    }}
                  />
                </Field>
              </div>
            );
          })}
          {draft.count > 25 && (
            <div className="button-row">
              <button
                className="button subtle"
                disabled={memberPage === 0}
                onClick={() => setMemberPage(memberPage - 1)}
              >
                Previous agents
              </button>
              <span className="muted small">
                {memberPage * 25 + 1}–{Math.min((memberPage + 1) * 25, draft.count)} of {draft.count}
              </span>
              <button
                className="button subtle"
                disabled={(memberPage + 1) * 25 >= draft.count}
                onClick={() => setMemberPage(memberPage + 1)}
              >
                Next agents
              </button>
            </div>
          )}
        </div>
      )}
      <CostSection {...costPreview} agentCount={draft.count} />
      {singleAgent ? (
        <AgentStepList
          draft={draft}
          setDraft={setDraft}
          estimate={estimate}
          prices={prices}
          costPreview={costPreview}
        />
      ) : (
        <div className="editor-section">
          <h3>Execution assumptions</h3>
          <p className="muted small">
            Inherited from the {draft.complexity} profile unless edited here. Model changes preserve other
            parameters.
          </p>
          {draft.steps.length === 0 ? (
            <>
              <ExecutionFields
                value={execution}
                prices={prices}
                onChange={(patch) => setDraft({ ...draft, overrides: { ...draft.overrides, ...patch } })}
              />
              <div className="override-summary">
                {Object.entries(draft.overrides)
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => (
                    <span className="tag" key={k}>
                      {k.replaceAll('_', ' ')}: {v}
                    </span>
                  ))}
              </div>
              <button className="text-button" onClick={() => setDraft({ ...draft, overrides: {} })}>
                Clear row overrides; inherit profile
              </button>
            </>
          ) : (
            <>
              {draft.steps.map((step, i) => (
                <div className="step-card" key={step.id}>
                  <div className="step-heading">
                    <Field label={`Step ${i + 1} name`}>
                      <input
                        value={step.name}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            steps: draft.steps.map((s, j) => (j === i ? { ...s, name: e.target.value } : s)),
                          })
                        }
                      />
                    </Field>
                    <Field label={`Step ${i + 1} complexity profile`}>
                      <select
                        value={step.complexity ?? draft.complexity}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            steps: draft.steps.map((item, index) =>
                              index === i ? { ...item, complexity: event.target.value } : item,
                            ),
                          })
                        }
                      >
                        {Object.keys(estimate.profiles).map((profile) => (
                          <option key={profile} value={profile}>
                            {profile}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Numeric
                      label="Step execution probability (0–1)"
                      value={step.execution_probability}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          steps: draft.steps.map((s, j) =>
                            j === i ? { ...s, execution_probability: v } : s,
                          ),
                        })
                      }
                    />
                    <button
                      className="text-button"
                      disabled={i === 0}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          steps: draft.steps.map((s, j) =>
                            j === i ? draft.steps[i - 1] : j === i - 1 ? step : s,
                          ),
                        })
                      }
                    >
                      Move up
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          steps: [
                            ...draft.steps.slice(0, i + 1),
                            {
                              ...clone(step),
                              id: id(),
                              name: `${step.name} (copy)`,
                              model_calls: step.model_calls.map((call) => ({ ...call, id: id() })),
                            },
                            ...draft.steps.slice(i + 1),
                          ],
                        })
                      }
                    >
                      Copy step
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove step ${i + 1}`}
                      onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                  <CostSection
                    {...costPreview}
                    summary={costPreview.summary?.steps[step.id]}
                    agentCount={draft.count}
                    stepNumber={i + 1}
                  />
                  {step.model_calls.length === 0 ? (
                    <ExecutionFields
                      value={step}
                      prices={prices}
                      onChange={(patch) =>
                        setDraft({
                          ...draft,
                          steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)),
                        })
                      }
                    />
                  ) : (
                    step.model_calls.map((call, callIndex) => (
                      <div className="model-call-card" key={call.id}>
                        <div className="step-heading">
                          <strong>Model {callIndex + 1}</strong>
                          <button
                            className="icon-button"
                            aria-label={`Remove model ${callIndex + 1} from ${step.name}`}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                steps: draft.steps.map((s, j) =>
                                  j === i
                                    ? {
                                        ...s,
                                        calls: s.model_calls.length === 1 ? '0' : s.calls,
                                        model_calls: s.model_calls.filter((c) => c.id !== call.id),
                                      }
                                    : s,
                                ),
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className="form-grid two">
                          <Numeric
                            label="Model invocation probability (0–1)"
                            value={call.probability}
                            onChange={(v) =>
                              setDraft({
                                ...draft,
                                steps: draft.steps.map((s, j) =>
                                  j === i
                                    ? {
                                        ...s,
                                        model_calls: s.model_calls.map((c) =>
                                          c.id === call.id ? { ...c, probability: v } : c,
                                        ),
                                      }
                                    : s,
                                ),
                              })
                            }
                          />
                          <Field label="Exclusive choice (optional)">
                            <input
                              value={call.exclusive_group}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  steps: draft.steps.map((s, j) =>
                                    j === i
                                      ? {
                                          ...s,
                                          model_calls: s.model_calls.map((c) =>
                                            c.id === call.id ? { ...c, exclusive_group: e.target.value } : c,
                                          ),
                                        }
                                      : s,
                                  ),
                                })
                              }
                            />
                          </Field>
                          <Field label="Model role">
                            <input
                              value={call.role}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  steps: draft.steps.map((s, j) =>
                                    j === i
                                      ? {
                                          ...s,
                                          model_calls: s.model_calls.map((c) =>
                                            c.id === call.id ? { ...c, role: e.target.value } : c,
                                          ),
                                        }
                                      : s,
                                  ),
                                })
                              }
                            />
                          </Field>
                        </div>
                        <p className="muted small">
                          The calls field below is average model calls when this model is invoked. Its
                          probability and the step probability scale that average.
                        </p>
                        <ExecutionFields
                          value={call}
                          prices={prices}
                          onChange={(patch) =>
                            setDraft({
                              ...draft,
                              steps: draft.steps.map((s, j) =>
                                j === i
                                  ? {
                                      ...s,
                                      model_calls: s.model_calls.map((c) =>
                                        c.id === call.id ? { ...c, ...patch } : c,
                                      ),
                                    }
                                  : s,
                              ),
                            })
                          }
                        />
                      </div>
                    ))
                  )}
                  <button
                    className="button subtle"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: draft.steps.map((s, j) =>
                          j === i
                            ? {
                                ...s,
                                model_calls: [
                                  ...(s.model_calls.length
                                    ? s.model_calls
                                    : [
                                        {
                                          id: id(),
                                          role: 'primary',
                                          probability: '1',
                                          exclusive_group: '',
                                          calls: step.calls,
                                          input_tokens: step.input_tokens,
                                          output_tokens: step.output_tokens,
                                          retry_rate: step.retry_rate,
                                          cache_fraction: step.cache_fraction,
                                          cache_write_fraction: step.cache_write_fraction,
                                          model_id: step.model_id,
                                        },
                                      ]),
                                  { ...execution, id: id(), role: '', probability: '0', exclusive_group: '' },
                                ],
                              }
                            : s,
                        ),
                      })
                    }
                  >
                    Add model to step
                  </button>
                  {step.model_calls.length > 0 && (
                    <p className="muted small">
                      Expected models per step execution:{' '}
                      {step.model_calls
                        .reduce((sum, call) => sum + Number(call.probability || 0), 0)
                        .toFixed(2)}
                      . New models start at probability zero.
                    </p>
                  )}
                </div>
              ))}
              <p className="muted small">
                Steps replace aggregate execution. Calls per invocation are bounded expected repetitions for
                each step. Delegated agents are counted in their own rows.
              </p>
            </>
          )}
          <button
            className="button subtle"
            onClick={() =>
              setDraft({
                ...draft,
                steps: [
                  ...draft.steps,
                  {
                    ...execution,
                    id: id(),
                    name: `Step ${draft.steps.length + 1}`,
                    complexity: draft.complexity,
                    execution_probability: '1',
                    model_calls: [],
                  },
                ],
              })
            }
          >
            <Plus size={15} />
            {draft.steps.length ? 'Add model-call step' : 'Use detailed workflow'}
          </button>
        </div>
      )}
      <div className="editor-section">
        <h3>Tool and non-LLM costs</h3>
        {draft.tool_costs.map((tool) => (
          <div className="step-card" key={tool.id}>
            <div className="step-heading">
              <Field label="Tool name">
                <input
                  value={tool.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      tool_costs: draft.tool_costs.map((t) =>
                        t.id === tool.id ? { ...t, name: e.target.value } : t,
                      ),
                    })
                  }
                />
              </Field>
              <button
                className="icon-button"
                aria-label={`Remove tool ${tool.name}`}
                onClick={() =>
                  setDraft({ ...draft, tool_costs: draft.tool_costs.filter((t) => t.id !== tool.id) })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="form-grid two">
              <Numeric
                label="USD per unit"
                value={tool.unit_cost}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    tool_costs: draft.tool_costs.map((t) => (t.id === tool.id ? { ...t, unit_cost: v } : t)),
                  })
                }
              />
              <Numeric
                label="Expected units per invocation"
                value={tool.expected_units_per_invocation}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    tool_costs: draft.tool_costs.map((t) =>
                      t.id === tool.id ? { ...t, expected_units_per_invocation: v } : t,
                    ),
                  })
                }
              />
              <Numeric
                label="Tool probability (0–1)"
                value={tool.probability}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    tool_costs: draft.tool_costs.map((t) =>
                      t.id === tool.id ? { ...t, probability: v } : t,
                    ),
                  })
                }
              />
              <Field label="Step">
                <select
                  value={tool.step_id ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      tool_costs: draft.tool_costs.map((t) =>
                        t.id === tool.id ? { ...t, step_id: e.target.value || null } : t,
                      ),
                    })
                  }
                >
                  <option value="">Whole use case</option>
                  {draft.steps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        ))}
        <button
          className="button subtle"
          onClick={() =>
            setDraft({
              ...draft,
              tool_costs: [
                ...draft.tool_costs,
                {
                  id: id(),
                  name: 'Tool',
                  unit_cost: '0',
                  expected_units_per_invocation: '1',
                  probability: '1',
                  step_id: null,
                },
              ],
            })
          }
        >
          <Plus size={15} />
          Add tool cost
        </button>
      </div>
      {error && (
        <p className="invalid-text" role="alert">
          {error}
        </p>
      )}
      {hasLinks && (
        <p className="muted small">
          Linked agents can be customized individually. Incoming work is divided, and outgoing calls are
          copied for the customized agent. Remove links before deleting linked agents.
        </p>
      )}
      <div className="modal-actions spread">
        <div className="button-row">
          {estimate.agents.some((r) => r.id === row.id) && !hasLinks && !pendingGroupMember && (
            <button className="button danger" onClick={onRemove}>
              <Trash2 size={14} />
              Remove
            </button>
          )}
          {!singleAgent && row.count > 1 && estimate.agents.some((r) => r.id === row.id) && (
            <button
              className="button subtle"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSplit(draft);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                } finally {
                  setSaving(false);
                }
              }}
            >
              Customize one agent
            </button>
          )}
        </div>
        <button
          className="button dark"
          disabled={
            saving ||
            (draft.volume_source === 'derived' && draft.count < 1) ||
            (draft.volume_source === 'daily_users' &&
              (draft.users_per_day === null || draft.invocations_per_user_per_agent_per_day === null))
          }
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(draft);
            } catch (e) {
              setError(String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          Apply changes
        </button>
      </div>
    </Modal>
  );
}

function AgentStepList({
  draft,
  setDraft,
  estimate,
  prices,
  costPreview,
}: {
  draft: AgentRow;
  setDraft: (next: AgentRow) => void;
  estimate: Estimate;
  prices: Record<string, Price>;
  costPreview: CostPreviewState;
}) {
  const updateStep = (stepId: string, patch: Partial<Step>) =>
    setDraft({
      ...draft,
      steps: draft.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    });
  const updateCall = (stepId: string, callId: string, patch: Partial<ModelCall>) =>
    setDraft({
      ...draft,
      steps: draft.steps.map((step) =>
        step.id === stepId
          ? {
              ...step,
              model_calls: step.model_calls.map((call) =>
                call.id === callId ? { ...call, ...patch } : call,
              ),
            }
          : step,
      ),
    });
  const newStep = (): Step => ({
    ...effective(estimate, draft),
    id: id(),
    name: `Step ${draft.steps.length + 1}`,
    complexity: draft.complexity,
    execution_probability: '1',
    model_calls: [],
  });
  return (
    <section className="editor-section agent-step-list" aria-label="Agent steps">
      <h3>Steps</h3>
      <p className="muted small">
        One invocation completes this use case. Choose the model and complexity profile for each step.
      </p>
      {draft.steps.map((step, index) => {
        const referenced =
          draft.tool_costs.some((tool) => tool.step_id === step.id) ||
          estimate.links.some((link) => link.parent_id === draft.id && link.step_id === step.id);
        return (
          <article className="step-card" key={step.id}>
            <div className="step-list-heading">
              <strong>Step {index + 1}</strong>
              <div className="button-row">
                <button
                  className="text-button"
                  disabled={index === 0}
                  onClick={() => {
                    const steps = [...draft.steps];
                    [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
                    setDraft({ ...draft, steps });
                  }}
                >
                  Move up
                </button>
                <button
                  className="text-button"
                  disabled={draft.steps.length >= 100}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      steps: [
                        ...draft.steps.slice(0, index + 1),
                        {
                          ...clone(step),
                          id: id(),
                          name: `${step.name} (copy)`,
                          model_calls: step.model_calls.map((call) => ({ ...clone(call), id: id() })),
                        },
                        ...draft.steps.slice(index + 1),
                      ],
                    })
                  }
                >
                  Copy step
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove step ${index + 1}`}
                  title={
                    referenced ? 'Remove linked agent calls and tool costs from this step first.' : undefined
                  }
                  disabled={draft.steps.length === 1 || referenced}
                  onClick={() =>
                    setDraft({ ...draft, steps: draft.steps.filter((item) => item.id !== step.id) })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div className="form-grid">
              <Field label={`Step ${index + 1} name`}>
                <input
                  value={step.name}
                  onChange={(event) => updateStep(step.id, { name: event.target.value })}
                />
              </Field>
              <Field label={`Step ${index + 1} complexity profile`}>
                <select
                  value={step.complexity ?? draft.complexity}
                  onChange={(event) => updateStep(step.id, { complexity: event.target.value })}
                >
                  {Object.keys(estimate.profiles).map((profile) => (
                    <option key={profile} value={profile}>
                      {profile}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {step.model_calls.length === 0 ? (
              <ModelPicker
                label={`Step ${index + 1} model name`}
                value={step.model_id}
                prices={prices}
                onChange={(model_id) => updateStep(step.id, { model_id })}
              />
            ) : (
              <div className="step-model-list">
                {step.model_calls.map((call, callIndex) => (
                  <div className="step-model-item" key={call.id}>
                    <ModelPicker
                      label={`Step ${index + 1} model ${callIndex + 1} name`}
                      value={call.model_id}
                      prices={prices}
                      onChange={(model_id) => updateCall(step.id, call.id, { model_id })}
                    />
                    <button
                      className="icon-button"
                      aria-label={`Remove model ${callIndex + 1} from step ${index + 1}`}
                      disabled={step.model_calls.length === 1}
                      onClick={() =>
                        updateStep(step.id, {
                          model_calls: step.model_calls.filter((item) => item.id !== call.id),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              className="text-button"
              disabled={step.model_calls.length >= 100}
              onClick={() => {
                const primary: ModelCall = {
                  id: id(),
                  role: 'primary',
                  probability: '1',
                  exclusive_group: '',
                  calls: step.calls,
                  input_tokens: step.input_tokens,
                  output_tokens: step.output_tokens,
                  retry_rate: step.retry_rate,
                  cache_fraction: step.cache_fraction,
                  cache_write_fraction: step.cache_write_fraction,
                  model_id: step.model_id,
                };
                updateStep(step.id, {
                  model_calls: [
                    ...(step.model_calls.length ? step.model_calls : [primary]),
                    {
                      ...effective(estimate, draft),
                      id: id(),
                      role: '',
                      probability: '0',
                      exclusive_group: '',
                    },
                  ],
                });
              }}
            >
              <Plus size={14} /> Add model to step
            </button>
            <CostSection
              {...costPreview}
              summary={costPreview.summary?.steps[step.id]}
              agentCount={draft.count}
              stepNumber={index + 1}
            />
            <details className="step-details">
              <summary>Step execution details</summary>
              <Numeric
                label={`Step ${index + 1} execution probability (0–1)`}
                value={step.execution_probability}
                max={1}
                onChange={(execution_probability) => updateStep(step.id, { execution_probability })}
              />
              {step.model_calls.length === 0 ? (
                <ExecutionFields
                  value={step}
                  prices={prices}
                  showModel={false}
                  onChange={(patch: Partial<Execution>) => updateStep(step.id, patch)}
                />
              ) : (
                step.model_calls.map((call, callIndex) => (
                  <div className="model-call-card" key={call.id}>
                    <strong>Model {callIndex + 1} details</strong>
                    <div className="form-grid two">
                      <Numeric
                        label={`Model ${callIndex + 1} invocation probability (0–1)`}
                        value={call.probability}
                        max={1}
                        onChange={(probability) => updateCall(step.id, call.id, { probability })}
                      />
                      <Field label={`Model ${callIndex + 1} role`}>
                        <input
                          value={call.role}
                          onChange={(event) => updateCall(step.id, call.id, { role: event.target.value })}
                        />
                      </Field>
                      <Field label={`Model ${callIndex + 1} exclusive choice`}>
                        <input
                          value={call.exclusive_group}
                          onChange={(event) =>
                            updateCall(step.id, call.id, { exclusive_group: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                    <ExecutionFields
                      value={call}
                      prices={prices}
                      showModel={false}
                      onChange={(patch: Partial<Execution>) => updateCall(step.id, call.id, patch)}
                    />
                  </div>
                ))
              )}
            </details>
          </article>
        );
      })}
      <button
        className="button subtle"
        disabled={draft.steps.length >= 100}
        onClick={() => setDraft({ ...draft, steps: [...draft.steps, newStep()] })}
      >
        <Plus size={15} /> Add step
      </button>
    </section>
  );
}
