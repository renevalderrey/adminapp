import { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { importProducts, downloadTemplate } from '@/services/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  Upload, Download, FileSpreadsheet, FileText, CheckCircle2, AlertCircle,
  AlertTriangle, ArrowLeft, ArrowRight, HelpCircle, X, Info,
  Loader2,
} from 'lucide-react'

const SYSTEM_FIELDS = [
  { key: 'name', label: 'Nombre', required: true, tooltip: 'Nombre del producto. Se usa para identificar y buscar el producto en el sistema.', group: 'producto' },
  { key: 'sku', label: 'SKU', required: false, tooltip: 'Código interno único. Si existe, se usa para evitar duplicados al importar.', group: 'producto' },
  { key: 'barcode', label: 'Código de barras', required: false, tooltip: 'Código de barras del producto (EAN, UPC, etc.).', group: 'producto' },
  { key: 'description', label: 'Descripción', required: false, tooltip: 'Descripción detallada del producto.', group: 'producto' },
  { key: 'cost', label: 'Costo', required: true, tooltip: 'Precio de costo sin IVA. Usar punto para decimales, ej: 1500.50', group: 'producto' },
  { key: 'category', label: 'Categoría', required: false, tooltip: 'Ej: proteina, creatina, pre_entreno, aminoacidos, colageno, etc.', group: 'producto' },
  { key: 'brand_name', label: 'Marca', required: false, tooltip: 'Nombre de la marca. Se crea automáticamente si no existe.', group: 'producto' },
  { key: 'supplier_name', label: 'Proveedor', required: false, tooltip: 'Nombre del proveedor. Se crea automáticamente si no existe.', group: 'producto' },
  { key: 'margin_override', label: 'Margen %', required: false, tooltip: 'Porcentaje de ganancia sobre el costo. Ej: 40 para 40%.', group: 'producto' },
  { key: 'price_override', label: 'Precio venta', required: false, tooltip: 'Precio de venta manual. Si se especifica, anula el cálculo por margen.', group: 'producto' },
  { key: 'unit_type', label: 'Unidad', required: false, tooltip: 'unidad, kg, gr, litro, ml. Default: unidad', group: 'producto' },
  { key: 'unit_size', label: 'Tamaño envase', required: false, tooltip: 'Tamaño del envase en la unidad especificada. Ej: 500 (gr), 1 (kg)', group: 'producto' },
  { key: 'taxed', label: 'Gravado', required: false, tooltip: 'true si el producto tiene IVA, false si está exento. Default: true', group: 'producto' },
  { key: 'is_active', label: 'Activo', required: false, tooltip: 'false para desactivar el producto sin eliminarlo.', group: 'producto' },
  { key: 'wholesale_margin', label: 'Margen mayorista %', required: false, tooltip: 'Porcentaje de margen para precio mayorista.', group: 'producto' },
  { key: 'wholesale_price', label: 'Precio mayorista', required: false, tooltip: 'Precio mayorista manual. Anula el cálculo por margen mayorista.', group: 'producto' },
  { key: 'quantity', label: 'Stock inicial', required: false, tooltip: 'Cantidad inicial en inventario para la sucursal especificada.', group: 'stock' },
  { key: 'location', label: 'Sucursal', required: false, tooltip: 'Sucursal donde se almacena el stock: general, ortiz, mayo. Default: general', group: 'stock' },
  { key: 'min_stock', label: 'Stock mínimo', required: false, tooltip: 'Cantidad mínima para alertar reposición.', group: 'stock' },
  { key: 'current_batch', label: 'Lote', required: false, tooltip: 'Número de lote del producto.', group: 'stock' },
  { key: 'expiration_date', label: 'Vencimiento', required: false, tooltip: 'Fecha de vencimiento en formato YYYY-MM-DD.', group: 'stock' },
  { key: 'purchase_date', label: 'Fecha compra', required: false, tooltip: 'Fecha de compra en formato YYYY-MM-DD.', group: 'stock' },
]

const FIELD_GROUPS = [
  { key: 'producto', label: 'Información del producto' },
  { key: 'stock', label: 'Stock y trazabilidad' },
]

