'use client';

export const AGENT_INTERVENTION_EVENT = 'magine:agent-intervention';

export interface AgentInterventionDetail {
  id: string;
  nodeId: string;
  status: 'working' | 'resolved' | 'failed';
  message: string;
}

export function announceAgentIntervention(detail: AgentInterventionDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AgentInterventionDetail>(
    AGENT_INTERVENTION_EVENT,
    { detail },
  ));
}

export function listenForAgentInterventions(
  listener: (detail: AgentInterventionDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<AgentInterventionDetail>).detail;
    if (detail?.id && detail.message) listener(detail);
  };
  window.addEventListener(AGENT_INTERVENTION_EVENT, handler);
  return () => window.removeEventListener(AGENT_INTERVENTION_EVENT, handler);
}
