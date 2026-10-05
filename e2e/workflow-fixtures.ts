// Input builders for fixed E2E journeys; expected costs remain independently specified.
export function modelStep(
  id: string,
  execution: Record<string, string>,
  probability = '1',
  name = 'Main step',
) {
  return {
    id,
    name,
    action_type: 'model',
    execution_probability: probability,
    agent_calls: [],
    model_calls: [{ ...execution, id: `${id}-model`, role: '', probability: '1' }],
  };
}
export function agentStep(id: string, child: string, probability = '1') {
  return {
    id,
    name: `Call ${child}`,
    action_type: 'agent',
    execution_probability: probability,
    model_calls: [],
    agent_calls: [{ id: `${id}-option`, child_agent_id: child, probability: '1' }],
  };
}
