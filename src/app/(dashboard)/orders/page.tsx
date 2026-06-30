'use client';

// Orders dashboard — lists AI-checkout orders with quantity, full price,
// contact + delivery details, order number, status, and an admin
// confirmation checkbox.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShoppingBag } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import type { Order, OrderItem, OrderStatus } from '@/types';

const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  AWAITING_VERIFICATION: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  SUCCESS: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  FAILED: 'border-red-500/40 bg-red-500/10 text-red-300',
  EXPIRED: 'border-border bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Pending payment',
  AWAITING_VERIFICATION: 'Awaiting verification',
  SUCCESS: 'Paid',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
};

function itemsSummary(items?: OrderItem[] | null): string {
  if (!items || items.length === 0) return '—';
  return items.map((i) => `${i.name} × ${i.quantity}`).join(', ');
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/orders', { cache: 'no-store' });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        toast.error(p.error || 'Failed to load orders');
        return;
      }
      const data = (await res.json()) as { orders: Order[] };
      setOrders(data.orders);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleConfirm(order: Order, confirmed: boolean) {
    setSaving(order.id);
    // Optimistic.
    setOrders((prev) =>
      prev.map((o) =>
        o.id === order.id ? { ...o, confirmed_at: confirmed ? new Date().toISOString() : null } : o,
      ),
    );
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        toast.error(p.error || 'Failed to update');
        await load(); // revert to server truth
        return;
      }
    } catch {
      toast.error('Could not reach the server');
      await load();
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Orders placed through the AI checkout assistant. Tick “Confirmed” once
          you’ve verified and accepted an order.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center">
          <ShoppingBag className="size-7 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No orders yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            When a customer completes the AI checkout, their order appears here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div
              key={o.id}
              className="rounded-xl border border-border bg-card p-4 sm:flex sm:items-start sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {o.order_number ? `Order #${o.order_number}` : 'Order'}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[o.status]}`}
                  >
                    {STATUS_LABEL[o.status]}
                  </span>
                  {o.payment_method === 'bank_transfer' && (
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      🏦 Bank transfer
                    </span>
                  )}
                  {o.slip_url && (
                    <a
                      href={o.slip_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                    >
                      🧾 View slip
                    </a>
                  )}
                  <span className="text-xs text-muted-foreground">{fmtDate(o.created_at)}</span>
                </div>

                <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <p className="text-foreground">
                    🛒 {itemsSummary(o.items)}
                  </p>
                  <p className="text-foreground">
                    💰 <span className="font-medium">{o.currency} {Number(o.amount).toLocaleString()}</span>
                  </p>
                  <p className="text-muted-foreground">
                    👤 {o.customer_name || '—'}
                  </p>
                  <p className="text-muted-foreground">
                    📞 {o.delivery_phone || o.phone}
                  </p>
                  <p className="text-muted-foreground sm:col-span-2">
                    📍 {o.delivery_address || '—'}
                  </p>
                  {o.items?.[0]?.customization && (
                    <p className="text-muted-foreground sm:col-span-2">
                      🎨 {o.items[0].customization}
                    </p>
                  )}
                </div>
              </div>

              <label className="mt-3 flex shrink-0 cursor-pointer items-center gap-2 sm:mt-0">
                <Checkbox
                  checked={!!o.confirmed_at}
                  disabled={saving === o.id}
                  onCheckedChange={(c) => toggleConfirm(o, c === true)}
                />
                <span className="text-xs text-muted-foreground">Confirmed</span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
