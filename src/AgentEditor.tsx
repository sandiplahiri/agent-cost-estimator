import { useEffect, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { ExecutionFields, Field, Modal, ModelPicker, Numeric } from './components';
import {
  effective,
  modelStep,
  distributionTotal,
  api,
  displayVolume,
  id,
  rateMoney,
  resizeMembers,
  type AgentRow,
  type AgentCall,
  type AgentCostPreview,
  type Estimate,
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
        ...draft.steps.flatMap((step) => step.model_calls.map((call) => call.model_id)),
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
        with your edits. Tokens and token costs cover this agent's own model calls. Called agents have their
        own totals. Token costs exclude harness, tools, and other costs.
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
  onCopy,
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
  onCopy: () => void;
  singleAgent?: boolean;
  pendingGroupMember?: boolean;
}) {
  const [draft, setDraft] = useState(() => {
    const initial = clone(row);
    if (singleAgent && initial.steps.length === 0) {
      initial.steps = [modelStep(effective(estimate, initial), 'Main step', initial.complexity)];
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
  const addingAgent = !estimate.agents.some((agent) => agent.id === row.id);
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
          ' This row uses manual monthly volume until both daily inputs are entered.'}
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
      {draft.steps.length ? (
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
          <ExecutionFields
            value={execution}
            prices={prices}
            onChange={(patch) => setDraft({ ...draft, overrides: { ...draft.overrides, ...patch } })}
          />
          <button
            className="button subtle"
            onClick={() =>
              setDraft({ ...draft, steps: [modelStep(execution, 'Main step', draft.complexity)] })
            }
          >
            Use detailed workflow
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
          Each called individual receives its assigned work. Remove or retarget incoming step options before
          deleting a called agent. Deleting a caller recalculates its children's workload.
        </p>
      )}
      <div className="modal-actions spread">
        <div className="button-row">
          {estimate.agents.some((r) => r.id === row.id) && (singleAgent || row.count === 1) && (
            <button className="button subtle" disabled={saving} onClick={onCopy}>
              <Copy size={14} aria-hidden="true" />
              Copy agent
            </button>
          )}
          {estimate.agents.some((r) => r.id === row.id) && (singleAgent || row.count === 1) && (
            <button className="button danger" disabled={saving} onClick={onRemove}>
              <Trash2 size={14} />
              Delete agent
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
          {addingAgent ? 'Add agent' : 'Apply changes'}
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
  const agentTargets = estimate.agents
    .flatMap((row) => row.members)
    .filter((member) => !draft.members.some((own) => own.id === member.id));
  const updateCall = (step: Step, callId: string, patch: Partial<ModelCall>) =>
    updateStep(step.id, {
      model_calls: step.model_calls.map((call) => (call.id === callId ? { ...call, ...patch } : call)),
    });
  const updateAgent = (step: Step, optionId: string, patch: Partial<AgentCall>) =>
    updateStep(step.id, {
      agent_calls: (step.agent_calls ?? []).map((option) =>
        option.id === optionId ? { ...option, ...patch } : option,
      ),
    });
  const [previousAction, setPreviousAction] = useState<{ stepId: string; step: Step } | null>(null);
  return (
    <section className="editor-section agent-step-list" aria-label="Agent steps">
      <h3>Steps</h3>
      <p className="muted small">
        Each executed step chooses one model or one other suite agent. Its target probabilities must total
        1.0.
      </p>
      {previousAction && (
        <button
          className="text-button"
          onClick={() => {
            updateStep(previousAction.stepId, previousAction.step);
            setPreviousAction(null);
          }}
        >
          Undo action change
        </button>
      )}
      {draft.steps.map((step, index) => {
        const agentAction = step.action_type === 'agent';
        const options = agentAction ? (step.agent_calls ?? []) : step.model_calls;
        const probability = distributionTotal(options.map((option) => option.probability));
        const action = costPreview.summary?.step_actions[step.id];
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
                          agent_calls: (step.agent_calls ?? []).map((option) => ({
                            ...clone(option),
                            id: id(),
                          })),
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
                  disabled={
                    draft.steps.length === 1 || draft.tool_costs.some((tool) => tool.step_id === step.id)
                  }
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
              <Field label={`Step ${index + 1} action`}>
                <select
                  aria-label={`Step ${index + 1} action`}
                  value={step.action_type}
                  onChange={(event) => {
                    setPreviousAction({ stepId: step.id, step: clone(step) });
                    const action_type = event.target.value as 'model' | 'agent';
                    updateStep(step.id, {
                      action_type,
                      model_calls:
                        action_type === 'model'
                          ? [
                              {
                                ...effective(estimate, draft),
                                id: id(),
                                role: '',
                                probability: '1',
                              },
                            ]
                          : [],
                      agent_calls:
                        action_type === 'agent'
                          ? [
                              {
                                id: id(),
                                child_agent_id: agentTargets[0]?.id ?? '',
                                probability: '1',
                              },
                            ]
                          : [],
                    });
                  }}
                >
                  <option value="model">Invoke model</option>
                  <option value="agent">Invoke agent</option>
                </select>
              </Field>
              {!agentAction && (
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
              )}
            </div>
            {agentAction ? (
              <>
                <p className="muted small">
                  Each executed step invokes one selected agent once. Add or copy a step for another
                  invocation.
                </p>
                {(step.agent_calls ?? []).map((option, i) => (
                  <div className="model-call-card" key={option.id}>
                    <div className="form-grid">
                      <Field label={`Step ${index + 1} agent ${i + 1}`}>
                        <select
                          aria-label={`Step ${index + 1} agent ${i + 1}`}
                          value={option.child_agent_id}
                          onChange={(event) =>
                            updateAgent(step, option.id, { child_agent_id: event.target.value })
                          }
                        >
                          <option value="">Choose an agent</option>
                          {agentTargets.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Numeric
                        label={`Step ${index + 1} agent ${i + 1} probability (0–1)`}
                        value={option.probability}
                        max={1}
                        onChange={(probability) => updateAgent(step, option.id, { probability })}
                      />
                    </div>
                    <button
                      className="text-button"
                      disabled={options.length === 1}
                      onClick={() =>
                        updateStep(step.id, {
                          agent_calls: step.agent_calls?.filter((item) => item.id !== option.id),
                        })
                      }
                    >
                      Remove agent option {i + 1}
                    </button>
                  </div>
                ))}
                <button
                  className="text-button"
                  disabled={options.length >= 100}
                  onClick={() =>
                    updateStep(step.id, {
                      agent_calls: [
                        ...(step.agent_calls ?? []),
                        { id: id(), child_agent_id: '', probability: '0' },
                      ],
                    })
                  }
                >
                  <Plus size={14} /> Add agent option
                </button>
              </>
            ) : (
              <>
                {step.model_calls.map((call, i) => (
                  <div className="model-call-card" key={call.id}>
                    <ModelPicker
                      label={
                        step.model_calls.length === 1
                          ? `Step ${index + 1} model name`
                          : `Step ${index + 1} model ${i + 1} name`
                      }
                      value={call.model_id}
                      prices={prices}
                      onChange={(model_id) => updateCall(step, call.id, { model_id })}
                    />
                    <Numeric
                      label={`Step ${index + 1} model ${i + 1} probability (0–1)`}
                      value={call.probability}
                      max={1}
                      onChange={(probability) => updateCall(step, call.id, { probability })}
                    />
                    <button
                      className="text-button"
                      aria-label={`Remove model ${i + 1} from step ${index + 1}`}
                      disabled={step.model_calls.length === 1}
                      onClick={() =>
                        updateStep(step.id, {
                          model_calls: step.model_calls.filter((item) => item.id !== call.id),
                        })
                      }
                    >
                      Remove model {i + 1}
                    </button>
                  </div>
                ))}
                <button
                  className="text-button"
                  disabled={step.model_calls.length >= 100}
                  onClick={() =>
                    updateStep(step.id, {
                      model_calls: [
                        ...step.model_calls,
                        {
                          ...effective(estimate, draft),
                          id: id(),
                          role: '',
                          probability: '0',
                        },
                      ],
                    })
                  }
                >
                  <Plus size={14} /> Add model to step
                </button>
              </>
            )}
            <p className={probability.valid ? 'muted small' : 'invalid-text'}>
              Probability total: {probability.percent}
              {!probability.valid && ' · Option probabilities must total 1.0.'}
            </p>
            <section className="editor-section" aria-label={`Step ${index + 1} weighted cost`}>
              <h4>Expected action cost</h4>
              {action ? (
                <>
                  <p>
                    {action.complete
                      ? rateMoney(action.cost_per_execution)
                      : `${rateMoney(action.cost_per_execution)} (partial)`}{' '}
                    per executed step ·{' '}
                    {action.complete
                      ? rateMoney(action.monthly_cost)
                      : `${rateMoney(action.monthly_cost)} (partial)`}{' '}
                    per month
                  </p>
                  <p className="muted small">
                    {agentAction
                      ? 'Includes called agents and their downstream work. Suite totals count that work once in the called agents.'
                      : 'Probability-weighted cost of the model options.'}
                  </p>
                  <ul>
                    {action.options.map((option) => (
                      <li key={option.id}>
                        {agentAction
                          ? (estimate.agents
                              .flatMap((row) => row.members)
                              .find((member) => member.id === option.target_id)?.name ?? option.target_id)
                          : (prices[option.target_id]?.id ?? option.target_id)}
                        : {option.probability} × {rateMoney(option.cost)} = {rateMoney(option.weighted_cost)}
                        {!option.complete && ' (incomplete)'}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted small">{costPreview.error ?? 'Calculating action cost…'}</p>
              )}
            </section>
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
              {(['low', 'high'] as const).map((scenario) => (
                <Numeric
                  key={scenario}
                  label={`Step ${index + 1} ${scenario} execution probability (optional)`}
                  value={step[`${scenario}_execution_probability`] ?? ''}
                  max={1}
                  onChange={(value) =>
                    updateStep(step.id, { [`${scenario}_execution_probability`]: value || null })
                  }
                />
              ))}
              {!agentAction &&
                step.model_calls.map((call, i) => (
                  <div className="model-call-card" key={call.id}>
                    <strong>Model {i + 1} details</strong>
                    <Field label={`Model ${i + 1} role`}>
                      <input
                        value={call.role}
                        onChange={(event) => updateCall(step, call.id, { role: event.target.value })}
                      />
                    </Field>
                    <ExecutionFields
                      value={call}
                      prices={prices}
                      showModel={false}
                      onChange={(patch) => updateCall(step, call.id, patch)}
                    />
                  </div>
                ))}
              {agentAction && (
                <p className="muted small">
                  Called agents use their own steps and complexity profiles. Retained direct workload is
                  replaced by work derived from callers.
                </p>
              )}
            </details>
          </article>
        );
      })}
      <button
        className="button subtle"
        disabled={draft.steps.length >= 100}
        onClick={() =>
          setDraft({
            ...draft,
            steps: [
              ...draft.steps,
              modelStep(effective(estimate, draft), `Step ${draft.steps.length + 1}`, draft.complexity),
            ],
          })
        }
      >
        <Plus size={15} /> Add step
      </button>
    </section>
  );
}
