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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsPanelHead } from './settings-panel-head';
import { KnowledgeBasesSettings } from './knowledge-bases-settings';

export function AiSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [hasConfig, setHasConfig] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bankDetails, setBankDetails] = useState('');
  const [savingBank, setSavingBank] = useState(false);
  const [postPurchase, setPostPurchase] = useState('');
  const [savingPost, setSavingPost] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('whatsapp_config')
      .select('ai_checkout_enabled, bank_transfer_details, post_purchase_message')
      .eq('account_id', accountId)
      .maybeSingle();
    setHasConfig(!!data);
    setEnabled(Boolean((data as { ai_checkout_enabled?: boolean } | null)?.ai_checkout_enabled));
    setBankDetails(
      (data as { bank_transfer_details?: string | null } | null)?.bank_transfer_details ?? '',
    );
    setPostPurchase(
      (data as { post_purchase_message?: string | null } | null)?.post_purchase_message ?? '',
    );
    setLoading(false);
  }, [accountId, supabase]);

  async function saveField(
    column: 'bank_transfer_details' | 'post_purchase_message',
    value: string,
    setSaving: (b: boolean) => void,
    successMsg: string,
  ) {
    if (!accountId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('whatsapp_config')
        .update({ [column]: value.trim() || null })
        .eq('account_id', accountId);
      if (error) {
        toast.error(error.message || 'Failed to save');
        return;
      }
      toast.success(successMsg);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

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

      {hasConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Bank transfer details</CardTitle>
            <CardDescription className="text-muted-foreground">
              Shown to customers as a payment option alongside the card link. They
              can transfer to this account and send a photo of their slip in chat —
              it appears on the <strong className="text-foreground">Orders</strong>{' '}
              page for you to verify. Leave blank to offer card payment only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="bank-details" className="sr-only">
              Bank transfer details
            </Label>
            <Textarea
              id="bank-details"
              value={bankDetails}
              onChange={(e) => setBankDetails(e.target.value)}
              disabled={!canEditSettings}
              placeholder={'Bank: Commercial Bank\nAccount name: YANTECH LANKA (PVT) LTD\nAccount no: 1234567890\nBranch: Matale'}
              className="max-h-48 min-h-28 font-mono text-xs"
            />
            <div className="flex justify-end">
              <Button
                onClick={() =>
                  saveField('bank_transfer_details', bankDetails, setSavingBank, 'Bank transfer details saved')
                }
                disabled={!canEditSettings || savingBank}
              >
                {savingBank ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save bank details'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {hasConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Post-purchase message</CardTitle>
            <CardDescription className="text-muted-foreground">
              Sent automatically right after a successful payment (card or
              verified bank transfer). Great for a thank-you and a review link.
              Leave blank to send nothing extra.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="post-purchase" className="sr-only">
              Post-purchase message
            </Label>
            <Textarea
              id="post-purchase"
              value={postPurchase}
              onChange={(e) => setPostPurchase(e.target.value)}
              disabled={!canEditSettings}
              placeholder={'🙏 Thanks for choosing YANTECH LANKA! We’d love your feedback — please review us here: https://g.page/r/your-review-link'}
              className="max-h-48 min-h-24"
            />
            <div className="flex justify-end">
              <Button
                onClick={() =>
                  saveField('post_purchase_message', postPurchase, setSavingPost, 'Post-purchase message saved')
                }
                disabled={!canEditSettings || savingPost}
              >
                {savingPost ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save message'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Knowledge base manager — what the assistant answers from. */}
      <KnowledgeBasesSettings />
    </section>
  );
}
