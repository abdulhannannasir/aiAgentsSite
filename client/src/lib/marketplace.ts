import { ApiError, errorMessage } from './api';
import type { PublicAgentDetail } from '../../../server/src/contracts';

export interface AgentStats {
  id: string;
  runsTotal: number;
  runs30d: number;
  successRate: number | null;
  rating: number | null;
  reviewCount: number;
  favorite?: boolean;
}
export interface Review { id: string; rating: number; comment: string; author: string; mine: boolean; createdAt: number; updatedAt: number }
export interface MarketplaceDetail {
  stats: AgentStats;
  reviews: Review[];
  me: null | {
    runs: number;
    canReview: boolean;
    review: { rating: number; comment: string } | null;
    conversations: Array<{ id: string; title: string; messageCount: number; updatedAt: number }>;
  };
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, errorMessage(data) || `Request failed (${res.status})`);
  return data as T;
}

/** Public: the built-in agent with example prompts and the workflows it belongs to. */
export const fetchAgentDetail = (id: string) => call<PublicAgentDetail>('GET', `/api/v1/agents/${encodeURIComponent(id)}`);

/** Marketplace data needs a database on the server; these reject with status 503 when it has none. */
export const marketplace = {
  stats: () => call<AgentStats[]>('GET', '/api/v1/marketplace/agents'),
  detail: (id: string) => call<MarketplaceDetail>('GET', `/api/v1/marketplace/agents/${encodeURIComponent(id)}`),
  setFavorite: (key: string, on: boolean) => call<void>(on ? 'PUT' : 'DELETE', `/api/v1/marketplace/favorites/${encodeURIComponent(key)}`, on ? {} : undefined),
  saveReview: (id: string, rating: number, comment: string) => call<Review>('PUT', `/api/v1/marketplace/agents/${encodeURIComponent(id)}/review`, { rating, comment }),
  deleteReview: (id: string) => call<void>('DELETE', `/api/v1/marketplace/agents/${encodeURIComponent(id)}/review`)
};

export const versions = (customAgentId: string) =>
  call<Array<{ id: string; version: number; name: string; createdAt: number; createdByName: string | null }>>('GET', `/api/v1/custom-agents/${encodeURIComponent(customAgentId)}/versions`);

export const formatCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
