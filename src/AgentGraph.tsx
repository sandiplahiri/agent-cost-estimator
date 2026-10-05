import { Plus } from 'lucide-react';
import { distributionTotal, money, type AgentRow, type Estimate, type Results } from './types';

// Project individual identities and step options without splitting stored entries
// or calculating a separate workload/cost model.
export function AgentGraph({
  estimate,
  result,
  busy,
  onEditAgent,
  onEditShared,
  onAddAgent,
}: {
  estimate: Estimate;
  result: Results | null;
  busy: boolean;
  onEditAgent: (row: AgentRow, memberId: string) => void;
  onEditShared: (row: AgentRow) => void;
  onAddAgent: () => void;
}) {
  const nodes = estimate.agents.flatMap((row) => row.members.map((member) => ({ row, member })));
  const byId = new Map(nodes.map((node) => [node.member.id, node]));
  const relationships = new Map<
    string,
    { source: string; target: string; options: { step: string; selection: string; execution: string }[] }
  >();
  for (const { row, member } of nodes)
    for (const step of row.steps) {
      if (step.action_type !== 'agent') continue;
      for (const option of step.agent_calls) {
        if (!byId.has(option.child_agent_id)) continue;
        const key = JSON.stringify([member.id, option.child_agent_id]);
        const relationship = relationships.get(key) ?? {
          source: member.id,
          target: option.child_agent_id,
          options: [],
        };
        relationship.options.push({
          step: step.name,
          selection: distributionTotal([option.probability]).percent,
          execution: distributionTotal([step.execution_probability]).percent,
        });
        relationships.set(key, relationship);
      }
    }
  const edges = [...relationships.entries()];
  const degree = new Map(nodes.map(({ member }) => [member.id, 0]));
  const depth = new Map(nodes.map(({ member }) => [member.id, 0]));
  const children = new Map(nodes.map(({ member }) => [member.id, [] as string[]]));
  for (const [, edge] of edges) {
    degree.set(edge.target, degree.get(edge.target)! + 1);
    children.get(edge.source)!.push(edge.target);
  }
  const queue = nodes.filter(({ member }) => degree.get(member.id) === 0).map(({ member }) => member.id);
  for (let index = 0; index < queue.length; index++)
    for (const child of children.get(queue[index])!) {
      depth.set(child, Math.max(depth.get(child)!, depth.get(queue[index])! + 1));
      degree.set(child, degree.get(child)! - 1);
      if (degree.get(child) === 0) queue.push(child);
    }
  const layers = new Map<number, typeof nodes>();
  for (const node of nodes) {
    const column = depth.get(node.member.id)!;
    if (!layers.has(column)) layers.set(column, []);
    layers.get(column)!.push(node);
  }
  const position = new Map<string, { x: number; y: number }>();
  const widestLayer = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
  // Keep nodes in place when editing a member changes its storage ownership.
  for (const layer of layers.values()) layer.sort((a, b) => a.member.id.localeCompare(b.member.id));
  for (const [column, layer] of layers)
    layer.forEach(({ member }, index) =>
      position.set(member.id, {
        x: 36 + column * 390,
        y: 36 + ((widestLayer - layer.length) * 150) / 2 + index * 150,
      }),
    );
  const canvasWidth = 72 + Math.max(0, layers.size - 1) * 390 + 260;
  const canvasHeight = 72 + Math.max(0, widestLayer - 1) * 150 + 110;
  const expected = result?.scenarios.find((scenario) => scenario.name === 'Expected');
  const shared = estimate.agents.filter((row) => row.count > 0);

  return (
    <section className="panel graph-panel" aria-label="Agent invocation graph">
      <div className="section-heading">
        <div>
          <h2>
            Agent suite graph <span className="count-chip">{nodes.length}</span>
          </h2>
          <p>Each node is one agent. Click an agent to edit its settings and invocation steps.</p>
        </div>
        <button className="button dark" onClick={onAddAgent} disabled={busy}>
          <Plus size={16} aria-hidden="true" /> Add agent
        </button>
      </div>
      <div className="graph-workspace">
        <div className="graph-legend">
          <span>Arrows show who invokes whom. Labels show target selection probability.</span>
          <span>Expected monthly cost includes this agent's models, tools, and allocated harness.</span>
        </div>
        <div className="graph-canvas-scroll" role="region" tabIndex={0} aria-label="Agent canvas">
          {nodes.length === 0 ? (
            <div className="empty-inline">No agents yet. Add an agent to start your suite graph.</div>
          ) : (
            <div className="graph-canvas-stage">
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
                  {edges.map(([key, edge]) => {
                    const from = position.get(edge.source)!;
                    const to = position.get(edge.target)!;
                    const x1 = from.x + 260,
                      y1 = from.y + 55,
                      x2 = to.x,
                      y2 = to.y + 55;
                    return (
                      <g
                        key={key}
                        className="graph-relationship"
                        data-source={edge.source}
                        data-target={edge.target}
                      >
                        <title>
                          {byId.get(edge.source)!.member.name} → {byId.get(edge.target)!.member.name}:{' '}
                          {edge.options
                            .map(
                              (option) =>
                                `${option.step}: ${option.selection} selection, ${option.execution} step execution`,
                            )
                            .join('; ')}
                        </title>
                        <path
                          d={`M ${x1} ${y1} C ${x1 + 65} ${y1}, ${x2 - 65} ${y2}, ${x2} ${y2}`}
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
                          {edge.options.length === 1
                            ? edge.options[0].selection
                            : `${edge.options.length} steps`}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                {nodes.map(({ row, member }) => {
                  const point = position.get(member.id)!;
                  const cost = expected?.agent_costs[row.id];
                  return (
                    <div key={member.id} className="graph-node" style={{ left: point.x, top: point.y }}>
                      <button
                        className="graph-node-main"
                        onClick={() => onEditAgent(row, member.id)}
                        disabled={busy}
                        aria-label={`Select agent ${member.name}`}
                        aria-haspopup="dialog"
                      >
                        <span className="graph-node-top">
                          <strong>{member.name}</strong>
                        </span>
                        <span className="graph-node-foot">
                          {cost
                            ? cost.complete
                              ? `${money(cost.per_agent_monthly)}/mo`
                              : `Incomplete cost (${money(cost.per_agent_monthly)} known)`
                            : 'Calculating cost…'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {nodes.length > 0 && (
          <p className="muted small graph-canvas-note">
            Scroll the canvas to explore the suite. Edit an agent's Invoke agent steps to change its
            relationships. Apply changes to update the graph and budget.
          </p>
        )}
        <ul className="sr-only" aria-label="Agent relationships">
          {edges.map(([key, edge]) => (
            <li key={key}>
              {byId.get(edge.source)!.member.name} invokes {byId.get(edge.target)!.member.name}:{' '}
              {edge.options
                .map(
                  (option) =>
                    `${option.step}, ${option.selection} selection, ${option.execution} step execution`,
                )
                .join('; ')}
            </li>
          ))}
        </ul>
        {shared.length > 0 && (
          <details className="graph-shared-settings">
            <summary>Edit shared execution settings</summary>
            <p className="muted small">
              These settings apply to all listed agents. Click a graph node to edit only that individual.
            </p>
            <div className="button-row">
              {shared.map((row) => (
                <button
                  key={row.id}
                  className="button subtle"
                  disabled={busy}
                  onClick={() => onEditShared(row)}
                  aria-label={`Edit shared settings for ${row.name}`}
                >
                  {row.name} · {row.count} agents
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
