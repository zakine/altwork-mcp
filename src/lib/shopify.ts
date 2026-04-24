/**
 * Edge Function: shopify-webhook-order-created
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const MCP_SERVER_URL = Deno.env.get('MCP_SERVER_URL')!

// Parse SSE or JSON response from MCP server
async function parseMcpResponse(res: Response): Promise<unknown> {
  const text = await res.text()
  console.log('MCP raw response:', text.substring(0, 300))

  if (text.includes('data:')) {
    const lines = text.split('\n')
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const json = line.slice(5).trim()
        if (json) return JSON.parse(json)
      }
    }
  }

  return JSON.parse(text)
}

async function callMcpTool(toolName: string, args: Record<string, unknown>) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  }

  const res = await fetch(`${MCP_SERVER_URL}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  })

  console.log('MCP tool call status:', res.status, 'tool:', toolName)
  if (!res.ok) throw new Error(`MCP call failed: ${res.status}`)

  return parseMcpResponse(res)
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const body = await req.text()

  // HMAC désactivé temporairement pour test
  // if (!await verifyShopifyWebhook(req, body)) return new Response('Unauthorized', { status: 401 })

  const order = JSON.parse(body)
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? 'altwork-test.myshopify.com'

  console.log('Webhook received for domain:', shopDomain, 'order:', order.name)

  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('status', 'active')
    .contains('metadata', { shopify_url: shopDomain })
    .single()

  if (!agent) {
    console.log('Agent not found for domain:', shopDomain)
    return new Response(JSON.stringify({ error: 'Agent not found', domain: shopDomain }), { status: 200 })
  }

  console.log('Agent found:', agent.id)

  await supabase.from('agent_events').insert({
    agent_id: agent.id,
    type: 'order_created',
    payload: { order_id: order.id, order_name: order.name },
  })

  const customerId = String(order.customer?.id)
  const customerEmail = order.email
  const customerPhone = order.phone
  const firstName = order.customer?.first_name ?? ''

  if (!customerId || (!customerEmail && !customerPhone)) {
    return new Response(JSON.stringify({ skipped: 'no contact info' }), { status: 200 })
  }

  let recommendations: any[] = []
  try {
    const recoResult = await callMcpTool('recommend_products', {
      agent_id: agent.id,
      customer_id: customerId,
      limit: 2,
    }) as any

    const text = recoResult?.result?.content?.[0]?.text ?? '[]'
    recommendations = JSON.parse(text)
    console.log('Recommendations count:', recommendations.length)
  } catch (e: any) {
    console.log('Recommendations error:', e.message)
    // Continue without recommendations
  }

  if (recommendations.length === 0) {
    return new Response(JSON.stringify({ success: true, skipped: 'no recommendations' }), { status: 200 })
  }

  const reco = recommendations[0]

  try {
    if (customerPhone) {
      await callMcpTool('send_whatsapp_message', {
        to: customerPhone,
        message: `Hi ${firstName}! 🎉 Thanks for your order ${order.name}.\n\nYou might also love: *${reco.title}* — ${reco.price}€\n👉 ${reco.url}`,
      })
    } else if (customerEmail) {
      await callMcpTool('send_email', {
        to: customerEmail,
        subject: `${firstName ? `${firstName}, you` : 'You'} might love this too 🛍️`,
        html: `<h2>Thanks for your order ${order.name}!</h2>
               <p>Based on your purchase, we think you'll love:</p>
               <h3>${reco.title} — ${reco.price}€</h3>
               <a href="${reco.url}" style="background:#FF5C00;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:12px">Shop Now</a>`,
      })
    }
  } catch (e: any) {
    console.log('Messaging error:', e.message)
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})