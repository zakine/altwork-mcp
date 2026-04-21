# Altwork MCP Server — Shopify

Serveur MCP (Model Context Protocol) pour connecter les agents Altwork AI à Shopify.

## Architecture

```
src/
├── index.ts                          # Point d'entrée HTTP (Railway)
├── lib/
│   ├── shopify.ts                    # Client Shopify REST API
│   └── messaging.ts                  # Twilio WhatsApp + Resend email
└── tools/
    ├── engagement/                   # Order tracking, abandoned cart, messages
    ├── customer-intelligence/        # Profil client, RFM, recommandations, churn
    └── merchant-copilot/             # Reporting, stock, discounts, tags
```

## Outils disponibles

### Engagement
| Outil | Description |
|-------|-------------|
| `get_order` | Récupère une commande par ID |
| `list_orders` | Liste les commandes avec filtres |
| `get_abandoned_checkouts` | Paniers abandonnés des N derniers jours |
| `send_whatsapp_message` | Envoie un message WhatsApp via Twilio |
| `send_email` | Envoie un email transactionnel via Resend |

### Customer Intelligence
| Outil | Description |
|-------|-------------|
| `get_customer_profile` | Profil complet : historique, AOV, top produits |
| `get_customer_segments` | Segmentation RFM : Champion, Loyal, At Risk, Lost |
| `recommend_products` | Recommandations basées sur l'historique |
| `predict_churn_risk` | Clients à risque d'attrition |

### Merchant Copilot
| Outil | Description |
|-------|-------------|
| `get_sales_report` | CA, commandes, AOV sur une période |
| `get_inventory_alerts` | Produits en rupture ou stock faible |
| `get_top_products` | Bestsellers sur une période |
| `create_discount` | Crée un code promo Shopify |
| `tag_customer` | Tague un client pour la segmentation |
| `cancel_order` | Annule une commande avec notification |

## Déploiement Railway

1. `git push` sur le repo Railway
2. Variables d'env à configurer dans Railway Dashboard :
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_WHATSAPP_FROM`
   - `RESEND_API_KEY`

## Endpoint MCP

```
POST https://your-railway-url.railway.app/mcp
GET  https://your-railway-url.railway.app/health
```
