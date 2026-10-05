import { useRef, useState } from 'react';
import { FileSpreadsheet, Plus, Trash2, Upload } from 'lucide-react';
import { displayVolume, money, type AgentRow, type Estimate, type ScenarioResult } from './types';

const pageSize = 50;

export function AgentInventory({
  estimate,
  expected,
  onEdit,
  onDelete,
  onAdd,
  onBulkAdd,
  onExportJson,
  onImportJson,
  onImportSpreadsheet,
  busy,
}: {
  estimate: Estimate;
  expected?: ScenarioResult;
  onEdit: (row: AgentRow, memberId: string) => void;
  onDelete: (memberId: string) => void;
  onAdd: () => void;
  onBulkAdd: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onImportSpreadsheet: (file: File) => void;
  busy: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const rows = estimate.agents.flatMap((row) => row.members.map((member) => ({ row, member })));
  const byId = new Map(estimate.agents.map((row) => [row.id, row]));
  const callers = new Map<string, Set<string>>();
  const callees = new Map<string, Set<string>>();
  for (const link of estimate.links) {
    if (!callers.has(link.child_id)) callers.set(link.child_id, new Set());
    if (!callees.has(link.parent_id)) callees.set(link.parent_id, new Set());
    callers.get(link.child_id)!.add(link.parent_id);
    callees.get(link.parent_id)!.add(link.child_id);
  }
  const agentCount = (ids: Set<string> | undefined) =>
    [...(ids ?? [])].reduce((sum, id) => sum + (byId.get(id)?.count ?? 0), 0);
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(
    ({ row, member }) =>
      !query ||
      [member.name, member.business_use_case_description, row.use_case_name, row.use_case_description]
        .join(' ')
        .toLowerCase()
        .includes(query),
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return (
    <section className="panel agent-inventory-panel" aria-label="Agent inventory">
      <div className="section-heading">
        <div>
          <h2>
            Agents <span className="count-chip">{rows.length}</span>
          </h2>
          <p>Each row is one agent. Open a row to edit its use case, steps, models, and workload.</p>
        </div>
        <div className="button-row inventory-actions">
          <a className="button subtle" href="/api/import/template">
            <FileSpreadsheet size={15} /> Template
          </a>
          <button className="button subtle" onClick={onExportJson} disabled={busy}>
            Export JSON
          </button>
          <button className="button subtle" onClick={() => jsonFileRef.current?.click()} disabled={busy}>
            Import JSON
          </button>
          <button className="button subtle" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload size={15} /> Import
          </button>
          <button className="button bulk-add" onClick={onBulkAdd} disabled={busy}>
            <Plus size={16} aria-hidden="true" /> Bulk add
          </button>
          <button className="button dark" onClick={onAdd} disabled={busy}>
            <Plus size={16} /> Add agent
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        aria-label="Import agent spreadsheet"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportSpreadsheet(file);
          event.target.value = '';
        }}
      />
      <input
        ref={jsonFileRef}
        type="file"
        accept=".json,application/json"
        aria-label="Import JSON estimate"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportJson(file);
          event.target.value = '';
        }}
      />
      {rows.length === 0 ? (
        <div className="empty-state">No agents yet. Add an agent or use Bulk add to start your suite.</div>
      ) : (
        <>
          <div className="inventory-toolbar">
            <input
              className="search-input"
              aria-label="Search agent inventory"
              placeholder="Search agents or use cases…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
            <span>Caller and callee counts include all unique agent identities.</span>
            <span>
              Expected monthly models, tools, and allocated harness. Suite extras and unallocated fixed
              harness stay at suite level.
            </span>
          </div>
          <div className="table-scroll">
            <table className="agent-table inventory-agent-table">
              <thead>
                <tr>
                  <th>AGENT NAME</th>
                  <th>USE CASE NAME</th>
                  <th>STEPS</th>
                  <th>CALLED BY AGENTS</th>
                  <th>CALLS AGENTS</th>
                  <th>USERS / AGENT / DAY</th>
                  <th>INVOCATIONS / USER / AGENT / DAY</th>
                  <th>TOTAL COST</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ row, member }) => (
                  <tr key={member.id}>
                    <td>
                      <strong>{member.name}</strong>
                    </td>
                    <td>{row.use_case_name || 'Use case pending'}</td>
                    <td>{row.steps.length || 1}</td>
                    <td>{agentCount(callers.get(row.id))}</td>
                    <td>{agentCount(callees.get(row.id))}</td>
                    <td>{row.users_per_day == null ? '—' : displayVolume(row.users_per_day)}</td>
                    <td>
                      {row.invocations_per_user_per_agent_per_day == null
                        ? '—'
                        : displayVolume(row.invocations_per_user_per_agent_per_day)}
                    </td>
                    <td data-testid={`inventory-total-cost-${member.id}`}>
                      {expected?.agent_costs?.[row.id]
                        ? !expected.agent_costs[row.id].complete &&
                          Number(expected.agent_costs[row.id].per_agent_monthly) === 0
                          ? 'Incomplete'
                          : `${money(expected.agent_costs[row.id].per_agent_monthly)}/mo${
                              expected.agent_costs[row.id].complete ? '' : ' (partial)'
                            }`
                        : '—'}
                    </td>
                    <td>
                      <div className="button-row inventory-row-actions">
                        <button
                          className="button subtle"
                          onClick={() => onEdit(row, member.id)}
                          disabled={busy}
                          aria-label={`Edit ${member.name}`}
                        >
                          Edit
                        </button>
                        <button
                          className="button danger"
                          onClick={() => onDelete(member.id)}
                          disabled={busy}
                          aria-label={`Delete ${member.name}`}
                        >
                          <Trash2 size={14} aria-hidden="true" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="muted">No agents match this search.</p>}
          {filtered.length > pageSize && (
            <div className="button-row inventory-pagination">
              <button
                className="button subtle"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>
              <span>
                {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, filtered.length)} of{' '}
                {filtered.length}
              </span>
              <button
                className="button subtle"
                disabled={(currentPage + 1) * pageSize >= filtered.length}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
