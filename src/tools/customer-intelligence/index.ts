/**
 * Module: Customer Intelligence
 * Tools: customer profile, segments RFM, product recommendations, churn risk
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getShopifyClient } from '../../lib/shopify.js'

export function registerCustomerIntelligenceTools(server: McpServer) {

  // ─── Get Customer Profile ─────────────────────────────────────
  server.tool(
    'get_customer_profile',
    'Get a full customer profile: history, AOV, favorite products, last order',
    {
      agent_id: z.string(),
      customer_id: z.string(),
    },
    async ({ agent_id, customer_id }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)

      const [customerData, ordersData] = await Promise.all([
        shopifyFetch(`/customers/${customer_id}.json`),
        shopifyFetch(`/customers/${customer_id}/orders.json?status=any&limit=50`),
      ])

      const c = customerData.customer
      const orders = ordersData.orders ?? []

      // Compute stats
      const totalSpent = orders.reduce((sum: number, o: any) => sum + parseFloat(o.total_price), 0)
      const aov = orders.length > 0 ? totalSpent / orders.length : 0

      // Top products
      const productCount: Record<string, { title: string; count: number }> = {}
      orders.forEach((o: any) => {
        o.line_items?.forEach((li: any) => {
          if (!productCount[li.product_id]) {
            productCount[li.product_id] = { title: li.title, count: 0 }
          }
          productCount[li.product_id].count += li.quantity
        })
      })
      const topProducts = Object.values(productCount)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)

      // Days since last order
      const lastOrder = orders[0]
      const daysSinceLastOrder = lastOrder
        ? Math.floor((Date.now() - new Date(lastOrder.created_at).getTime()) / 86400000)
        : null

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: c.id,
            email: c.email,
            phone: c.phone,
            first_name: c.first_name,
            last_name: c.last_name,
            orders_count: c.orders_count,
            total_spent: totalSpent.toFixed(2),
            aov: aov.toFixed(2),
            currency: orders[0]?.currency ?? 'EUR',
            top_products: topProducts,
            days_since_last_order: daysSinceLastOrder,
            tags: c.tags,
            accepts_marketing: c.email_marketing_consent?.state === 'subscribed',
          }, null, 2)
        }]
      }
    }
  )

  // ─── Get Customer Segments (RFM) ──────────────────────────────
  server.tool(
    'get_customer_segments',
    'Segment customers by RFM score: Champions, Loyal, At Risk, Lost, New',
    {
      agent_id: z.string(),
      limit: z.number().min(1).max(250).default(50),
    },
    async ({ agent_id, limit }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const data = await shopifyFetch(`/customers.json?limit=${limit}`)
      const customers = data.customers

      const now = Date.now()
      const scored = customers.map((c: any) => {
        const daysSince = c.last_order_date
          ? Math.floor((now - new Date(c.last_order_date).getTime()) / 86400000)
          : 999
        const frequency = c.orders_count ?? 0
        const monetary = parseFloat(c.total_spent ?? '0')

        let segment = 'Unknown'
        if (daysSince <= 30 && frequency >= 3 && monetary >= 200) segment = 'Champion'
        else if (daysSince <= 60 && frequency >= 2) segment = 'Loyal'
        else if (daysSince <= 90 && frequency >= 1) segment = 'Promising'
        else if (daysSince > 90 && daysSince <= 180) segment = 'At Risk'
        else if (daysSince > 180) segment = 'Lost'
        else if (frequency === 1) segment = 'New'

        return {
          id: c.id,
          email: c.email,
          segment,
          days_since_last_order: daysSince === 999 ? null : daysSince,
          orders_count: frequency,
          total_spent: monetary.toFixed(2),
        }
      })

      // Group by segment
      const grouped = scored.reduce((acc: any, c: any) => {
        if (!acc[c.segment]) acc[c.segment] = []
        acc[c.segment].push(c)
        return acc
      }, {})

      return { content: [{ type: 'text', text: JSON.stringify(grouped, null, 2) }] }
    }
  )

  // ─── Recommend Products ───────────────────────────────────────
  server.tool(
    'recommend_products',
    'Recommend products to a customer based on their purchase history',
    {
      agent_id: z.string(),
      customer_id: z.string(),
      limit: z.number().min(1).max(10).default(3),
    },
    async ({ agent_id, customer_id, limit }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)

      const [ordersData, productsData] = await Promise.all([
        shopifyFetch(`/customers/${customer_id}/orders.json?status=any&limit=20`),
        shopifyFetch(`/products.json?limit=50`),
      ])

      const orders = ordersData.orders ?? []
      const allProducts = productsData.products ?? []

      // Products already purchased
      const purchasedIds = new Set(
        orders.flatMap((o: any) => o.line_items?.map((li: any) => String(li.product_id)) ?? [])
      )

      // Collect purchased categories/tags
      const purchasedTags = new Set(
        orders.flatMap((o: any) =>
          o.line_items?.flatMap((li: any) => (li.vendor ?? '').split(',')) ?? []
        )
      )

      // Score unpurchased products
      const recommendations = allProducts
        .filter((p: any) => !purchasedIds.has(String(p.id)))
        .map((p: any) => {
          const tags: string[] = (p.tags ?? '').split(',').map((t: string) => t.trim())
          const overlap = tags.filter(t => purchasedTags.has(t)).length
          return {
            id: p.id,
            title: p.title,
            price: p.variants?.[0]?.price,
            url: `https://${p.handle}`,
            score: overlap,
          }
        })
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, limit)

      return { content: [{ type: 'text', text: JSON.stringify(recommendations, null, 2) }] }
    }
  )

  // ─── Predict Churn Risk ───────────────────────────────────────
  server.tool(
    'predict_churn_risk',
    'Identify customers at high risk of churning based on inactivity',
    {
      agent_id: z.string(),
      inactivity_days: z.number().default(90).describe('Days without order to flag as at-risk'),
      limit: z.number().min(1).max(100).default(20),
    },
    async ({ agent_id, inactivity_days, limit }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const data = await shopifyFetch(`/customers.json?limit=${limit}`)
      const customers = data.customers

      const now = Date.now()
      const atRisk = customers
        .filter((c: any) => {
          if (!c.last_order_date) return false
          const days = Math.floor((now - new Date(c.last_order_date).getTime()) / 86400000)
          return days >= inactivity_days
        })
        .map((c: any) => {
          const days = Math.floor((now - new Date(c.last_order_date).getTime()) / 86400000)
          return {
            id: c.id,
            email: c.email,
            phone: c.phone,
            days_inactive: days,
            orders_count: c.orders_count,
            total_spent: c.total_spent,
            risk_level: days > 180 ? 'high' : 'medium',
          }
        })
        .sort((a: any, b: any) => b.days_inactive - a.days_inactive)

      return { content: [{ type: 'text', text: JSON.stringify(atRisk, null, 2) }] }
    }
  )
}
