import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, Search } from 'lucide-react';
import { type ComplexityProfile, type Execution, type Price, rateMoney } from './types';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Numeric({
  label,
  value,
  onChange,
  hint,
  max,
  integer = false,
  required = false,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  hint?: string;
  max?: number;
  integer?: boolean;
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        aria-label={label}
        aria-description={hint}
        type="number"
        min="0"
        max={max}
        step={integer ? '1' : 'any'}
        required={required}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ModelPicker({
  label = 'Model',
  value,
  prices,
  onChange,
}: {
  label?: string;
  value: string;
  prices: Record<string, Price>;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const providers = useMemo(
    () => [...new Set(Object.values(prices).map((p) => p.provider))].sort(),
    [prices],
  );
  const choices = useMemo(
    () =>
      Object.values(prices)
        .filter(
          (p) =>
            (!provider || p.provider === provider) &&
            `${p.id} ${p.provider}`.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => Number(b.custom) - Number(a.custom) || a.id.localeCompare(b.id)),
    [prices, search, provider],
  );
  return (
    <>
      <div className="field">
        <span>{label}</span>
        <button
          className="model-trigger"
          onClick={() => setOpen(true)}
          aria-label={`${label}: ${value || 'Select model'}`}
        >
          <span>{value || 'Select model'}</span>
          <Search size={14} />
        </button>
      </div>
      {open && (
        <Modal title="Choose a model" onClose={() => setOpen(false)}>
          <p className="muted">Search the catalog or your custom rates. USD per million tokens.</p>
          <div className="model-filters">
            <Field label="Search models">
              <input
                autoFocus
                value={search}
                placeholder="Search model or provider…"
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <Field label="Provider">
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">All providers</option>
                {providers.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="model-list">
            {choices.slice(0, 100).map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className="model-choice"
              >
                <span>
                  <strong>{p.id}</strong>
                  <small>
                    {p.provider}
                    {p.custom ? ' · Custom' : ''}
                    {p.unsupported.length > 0 ? ' · Requires custom pricing' : ''}
                  </small>
                </span>
                <span>
                  {p.input === null ? 'Unavailable' : rateMoney(p.input)} in
                  <br />
                  {p.output === null ? 'Unavailable' : rateMoney(p.output)} out
                </span>
              </button>
            ))}
            {choices.length === 0 && <p>No matching models. Add custom rates in Model pricing.</p>}
          </div>
          <p className="muted small">
            Showing {Math.min(100, choices.length)} of {choices.length} matches. Narrow your search to see
            more.
          </p>
        </Modal>
      )}
    </>
  );
}

export function ExecutionFields({
  value,
  onChange,
  prices,
  showModel = true,
}: {
  value: ComplexityProfile & { model_id?: string };
  onChange: (patch: Partial<Execution>) => void;
  prices: Record<string, Price>;
  showModel?: boolean;
}) {
  return (
    <div className="form-grid">
      {showModel && (
        <div className="span-2">
          <ModelPicker
            value={value.model_id ?? ''}
            prices={prices}
            onChange={(model_id) => onChange({ model_id })}
          />
        </div>
      )}
      <Numeric
        label="Model calls / invocation"
        value={value.calls}
        onChange={(calls) => onChange({ calls })}
        hint="Includes tool and revision cycles; excludes retries."
      />
      <Numeric
        label="Additional attempt rate"
        value={value.retry_rate}
        onChange={(retry_rate) => onChange({ retry_rate })}
        hint="0.05 means 5 extra attempts per 100 calls."
      />
      <Numeric
        label="Input tokens / call"
        value={value.input_tokens}
        onChange={(input_tokens) => onChange({ input_tokens })}
        hint="Instructions, history, retrieval and tool results."
      />
      <Numeric
        label="Output tokens / call"
        value={value.output_tokens}
        onChange={(output_tokens) => onChange({ output_tokens })}
        hint="Total billable output, including reasoning."
      />
      <Numeric
        label="Cached read fraction"
        value={value.cache_fraction}
        max={1}
        onChange={(cache_fraction) => onChange({ cache_fraction })}
        hint="0–1 fraction of total input; requires cache pricing."
      />
      <Numeric
        label="Cache write fraction"
        value={value.cache_write_fraction}
        max={1}
        onChange={(cache_write_fraction) => onChange({ cache_write_fraction })}
        hint="Read + write fractions must not exceed 1; requires a cache-write rate."
      />
    </div>
  );
}
