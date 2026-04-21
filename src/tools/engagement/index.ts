/**
 * Module: Engagement
 * Tools: order tracking, abandoned cart, send WhatsApp, send email
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getShopifyClient } from '../../lib/shopify.js'
import { sendWhatsApp, sendEmail } from '../../lib/messaging.js'

export function registerEngagementTools(server: McpServer) {

  // ─── Get Order ───────────────────────────────────────────────
  server.tool(
    'get_order',
    'Fetch a Shopify order by ID or order number',
    {
      agent_id: z.string().describe('Altwork agent ID'),
      order_id: z.string().describe('Shopify order ID or order number (e.g. #1001)'),
    },
    async ({ agent_id, order_id }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const data = await shopifyFetch(`/orders/${order_id}.json`)
      const o = data.order
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: o.id,
            name: o.name,
            status: o.fulfillment_status ?? 'unfulfilled',
            financial_status: o.financial_status,
            total_price: o.total_price,
            currency: o.currency,
            customer_email: o.email,
            customer_phone: o.phone,
            created_at: o.created_at,
            tracking_urls: o.fulfillments?.flatMap((f: any) => f.tracking_urls ?? []) ?? [],
          }, null, 2)
        }]
      }
    }
  )

  // ─── List Orders ─────────────────────────────────────────────
  server.tool(
    'list_orders',
    'List recent Shopify orders with optional filters',
    {
      agent_id: z.string(),
      status: z.enum(['open', 'closed', 'cancelled', 'any']).default('any'),
      limit: z.number().min(1).max(50).default(10),
      fulfillment_status: z.enum(['shipped', 'unshipped', 'partial', 'any']).optional(),
    },
    async ({ agent_id, status, limit, fulfillment_status }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const params = new URLSearchParams({
        status,
        limit: String(limit),
        ...(fulfillment_status ? { fulfillment_status } : {}),
      })
      const data = await shopifyFetch(`/orders.json?${params}`)
      const orders = data.orders.map((o: any) => ({
        id: o.id,
        name: o.name,
        status: o.fulfillment_status ?? 'unfulfilled',
        financial_status: o.financial_status,
        total_price: o.total_price,
        currency: o.currency,
        customer_email: o.email,
        created_at: o.created_at,
      }))
      return { content: [{ type: 'text', text: JSON.stringify(orders, null, 2) }] }
    }
  )

  // ─── Get Abandoned Checkouts ──────────────────────────────────
  server.tool(
    'get_abandoned_checkouts',
    'Fetch abandoned checkouts from the last N days',
    {
      agent_id: z.string(),
      days: z.number().min(1).max(30).default(7),
      limit: z.number().min(1).max(50).default(20),
    },
    async ({ agent_id, days, limit }) => {
      const { shopifyFetch } = await getShopifyClient(agent_id)
      const since = new Date(Date.now() - days * 86400000).toISOString()
      const params = new URLSearchParams({
        created_at_min: since,
        limit: String(limit),
        status: 'open',
      })
      const data = await shopifyFetch(`/checkouts.json?${params}`)
      const checkouts = data.checkouts.map((c: any) => ({
        id: c.id,
        token: c.token,
        customer_email: c.email,
        customer_phone: c.phone,
        total_price: c.total_price,
        currency: c.currency,
        abandoned_checkout_url: c.abandoned_checkout_url,
        created_at: c.created_at,
        line_items: c.line_items?.map((li: any) => ({
          title: li.title,
          quantity: li.quantity,
          price: li.price,
        })),
      }))
      return { content: [{ type: 'text', text: JSON.stringify(checkouts, null, 2) }] }
    }
  )

  // ─── Send WhatsApp ────────────────────────────────────────────
  server.tool(
    'send_whatsapp_message',
    'Send a WhatsApp message to a customer phone number',
    {
      to: z.string().describe('Phone number with country code, e.g. +33612345678'),
      message: z.string().describe('Message body'),
    },
    async ({ to, message }) => {
      const result = await sendWhatsApp(to, message)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )

  // ─── Send Email ───────────────────────────────────────────────
  server.tool(
    'send_email',
    'Send a transactional email to a customer',
    {
      to: z.string().email(),
      subject: z.string(),
      html: z.string().describe('HTML content of the email'),
    },
    async ({ to, subject, html }) => {
      const result = await sendEmail(to, subject, html)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
