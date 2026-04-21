/**
 * Module: Merchant Copilot
 * Tools: sales report, inventory alerts, top products, create discount, update product, tag customer
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getShopifyClient } from '../../lib/shopify.js'

export function registerMerchantCopilotTools(server: McpServer) {

  // ─── Sales Report ─────────────────────────────────────────────
  server.tool(
    'get_sales_report',
    'Get a sales report for a given date range: revenue, orders count, AOV',
    {
      agent_id: z.string(),
      from: z.string().describe('Start date ISO format e.g. 2024-01-01'),
      to: z.string().describe('End date ISO format e.g. 2024-01-31'),
    },
    async ({ agent_id, from, to }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const params = new URLSearchParams({
        created_at_min: from,
        created_at_max: to,
        status: 'any',
        limit: '250',
      })
      const data = await shopifyFetch(`/orders.json?${params}`)
      const orders = data.orders ?? []

      const revenue = orders.reduce((sum: number, o: any) => sum + parseFloat(o.total_price), 0)
      const aov = orders.length > 0 ? revenue / orders.length : 0

      // Revenue by day
      const byDay: Record<string, number> = {}
      orders.forEach((o: any) => {
        const day = o.created_at.split('T')[0]
        byDay[day] = (byDay[day] ?? 0) + parseFloat(o.total_price)
      })

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            period: { from, to },
            orders_count: orders.length,
            revenue: revenue.toFixed(2),
            aov: aov.toFixed(2),
            currency: orders[0]?.currency ?? 'EUR',
            revenue_by_day: byDay,
          }, null, 2)
        }]
      }
    }
  )

  // ─── Inventory Alerts ─────────────────────────────────────────
  server.tool(
    'get_inventory_alerts',
    'List products with low or zero stock',
    {
      agent_id: z.string(),
      threshold: z.number().default(5).describe('Alert when stock is below this quantity'),
    },
    async ({ agent_id, threshold }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const data = await shopifyFetch('/products.json?limit=250')
      const products = data.products ?? []

      const alerts: any[] = []
      products.forEach((p: any) => {
        p.variants?.forEach((v: any) => {
          if (v.inventory_management === 'shopify' && v.inventory_quantity <= threshold) {
            alerts.push({
              product_id: p.id,
              product_title: p.title,
              variant_id: v.id,
              variant_title: v.title !== 'Default Title' ? v.title : null,
              stock: v.inventory_quantity,
              status: v.inventory_quantity === 0 ? 'out_of_stock' : 'low_stock',
            })
          }
        })
      })

      alerts.sort((a, b) => a.stock - b.stock)
      return { content: [{ type: 'text', text: JSON.stringify(alerts, null, 2) }] }
    }
  )

  // ─── Top Products ─────────────────────────────────────────────
  server.tool(
    'get_top_products',
    'Get best-selling products for a given period',
    {
      agent_id: z.string(),
      from: z.string(),
      to: z.string(),
      limit: z.number().min(1).max(20).default(10),
    },
    async ({ agent_id, from, to, limit }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const params = new URLSearchParams({
        created_at_min: from,
        created_at_max: to,
        status: 'any',
        limit: '250',
      })
      const data = await shopifyFetch(`/orders.json?${params}`)
      const orders = data.orders ?? []

      const productStats: Record<string, { title: string; quantity: number; revenue: number }> = {}
      orders.forEach((o: any) => {
        o.line_items?.forEach((li: any) => {
          const key = String(li.product_id)
          if (!productStats[key]) {
            productStats[key] = { title: li.title, quantity: 0, revenue: 0 }
          }
          productStats[key].quantity += li.quantity
          productStats[key].revenue += parseFloat(li.price) * li.quantity
        })
      })

      const top = Object.entries(productStats)
        .map(([id, stats]) => ({ product_id: id, ...stats, revenue: stats.revenue.toFixed(2) }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue))
        .slice(0, limit)

      return { content: [{ type: 'text', text: JSON.stringify(top, null, 2) }] }
    }
  )

  // ─── Create Discount ──────────────────────────────────────────
  server.tool(
    'create_discount',
    'Create a percentage or fixed discount code in Shopify',
    {
      agent_id: z.string(),
      code: z.string().describe('Discount code e.g. WELCOME10'),
      type: z.enum(['percentage', 'fixed_amount']),
      value: z.number().describe('10 for 10% or 10 for 10€'),
      usage_limit: z.number().optional().describe('Max number of uses'),
      expires_at: z.string().optional().describe('Expiry date ISO format'),
    },
    async ({ agent_id, code, type, value, usage_limit, expires_at }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const body = {
        price_rule: {
          title: code,
          target_type: 'line_item',
          target_selection: 'all',
          allocation_method: 'across',
          value_type: type,
          value: type === 'percentage' ? `-${value}` : `-${value}`,
          customer_selection: 'all',
          starts_at: new Date().toISOString(),
          ...(expires_at ? { ends_at: expires_at } : {}),
          ...(usage_limit ? { usage_limit } : {}),
        },
      }

      const ruleData = await shopifyFetch('/price_rules.json', {
        method: 'POST',
        body: JSON.stringify(body),
      })

      const couponData = await shopifyFetch(
        `/price_rules/${ruleData.price_rule.id}/discount_codes.json`,
        { method: 'POST', body: JSON.stringify({ discount_code: { code } }) }
      )

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            code: couponData.discount_code.code,
            type,
            value,
            usage_limit: usage_limit ?? 'unlimited',
            expires_at: expires_at ?? 'never',
          }, null, 2)
        }]
      }
    }
  )

  // ─── Tag Customer ─────────────────────────────────────────────
  server.tool(
    'tag_customer',
    'Add tags to a Shopify customer for segmentation',
    {
      agent_id: z.string(),
      customer_id: z.string(),
      tags: z.array(z.string()).describe('Tags to add e.g. ["vip", "at-risk"]'),
    },
    async ({ agent_id, customer_id, tags }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)

      // Get existing tags first
      const existing = await shopifyFetch(`/customers/${customer_id}.json`)
      const currentTags: string[] = (existing.customer.tags ?? '').split(',').map((t: string) => t.trim()).filter(Boolean)
      const merged = Array.from(new Set([...currentTags, ...tags]))

      const updated = await shopifyFetch(`/customers/${customer_id}.json`, {
        method: 'PUT',
        body: JSON.stringify({ customer: { id: customer_id, tags: merged.join(', ') } }),
      })

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ customer_id, tags: updated.customer.tags }, null, 2)
        }]
      }
    }
  )

  // ─── Cancel Order ─────────────────────────────────────────────
  server.tool(
    'cancel_order',
    'Cancel a Shopify order and optionally notify the customer',
    {
      agent_id: z.string(),
      order_id: z.string(),
      reason: z.enum(['customer', 'inventory', 'fraud', 'declined', 'other']).default('customer'),
      notify_customer: z.boolean().default(true),
    },
    async ({ agent_id, order_id, reason, notify_customer }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const data = await shopifyFetch(`/orders/${order_id}/cancel.json`, {
        method: 'POST',
        body: JSON.stringify({ reason, email: notify_customer }),
      })
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ order_id, status: 'cancelled', reason }, null, 2)
        }]
      }
    }
  )
}
