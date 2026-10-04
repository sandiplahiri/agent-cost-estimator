import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Blocks,
  Check,
  ChevronRight,
  CircleHelp,
  Coins,
  FileSpreadsheet,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  Network,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  UsersRound,
  X,
} from 'lucide-react';
import { ExecutionFields, Field, Modal, ModelPicker, Numeric } from './components';
import { AgentEditor } from './AgentEditor';
import { AgentInventory } from './AgentInventory';
import { CustomPrice } from './CustomPrice';
import { CostImpact } from './CostImpact';
import { AgentGraph, type GraphAgentDrafts } from './AgentGraph';
import {
  api,
  categoryClass,
  complexities,
  effective,
  displayVolume,
  id,
  money,
  number,
  rateMoney,
  resizeMembers,
  pendingUseCase,
  type AgentRow,
  type Catalog,
  type ComplexityProfile,
  type Estimate,
  type GlobalCategory,
  type Price,
  type Results,
  type Scenario,
} from './types';

type Tab = 'suite' | 'inventory' | 'graph' | 'profiles' | 'scenarios' | 'pricing' | 'harness' | 'extras';
const tabs = [
  { id: 'suite' as Tab, label: 'Suite planner', icon: LayoutDashboard },
  { id: 'inventory' as Tab, label: 'Agent inventory', icon: UsersRound },
  { id: 'graph' as Tab, label: 'Agent suite graph', icon: Network },
  { id: 'profiles' as Tab, label: 'Complexity profiles', icon: SlidersHorizontal },
  { id: 'scenarios' as Tab, label: 'Scenarios', icon: GitBranch },
  { id: 'pricing' as Tab, label: 'Model pricing', icon: Coins },
  { id: 'harness' as Tab, label: 'Agent harness', icon: Blocks },
  { id: 'extras' as Tab, label: 'Additional costs', icon: Plus },
];
const descriptions = {
  simple: 'Direct responses & extraction',
  medium: 'Retrieval, tools & synthesis',
  high: 'Planning, iteration & revision',
};
function uniqueAgentName(base: string, estimate: Estimate): string {
  base = base.slice(0, 110);
  const used = new Set(
    estimate.agents
      .flatMap((row) => [row.name, ...row.members.map((member) => member.name)])
      .map((name) => name.trim().toLowerCase()),
  );
  let name = base;
  let suffix = 2;
  while (used.has(name.trim().toLowerCase())) {
    name = `${base} (${suffix})`;
    suffix += 1;
  }
  return name;
}
const tokenTypeLabels = {
  input: 'Uncached input',
  cache_read: 'Cached input read',
  cache_write: 'Input cache write',
  output: 'Output, incl. reasoning',
};
const tokenTypes = ['input', 'cache_read', 'cache_write', 'output'] as const;
const emptyPrices: Record<string, Price> = {};
const clone = <T,>(value: T): T => structuredClone(value);
const quantityLabel = (total: string, complete: boolean) =>
  complete ? displayVolume(total) : Number(total) === 0 ? 'Incomplete' : `${displayVolume(total)} (partial)`;
const costLabel = (total: string, complete: boolean, format = money) =>
  complete ? format(total) : Number(total) === 0 ? 'Incomplete' : `${format(total)} (partial)`;

function withSnapshots(next: Estimate, available: Record<string, Price>) {
  const modelIds = [
    ...next.agents.flatMap((r) => [
      r.overrides.model_id,
      ...r.steps.flatMap((s) => [s.model_id, ...s.model_calls.map((c) => c.model_id)]),
    ]),
    ...next.scenarios.map((s) => s.model_id),
  ];
  for (const key of modelIds)
    if (key && !next.prices[key] && available[key]) next.prices[key] = clone(available[key]);
  return next;
}
function migrateDraft(raw: Estimate): Estimate {
  const next = clone(raw);
  const legacy = Number(next.schema_version) < 6;
  if (Number(next.schema_version) < 8) {
    const legacyModels: Record<string, string> = {};
    for (const [name, profile] of Object.entries(next.profiles)) {
      const previous = profile as ComplexityProfile & { model_id?: string };
      legacyModels[name] = previous.model_id || '';
      delete previous.model_id;
    }
    for (const row of next.agents) {
      const previous = legacyModels[row.complexity];
      if (!row.steps?.length && previous && row.overrides?.model_id == null) {
        row.overrides ??= {};
        row.overrides.model_id = previous;
      }
    }
  }
  next.schema_version = 8;
  next.links ??= [];
  next.harness ??= {
    name: 'Agent harness',
    harness_type: 'none',
    fixed_monthly: '0',
    per_invocation: '0',
    per_step_execution: '0',
    allocation: 'by_invocations',
    include_in_cost_per_use_case: true,
  };
  next.agents = next.agents.map((row) => ({
    ...row,
    description: row.description ?? '',
    use_case_name: row.use_case_name ?? '',
    use_case_description: row.use_case_description ?? '',
    members: row.members ?? resizeMembers({ ...row, members: [] }, row.count),
    tool_costs: row.tool_costs ?? [],
    steps: row.steps.map((step) => ({
      ...step,
      id: step.id ?? id(),
      execution_probability: step.execution_probability ?? '1',
      model_calls: step.model_calls ?? [],
    })),
    volume_source: row.volume_source ?? 'manual',
    prior_volume_source: row.prior_volume_source ?? null,
    users_per_day: row.users_per_day ?? null,
    invocations_per_user_per_agent_per_day: row.invocations_per_user_per_agent_per_day ?? null,
  }));
  if (legacy) {
    const used = new Set<string>();
    for (const row of next.agents) {
      for (const member of row.members) {
        let name = member.name;
        let suffix = 2;
        while (used.has(name.trim().toLowerCase())) {
          name = `${member.name.slice(0, 110)} (${suffix})`;
          suffix += 1;
        }
        member.name = name;
        used.add(name.trim().toLowerCase());
      }
    }
  }
  next.links = next.links.map((link) => ({
    ...link,
    step_id: link.step_id ?? null,
    branch_event_id: link.branch_event_id ?? null,
  }));
  return next;
}

