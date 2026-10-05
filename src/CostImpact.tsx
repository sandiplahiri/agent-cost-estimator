import { rateMoney, type Estimate, type Results } from './types';

export function CostImpact({ estimate, result }: { estimate: Estimate; result: Results | null }) {
  const agents = result?.top_agents || [];
  const expected = result?.scenarios.find((scenario) => scenario.name === 'Expected');

  return (
    <section className="panel impact-panel" aria-label="Top agents by cost">
      <div className="section-heading">
        <div>
          <h2>Top agents by cost</h2>
          <p>Top 5 high cost agents</p>
        </div>
      </div>
      {agents.length === 0 ? (
        <div className="empty-inline">
          {estimate.agents.some((agent) => agent.count > 0)
            ? 'Top agents will appear when this estimate finishes calculating.'
            : 'Add agents to see their token costs.'}
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="agent-table top-agent-table">
              <caption className="sr-only">
                Expected monthly token cost per agent in USD, highest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Index</th>
                  <th scope="col">Agent name</th>
                  <th scope="col">Use case name</th>
                  <th scope="col">Total token cost</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent, index) => (
                  <tr key={agent.agent_id}>
                    <th scope="row">{index + 1}</th>
                    <td>{agent.name}</td>
                    <td>{agent.use_case_name || '—'}</td>
                    <td>
                      {agent.complete
                        ? rateMoney(agent.monthly_token_cost)
                        : Number(agent.monthly_token_cost) === 0
                          ? 'Incomplete'
                          : `${rateMoney(agent.monthly_token_cost)} (partial)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!expected?.complete && (
            <p className="panel-footnote">
              Ranking uses known costs; agents with missing inputs or prices may rank differently.
            </p>
          )}
        </>
      )}
    </section>
  );
}
