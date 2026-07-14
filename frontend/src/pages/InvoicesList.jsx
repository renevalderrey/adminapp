import React, { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import api from '@/services/api'
import { printInvoice } from '@/utils/printInvoice'
import useStore from '@/store/useStore'
import { Card, CardContent } from '@/components/ui/card'
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
import { Calendar, Search, Printer, ShieldCheck, FileText, CloudCog, Store, Trash2 } from 'lucide-react'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import Pagination from '@/components/Pagination'

const InvoicesList = () => {
  const { settings } = useStore()
  const empresaActiva = useStore(s => s.empresaActiva)

  const locations = useMemo(() => {
    const pvs = empresaActiva?.puntosDeVenta || []
    return [{ value: 'all', label: 'Todas' }, ...pvs.map(pv => ({ value: pv.location, label: pv.name }))]
  }, [empresaActiva?.puntosDeVenta])

  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [sales, setSales] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [location, setLocation] = useState('all')
  const [page, setPage] = useState(1)
  const [voiding, setVoiding] = useState(null)
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const { can } = usePermission()
  const limit = 20

  const fetchSales = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ date, page, limit })
      if (location !== 'all') params.set('location', location)
      const res = await api.get(`/sales?${params.toString()}`)
      if (res.data.ok) {
        setSales(res.data.data)
        setTotal(res.data.total || 0)
      }
    } catch (err) {
      toast.error('Error al cargar facturas: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { setPage(1) }, [date, location])

  useEffect(() => { fetchSales() }, [date, location, page])

  const handlePrint = (sale) => {
    const isAfip = !!sale.afip_cae
    const formattedItems = sale.items.map(item => ({
      qty: item.quantity, name: item.product_name, price: item.unit_price,
    }))
    let customerStr = sale.seller || 'Consumidor Final'
    if (!isAfip && sale.notes && sale.notes.includes('Cliente:')) {
      customerStr = sale.notes.split('Cliente:')[1].trim()
    }
    printInvoice({
      isInternal: !isAfip,
      typeStr: isAfip ? 'FACTURA' : (sale.notes?.split('-')[0]?.trim() || 'COMPROBANTE'),
      type: sale.afip_type, pointOfSale: isAfip ? 1 : 0,
      voucherNumber: sale.afip_nro || sale.id.split('-')[0],
      date: new Date(sale.date + 'T' + sale.time).toLocaleString('es-AR'),
      customer: customerStr, items: formattedItems, total: sale.total,
      cae: sale.afip_cae, expiration: sale.afip_vto,
      empresaNombre: empresaActiva?.nombre,
    })
  }

  const handleVerifyAfip = async (sale) => {
    if (!sale.afip_cae) return
    try {
      const pv = settings.afip_pv || 1
      const res = await api.get(`/afip/invoice/${sale.afip_type}/${pv}/${sale.afip_nro}/data`)
      const d = res.data.data
      toast.success(
        `Comprobante validado - CAE: ${d.CodAutorizacion} - Vto: ${d.FchVto}`
      )
    } catch (err) {
      toast.error('Error al consultar AFIP: ' + (err.response?.data?.error || err.message))
    }
  }

  const handleVoid = async (sale) => {
    const confirmed = await confirm(
      `¿Anular la venta ${sale.afip_nro ? `Nro ${sale.afip_nro}` : sale.id.split('-')[0]}? Se restaurará el stock.`
    )
    if (!confirmed) return

    setVoiding(sale.id)
    try {
      await api.put(`/sales/${sale.id}/void`)
      toast.success('Venta anulada y stock restaurado')
      fetchSales()
    } catch (err) {
      toast.error('Error al anular: ' + (err.response?.data?.error || err.message))
    } finally {
      setVoiding(null)
    }
  }

  const filteredSales = sales.filter(s =>
    s.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.afip_cae && s.afip_cae.includes(searchQuery)) ||
    (s.notes && s.notes.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  return (
    <>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">
          Historial de <span className="text-primary">Ventas</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consulta el historial de ventas y reimprime tickets.
        </p>
      </div>

      <Card>
        <CardContent className="p-3 flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por ID, CAE o notas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 border rounded-md px-3 py-1.5 bg-muted/50">
            <Store className="h-4 w-4 text-muted-foreground" />
            <select
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="border-none bg-transparent text-sm outline-none text-foreground"
            >
              {locations.map(loc => (
                <option key={loc.value} value={loc.value}>{loc.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 border rounded-md px-3 py-1.5 bg-muted/50">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="border-none bg-transparent text-sm outline-none text-foreground"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        {loading ? (
          <CardContent className="py-12 text-center text-muted-foreground">
            Cargando comprobantes...
          </CardContent>
        ) : filteredSales.length === 0 ? (
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay ventas registradas para esta fecha.
          </CardContent>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>HORA</TableHead>
                  <TableHead>SUCURSAL</TableHead>
                  <TableHead>TIPO</TableHead>
                  <TableHead>COMPROBANTE</TableHead>
                  <TableHead>ESTADO</TableHead>
                  <TableHead>TOTAL</TableHead>
                  <TableHead className="text-right">ACCIONES</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales.map(sale => {
                  const isAfip = !!sale.afip_cae
                  return (
                      <TableRow key={sale.id}>
                        <TableCell className="font-bold">{sale.time}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs gap-1 capitalize">
                            <Store className="h-3 w-3" /> {sale.location || 'general'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                        {isAfip ? (
                          <Badge variant="outline" className="text-green-500 border-green-500/30 gap-1">
                            <ShieldCheck className="h-3 w-3" /> AFIP
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <FileText className="h-3 w-3" /> Interno
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {isAfip ? (
                          <div>
                            <p className="font-bold text-sm">Nro: {sale.afip_nro}</p>
                            <p className="text-[11px] text-muted-foreground">CAE: {sale.afip_cae}</p>
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">{sale.notes || sale.id.split('-')[0]}</p>
                        )}
                      </TableCell>
                      <TableCell className="font-black font-mono text-green-500">
                        ${Number(sale.total).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {sale.status === 'voided' ? (
                          <Badge variant="destructive" className="text-xs">Anulada</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1.5 justify-end">
                          {isAfip && sale.status !== 'voided' && (
                            <Button variant="ghost" size="sm" className="text-green-500 text-xs gap-1"
                              onClick={() => handleVerifyAfip(sale)}>
                              <CloudCog className="h-3.5 w-3.5" /> Verificar
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="text-xs gap-1"
                            onClick={() => handlePrint(sale)}>
                            <Printer className="h-3.5 w-3.5" /> Imprimir
                          </Button>
                          {sale.status !== 'voided' && can('ventas.anular') && (
                            <Button variant="ghost" size="sm" className="text-destructive text-xs gap-1"
                              disabled={voiding === sale.id}
                              onClick={() => handleVoid(sale)}>
                              <Trash2 className="h-3.5 w-3.5" /> Anular
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              totalPages={Math.ceil(total / limit)}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
    <ConfirmDialog />
    </>
  )
}

export default InvoicesList
