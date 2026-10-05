import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ExecutionFields, Field, Numeric } from './components';
import {
  api,
  categoryClass,
  displayVolume,
  effective,
  id,
  money,
  type AgentLink,
  type AgentRow,
  type Complexity,
  type Estimate,
  type Price,
  type Results,
} from './types';

const clone = <T,>(value: T): T => structuredClone(value);
export type GraphAgentDrafts = Record<string, { base: AgentRow; draft: AgentRow }>;
type Form = {
  parent_id: string;
  child_id: string;
  step_id: string;
  trigger_probability: string;
  invocations_per_trigger: string;
  branch_group: string;
  low_probability: string;
  low_fanout: string;
  high_probability: string;
  high_fanout: string;
};
const blankForm: Form = {
  parent_id: '',
  child_id: '',
  step_id: '',
  trigger_probability: '1',
  invocations_per_trigger: '1',
  branch_group: '',
  low_probability: '',
  low_fanout: '',
  high_probability: '',
  high_fanout: '',
};

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
  const [form, setForm] = useState<Form>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    base: Estimate;
    next: Estimate;
    result: Results;
    linkId: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agentError, setAgentError] = useState('');
  const [savingAgent, setSavingAgent] = useState(false);
  const requestRevision = useRef(0);
  const rows = estimate.agents.filter((row) => row.count > 0);
  const parentId = form.parent_id || rows[0]?.id || '';
  const childId = form.child_id || rows.find((row) => row.id !== parentId)?.id || '';
  const parent = estimate.agents.find((row) => row.id === parentId);
  const child = estimate.agents.find((row) => row.id === childId);
  const activePreview = preview?.base === estimate ? preview : null;
  const selected = estimate.agents.find((row) => row.id === selectedId) || rows[0];
  const selectedDraft = selected ? agentDrafts[selected.id]?.draft || selected : null;
  const selectedBase = selected ? agentDrafts[selected.id]?.base || selected : null;
  const agentDirty =
    !!selectedDraft && !!selectedBase && JSON.stringify(selectedDraft) !== JSON.stringify(selectedBase);
  const editableStep =
    selectedDraft?.steps.length === 1 && selectedDraft.steps[0].model_calls.length === 0
      ? selectedDraft.steps[0]
      : null;
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
    setEditingId(null);
    change({ parent_id: row.id, child_id: rows.find((candidate) => candidate.id !== row.id)?.id || '' });
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
    const next = clone(base);
    const index = next.agents.findIndex((row) => row.id === selected.id);
    if (index < 0) {
      setAgentError('This agent no longer exists. Select another agent.');
      return;
    }
    next.agents[index] = clone(selectedDraft);
    const modelIds = [
      selectedDraft.overrides.model_id,
      ...selectedDraft.steps.flatMap((step) => [
        step.model_id,
        ...step.model_calls.map((call) => call.model_id),
      ]),
    ];
    for (const modelId of modelIds)
      if (modelId && !next.prices[modelId] && prices[modelId]) next.prices[modelId] = clone(prices[modelId]);
    setSavingAgent(true);
    setAgentError('');
    try {
      await api('/calculate', next);
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

  function change(patch: Partial<Form>) {
    requestRevision.current += 1;
    setForm((previous) => ({ ...previous, ...patch }));
    setPreview(null);
    setError('');
  }

  function startEdit(link: AgentLink) {
    requestRevision.current += 1;
    setEditingId(link.id);
    setForm({
      parent_id: link.parent_id,
      child_id: link.child_id,
      step_id: link.step_id ?? '',
      trigger_probability: link.trigger_probability,
      invocations_per_trigger: link.invocations_per_trigger,
      branch_group: link.branch_group,
      low_probability: link.low.trigger_probability ?? '',
      low_fanout: link.low.invocations_per_trigger ?? '',
      high_probability: link.high.trigger_probability ?? '',
      high_fanout: link.high.invocations_per_trigger ?? '',
    });
    setPreview(null);
    setError('');
  }

  async function previewChange() {
    if (!result || !parentId || !childId) return;
    const base = estimate;
    const revision = ++requestRevision.current;
    const next = clone(base);
    const link: AgentLink = {
      id: editingId || id(),
      parent_id: parentId,
      child_id: childId,
      step_id: form.step_id || null,
      trigger_probability: form.trigger_probability,
      invocations_per_trigger: form.invocations_per_trigger,
      branch_group: form.branch_group.trim(),
      branch_event_id: editingId
        ? estimate.links.find((item) => item.id === editingId)?.branch_event_id || null
        : null,
      low: {
        trigger_probability: form.low_probability === '' ? null : form.low_probability,
        invocations_per_trigger: form.low_fanout === '' ? null : form.low_fanout,
      },
      high: {
        trigger_probability: form.high_probability === '' ? null : form.high_probability,
        invocations_per_trigger: form.high_fanout === '' ? null : form.high_fanout,
      },
    };
    if (editingId) {
      const index = next.links.findIndex((item) => item.id === editingId);
      if (index < 0) {
        setError('This link no longer exists. Select it again.');
        return;
      }
      next.links[index] = link;
      if (link.branch_event_id) {
        for (const sibling of next.links) {
          if (
            sibling.id === link.id ||
            sibling.branch_event_id !== link.branch_event_id ||
            sibling.parent_id !== link.parent_id
          )
            continue;
          sibling.branch_group = link.branch_group;
          sibling.step_id = link.step_id;
          sibling.trigger_probability = link.trigger_probability;
          sibling.low.trigger_probability = link.low.trigger_probability;
          sibling.high.trigger_probability = link.high.trigger_probability;
        }
      }
    } else {
      const target = next.agents.find((row) => row.id === childId)!;
      if (target.volume_source !== 'derived') {
        target.prior_volume_source = target.volume_source;
        target.volume_source = 'derived';
      }
      next.links.push(link);
    }
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const nextResult = await api<Results>('/calculate', next);
      if (revision === requestRevision.current)
        setPreview({ base, next, result: nextResult, linkId: link.id });
    } catch (cause) {
      if (revision === requestRevision.current)
        setError(cause instanceof Error ? cause.message : 'Could not preview this link.');
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(link: AgentLink) {
    requestRevision.current += 1;
    const base = estimate;
    const next = clone(base);
    next.links = next.links.filter((item) => item.id !== link.id);
    if (!next.links.some((item) => item.child_id === link.child_id)) {
      const target = next.agents.find((row) => row.id === link.child_id)!;
      target.volume_source = target.prior_volume_source || 'daily_users';
      target.prior_volume_source = null;
    }
    setBusy(true);
    setError('');
    try {
      await api('/calculate', next);
      onApply(
        next,
        base,
        'Agent link removed. Previous direct volume restored when the last link was removed.',
      );
      setEditingId(null);
      setForm(blankForm);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this link.');
    } finally {
      setBusy(false);
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
                        {Math.round(Number(link.trigger_probability) * 100)}% × {link.invocations_per_trigger}
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
                      step.model_calls.length
                        ? step.model_calls.map(
                            (call) =>
                              `${call.model_id || 'Unselected'} ${Math.round(Number(call.probability) * 100)}%`,
                          )
                        : [step.model_id || 'Unselected model'],
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
                      label="Legacy monthly invocations / agent"
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
                        value={editableStep ?? effective(estimate, selectedDraft!)}
                        prices={prices}
                        onChange={(patch) =>
                          changeSelected((draft) => {
                            if (draft.steps.length === 1 && draft.steps[0].model_calls.length === 0)
                              Object.assign(draft.steps[0], patch);
                            else draft.overrides = { ...draft.overrides, ...patch };
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
                      disabled={!agentDirty || savingAgent || busy}
                      onClick={() => void saveSelected()}
                    >
                      {savingAgent ? 'Applying…' : 'Apply agent changes'}
                    </button>
                    {agentDirty && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setAgentDrafts((previous) => {
                            const updated = { ...previous };
                            delete updated[selected.id];
                            return updated;
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
                      {step.model_calls.length
                        ? step.model_calls
                            .map(
                              (call) => `${call.model_id || 'Unselected'} ${Number(call.probability) * 100}%`,
                            )
                            .join(' · ')
                        : step.model_id || 'Unselected model'}
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
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const individualId = await onCustomize(selected);
                        setSelectedId(individualId);
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : String(cause));
                      } finally {
                        setBusy(false);
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
            <p className="muted small">No calls yet. Connect a caller to a child below.</p>
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
                      {link.trigger_probability} probability × {link.invocations_per_trigger}{' '}
                      invocations/trigger
                      {link.step_id
                        ? ` · ${source?.steps.find((step) => step.id === link.step_id)?.name || 'step'}`
                        : ''}
                      {link.branch_group ? ` · exclusive: ${link.branch_group}` : ''}
                    </p>
                    <p>
                      Child invocations/month:{' '}
                      <strong>
                        {contribution?.complete ? displayVolume(contribution.child_total) : 'Incomplete'}
                      </strong>
                    </p>
                    <div className="button-row">
                      <button className="text-button" onClick={() => startEdit(link)}>
                        Edit link
                      </button>
                      <button className="text-button" disabled={busy} onClick={() => void removeLink(link)}>
                        Remove link
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="graph-link-editor">
            <h3>{editingId ? 'Edit invocation link' : 'Add invocation link'}</h3>
            {editingId && (
              <button
                className="text-button"
                onClick={() => {
                  requestRevision.current += 1;
                  setEditingId(null);
                  setForm(blankForm);
                  setPreview(null);
                }}
              >
                Add a new link instead
              </button>
            )}
            <div className="form-grid two">
              <label className="field">
                <span>Caller agent</span>
                <select
                  value={parentId}
                  disabled={!!editingId}
                  onChange={(event) => change({ parent_id: event.target.value, step_id: '' })}
                >
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Child agent</span>
                <select
                  value={childId}
                  disabled={!!editingId}
                  onChange={(event) => change({ child_id: event.target.value })}
                >
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Caller step (optional)</span>
                <select value={form.step_id} onChange={(event) => change({ step_id: event.target.value })}>
                  <option value="">Whole use case</option>
                  {parent?.steps.map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Trigger probability (0–1)</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  value={form.trigger_probability}
                  onChange={(event) => change({ trigger_probability: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Child invocations per trigger</span>
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="any"
                  value={form.invocations_per_trigger}
                  onChange={(event) => change({ invocations_per_trigger: event.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>Exclusive branch (optional)</span>
              <input
                value={form.branch_group}
                onChange={(event) => change({ branch_group: event.target.value })}
                placeholder="Blank means this link can trigger independently"
              />
            </label>
            <details className="graph-scenario-options">
              <summary>Low and High scenario overrides</summary>
              <p className="muted small">
                Leave blank to use the Expected link value. These overrides affect only their named scenario.
              </p>
              <div className="form-grid two">
                {(['low', 'high'] as const).map((scenario) => (
                  <div key={scenario}>
                    <label className="field">
                      <span>{scenario === 'low' ? 'Low' : 'High'} trigger probability</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="any"
                        value={form[`${scenario}_probability`]}
                        onChange={(event) => change({ [`${scenario}_probability`]: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>{scenario === 'low' ? 'Low' : 'High'} child invocations per trigger</span>
                      <input
                        type="number"
                        min="0"
                        max="1000000"
                        step="any"
                        value={form[`${scenario}_fanout`]}
                        onChange={(event) => change({ [`${scenario}_fanout`]: event.target.value })}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </details>
            {child && !editingId && child.volume_source !== 'derived' && (
              <p className="graph-conversion">
                Applying this link converts <strong>{child.name}</strong> from{' '}
                {child.volume_source === 'daily_users' ? 'daily-user' : 'legacy manual'} volume to derived
                volume. Its entered values are kept for recovery.
              </p>
            )}
            {error && (
              <p className="invalid-text" role="alert">
                {error}
              </p>
            )}
            <button
              className="button dark"
              disabled={busy || !parent || !child || !result}
              onClick={() => void previewChange()}
            >
              {busy ? 'Checking…' : 'Preview link change'}
            </button>
            {activePreview && child && (
              <div className="graph-preview" role="status">
                <p>
                  <strong>{child.name} baseline invocations/month:</strong>{' '}
                  {result?.base_volumes[child.id]?.complete
                    ? displayVolume(result.base_volumes[child.id].total)
                    : 'Incomplete'}{' '}
                  →{' '}
                  {activePreview.result.base_volumes[child.id].complete
                    ? displayVolume(activePreview.result.base_volumes[child.id].total)
                    : 'Incomplete'}
                </p>
                <div className="graph-preview-scenarios">
                  {(['Low', 'Expected', 'High'] as const).map((name) => {
                    const before = result?.scenarios.find((scenario) => scenario.name === name);
                    const after = activePreview.result.scenarios.find((scenario) => scenario.name === name);
                    const link = after?.link_contributions[activePreview.linkId];
                    return (
                      <p key={name}>
                        <strong>{name} suite LLM/month:</strong>{' '}
                        {before?.complete ? money(before.llm_cost) : 'Incomplete'} →{' '}
                        {after?.complete ? money(after.llm_cost) : 'Incomplete'}
                        {link && (
                          <small>
                            {' '}
                            · {link.trigger_probability} probability × {link.invocations_per_trigger} child
                            invocations/trigger
                          </small>
                        )}
                      </p>
                    );
                  })}
                </div>
                <p className="muted small">
                  Preview only. Apply to update this draft; Save estimate to persist it.
                </p>
                <button
                  className="button dark"
                  onClick={() => {
                    try {
                      onApply(
                        activePreview.next,
                        activePreview.base,
                        'Agent invocation link applied. Save to persist this graph.',
                      );
                      setEditingId(null);
                      setForm(blankForm);
                      setPreview(null);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : 'Preview is no longer current.');
                    }
                  }}
                >
                  Apply link change
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
