import React, { useState, useEffect } from 'react'
import useStore from '@/store/useStore'
import api from '@/services/api'
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
} from '@/components/ui/dialog'
import {
  Package, Upload, Plus, Search, Edit2, Zap, X,
} from 'lucide-react'

const Inventory = () => {
  const { products, brands, initialize, loading } = useStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [isBulkImport, setIsBulkImport] = useState(false)

  const [formData, setFormData] = useState({
    name: '', brand_id: '', cost: '', margin_override: '',
  })
  const [bulkText, setBulkText] = useState('')

  useEffect(() => { initialize() }, [initialize])

  const handleAddProduct = async (e) => {
    e.preventDefault()
    try {
      await api.post('/products', formData)
      setIsAdding(false)
      setFormData({ name: '', brand_id: '', cost: '', margin_override: '' })
      initialize()
    } catch (err) {
      alert('Error al agregar producto: ' + err.message)
    }
  }

  const handleBulkImport = async () => {
    try {
      const rows = bulkText.split('\n').map(line => {
        const parts = line.split('\t')
        return { name: parts[0]?.trim(), cost: parseFloat(parts[1]) || 0, stock: parseInt(parts[2]) || 0 }
      }).filter(p => p.name)
      await api.post('/products/bulk', { products: rows })
      setIsBulkImport(false)
      setBulkText('')
      initialize()
      alert(`Importados ${rows.length} productos con éxito.`)
    } catch (err) {
      alert('Error en importación: ' + err.message)
    }
  }

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.brand?.name && p.brand.name.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const lowStock = products.filter(p => {
    const total = p.stock?.reduce((sum, s) => sum + s.quantity, 0) || 0
    return total <= 5 && total > 0
  }).length

  const noStock = products.filter(p => {
    return (p.stock?.reduce((sum, s) => sum + s.quantity, 0) || 0) === 0
  }).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Gestión de <span className="text-primary">Inventario</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Controlá el stock, costos y márgenes de ganancia.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled className="opacity-50">
            <Zap className="h-4 w-4 mr-1" /> Cargar por IA
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsBulkImport(true)}>
            <Upload className="h-4 w-4 mr-1" /> Importación Masiva
          </Button>
          <Button size="sm" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo Producto
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Productos Total</p>
            <p className="text-2xl font-black font-mono mt-1">{products.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Marcas</p>
            <p className="text-2xl font-black font-mono mt-1">{brands.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stock Bajo</p>
            <p className="text-2xl font-black font-mono mt-1 text-orange-500">{lowStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sin Stock</p>
            <p className="text-2xl font-black font-mono mt-1 text-destructive">{noStock}</p>
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
          <select className="rounded-md border border-input bg-background px-3 py-2 text-sm w-[200px]">
            <option value="">Todas las Marcas</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PRODUCTO</TableHead>
              <TableHead>MARCA</TableHead>
              <TableHead className="text-right">COSTO</TableHead>
              <TableHead className="text-right">MARGEN (%)</TableHead>
              <TableHead className="text-center">STOCK</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.map(p => {
              const totalStock = p.stock?.reduce((sum, s) => sum + s.quantity, 0) || 0
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-semibold">{p.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{p.brand?.name || '–'}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold">
                    ${parseFloat(p.cost).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {p.margin_override ? `${p.margin_override}%` : (
                      <span className="text-muted-foreground/40">Global</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={totalStock > 3 ? 'outline' : 'destructive'}>
                      {totalStock}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Dialog: New Product */}
      <Dialog open={isAdding} onOpenChange={setIsAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cargar Nuevo Producto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddProduct} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <Input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Costo</label>
                <Input type="number" required value={formData.cost} onChange={e => setFormData({ ...formData, cost: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Margen (%)</label>
                <Input type="number" placeholder="Opcional" value={formData.margin_override} onChange={e => setFormData({ ...formData, margin_override: e.target.value })} />
              </div>
            </div>
            <Button type="submit" className="w-full">Guardar Producto</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Bulk Import */}
      <Dialog open={isBulkImport} onOpenChange={setIsBulkImport}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Importación Masiva</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Pegá las columnas de tu Excel (Nombre | Costo | Stock). Asegurate de que estén separadas por tabulación.
          </p>
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={"Ejemplo:\nProteína Whey 1kg\t15000\t10\nCreatina 300g\t12000\t5"}
            className="w-full h-64 rounded-lg border border-input bg-muted/50 p-4 font-mono text-sm resize-none outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setIsBulkImport(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={handleBulkImport}>
              Importar {bulkText.split('\n').filter(Boolean).length} ítems
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Inventory
