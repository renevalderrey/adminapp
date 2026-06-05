# API Contracts: Flujo de Caja e Impuestos

## GET /api/cashflow/balance
Current balance and summary.

### Response
```json
{
  "ok": true,
  "data": {
    "balance": 150000,
    "total_inflows_30d": 500000,
    "total_outflows_30d": 350000,
    "projected_30d": 300000,
    "projected_60d": 200000
  }
}
```

## GET /api/cashflow/movements
Paginated list of all cash movements.

### Response
```json
{
  "ok": true,
  "data": [
    { "id": 1, "source": "sale", "type": "inflow", "amount": 5000, "date": "2026-05-30", "description": "Venta #123" }
  ],
  "total": 100
}
```

## POST /api/cashflow/entries
Manual cash flow entry.

### Request
```json
{
  "type": "inflow",
  "category": "prestamo",
  "amount": 50000,
  "entry_date": "2026-05-30",
  "description": "Préstamo bancario",
  "reference": ""
}
```

## GET /api/taxes/config
Get tax configuration.

## PUT /api/taxes/config
Update tax config (monotributo scales, IIBB rate).

## GET /api/taxes/calculation
Auto-calculate tax due based on billing.

## POST /api/taxes/payments
Register tax payment.
