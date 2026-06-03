import { getActiveCity } from '../api/cityBase';
import type {
  AgentPrimeBody,
  AgentResponse,
  ListBodyAgentResponse,
} from '../generated/gc-supervisor-client/types.gen';
import { supervisorApi } from './client';

export type SupervisorAgent = AgentResponse;

export interface SupervisorAgentList extends Omit<ListBodyAgentResponse, 'items'> {
  items: SupervisorAgent[];
}

export async function listSupervisorAgents(): Promise<SupervisorAgentList> {
  const list = await supervisorApi().listAgents(activeCityOrThrow('list supervisor agents'));
  return {
    ...list,
    items: list.items ?? [],
  };
}

export async function fetchSupervisorAgentPrime(
  agentAlias: string,
): Promise<AgentPrimeBody> {
  const trimmedAlias = agentAlias.trim();
  if (trimmedAlias.length === 0) throw new Error('agent alias is required');
  return supervisorApi().agentPrime(
    activeCityOrThrow('fetch supervisor agent prime'),
    trimmedAlias,
  );
}

function activeCityOrThrow(operation: string): string {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error(`${operation} called before an active city was resolved`);
  }
  return cityName;
}
