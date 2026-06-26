'use client';

// Shows the pending (and recently failed) scheduled messages for a
// conversation, above the composer. Lets the agent cancel a pending
// one before it sends. Refetches when `refreshKey` changes (i.e. after
// a new message is scheduled from the dialog).

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Clock, Loader2, X } from 'lucide-react';

import type { ScheduledMessage } from '@/types';

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ScheduledMessagesBar({
  conversationId,
  refreshKey,
}: {
  conversationId: string;
  refreshKey: number;
}) {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [canceling, setCanceling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/whatsapp/schedule?conversation_id=${encodeURIComponent(conversationId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { scheduled_messages: ScheduledMessage[] };
      setItems(data.scheduled_messages);
    } catch {
      // Non-critical strip — stay silent on transient fetch errors.
    }
  }, [conversationId]);

  // Refetch on mount, when a new message is scheduled (refreshKey), and
  // on a short poll so a message that the cron just sent drops off the
  // bar (and any failure surfaces) without the agent reloading the page.
  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 20_000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  async function cancel(id: string) {
    setCanceling(id);
    try {
      const res = await fetch(`/api/whatsapp/schedule/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Could not cancel');
        return;
      }
      toast.success('Scheduled message canceled');
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setCanceling(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-2 space-y-1.5">
      {items.map((m) => {
        const isFailed = m.status === 'failed';
        const preview =
          m.message_type === 'template'
            ? `Template: ${m.template_name}`
            : (m.content_text ?? '');
        return (
          <div
            key={m.id}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
              isFailed
                ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : 'border-border bg-muted/50 text-muted-foreground'
            }`}
          >
            {isFailed ? (
              <AlertTriangle className="size-3.5 shrink-0 text-red-400" />
            ) : (
              <Clock className="size-3.5 shrink-0 text-primary" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {isFailed ? (
                <>
                  <span className="font-medium">Failed:</span> {m.error_message || preview}
                </>
              ) : (
                <>
                  <span className="text-foreground">{fmtWhen(m.scheduled_at)}</span>
                  {' · '}
                  {preview}
                </>
              )}
            </span>
            {m.status === 'scheduled' && (
              <button
                type="button"
                onClick={() => cancel(m.id)}
                disabled={canceling === m.id}
                aria-label="Cancel scheduled message"
                className="rounded p-0.5 hover:bg-card hover:text-foreground"
              >
                {canceling === m.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" />
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
