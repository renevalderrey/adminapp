const axios = require('axios');
const { Setting, Stock, TiendanubeMapping, StockMovement } = require('../models');
const { resolverSucursal } = require('../utils/sucursalDeStock');

class TiendaNubeService {
  constructor() {
    this.clientId = process.env.TIENDANUBE_CLIENT_ID;
    this.clientSecret = process.env.TIENDANUBE_CLIENT_SECRET;
  }

  async getAccessToken(code, empresaId) {
    try {
      const response = await axios.post('https://www.tiendanube.com/apps/authorize/token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code: code
      });

      const { access_token, token_type, scope, user_id } = response.data;

      await Setting.upsert({
        key: 'tiendanube_access_token',
        value: access_token,
        empresa_id: empresaId,
      });
      await Setting.upsert({
        key: 'tiendanube_user_id',
        value: user_id,
        empresa_id: empresaId,
      });

      return { access_token, user_id };
    } catch (error) {
      console.error('Error al obtener token TiendaNube:', error.response?.data || error.message);
      throw new Error('No se pudo autenticar con TiendaNube');
    }
  }

  async getStoredToken(empresaId) {
    const tokenSetting = await Setting.findOne({
      where: { key: 'tiendanube_access_token', empresa_id: empresaId }
    });
    const userIdSetting = await Setting.findOne({
      where: { key: 'tiendanube_user_id', empresa_id: empresaId }
    });

    if (!tokenSetting || !userIdSetting) return null;

    return {
      access_token: tokenSetting.value,
      user_id: userIdSetting.value
    };
  }

  async getProducts(empresaId) {
    const credentials = await this.getStoredToken(empresaId);
    if (!credentials) throw new Error('TiendaNube no está vinculada');

    const response = await axios.get(
      `https://api.tiendanube.com/v1/${credentials.user_id}/products`,
      {
        headers: {
          'Authentication': `bearer ${credentials.access_token}`,
          'User-Agent': `Nexar POS (${process.env.TIENDANUBE_CONTACT_EMAIL || 'contacto@tudominio.com'})`
        }
      }
    );

    return response.data;
  }

  async updateVariantStock(empresaId, variantId, quantity) {
    const credentials = await this.getStoredToken(empresaId);
    if (!credentials) throw new Error('TiendaNube no está vinculada');

    await axios.put(
      `https://api.tiendanube.com/v1/${credentials.user_id}/products/variants/${variantId}`,
      { stock: Math.max(0, quantity) },
      {
        headers: {
          'Authentication': `bearer ${credentials.access_token}`,
          'User-Agent': `Nexar POS (${process.env.TIENDANUBE_CONTACT_EMAIL || 'contacto@tudominio.com'})`,
          'Content-Type': 'application/json',
        }
      }
    );
  }

  /**
   * Descuenta stock por un pedido de TiendaNube.
   *
   * Es idempotente: si ya se procesó este pedido, no vuelve a descontar.
   * TiendaNube reintenta los webhooks ante cualquier respuesta que no sea 200,
   * y sin esta guarda un reintento descontaba el stock de nuevo.
   *
   * LIMITACIÓN CONOCIDA: baja el inventario pero NO registra una venta. Los
   * pedidos de la tienda online no aparecen en facturación, ni en el flujo de
   * caja, ni en los reportes: el stock desaparece sin ingreso asociado.
   * Completarlo es desarrollo nuevo, no un arreglo. Ver docs/ANALISIS.md.
   */
  async processOrderCreated(orderData, empresaId, puntoDeVentaId) {
    const referencia = `tn_order_${orderData.id}`;

    const yaProcesado = await StockMovement.findOne({
      where: { empresa_id: empresaId, referencia_id: referencia },
      attributes: ['id'],
    });

    if (yaProcesado) return { procesado: false, motivo: 'pedido ya procesado' };

    const items = orderData.products || orderData.items || [];

    // Un pedido de la tienda online **nunca** trae cabecera
    // `X-Punto-De-Venta-Id`: no hay nadie sentado en una caja cuando entra.
    // Antes eso significaba `punto_de_venta_id: puntoDeVentaId || null`, que
    // con la columna en NOT NULL (migración 14) no matchea ninguna fila jamás:
    // el pedido se marcaría como procesado y el inventario no bajaría.
    //
    // Es el tercero de los tres caminos que dejarían de descontar y el que
    // menos se mira, justamente porque no hay nadie mirando.
    const sucursal = await resolverSucursal({
      empresaId,
      puntoDeVentaId,
    });

    for (const item of items) {
      const variantId = item.product_variant_id || item.variant_id;
      if (!variantId) continue;

      const mapping = await TiendanubeMapping.findOne({
        where: { tiendanube_variant_id: variantId, empresa_id: empresaId }
      });

      if (mapping) {
        const stock = await Stock.findOne({
          where: {
            product_id: mapping.product_id,
            empresa_id: empresaId,
            punto_de_venta_id: sucursal.id,
          }
        });

        if (stock) {
          const qty = item.quantity || 1;
          const oldQty = stock.quantity;
          const oldAvail = stock.available;

          await stock.update({
            quantity: Math.max(0, stock.quantity - qty),
            available: Math.max(0, stock.available - qty),
          });

          await StockMovement.create({
            empresa_id: empresaId,
            product_id: mapping.product_id,
            // La sucursal de la que salió la mercadería, no la cabecera que
            // nunca vino.
            punto_de_venta_id: sucursal.id,
            tipo: 'tiendanube_sale',
            referencia_id: referencia,
            cantidad_anterior: oldQty,
            cantidad_nueva: stock.quantity,
            disponible_anterior: oldAvail,
            disponible_nuevo: stock.available,
            usuario_id: 'tiendanube',
          });
        }
      }
    }

    return { procesado: true };
  }
}

module.exports = new TiendaNubeService();
