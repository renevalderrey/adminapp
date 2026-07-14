import React, { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import useStore from '@/store/useStore'
import Fuse from 'fuse.js'
import api, { getCustomers } from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Plus,
  Minus,
  Search,
  ShoppingCart,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { printInvoice } from '@/utils/printInvoice'

const CATEGORIES = [
  'proteina', 'pre', 'amino', 'creatina', 'colageno', 'vitamina',
  'accesorio', 'indumentaria', 'alimento', 'pack', 'otro',
]

const PER_PAGE = 30

const Billing = () => {
  const {
    products, cart, addToCart, removeFromCart,
    updateCartQty, updateCartMethod, clearCart,
    getCartTotal, calculatePrices, initialize,
  } = useStore()
  const brands = useStore(s => s.brands)

  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [customerDoc, setCustomerDoc] = useState('')
  const [customerId, setCustomerId] = useState(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState([])
  const [showCustomerSearch, setShowCustomerSearch] = useState(false)
  const [lastInvoice, setLastInvoice] = useState(null)

  const [categoryFilter, setCategoryFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)

  const { settings } = useStore()
  const isAfipConfigured = settings.afip_cuit && settings.afip_pv

  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)
  const empresaActiva = useStore(s => s.empresaActiva)
  const pvId = puntoDeVentaActivo?.id || empresaActiva?.puntosDeVenta?.[0]?.id || null
  const location = puntoDeVentaActivo?.code || empresaActiva?.puntosDeVenta?.[0]?.code || 'general'

  const [docType, setDocType] = useState(settings.tax_condition === 'RI' ? 'afip_b' : 'afip_c')
  const [customerVatCondition, setCustomerVatCondition] = useState('5')
  const [customerName, setCustomerName] = useState('')

  useEffect(() => {
    setDocType(settings.tax_condition === 'RI' ? 'afip_b' : 'afip_c')
  }, [settings.tax_condition])

  useEffect(() => {
    if (docType === 'afip_a') setCustomerVatCondition('1')
    else if (docType === 'afip_b' || docType === 'afip_c') setCustomerVatCondition('5')
  }, [docType])

  useEffect(() => { initialize() }, [initialize])

  // Reset page when search or filters change
  useEffect(() => { setPage(1) }, [searchQuery, categoryFilter, brandFilter, inStockOnly])

  const [loading, setLoading] = useState(false)
  const totalAmount = getCartTotal()

  const getAvailableStock = (product) => {
    const entry = pvId
      ? product.stock?.find(s => s.punto_de_venta_id === pvId)
      : product.stock?.find(s => s.location === location)
    return entry?.available ?? 0
  }

  const baseProducts = useMemo(() => {
    let list = products || []
    if (categoryFilter) list = list.filter(p => p.category === categoryFilter)
    if (brandFilter) list = list.filter(p => p.brand_id === parseInt(brandFilter))
    if (inStockOnly) list = list.filter(p => getAvailableStock(p) >= 1)
    return list
  }, [products, categoryFilter, brandFilter, inStockOnly, pvId, location])

  const fuse = useMemo(() => new Fuse(baseProducts, {
    keys: ['name', 'brand.name', 'category', 'sku', 'barcode'],
    threshold: 0.4,
    distance: 100,
  }), [baseProducts])

  const filteredProducts = useMemo(() => {
    const raw = searchQuery
      ? fuse.search(searchQuery).map(r => r.item)
      : baseProducts

    return [...raw].sort((a, b) => {
      const aStock = getAvailableStock(a) >= 1 ? 1 : 0
      const bStock = getAvailableStock(b) >= 1 ? 1 : 0
      if (aStock !== bStock) return bStock - aStock
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [fuse, searchQuery, baseProducts, pvId, location])

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const paginatedProducts = filteredProducts.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)

  const handleCustomerSearch = async (query) => {
    setCustomerSearch(query)
    if (query.length < 2) { setCustomerResults([]); return }
    try {
      const res = await getCustomers({ search: query, limit: 10 })
      setCustomerResults(res.data.data || [])
    } catch { setCustomerResults([]) }
  }

  const selectCustomer = (c) => {
    setCustomerId(c.id)
    setCustomerDoc(c.tax_id || '')
    setCustomerName(c.name)
    setCustomerSearch(c.name)
    setShowCustomerSearch(false)
  }

  const clearCustomer = () => {
    setCustomerId(null)
    setCustomerDoc('')
    setCustomerName('')
    setCustomerSearch('')
    setCustomerResults([])
  }

  const handleRegisterSale = async () => {
    if (cart.length === 0) return
    setLoading(true)
    try {
      let afipData = null
      let internalData = null
      const isAfip = docType.startsWith('afip_')

      if (isAfip) {
        if (!isAfipConfigured) throw new Error("AFIP no está configurado. Revisa Ajustes.")
        const vType = docType === 'afip_a' ? 1 : docType === 'afip_b' ? 6 : 11
        const res = await api.post('/afip/invoice', {
          amount: totalAmount, customerCuit: customerDoc,
          customerVatCondition, pv: settings.afip_pv, type: vType,
        })
        afipData = res.data.data
        setLastInvoice({
          ...afipData, items: [...cart], total: totalAmount,
          customer: customerDoc, date: new Date().toLocaleDateString('es-AR'),
          isInternal: false, empresaNombre: empresaActiva?.nombre,
        })
      } else {
        const vTypeStr = docType === 'remito' ? 'REMITO' : 'RECIBO X'
        internalData = {
          voucherNumber: Math.floor(Math.random() * 1000000),
          pointOfSale: 0, typeStr: vTypeStr, items: [...cart],
          total: totalAmount, customer: customerName || 'Consumidor Final',
          date: new Date().toLocaleDateString('es-AR'), isInternal: true,
          empresaNombre: empresaActiva?.nombre,
        }
        setLastInvoice(internalData)
      }

      const now = new Date()
      const salePayload = {
        id: `sale_${Date.now()}`,
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0].substring(0, 5),
        payment_method: cart[0]?.method || 'ef',
        items: cart, total: totalAmount,
        afip_cae: afipData?.cae || null,
        afip_nro: afipData?.voucherNumber || null,
        afip_vto: afipData?.expiration || null,
        afip_type: afipData?.type || null,
        location,
        notes: isAfip ? '' : `${internalData.typeStr} - Cliente: ${internalData.customer}`,
      }
      if (customerId) {
        salePayload.customer_id = customerId
        salePayload.customer_name = customerName
      }
      await api.post('/sales', salePayload)

      await initialize()

      toast.success(isAfip
        ? `Factura #${afipData.voucherNumber} registrada. CAE: ${afipData.cae}`
        : `Venta (${internalData.typeStr}) registrada con éxito`)

      clearCart()
      setCustomerDoc('')
      setCustomerName('')
      clearCustomer()
    } catch (err) {
      toast.error('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleTestInvoice = async () => {
    if (!docType.startsWith('afip_')) {
      toast.error("Seleccioná un tipo de Factura AFIP (A, B o C) para hacer una prueba.")
      return
    }
    if (!isAfipConfigured) {
      toast.error("Debés configurar AFIP primero en Ajustes.")
      return
    }
    setLoading(true)
    try {
      const vType = docType === 'afip_a' ? 1 : docType === 'afip_b' ? 6 : 11
      const res = await api.post('/afip/invoice', {
        amount: 1, customerCuit: customerDoc || '',
        customerVatCondition, pv: settings.afip_pv, type: vType,
      })
      const afipData = res.data.data
      setLastInvoice({
        ...afipData, items: [{ qty: 1, name: "Proteína Testing", price: 1 }],
        total: 1, customer: customerDoc,
        date: new Date().toLocaleDateString('es-AR'), isInternal: false,
      })
      const now = new Date()
      await api.post('/sales', {
        id: `test_${Date.now()}`,
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0].substring(0, 5),
        payment_method: 'ef',
        items: [{ qty: 1, name: "Proteína Testing", price: 1 }],
        total: 1,
        location,
        afip_cae: afipData.cae, afip_nro: afipData.voucherNumber,
        afip_vto: afipData.expiration, afip_type: afipData.type,
        notes: 'Factura de Prueba',
      })
      await initialize()
      toast.success(`Factura de prueba #${afipData.voucherNumber} registrada. CAE: ${afipData.cae}`)
    } catch (err) {
      toast.error('Error en factura de prueba: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">
          Punto de <span className="text-primary">Venta</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestioná ventas rápidas con múltiples medios de pago.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-6">
        {/* Product List */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar productos por nombre o marca..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-10"
                />
              </div>
            </CardContent>
          </Card>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-xs font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Todas las categorías</option>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
            <select
              value={brandFilter}
              onChange={e => setBrandFilter(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-xs font-medium shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Todas las marcas</option>
              {brands.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground cursor-pointer select-none h-8 px-2.5 rounded-lg border border-input bg-background shadow-sm">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={e => setInStockOnly(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input accent-[#00B4B6]"
              />
              Solo stock
            </label>
          </div>

          {/* Product header */}
          <div className="grid grid-cols-[1fr_90px_90px_90px_50px] px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Producto</span>
            <span className="text-center">Efectivo</span>
            <span className="text-center">Tarjeta</span>
            <span className="text-center">Alianza</span>
            <span></span>
          </div>

          <div className="space-y-1.5">
            {paginatedProducts.map(p => {
              const { cashPrice, cardPrice, alliancePrice } = calculatePrices(p)
              const available = getAvailableStock(p)
              const outOfStock = available === 0
              return (
                <Card key={p.id} className={`hover:bg-accent/50 transition-colors ${outOfStock ? 'opacity-50' : ''}`}>
                  <CardContent className="p-3 grid grid-cols-[1fr_90px_90px_90px_50px] items-center">
                    <div className="min-w-0 pr-2">
                      <p className="font-semibold text-sm truncate">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.brand?.name || 'Sin marca'}</p>
                      <p className="text-[10px] text-muted-foreground">Stock: {available}</p>
                    </div>
                    <p className="text-center font-bold font-mono text-sm text-green-500">${cashPrice.toLocaleString()}</p>
                    <p className="text-center font-bold font-mono text-sm text-blue-500">${cardPrice.toLocaleString()}</p>
                    <p className="text-center font-bold font-mono text-sm text-orange-500">${alliancePrice.toLocaleString()}</p>
                    <div className="flex justify-end">
                      <Button size="icon" className="h-8 w-8 bg-[#00B4B6] hover:bg-[#008B8E] text-white" onClick={() => addToCart(p)} disabled={outOfStock}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-2 pb-1">
              <Button
                variant="ghost" size="icon" className="h-8 w-8"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push(<span key={`e-${p}`} className="text-xs text-muted-foreground px-1">...</span>)
                  acc.push(
                    <Button
                      key={p}
                      variant={p === safePage ? 'default' : 'ghost'}
                      size="icon" className="h-8 w-8 text-xs font-bold"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  )
                  return acc
                }, [])}
              <Button
                variant="ghost" size="icon" className="h-8 w-8"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Cart Sidebar */}
        <div className="lg:sticky lg:top-6 h-fit">
          <Card className="flex flex-col max-h-[calc(100vh-120px)]">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" /> Carrito
                </CardTitle>
                <Badge variant="secondary">{cart.length} ítems</Badge>
              </div>
            </CardHeader>

            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3 space-y-2">
                {cart.length === 0 ? (
                  <div className="text-center py-10">
                    <ShoppingCart className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm font-medium text-muted-foreground">Carrito vacío</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Agregá productos con el botón +</p>
                  </div>
                ) : (
                  cart.map(item => (
                    <div key={item.id} className="group rounded-lg border bg-card p-2.5 space-y-2 hover:border-primary/20 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate leading-tight">{item.name}</p>
                          <p className="text-lg font-black font-mono text-green-600 leading-tight">
                            ${(item.price * item.qty).toLocaleString()}
                          </p>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 rounded-md flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" className="h-7 w-7 rounded-md"
                            onClick={() => updateCartQty(item.id, item.qty - 1)}>
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-7 text-center font-bold text-sm tabular-nums">{item.qty}</span>
                          <Button variant="outline" size="icon" className="h-7 w-7 rounded-md"
                            onClick={() => updateCartQty(item.id, item.qty + 1)}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex gap-1">
                          {[['ef','Efe'],['tc3','Tarj'],['al','Alia']].map(([m, l]) => (
                            <Button key={m} size="sm" variant="outline"
                              className={`h-7 text-[11px] px-2.5 font-semibold ${item.method === m ? 'bg-[#00B4B6] hover:bg-[#008B8E] text-white border-[#00B4B6] shadow-sm' : ''}`}
                              onClick={() => updateCartMethod(item.id, m)}>
                              {l}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Checkout */}
            <div className="border-t p-4 space-y-4 bg-muted/30 rounded-b-xl">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tipo de Comprobante</label>
                  <select
                    value={docType}
                    onChange={e => setDocType(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-semibold shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {settings.tax_condition === 'RI' && (
                      <>
                        <option value="afip_b">Factura B (AFIP)</option>
                        <option value="afip_a">Factura A (AFIP)</option>
                      </>
                    )}
                    {settings.tax_condition === 'Monotributo' && (
                      <option value="afip_c">Factura C (AFIP)</option>
                    )}
                    <option value="remito">Remito / Presupuesto</option>
                    <option value="recibo_x">Recibo X</option>
                  </select>
                </div>

                {docType.startsWith('afip') ? (
                  <div className="space-y-2">
                    {!isAfipConfigured && (
                      <p className="text-[10px] text-destructive font-bold">AFIP no está configurado en Ajustes.</p>
                    )}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Condición IVA</label>
                      <select
                        value={customerVatCondition}
                        onChange={e => setCustomerVatCondition(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs shadow-sm"
                      >
                        <option value="5">Consumidor Final (5)</option>
                        <option value="1">IVA Responsable Inscripto (1)</option>
                        <option value="6">Responsable Monotributo (6)</option>
                        <option value="4">Sujeto Exento (4)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">DNI / CUIT</label>
                      <Input
                        type="number"
                        placeholder={docType === 'afip_a' ? "CUIT Obligatorio" : "Opcional"}
                        value={customerDoc}
                        onChange={e => setCustomerDoc(e.target.value)}
                        className="h-8 text-sm rounded-lg"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Cliente</label>
                    <div className="relative">
                      <Input
                        placeholder="Buscar cliente..."
                        value={customerSearch}
                        onChange={e => handleCustomerSearch(e.target.value)}
                        onFocus={() => customerResults.length > 0 && setShowCustomerSearch(true)}
                        className="h-8 text-sm rounded-lg pr-8"
                      />
                      {customerId && (
                        <button className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={clearCustomer}>×</button>
                      )}
                      {showCustomerSearch && customerResults.length > 0 && (
                        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {customerResults.map(c => (
                            <button key={c.id}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex justify-between"
                              onClick={() => selectCustomer(c)}>
                              <span>{c.name}</span>
                              <span className="text-xs text-muted-foreground">{c.tax_id || ''}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {!customerId && (
                      <Input
                        placeholder="O nombre libre..."
                        value={customerName}
                        onChange={e => setCustomerName(e.target.value)}
                        className="h-8 text-sm rounded-lg mt-1"
                      />
                    )}
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between bg-background rounded-lg px-3 py-2 border">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total</span>
                <span className="text-xl font-black font-mono text-green-600 tabular-nums">
                  ${totalAmount.toLocaleString()}
                </span>
              </div>

              {lastInvoice && (
                <Button variant="outline" className="w-full border-green-500/30 text-green-600 hover:text-green-600 hover:bg-green-50"
                  onClick={() => printInvoice(lastInvoice)}>
                  Imprimir Factura #{lastInvoice.voucherNumber}
                </Button>
              )}

              <Button
                onClick={handleRegisterSale}
                disabled={cart.length === 0 || loading}
                className="w-full h-11 font-semibold shadow-sm bg-[#00B4B6] hover:bg-[#008B8E] text-white"
                size="lg"
              >
                {loading ? 'Procesando...' : 'Registrar Venta'}
              </Button>

              <Button variant="outline" className="w-full text-xs text-muted-foreground"
                disabled={loading}
                onClick={handleTestInvoice}>
                Emitir Factura de Prueba (1 ARS)
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default Billing
