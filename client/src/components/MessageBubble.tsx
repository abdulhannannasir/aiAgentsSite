import { memo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { AgentAvatar } from './AgentAvatar';
import { Markdown } from './Markdown';
import { ThoughtStream } from './ThoughtStream';
import { TypingPulse } from './fx/TypingPulse';
import type { ActiveAgent, Message } from '../types';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const MessageBubble = memo(function MessageBubble({ message, agent }: { message: Message; agent: ActiveAgent }) {
  const isUser = message.role === 'user';
  const streaming = message.status === 'streaming';

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}
      data-testid={isUser ? 'msg-user' : 'msg-assistant'}
      data-status={message.status}
    >
      {!isUser && <div className="mt-1"><AgentAvatar icon={agent.icon} gradient={agent.gradient} size={32} /></div>}
      <div className={`min-w-0 max-w-[92%] rounded-2xl border p-4 shadow-sm transition-shadow sm:max-w-[82%] ${isUser ? 'rounded-tr-sm border-line bg-[var(--bubble-user)]' : 'rounded-tl-sm bg-[var(--bubble-ai)]'} ${!isUser && streaming ? 'border-neon-cyan/40 shadow-glow-cyan' : 'border-line'}`}>
        <div className="mb-1 flex items-baseline justify-between gap-4">
          <span className={`font-display text-xs font-bold ${isUser ? 'text-muted' : 'text-accent'}`}>{isUser ? 'You' : agent.name}</span>
          <span className="text-[10px] text-muted">{time(message.createdAt)}</span>
        </div>

        {!isUser && message.trace && <ThoughtStream steps={message.trace} running={streaming} />}

        {isUser ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
        ) : (
          <>
            {streaming && !message.content && <TypingPulse label={(message.trace?.length ?? 0) > 1 ? 'Agents collaborating' : 'Thinking'} />}
            {message.content && (
              <div>
                <Markdown text={message.content} streaming={streaming} />
                {streaming && <span aria-hidden className="animate-caret-blink text-accent">▍</span>}
              </div>
            )}
            {message.status === 'error' && (
              <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>{message.error ?? 'Something went wrong.'}</span>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
});
