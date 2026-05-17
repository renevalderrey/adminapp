import React, { useState, useEffect } from 'react'
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
import { Calendar, Search, Printer, ShieldCheck, FileText, CloudCog } from 'lucide-react'

const InvoicesList = () => {
  const { settings } = useStore()
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const fetchSales = async () => {
    setLoading(true)
    try {
      const res = await api.get(`/sales?date=${date}`)
      if (res.data.ok) setSales(res.data.data)
    } catch (err) {
      alert('Error al cargar facturas: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSales() }, [date])

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
    })
  }

  const handleVerifyAfip = async (sale) => {
    if (!sale.afip_cae) return
    try {
      const pv = settings.afip_pv || 1
      const res = await api.get(`/afip/invoice/${sale.afip_type}/${pv}/${sale.afip_nro}/data`)
      const d = res.data.data
      alert(
        `✅ COMPROBANTE VALIDADO POR AFIP\n\n` +
        `Punto de Venta: ${d.PtoVta}\nNro: ${d.CbteDesde}\n` +
        `Doc Receptor: ${d.DocNro}\nImporte Total: $${d.ImpTotal}\n` +
        `CAE: ${d.CodAutorizacion}\nVto CAE: ${d.FchVto}\nResultado: ${d.Resultado}`
      )
    } catch (err) {
      alert('Error al consultar AFIP: ' + (err.response?.data?.error || err.message))
    }
  }

  const filteredSales = sales.filter(s =>
    s.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.afip_cae && s.afip_cae.includes(searchQuery)) ||
    (s.notes && s.notes.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  return (
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>HORA</TableHead>
                <TableHead>TIPO</TableHead>
                <TableHead>COMPROBANTE</TableHead>
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
                    <TableCell className="text-right">
                      <div className="flex gap-1.5 justify-end">
                        {isAfip && (
                          <Button variant="ghost" size="sm" className="text-green-500 text-xs gap-1"
                            onClick={() => handleVerifyAfip(sale)}>
                            <CloudCog className="h-3.5 w-3.5" /> Verificar
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="text-xs gap-1"
                          onClick={() => handlePrint(sale)}>
                          <Printer className="h-3.5 w-3.5" /> Imprimir
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

export default InvoicesList
