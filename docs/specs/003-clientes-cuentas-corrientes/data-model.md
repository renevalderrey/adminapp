# Data Model: Clientes y Cuentas Corrientes (Bloque 3)

## ER Diagram

```mermaid
erDiagram
    customers ||--o{ sales : "compra"
    customers ||--o{ customer_payments : "paga"
    sales ||--o{ sale_items : "contiene"

    customers {
        int id PK
        string name "Nombre/Razón social"
        string tax_id "CUIT/DNI"
        string email
        string phone
        text address
        string tax_condition "monotributo | ri | exento | consumidor_final"
        text notes
        boolean is_active
    }

    customer_payments {
        int id PK
        int customer_id FK
        decimal amount
        date payment_date
        string payment_method "ef | tr | td | tc | qr"
        string reference "Número de recibo"
        text notes
    }

    sales {
        string id PK
        int customer_id FK "NULL = Consumidor Final"
        string customer_name "Snapshot al momento de venta"
        date date
        string time
        decimal total
        string payment_method
    }
```

## Formulas

### Debt Calculation
```
Saldo_Deudor = Σ(ventas) - Σ(pagos)
```

### Aging Buckets
```
0-30 días: ventas con fecha entre hoy-30 y hoy
31-60 días: ventas con fecha entre hoy-60 y hoy-31
61-90 días: ventas con fecha entre hoy-90 y hoy-61
90+ días: ventas con fecha anterior a hoy-90
```

### Ranking
```
Total_Comprado = Σ(total_ventas) histórico
Frecuencia = count(ventas) / meses_desde_primera_compra
Última_Compra = max(fecha_venta)
```