const COLUMN_ALIASES = {
  name: ['nombre', 'producto', 'product', 'item', 'descripcion', 'descripción', 'nombre del producto', 'articulo', 'artículo'],
  sku: ['codigo', 'código', 'code', 'referencia', 'ref', 'sku', 'internal code'],
  barcode: ['codigo_barras', 'código_barras', 'codigo de barras', 'código de barras', 'barcode', 'ean', 'upc', 'barra'],
  description: ['descripcion', 'descripción', 'description', 'detalle', 'notas'],
  cost: ['costo', 'precio_costo', 'precio de costo', 'cost', 'precio compra', 'precio de compra', 'coste'],
  category: ['categoria', 'categoría', 'category', 'tipo', 'rubro'],
  brand_name: ['marca', 'brand', 'brand_name', 'marca nombre'],
  supplier_name: ['proveedor', 'supplier', 'supplier_name', 'proveedor nombre', 'prov'],
  margin_override: ['margen', 'margen_personalizado', 'margin', 'margin_override', '% margen', 'porcentaje'],
  price_override: ['precio_venta', 'precio', 'price', 'price_override', 'precio venta', 'pvp'],
  unit_type: ['unidad', 'unit_type', 'unit', 'tipo unidad', 'medida'],
  unit_size: ['tamaño_envase', 'unit_size', 'tamaño', 'envase', 'tamaño envase', 'capacity'],
  taxed: ['gravado', 'taxed', 'iva', 'impuesto', 'exento'],
  is_active: ['activo', 'is_active', 'active', 'habilitado', 'estado'],
  wholesale_margin: ['margen_mayorista', 'wholesale_margin', '% mayorista', 'margen mayorista'],
  wholesale_price: ['precio_mayorista', 'wholesale_price', 'precio mayorista', 'mayorista'],
  quantity: ['stock', 'cantidad', 'quantity', 'inventario', 'existencia', 'qty'],
  location: ['sucursal', 'location', 'localidad', 'deposito', 'depósito', 'almacen', 'almacén'],
  min_stock: ['stock_minimo', 'min_stock', 'stock mínimo', 'stock minimo'],
  current_batch: ['lote', 'batch', 'current_batch', 'lote numero', 'nro lote'],
  expiration_date: ['vencimiento', 'expiration_date', 'expiry', 'fecha vencimiento', 'vence', 'caducidad'],
  purchase_date: ['fecha_compra', 'purchase_date', 'fecha compra', 'fecha de compra'],
}

const STEPS = [
  { num: 1, label: 'Subir archivo' },
  { num: 2, label: 'Mapear columnas' },
  { num: 3, label: 'Resultados' },
]

function normalizeStr(str) {
  return str.toLowerCase().trim()
    .replace(/[áäàâã]/g, 'a').replace(/[éëèêẽ]/g, 'e')
    .replace(/[íïìîĩ]/g, 'i').replace(/[óöòôõ]/g, 'o')
    .replace(/[úüùûũ]/g, 'u').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9_\s]/g, '').replace(/\s+/g, ' ')
    .trim()
}

function detectColumns(headers, aliases) {
  const normalizedHeaders = headers.map((h, i) => ({
    index: i,
    original: h,
    normalized: normalizeStr(String(h || '')),
  }))

  const result = {}

  for (const [systemKey, aliasList] of Object.entries(aliases)) {
    const allAliases = [systemKey, ...aliasList].map(normalizeStr)
    let bestMatch = null

    for (const nh of normalizedHeaders) {
      const nhNorm = nh.normalized
      if (!nhNorm) continue

      if (allAliases.includes(nhNorm)) {
        bestMatch = nh
        break
      }
    }

    if (!bestMatch) {
      for (const nh of normalizedHeaders) {
        const nhNorm = nh.normalized
        if (!nhNorm) continue
        for (const alias of allAliases) {
          if (nhNorm.includes(alias) || alias.includes(nhNorm)) {
            if (!bestMatch) bestMatch = nh
            break
          }
        }
      }
    }

    result[systemKey] = bestMatch ? bestMatch.index : -1
  }

  return result
}

