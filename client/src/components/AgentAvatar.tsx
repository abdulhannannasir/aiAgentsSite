import { Bot, Code2, Lightbulb, Scale, Search, Workflow as WorkflowIcon, type LucideIcon } from 'lucide-react';

export function AgentAvatar({ icon, gradient, size = 40 }: { icon: string; gradient: string; size?: number }) {
  return (
    <div
      aria-hidden
      className={`flex shrink-0 select-none items-center justify-center rounded-xl bg-gradient-to-br shadow-sm ring-1 ring-black/10 ${gradient}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      {icon || <Bot size={size * 0.5} />}
    </div>
  );
}

const WORKFLOW_ICONS: Record<string, LucideIcon> = { search: Search, code: Code2, scale: Scale, lightbulb: Lightbulb };
export const workflowIcon = (name: string): LucideIcon => WORKFLOW_ICONS[name] ?? WorkflowIcon;

export const CUSTOM_GRADIENT = 'from-indigo-500 to-violet-600';
