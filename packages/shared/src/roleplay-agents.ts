import contract from './roleplay-agents.json';

export interface RoleplayAgentContractEntry {
  readonly name: string;
  readonly agentId: string;
}

export const ROLEPLAY_AGENT_CONTRACT_VERSION = contract.version;
export const ROLEPLAY_AGENTS = Object.freeze(
  contract.agents.map((agent) => Object.freeze({ ...agent })) satisfies RoleplayAgentContractEntry[],
);
export const ROLEPLAY_AGENT_IDS = Object.freeze(
  ROLEPLAY_AGENTS.map((agent) => agent.agentId),
);