async function parseFileToArrays(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 })
  return data
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ImportWizard({ open, onOpenChange, onSuccess }) {
  const [step, setStep] = useState(1)
  const [file, setFile] = useState(null)
  const [fileData, setFileData] = useState({ headers: [], rows: [], totalRows: 0 })
  const [columnMap, setColumnMap] = useState({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [parsing, setParsing] = useState(false)
  const dropRef = useRef(null)
  const fileInputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [expandedErrors, setExpandedErrors] = useState(false)

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(1)
        setFile(null)
        setFileData({ headers: [], rows: [], totalRows: 0 })
        setColumnMap({})
        setImporting(false)
        setResult(null)
        setParsing(false)
        setExpandedErrors(false)
      }, 200)
    }
  }, [open])

  const reset = useCallback(() => {
    setStep(1)
    setFile(null)
    setFileData({ headers: [], rows: [], totalRows: 0 })
    setColumnMap({})
    setImporting(false)
    setResult(null)
    setParsing(false)
    setExpandedErrors(false)
  }, [])

  const handleFile = useCallback(async (selectedFile) => {
    const validExts = ['.csv', '.xlsx', '.xls']
    const ext = '.' + selectedFile.name.split('.').pop().toLowerCase()
    if (!validExts.includes(ext)) {
      toast.error('Formato no soportado. Usá CSV, XLSX o XLS.')
      return
    }

    setFile(selectedFile)
    setParsing(true)

    try {
      const data = await parseFileToArrays(selectedFile)
      if (data.length < 1) {
        toast.error('El archivo está vacío.')
        setFile(null)
        setParsing(false)
        return
      }

      const headers = data[0].map(h => String(h || ''))
      const rows = data.slice(1)
      const totalRows = rows.filter(r => r.some(c => String(c || '').trim())).length

      if (totalRows === 0) {
        toast.error('El archivo no contiene datos después del encabezado.')
        setFile(null)
        setParsing(false)
        return
      }

      const previewRows = rows.slice(0, 5)
      setFileData({ headers, rows: previewRows, totalRows })
      const detected = detectColumns(headers, COLUMN_ALIASES)
      setColumnMap(detected)
      setParsing(false)
      setStep(2)
    } catch (err) {
      toast.error('Error al leer el archivo: ' + err.message)
      setFile(null)
      setParsing(false)
    }
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleFileInput = useCallback((e) => {
    const f = e.target.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const res = await downloadTemplate('products')
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', 'plantilla_productos.xlsx')
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('Error al descargar la plantilla.')
    }
  }, [])

  const handleMappingChange = useCallback((systemKey, columnIndex) => {
    setColumnMap(prev => ({ ...prev, [systemKey]: columnIndex }))
  }, [])

  const handleImport = useCallback(async () => {
    if (!file) return
    setImporting(true)

    const mapping = {}
    for (const [systemKey, colIndex] of Object.entries(columnMap)) {
      if (colIndex >= 0) {
        mapping[fileData.headers[colIndex]] = systemKey
      }
    }

    try {
      const res = await importProducts(file, mapping)
      setResult(res.data)
      setStep(3)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al importar productos.')
    } finally {
      setImporting(false)
    }
  }, [file, columnMap, fileData.headers])

  const requiredMapped = SYSTEM_FIELDS
    .filter(f => f.required)
    .every(f => columnMap[f.key] >= 0)

  const handleClose = () => {
    if (result) {
      onOpenChange(false)
      if (onSuccess && result.created > 0) onSuccess(result)
    } else {
      onOpenChange(false)
    }
  }

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-0 mb-4">
      {STEPS.map((s, i) => (
        <div key={s.num} className="flex items-center">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors
            ${step === s.num
              ? 'bg-primary/10 text-primary'
              : step > s.num
                ? 'text-green-600 dark:text-green-400'
                : 'text-muted-foreground'
            }`}
          >
            {step > s.num ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <span className="flex items-center justify-center size-4 rounded-full bg-current text-background text-[10px] font-bold">
                {s.num}
              </span>
            )}
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-8 h-px mx-1 ${step > s.num ? 'bg-green-500/40' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  )

  const renderUploadStep = () => (
    <div className="space-y-5">
      <DialogDescription>
        Subí un archivo CSV o Excel con los productos a importar. El sistema va a detectar automáticamente las columnas y te va a permitir ajustar la correspondencia.
      </DialogDescription>

      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer
          transition-all duration-200
          ${dragOver
            ? 'border-primary bg-primary/5 scale-[1.02]'
            : file
              ? 'border-green-500/50 bg-green-500/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/40 hover:bg-muted/30'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileInput}
          className="hidden"
        />

        {parsing ? (
          <>
            <Loader2 className="size-10 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium">Leyendo archivo...</p>
            </div>
          </>
        ) : file ? (
          <>
            {file.name.endsWith('.csv') ? (
              <FileText className="size-10 text-green-600 dark:text-green-400" />
            ) : (
              <FileSpreadsheet className="size-10 text-green-600 dark:text-green-400" />
            )}
            <div className="text-center">
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatFileSize(file.size)} &middot; {fileData.totalRows} filas detectadas
              </p>
            </div>
            <Button type="button" variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); reset() }}>
              <X className="size-3 mr-1" /> Quitar archivo
            </Button>
          </>
        ) : (
          <>
            <Upload className="size-10 text-muted-foreground/60" />
            <div className="text-center">
              <p className="text-sm font-medium">
                Arrastrá tu archivo acá o hacé clic para seleccionar
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                CSV, XLSX o XLS &middot; Máx 10 MB
              </p>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        <span>
          ¿No tenés el formato exacto? Podés{' '}
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="underline underline-offset-2 hover:text-foreground inline-flex items-center gap-1"
          >
            <Download className="size-3" /> descargar la plantilla
          </button>
          {' '}y completarla con tus datos.
        </span>
      </div>
    </div>
  )

  const renderPreviewTable = () => {
    const { headers, rows } = fileData
    if (!headers.length) return null
    return (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="px-2 py-1.5 text-left text-muted-foreground font-medium w-8">#</th>
              {headers.map((h, i) => (
                <th key={i} className="px-2 py-1.5 text-left text-muted-foreground font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-t border-border/40">
                <td className="px-2 py-1.5 text-muted-foreground">{ri + 2}</td>
                {headers.map((_, ci) => (
                  <td key={ci} className="px-2 py-1.5 truncate max-w-[160px]" title={row[ci]}>
                    {String(row[ci] || '') || <span className="text-muted-foreground/40">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderMappingStep = () => {
    const { headers } = fileData
    return (
      <div className="space-y-5">
        <DialogDescription>
          El sistema detectó {fileData.totalRows} filas en tu archivo. Revisá la correspondencia entre las columnas de tu archivo y los campos del sistema. Los campos obligatorios están marcados con <span className="text-destructive font-medium">*</span>.
        </DialogDescription>

        {renderPreviewTable()}

        <div className="space-y-0 rounded-lg border divide-y divide-border/60">
          {FIELD_GROUPS.map(group => (
            <div key={group.key}>
              <div className="px-3 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {group.label}
              </div>
              {SYSTEM_FIELDS
                .filter(f => f.group === group.key)
                .map(field => {
                  const matchedIndex = columnMap[field.key] ?? -1
                  const matched = matchedIndex >= 0
                  return (
                    <div key={field.key} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors">
                      <div className="flex-1 flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium truncate">
                          {field.label}
                          {field.required && <span className="text-destructive ml-0.5">*</span>}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                              <HelpCircle className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[260px]">
                            {field.tooltip}
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {matched ? (
                          <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
                        ) : field.required ? (
                          <AlertCircle className="size-4 text-destructive" />
                        ) : (
                          <span className="size-4" />
                        )}

                        <select
                          value={matchedIndex}
                          onChange={(e) => handleMappingChange(field.key, parseInt(e.target.value))}
                          className={`
                            h-8 rounded-md border bg-background px-2 text-xs font-medium
                            outline-none focus-visible:ring-2 focus-visible:ring-ring
                            transition-colors appearance-none cursor-pointer min-w-[140px]
                            ${matched
                              ? 'border-green-500/40 text-foreground'
                              : field.required
                                ? 'border-destructive/40 text-destructive'
                                : 'border-input text-muted-foreground'
                            }
                          `}
                        >
                          <option value={-1}>
                            {field.required ? '— Seleccionar —' : '— No mapear —'}
                          </option>
                          {headers.map((h, i) => (
                            <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )
                })}
            </div>
          ))}
        </div>

        {!requiredMapped && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              Faltan mapear campos obligatorios (marcados con <span className="font-semibold">*</span>).
              Sin Nombre y Costo no se pueden importar los productos.
            </span>
          </div>
        )}
      </div>
    )
  }

  const renderResultStep = () => {
    if (!result) return null
    const hasErrors = result.errors && result.errors.length > 0

    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center justify-center py-4 gap-3">
          {result.created > 0 ? (
            <div className="size-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="size-8 text-green-600 dark:text-green-400" />
            </div>
          ) : (
            <div className="size-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <AlertTriangle className="size-8 text-amber-600 dark:text-amber-400" />
            </div>
          )}
          <div className="text-center">
            <p className="text-base font-semibold">
              {result.created > 0
                ? 'Importación completada'
                : 'Importación finalizada con advertencias'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Se procesaron {result.total} filas del archivo.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border bg-green-50/50 dark:bg-green-950/10 p-3 text-center">
            <p className="text-2xl font-black text-green-600 dark:text-green-400 font-mono">{result.created}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Creados</p>
          </div>
          <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/10 p-3 text-center">
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400 font-mono">{result.updated}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Actualizados</p>
          </div>
          <div className="rounded-lg border bg-red-50/50 dark:bg-red-950/10 p-3 text-center">
            <p className={`text-2xl font-black font-mono ${hasErrors ? 'text-destructive' : 'text-muted-foreground/40'}`}>
              {result.errors?.length || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Errores</p>
          </div>
        </div>

        {hasErrors && (
          <div className="rounded-lg border border-destructive/20">
            <button
              type="button"
              onClick={() => setExpandedErrors(!expandedErrors)}
              className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/5 transition-colors rounded-t-lg"
            >
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                {result.errors.length} error{result.errors.length > 1 ? 'es' : ''} — filas que no se importaron
              </span>
              <span>{expandedErrors ? 'Ocultar' : 'Ver detalles'}</span>
            </button>
            {expandedErrors && (
              <div className="px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
                {result.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-muted/30">
                    <span className="shrink-0 font-mono text-muted-foreground w-10">#{err.fila}</span>
                    <span className="text-foreground/80">{err.error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0 mt-0.5" />
          <span>
            {result.created > 0
              ? 'Los productos se crearon correctamente. Actualizá la página para ver los cambios.'
              : 'No se crearon productos nuevos. Revisá los errores y corregí el archivo.'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl gap-0 p-0" showCloseButton={!importing}>
        <div className="p-4 pb-0">
          <DialogHeader className="mb-3">
            <DialogTitle>Importar Productos</DialogTitle>
          </DialogHeader>
          {renderStepIndicator()}
        </div>

        <div className="px-4 pb-4 overflow-y-auto max-h-[65vh]">
          {step === 1 && renderUploadStep()}
          {step === 2 && renderMappingStep()}
          {step === 3 && renderResultStep()}
        </div>

        <DialogFooter className="px-4 py-3 border-t">
          {step === 1 && (
            <div className="flex justify-between w-full">
              <DialogClose asChild>
                <Button variant="ghost">Cancelar</Button>
              </DialogClose>
              <Button disabled={!file || parsing} onClick={() => file && handleFile(file)}>
                {parsing ? 'Leyendo...' : file ? 'Continuar' : 'Seleccioná un archivo'}
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="flex justify-between w-full">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="size-4 mr-1.5" /> Atrás
              </Button>
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button variant="outline">Cancelar</Button>
                </DialogClose>
                <Button onClick={handleImport} disabled={!requiredMapped || importing}>
                  {importing ? (
                    <><Loader2 className="size-4 animate-spin mr-1.5" /> Importando...</>
                  ) : (
                    <>Importar {fileData.totalRows} producto{(fileData.totalRows || 0) > 1 ? 's' : ''}</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex justify-end w-full">
              <Button onClick={() => { onOpenChange(false); if (onSuccess && result?.created > 0) onSuccess(result) }}>
                Finalizar
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
