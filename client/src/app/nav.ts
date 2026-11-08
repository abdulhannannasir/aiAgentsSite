import {
  Activity, BarChart3, Bot, Brain, CreditCard, FolderKanban, Gauge, MessagesSquare, Plug, Settings, Sparkles, Wand2, Workflow,
  type LucideIcon
} from 'lucide-react';
import type { PageId } from '../lib/route';

export type NavSection = 'Workspace' | 'Knowledge' | 'Insights' | 'Account';
export type ServiceKey = 'database' | 'auth' | 'email' | 'redis' | 'storage';

export interface NavItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
  section: NavSection;
  /** 'ready' pages work today. 'planned' pages are honest placeholders that say which phase builds them. */
  status: 'ready' | 'planned';
  description: string;
  /** For planned pages: roadmap phase, what it will do, and which server services it needs. */
  phase?: number;
  capabilities?: string[];
  requires?: ServiceKey[];
}

export const NAV: NavItem[] = [
  { id: 'command-center', label: 'Command Center', icon: Gauge, section: 'Workspace', status: 'ready', description: 'Live overview of your agents, runs and platform status.' },
  { id: 'chat', label: 'Chat', icon: MessagesSquare, section: 'Workspace', status: 'ready', description: 'Talk to any agent or run a multi-agent workflow.' },
  { id: 'discover', label: 'Discover Agents', icon: Sparkles, section: 'Workspace', status: 'ready', description: 'Browse and search the 42 specialist agents.' },
  { id: 'my-agents', label: 'My Agents', icon: Bot, section: 'Workspace', status: 'ready', description: 'Agents you built or imported.' },
  { id: 'builder', label: 'Agent Builder', icon: Wand2, section: 'Workspace', status: 'ready', description: 'Create an agent from a template or from scratch.' },
  { id: 'workflows', label: 'Workflows', icon: Workflow, section: 'Workspace', status: 'ready', description: 'Multi-agent pipelines you can run from any chat.' },
  {
    id: 'projects', label: 'Projects', icon: FolderKanban, section: 'Knowledge', status: 'planned', phase: 7,
    description: 'Persistent workspaces for conversations, agents, workflows and files.',
    capabilities: ['Group conversations, agents, workflows and files by project', 'Upload files to secure object storage with previews and text extraction', 'Project members and an activity history'],
    requires: ['database', 'auth', 'storage']
  },
  {
    id: 'memory', label: 'Memory', icon: Brain, section: 'Knowledge', status: 'planned', phase: 7,
    description: 'Controlled long-term memory your agents can retrieve from.',
    capabilities: ['User, project, conversation, agent and knowledge-base memory', 'Semantic search (pgvector) limited to what you may access', 'Review, edit, delete and set retention for every memory'],
    requires: ['database', 'auth']
  },
  {
    id: 'integrations', label: 'Integrations', icon: Plug, section: 'Knowledge', status: 'planned', phase: 8,
    description: 'Connect real services so agents can act on your behalf.',
    capabilities: ['GitHub, Google Drive / Calendar / Gmail, Slack and signed webhooks', 'OAuth with explicit scopes; credentials encrypted at rest', 'A service shows as connected only after a real API call succeeds'],
    requires: ['database', 'auth']
  },
  {
    id: 'activity', label: 'Activity', icon: Activity, section: 'Insights', status: 'planned', phase: 9,
    description: 'Every execution, step and approval, with timelines.',
    capabilities: ['Execution history with inputs, outputs, errors and logs', 'Live updates over Server-Sent Events', 'Approval inbox for sensitive actions'],
    requires: ['database', 'auth']
  },
  {
    id: 'analytics', label: 'Analytics', icon: BarChart3, section: 'Insights', status: 'planned', phase: 9,
    description: 'Usage, cost and reliability, computed from recorded executions.',
    capabilities: ['Agent usage, completion and failure rates', 'Token consumption by provider and model', 'Workflow performance over time'],
    requires: ['database', 'auth']
  },
  { id: 'settings', label: 'Settings', icon: Settings, section: 'Account', status: 'ready', description: 'Appearance, effects, AI provider status and local data.' },
  {
    id: 'billing', label: 'Billing', icon: CreditCard, section: 'Account', status: 'planned', phase: 10,
    description: 'Plans, usage limits and invoices.',
    capabilities: ['Free, Pro, Team and Enterprise plans with configurable limits', 'Usage metering enforced by the server', 'Checkout, plan changes, cancellation and invoice history'],
    requires: ['database', 'auth']
  }
];

export const NAV_SECTIONS: NavSection[] = ['Workspace', 'Knowledge', 'Insights', 'Account'];

export const navItem = (id: PageId): NavItem => NAV.find(n => n.id === id) ?? NAV[1];

export const SERVICE_LABEL: Record<ServiceKey, string> = {
  database: 'PostgreSQL database (DATABASE_URL)',
  auth: 'Accounts (DATABASE_URL + BETTER_AUTH_SECRET)',
  email: 'Email delivery (SMTP_URL)',
  redis: 'Redis job queue (REDIS_URL)',
  storage: 'Object storage (S3_BUCKET)'
};
