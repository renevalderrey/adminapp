'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // ── 1. empresas ──
    await queryInterface.createTable('empresas', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      cuit: { type: Sequelize.STRING(20), allowNull: true },
      rubro: { type: Sequelize.STRING(100), allowNull: true },
      phone: { type: Sequelize.STRING(50), allowNull: true },
      address: { type: Sequelize.TEXT, allowNull: true },
      city: { type: Sequelize.STRING(100), allowNull: true },
      state: { type: Sequelize.STRING(100), allowNull: true },
      country: { type: Sequelize.STRING(100), allowNull: true, defaultValue: 'Argentina' },
      timezone: { type: Sequelize.STRING(50), allowNull: true, defaultValue: 'America/Argentina/Buenos_Aires' },
      currency: { type: Sequelize.STRING(10), allowNull: true, defaultValue: 'ARS' },
      logo: { type: Sequelize.TEXT, allowNull: true },
      settings: { type: Sequelize.JSONB, allowNull: true, defaultValue: Sequelize.literal("'{}'::jsonb") },
      onboarding_completed: { type: Sequelize.BOOLEAN, defaultValue: false },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 2. usuarios ──
    await queryInterface.createTable('usuarios', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      auth0_sub: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      email: { type: Sequelize.STRING(255), allowNull: true },
      nombre: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 3. brands ──
    await queryInterface.createTable('brands', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      name: { type: Sequelize.STRING(100), allowNull: false },
      color: { type: Sequelize.STRING(7), allowNull: true, defaultValue: '#4d6fff' },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 4. puntos_de_venta ──
    await queryInterface.createTable('puntos_de_venta', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false },
      name: { type: Sequelize.STRING(100), allowNull: false },
      code: { type: Sequelize.STRING(30), allowNull: true },
      address: { type: Sequelize.TEXT, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 5. settings ──
    await queryInterface.createTable('settings', {
      key: { type: Sequelize.STRING(100), primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      value: { type: Sequelize.JSONB, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 6. customers ──
    await queryInterface.createTable('customers', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      name: { type: Sequelize.STRING(255), allowNull: false },
      tax_id: { type: Sequelize.STRING(30), allowNull: true },
      email: { type: Sequelize.STRING(255), allowNull: true },
      phone: { type: Sequelize.STRING(50), allowNull: true },
      address: { type: Sequelize.TEXT, allowNull: true },
      tax_condition: { type: Sequelize.STRING(30), allowNull: true, defaultValue: 'consumidor_final' },
      notes: { type: Sequelize.TEXT, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 7. products ──
    await queryInterface.createTable('products', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      name: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      sku: { type: Sequelize.STRING(100), allowNull: true },
      barcode: { type: Sequelize.STRING(100), allowNull: true },
      cost: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      brand_id: { type: Sequelize.INTEGER, allowNull: true },
      supplier_id: { type: Sequelize.INTEGER, allowNull: true },
      margin_override: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      price_override: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      wholesale_margin: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      wholesale_price: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      category: { type: Sequelize.STRING(50), allowNull: true, defaultValue: 'otro' },
      unit_type: { type: Sequelize.STRING(20), allowNull: true, defaultValue: 'unidad' },
      unit_size: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      taxed: { type: Sequelize.BOOLEAN, defaultValue: true },
      image_url: { type: Sequelize.TEXT, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 8. suscripciones ──
    await queryInterface.createTable('suscripciones', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, unique: true },
      plan: { type: Sequelize.STRING(50), allowNull: true, defaultValue: 'free' },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'trialing' },
      trial_starts_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      trial_ends_at: { type: Sequelize.DATE, allowNull: false },
      grace_period_ends: { type: Sequelize.DATE, allowNull: true },
      stripe_customer_id: { type: Sequelize.STRING(255), allowNull: true },
      stripe_subscription_id: { type: Sequelize.STRING(255), allowNull: true },
      cancel_at_period_end: { type: Sequelize.BOOLEAN, defaultValue: false },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 9. tax_configs ──
    await queryInterface.createTable('tax_configs', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      tax_type: { type: Sequelize.STRING(30), allowNull: false },
      config: { type: Sequelize.JSONB, allowNull: false, defaultValue: Sequelize.literal("'{}'::jsonb") },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 10. tax_payments ──
    await queryInterface.createTable('tax_payments', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      tax_type: { type: Sequelize.STRING(30), allowNull: false },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      payment_date: { type: Sequelize.DATEONLY, allowNull: false },
      period_from: { type: Sequelize.DATEONLY, allowNull: true },
      period_to: { type: Sequelize.DATEONLY, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 11. fixed_expenses ──
    await queryInterface.createTable('fixed_expenses', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      name: { type: Sequelize.STRING(150), allowNull: false },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      group: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'gf1' },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 12. cashflow_entries ──
    await queryInterface.createTable('cashflow_entries', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      type: { type: Sequelize.STRING(10), allowNull: false },
      category: { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'otro' },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      entry_date: { type: Sequelize.DATEONLY, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      reference: { type: Sequelize.STRING(100), allowNull: true },
      is_recurring: { type: Sequelize.BOOLEAN, defaultValue: false },
      recurring_frequency: { type: Sequelize.STRING(20), allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 13. suppliers ──
    await queryInterface.createTable('suppliers', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      name: { type: Sequelize.STRING(150), allowNull: false },
      phone: { type: Sequelize.STRING(50), allowNull: true },
      email: { type: Sequelize.STRING(255), allowNull: true },
      address: { type: Sequelize.TEXT, allowNull: true },
      cuit: { type: Sequelize.STRING(20), allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 14. supplier_orders ──
    await queryInterface.createTable('supplier_orders', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      supplier_id: { type: Sequelize.INTEGER, allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      total: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      notes: { type: Sequelize.TEXT, allowNull: true },
      detail: { type: Sequelize.JSONB, allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 15. supplier_movements ──
    await queryInterface.createTable('supplier_movements', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      supplier_id: { type: Sequelize.INTEGER, allowNull: false },
      type: { type: Sequelize.STRING(10), allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      payment_method: { type: Sequelize.STRING(30), allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      due_date: { type: Sequelize.DATEONLY, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 16. supplier_documents ──
    await queryInterface.createTable('supplier_documents', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      supplier_id: { type: Sequelize.INTEGER, allowNull: false },
      name: { type: Sequelize.STRING(200), allowNull: false },
      type: { type: Sequelize.STRING(30), allowNull: true, defaultValue: 'factura' },
      url: { type: Sequelize.TEXT, allowNull: true },
      date: { type: Sequelize.DATEONLY, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 17. recipes ──
    await queryInterface.createTable('recipes', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      product_id: { type: Sequelize.INTEGER, allowNull: false, unique: true },
      loss_percentage: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0.00 },
      yield: { type: Sequelize.DECIMAL(12, 4), allowNull: false, defaultValue: 1.0000 },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 18. recipe_items ──
    await queryInterface.createTable('recipe_items', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      recipe_id: { type: Sequelize.INTEGER, allowNull: false },
      ingredient_product_id: { type: Sequelize.INTEGER, allowNull: false },
      quantity: { type: Sequelize.DECIMAL(12, 4), allowNull: false },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 19. product_cost_history ──
    await queryInterface.createTable('product_cost_history', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      product_id: { type: Sequelize.INTEGER, allowNull: false },
      change_date: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      old_cost: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      new_cost: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      reason: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 20. stock ──
    await queryInterface.createTable('stock', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      product_id: { type: Sequelize.INTEGER, allowNull: false },
      location: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'general' },
      punto_de_venta_id: { type: Sequelize.INTEGER, allowNull: true },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      available: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      min_stock: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      current_batch: { type: Sequelize.STRING(100), allowNull: true },
      expiration_date: { type: Sequelize.DATEONLY, allowNull: true },
      purchase_date: { type: Sequelize.DATEONLY, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 21. stock_transfers ──
    await queryInterface.createTable('stock_transfers', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      from_location: { type: Sequelize.STRING(30), allowNull: false },
      from_punto_de_venta_id: { type: Sequelize.INTEGER, allowNull: true },
      to_location: { type: Sequelize.STRING(30), allowNull: false },
      to_punto_de_venta_id: { type: Sequelize.INTEGER, allowNull: true },
      items: { type: Sequelize.JSONB, allowNull: false },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 22. invitaciones ──
    await queryInterface.createTable('invitaciones', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false },
      email: { type: Sequelize.STRING(255), allowNull: false },
      role: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'vendedor' },
      token: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      invited_by: { type: Sequelize.INTEGER, allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      accepted_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 23. usuario_empresas ──
    await queryInterface.createTable('usuario_empresas', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      usuario_id: { type: Sequelize.INTEGER, allowNull: false },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false },
      role: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'vendedor' },
      invited_by: { type: Sequelize.INTEGER, allowNull: true },
      accepted_at: { type: Sequelize.DATE, allowNull: true },
      is_default: { type: Sequelize.BOOLEAN, defaultValue: false },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 24. customer_payments ──
    await queryInterface.createTable('customer_payments', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      customer_id: { type: Sequelize.INTEGER, allowNull: false },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      payment_date: { type: Sequelize.DATEONLY, allowNull: false },
      payment_method: { type: Sequelize.STRING(20), allowNull: true, defaultValue: 'ef' },
      reference: { type: Sequelize.STRING(100), allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 25. sales ──
    await queryInterface.createTable('sales', {
      id: { type: Sequelize.STRING(40), primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      punto_de_venta_id: { type: Sequelize.INTEGER, allowNull: true },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      time: { type: Sequelize.STRING(10), allowNull: false },
      total: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      payment_method: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'ef' },
      notes: { type: Sequelize.TEXT, allowNull: true },
      location: { type: Sequelize.STRING(30), allowNull: true, defaultValue: 'general' },
      seller: { type: Sequelize.STRING(50), allowNull: true },
      afip_cae: { type: Sequelize.STRING(50), allowNull: true },
      afip_vto: { type: Sequelize.STRING(20), allowNull: true },
      afip_nro: { type: Sequelize.INTEGER, allowNull: true },
      afip_type: { type: Sequelize.INTEGER, allowNull: true },
      customer_id: { type: Sequelize.INTEGER, allowNull: true },
      customer_name: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 26. sale_items ──
    await queryInterface.createTable('sale_items', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      sale_id: { type: Sequelize.STRING(40), allowNull: false },
      product_name: { type: Sequelize.STRING(255), allowNull: false },
      product_id: { type: Sequelize.INTEGER, allowNull: true },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      unit_price: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      payment_method: { type: Sequelize.STRING(20), allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 27. production_orders ──
    await queryInterface.createTable('production_orders', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      empresa_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      punto_de_venta_id: { type: Sequelize.INTEGER, allowNull: true },
      product_id: { type: Sequelize.INTEGER, allowNull: false },
      quantity_produced: { type: Sequelize.DECIMAL(12, 4), allowNull: false },
      batch_code: { type: Sequelize.STRING(100), allowNull: false },
      production_date: { type: Sequelize.DATEONLY, allowNull: false },
      unit_cost_calculated: { type: Sequelize.DECIMAL(14, 4), allowNull: false },
      total_cost: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'completed' },
      notes: { type: Sequelize.TEXT, allowNull: true },
      voided_at: { type: Sequelize.DATE, allowNull: true },
      location: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'general' },
      cost_snapshot: { type: Sequelize.JSONB, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ── 28. production_order_items ──
    await queryInterface.createTable('production_order_items', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      production_order_id: { type: Sequelize.INTEGER, allowNull: false },
      ingredient_product_id: { type: Sequelize.INTEGER, allowNull: false },
      quantity_used: { type: Sequelize.DECIMAL(12, 4), allowNull: false },
      unit_cost_at_time: { type: Sequelize.DECIMAL(14, 4), allowNull: false },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ════════════════════════════════════════════
    //  Foreign Key Constraints
    // ════════════════════════════════════════════

    // brands
    await queryInterface.addConstraint('brands', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // puntos_de_venta
    await queryInterface.addConstraint('puntos_de_venta', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // customers
    await queryInterface.addConstraint('customers', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // products
    await queryInterface.addConstraint('products', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('products', { fields: ['brand_id'], type: 'foreign key', references: { table: 'brands', field: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' });

    // settings (composite PK)
    await queryInterface.addConstraint('settings', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // suscripciones
    await queryInterface.addConstraint('suscripciones', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // tax_configs
    await queryInterface.addConstraint('tax_configs', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // tax_payments
    await queryInterface.addConstraint('tax_payments', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // fixed_expenses
    await queryInterface.addConstraint('fixed_expenses', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // cashflow_entries
    await queryInterface.addConstraint('cashflow_entries', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // suppliers
    await queryInterface.addConstraint('suppliers', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // supplier_orders
    await queryInterface.addConstraint('supplier_orders', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('supplier_orders', { fields: ['supplier_id'], type: 'foreign key', references: { table: 'suppliers', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // supplier_movements
    await queryInterface.addConstraint('supplier_movements', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('supplier_movements', { fields: ['supplier_id'], type: 'foreign key', references: { table: 'suppliers', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // supplier_documents
    await queryInterface.addConstraint('supplier_documents', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('supplier_documents', { fields: ['supplier_id'], type: 'foreign key', references: { table: 'suppliers', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // recipes
    await queryInterface.addConstraint('recipes', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('recipes', { fields: ['product_id'], type: 'foreign key', references: { table: 'products', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // recipe_items
    await queryInterface.addConstraint('recipe_items', { fields: ['recipe_id'], type: 'foreign key', references: { table: 'recipes', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('recipe_items', { fields: ['ingredient_product_id'], type: 'foreign key', references: { table: 'products', field: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

    // product_cost_history
    await queryInterface.addConstraint('product_cost_history', { fields: ['product_id'], type: 'foreign key', references: { table: 'products', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // stock
    await queryInterface.addConstraint('stock', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('stock', { fields: ['product_id'], type: 'foreign key', references: { table: 'products', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('stock', { fields: ['punto_de_venta_id'], type: 'foreign key', references: { table: 'puntos_de_venta', field: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' });

    // stock_transfers
    await queryInterface.addConstraint('stock_transfers', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // invitaciones
    await queryInterface.addConstraint('invitaciones', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('invitaciones', { fields: ['invited_by'], type: 'foreign key', references: { table: 'usuarios', field: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' });

    // usuario_empresas
    await queryInterface.addConstraint('usuario_empresas', { fields: ['usuario_id'], type: 'foreign key', references: { table: 'usuarios', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('usuario_empresas', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // customer_payments
    await queryInterface.addConstraint('customer_payments', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('customer_payments', { fields: ['customer_id'], type: 'foreign key', references: { table: 'customers', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    // sales
    await queryInterface.addConstraint('sales', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('sales', { fields: ['punto_de_venta_id'], type: 'foreign key', references: { table: 'puntos_de_venta', field: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('sales', { fields: ['customer_id'], type: 'foreign key', references: { table: 'customers', field: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' });

    // sale_items
    await queryInterface.addConstraint('sale_items', { fields: ['sale_id'], type: 'foreign key', references: { table: 'sales', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('sale_items', { fields: ['product_id'], type: 'foreign key', references: { table: 'products', field: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' });

    // production_orders
    await queryInterface.addConstraint('production_orders', { fields: ['empresa_id'], type: 'foreign key', references: { table: 'empresas', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('production_orders', { fields: ['punto_de_venta_id'], type: 'foreign key', references: { table: 'puntos_de_venta', field: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('production_orders', { fields: ['product_id'], type: 'foreign key', references: { table: 'products', field: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

    // production_order_items
    await queryInterface.addConstraint('production_order_items', { fields: ['production_order_id'], type: 'foreign key', references: { table: 'production_orders', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    await queryInterface.addConstraint('production_order_items', { fields: ['ingredient_product_id'], type: 'foreign key', references: { table: 'products', field: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

    // ════════════════════════════════════════════
    //  Indexes (beyond those implied by PK/FK/unique)
    // ════════════════════════════════════════════

    await queryInterface.addIndex('usuarios', ['auth0_sub'], { unique: true });

    await queryInterface.addIndex('brands', ['empresa_id', 'name'], { unique: true });

    await queryInterface.addIndex('puntos_de_venta', ['empresa_id']);
    await queryInterface.addIndex('puntos_de_venta', ['empresa_id', 'code'], { unique: true });

    await queryInterface.addIndex('customers', ['name']);
    await queryInterface.addIndex('customers', ['tax_id']);

    await queryInterface.addIndex('products', ['empresa_id']);
    await queryInterface.addIndex('products', ['brand_id']);
    await queryInterface.addIndex('products', ['name']);
    await queryInterface.addIndex('products', ['sku']);
    await queryInterface.addIndex('products', ['empresa_id', 'sku'], { unique: true });

    await queryInterface.addIndex('tax_configs', ['empresa_id', 'tax_type'], { unique: true });

    await queryInterface.addIndex('tax_payments', ['tax_type']);
    await queryInterface.addIndex('tax_payments', ['payment_date']);

    await queryInterface.addIndex('suppliers', ['empresa_id', 'name'], { unique: true });

    await queryInterface.addIndex('supplier_orders', ['supplier_id']);
    await queryInterface.addIndex('supplier_orders', ['date']);

    await queryInterface.addIndex('supplier_movements', ['supplier_id']);
    await queryInterface.addIndex('supplier_movements', ['date']);

    await queryInterface.addIndex('supplier_documents', ['supplier_id']);

    await queryInterface.addIndex('recipes', ['product_id'], { unique: true });

    await queryInterface.addIndex('recipe_items', ['recipe_id']);
    await queryInterface.addIndex('recipe_items', ['ingredient_product_id']);

    await queryInterface.addIndex('product_cost_history', ['product_id']);
    await queryInterface.addIndex('product_cost_history', ['change_date']);

    await queryInterface.addIndex('stock', ['product_id', 'location'], { unique: true });
    await queryInterface.addIndex('stock', ['location']);
    await queryInterface.addIndex('stock', ['empresa_id']);
    await queryInterface.addIndex('stock', ['punto_de_venta_id']);

    await queryInterface.addIndex('invitaciones', ['empresa_id']);
    await queryInterface.addIndex('invitaciones', ['email']);
    await queryInterface.addIndex('invitaciones', ['token'], { unique: true });

    await queryInterface.addIndex('usuario_empresas', ['usuario_id', 'empresa_id'], { unique: true });
    await queryInterface.addIndex('usuario_empresas', ['usuario_id']);
    await queryInterface.addIndex('usuario_empresas', ['empresa_id']);

    await queryInterface.addIndex('customer_payments', ['customer_id']);
    await queryInterface.addIndex('customer_payments', ['payment_date']);

    await queryInterface.addIndex('suscripciones', ['empresa_id'], { unique: true });

    await queryInterface.addIndex('sales', ['date']);
    await queryInterface.addIndex('sales', ['location']);
    await queryInterface.addIndex('sales', ['payment_method']);
    await queryInterface.addIndex('sales', ['empresa_id']);
    await queryInterface.addIndex('sales', ['punto_de_venta_id']);

    await queryInterface.addIndex('sale_items', ['sale_id']);
    await queryInterface.addIndex('sale_items', ['product_id']);

    await queryInterface.addIndex('cashflow_entries', ['entry_date']);
    await queryInterface.addIndex('cashflow_entries', ['type']);
    await queryInterface.addIndex('cashflow_entries', ['category']);

    await queryInterface.addIndex('production_orders', ['product_id']);
    await queryInterface.addIndex('production_orders', ['production_date']);
    await queryInterface.addIndex('production_orders', ['batch_code']);
    await queryInterface.addIndex('production_orders', ['status']);
    await queryInterface.addIndex('production_orders', ['empresa_id']);
    await queryInterface.addIndex('production_orders', ['punto_de_venta_id']);

    await queryInterface.addIndex('production_order_items', ['production_order_id']);
    await queryInterface.addIndex('production_order_items', ['ingredient_product_id']);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop in reverse dependency order
    await queryInterface.dropTable('production_order_items');
    await queryInterface.dropTable('production_orders');
    await queryInterface.dropTable('sale_items');
    await queryInterface.dropTable('sales');
    await queryInterface.dropTable('customer_payments');
    await queryInterface.dropTable('usuario_empresas');
    await queryInterface.dropTable('invitaciones');
    await queryInterface.dropTable('stock_transfers');
    await queryInterface.dropTable('stock');
    await queryInterface.dropTable('product_cost_history');
    await queryInterface.dropTable('recipe_items');
    await queryInterface.dropTable('recipes');
    await queryInterface.dropTable('supplier_documents');
    await queryInterface.dropTable('supplier_movements');
    await queryInterface.dropTable('supplier_orders');
    await queryInterface.dropTable('suppliers');
    await queryInterface.dropTable('cashflow_entries');
    await queryInterface.dropTable('fixed_expenses');
    await queryInterface.dropTable('tax_payments');
    await queryInterface.dropTable('tax_configs');
    await queryInterface.dropTable('suscripciones');
    await queryInterface.dropTable('products');
    await queryInterface.dropTable('customers');
    await queryInterface.dropTable('settings');
    await queryInterface.dropTable('puntos_de_venta');
    await queryInterface.dropTable('brands');
    await queryInterface.dropTable('usuarios');
    await queryInterface.dropTable('empresas');
  },
};
