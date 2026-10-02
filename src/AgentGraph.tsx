import { useRef, useState } from 'react';
import { api, displayVolume, id, money, type AgentLink, type Estimate, type Results } from './types';

const clone = <T,>(value: T): T => structuredClone(value);
type Form = {
  parent_id: string;
  child_id: string;
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
  onApply,
}: {
  estimate: Estimate;
  result: Results | null;
  onApply: (next: Estimate, base: Estimate, message: string) => void;
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
  const requestRevision = useRef(0);
  const rows = estimate.agents.filter((row) => row.count > 0);
  const parentId = form.parent_id || rows[0]?.id || '';
  const childId = form.child_id || rows.find((row) => row.id !== parentId)?.id || '';
  const parent = estimate.agents.find((row) => row.id === parentId);
  const child = estimate.agents.find((row) => row.id === childId);
  const activePreview = preview?.base === estimate ? preview : null;

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
      trigger_probability: form.trigger_probability,
      invocations_per_trigger: form.invocations_per_trigger,
      branch_group: form.branch_group.trim(),
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
          <h2>Agent-to-agent work</h2>
          <p>Each arrow starts child agent invocations. Each agent’s own model calls are priced once.</p>
        </div>
      </div>
      <div className="graph-layout">
        <div>
          <h3>Invocation graph</h3>
          {estimate.links.length === 0 ? (
            <p className="muted small">No links yet. Choose a caller and child to preview delegated work.</p>
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
                      {link.branch_group
                        ? ` · exclusive branch: ${link.branch_group}`
                        : ' · independent branch'}
                    </p>
                    <p>
                      Baseline child invocations/month:{' '}
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
          <p className="muted small">
            Derived groups pool incoming invocations across their agents. Cycles and links to direct-volume
            rows are rejected.
          </p>
        </div>
        <div className="graph-form">
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
              <span>Caller agent/group</span>
              <select
                value={parentId}
                disabled={!!editingId}
                onChange={(event) => change({ parent_id: event.target.value })}
              >
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Child agent/group</span>
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
            <span>Exclusive branch group (optional)</span>
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
    </section>
  );
}
