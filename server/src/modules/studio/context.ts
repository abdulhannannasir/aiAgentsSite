import { AGENTS } from '../agents/registry.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { GraphContext } from './graph.js';

/** The agents and tools a workflow graph may use on this server (what validation and compilation check against). */
export function graphContext(tools: ToolRegistry): GraphContext {
  return {
    agents: AGENTS.map(a => ({ id: a.id, name: a.name, tools: a.tools })),
    tools: tools.list().map(t => ({ id: t.id, available: t.available, external: tools.isExternal(t.id) }))
  };
}
