'use client';

// ============================================================
// KnowledgeBasesSettings — Settings → Knowledge bases
//
// Manage the named text/markdown blobs (prices, product details, FAQ…)
// that the AI Reply automation step feeds to the model as context. Any
// member sees the list; admin+ can create / edit / delete (gated by
// <RequireRole min="admin"> here and the admin-only RLS policies on the
// server — see migration 027).
//
// Content can be pasted directly or loaded from a .md/.txt file; the
// upload just reads the file text into the same field, so there's one
// storage path.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BookOpen, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import type { KnowledgeBase } from '@/types';
import { SettingsPanelHead } from './settings-panel-head';

type KbRow = Pick<
  KnowledgeBase,
  'id' | 'name' | 'content' | 'created_at' | 'updated_at'
>;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function KnowledgeBasesSettings() {
  const { canEditSettings } = useAuth();

  const [items, setItems] = useState<KbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<KbRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge-bases', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to load knowledge bases');
        return;
      }
      const data = (await res.json()) as { knowledge_bases: KbRow[] };
      setItems(data.knowledge_bases);
    } catch (err) {
      console.error('[KnowledgeBasesSettings] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(kb: KbRow) {
    setEditing(kb);
    setDialogOpen(true);
  }

  async function handleDelete(kb: KbRow) {
    if (!confirm(`Delete "${kb.name}"? Automations using it will stop replying.`))
      return;
    setDeleting(kb.id);
    try {
      const res = await fetch(`/api/knowledge-bases/${kb.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to delete');
        return;
      }
      toast.success(`Deleted "${kb.name}"`);
      setItems((prev) => prev.filter((i) => i.id !== kb.id));
    } catch (err) {
      console.error('[KnowledgeBasesSettings] delete error:', err);
      toast.error('Could not reach the server');
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Knowledge bases"
        description={
          <>
            Text or markdown the AI Reply automation step uses to answer
            customers — prices, product details, FAQs. Paste it or upload a{' '}
            <code className="text-xs">.md</code> /{' '}
            <code className="text-xs">.txt</code> file.
          </>
        }
        action={
          <RequireRole min="admin">
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              New knowledge base
            </Button>
          </RequireRole>
        }
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <BookOpen className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">
              No knowledge bases yet.
            </p>
            {canEditSettings ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Click{' '}
                <span className="text-foreground">New knowledge base</span> to
                create one.
              </p>
            ) : (
              <p className="text-muted-foreground mt-1 text-xs">
                Ask an admin to create one.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {items.map((kb) => (
                <li
                  key={kb.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-foreground truncate text-sm font-medium">
                      {kb.name}
                    </span>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {kb.content.length.toLocaleString()} characters · updated{' '}
                      {fmtDate(kb.updated_at)}
                    </p>
                  </div>

                  <RequireRole min="admin">
                    <div className="flex gap-2 self-start sm:self-auto">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(kb)}
                      >
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(kb)}
                        disabled={deleting === kb.id}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                      >
                        {deleting === kb.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </RequireRole>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <EditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existing={editing}
        onSaved={load}
      />
    </section>
  );
}

// ------------------------------------------------------------
// Create / edit dialog. `existing === null` is the create path.
// ------------------------------------------------------------

function EditDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: KbRow | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-seed the form whenever the dialog opens (create → empty, edit →
  // the row's current values).
  useEffect(() => {
    if (open) {
      setName(existing?.name ?? '');
      setContent(existing?.content ?? '');
    }
  }, [open, existing]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setContent(text);
      if (!name.trim()) setName(file.name.replace(/\.(md|txt|markdown)$/i, ''));
      toast.success(`Loaded ${file.name}`);
    } catch {
      toast.error('Could not read that file');
    } finally {
      // Allow re-selecting the same file later.
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Give the knowledge base a name');
      return;
    }
    setSubmitting(true);
    try {
      const url = existing
        ? `/api/knowledge-bases/${existing.id}`
        : '/api/knowledge-bases';
      const res = await fetch(url, {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, content }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Failed to save');
        return;
      }
      toast.success(existing ? 'Saved' : 'Knowledge base created');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error('[EditDialog] save error:', err);
      toast.error('Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Cap the dialog at 85vh and lay it out as header / scrollable
          body / footer so a large paste scrolls the body instead of
          pushing the Save button off-screen. */}
      <DialogContent className="border-border bg-popover grid-rows-[auto_minmax(0,1fr)_auto] max-h-[85vh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {existing ? 'Edit knowledge base' : 'New knowledge base'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            The AI uses this text verbatim when drafting replies. Keep it
            accurate and concise.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label htmlFor="kb-name" className="text-muted-foreground">
              Name
            </Label>
            <Input
              id="kb-name"
              value={name}
              maxLength={120}
              placeholder="e.g. Pricing & product details"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="kb-content" className="text-muted-foreground">
                Content
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" />
                Upload .md / .txt
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,text/plain,text/markdown"
                className="hidden"
                onChange={handleFile}
              />
            </div>
            <Textarea
              id="kb-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Prices, product details, FAQs…"
              className="max-h-[45vh] min-h-64 overflow-y-auto font-mono text-xs"
            />
            <p className="text-muted-foreground text-xs">
              {content.length.toLocaleString()} characters
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
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : existing ? (
              'Save changes'
            ) : (
              'Create'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
