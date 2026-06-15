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
} from 'lucide-react'
import { printInvoice } from '@/utils/printInvoice'

const Billing = () => {
  const {
    products, cart, addToCart, removeFromCart,
    updateCartQty, updateCartMethod, clearCart,
    getCartTotal, calculatePrices, initialize,
  } = useStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [customerDoc, setCustomerDoc] = useState('')
  const [customerId, setCustomerId] = useState(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState([])
  const [showCustomerSearch, setShowCustomerSearch] = useState(false)
  const [lastInvoice, setLastInvoice] = useState(null)

  const { settings } = useStore()
  const isAfipConfigured = settings.afip_cuit && settings.afip_pv

  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)
  const empresaActiva = useStore(s => s.empresaActiva)
  const location = puntoDeVentaActivo?.location || empresaActiva?.puntosDeVenta?.[0]?.location || 'general'

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

  const [loading, setLoading] = useState(false)
  const totalAmount = getCartTotal()

  const fuse = useMemo(() => new Fuse(products || [], {
    keys: ['name', 'brand.name'],
    threshold: 0.3,
  }), [products])

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products || []
    return fuse.search(searchQuery).map(r => r.item)
  }, [fuse, searchQuery, products])

  const getAvailableStock = (product) => {
    return product.stock?.find(s => s.location === location)?.available ?? 0
  }

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
          isInternal: false,
        })
      } else {
        const vTypeStr = docType === 'remito' ? 'REMITO' : 'RECIBO X'
        internalData = {
          voucherNumber: Math.floor(Math.random() * 1000000),
          pointOfSale: 0, typeStr: vTypeStr, items: [...cart],
          total: totalAmount, customer: customerName || 'Consumidor Final',
          date: new Date().toLocaleDateString('es-AR'), isInternal: true,
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

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
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

          {/* Product header */}
          <div className="grid grid-cols-[1fr_90px_90px_90px_50px] px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Producto</span>
            <span className="text-center">Efectivo</span>
            <span className="text-center">Tarjeta</span>
            <span className="text-center">Alianza</span>
            <span></span>
          </div>

          <div className="space-y-1.5">
            {filteredProducts.map(p => {
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
                      <Button size="icon" className="h-8 w-8" onClick={() => addToCart(p)} disabled={outOfStock}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
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
              <div className="p-4">
                {cart.length === 0 ? (
                  <div className="text-center py-12">
                    <ShoppingCart className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm font-medium">Carrito vacío</p>
                    <p className="text-xs text-muted-foreground mt-1">Hacé click en + para agregar productos</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cart.map(item => (
                      <Card key={item.id} className="bg-muted/50">
                        <CardContent className="p-3 space-y-2">
                          <p className="font-semibold text-sm truncate">{item.name}</p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <Button variant="outline" size="icon" className="h-7 w-7"
                                onClick={() => updateCartQty(item.id, item.qty - 1)}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-6 text-center font-bold text-sm">{item.qty}</span>
                              <Button variant="outline" size="icon" className="h-7 w-7"
                                onClick={() => updateCartQty(item.id, item.qty + 1)}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <span className="font-black font-mono text-green-500">
                              ${(item.price * item.qty).toLocaleString()}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-1">
                            {[['ef','Efe'],['tc3','Tarj'],['al','Alia']].map(([m, l]) => (
                              <Button key={m} size="sm"
                                variant={item.method === m ? 'default' : 'outline'}
                                className="h-7 text-[10px]"
                                onClick={() => updateCartMethod(item.id, m)}>
                                {l}
                              </Button>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Checkout */}
            <div className="border-t p-4 space-y-4 bg-muted/30">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tipo de Comprobante</label>
                  <select
                    value={docType}
                    onChange={e => setDocType(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-semibold"
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
                      <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Condición frente al IVA</label>
                      <select
                        value={customerVatCondition}
                        onChange={e => setCustomerVatCondition(e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                      >
                        <option value="5">Consumidor Final (5)</option>
                        <option value="1">IVA Responsable Inscripto (1)</option>
                        <option value="6">Responsable Monotributo (6)</option>
                        <option value="4">Sujeto Exento (4)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">DNI / CUIT Cliente</label>
                      <Input
                        type="number"
                        placeholder={docType === 'afip_a' ? "CUIT Obligatorio" : "Opcional"}
                        value={customerDoc}
                        onChange={e => setCustomerDoc(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Cliente</label>
                    <div className="relative">
                      <Input
                        placeholder="Buscar cliente existente..."
                        value={customerSearch}
                        onChange={e => handleCustomerSearch(e.target.value)}
                        onFocus={() => customerResults.length > 0 && setShowCustomerSearch(true)}
                        className="h-8 text-sm pr-8"
                      />
                      {customerId && (
                        <button className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={clearCustomer}>×</button>
                      )}
                      {showCustomerSearch && customerResults.length > 0 && (
                        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
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
                      <div className="mt-1">
                        <Input
                          placeholder="O nombre libre..."
                          value={customerName}
                          onChange={e => setCustomerName(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted-foreground">TOTAL</span>
                <span className="text-2xl font-black font-mono text-green-500">
                  ${totalAmount.toLocaleString()}
                </span>
              </div>

              {lastInvoice && (
                <Button variant="outline" className="w-full border-green-500/30 text-green-500 hover:text-green-500"
                  onClick={() => printInvoice(lastInvoice)}>
                  Imprimir Factura #{lastInvoice.voucherNumber}
                </Button>
              )}

              <Button
                onClick={handleRegisterSale}
                disabled={cart.length === 0 || loading}
                className="w-full h-11 font-semibold"
                size="lg"
              >
                {loading ? 'Procesando...' : 'Registrar Venta'}
              </Button>

              <Button variant="outline" className="w-full text-xs"
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
