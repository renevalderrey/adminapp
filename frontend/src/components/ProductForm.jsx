import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import api from '@/services/api'
import useStore from '@/store/useStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

const CATEGORIES = [
  'proteina', 'pre', 'amino', 'creatina', 'colageno', 'vitamina',
  'accesorio', 'indumentaria', 'alimento', 'pack', 'otro',
]

const UNIT_TYPES = [
  { value: 'unidad', label: 'Unidad' },
  { value: 'kg', label: 'Kg' },
  { value: 'gr', label: 'Gr' },
  { value: 'litro', label: 'Litro' },
  { value: 'ml', label: 'Ml' },
]

export default function ProductForm({ open, onOpenChange, product, onSuccess }) {
  const { brands } = useStore()
  const [saving, setSaving] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [form, setForm] = useState({
    name: '',
    description: '',
    sku: '',
    barcode: '',
    cost: '',
    brand_id: '',
    margin_override: '',
    price_override: '',
    wholesale_margin: '',
    wholesale_price: '',
    category: 'otro',
    unit_type: 'unidad',
    unit_size: '',
    taxed: true,
    image_url: '',
  })

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name || '',
        description: product.description || '',
        sku: product.sku || '',
        barcode: product.barcode || '',
        cost: product.cost || '',
        brand_id: product.brand_id ? String(product.brand_id) : '',
        margin_override: product.margin_override || '',
        price_override: product.price_override || '',
        wholesale_margin: product.wholesale_margin || '',
        wholesale_price: product.wholesale_price || '',
        category: product.category || 'otro',
        unit_type: product.unit_type || 'unidad',
        unit_size: product.unit_size || '',
        taxed: product.taxed !== undefined ? product.taxed : true,
        image_url: product.image_url || '',
      })
    } else {
      setForm({
        name: '',
        description: '',
        sku: '',
        barcode: '',
        cost: '',
        brand_id: '',
        margin_override: '',
        price_override: '',
        wholesale_margin: '',
        wholesale_price: '',
        category: 'otro',
        unit_type: 'unidad',
        unit_size: '',
        taxed: true,
        image_url: '',
      })
    }
  }, [product, open])

  const handleSubmit = async () => {
    setShowConfirm(true)
  }

  const doSave = async () => {
    setSaving(true)
    try {
      const sanitize = (v) => (v === '' || v === undefined || v === null ? null : v)
      const payload = {
        name: form.name,
        description: sanitize(form.description),
        sku: sanitize(form.sku),
        barcode: sanitize(form.barcode),
        cost: form.cost || 0,
        brand_id: sanitize(form.brand_id),
        margin_override: sanitize(form.margin_override),
        price_override: sanitize(form.price_override),
        wholesale_margin: sanitize(form.wholesale_margin),
        wholesale_price: sanitize(form.wholesale_price),
        category: form.category,
        unit_type: form.unit_type,
        unit_size: sanitize(form.unit_size),
        taxed: form.taxed,
        image_url: sanitize(form.image_url),
      }

      if (product) {
        await api.put(`/products/${product.id}`, payload)
        toast.success('Producto actualizado correctamente')
      } else {
        await api.post('/products', payload)
        toast.success('Producto creado correctamente')
      }

      setShowConfirm(false)
      onOpenChange(false)
      if (onSuccess) onSuccess()
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setSaving(false)
    }
  }

  const f = (field) => form[field]
  const set = (field) => (value) => setForm(prev => ({ ...prev, [field]: value }))

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="sm:max-w-lg w-full">
          <SheetHeader>
            <SheetTitle>{product ? 'Editar Producto' : 'Nuevo Producto'}</SheetTitle>
            <SheetDescription>
              Completá los datos del producto. Los campos marcados con * son obligatorios.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 space-y-5">
            {/* Información básica */}
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Información básica</h4>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nombre *</Label>
                  <Input required value={f('name')} onChange={e => set('name')(e.target.value)} placeholder="Ej: Whey Protein 2LB Chocolate" />
                </div>
                <div className="space-y-1.5">
                  <Label>Descripción</Label>
                  <Textarea value={f('description')} onChange={e => set('description')(e.target.value)} placeholder="Descripción opcional del producto" rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>SKU</Label>
                    <Input value={f('sku')} onChange={e => set('sku')(e.target.value)} placeholder="Código único" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Código de barras</Label>
                    <Input value={f('barcode')} onChange={e => set('barcode')(e.target.value)} placeholder="Opcional" />
                  </div>
                </div>
              </div>
            </div>

            {/* Precios y márgenes */}
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Precios y márgenes</h4>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Costo *</Label>
                    <Input type="number" step="0.01" required value={f('cost')} onChange={e => set('cost')(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Margen %</Label>
                    <Input type="number" step="0.01" value={f('margin_override')} onChange={e => set('margin_override')(e.target.value)} placeholder="Ej: 50" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Precio manual</Label>
                    <Input type="number" step="0.01" value={f('price_override')} onChange={e => set('price_override')(e.target.value)} placeholder="Anula el cálculo" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Margen mayorista %</Label>
                    <Input type="number" step="0.01" value={f('wholesale_margin')} onChange={e => set('wholesale_margin')(e.target.value)} placeholder="Opcional" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Precio mayorista</Label>
                  <Input type="number" step="0.01" value={f('wholesale_price')} onChange={e => set('wholesale_price')(e.target.value)} placeholder="Opcional" />
                </div>
              </div>
            </div>

            {/* Categorización */}
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categorización</h4>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Marca</Label>
                    <Select value={f('brand_id')} onValueChange={set('brand_id')}>
                      <SelectTrigger><SelectValue placeholder="Sin marca" /></SelectTrigger>
                      <SelectContent>
                        {brands.map(b => (
                          <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Categoría</Label>
                    <Select value={f('category')} onValueChange={set('category')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => (
                          <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Unidad de medida</Label>
                    <Select value={f('unit_type')} onValueChange={set('unit_type')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNIT_TYPES.map(u => (
                          <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tamaño / Peso</Label>
                    <Input type="number" step="0.01" value={f('unit_size')} onChange={e => set('unit_size')(e.target.value)} placeholder="Ej: 2000" />
                  </div>
                </div>
              </div>
            </div>

            {/* Configuración adicional */}
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Configuración adicional</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="taxed"
                    checked={f('taxed')}
                    onChange={e => set('taxed')(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <Label htmlFor="taxed">Producto gravado (impuestos)</Label>
                </div>
                <div className="space-y-1.5">
                  <Label>URL de imagen</Label>
                  <Input value={f('image_url')} onChange={e => set('image_url')(e.target.value)} placeholder="https://..." />
                </div>
              </div>
            </div>
          </div>

          <SheetFooter className="px-4 pb-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={!form.name || !form.cost}>
              {product ? 'Guardar cambios' : 'Crear producto'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Confirmación */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{product ? 'Guardar cambios' : 'Crear producto'}</DialogTitle>
            <DialogDescription>
              {product
                ? `¿Estás seguro de que querés guardar los cambios en "${product.name}"?`
                : `¿Estás seguro de que querés crear el producto "${form.name}"?`
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowConfirm(false)} type="button">
              Cancelar
            </Button>
            <Button onClick={doSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {product ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
