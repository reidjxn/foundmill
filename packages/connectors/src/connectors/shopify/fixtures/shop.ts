/** Deterministic Shopify fixtures for Northwind Skincare's store. */
import type { ShCustomer, ShOrder, ShProduct, ShShop } from "../tools";

export const MOCK_SHOP_DOMAIN = "northwind-skincare.myshopify.com";
export const MOCK_SHOPIFY_WEBHOOK_SECRET = "shpss_mock_client_secret";
export const MOCK_SHOPIFY_ACCESS_TOKEN = "shpat_mock_access_token";

export const SH_SHOP: ShShop = { id: 71_234_501, name: "Northwind Skincare", domain: "shop.northwindskincare.com", myshopify_domain: MOCK_SHOP_DOMAIN, currency: "EUR", plan_name: "basic", email: "hello@northwindskincare.com" };

export const SH_PRODUCTS: ShProduct[] = [
  { id: 8_001_000_001, title: "Gentle Cleanser 150 ml", handle: "gentle-cleanser", status: "active", vendor: "Northwind", product_type: "Cleanser", variants: [{ id: 44_001, title: "Default", sku: "NW-CLN-150", price: "18.00", inventory_quantity: 212 }] },
  { id: 8_001_000_002, title: "Barrier Cream 50 ml", handle: "barrier-cream", status: "active", vendor: "Northwind", product_type: "Moisturiser", variants: [{ id: 44_002, title: "Default", sku: "NW-BAR-050", price: "29.00", inventory_quantity: 148 }] },
  { id: 8_001_000_003, title: "Autumn Routine Kit", handle: "autumn-routine-kit", status: "active", vendor: "Northwind", product_type: "Kit", variants: [{ id: 44_003, title: "Default", sku: "NW-KIT-AUT", price: "49.00", inventory_quantity: 63 }] },
  { id: 8_001_000_004, title: "Creator Seeding Kit", handle: "creator-seeding-kit", status: "draft", vendor: "Northwind", product_type: "Kit", variants: [{ id: 44_004, title: "Default", sku: "NW-KIT-SEED", price: "0.00", inventory_quantity: 40 }] },
];

export const SH_CUSTOMERS: ShCustomer[] = [
  { id: 6_100_000_001, email: "anna.lind@example.com", first_name: "Anna", last_name: "Lind", orders_count: 3, total_spent: "116.00", created_at: "2026-06-11T10:02:00Z", email_marketing_consent: { state: "subscribed" }, tags: "vip" },
  { id: 6_100_000_002, email: "lotta@brightdental.se", first_name: "Lotta", last_name: "Ek", orders_count: 1, total_spent: "49.00", created_at: "2026-10-02T13:45:00Z", email_marketing_consent: { state: "not_subscribed" }, tags: "" },
  { id: 6_100_000_003, email: "maja@sensitiveskinclub.se", first_name: "Maja", last_name: "Berg", orders_count: 0, total_spent: "0.00", created_at: "2026-10-04T08:20:00Z", email_marketing_consent: { state: "subscribed" }, tags: "creator" },
];

export const SH_ORDERS: ShOrder[] = [
  { id: 5_500_000_031, name: "#1031", created_at: "2026-10-02T13:46:10Z", financial_status: "paid", fulfillment_status: null, cancelled_at: null, currency: "EUR", total_price: "49.00", subtotal_price: "49.00", customer: { id: 6_100_000_002, email: "lotta@brightdental.se", orders_count: 1 }, email: "lotta@brightdental.se", line_items: [{ id: 1, title: "Autumn Routine Kit", sku: "NW-KIT-AUT", quantity: 1, price: "49.00", variant_id: 44_003 }], discount_codes: [{ code: "MAJA10" }], source_name: "web", landing_site: "/products/autumn-routine-kit?utm_source=instagram&utm_medium=social&utm_campaign=autumn", referring_site: "https://www.instagram.com/", tags: "" },
  { id: 5_500_000_030, name: "#1030", created_at: "2026-09-27T09:12:44Z", financial_status: "paid", fulfillment_status: "fulfilled", cancelled_at: null, currency: "EUR", total_price: "47.00", subtotal_price: "47.00", customer: { id: 6_100_000_001, email: "anna.lind@example.com", orders_count: 3 }, email: "anna.lind@example.com", line_items: [{ id: 2, title: "Gentle Cleanser 150 ml", sku: "NW-CLN-150", quantity: 1, price: "18.00", variant_id: 44_001 }, { id: 3, title: "Barrier Cream 50 ml", sku: "NW-BAR-050", quantity: 1, price: "29.00", variant_id: 44_002 }], discount_codes: [], source_name: "web", landing_site: "/", referring_site: null, tags: "repeat" },
  { id: 5_500_000_029, name: "#1029", created_at: "2026-09-20T18:03:00Z", financial_status: "pending", fulfillment_status: null, cancelled_at: null, currency: "EUR", total_price: "29.00", subtotal_price: "29.00", customer: null, email: "guest@example.com", line_items: [{ id: 4, title: "Barrier Cream 50 ml", sku: "NW-BAR-050", quantity: 1, price: "29.00", variant_id: 44_002 }], discount_codes: [], source_name: "web", landing_site: "/products/barrier-cream", referring_site: "https://www.google.com/", tags: "" },
];
