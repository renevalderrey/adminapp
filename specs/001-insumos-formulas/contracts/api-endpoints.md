# API Contracts: Insumos, Fórmulas y Recetas (Bloque 1)

Este documento detalla los endpoints nuevos y modificados para soportar el módulo de Recetas e Insumos.

---

## 1. Endpoints Modificados

### 1.1 `POST /api/products` (Crear Producto)
Soporta los nuevos campos opcionales para canal mayorista.

* **Cuerpo de la Petición (`application/json`)**:
  ```json
  {
    "name": "Suero de Leche Concentrado 1kg",
    "sku": "SL-1000",
    "cost": 1200.00,
    "brand_id": 1,
    "category": "materia-prima",
    "margin_override": 40.00,
    "price_override": null,
    "wholesale_margin": 25.00,
    "wholesale_price": null
  }
  ```
* **Respuesta Exitosa (`201 Created`)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": 45,
      "name": "Suero de Leche Concentrado 1kg",
      "sku": "SL-1000",
      "cost": "1200.00",
      "brand_id": 1,
      "category": "materia-prima",
      "margin_override": "40.00",
      "price_override": null,
      "wholesale_margin": "25.00",
      "wholesale_price": null,
      "is_active": true,
      "updatedAt": "2026-05-30T22:00:00.000Z",
      "createdAt": "2026-05-30T22:00:00.000Z"
    }
  }
  ```

### 1.2 `PUT /api/products/:id` (Actualizar Producto)
Soporta la edición de costos y campos mayoristas. **Nota**: Si se actualiza el `cost` y este producto es ingrediente de alguna receta activa, el servidor ejecutará el recálculo en cascada para todos los productos dependientes de forma automática y síncrona.

* **Cuerpo de la Petición (`application/json`)**:
  ```json
  {
    "cost": 1350.00
  }
  ```
* **Respuesta Exitosa (`200 OK`)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": 45,
      "cost": "1350.00",
      ...
    }
  }
  ```

---

## 2. Endpoints Nuevos (Recetas)

### 2.1 `GET /api/products/:id/recipe` (Obtener Receta)
Retorna la receta asociada a un producto con la lista de sus ingredientes y costos calculados.

* **Respuesta Exitosa (`200 OK`)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": 5,
      "product_id": 10,
      "loss_percentage": "5.00",
      "yield": "1.0000",
      "items": [
        {
          "id": 12,
          "recipe_id": 5,
          "ingredient_product_id": 45,
          "quantity": "0.9500",
          "ingredient": {
            "id": 45,
            "name": "Suero de Leche Concentrado 1kg",
            "cost": "1350.00"
          }
        },
        {
          "id": 13,
          "recipe_id": 5,
          "ingredient_product_id": 46,
          "quantity": "0.0500",
          "ingredient": {
            "id": 46,
            "name": "Saborizante Vainilla 1kg",
            "cost": "500.00"
          }
        }
      ]
    }
  }
  ```
* **Respuesta cuando no tiene receta (`200 OK`)**:
  ```json
  {
    "ok": true,
    "data": null
  }
  ```

### 2.2 `POST /api/products/:id/recipe` (Crear o Modificar Receta)
Crea o actualiza la receta para el producto especificado en el `:id`, definiendo ingredientes, cantidades, mermas y rendimientos. El backend recalcula síncronamente el costo final del producto terminado.

* **Cuerpo de la Petición (`application/json`)**:
  ```json
  {
    "loss_percentage": 5.00,
    "yield": 1.0,
    "items": [
      { "ingredient_product_id": 45, "quantity": 0.95 },
      { "ingredient_product_id": 46, "quantity": 0.05 }
    ]
  }
  ```
* **Respuesta Exitosa (`200 OK` o `201 Created`)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": 5,
      "product_id": 10,
      "loss_percentage": "5.00",
      "yield": "1.0000"
    },
    "calculated_cost": 1373.68
  }
  ```
* **Errores posibles**:
  - `400 Bad Request` si hay ciclos infinitos detectados (ej: A es ingrediente de B, y se intenta que B sea ingrediente de A).
  - `400 Bad Request` si algún ingrediente no existe o está inactivo.

### 2.3 `DELETE /api/products/:id/recipe` (Eliminar Receta)
Elimina la receta de un producto, volviendo a definir su costo de forma manual.

* **Respuesta Exitosa (`200 OK`)**:
  ```json
  {
    "ok": true,
    "message": "Receta eliminada correctamente"
  }
  ```

---

## 3. Endpoints Nuevos (Historial de Costos)

### 3.1 `GET /api/products/:id/cost-history` (Historial de Costos de un Producto)
Retorna la lista ordenada de variaciones históricas del costo de compra/producción del producto.

* **Respuesta Exitosa (`200 OK`)**:
  ```json
  {
    "ok": true,
    "data": [
      {
        "id": 102,
        "product_id": 10,
        "change_date": "2026-05-30T22:00:00.000Z",
        "old_cost": "1300.00",
        "new_cost": "1373.68",
        "reason": "Recálculo automático por cambio de costo en ingrediente 'Suero de Leche'"
      },
      {
        "id": 89,
        "product_id": 10,
        "change_date": "2026-05-20T12:00:00.000Z",
        "old_cost": "1200.00",
        "new_cost": "1300.00",
        "reason": "Edición manual de receta"
      }
    ]
  }
  ```
