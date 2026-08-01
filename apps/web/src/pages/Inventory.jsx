import React, { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import useStore from '@/store/useStore'
import { transferStock, getStockTransfers } from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Package, Plus, Search, Edit2, ArrowRightLeft, FileSpreadsheet, Loader2, Tags, X,
} from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Can } from '@/components/Can'
import Pagination from '@/components/Pagination'
import ImportWizard from '@/components/ImportWizard'
import ProductForm from '@/components/ProductForm'
import PreciosMasivos from '@/components/PreciosMasivos'

const Inventory = () => {
  const { products, brands, initialize, loading, error } = useStore()
  const empresaActiva = useStore(s => s.empresaActiva)
  const puntoDeVentaActivo = useStore(s => s.puntoDeVentaActivo)

  const locations = useMemo(() => {
    const pvs = empresaActiva?.puntosDeVenta || []
    return pvs.map(pv => ({ value: pv.code, label: pv.name }))
  }, [empresaActiva?.puntosDeVenta])

  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isTransfer, setIsTransfer] = useState(false)
  const [activeLocation, setActiveLocation] = useState('all')
  const [transfers, setTransfers] = useState([])
  const [showTransfers, setShowTransfers] = useState(false)
  const [page, setPage] = useState(1)
  const perPage = 25

  // ── Selección para la actualización masiva de precios ──
  // Se guardan ids y no productos: la lista se recarga después de aplicar, y
  // una copia del producto quedaría desactualizada.
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [preciosAbierto, setPreciosAbierto] = useState(false)

  const firstLocation = locations[0]?.value || ''
  const secondLocation = locations[1]?.value || locations[0]?.value || ''

  const [transferForm, setTransferForm] = useState({
    from_location: firstLocation,
    to_location: secondLocation,
    product_id: '',
    quantity: '',
  })

  useEffect(() => {
    setTransferForm(prev => ({
      ...prev,
      from_location: firstLocation,
      to_location: secondLocation,
    }))
  }, [firstLocation, secondLocation])

  useEffect(() => { initialize() }, [initialize])

  useEffect(() => { setPage(1) }, [searchQuery, activeLocation])

  const openCreate = () => {
    setEditingProduct(null)
    setIsFormOpen(true)
  }

  const openEdit = (product) => {
    setEditingProduct(product)
    setIsFormOpen(true)
  }

  const handleTransfer = async (e) => {
    e.preventDefault()
    if (!transferForm.product_id || !transferForm.quantity || parseFloat(transferForm.quantity) <= 0) return
    try {
      await transferStock({
        from_location: transferForm.from_location,
        to_location: transferForm.to_location,
        items: [{ product_id: parseInt(transferForm.product_id), quantity: parseFloat(transferForm.quantity) }],
      })
      setIsTransfer(false)
      setTransferForm({ from_location: firstLocation, to_location: secondLocation, product_id: '', quantity: '' })
      initialize()
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    }
  }

  const filteredProducts = products.filter(p => {
    if (!searchQuery.trim()) return true;
    const tokens = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return tokens.every(token => {
      const inName = p.name.toLowerCase().includes(token);
      const inBrand = p.brand?.name?.toLowerCase().includes(token);
      const inCategory = (p.category || '').toLowerCase().includes(token);
      const inSku = (p.sku || '').toLowerCase().includes(token);
      const inCost = !isNaN(Number(token)) && parseFloat(p.cost) === parseFloat(token);
      return inName || inBrand || inCategory || inSku || inCost;
    });
  })

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / perPage))
  const paginatedProducts = filteredProducts.slice((page - 1) * perPage, page * perPage)

  const alternarSeleccion = (id) => {
    setSeleccionados(prev => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  // Selecciona TODO lo que da la búsqueda, no solo la página que se ve. Que el
  // "seleccionar todo" dependiera de en qué página estás sería una fuente
  // silenciosa de actualizaciones incompletas.
  const seleccionarFiltrados = () => {
    setSeleccionados(new Set(filteredProducts.map(p => p.id)))
  }

  const limpiarSeleccion = () => setSeleccionados(new Set())

  const todosLosFiltradosSeleccionados =
    filteredProducts.length > 0 && filteredProducts.every(p => seleccionados.has(p.id))

  const getStockForLocation = (product, location) => {
    if (location === 'all') return product.stock?.reduce((sum, s) => sum + s.quantity, 0) || 0
    return product.stock?.find(s => s.location === location)?.quantity || 0
  }

  const lowStock = products.filter(p => {
    const total = getStockForLocation(p, activeLocation)
    const minStock = p.stock?.find(s => {
      if (activeLocation === 'all') return true
      return s.location === activeLocation
    })?.min_stock || 0
    return total > 0 && total <= minStock
  }).length

  const noStock = products.filter(p => {
    return getStockForLocation(p, activeLocation) === 0
  }).length

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1>Gestión de Inventario</h1>
          </div>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <p className="text-destructive font-semibold">Error al cargar los productos</p>
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-fg-2">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => initialize()}>
            Reintentar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1>Gestión de Inventario</h1>
          <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-fg-2">
            Controlá el stock, costos y márgenes de ganancia.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { getStockTransfers().then(r => setTransfers(r.data.data || [])).catch(() => {}); setShowTransfers(true) }}>
            <ArrowRightLeft className="h-4 w-4 mr-1" /> Transferencias
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsTransfer(true)}>
            <ArrowRightLeft className="h-4 w-4 mr-1" /> Transferir Stock
          </Button>
          <Can codigo="products.crear">
            <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
              <FileSpreadsheet className="h-4 w-4 mr-1" /> Importar
            </Button>
          </Can>
          <Button size="sm" onClick={openCreate} className="bg-brand hover:bg-brand-dark text-white">
            <Plus className="h-4 w-4 mr-1" /> Nuevo Producto
          </Button>
        </div>
      </div>

      {/* Location Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveLocation('all')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${activeLocation === 'all' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >Todas</button>
        {locations.map(loc => (
          <button
            key={loc.value}
            onClick={() => setActiveLocation(loc.value)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${activeLocation === loc.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >{loc.label}</button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Productos Total</p>
            <p className="num text-[26px] font-semibold mt-1">{filteredProducts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Marcas</p>
            <p className="num text-[26px] font-semibold mt-1">{brands.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stock Bajo</p>
            <p className="num text-[26px] font-semibold mt-1 text-warn">{lowStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sin Stock</p>
            <p className="num text-[26px] font-semibold mt-1 text-destructive">{noStock}</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-3 flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar en el catálogo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        {/* Barra de selección: aparece solo cuando hay algo seleccionado. */}
        {seleccionados.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-primary/5 px-4 py-2.5">
            <span className="text-sm font-bold">
              {seleccionados.size} seleccionado{seleccionados.size === 1 ? '' : 's'}
            </span>

            {!todosLosFiltradosSeleccionados && filteredProducts.length > seleccionados.size && (
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={seleccionarFiltrados}>
                Seleccionar los {filteredProducts.length} de la búsqueda
              </Button>
            )}

            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={limpiarSeleccion}>
              <X className="h-3.5 w-3.5 mr-1" /> Limpiar
            </Button>

            <div className="ml-auto">
              <Can permission="products.editar">
                <Button size="sm" onClick={() => setPreciosAbierto(true)}>
                  <Tags className="h-4 w-4 mr-1" /> Actualizar precios
                </Button>
              </Can>
            </div>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 align-middle"
                  checked={todosLosFiltradosSeleccionados}
                  onChange={() => todosLosFiltradosSeleccionados ? limpiarSeleccion() : seleccionarFiltrados()}
                  title="Seleccionar todo lo que da la búsqueda"
                />
              </TableHead>
              <TableHead>PRODUCTO</TableHead>
              <TableHead>MARCA</TableHead>
              <TableHead className="text-right">COSTO</TableHead>
              {activeLocation === 'all' ? (
                locations.map(loc => (
                  <TableHead key={loc.value} className="text-center text-[10px]">{loc.label}</TableHead>
                ))
              ) : (
                <TableHead className="text-center">STOCK</TableHead>
              )}
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5 + (activeLocation === 'all' ? locations.length : 1)} className="text-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mt-2">Cargando productos...</p>
                </TableCell>
              </TableRow>
            ) : paginatedProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5 + (activeLocation === 'all' ? locations.length : 1)} className="text-center py-12">
                  <Package className="h-10 w-10 mx-auto text-muted-foreground/40" />
                  <p className="text-base font-semibold text-muted-foreground mt-3">No hay productos</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">
                    {searchQuery ? 'No se encontraron productos con ese criterio de búsqueda.' : 'Agregá tu primer producto usando el botón "Nuevo Producto".'}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              paginatedProducts.map(p => {
                const totalStock = getStockForLocation(p, activeLocation)
                return (
                  <TableRow key={p.id} data-state={seleccionados.has(p.id) ? "selected" : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4 align-middle"
                        checked={seleccionados.has(p.id)}
                        onChange={() => alternarSeleccion(p.id)}
                      />
                    </TableCell>
                    <TableCell className="font-semibold">{p.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.brand?.name || '–'}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      ${parseFloat(p.cost).toLocaleString()}
                    </TableCell>
                    {activeLocation === 'all' ? (
                      locations.map(loc => {
                        const entry = p.stock?.find(s => s.location === loc.value)
                        const qty = entry?.quantity || 0
                        const minStock = entry?.min_stock || 0
                        let badgeVariant = 'outline'
                        if (qty === 0) badgeVariant = 'destructive'
                        else if (qty <= minStock) badgeVariant = 'warning'
                        return (
                          <TableCell key={loc.value} className="text-center">
                            <Badge variant={badgeVariant} className="font-mono">
                              {qty}
                            </Badge>
                          </TableCell>
                        )
                      })
                    ) : (
                      <TableCell className="text-center">
                        <Badge variant={totalStock === 0 ? 'destructive' : totalStock <= (p.stock?.find(s => s.location === activeLocation)?.min_stock || 0) ? 'warning' : 'outline'} className="font-mono">
                          {totalStock}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
        {!loading && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
      </Card>

      <PreciosMasivos
        open={preciosAbierto}
        onOpenChange={setPreciosAbierto}
        productIds={[...seleccionados]}
        onAplicado={() => {
          // Recargar y soltar la selección: los productos ya cambiaron, y dejar
          // marcados los mismos invita a aplicar el ajuste dos veces.
          initialize()
          limpiarSeleccion()
        }}
      />

      {/* Sheet: New / Edit Product */}
      <ProductForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        product={editingProduct}
        onSuccess={() => initialize()}
      />

      {/* Wizard: Importar productos */}
      <ImportWizard
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onSuccess={() => initialize()}
      />

      {/* Dialog: Transfer */}
      <Dialog open={isTransfer} onOpenChange={setIsTransfer}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Transferir Stock</DialogTitle></DialogHeader>
          <form onSubmit={handleTransfer} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Origen</Label>
                <Select value={transferForm.from_location} onValueChange={v => setTransferForm({ ...transferForm, from_location: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {locations.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Destino</Label>
                <Select value={transferForm.to_location} onValueChange={v => setTransferForm({ ...transferForm, to_location: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {locations.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Producto</Label>
              <Select value={transferForm.product_id} onValueChange={v => setTransferForm({ ...transferForm, product_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  {products.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} (Stock: {getStockForLocation(p, transferForm.from_location)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cantidad</Label>
              <Input type="number" min="1" step="1" required value={transferForm.quantity}
                onChange={e => setTransferForm({ ...transferForm, quantity: e.target.value })} />
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsTransfer(false)}>Cancelar</Button>
              <Button type="submit">Transferir</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Transfers History */}
      <Dialog open={showTransfers} onOpenChange={setShowTransfers}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Historial de Transferencias</DialogTitle></DialogHeader>
          {transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sin transferencias registradas</p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {transfers.map(t => (
                <Card key={t.id}>
                  <CardContent className="p-3 text-sm">
                    <div className="flex justify-between items-center">
                      <Badge variant="outline">{t.from_location} → {t.to_location}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {t.items?.map((item, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span>{item.product_name}</span>
                          <span className="font-mono font-medium">{item.quantity} u.</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Inventory
