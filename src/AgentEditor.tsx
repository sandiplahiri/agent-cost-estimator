import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ExecutionFields, Field, Modal, Numeric } from './components';
import { complexities, effective, type AgentRow, type Complexity, type Estimate, type Price } from './types';
const clone = <T,>(value: T): T => structuredClone(value);

export function AgentEditor({
  row,
  estimate,
  prices,
  onClose,
  onSave,
  onRemove,
  onSplit,
}: {
  row: AgentRow;
  estimate: Estimate;
  prices: Record<string, Price>;
  onClose: () => void;
  onSave: (row: AgentRow) => Promise<void>;
  onRemove: () => void;
  onSplit: (draft: AgentRow) => void;
}) {
  const [draft, setDraft] = useState(clone(row));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const execution = effective(estimate, draft);
  return (
    <Modal title="Configure agent group" onClose={onClose} wide>
      <div className="form-grid">
        <Field label="Agent / group name">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Complexity">
          <select
            value={draft.complexity}
            onChange={(e) => setDraft({ ...draft, complexity: e.target.value as Complexity })}
          >
            {complexities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Numeric
          label="Agent count"
          integer
          value={draft.count}
          onChange={(v) => setDraft({ ...draft, count: Number(v) })}
        />
        <Numeric
          label="Users per agent per day *"
          value={draft.users_per_day ?? ''}
          required
          onChange={(users_per_day) =>
            setDraft({ ...draft, users_per_day: users_per_day || null, volume_source: 'daily_users' })
          }
          hint="Daily users of each agent in this row. Uses a 30-day planning month."
        />
        <Numeric
          label="Invocations per user per agent per day *"
          value={draft.invocations_per_user_per_agent_per_day ?? ''}
          required
          onChange={(invocations_per_user_per_agent_per_day) =>
            setDraft({
              ...draft,
              invocations_per_user_per_agent_per_day: invocations_per_user_per_agent_per_day || null,
              volume_source: 'daily_users',
            })
          }
          hint="Average per user for each agent, including calls from other agents."
        />
      </div>
      <p className="muted small">
        * Required for every group. Total monthly invocations per agent are calculated from these inputs using
        30 days/month.
        {draft.volume_source === 'manual' &&
          ' This saved row still uses a legacy manual volume until both daily inputs are entered.'}
      </p>
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
              <div className="step-card" key={i}>
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
                  <button
                    className="icon-button"
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
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
              steps: [...draft.steps, { ...execution, name: `Step ${draft.steps.length + 1}` }],
            })
          }
        >
          <Plus size={15} />
          {draft.steps.length ? 'Add model-call step' : 'Use detailed workflow'}
        </button>
      </div>
      {error && (
        <p className="invalid-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions spread">
        <div className="button-row">
          {estimate.agents.some((r) => r.id === row.id) && (
            <button className="button danger" onClick={onRemove}>
              <Trash2 size={14} />
              Remove
            </button>
          )}
          {row.count > 1 && estimate.agents.some((r) => r.id === row.id) && (
            <button className="button subtle" onClick={() => onSplit(draft)}>
              Customize one agent
            </button>
          )}
        </div>
        <button
          className="button dark"
          disabled={
            saving ||
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
