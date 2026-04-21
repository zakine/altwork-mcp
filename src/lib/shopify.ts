/**
 * Shopify API client
 * Fetches the store token from Supabase and calls Shopify REST Admin API
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function getShopifyClient(agentId: string) {
  // Fetch the Shopify token stored after OAuth
  const { data, error } = await supabase
    .from('agents')
    .select('shopify_domain, shopify_access_token')
    .eq('id', agentId)
    .single()

  if (error || !data) {
    throw new Error(`Agent not found or no Shopify token: ${agentId}`)
  }

  const { shopify_domain, shopify_access_token } = data

  async function shopifyFetch(path: string, options?: RequestInit) {
    const url = `https://${shopify_domain}/admin/api/2024-10${path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        'X-Shopify-Access-Token': shopify_access_token,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Shopify API error ${res.status}: ${text}`)
    }
    return res.json()
  }

  return { shopifyFetch, shopify_domain }
}
