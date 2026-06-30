'use client';

// ============================================================
// ProductsSettings — Settings → Products
//
// The price catalog the AI Checkout assistant uses. The AI gathers what
// a customer wants; the server prices it from this list (never the
// model). Any member sees it; admin+ can edit (RLS + <RequireRole>).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Package, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { uploadAccountMedia } from '@/lib/storage/upload-media';

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
import type { Product } from '@/types';
import { SettingsPanelHead } from './settings-panel-head';

export function ProductsSettings() {
  const { canEditSettings } = useAuth();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/products', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to load products');
        return;
      }
      const data = (await res.json()) as { products: Product[] };
      setItems(data.products);
    } catch (err) {
      console.error('[ProductsSettings] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(p: Product) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    setDeleting(p.id);
    try {
      const res = await fetch(`/api/products/${p.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to delete');
        return;
      }
      toast.success(`Deleted "${p.name}"`);
      setItems((prev) => prev.filter((i) => i.id !== p.id));
    } catch {
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
        title="Products"
        description="The price list the AI Checkout assistant uses to quote orders. The AI never sets prices — it looks them up here."
        action={
          <RequireRole min="admin">
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" />
              New product
            </Button>
          </RequireRole>
        }
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Package className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">No products yet.</p>
            {canEditSettings ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Add the items you sell so AI Checkout can price orders.
              </p>
            ) : (
              <p className="text-muted-foreground mt-1 text-xs">Ask an admin to add some.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {items.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground truncate text-sm font-medium">
                        {p.name}
                      </span>
                      {!p.active && (
                        <span className="border-border bg-muted text-muted-foreground rounded border px-1.5 py-0.5 text-[10px] uppercase">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {p.currency} {Number(p.unit_price).toLocaleString()}
                      {p.description ? ` · ${p.description}` : ''}
                    </p>
                  </div>
                  <RequireRole min="admin">
                    <div className="flex gap-2 self-start sm:self-auto">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditing(p);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(p)}
                        disabled={deleting === p.id}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                      >
                        {deleting === p.id ? (
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

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existing={editing}
        onSaved={load}
      />
    </section>
  );
}

function ProductDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: Product | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('LKR');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file');
      return;
    }
    setUploading(true);
    try {
      // chat-media is a public bucket, so Meta can fetch the URL when the
      // assistant sends the photo to a customer.
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setImageUrl(publicUrl);
      toast.success('Image uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? '');
      setPrice(existing ? String(existing.unit_price) : '');
      setCurrency(existing?.currency ?? 'LKR');
      setDescription(existing?.description ?? '');
      setImageUrl(existing?.image_url ?? '');
      setVideoUrl(existing?.video_url ?? '');
    }
  }, [open, existing]);

  async function handleSave() {
    const trimmed = name.trim();
    const unitPrice = Number(price);
    if (!trimmed) {
      toast.error('Give the product a name');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      toast.error('Enter a valid price');
      return;
    }
    setSubmitting(true);
    try {
      const url = existing ? `/api/products/${existing.id}` : '/api/products';
      const res = await fetch(url, {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          unit_price: unitPrice,
          currency: currency.trim() || 'LKR',
          description: description.trim() || null,
          image_url: imageUrl.trim() || null,
          video_url: videoUrl.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Failed to save');
        return;
      }
      toast.success(existing ? 'Saved' : 'Product added');
      onSaved();
      onOpenChange(false);
    } catch {
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
            {existing ? 'Edit product' : 'New product'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            The AI quotes orders using this exact price.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="product-name" className="text-muted-foreground">
              Name
            </Label>
            <Input
              id="product-name"
              value={name}
              maxLength={120}
              placeholder="e.g. Customized Mug"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="product-price" className="text-muted-foreground">
                Unit price
              </Label>
              <Input
                id="product-price"
                type="number"
                min={0}
                step="0.01"
                value={price}
                placeholder="0.00"
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-currency" className="text-muted-foreground">
                Currency
              </Label>
              <Input
                id="product-currency"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-desc" className="text-muted-foreground">
              Description (optional)
            </Label>
            <Textarea
              id="product-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Helps the AI describe the item to customers"
              className="max-h-32 min-h-20"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="product-image" className="text-muted-foreground">
                Photo (optional)
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Upload image
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleImageFile}
              />
            </div>
            <Input
              id="product-image"
              value={imageUrl}
              placeholder="Upload above, or paste an image URL"
              onChange={(e) => setImageUrl(e.target.value)}
            />
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt="Product preview"
                className="mt-1 max-h-32 rounded-lg border border-border object-cover"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-video" className="text-muted-foreground">
              Video link (optional)
            </Label>
            <Input
              id="product-video"
              value={videoUrl}
              placeholder="https://youtube.com/… (the AI shares when asked)"
              onChange={(e) => setVideoUrl(e.target.value)}
            />
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
              'Add product'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
