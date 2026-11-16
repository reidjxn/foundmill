/**
 * Shopify (phase 2): read the shop, orders, products and customers; create draft orders (influencer seeding,
 * BUILD §11.7). `orders/create` / `orders/paid` webhooks become `payment.received` (BUILD §11.4). Refunds move
 * money and are a hard gate; cancelling an order is irreversible.
 */
import { z } from "zod";
import { defineTool } from "../../define";
import { minorFromDecimal } from "../../mock-utils";

export const SHOPIFY_KEY = "shopify";
export const SHOPIFY_API_VERSION = "2025-10";
export const SHOPIFY_SCOPES = ["read_orders", "read_products", "read_customers", "write_draft_orders"];

export const shopBaseUrl = (shop: string): string => `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;
export const ShopDomain = z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, "shop domain like example.myshopify.com");

const Money = z.object({ amountMinor: z.number().int(), currency: z.string().length(3) });

export const Order = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  financialStatus: z.string().nullable(),
  fulfillmentStatus: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  total: Money,
  subtotal: Money.nullable(),
  customer: z.object({ id: z.string(), email: z.string().nullable(), ordersCount: z.number().int().nullable() }).nullable(),
  email: z.string().nullable(),
  lineItems: z.array(z.object({ title: z.string(), sku: z.string().nullable(), quantity: z.number().int(), price: Money })),
  discountCodes: z.array(z.string()),
  sourceName: z.string().nullable(),
  landingSite: z.string().nullable(),
  referringSite: z.string().nullable(),
  tags: z.array(z.string()),
});
export type OrderT = z.infer<typeof Order>;

export const Product = z.object({ id: z.string(), title: z.string(), handle: z.string(), status: z.string(), vendor: z.string().nullable(), productType: z.string().nullable(), variants: z.array(z.object({ id: z.string(), title: z.string(), sku: z.string().nullable(), price: z.string(), inventoryQuantity: z.number().int().nullable() })) });
export const Customer = z.object({ id: z.string(), email: z.string().nullable(), firstName: z.string().nullable(), lastName: z.string().nullable(), ordersCount: z.number().int(), totalSpent: z.string(), createdAt: z.string(), acceptsMarketing: z.boolean(), tags: z.array(z.string()) });
export const DraftOrder = z.object({ id: z.string(), name: z.string(), status: z.string(), invoiceUrl: z.string().nullable(), total: Money, lineItems: z.array(z.object({ title: z.string(), quantity: z.number().int(), variantId: z.string().nullable() })) });

const Limit = z.number().int().min(1).max(250).default(50);

export const shopifyTools = [
  defineTool({ name: "get_shop", description: "The connected shop: name, domain, currency, plan.", input: z.object({}), output: z.object({ id: z.string(), name: z.string(), domain: z.string(), myshopifyDomain: z.string(), currency: z.string(), planName: z.string().nullable(), email: z.string().nullable() }), hints: {}, annotations: { readOnlyHint: true } }),
  defineTool({ name: "list_orders", description: "Orders, newest first; filter by financial status or creation date.", input: z.object({ financialStatus: z.enum(["any", "paid", "pending", "refunded", "partially_refunded", "voided", "authorized"]).default("any"), createdAtMin: z.iso.datetime({ offset: true }).optional(), limit: Limit }), output: z.object({ items: z.array(Order) }), hints: {}, untrusted: "api", untrustedRef: (a) => `orders:${a.financialStatus}`, annotations: { readOnlyHint: true } }),
  defineTool({ name: "get_order", description: "One order with its line items and attribution fields.", input: z.object({ orderId: z.string().regex(/^\d+$/, "numeric id") }), output: Order, hints: {}, untrusted: "api", untrustedRef: (a) => `order:${a.orderId}`, annotations: { readOnlyHint: true } }),
  defineTool({ name: "list_products", description: "Products with variants, prices and inventory.", input: z.object({ status: z.enum(["active", "draft", "archived"]).optional(), limit: Limit }), output: z.object({ items: z.array(Product) }), hints: {}, untrusted: "api", untrustedRef: (a) => `products:${a.status ?? "all"}`, annotations: { readOnlyHint: true } }),
  defineTool({ name: "list_customers", description: "Customers; filter by exact email.", input: z.object({ email: z.email().optional(), limit: Limit }), output: z.object({ items: z.array(Customer) }), hints: {}, untrusted: "api", untrustedRef: (a) => `customers:${a.email ?? "all"}`, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "create_draft_order", annotations: { readOnlyHint: false },
    description: "Create a draft order (e.g. a seeding kit for an influencer, 100% discount allowed). Nothing ships or charges until a human completes it in Shopify.",
    input: z.object({ email: z.email(), lineItems: z.array(z.object({ variantId: z.string().regex(/^\d+$/).optional(), title: z.string().min(1).max(255).optional(), quantity: z.number().int().positive().default(1), priceMinor: z.number().int().nonnegative().optional() }).refine((l) => l.variantId || (l.title && l.priceMinor !== undefined), { message: "variantId or title + priceMinor" })).min(1).max(50), discountPercent: z.number().min(0).max(100).optional(), note: z.string().max(5000).optional(), tags: z.array(z.string().max(40)).max(20).default([]) }),
    output: DraftOrder,
    hints: {},
  }),
  defineTool({ name: "cancel_order", description: "Cancel an unfulfilled order (no refund is issued here). Irreversible.", input: z.object({ orderId: z.string().regex(/^\d+$/), reason: z.enum(["customer", "inventory", "fraud", "declined", "other"]).default("other") }), output: z.object({ cancelled: z.literal(true), orderId: z.string(), cancelledAt: z.string() }), hints: { irreversible: true } }),
  defineTool({
    name: "refund_order",
    description: "HARD GATE (BUILD §2.2): refunds move money back to the customer; the founder issues them in Shopify.",
    input: z.object({ orderId: z.string().regex(/^\d+$/), amountMinor: z.number().int().positive().optional(), reason: z.string().max(1000).optional() }),
    hints: { hardGate: true, spendsMoney: true, irreversible: true },
    humanAction: (a) => ({ title: `Refund order ${a.orderId}`, instructions: `Open the order in Shopify admin and refund ${a.amountMinor ? `${(a.amountMinor / 100).toFixed(2)}` : "the amount you decide"} if you agree.${a.reason ? ` Why: ${a.reason}` : ""} Agents cannot move money.`, url: `https://admin.shopify.com/orders/${a.orderId}` }),
  }),
] as const;

