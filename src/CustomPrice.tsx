import { useState } from 'react';
import { Field, Modal, Numeric } from './components';
import { type Price } from './types';

export function CustomPrice({ onClose, onSave }: { onClose: () => void; onSave: (p: Price) => void }) {
  const [values, setValues] = useState({
    name: '',
    provider: 'Custom',
    source_type: 'custom' as NonNullable<Price['source_type']>,
    channel: '',
    region: '',
    currency: 'USD',
    fx_to_usd: '1',
    fx_source: '',
    input: '',
    output: '',
    cache_read: '',
    cache_write: '',
  });
  const [error, setError] = useState('');
  return (
    <Modal title="Add custom model rates" onClose={onClose}>
      <p className="muted">
        Use a unique model ID for negotiated rates or a model missing from the catalog. Rates are per million
        tokens in the selected currency; enter a sourced USD conversion rate when needed.
      </p>
      <div className="form-grid">
        <Field label="Custom model ID">
          <input
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
            placeholder="e.g. customer/contract-model"
          />
        </Field>
        <Field label="Provider name">
          <input
            value={values.provider}
            onChange={(e) => setValues({ ...values, provider: e.target.value })}
          />
        </Field>
        <Field label="Source type">
          <select
            value={values.source_type}
            onChange={(e) =>
              setValues({ ...values, source_type: e.target.value as NonNullable<Price['source_type']> })
            }
          >
            <option value="custom">Custom</option>
            <option value="vendor_api">Vendor API</option>
            <option value="cloud_marketplace">Cloud marketplace</option>
            <option value="self_hosted">Self-hosted rate</option>
            <option value="fine_tuned">Fine-tuned inference</option>
          </select>
        </Field>
        <Field label="Channel">
          <input
            value={values.channel}
            onChange={(e) => setValues({ ...values, channel: e.target.value })}
            placeholder="e.g. AWS Bedrock"
          />
        </Field>
        <Field label="Region">
          <input
            value={values.region}
            onChange={(e) => setValues({ ...values, region: e.target.value })}
            placeholder="Price-relevant region"
          />
        </Field>
        <Field label="Currency">
          <input
            value={values.currency}
            maxLength={3}
            onChange={(e) => setValues({ ...values, currency: e.target.value.toUpperCase() })}
          />
        </Field>
        {values.currency !== 'USD' && (
          <>
            <Numeric
              label="USD per 1 currency unit"
              value={values.fx_to_usd}
              onChange={(v) => setValues({ ...values, fx_to_usd: v })}
            />
            <Field label="FX rate source">
              <input
                value={values.fx_source}
                onChange={(e) => setValues({ ...values, fx_source: e.target.value })}
              />
            </Field>
          </>
        )}
        {(['input', 'output', 'cache_read', 'cache_write'] as const).map((k) => (
          <Numeric
            key={k}
            label={`${k.replaceAll('_', ' ')} ${values.currency} / 1M`}
            value={values[k]}
            onChange={(v) => setValues({ ...values, [k]: v })}
            hint={k.startsWith('cache') ? 'Optional. Blank means unavailable.' : undefined}
          />
        ))}
      </div>
      <p className="muted small">
        Custom rates are uniform. Use a separate model ID for a different region, service tier, or cache
        duration.
      </p>
      {error && (
        <p className="invalid-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button subtle" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button dark"
          onClick={() => {
            try {
              if (
                !values.name.trim() ||
                !values.provider.trim() ||
                !/^[A-Z]{3}$/.test(values.currency) ||
                (values.currency !== 'USD' && (Number(values.fx_to_usd) <= 0 || !values.fx_source.trim())) ||
                values.input === '' ||
                values.output === '' ||
                ![values.input, values.output, values.cache_read || '0', values.cache_write || '0'].every(
                  (v) => Number.isFinite(Number(v)) && Number(v) >= 0,
                )
              )
                throw new Error('Enter a name, provider and nonnegative input/output rates.');
              onSave({
                id: values.name.trim(),
                provider: values.provider.trim(),
                source_type: values.source_type,
                channel: values.channel.trim(),
                region: values.region.trim(),
                currency: values.currency,
                fx_to_usd: values.currency === 'USD' ? '1' : values.fx_to_usd,
                fx_source: values.currency === 'USD' ? '' : values.fx_source.trim(),
                fx_retrieved_at: values.currency === 'USD' ? '' : new Date().toISOString(),
                input: values.input,
                output: values.output,
                cache_read: values.cache_read || null,
                cache_write: values.cache_write || null,
                max_input: null,
                max_output: null,
                tiers: [],
                source: 'Architect-supplied custom rates',
                retrieved_at: new Date().toISOString(),
                custom: true,
                unsupported: [],
              });
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Add model
        </button>
      </div>
    </Modal>
  );
}
