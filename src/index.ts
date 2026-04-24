/**
 * Altwork MCP Server — Shopify AI Agent
 * Transport: Streamable HTTP (Railway-compatible)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer, IncomingMessage, ServerResponse } from 'node:http'

import { registerEngagementTools } from './tools/engagement/index.js'
import { registerCustomerIntelligenceTools } from './tools/customer-intelligence/index.js'
import { registerMerchantCopilotTools } from './tools/merchant-copilot/index.js'

// ─── Create MCP Server ────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'altwork-shopify',
  version: '1.0.0',
})

// ─── Register all tool modules ────────────────────────────────────────────────

registerEngagementTools(server)
registerCustomerIntelligenceTools(server)
registerMerchantCopilotTools(server)

// ─── HTTP transport (Railway / VPS compatible) ────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000', 10)

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', server: 'altwork-mcp', version: '1.0.0' }))
    return
  }

  // MCP endpoint
  if (req.url === '/mcp') {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode — Railway-friendly
    })
    // In stateless mode, create a fresh server instance per request
    const requestServer = new McpServer({
      name: 'altwork-shopify',
      version: '1.0.0',
    })
    registerEngagementTools(requestServer)
    registerCustomerIntelligenceTools(requestServer)
    registerMerchantCopilotTools(requestServer)
    await requestServer.connect(transport)
    await transport.handleRequest(req, res)
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

httpServer.listen(PORT, () => {
  console.log(`✅ Altwork MCP Server running on port ${PORT}`)
  console.log(`   Health: http://localhost:${PORT}/health`)
  console.log(`   MCP:    http://localhost:${PORT}/mcp`)
})