export default function App() {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [defaults, setDefaults] = useState<Estimate | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [globalCategories, setGlobalCategories] = useState<GlobalCategory[]>([]);
  const [categoryName, setCategoryName] = useState('');
  const [categoryBase, setCategoryBase] = useState('simple');
  const [categoryProfile, setCategoryProfile] = useState<ComplexityProfile | null>(null);
  const [categoryError, setCategoryError] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [deleteCategoryError, setDeleteCategoryError] = useState('');
  const [deleteCategoryBusy, setDeleteCategoryBusy] = useState(false);
  const [result, setResult] = useState<Results | null>(null);
  const [tab, setTab] = useState<Tab>('suite');
  const [error, setError] = useState('');
  const [calcError, setCalcError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [calculating, setCalculating] = useState(false);
  const [saved, setSaved] = useState<{ id: string; name: string; updated: string }[]>([]);
  const [isSaved, setIsSaved] = useState(false);
  const [modal, setModal] = useState<
    'quick' | 'reset' | 'saved' | 'custom' | 'category' | 'deleteCategory' | 'import' | 'refresh' | null
  >(null);
  const [editing, setEditing] = useState<AgentRow | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [graphSelectedId, setGraphSelectedId] = useState<string | null>(null);
  const [graphAgentDrafts, setGraphAgentDrafts] = useState<GraphAgentDrafts>({});
  const [undo, setUndo] = useState<Estimate | null>(null);
  const [clearOverrides, setClearOverrides] = useState(true);
  const [quick, setQuick] = useState({
    total: 10,
    simple: 6,
    medium: 3,
    high: 1,
    daily: {
      simple: { users: '', perUser: '' },
      medium: { users: '', perUser: '' },
      high: { users: '', perUser: '' },
    },
  });
  const [imported, setImported] = useState<{ agents: AgentRow[]; errors: string[] } | null>(null);
  const [refreshPreview, setRefreshPreview] = useState<{
    base: Estimate;
    before: Results;
    estimate: Estimate;
    result: Results;
  } | null>(null);
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const estimateRef = useRef(estimate);
  useLayoutEffect(() => {
    estimateRef.current = estimate;
  }, [estimate]);
  useEffect(() => {
    setGraphSelectedId(null);
    setGraphAgentDrafts({});
  }, [estimate?.id]);
  const available = useMemo(
    () => ({ ...(catalog?.prices || emptyPrices), ...(estimate?.prices || emptyPrices) }),
    [catalog, estimate?.prices],
  );
  const categoryKeys = estimate ? Object.keys(estimate.profiles) : complexities;
  const deletingAssignments = deletingCategory
    ? estimate?.agents.filter(
        (row) =>
          row.complexity.toLowerCase() === deletingCategory.toLowerCase() ||
          row.steps.some((step) => step.complexity?.toLowerCase() === deletingCategory.toLowerCase()),
      ) || []
    : [];
  const deletingGlobalCategory = globalCategories.some(
    (category) => category.name.toLowerCase() === deletingCategory?.toLowerCase(),
  );

  function openDeleteCategory(name: string) {
    setDeletingCategory(name);
    setDeleteCategoryError('');
    setModal('deleteCategory');
  }

  async function deleteCustomCategory() {
    const name = deletingCategory;
    const base = estimateRef.current;
    if (!name || !base) return;
    const assignments = base.agents.filter(
      (row) =>
        row.complexity.toLowerCase() === name.toLowerCase() ||
        row.steps.some((step) => step.complexity?.toLowerCase() === name.toLowerCase()),
    );
    if (assignments.length) {
      setDeleteCategoryError(
        `Reassign agents before deleting ${name}: ${assignments.map((row) => row.name).join(', ')}.`,
      );
      return;
    }
    setDeleteCategoryBusy(true);
    setDeleteCategoryError('');
    try {
      if (deletingGlobalCategory) {
        await api('/categories/delete', { name, estimate: base });
        setGlobalCategories((current) =>
          current.filter((category) => category.name.toLowerCase() !== name.toLowerCase()),
        );
        setDefaults((current) => {
          if (!current) return current;
          const next = clone(current);
          delete next.profiles[name];
          return next;
        });
        setUndo(null);
      } else {
        if (estimateRef.current !== base)
          throw new Error('The draft changed. Review the category and try again.');
        if (!base.profiles[name]) throw new Error('This profile is no longer in the current draft.');
        setUndo(clone(base));
      }
      const removedFromDraft = estimateRef.current === base && Boolean(base.profiles[name]);
      if (removedFromDraft) {
        const next = clone(base);
        delete next.profiles[name];
        setEstimate(next);
        setIsSaved(false);
      }
      setModal(null);
      setNotice(
        deletingGlobalCategory
          ? removedFromDraft
            ? `${name} was deleted globally and removed from this draft. Saved unused profile snapshots remain unchanged.`
            : estimateRef.current === base
              ? `${name} was deleted globally. This draft had no matching profile.`
              : `${name} was deleted globally. The draft changed during deletion; review its category profile before saving.`
          : `${name} was removed from this draft. Save to update this estimate.`,
      );
    } catch (cause) {
      setDeleteCategoryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleteCategoryBusy(false);
    }
  }

  async function initialize() {
    try {
      setBusy('Loading');
      const [base, currentCatalog, stored, categories] = await Promise.all([
        api<Estimate>('/new'),
        api<Catalog>('/catalog'),
        api<typeof saved>('/estimates'),
        api<GlobalCategory[]>('/categories'),
      ]);
      const startingEstimate = withSnapshots(base, currentCatalog.prices);
      setDefaults(startingEstimate);
      setCatalog(currentCatalog);
      setSaved(stored);
      setGlobalCategories(categories);
      let draft: Estimate | null = null;
      try {
        const text = localStorage.getItem('agent-ledger-draft-v1');
        if (text) {
          const parsed = migrateDraft(JSON.parse(text));
          await api<Results>('/calculate', parsed);
          draft = parsed;
        }
      } catch {
        setNotice(
          'The previous browser draft could not be restored. Saved estimates are available in Open estimate.',
        );
      }
      setEstimate(draft || startingEstimate);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  }
  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    if (!estimate) return;
    setCalculating(true);
    setResult(null);
    setCalcError('');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<Results>('/calculate', estimate, controller.signal)
        .then(setResult)
        .catch((e) => {
          if (e.name !== 'AbortError') setCalcError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setCalculating(false);
        });
      try {
        localStorage.setItem('agent-ledger-draft-v1', JSON.stringify(estimate));
      } catch {
        setNotice('Browser draft storage is unavailable. Use Save estimate to preserve your work.');
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [estimate]);

  function update(mutator: (next: Estimate) => void) {
    setEstimate((previous) => {
      if (!previous) return previous;
      const next = clone(previous);
      mutator(next);
      return withSnapshots(next, available);
    });
    setIsSaved(false);
    setError('');
  }
  async function customizeOne(draft: AgentRow, memberId?: string) {
    const base = estimateRef.current;
    if (!base) throw new Error('The estimate is still loading.');
    const split = await api<{ estimate: Estimate; individual_id: string }>('/agents/split', {
      estimate: base,
      row_id: draft.id,
      individual: draft,
      member_id: memberId,
    });
    if (estimateRef.current !== base)
      throw new Error('The estimate changed. Review the group and try again.');
    setUndo(clone(base));
    setEstimate(split.estimate);
    setIsSaved(false);
    setEditing(split.estimate.agents.find((row) => row.id === split.individual_id) || null);
    setNotice(
      'One agent is now independent. Group count, invocation links, and total workload are preserved until you change its assumptions.',
    );
    return split.individual_id;
  }
  function openInventoryAgent(row: AgentRow, memberId: string) {
    if (row.count === 1) {
      setEditingMemberId(null);
      setEditing(clone(row));
      return;
    }
    const member = row.members.find((item) => item.id === memberId);
    if (!member) return;
    setEditingMemberId(memberId);
    setEditing({
      ...clone(row),
      name: member.name,
      use_case_description: member.business_use_case_description,
      members: [clone(member)],
      count: 1,
    });
  }
  function startNewAgent() {
    const current = estimateRef.current;
    const profile = current?.profiles.simple;
    if (!profile) return;
    const name = uniqueAgentName('New agent', current);
    setEditing({
      id: id(),
      name,
      description: '',
      use_case_name: '',
      use_case_description: '',
      members: [{ id: id(), name, business_use_case_description: pendingUseCase }],
      complexity: 'simple',
      count: 1,
      invocations: '0',
      volume_source: 'daily_users',
      prior_volume_source: null,
      users_per_day: '0',
      invocations_per_user_per_agent_per_day: '0',
      overrides: {},
      tool_costs: [],
      steps: [
        {
          ...clone(profile),
          model_id: '',
          id: id(),
          name: 'Main step',
          complexity: 'simple',
          execution_probability: '1',
          model_calls: [],
        },
      ],
    });
  }
  function copyAgent(row: AgentRow) {
    const base = estimateRef.current;
    if (!base) return;
    const copyName = uniqueAgentName(`${row.members[0]?.name || row.name} (copy)`, base);
    const copy = {
      ...clone(row),
      id: id(),
      name: copyName,
      members: [
        {
          id: id(),
          name: copyName,
          business_use_case_description: row.members[0]?.business_use_case_description || pendingUseCase,
        },
      ],
      count: 1,
      volume_source: 'daily_users' as const,
      prior_volume_source: null,
      users_per_day: '0',
      invocations_per_user_per_agent_per_day: '0',
      steps: row.steps.map((step) => ({
        ...clone(step),
        id: id(),
        model_calls: step.model_calls.map((call) => ({ ...clone(call), id: id() })),
      })),
      tool_costs: row.tool_costs.map((tool) => ({ ...clone(tool), id: id() })),
    };
    const stepIds = new Map(row.steps.map((step, index) => [step.id, copy.steps[index].id]));
    copy.tool_costs = copy.tool_costs.map((tool) => ({
      ...tool,
      step_id: tool.step_id ? stepIds.get(tool.step_id) || null : null,
    }));
    setUndo(clone(base));
    update((next) => {
      next.agents.push(copy);
      next.links.push(
        ...base.links
          .filter((link) => link.parent_id === row.id)
          .map((link) => ({
            ...clone(link),
            id: id(),
            parent_id: copy.id,
            step_id: link.step_id ? stepIds.get(link.step_id) || null : null,
          })),
      );
    });
    setEditing(copy);
    setNotice(
      'Copied agent starts with zero direct use cases. Attach it or enter usage to include it in the budget.',
    );
  }
  async function perform(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }
  async function save() {
    if (!estimate) return;
    const saving = estimate;
    await perform('Saving', async () => {
      await api('/estimates', saving);
      setSaved(await api('/estimates'));
      if (estimateRef.current === saving) {
        setIsSaved(true);
        setNotice('Estimate and pricing snapshot saved on this computer.');
      } else {
        setIsSaved(false);
        setNotice('An earlier draft was saved. Your recent edits still need to be saved.');
      }
    });
  }
  async function exportWorkbook() {
    await perform('Exporting', async () => {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(estimate),
      });
      if (!response.ok) throw new Error('Export failed. Correct any invalid inputs and try again.');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${estimate?.name.replace(/[^a-z0-9-]/gi, '-').slice(0, 70) || 'agent-suite'}-budget.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Excel workbook exported with assumptions and pricing snapshot.');
    });
  }
  function exportJson() {
    if (!estimate) return;
    const blob = new Blob([JSON.stringify(estimate, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${estimate.name.replace(/[^a-z0-9-]/gi, '-').slice(0, 70) || 'agent-suite'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importJson(file: File) {
    await perform('Reading JSON', async () => {
      if (file.size > 6_000_000) throw new Error('JSON estimate must be smaller than 6 MB.');
      const parsed = migrateDraft(JSON.parse(await file.text()));
      await api<Results>('/calculate', parsed);
      setUndo(clone(estimate!));
      setEstimate(parsed);
      setIsSaved(false);
      setNotice('JSON estimate loaded with its saved pricing snapshot. Undo restores your previous draft.');
    });
  }
  async function previewImport(file: File) {
    await perform('Reading spreadsheet', async () => {
      const response = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail);
      if (!data.errors.length) {
        let checked = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const base = estimateRef.current;
          if (!base) throw new Error('The current estimate is unavailable. Try the import again.');
          const proposed = clone(base);
          proposed.agents = data.agents;
          proposed.links = [];
          let validationError = '';
          try {
            await api('/calculate', proposed);
          } catch (e) {
            validationError = e instanceof Error ? e.message : String(e);
          }
          if (estimateRef.current !== base) continue;
          if (validationError) data.errors = [validationError];
          checked = true;
          break;
        }
        if (!checked) throw new Error('The estimate changed during import preview. Try the import again.');
      }
      setImported(data);
      setModal('import');
    });
  }
  if (!estimate || !defaults || !catalog)
    return (
      <div className="loading-screen">
        <Blocks size={40} />
        <h1>Agent Ledger</h1>
        <p>{error || 'Preparing your workspace…'}</p>
        {error && <button onClick={initialize}>Try again</button>}
      </div>
    );

  const expected = result?.scenarios.find((s) => s.name === 'Expected');
  const incompleteDetails =
    expected?.lines.flatMap((line) =>
      line.issues.map((issue) => `${line.name} (${line.model_id || 'no model'}): ${issue}`),
    ) || [];
  const totalAgents = estimate.agents.reduce((sum, r) => sum + r.count, 0);
  const missingDaily = estimate.agents.filter(
    (r) =>
      r.volume_source === 'daily_users' &&
      (r.users_per_day === null || r.invocations_per_user_per_agent_per_day === null),
  );
  const rowResults = (rowId: string) => expected?.lines.filter((l) => l.row_id === rowId) || [];
  const rowCost = (rowId: string) => rowResults(rowId).reduce((sum, l) => sum + Number(l.cost || 0), 0);
  const filteredRows = estimate.agents.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
  const title = {
    suite: 'Your agent suite, budgeted.',
    inventory: 'Know every agent in your suite.',
    graph: 'Build your agent suite graph.',
    profiles: 'Make complexity concrete.',
    scenarios: 'Explore the what-ifs.',
    pricing: 'Know the price behind the plan.',
    harness: 'Budget the shared agent runtime.',
    extras: 'Account for the whole picture.',
  }[tab];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab('suite');
          }}
        >
          <span className="brand-icon">
            <Blocks size={24} />
          </span>
          <span>
            Agent<span className="brand-light">Ledger</span>
            <small>ARCHITECT WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-label">PLANNING</div>
        <nav aria-label="Main navigation">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'nav-item active' : 'nav-item'}
              aria-label={t.label}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={18} />
              {t.label}
              {t.id === 'suite' && <span className="nav-count">{totalAgents}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <button className="nav-item" onClick={() => setModal('saved')}>
          <FolderOpen size={18} />
          Open estimate<span className="nav-count">{saved.length}</span>
        </button>
        <button
          className="nav-item"
          onClick={() => {
            setUndo(clone(estimate));
            setEstimate({ ...clone(defaults), id: id() });
            setIsSaved(false);
            setTab('suite');
            setNotice('New estimate started. Undo restores the previous draft.');
          }}
        >
          <Plus size={18} />
          New estimate
        </button>
        <div className="sidebar-bottom">
          <div className="local-tag">
            <span />
            LOCAL WORKSPACE
          </div>
          <p>
            Your estimates stay on
            <br />
            this computer.
          </p>
          <div className="profile-avatar">
            AI
            <span>
              AI architect<small>Personal workspace</small>
            </span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace
            <ChevronRight size={14} />
            <span>{tabs.find((t) => t.id === tab)?.label}</span>
          </div>
          <div className="topbar-actions">
            <span className="save-status">
              {calculating ? <LoaderCircle size={13} className="spin" /> : <span className="status-dot" />}
              {calculating ? 'Calculating' : isSaved ? 'Saved locally' : 'Browser draft'}
            </span>
            <button
              className="button subtle"
              onClick={save}
              disabled={!!busy || !!calcError || !!missingDaily.length}
            >
              <Save size={15} />
              Save estimate
            </button>
            <button
              className="button dark"
              onClick={exportWorkbook}
              disabled={!!busy || !result || !!missingDaily.length}
            >
              <ArrowDownToLine size={16} />
              Export Excel
            </button>
          </div>
        </header>

        <main className={tab === 'graph' ? 'graph-page' : undefined}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                LLM COST PLANNER <span>USD</span>
              </div>
              <h1>{title}</h1>
              <p>
                {tab === 'graph'
                  ? 'Create agents, configure their work, and connect the calls between them.'
                  : tab === 'inventory'
                    ? 'Review and edit one agent at a time, including its use case, steps, and daily workload.'
                    : 'Turn execution assumptions into a customer-ready spending estimate.'}
              </p>
            </div>
            <div className="estimate-name">
              <Field label="Estimate name">
                <input
                  value={estimate.name}
                  onChange={(e) =>
                    update((n) => {
                      n.name = e.target.value;
                    })
                  }
                />
              </Field>
            </div>
          </div>
          {(error || calcError) && (
            <div className="alert error" role="alert">
              {error || calcError}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert notice" role="status">
              <Check size={16} />
              {notice}
              <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {undo && (
            <div className="undo-row">
              <button
                onClick={() => {
                  setEstimate(undo);
                  setUndo(null);
                  setIsSaved(false);
                  setNotice('Previous state restored.');
                }}
              >
                <RotateCcw size={14} />
                Undo last replacement / reset
              </button>
            </div>
          )}

          <section className="scenario-cards" aria-label="Monthly LLM scenarios">
            {(['Low', 'Expected', 'High'] as const).map((name) => {
              const data = result?.scenarios.find((s) => s.name === name);
              const scenario = estimate.scenarios.find((s) => s.name === name)!;
              return (
                <article key={name} className={`scenario-card ${name === 'Expected' ? 'featured' : ''}`}>
                  <div className="card-top">
                    <span>
                      {name === 'Expected' ? 'EXPECTED MONTHLY SPEND' : `${name.toUpperCase()} SCENARIO`}
                    </span>
                    {name === 'Expected' ? (
                      <span className="baseline-pill">BASELINE</span>
                    ) : (
                      <ArrowUpRight size={17} />
                    )}
                  </div>
                  <div className="cost-value" data-testid={`cost-${name.toLowerCase()}`}>
                    {data
                      ? !data.complete && Number(data.llm_cost) === 0
                        ? 'Incomplete'
                        : money(data.llm_cost)
                      : '—'}
                    {data && (data.complete || Number(data.llm_cost) !== 0) && <span>/mo</span>}
                  </div>
                  <p>
                    {data && !data.complete ? (
                      <span className="incomplete">Incomplete · known LLM costs only</span>
                    ) : (
                      `Input ${scenario.input_factor}× · Output ${scenario.output_factor}× · Volume ${scenario.volume_factor}×`
                    )}
                  </p>
                  {data && (
                    <p>
                      Suite total (models + tools + harness + extras):{' '}
                      <strong>{costLabel(data.monthly_total, data.complete)}</strong>
                    </p>
                  )}
                  <div className="card-bottom">
                    <span>
                      {name === 'Expected'
                        ? `${totalAgents} agents in your suite`
                        : 'Explicit, editable assumptions'}
                    </span>
                    <button onClick={() => setTab('scenarios')} aria-label={`Edit ${name} scenario`}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </section>

          {incompleteDetails.length > 0 && (
            <div className="alert warning" role="alert">
              <CircleHelp size={16} />
              <div>
                <strong>Expected monthly LLM estimate is incomplete.</strong>
                <ul className="pricing-issues">
                  {incompleteDetails.slice(0, 3).map((detail, index) => (
                    <li key={`${detail}-${index}`}>{detail}</li>
                  ))}
                </ul>
                {incompleteDetails.length > 3 && (
                  <span>And {incompleteDetails.length - 3} more pricing issues.</span>
                )}
                {incompleteDetails.some((detail) => detail.includes('Missing cache write price.')) && (
                  <span className="block">
                    Set cache write fraction to 0 only if there are no cache writes. Otherwise, add a custom
                    model with the applicable cache-write rate.
                  </span>
                )}
              </div>
            </div>
          )}

          {result?.warnings.map((w) => (
            <div className="alert warning" key={w}>
              <CircleHelp size={16} />
              {w}
            </div>
          ))}

          {tab === 'inventory' && (
            <AgentInventory
              estimate={estimate}
              expected={expected}
              onEdit={openInventoryAgent}
              onAdd={startNewAgent}
              busy={!!busy}
            />
          )}

          {tab === 'suite' && (
            <div className="suite-workspace">
              <section className="panel suite-panel">
                <div className="section-heading">
                  <div>
                    <h2>
                      Agent inventory <span className="count-chip">{totalAgents} agents</span>
                    </h2>
                    <p>Group similar agents. Refine the exceptions.</p>
                  </div>
                  <div className="button-row">
                    <a className="button subtle" href="/api/import/template">
                      <FileSpreadsheet size={15} />
                      Template
                    </a>
                    <button className="button subtle" onClick={exportJson}>
                      Export JSON
                    </button>
                    <button className="button subtle" onClick={() => jsonFileRef.current?.click()}>
                      Import JSON
                    </button>
                    <button className="button subtle" onClick={() => fileRef.current?.click()}>
                      <Upload size={15} />
                      Import
                    </button>
                    <button className="button dark" onClick={() => setModal('quick')}>
                      <Plus size={16} />
                      Quick setup
                    </button>
                  </div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  aria-label="Import agent spreadsheet"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void previewImport(file);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={jsonFileRef}
                  type="file"
                  accept=".json,application/json"
                  aria-label="Import JSON estimate"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importJson(file);
                    e.target.value = '';
                  }}
                />
                {estimate.agents.length > 0 ? (
                  <>
                    <div className="inventory-toolbar">
                      <input
                        className="search-input"
                        aria-label="Search agents"
                        placeholder="Search agents…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <span>Invocations include calls from other agents.</span>
                      <button
                        className="text-button"
                        onClick={() =>
                          setEditing({
                            id: id(),
                            name: uniqueAgentName('New agent group', estimate),
                            description: '',
                            use_case_name: '',
                            use_case_description: '',
                            members: [
                              {
                                id: id(),
                                name: uniqueAgentName('New agent group', estimate),
                                business_use_case_description: pendingUseCase,
                              },
                            ],
                            complexity: 'simple',
                            count: 1,
                            invocations: '0',
                            volume_source: 'daily_users',
                            prior_volume_source: null,
                            users_per_day: null,
                            invocations_per_user_per_agent_per_day: null,
                            overrides: {},
                            steps: [],
                            tool_costs: [],
                          })
                        }
                      >
                        <Plus size={14} />
                        Add group
                      </button>
                    </div>
                    <p className="volume-note">
                      * Required for direct daily-volume groups. Their monthly invocations per agent = users
                      per day × invocations per user per agent per day × 30 days. Derived groups receive work
                      from agent links; their total is pooled across the group count.
                    </p>
                    {missingDaily.length > 0 && (
                      <p className="volume-note invalid-text" role="alert">
                        Complete both required daily inputs for {missingDaily.length} group
                        {missingDaily.length === 1 ? '' : 's'} before saving or exporting.
                      </p>
                    )}
                    <div className="table-scroll">
                      <table className="agent-table">
                        <thead>
                          <tr>
                            <th>AGENT / GROUP</th>
                            <th>COUNT</th>
                            <th>USERS / AGENT / DAY *</th>
                            <th>INVOCATIONS / USER / AGENT / DAY *</th>
                            <th>MONTHLY INVOCATIONS</th>
                            <th>MODEL</th>
                            <th>LLM / MONTH</th>
                            <th>
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRows.map((row) => {
                            const execution = effective(estimate, row);
                            const lines = rowResults(row.id);
                            const incomplete = lines.some((l) => l.issues.length > 0);
                            return (
                              <tr key={row.id}>
                                <td>
                                  <button className="row-name" onClick={() => setEditing(clone(row))}>
                                    {row.name}
                                  </button>
                                  <div className="row-meta">
                                    <span className={`complexity ${categoryClass(row.complexity)}`}>
                                      {row.complexity}
                                    </span>
                                    {row.steps.length > 0 ? (
                                      <small>{row.steps.length} detailed steps</small>
                                    ) : (
                                      Object.values(row.overrides).some((v) => v != null) && (
                                        <small>Customized</small>
                                      )
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min={row.volume_source === 'derived' ? 1 : 0}
                                    step={1}
                                    aria-label={`${row.name} count`}
                                    value={row.count}
                                    onFocus={(e) => e.currentTarget.select()}
                                    onChange={(e) =>
                                      update((n) => {
                                        const target = n.agents.find((r) => r.id === row.id)!;
                                        const count = Number(e.target.value);
                                        target.members = resizeMembers(target, count);
                                        target.count = count;
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    required
                                    disabled={row.volume_source === 'derived'}
                                    aria-label={`${row.name} users per day`}
                                    value={
                                      row.volume_source === 'daily_users' ? (row.users_per_day ?? '') : ''
                                    }
                                    placeholder={row.volume_source === 'derived' ? 'From links' : 'Required'}
                                    onFocus={(e) => e.currentTarget.select()}
                                    onChange={(e) =>
                                      update((n) => {
                                        const target = n.agents.find((r) => r.id === row.id)!;
                                        target.volume_source = 'daily_users';
                                        target.users_per_day = e.target.value || null;
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    required
                                    disabled={row.volume_source === 'derived'}
                                    aria-label={`${row.name} invocations per user per agent per day`}
                                    value={
                                      row.volume_source === 'daily_users'
                                        ? (row.invocations_per_user_per_agent_per_day ?? '')
                                        : ''
                                    }
                                    placeholder={row.volume_source === 'derived' ? 'From links' : 'Required'}
                                    onFocus={(e) => e.currentTarget.select()}
                                    onChange={(e) =>
                                      update((n) => {
                                        const target = n.agents.find((r) => r.id === row.id)!;
                                        target.volume_source = 'daily_users';
                                        target.invocations_per_user_per_agent_per_day =
                                          e.target.value || null;
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <div className="derived-volume">
                                    <span>
                                      Per agent:{' '}
                                      <output
                                        title={lines[0]?.base_invocations}
                                        aria-label={`${row.name} total monthly invocations per agent`}
                                      >
                                        {lines.length &&
                                        (row.volume_source === 'manual' ||
                                          row.volume_source === 'derived' ||
                                          (row.users_per_day !== null &&
                                            row.invocations_per_user_per_agent_per_day !== null))
                                          ? displayVolume(lines[0].base_invocations)
                                          : '—'}
                                      </output>
                                    </span>
                                    <span>
                                      All agents:{' '}
                                      <output
                                        title={lines[0]?.base_total_invocations}
                                        aria-label={`${row.name} total monthly invocations all agents`}
                                        className="total-volume"
                                      >
                                        {lines.length &&
                                        (row.volume_source === 'manual' ||
                                          row.volume_source === 'derived' ||
                                          (row.users_per_day !== null &&
                                            row.invocations_per_user_per_agent_per_day !== null))
                                          ? displayVolume(lines[0].base_total_invocations)
                                          : '—'}
                                      </output>
                                    </span>
                                    {row.volume_source === 'manual' && (
                                      <small title="Enter both required daily inputs to convert this saved manual volume.">
                                        Legacy manual volume
                                      </small>
                                    )}
                                    {row.volume_source === 'derived' && (
                                      <small>Derived from agent links</small>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <button
                                    className="text-button"
                                    aria-label={`Copy ${row.name}`}
                                    onClick={() => copyAgent(row)}
                                  >
                                    Copy
                                  </button>
                                  <button
                                    className={`inline-model ${!execution.model_id && !row.steps.length ? 'unselected' : ''}`}
                                    onClick={() => setEditing(clone(row))}
                                  >
                                    {row.steps.length
                                      ? 'Multiple steps'
                                      : execution.model_id || 'Choose a model'}
                                    <ChevronRight size={12} />
                                  </button>
                                </td>
                                <td className="cost-cell">
                                  {expected
                                    ? incomplete && rowCost(row.id) === 0
                                      ? 'Incomplete'
                                      : money(rowCost(row.id))
                                    : '—'}
                                  {incomplete && (
                                    <span
                                      className="row-warning"
                                      title={lines.flatMap((l) => l.issues).join(' ')}
                                    >
                                      Incomplete
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="icon-button"
                                    aria-label={`Edit ${row.name}`}
                                    onClick={() => setEditing(clone(row))}
                                  >
                                    <Settings2 size={16} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {filteredRows.length === 0 && <p className="empty-inline">No matching agents.</p>}
                    <div className="category-volume-grid" aria-label="Monthly invocations by complexity">
                      {categoryKeys.map((complexity) => {
                        const volume = result?.category_invocations[complexity];
                        const tokens = result?.category_tokens[complexity];
                        return (
                          <div key={complexity}>
                            <span>{complexity === 'high' ? 'High (complex)' : complexity} agents</span>
                            <strong data-testid={`category-invocations-${complexity}`}>
                              {volume ? quantityLabel(volume.total, volume.complete) : '—'}
                            </strong>
                            <small>invocations/month · all agents</small>
                            <dl className="category-token-list">
                              <div>
                                <dt>Tokens/day</dt>
                                <dd data-testid={`category-tokens-daily-${complexity}`}>
                                  {tokens ? quantityLabel(tokens.daily_total, tokens.complete) : '—'}
                                </dd>
                              </div>
                              <div>
                                <dt>Tokens/month</dt>
                                <dd
                                  data-testid={`category-tokens-monthly-${complexity}`}
                                  title={
                                    tokens
                                      ? `Input ${tokens.monthly_input} + output ${tokens.monthly_output}`
                                      : undefined
                                  }
                                >
                                  {tokens ? quantityLabel(tokens.monthly_total, tokens.complete) : '—'}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        );
                      })}
                    </div>
                    <p className="category-token-note">
                      Tokens are Expected-scenario input + output usage, including additional attempts. Daily
                      values average the 30-day planning month.
                    </p>
                    <section className="monthly-category-summary" aria-label="Monthly token and cost summary">
                      <h3>Monthly token and cost summary</h3>
                      <p>Expected scenario · All agents in each category · USD</p>
                      <div className="monthly-summary-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Category</th>
                              <th scope="col">Input tokens</th>
                              <th scope="col">Input cost</th>
                              <th scope="col">Output tokens</th>
                              <th scope="col">Output cost</th>
                              <th scope="col">Total tokens</th>
                              <th scope="col">LLM cost total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {categoryKeys.map((complexity) => {
                              const tokens = result?.category_tokens[complexity];
                              const costs = result?.category_costs[complexity];
                              return (
                                <tr key={complexity}>
                                  <th scope="row">{complexity === 'high' ? 'High (complex)' : complexity}</th>
                                  <td data-testid={`monthly-summary-${complexity}-input-tokens`}>
                                    {tokens ? quantityLabel(tokens.monthly_input, tokens.complete) : '—'}
                                  </td>
                                  <td data-testid={`monthly-summary-${complexity}-input-cost`}>
                                    {costs
                                      ? costLabel(costs.monthly_input_cost, costs.input_complete, rateMoney)
                                      : '—'}
                                  </td>
                                  <td data-testid={`monthly-summary-${complexity}-output-tokens`}>
                                    {tokens ? quantityLabel(tokens.monthly_output, tokens.complete) : '—'}
                                  </td>
                                  <td data-testid={`monthly-summary-${complexity}-output-cost`}>
                                    {costs
                                      ? costLabel(costs.monthly_output_cost, costs.output_complete, rateMoney)
                                      : '—'}
                                  </td>
                                  <td>
                                    {tokens ? quantityLabel(tokens.monthly_total, tokens.complete) : '—'}
                                  </td>
                                  <td data-testid={`monthly-summary-${complexity}-total-cost`}>
                                    {costs ? costLabel(costs.monthly_cost, costs.complete, rateMoney) : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                            {result && (
                              <tr className="monthly-summary-total">
                                <th scope="row">Suite total</th>
                                <td data-testid="monthly-summary-suite-input-tokens">
                                  {quantityLabel(
                                    result.monthly_token_summary.input_tokens,
                                    result.monthly_token_summary.tokens_complete,
                                  )}
                                </td>
                                <td data-testid="monthly-summary-suite-input-cost">
                                  {costLabel(
                                    result.monthly_token_summary.input_cost,
                                    result.monthly_token_summary.input_complete,
                                    rateMoney,
                                  )}
                                </td>
                                <td data-testid="monthly-summary-suite-output-tokens">
                                  {quantityLabel(
                                    result.monthly_token_summary.output_tokens,
                                    result.monthly_token_summary.tokens_complete,
                                  )}
                                </td>
                                <td data-testid="monthly-summary-suite-output-cost">
                                  {costLabel(
                                    result.monthly_token_summary.output_cost,
                                    result.monthly_token_summary.output_complete,
                                    rateMoney,
                                  )}
                                </td>
                                <td>
                                  {quantityLabel(
                                    result.monthly_token_summary.total_tokens,
                                    result.monthly_token_summary.tokens_complete,
                                  )}
                                </td>
                                <td data-testid="monthly-summary-suite-total-cost">
                                  {costLabel(
                                    result.monthly_token_summary.total_cost,
                                    result.monthly_token_summary.complete,
                                    rateMoney,
                                  )}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <p>
                        Input includes uncached input, cached reads, and cache writes. Output includes
                        billable reasoning.
                      </p>
                    </section>
                    <div className="category-cost-grid" aria-label="Token cost calculation by category">
                      {categoryKeys.map((complexity) => {
                        const breakdown = result?.category_costs[complexity];
                        const categoryTokens = result?.category_tokens[complexity];
                        return (
                          <details className="category-cost-detail" key={complexity}>
                            <summary>
                              <span>{complexity === 'high' ? 'High (complex)' : complexity} token cost</span>
                              <strong data-testid={`category-cost-${complexity}`}>
                                {breakdown ? costLabel(breakdown.monthly_cost, breakdown.complete) : '—'}
                              </strong>
                            </summary>
                            {breakdown && (
                              <div className="category-cost-content">
                                <div className="category-cost-scroll">
                                  <table className="category-type-table">
                                    <thead>
                                      <tr>
                                        <th scope="col">Token type</th>
                                        <th scope="col">Tokens/day</th>
                                        <th scope="col">Tokens/month</th>
                                        <th scope="col">USD/day</th>
                                        <th scope="col">USD/month</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {tokenTypes.map((tokenType) => {
                                        const type = breakdown.types[tokenType];
                                        return (
                                          <tr
                                            key={tokenType}
                                            data-testid={`category-type-${complexity}-${tokenType}`}
                                          >
                                            <th scope="row">{tokenTypeLabels[tokenType]}</th>
                                            <td title={type.daily_tokens}>
                                              {quantityLabel(
                                                type.daily_tokens,
                                                categoryTokens?.complete ?? false,
                                              )}
                                            </td>
                                            <td title={type.monthly_tokens}>
                                              {quantityLabel(
                                                type.monthly_tokens,
                                                categoryTokens?.complete ?? false,
                                              )}
                                            </td>
                                            <td title={type.daily_cost}>
                                              {costLabel(type.daily_cost, type.complete, rateMoney)}
                                            </td>
                                            <td title={type.monthly_cost}>
                                              {costLabel(type.monthly_cost, type.complete, rateMoney)}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                      <tr className="category-type-total">
                                        <th scope="row">Total</th>
                                        <td>
                                          {categoryTokens
                                            ? quantityLabel(
                                                categoryTokens.daily_total,
                                                categoryTokens.complete,
                                              )
                                            : '—'}
                                        </td>
                                        <td>
                                          {categoryTokens
                                            ? quantityLabel(
                                                categoryTokens.monthly_total,
                                                categoryTokens.complete,
                                              )
                                            : '—'}
                                        </td>
                                        <td data-testid={`category-cost-daily-${complexity}`}>
                                          {costLabel(breakdown.daily_cost, breakdown.complete, rateMoney)}
                                        </td>
                                        <td>
                                          {costLabel(breakdown.monthly_cost, breakdown.complete, rateMoney)}
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                                {breakdown.entries.length ? (
                                  <div className="category-cost-scroll model-cost-section">
                                    <h4>Model rates and monthly calculation</h4>
                                    <table className="model-cost-table">
                                      <thead>
                                        <tr>
                                          <th scope="col">Token type</th>
                                          <th scope="col">Model</th>
                                          <th scope="col">Tokens/month</th>
                                          <th scope="col">USD/1M</th>
                                          <th scope="col">Cost/month</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {breakdown.entries.map((entry, i) => (
                                          <tr key={`${entry.token_type}-${entry.model_id}-${i}`}>
                                            <th scope="row">{tokenTypeLabels[entry.token_type]}</th>
                                            <td>{entry.model_id || 'Unselected'}</td>
                                            <td title={entry.monthly_tokens}>
                                              {displayVolume(entry.monthly_tokens)}
                                            </td>
                                            <td>
                                              {entry.rate_per_million === null
                                                ? 'Missing'
                                                : rateMoney(entry.rate_per_million)}
                                            </td>
                                            <td title={entry.issues.join(' ')}>
                                              {costLabel(entry.monthly_cost, entry.complete, rateMoney)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <p>
                                    {breakdown.complete
                                      ? 'No tokens in this category.'
                                      : 'Token usage is incomplete for this category.'}
                                  </p>
                                )}
                                <p>
                                  Each cost = tokens × model rate / 1,000,000. Rates reflect the selected
                                  per-call pricing tier. Incomplete costs include only fully priced agent
                                  lines; token counts include all supplied volume.
                                </p>
                              </div>
                            )}
                          </details>
                        );
                      })}
                    </div>
                    <div className="table-footer">
                      <span>Expected scenario · LLM costs only</span>
                      <strong>
                        Suite total{' '}
                        <span>
                          {expected && !expected.complete && Number(expected.llm_cost) === 0
                            ? 'Incomplete'
                            : expected
                              ? money(expected.llm_cost)
                              : '—'}
                          {expected && !expected.complete && Number(expected.llm_cost) !== 0
                            ? ' (partial)'
                            : ''}
                        </span>
                      </strong>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <Blocks size={30} />
                    </div>
                    <h3>Start with your agent suite</h3>
                    <p>
                      Enter a count and distribute it across three complexity profiles.
                      <br />
                      You can customize every assumption along the way.
                    </p>
                    <button className="button dark" onClick={() => setModal('quick')}>
                      <Plus size={16} />
                      Set up your agents
                    </button>
                  </div>
                )}
              </section>
              {expected && estimate.agents.length > 0 && (
                <section className="panel" aria-label="Cost per completed use case">
                  <div className="section-heading">
                    <div>
                      <h2>Cost per completed use case</h2>
                      <p>
                        One agent invocation completes one use case. Loaded cost includes expected child work
                        {estimate.harness.include_in_cost_per_use_case ? ' and allocated harness' : ''}.
                      </p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="agent-table">
                      <thead>
                        <tr>
                          <th>AGENT</th>
                          <th>USE CASE</th>
                          <th>COMPLETIONS / MONTH</th>
                          <th>DIRECT / COMPLETION</th>
                          <th>HARNESS / COMPLETION</th>
                          <th>LOADED / COMPLETION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimate.agents.map((row) => {
                          const item = expected.use_case_costs[row.id];
                          return (
                            <tr key={row.id}>
                              <td>{row.name}</td>
                              <td>{item?.name}</td>
                              <td>{item ? displayVolume(item.monthly_invocations) : '—'}</td>
                              <td>{item ? money(item.direct_cost_per_completion) : '—'}</td>
                              <td>{item ? money(item.harness_per_completion) : '—'}</td>
                              <td>
                                {item ? costLabel(item.loaded_cost_per_completion, item.complete) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {expected && expected.vendor_costs.length > 0 && (
                <section className="panel" aria-label="Vendor spend breakdown">
                  <div className="section-heading">
                    <div>
                      <h2>Model spend by vendor</h2>
                      <p>
                        Expected monthly model cost from the saved price snapshot, including any entered
                        currency conversion.
                      </p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="agent-table">
                      <thead>
                        <tr>
                          <th>VENDOR</th>
                          <th>SOURCE</th>
                          <th>CHANNEL</th>
                          <th>MONTHLY MODEL COST</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expected.vendor_costs.map((entry, index) => (
                          <tr key={`${entry.provider}-${entry.channel}-${index}`}>
                            <td>{entry.provider}</td>
                            <td>{entry.source_type.replaceAll('_', ' ')}</td>
                            <td>{entry.channel || '—'}</td>
                            <td>{costLabel(entry.monthly_cost, entry.complete)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              <CostImpact estimate={estimate} result={result} />
              <section className="panel assumption-note">
                <div className="section-heading">
                  <div>
                    <h2>A budget you can explain</h2>
                    <p>Transparent inputs. Repeatable estimates.</p>
                  </div>
                  <ShieldCheck size={20} />
                </div>
                <p>
                  Profiles are starting assumptions, not measured benchmarks. Review calls, context sizes and
                  retries for your architecture.
                </p>
                <div className="metric-line">
                  <span>Monthly input tokens</span>
                  <strong>{number(expected?.input_tokens || 0)}</strong>
                </div>
                <div className="metric-line">
                  <span>Monthly output tokens</span>
                  <strong>{number(expected?.output_tokens || 0)}</strong>
                </div>
                <button className="text-button" onClick={() => setTab('profiles')}>
                  Review complexity profiles <ArrowUpRight size={14} />
                </button>
              </section>
            </div>
          )}

          {tab === 'graph' && (
            <AgentGraph
              estimate={estimate}
              result={result}
              prices={available}
              selectedId={graphSelectedId}
              setSelectedId={setGraphSelectedId}
              agentDrafts={graphAgentDrafts}
              setAgentDrafts={setGraphAgentDrafts}
              onEditAgent={(row) => setEditing(clone(row))}
              onCustomize={(row) => customizeOne(clone(row))}
              onAddAgent={startNewAgent}
              onCopyAgent={copyAgent}
              onApply={(next, base, message) => {
                if (estimateRef.current !== base)
                  throw new Error('The estimate changed. Preview the link again.');
                setUndo(clone(base));
                setEstimate(next);
                setIsSaved(false);
                setNotice(message);
              }}
            />
          )}

          {tab === 'profiles' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Execution profiles</h2>
                  <p>Shared defaults for each complexity. Individual overrides take precedence.</p>
                </div>
                <div className="button-row">
                  <button
                    className="button subtle"
                    onClick={() => {
                      setCategoryName('');
                      setCategoryBase('simple');
                      setCategoryProfile(clone(estimate.profiles.simple));
                      setCategoryError('');
                      setModal('category');
                    }}
                  >
                    <Plus size={15} />
                    Add custom category
                  </button>
                  <button className="button subtle" onClick={() => setModal('reset')}>
                    <RotateCcw size={15} />
                    Reset parameters
                  </button>
                </div>
              </div>
              <div className="profile-grid">
                {categoryKeys.map((c) => (
                  <article className="profile-card" key={c}>
                    <div className="profile-title">
                      <span className={`complexity ${categoryClass(c)}`}>{c}</span>
                      <div className="profile-meta">
                        <span>
                          {estimate.agents
                            .filter((r) => r.complexity === c)
                            .reduce((sum, r) => sum + r.count, 0)}{' '}
                          agents
                        </span>
                        {!complexities.includes(c as (typeof complexities)[number]) && (
                          <button
                            className="text-button"
                            aria-label={`Delete ${c}`}
                            onClick={() => openDeleteCategory(c)}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <h3>{descriptions[c as keyof typeof descriptions] || 'Custom execution profile'}</h3>
                    <ExecutionFields
                      value={estimate.profiles[c]}
                      prices={available}
                      showModel={false}
                      onChange={(patch) =>
                        update((n) => {
                          Object.assign(n.profiles[c], patch);
                        })
                      }
                    />
                  </article>
                ))}
              </div>
              {globalCategories.some(
                (category) =>
                  !Object.keys(estimate.profiles).some(
                    (name) => name.toLowerCase() === category.name.toLowerCase(),
                  ),
              ) && (
                <div className="panel-footnote">
                  <CircleHelp size={16} />
                  <span>
                    Available globally for this estimate:{' '}
                    {globalCategories
                      .filter(
                        (category) =>
                          !Object.keys(estimate.profiles).some(
                            (name) => name.toLowerCase() === category.name.toLowerCase(),
                          ),
                      )
                      .map((category) => (
                        <span className="global-category-actions" key={category.name}>
                          <button
                            className="text-button"
                            disabled={categoryKeys.length >= 53}
                            onClick={() => {
                              update((next) => {
                                next.profiles[category.name] = clone(category.profile);
                              });
                              setNotice(`${category.name} is now available to agents in this estimate.`);
                            }}
                          >
                            Use {category.name}
                          </button>
                          <button className="text-button" onClick={() => openDeleteCategory(category.name)}>
                            Delete {category.name}
                          </button>
                        </span>
                      ))}
                  </span>
                </div>
              )}
              <div className="panel-footnote">
                <CircleHelp size={16} />
                Cache writes use the selected short-duration/base rate. Add cache storage charges separately.
                All output estimates include billable reasoning.
              </div>
            </section>
          )}

          {tab === 'scenarios' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Scenario assumptions</h2>
                  <p>
                    Multipliers apply to baseline execution inputs, including detailed steps. 1× means
                    unchanged.
                  </p>
                </div>
                <span className="tag">PLANNING RANGES</span>
              </div>
              <div className="scenario-editor-grid">
                {estimate.scenarios.map((scenario, i) => (
                  <article className="profile-card" key={scenario.name}>
                    <h3>{scenario.name}</h3>
                    <p className="muted small">
                      {scenario.name === 'Expected'
                        ? 'Your central planning case.'
                        : 'An explicit alternative to the baseline.'}
                    </p>
                    {(
                      [
                        ['volume_factor', 'Invocation volume ×'],
                        ['calls_factor', 'Calls per invocation ×'],
                        ['input_factor', 'Input tokens per call ×'],
                        ['output_factor', 'Output tokens per call ×'],
                        ['retry_factor', 'Additional attempts ×'],
                      ] as [keyof Scenario, string][]
                    ).map(([key, label]) => (
                      <Numeric
                        key={key}
                        label={label}
                        value={String(scenario[key])}
                        onChange={(value) =>
                          update((n) => {
                            Object.assign(n.scenarios[i], { [key]: value });
                          })
                        }
                      />
                    ))}
                    <ModelPicker
                      label="Model override (optional)"
                      value={scenario.model_id || ''}
                      prices={available}
                      onChange={(model_id) =>
                        update((n) => {
                          n.scenarios[i].model_id = model_id;
                        })
                      }
                    />
                    {scenario.model_id && (
                      <button
                        className="text-button"
                        onClick={() =>
                          update((n) => {
                            n.scenarios[i].model_id = null;
                          })
                        }
                      >
                        Use each agent's model
                      </button>
                    )}
                  </article>
                ))}
              </div>
              <div className="panel-footnote">
                <CircleHelp size={16} />
                Low/high are editable planning cases, not confidence intervals. Additional cost items remain
                fixed across scenarios.
              </div>
            </section>
          )}

          {tab === 'pricing' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Model pricing</h2>
                  <p>
                    {Object.keys(catalog.prices).length.toLocaleString()} catalog entries ·{' '}
                    {new Set(Object.values(catalog.prices).map((p) => p.provider)).size} providers
                  </p>
                </div>
                <div className="button-row">
                  <button
                    className="button subtle"
                    disabled={!!busy || !result}
                    onClick={() =>
                      perform('Refreshing catalog', async () => {
                        const fresh = await api<Catalog>('/catalog/refresh', {});
                        setCatalog(fresh);
                        for (let attempt = 0; attempt < 3; attempt++) {
                          const base = estimateRef.current;
                          if (!base) throw new Error('The current estimate is unavailable.');
                          const proposed = clone(base);
                          for (const [key, p] of Object.entries(proposed.prices))
                            if (!p.custom && fresh.prices[key]) proposed.prices[key] = fresh.prices[key];
                          const [before, after] = await Promise.all([
                            api<Results>('/calculate', base),
                            api<Results>('/calculate', proposed),
                          ]);
                          if (estimateRef.current !== base) continue;
                          setRefreshPreview({ base, before, estimate: proposed, result: after });
                          setModal('refresh');
                          return;
                        }
                        throw new Error('The estimate changed during price preview. Try refresh again.');
                      })
                    }
                  >
                    <RotateCcw size={15} />
                    Refresh catalog
                  </button>
                  <button className="button dark" onClick={() => setModal('custom')}>
                    <Plus size={15} />
                    Add custom rates
                  </button>
                </div>
              </div>
              <div className="pricing-explanation">
                <ShieldCheck size={22} />
                <div>
                  <strong>Your estimate keeps its own price snapshot.</strong>
                  <p>
                    Refreshing fetches the published LiteLLM catalog. You can review the impact before
                    applying new prices to this estimate. No customer inputs are sent.
                  </p>
                  <small>{catalog.scope}</small>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>MODEL SNAPSHOT</th>
                      <th>PROVIDER</th>
                      <th>INPUT / 1M</th>
                      <th>OUTPUT / 1M</th>
                      <th>CACHE READ / 1M</th>
                      <th>CACHE WRITE / 1M</th>
                      <th>SOURCE / DATE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(estimate.prices).map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.id}</strong>
                          {p.tiers.length > 0 && (
                            <small className="block">Context tiers applied per call</small>
                          )}
                          {p.unsupported.length > 0 && (
                            <small className="row-warning">Custom rates required</small>
                          )}
                        </td>
                        <td>{p.provider}</td>
                        <td>{p.input === null ? 'Unavailable' : rateMoney(p.input)}</td>
                        <td>{p.output === null ? 'Unavailable' : rateMoney(p.output)}</td>
                        <td>{p.cache_read === null ? 'Unavailable' : rateMoney(p.cache_read)}</td>
                        <td>{p.cache_write === null ? 'Unavailable' : rateMoney(p.cache_write)}</td>
                        <td>
                          <span className="source-label" title={p.source}>
                            {p.custom
                              ? 'Custom rates'
                              : p.source.startsWith('http')
                                ? 'Published LiteLLM catalog'
                                : p.source}
                          </span>
                          <small className="block">{new Date(p.retrieved_at).toLocaleDateString()}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Object.keys(estimate.prices).length === 0 && (
                <p className="empty-inline">
                  Select a model in a profile or agent to attach its price snapshot.
                </p>
              )}
              <div className="panel-footnote">
                Catalog loaded {new Date(catalog.retrieved_at).toLocaleString()}. Retrieval date is not the
                provider's price effective date.
              </div>
            </section>
          )}

          {tab === 'harness' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Shared agent harness</h2>
                  <p>
                    One suite-level cost entry for orchestration, runtime, hosting, and operations. Monthly
                    totals allocate by agent invocations.
                  </p>
                </div>
              </div>
              <div className="form-grid two">
                <Field label="Harness name">
                  <input
                    value={estimate.harness.name}
                    onChange={(e) =>
                      update((n) => {
                        n.harness.name = e.target.value;
                      })
                    }
                  />
                </Field>
                <Field label="Harness type">
                  <select
                    value={estimate.harness.harness_type}
                    onChange={(e) =>
                      update((n) => {
                        n.harness.harness_type = e.target.value as Estimate['harness']['harness_type'];
                      })
                    }
                  >
                    <option value="none">None (explicitly no cost)</option>
                    <option value="managed_platform">Managed platform</option>
                    <option value="self_built">Self-built</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </Field>
                <Numeric
                  label="Fixed platform fee (USD/month)"
                  value={estimate.harness.fixed_monthly}
                  onChange={(v) =>
                    update((n) => {
                      n.harness.fixed_monthly = v;
                    })
                  }
                />
                <Numeric
                  label="USD per agent invocation"
                  value={estimate.harness.per_invocation}
                  onChange={(v) =>
                    update((n) => {
                      n.harness.per_invocation = v;
                    })
                  }
                />
                <Numeric
                  label="USD per step execution"
                  value={estimate.harness.per_step_execution}
                  onChange={(v) =>
                    update((n) => {
                      n.harness.per_step_execution = v;
                    })
                  }
                />
                <Field label="Cost per completed use case">
                  <select
                    value={estimate.harness.include_in_cost_per_use_case ? 'include' : 'exclude'}
                    onChange={(e) =>
                      update((n) => {
                        n.harness.include_in_cost_per_use_case = e.target.value === 'include';
                      })
                    }
                  >
                    <option value="include">Include allocated harness</option>
                    <option value="exclude">Exclude harness</option>
                  </select>
                </Field>
              </div>
              <p className="muted small">
                The fixed fee remains in the suite total at zero volume. Allocation changes unit economics
                only.
              </p>
              <div className="totals-grid">
                <div>
                  <span>Monthly harness</span>
                  <strong>{expected ? money(expected.harness_cost) : '—'}</strong>
                </div>
                <div>
                  <span>Monthly invocations</span>
                  <strong>{expected ? number(expected.harness_drivers.invocations) : '—'}</strong>
                </div>
                <div>
                  <span>Monthly step executions</span>
                  <strong>{expected ? number(expected.harness_drivers.step_executions) : '—'}</strong>
                </div>
                <div>
                  <span>Suite total</span>
                  <strong>{expected ? costLabel(expected.monthly_total, expected.complete) : '—'}</strong>
                </div>
              </div>
            </section>
          )}

          {tab === 'extras' && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Additional cost items</h2>
                  <p>Track tools, infrastructure and services separately from LLM spending.</p>
                </div>
                <button
                  className="button dark"
                  onClick={() =>
                    update((n) => {
                      n.additional_costs.push({
                        id: id(),
                        name: 'Additional service',
                        amount: '0',
                        quantity: '1',
                        frequency: 'monthly',
                      });
                    })
                  }
                >
                  <Plus size={15} />
                  Add cost item
                </button>
              </div>
              {estimate.additional_costs.length ? (
                <div className="extras-list">
                  {estimate.additional_costs.map((cost, i) => (
                    <div className="extra-row" key={cost.id}>
                      <Field label="Cost item">
                        <input
                          value={cost.name}
                          onChange={(e) =>
                            update((n) => {
                              n.additional_costs[i].name = e.target.value;
                            })
                          }
                        />
                      </Field>
                      <Numeric
                        label="Unit cost (USD)"
                        value={cost.amount}
                        onChange={(v) =>
                          update((n) => {
                            n.additional_costs[i].amount = v;
                          })
                        }
                      />
                      <Numeric
                        label="Quantity"
                        value={cost.quantity}
                        onChange={(v) =>
                          update((n) => {
                            n.additional_costs[i].quantity = v;
                          })
                        }
                      />
                      <Field label="Frequency">
                        <select
                          value={cost.frequency}
                          onChange={(e) =>
                            update((n) => {
                              n.additional_costs[i].frequency = e.target.value as 'monthly' | 'one-time';
                            })
                          }
                        >
                          <option value="monthly">Monthly</option>
                          <option value="one-time">One-time</option>
                        </select>
                      </Field>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${cost.name}`}
                        onClick={() =>
                          update((n) => {
                            n.additional_costs.splice(i, 1);
                          })
                        }
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-inline">No additional costs yet.</div>
              )}
              <div className="totals-grid">
                <div>
                  <span>Monthly LLM</span>
                  <strong>{expected ? money(expected.llm_cost) : '—'}</strong>
                </div>
                <div>
                  <span>Monthly tools</span>
                  <strong>{expected ? money(expected.tool_cost) : '—'}</strong>
                </div>
                <div>
                  <span>Monthly harness</span>
                  <strong>{expected ? money(expected.harness_cost) : '—'}</strong>
                </div>
                <div>
                  <span>Additional monthly</span>
                  <strong>{money(result?.recurring || 0)}</strong>
                </div>
                <div>
                  <span>Total monthly suite</span>
                  <strong>{expected ? costLabel(expected.monthly_total, expected.complete) : '—'}</strong>
                </div>
                <div>
                  <span>First month, incl. one-time</span>
                  <strong>{expected ? money(expected.first_month) : '—'}</strong>
                </div>
                <div>
                  <span>First year</span>
                  <strong>{expected ? money(expected.annual_total) : '—'}</strong>
                </div>
              </div>
              <p className="panel-footnote">
                Expected scenario{expected && !expected.complete ? ' · Incomplete: known costs only' : ''}.
                First year assumes 12 identical months plus one-time items. No markup.
              </p>
            </section>
          )}

          <section className="notes-area">
            <Field label="Customer assumptions & notes">
              <textarea
                rows={2}
                value={estimate.notes}
                placeholder="Document scope, expected usage, exclusions or assumptions to include in the workbook…"
                onChange={(e) =>
                  update((n) => {
                    n.notes = e.target.value;
                  })
                }
              />
            </Field>
          </section>
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} />
              Local planning · No paid model calls
            </span>
            <span>Estimates are only as reliable as their assumptions.</span>
          </footer>
        </main>
      </div>

      {!!busy && (
        <div className="busy-toast" role="status">
          <LoaderCircle size={17} className="spin" />
          {busy}…
        </div>
      )}

      {modal === 'quick' && (
        <Modal title="Set up your agent suite" onClose={() => setModal(null)}>
          <p className="muted">
            Enter a total and classify your agents. This replaces the current inventory; profiles and prices
            stay intact.
          </p>
          <Numeric
            label="Total agent count"
            value={quick.total}
            integer
            onChange={(v) => setQuick({ ...quick, total: Number(v) })}
          />
          <div className="form-grid three">
            {complexities.map((c) => (
              <Numeric
                key={c}
                label={`${c[0].toUpperCase() + c.slice(1)} agents`}
                value={quick[c]}
                integer
                onChange={(v) => setQuick({ ...quick, [c]: Number(v) })}
              />
            ))}
          </div>
          <p
            className={
              quick.total === quick.simple + quick.medium + quick.high ? 'valid-text' : 'invalid-text'
            }
          >
            {quick.simple + quick.medium + quick.high} of {quick.total} agents assigned
          </p>
          {complexities.map((c) => (
            <div className="quick-volume-group" key={c}>
              <h3>{c[0].toUpperCase() + c.slice(1)} daily volume</h3>
              <div className="form-grid">
                <Numeric
                  label={`${c[0].toUpperCase() + c.slice(1)} users per agent per day *`}
                  value={quick.daily[c].users}
                  required={quick[c] > 0}
                  onChange={(users) =>
                    setQuick({
                      ...quick,
                      daily: { ...quick.daily, [c]: { ...quick.daily[c], users } },
                    })
                  }
                />
                <Numeric
                  label={`${c[0].toUpperCase() + c.slice(1)} invocations per user per agent per day *`}
                  value={quick.daily[c].perUser}
                  required={quick[c] > 0}
                  onChange={(perUser) =>
                    setQuick({
                      ...quick,
                      daily: { ...quick.daily, [c]: { ...quick.daily[c], perUser } },
                    })
                  }
                />
              </div>
            </div>
          ))}
          <p className="muted small">* Required for categories with agents. Zero is a valid value.</p>
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button dark"
              disabled={
                quick.total !== quick.simple + quick.medium + quick.high ||
                ![quick.total, quick.simple, quick.medium, quick.high].every(
                  (v) => Number.isInteger(v) && v >= 0 && v <= 100000,
                ) ||
                quick.total > 5000 ||
                complexities.some(
                  (c) =>
                    quick[c] > 0 &&
                    [quick.daily[c].users, quick.daily[c].perUser].some(
                      (value) => value === '' || !Number.isFinite(Number(value)) || Number(value) < 0,
                    ),
                )
              }
              onClick={() => {
                setUndo(clone(estimate));
                update((n) => {
                  n.agents = complexities.map((c) => ({
                    id: id(),
                    name: `${c[0].toUpperCase() + c.slice(1)} agents`,
                    description: '',
                    use_case_name: '',
                    use_case_description: '',
                    members: Array.from({ length: quick[c] }, (_, index) => ({
                      id: id(),
                      name: `${c[0].toUpperCase() + c.slice(1)} agent ${index + 1}`,
                      business_use_case_description: pendingUseCase,
                    })),
                    complexity: c,
                    count: quick[c],
                    invocations: '0',
                    volume_source: 'daily_users',
                    prior_volume_source: null,
                    users_per_day: quick[c] > 0 ? quick.daily[c].users : '0',
                    invocations_per_user_per_agent_per_day: quick[c] > 0 ? quick.daily[c].perUser : '0',
                    overrides: {},
                    steps: [],
                    tool_costs: [],
                  }));
                  n.links = [];
                });
                setModal(null);
                setTab('suite');
              }}
            >
              Create suite
            </button>
          </div>
        </Modal>
      )}

      {editing && (
        <AgentEditor
          key={editing.id}
          row={editing}
          estimate={estimate}
          prices={available}
          singleAgent={tab === 'inventory'}
          pendingGroupMember={Boolean(editingMemberId)}
          onClose={() => {
            setEditing(null);
            setEditingMemberId(null);
          }}
          onSave={async (row) => {
            if (editingMemberId) {
              const base = estimateRef.current;
              const source = base?.agents.find((item) => item.id === row.id);
              if (!base || !source || !source.members.some((item) => item.id === editingMemberId))
                throw new Error('The agent group changed. Reopen this agent and try again.');
              const individual = {
                ...clone(source),
                ...row,
                count: source.count,
                members: source.members.map((member) =>
                  member.id === editingMemberId ? clone(row.members[0]) : member,
                ),
              };
              const split = await api<{ estimate: Estimate; individual_id: string }>('/agents/split', {
                estimate: base,
                row_id: source.id,
                individual,
                member_id: editingMemberId,
              });
              if (estimateRef.current !== base)
                throw new Error('The estimate changed. Reopen this agent and try again.');
              withSnapshots(split.estimate, available);
              await api('/calculate', split.estimate);
              setUndo(clone(base));
              setEstimate(split.estimate);
              setIsSaved(false);
              setEditing(null);
              setEditingMemberId(null);
              return;
            }
            const next = clone(estimate);
            const index = next.agents.findIndex((r) => r.id === row.id);
            if (index >= 0) next.agents[index] = row;
            else next.agents.push(row);
            withSnapshots(next, available);
            await api('/calculate', next);
            setEstimate(next);
            setIsSaved(false);
            setEditing(null);
            setEditingMemberId(null);
          }}
          onRemove={() => {
            if (
              estimate.links.some((link) => link.parent_id === editing.id || link.child_id === editing.id)
            ) {
              setError('Remove this agent’s links before deleting the row.');
              return;
            }
            setUndo(clone(estimate));
            update((n) => {
              n.agents = n.agents.filter((r) => r.id !== editing.id);
            });
            setEditing(null);
          }}
          onSplit={async (draft) => {
            await customizeOne(draft);
          }}
        />
      )}

      {modal === 'category' && (
        <Modal title="Add custom complexity category" onClose={() => setModal(null)}>
          <p className="muted small">
            The new category is available throughout this local app. Its starter execution profile is copied
            into each estimate that uses it; edits to one estimate's profile stay with that estimate.
          </p>
          <div className="form-grid">
            <Field label="Custom category name">
              <input
                value={categoryName}
                maxLength={80}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="e.g. Research intensive"
              />
            </Field>
            <Field label="Start from category">
              <select
                value={categoryBase}
                onChange={(event) => {
                  setCategoryBase(event.target.value);
                  setCategoryProfile(clone(estimate.profiles[event.target.value]));
                }}
              >
                {categoryKeys.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {categoryProfile && (
            <ExecutionFields
              value={categoryProfile}
              prices={available}
              showModel={false}
              onChange={(patch) => setCategoryProfile({ ...categoryProfile, ...patch })}
            />
          )}
          {categoryError && (
            <p className="invalid-text" role="alert">
              {categoryError}
            </p>
          )}
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button dark"
              disabled={categoryBusy || !categoryName.trim()}
              onClick={async () => {
                const name = categoryName.trim();
                if (categoryKeys.some((category) => category.toLowerCase() === name.toLowerCase())) {
                  setCategoryError('Category names must be unique, ignoring case.');
                  return;
                }
                if (categoryKeys.length >= 53) {
                  setCategoryError('This estimate already has the maximum number of categories.');
                  return;
                }
                const base = estimateRef.current;
                const profile = categoryProfile;
                if (!base || !profile) {
                  setCategoryError('Choose an available category to copy.');
                  return;
                }
                setCategoryBusy(true);
                setCategoryError('');
                try {
                  const created = await api<GlobalCategory>('/categories', {
                    name,
                    profile: clone(profile),
                  });
                  setGlobalCategories((current) => [...current, created]);
                  setDefaults((current) => {
                    if (!current) return current;
                    const next = clone(current);
                    next.profiles[created.name] = clone(created.profile);
                    return withSnapshots(next, catalog?.prices || emptyPrices);
                  });
                  if (estimateRef.current === base)
                    update((next) => {
                      next.profiles[created.name] = clone(created.profile);
                    });
                  setModal(null);
                  setNotice(`${created.name} was created globally. Its assumptions can be edited here.`);
                } catch (cause) {
                  setCategoryError(cause instanceof Error ? cause.message : String(cause));
                } finally {
                  setCategoryBusy(false);
                }
              }}
            >
              Create category
            </button>
          </div>
        </Modal>
      )}

      {modal === 'deleteCategory' && deletingCategory && (
        <Modal title={`Delete ${deletingCategory}`} onClose={() => setModal(null)}>
          <p>
            {deletingGlobalCategory
              ? 'Delete this global starter from new estimates and remove its unused profile from this draft. Saved estimates keep their existing snapshots.'
              : 'Remove this historical custom profile from the current draft. Save the estimate to persist the change.'}
          </p>
          {deletingAssignments.length > 0 && (
            <p className="invalid-text" role="alert">
              Reassign these agents before deleting {deletingCategory}:{' '}
              {deletingAssignments.map((row) => `${row.name} (${row.count})`).join(', ')}.
            </p>
          )}
          {deleteCategoryError && (
            <p className="invalid-text" role="alert">
              {deleteCategoryError}
            </p>
          )}
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button dark"
              disabled={deleteCategoryBusy || deletingAssignments.length > 0}
              onClick={() => void deleteCustomCategory()}
            >
              Delete category
            </button>
          </div>
        </Modal>
      )}

      {modal === 'custom' && (
        <CustomPrice
          onClose={() => setModal(null)}
          onSave={(p) => {
            if (available[p.id])
              throw new Error(
                'This model ID already exists. Use a unique name for your custom rate snapshot.',
              );
            update((n) => {
              n.prices[p.id] = p;
            });
            setModal(null);
            setNotice(`Custom model ${p.id} added. Select it in a profile or agent.`);
          }}
        />
      )}

      {modal === 'saved' && (
        <Modal title="Saved estimates" onClose={() => setModal(null)}>
          <p className="muted">Opening replaces the current browser draft. Undo is available.</p>
          <div className="saved-list">
            {saved.length === 0 ? (
              <p>No saved estimates yet. Use Save estimate to create one.</p>
            ) : (
              saved.map((item) => (
                <button
                  key={item.id}
                  onClick={() =>
                    perform('Opening', async () => {
                      const next = await api<Estimate>(`/estimates/${encodeURIComponent(item.id)}`);
                      setUndo(clone(estimate));
                      setEstimate(next);
                      setIsSaved(true);
                      setModal(null);
                      setNotice('Saved estimate opened with its original pricing snapshot.');
                    })
                  }
                >
                  <FolderOpen size={20} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{new Date(item.updated).toLocaleString()}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            )}
          </div>
        </Modal>
      )}

      {modal === 'reset' && (
        <Modal title="Reset execution parameters" onClose={() => setModal(null)}>
          <p>
            Restore predefined and globally defined category profiles to their starter calls, token sizes,
            retry rates and cache assumptions. Model choices, agent names/counts, workload inputs, agent
            links, custom rates and additional costs are preserved.
          </p>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={clearOverrides}
              onChange={(e) => setClearOverrides(e.target.checked)}
            />
            Also clear individual execution overrides, detailed steps, scenario changes, and link scenario
            overrides
          </label>
          <p className="muted small">
            {clearOverrides
              ? `${estimate.agents.length} inventory rows will return to profile execution. Individual model overrides stay selected. Scenarios return to starter values.`
              : 'Individual execution and scenario overrides will remain in place.'}{' '}
            Undo is available after resetting.
          </p>
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button dark"
              onClick={() => {
                setUndo(clone(estimate));
                update((n) => {
                  for (const c of Object.keys(n.profiles)) {
                    const starter =
                      defaults.profiles[c] ||
                      globalCategories.find((category) => category.name === c)?.profile;
                    if (starter) n.profiles[c] = clone(starter);
                  }
                  if (clearOverrides) {
                    n.agents.forEach((r) => {
                      r.overrides = r.overrides.model_id != null ? { model_id: r.overrides.model_id } : {};
                      r.steps = [];
                    });
                    n.scenarios = clone(defaults.scenarios);
                    n.links.forEach((link) => {
                      link.low = { trigger_probability: null, invocations_per_trigger: null };
                      link.high = { trigger_probability: null, invocations_per_trigger: null };
                    });
                  }
                });
                setModal(null);
                setNotice('Execution parameters reset. Workload volumes and prices preserved.');
              }}
            >
              Reset parameters
            </button>
          </div>
        </Modal>
      )}

      {modal === 'import' && imported && (
        <Modal title="Review spreadsheet import" onClose={() => setModal(null)}>
          <p>
            This will replace the inventory with {imported.agents.length} rows (
            {imported.agents.reduce((sum, r) => sum + r.count, 0)} agents). Profiles, prices and scenarios
            stay intact. {estimate.links.length} agent link{estimate.links.length === 1 ? '' : 's'} will be
            removed.
          </p>
          {imported.errors.length > 0 ? (
            <div className="import-errors" role="alert">
              {imported.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
              <strong>No changes have been applied.</strong>
            </div>
          ) : (
            <div className="import-preview">
              {imported.agents.slice(0, 20).map((r) => (
                <p key={r.id}>
                  <strong>{r.name}</strong> · {r.count} {r.complexity} ·{' '}
                  {r.volume_source === 'daily_users'
                    ? `${r.users_per_day ?? 'missing'} users/day × ${r.invocations_per_user_per_agent_per_day ?? 'missing'} invocations/user/agent/day × 30 days`
                    : `${number(r.invocations)} legacy manual invocations/agent/mo`}
                </p>
              ))}
              {imported.agents.length > 20 && <p>And {imported.agents.length - 20} more rows…</p>}
            </div>
          )}
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="button dark"
              disabled={!!imported.errors.length || !!busy}
              onClick={() =>
                perform('Applying import', async () => {
                  const next = clone(estimate);
                  next.agents = imported.agents;
                  next.links = [];
                  withSnapshots(next, available);
                  await api('/calculate', next);
                  setUndo(clone(estimate));
                  setEstimate(next);
                  setIsSaved(false);
                  setModal(null);
                  setNotice('Spreadsheet imported. Unknown model IDs remain visibly unpriced.');
                })
              }
            >
              Replace inventory
            </button>
          </div>
        </Modal>
      )}

      {modal === 'refresh' && refreshPreview && (
        <Modal title="Review refreshed pricing" onClose={() => setModal(null)}>
          <p>
            The catalog has been refreshed. Applying it updates only matching catalog prices in this draft;
            custom prices and saved estimates stay unchanged.
          </p>
          <div className="refresh-comparison">
            {refreshPreview.result.scenarios.map((s) => (
              <div key={s.name}>
                <strong>{s.name}</strong>
                <span>
                  {money(refreshPreview.before.scenarios.find((old) => old.name === s.name)?.llm_cost || 0)} →{' '}
                  {money(s.llm_cost)}
                  {!s.complete ? ' (partial)' : ''}
                </span>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setModal(null)}>
              Keep current snapshot
            </button>
            <button
              className="button dark"
              onClick={() => {
                if (estimateRef.current !== refreshPreview.base) {
                  setModal(null);
                  setError(
                    'The estimate changed after the price preview. Refresh again to review current costs.',
                  );
                  return;
                }
                setUndo(clone(refreshPreview.base));
                setEstimate(refreshPreview.estimate);
                setIsSaved(false);
                setModal(null);
                setNotice('Refreshed prices applied to the draft. Save to update the stored estimate.');
              }}
            >
              Apply refreshed prices
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