export const SHOPIFY_RATE_LIMITS = { perMinute: 120, perDay: 40_000 };

/* ---- Vendor shapes (REST Admin API subset) ---- */
export interface ShMoneySet { shop_money: { amount: string; currency_code: string } }
export interface ShLineItem { id?: number; title: string; sku?: string | null; quantity: number; price: string; variant_id?: number | null }
export interface ShOrder {
  id: number; name: string; created_at: string; financial_status?: string | null; fulfillment_status?: string | null; cancelled_at?: string | null; currency: string; total_price: string; subtotal_price?: string | null; total_price_set?: ShMoneySet;
  customer?: { id: number; email?: string | null; first_name?: string | null; last_name?: string | null; orders_count?: number | null } | null; email?: string | null; line_items: ShLineItem[]; discount_codes?: { code: string }[]; source_name?: string | null; landing_site?: string | null; referring_site?: string | null; tags?: string;
}
export interface ShProduct { id: number; title: string; handle: string; status: string; vendor?: string | null; product_type?: string | null; variants: { id: number; title: string; sku?: string | null; price: string; inventory_quantity?: number | null }[] }
export interface ShCustomer { id: number; email?: string | null; first_name?: string | null; last_name?: string | null; orders_count?: number; total_spent?: string; created_at: string; accepts_marketing?: boolean; email_marketing_consent?: { state?: string } | null; tags?: string }
export interface ShDraftOrder { id: number; name: string; status: string; invoice_url?: string | null; currency: string; total_price: string; line_items: { title: string; quantity: number; variant_id?: number | null }[]; note?: string | null; tags?: string }
export interface ShShop { id: number; name: string; domain: string; myshopify_domain: string; currency: string; plan_name?: string | null; email?: string | null }

const tags = (s: string | undefined): string[] => (s ?? "").split(",").map((t) => t.trim()).filter(Boolean);

export const mapOrder = (o: ShOrder): OrderT => ({
  id: String(o.id), name: o.name, createdAt: o.created_at, financialStatus: o.financial_status ?? null, fulfillmentStatus: o.fulfillment_status ?? null, cancelledAt: o.cancelled_at ?? null,
  total: { amountMinor: minorFromDecimal(o.total_price), currency: o.currency.toUpperCase() }, subtotal: o.subtotal_price ? { amountMinor: minorFromDecimal(o.subtotal_price), currency: o.currency.toUpperCase() } : null,
  customer: o.customer ? { id: String(o.customer.id), email: o.customer.email ?? null, ordersCount: o.customer.orders_count ?? null } : null, email: o.email ?? o.customer?.email ?? null,
  lineItems: o.line_items.map((l) => ({ title: l.title, sku: l.sku ?? null, quantity: l.quantity, price: { amountMinor: minorFromDecimal(l.price), currency: o.currency.toUpperCase() } })),
  discountCodes: (o.discount_codes ?? []).map((d) => d.code), sourceName: o.source_name ?? null, landingSite: o.landing_site ?? null, referringSite: o.referring_site ?? null, tags: tags(o.tags),
});
export const mapProduct = (p: ShProduct): z.infer<typeof Product> => ({ id: String(p.id), title: p.title, handle: p.handle, status: p.status, vendor: p.vendor ?? null, productType: p.product_type ?? null, variants: p.variants.map((v) => ({ id: String(v.id), title: v.title, sku: v.sku ?? null, price: v.price, inventoryQuantity: v.inventory_quantity ?? null })) });
export const mapCustomer = (c: ShCustomer): z.infer<typeof Customer> => ({ id: String(c.id), email: c.email ?? null, firstName: c.first_name ?? null, lastName: c.last_name ?? null, ordersCount: c.orders_count ?? 0, totalSpent: c.total_spent ?? "0.00", createdAt: c.created_at, acceptsMarketing: c.accepts_marketing ?? c.email_marketing_consent?.state === "subscribed", tags: tags(c.tags) });
export const mapDraftOrder = (d: ShDraftOrder): z.infer<typeof DraftOrder> => ({ id: String(d.id), name: d.name, status: d.status, invoiceUrl: d.invoice_url ?? null, total: { amountMinor: minorFromDecimal(d.total_price), currency: d.currency.toUpperCase() }, lineItems: d.line_items.map((l) => ({ title: l.title, quantity: l.quantity, variantId: l.variant_id ? String(l.variant_id) : null })) });
export const mapShop = (s: ShShop) => ({ id: String(s.id), name: s.name, domain: s.domain, myshopifyDomain: s.myshopify_domain, currency: s.currency.toUpperCase(), planName: s.plan_name ?? null, email: s.email ?? null });
