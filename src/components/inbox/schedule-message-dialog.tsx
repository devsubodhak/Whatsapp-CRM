'use client';

// Dialog for scheduling a free-text message to send later in this
// conversation. Posts to /api/whatsapp/schedule; the cron drain
// (/api/whatsapp/schedule/cron) sends it at the chosen time.
//
// Note on the 24-hour window: a scheduled text only delivers if the
// customer has messaged within 24h of the send time. We surface that
// caveat here; if it fails, the scheduled-messages bar shows the error.

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Clock, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in LOCAL time. Build it
 *  from a Date, offsetting the UTC ISO string by the local tz so the
 *  picker shows the user's wall-clock time. */
function toLocalInputValue(d: Date): string {
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export function ScheduleMessageDialog({
  conversationId,
  open,
  onOpenChange,
  initialText,
  onScheduled,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText: string;
  onScheduled: () => void;
}) {
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Seed the form each time the dialog opens: the composer's current
  // text, and a default time one hour out.
  useEffect(() => {
    if (open) {
      setText(initialText);
      const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
      setWhen(toLocalInputValue(inOneHour));
    }
  }, [open, initialText]);

  // Earliest selectable time — a minute from now (the API floor is 30s).
  const minWhen = toLocalInputValue(new Date(Date.now() + 60_000));

  async function handleSchedule() {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error('Message cannot be empty');
      return;
    }
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) {
      toast.error('Pick a valid date and time');
      return;
    }
    if (at.getTime() <= Date.now()) {
      toast.error('Pick a time in the future');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/whatsapp/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_type: 'text',
          content_text: trimmed,
          scheduled_at: at.toISOString(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Failed to schedule');
        return;
      }
      toast.success(`Scheduled for ${at.toLocaleString()}`);
      onScheduled();
      onOpenChange(false);
    } catch (err) {
      console.error('[ScheduleMessageDialog] error:', err);
      toast.error('Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            <Clock className="mr-2 inline size-4" />
            Schedule message
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            The message will be sent automatically at the time you pick.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-text" className="text-muted-foreground">
              Message
            </Label>
            <Textarea
              id="schedule-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type the message to send later…"
              className="max-h-48 min-h-24"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-when" className="text-muted-foreground">
              Send at
            </Label>
            <Input
              id="schedule-when"
              type="datetime-local"
              value={when}
              min={minWhen}
              onChange={(e) => setWhen(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Heads up: a plain text message only delivers if the customer
              messaged within 24 hours of the send time. Otherwise schedule a
              template.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button onClick={handleSchedule} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Scheduling…
              </>
            ) : (
              'Schedule'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
