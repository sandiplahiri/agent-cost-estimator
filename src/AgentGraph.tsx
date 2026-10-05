import { useState, type Dispatch, type SetStateAction } from 'react';
import { ExecutionFields, Field, Numeric } from './components';
import {
  api,
  syncAgentActions,
  categoryClass,
  displayVolume,
  effective,
  money,
  type AgentRow,
  type Complexity,
  type Estimate,
  type Price,
  type Results,
} from './types';

const clone = <T,>(value: T): T => structuredClone(value);
export type GraphAgentDrafts = Record<string, { base: AgentRow; draft: AgentRow }>;
export function AgentGraph({
  estimate,
  result,
  prices,
  selectedId,
  setSelectedId,
  agentDrafts,
  setAgentDrafts,
  onApply,
  onEditAgent,
  onCustomize,
  onAddAgent,
  onCopyAgent,
}: {
  estimate: Estimate;
  result: Results | null;
  prices: Record<string, Price>;
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  agentDrafts: GraphAgentDrafts;
  setAgentDrafts: Dispatch<SetStateAction<GraphAgentDrafts>>;
  onApply: (next: Estimate, base: Estimate, message: string) => void;
  onEditAgent: (row: AgentRow) => void;
  onCustomize: (row: AgentRow) => Promise<string>;
  onAddAgent: () => void;
  onCopyAgent: (row: AgentRow) => void;
}) {
  const [agentError, setAgentError] = useState('');
  const [savingAgent, setSavingAgent] = useState(false);
  const rows = estimate.agents.filter((row) => row.count > 0);
  const selected = estimate.agents.find((row) => row.id === selectedId) || rows[0];
  const selectedDraft = selected ? agentDrafts[selected.id]?.draft || selected : null;
  const selectedBase = selected ? agentDrafts[selected.id]?.base || selected : null;
  const agentDirty =
    !!selectedDraft && !!selectedBase && JSON.stringify(selectedDraft) !== JSON.stringify(selectedBase);
  const modelSteps = selectedDraft?.steps.filter((step) => step.action_type === 'model') ?? [];
  const editableStep =
    modelSteps.length === 1 && modelSteps[0].model_calls.length === 1 ? modelSteps[0] : null;
  const graphRows = estimate.agents;
  const degree = Object.fromEntries(graphRows.map((row) => [row.id, 0]));
  const depth = Object.fromEntries(graphRows.map((row) => [row.id, 0]));
  const children = Object.fromEntries(graphRows.map((row) => [row.id, [] as string[]]));
  for (const link of estimate.links) {
    degree[link.child_id] += 1;
    children[link.parent_id].push(link.child_id);
  }
  const queue = graphRows.filter((row) => degree[row.id] === 0).map((row) => row.id);
  for (let index = 0; index < queue.length; index++) {
    const parentId = queue[index];
    for (const childId of children[parentId]) {
      depth[childId] = Math.max(depth[childId], depth[parentId] + 1);
      degree[childId] -= 1;
      if (degree[childId] === 0) queue.push(childId);
    }
  }
  const layers = new Map<number, AgentRow[]>();
  for (const row of graphRows) layers.set(depth[row.id], [...(layers.get(depth[row.id]) || []), row]);
  const position = new Map<string, { x: number; y: number }>();
  for (const [column, layer] of layers)
    layer.forEach((row, index) => position.set(row.id, { x: 34 + column * 310, y: 40 + index * 230 }));
  const canvasWidth = Math.max(640, 40 + layers.size * 310);
  const canvasHeight = Math.max(
    265,
    40 + Math.max(...[...layers.values()].map((layer) => layer.length), 1) * 230,
  );

  function selectAgent(row: AgentRow) {
    setSelectedId(row.id);
    setAgentError('');
  }

  function changeSelected(mutator: (draft: AgentRow) => void) {
    if (!selected) return;
    setAgentDrafts((previous) => {
      const current = previous[selected.id] || { base: clone(selected), draft: clone(selected) };
      const draft = clone(current.draft);
      mutator(draft);
      return { ...previous, [selected.id]: { base: current.base, draft } };
    });
    setAgentError('');
  }

  async function saveSelected() {
    if (!selected || !selectedDraft || !selectedBase || !agentDirty) return;
    if (JSON.stringify(selected) !== JSON.stringify(selectedBase)) {
      setAgentError('This agent changed since editing began. Discard these changes and try again.');
      return;
    }
    const base = estimate;
    let next = clone(base);
    const index = next.agents.findIndex((row) => row.id === selected.id);
    if (index < 0) {
      setAgentError('This agent no longer exists. Select another agent.');
      return;
    }
    next.agents[index] = clone(selectedDraft);
    const modelIds = [
      selectedDraft.overrides.model_id,
      ...selectedDraft.steps.flatMap((step) => step.model_calls.map((call) => call.model_id)),
    ];
    for (const modelId of modelIds)
      if (modelId && !next.prices[modelId] && prices[modelId]) next.prices[modelId] = clone(prices[modelId]);
    syncAgentActions(next);
    setSavingAgent(true);
    setAgentError('');
    try {
      next = await api<Estimate>('/validate', next);
      onApply(next, base, `${selectedDraft.name} updated. Other agents and category defaults are unchanged.`);
      setAgentDrafts((previous) => {
        const updated = { ...previous };
        delete updated[selected.id];
        return updated;
      });
    } catch (cause) {
      setAgentError(cause instanceof Error ? cause.message : 'Could not update this agent.');
    } finally {
      setSavingAgent(false);
    }
  }

  return (
    <section className="panel graph-panel" aria-label="Agent invocation graph">
      <div className="section-heading">
        <div>
          <h2>Agent suite graph</h2>
          <p>
            Select an agent to edit its use case or connect it to another agent. Arrows represent expected
            child invocations.
          </p>
        </div>
        <button className="button dark" onClick={onAddAgent}>
          Add agent
        </button>
      </div>
      <div className="graph-layout graph-workspace">
        <div className="graph-canvas-scroll" role="region" tabIndex={0} aria-label="Agent canvas">
          {graphRows.length === 0 ? (
            <div className="empty-inline">Add an agent to start the suite graph.</div>
          ) : (
            <div className="graph-canvas" style={{ width: canvasWidth, height: canvasHeight }}>
              <svg className="graph-wires" width={canvasWidth} height={canvasHeight} aria-hidden="true">
                <defs>
                  <marker
                    id="graph-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#759879" />
                  </marker>
                </defs>
                {estimate.links.map((link) => {
                  const from = position.get(link.parent_id);
                  const to = position.get(link.child_id);
                  if (!from || !to) return null;
                  const x1 = from.x + 248,
                    y1 = from.y + 85,
                    x2 = to.x,
                    y2 = to.y + 85;
                  return (
                    <g key={link.id}>
                      <path
                        d={`M ${x1} ${y1} C ${x1 + 54} ${y1}, ${x2 - 54} ${y2}, ${x2} ${y2}`}
                        stroke="#759879"
                        strokeWidth="2"
                        fill="none"
                        markerEnd="url(#graph-arrow)"
                      />
                      <text
                        x={(x1 + x2) / 2}
                        y={(y1 + y2) / 2 - 8}
                        textAnchor="middle"
                        className="graph-wire-label"
                      >
                        {Math.round(Number(link.trigger_probability) * 100)}%
                      </text>
                    </g>
                  );
                })}
              </svg>
              {graphRows.map((row) => {
                const point = position.get(row.id)!;
                const volume = result?.base_volumes[row.id];
                const expectedLines =
                  result?.scenarios
                    .find((scenario) => scenario.name === 'Expected')
                    ?.lines.filter((line) => line.row_id === row.id) || [];
                const monthly = expectedLines.reduce((sum, line) => sum + Number(line.cost || 0), 0);
                const missingCost = expectedLines.some((line) => line.cost === null);
                const modelLabels = row.steps.length
                  ? row.steps.flatMap((step) =>
                      step.model_calls.map(
                        (call) =>
                          `${call.model_id || 'Unselected'} ${Math.round(Number(call.probability) * 100)}%`,
                      ),
                    )
                  : [row.overrides.model_id || 'Unselected model'];
                return (
                  <button
                    key={row.id}
                    className={`graph-node ${selected?.id === row.id ? 'selected' : ''}`}
                    data-complexity={row.complexity}
                    style={{ left: point.x, top: point.y }}
                    onClick={() => selectAgent(row)}
                    aria-label={`Select agent ${row.name}`}
                  >
                    <span className="graph-node-top">
                      <strong>{row.name}</strong>
                      <small>{row.count > 1 ? `${row.count} agents` : '1 agent'}</small>
                    </span>
                    <span className="graph-node-usecase">{row.use_case_name || 'Use case not named'}</span>
                    <span className="graph-node-steps">
                      {row.steps.length
                        ? row.steps
                            .slice(0, 3)
                            .map((step) => step.name)
                            .join(' → ')
                        : 'Aggregate model calls'}
                    </span>
                    <span className="graph-node-models">
                      {modelLabels.slice(0, 2).join(' · ')}
                      {modelLabels.length > 2 ? ` +${modelLabels.length - 2}` : ''}
                    </span>
                    <span className="graph-node-foot">
                      {volume?.complete ? displayVolume(volume.total) : 'Incomplete'} /mo ·{' '}
                      {!result
                        ? 'Calculating LLM cost'
                        : missingCost || volume?.complete === false
                          ? `Incomplete LLM cost (${money(monthly)} known)`
                          : `${money(monthly)} LLM`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {graphRows.length > 2 && (
            <p className="muted small graph-canvas-note">
              Scroll inside the canvas to see more agents. Select a node to edit its use case or calls.
            </p>
          )}
        </div>
        <div className="graph-form">
          <h3>Agent inspector</h3>
          {selected ? (
            <div className="graph-inspector-agent">
              <strong>{selected.name}</strong>
              <span className={`complexity ${categoryClass(selected.complexity)}`}>
                {selected.complexity}
              </span>
              <p>{selected.use_case_name || 'Name the business use case this agent completes.'}</p>
              <p className="muted small">
                {selected.count === 1 ? 'Individual agent' : `${selected.count} agents`} ·{' '}
                {selected.volume_source === 'derived' ? 'Volume from callers' : 'Direct volume'}
              </p>
              {selected.count !== 1 ? (
                <p className="muted small">
                  {selected.count === 0
                    ? 'No agents are defined here. Edit this entry to add agents.'
                    : 'Customize one agent to edit its model, workload, and use case. Editing all agents applies the settings to each listed agent.'}
                </p>
              ) : (
                <div className="graph-agent-settings" aria-label="Selected agent settings">
                  <Field label="Selected agent name">
                    <input
                      value={selectedDraft!.name}
                      onChange={(event) =>
                        changeSelected((draft) => {
                          draft.name = event.target.value;
                          draft.members[0].name = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Selected agent ID">
                    <input
                      value={selectedDraft!.members[0].id}
                      maxLength={100}
                      onChange={(event) =>
                        changeSelected((draft) => {
                          draft.members[0].id = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Selected agent use case">
                    <input
                      value={selectedDraft!.use_case_name}
                      onChange={(event) =>
                        changeSelected((draft) => {
                          draft.use_case_name = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Selected agent business use case description">
                    <input
                      value={selectedDraft!.members[0].business_use_case_description}
                      maxLength={500}
                      onChange={(event) =>
                        changeSelected((draft) => {
                          draft.members[0].business_use_case_description = event.target.value;
                          draft.use_case_description = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Selected agent complexity">
                    <select
                      value={selectedDraft!.complexity}
                      onChange={(event) =>
                        changeSelected((draft) => {
                          if (draft.steps.length === 0)
                            draft.overrides = { ...draft.overrides, ...effective(estimate, draft) };
                          draft.complexity = event.target.value as Complexity;
                        })
                      }
                    >
                      {Object.keys(estimate.profiles).map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {selectedDraft!.volume_source === 'daily_users' && (
                    <div className="form-grid two">
                      <Numeric
                        label="Selected agent users / day"
                        value={selectedDraft!.users_per_day ?? ''}
                        onChange={(value) =>
                          changeSelected((draft) => {
                            draft.users_per_day = value || null;
                          })
                        }
                      />
                      <Numeric
                        label="Selected agent invocations / user / day"
                        value={selectedDraft!.invocations_per_user_per_agent_per_day ?? ''}
                        onChange={(value) =>
                          changeSelected((draft) => {
                            draft.invocations_per_user_per_agent_per_day = value || null;
                          })
                        }
                      />
                    </div>
                  )}
                  {selectedDraft!.volume_source === 'manual' && (
                    <Numeric
                      label="Monthly invocations / agent"
                      value={selectedDraft!.invocations}
                      onChange={(value) =>
                        changeSelected((draft) => {
                          draft.invocations = value;
                        })
                      }
                    />
                  )}
                  {selectedDraft!.volume_source === 'derived' && (
                    <p className="muted small">This agent's invocation volume comes from its callers.</p>
                  )}
                  {selectedDraft!.steps.length === 0 || editableStep ? (
                    <>
                      <h4>Selected agent model and execution</h4>
                      <ExecutionFields
                        value={editableStep?.model_calls[0] ?? effective(estimate, selectedDraft!)}
                        prices={prices}
                        onChange={(patch) =>
                          changeSelected((draft) => {
                            if (editableStep) {
                              const step = draft.steps.find((item) => item.id === editableStep.id)!;
                              Object.assign(step.model_calls[0], patch);
                            } else draft.overrides = { ...draft.overrides, ...patch };
                          })
                        }
                      />
                    </>
                  ) : (
                    <p className="muted small">
                      This agent has a detailed workflow. Edit its steps and model rows in the workflow
                      editor.
                    </p>
                  )}
                  {agentError && (
                    <p className="invalid-text" role="alert">
                      {agentError}
                    </p>
                  )}
                  <div className="button-row">
                    <button
                      className="button dark"
                      disabled={!agentDirty || savingAgent}
                      onClick={() => void saveSelected()}
                    >
                      {savingAgent ? 'Applying…' : 'Apply agent changes'}
                    </button>
                    {agentDirty && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setAgentDrafts((previous) => {
                            const next = { ...previous };
                            delete next[selected.id];
                            return next;
                          });
                          setAgentError('');
                        }}
                      >
                        Discard changes
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="graph-step-strip">
                {selected.steps.map((step) => (
                  <div key={step.id}>
                    <strong>{step.name}</strong>
                    <small>{Number(step.execution_probability) * 100}% of invocations</small>
                    <span>
                      {step.action_type === 'agent'
                        ? (step.agent_calls ?? [])
                            .map(
                              (option) =>
                                `${estimate.agents.flatMap((row) => row.members).find((member) => member.id === option.child_agent_id)?.name ?? option.child_agent_id} ${Number(option.probability) * 100}%`,
                            )
                            .join(' · ')
                        : step.model_calls
                            .map(
                              (call) => `${call.model_id || 'Unselected'} ${Number(call.probability) * 100}%`,
                            )
                            .join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="button-row">
                <button
                  className="button subtle"
                  disabled={agentDirty || savingAgent}
                  onClick={() => onEditAgent(selected)}
                  title={agentDirty ? 'Apply or discard inspector changes first.' : undefined}
                >
                  {selected.count > 1 ? `Edit all ${selected.count} agents` : 'Edit steps and tools'}
                </button>
                <button
                  className="text-button"
                  disabled={agentDirty || selected.count === 0}
                  onClick={() => onCopyAgent(selected)}
                >
                  Copy agent
                </button>
                {selected.count > 1 && (
                  <button
                    className="button subtle"
                    disabled={savingAgent}
                    onClick={async () => {
                      setSavingAgent(true);
                      try {
                        const individualId = await onCustomize(selected);
                        setSelectedId(individualId);
                      } catch (cause) {
                        setAgentError(cause instanceof Error ? cause.message : String(cause));
                      } finally {
                        setSavingAgent(false);
                      }
                    }}
                  >
                    Customize one agent
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="muted small">Select a node to inspect its use case and model steps.</p>
          )}
          <h3>Agent calls</h3>
          {estimate.links.length === 0 ? (
            <p className="muted small">No calls yet. Configure an Invoke agent step in the caller.</p>
          ) : (
            <div className="graph-list">
              {estimate.links.map((link) => {
                const source = estimate.agents.find((row) => row.id === link.parent_id);
                const target = estimate.agents.find((row) => row.id === link.child_id);
                const contribution = result?.base_links[link.id];
                return (
                  <div className="graph-edge" key={link.id}>
                    <div className="graph-path">
                      <strong>{source?.name}</strong>
                      <span aria-hidden="true">→</span>
                      <strong>{target?.name}</strong>
                    </div>
                    <p>
                      {link.trigger_probability} selection probability · one invocation when selected
                      {link.step_id
                        ? ` · ${source?.steps.find((step) => step.id === link.step_id)?.name || 'step'}`
                        : ''}
                    </p>
                    <p>
                      Child invocations/month:{' '}
                      <strong>
                        {contribution?.complete ? displayVolume(contribution.child_total) : 'Incomplete'}
                      </strong>
                    </p>
                    <div className="button-row">
                      <button className="text-button" onClick={() => source && onEditAgent(source)}>
                        Edit link
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="graph-link-editor">
            <h3>Configure agent calls</h3>
            <p>
              Add an Invoke agent step to a caller, then configure all its target probabilities together.
              Their total must be 1.0.
            </p>
            <button
              className="button dark"
              disabled={!selected}
              onClick={() => selected && onEditAgent(selected)}
            >
              Edit caller steps
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
