'use client';

// ============================================================
// AiSettings — Settings → AI Assistant
//
// One home for the AI features: the AI Checkout on/off toggle (stored on
// whatsapp_config.ai_checkout_enabled) and the knowledge-base manager
// the assistant answers from. Admins toggle; the RLS update policy on
// whatsapp_config enforces that server-side too.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';
import { KnowledgeBasesSettings } from './knowledge-bases-settings';

export function AiSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [hasConfig, setHasConfig] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('whatsapp_config')
      .select('ai_checkout_enabled')
      .eq('account_id', accountId)
      .maybeSingle();
    setHasConfig(!!data);
    setEnabled(Boolean((data as { ai_checkout_enabled?: boolean } | null)?.ai_checkout_enabled));
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(next: boolean) {
    if (!accountId) return;
    setEnabled(next);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('whatsapp_config')
        .update({ ai_checkout_enabled: next })
        .eq('account_id', accountId);
      if (error) {
        setEnabled(!next);
        toast.error(error.message || 'Failed to update');
        return;
      }
      toast.success(next ? 'AI Checkout enabled' : 'AI Checkout disabled');
    } catch {
      setEnabled(!next);
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="AI Assistant"
        description="Let Gemini answer customer questions from your knowledge base and take product orders with PayHere checkout, in English, Sinhala, and Singlish."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">
            <Sparkles className="mr-2 inline size-4 text-violet-400" />
            AI Checkout Assistant
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            When on, the assistant handles inbound WhatsApp messages — answering
            questions and taking orders. Prices come from your{' '}
            <strong className="text-foreground">Products</strong> list, never the
            AI. Turn it off during stock-outs or heavy volume.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center py-2">
              <Loader2 className="size-4 animate-spin text-primary" />
            </div>
          ) : !hasConfig ? (
            <p className="text-sm text-muted-foreground">
              Connect WhatsApp first (Settings → WhatsApp) — the toggle lives on
              that connection.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="ai-checkout-switch" className="text-foreground">
                Enable AI Checkout Assistant
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Replaces the per-message AI Reply automation while on, so
                  customers get one unified assistant.
                </span>
              </Label>
              <Switch
                id="ai-checkout-switch"
                checked={enabled}
                disabled={!canEditSettings || saving}
                onCheckedChange={toggle}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Knowledge base manager — what the assistant answers from. */}
      <KnowledgeBasesSettings />
    </section>
  );
}
