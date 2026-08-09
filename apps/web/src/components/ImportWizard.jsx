import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { importProducts, downloadTemplate } from '@/services/api'
import useStore from '@/store/useStore'
import {
  parsearPegado, comoCsv, detectarColumnas, ALIAS_DE_COLUMNA,
} from '@/utils/pegadoDeLista'
import { aNumero } from '@/utils/importes'
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
  Loader2, ClipboardPaste,
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
  { key: 'location', label: 'Sucursal', required: false, tooltip: 'Código de la sucursal donde se almacena el stock. Dejalo vacío para usar la sucursal principal.', group: 'stock' },
  { key: 'min_stock', label: 'Stock mínimo', required: false, tooltip: 'Cantidad mínima para alertar reposición.', group: 'stock' },
  { key: 'current_batch', label: 'Lote', required: false, tooltip: 'Número de lote del producto.', group: 'stock' },
  { key: 'expiration_date', label: 'Vencimiento', required: false, tooltip: 'Fecha de vencimiento en formato YYYY-MM-DD.', group: 'stock' },
  { key: 'purchase_date', label: 'Fecha compra', required: false, tooltip: 'Fecha de compra en formato YYYY-MM-DD.', group: 'stock' },
]

const FIELD_GROUPS = [
  { key: 'producto', label: 'Información del producto' },
  { key: 'stock', label: 'Stock y trazabilidad' },
]

/** Lo que se ve en el área de pegado antes de pegar nada: dos líneas separadas
 *  por tabulaciones, que es lo que sale de copiar de Excel o de Sheets. */
const PEGADO_DE_EJEMPLO = [
  ['Whey Protein 1kg', '12500', '7'].join('\t'),
  ['Creatina 300g', '8900', '3'].join('\t'),
].join('\n')

const STEPS = [
  { num: 1, label: 'Subir archivo' },
  { num: 2, label: 'Mapear columnas' },
  { num: 3, label: 'Resultados' },
]

// `normalizeStr`, `COLUMN_ALIASES` y `detectColumns` se mudaron a
// `utils/pegadoDeLista.js`. El archivo y el texto pegado usan **la misma** tabla
// de alias: dos tablas empiezan iguales y terminan distintas, y entonces la
// misma planilla se mapea de una forma si se sube y de otra si se pega.

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

/**
 * El estado inicial de todo lo que el asistente acumula.
 *
 * Está en un solo lugar porque se restablece desde tres —al cerrar, al apretar
 * «quitar archivo» y al terminar—, y tres copias de una lista de quince
 * `setX(...)` es como se olvida uno y pegar, cerrar sin confirmar y volver a
 * abrir deja el intento anterior adentro.
 */
const VACIO = {
  step: 1,
  file: null,
  fileData: { headers: [], rows: [], totalRows: 0 },
  columnMap: {},
  result: null,
  parsing: false,
  importing: false,
  expandedErrors: false,
  origen: 'archivo',
  textoPegado: '',
  matriz: [],
  lineasOriginales: [],
  avisoDelPegado: null,
}

export default function ImportWizard({ open, onOpenChange, onSuccess }) {
  const empresaActiva = useStore(s => s.empresaActiva)
  const productos = useStore(s => s.products)
  const [step, setStep] = useState(VACIO.step)
  const [file, setFile] = useState(VACIO.file)
  const [fileData, setFileData] = useState(VACIO.fileData)
  const [columnMap, setColumnMap] = useState(VACIO.columnMap)
  const [importing, setImporting] = useState(VACIO.importing)
  const [result, setResult] = useState(VACIO.result)
  const [parsing, setParsing] = useState(VACIO.parsing)
  const dropRef = useRef(null)
  const fileInputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [expandedErrors, setExpandedErrors] = useState(VACIO.expandedErrors)
  /**
   * La sucursal para las filas que no traen columna Sucursal.
   *
   * Arranca **vacía**, que el servidor interpreta como «el punto de venta por
   * defecto de la empresa». Antes arrancaba en el string `'principal'`, y en una
   * empresa sembrada por `seedPuntosDeVenta` —cuyos códigos son
   * general/ortiz/mayo— ese texto no coincide con **nada**: desde que el
   * servidor valida el parámetro (fase 3), el asistente fallaba con 400 antes de
   * escribir una sola fila.
   */
  const [defaultLocation, setDefaultLocation] = useState('')
  /** De dónde salen los datos: un archivo o texto pegado. */
  const [origen, setOrigen] = useState(VACIO.origen)
  const [textoPegado, setTextoPegado] = useState(VACIO.textoPegado)
  /** La matriz COMPLETA del pegado (la vista previa muestra solo cinco filas). */
  const [matriz, setMatriz] = useState(VACIO.matriz)
  /** `lineasOriginales[i]` es la línea del texto pegado de la fila `i`. */
  const [lineasOriginales, setLineasOriginales] = useState(VACIO.lineasOriginales)
  const [avisoDelPegado, setAvisoDelPegado] = useState(VACIO.avisoDelPegado)

  const reset = useCallback(() => {
    setStep(VACIO.step)
    setFile(VACIO.file)
    setFileData(VACIO.fileData)
    setColumnMap(VACIO.columnMap)
    setImporting(VACIO.importing)
    setResult(VACIO.result)
    setParsing(VACIO.parsing)
    setExpandedErrors(VACIO.expandedErrors)
    setDefaultLocation('')
    setOrigen(VACIO.origen)
    setTextoPegado(VACIO.textoPegado)
    setMatriz(VACIO.matriz)
    setLineasOriginales(VACIO.lineasOriginales)
    setAvisoDelPegado(VACIO.avisoDelPegado)
  }, [])

  // Al cerrar se limpia TODO, con el retardo de la animación para que no se vea
  // el contenido desaparecer antes que el diálogo. Pegar una lista, cerrar sin
  // confirmar y volver a abrir tiene que dejar el asistente en blanco: encontrar
  // la lista anterior adentro invita a confirmarla creyendo que es la nueva.
  useEffect(() => {
    if (open) return

    const limpieza = setTimeout(reset, 200)
    return () => clearTimeout(limpieza)
  }, [open, reset])

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
      const detected = detectarColumnas(headers, ALIAS_DE_COLUMNA)
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

  /**
   * Lee el texto pegado y lo deja en la MISMA forma que un archivo.
   *
   * `headers` + `rows` + `totalRows` es exactamente lo que produce
   * `handleFile`, así que los pasos 2 y 3 no se enteran de si el origen fue un
   * archivo o un pegado. No hay un camino paralelo (FR-090).
   */
  const handlePegado = useCallback(() => {
    const leido = parsearPegado(textoPegado)

    if (!leido.ok) {
      setAvisoDelPegado(leido.error)
      toast.error(leido.error)
      return
    }

    setAvisoDelPegado(null)
    setMatriz(leido.filas)
    setLineasOriginales(leido.lineas)
    setFileData({
      headers: leido.columnas,
      rows: leido.filas.slice(0, 5),
      totalRows: leido.filas.length,
    })
    setColumnMap(leido.mapeo)
    setStep(2)
  }, [textoPegado])

  const handleImport = useCallback(async () => {
    // Un segundo clic mientras el pedido está en vuelo dispararía una segunda
    // importación: los mismos productos entrarían dos veces y el historial de
    // costos registraría dos cambios idénticos.
    if (importing) return
    if (origen === 'archivo' && !file) return
    if (origen === 'pegado' && matriz.length === 0) return

    setImporting(true)

    const mapping = {}
    for (const [systemKey, colIndex] of Object.entries(columnMap)) {
      if (colIndex >= 0) {
        mapping[fileData.headers[colIndex]] = systemKey
      }
    }

    try {
      // El pegado se serializa como CSV canónico y se sube **por el mismo
      // endpoint** que un archivo. El servidor no cambia y no hay un segundo
      // lector de listas que pueda discrepar del primero.
      const aSubir = origen === 'pegado'
        ? new File([comoCsv(fileData.headers, matriz)], 'lista-pegada.csv', { type: 'text/csv' })
        : file

      const res = await importProducts(aSubir, mapping, defaultLocation)
      setResult(res.data)
      setStep(3)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al importar productos.')
    } finally {
      setImporting(false)
    }
  }, [importing, origen, file, matriz, columnMap, fileData.headers, defaultLocation])

  const requiredMapped = SYSTEM_FIELDS
    .filter(f => f.required)
    .every(f => columnMap[f.key] >= 0)

  const hayDatos = origen === 'pegado' ? fileData.totalRows > 0 : !!file

  /**
   * Cuántas filas crean un producto y cuántas actualizan uno que ya está.
   *
   * Por SKU si la columna está mapeada y la celda no está vacía; si no, por
   * nombre. Es el mismo criterio que aplica el servidor, así que la vista previa
   * dice lo que va a pasar y no una aproximación.
   */
  const previsualizacion = useMemo(() => {
    const iSku = columnMap.sku ?? -1
    const iNombre = columnMap.name ?? -1

    if (iNombre < 0) return { crear: 0, actualizar: 0, porFila: [] }

    const porSku = new Map()
    const porNombre = new Map()

    for (const p of productos) {
      if (p.sku) porSku.set(String(p.sku).trim().toLowerCase(), p)
      if (p.name) porNombre.set(String(p.name).trim().toLowerCase(), p)
    }

    const filas = origen === 'pegado' ? matriz : fileData.rows
    let crear = 0
    let actualizar = 0

    const porFila = filas.map((fila) => {
      const sku = iSku >= 0 ? String(fila[iSku] ?? '').trim() : ''
      const nombre = String(fila[iNombre] ?? '').trim()

      const existe = sku
        ? porSku.has(sku.toLowerCase())
        : porNombre.has(nombre.toLowerCase())

      if (existe) actualizar++
      else crear++

      return existe ? 'actualiza' : 'crea'
    })

    return { crear, actualizar, porFila }
  }, [columnMap.sku, columnMap.name, productos, origen, matriz, fileData.rows])

  /**
   * El primer costo del archivo, crudo y ya interpretado.
   *
   * Se muestra en el paso 2 para que el usuario confirme mirando cómo se va a
   * leer. Lo lee la copia del navegador de `aNumero`; la que guarda es la del
   * servidor, y las dos aplican las mismas reglas.
   */
  const costoDeMuestra = useMemo(() => {
    const i = columnMap.cost ?? -1
    if (i < 0) return null

    const filas = origen === 'pegado' ? matriz : fileData.rows
    const crudo = filas.find((f) => String(f?.[i] ?? '').trim())?.[i]
    const leido = aNumero(crudo)

    return leido === null ? null : { crudo: String(crudo).trim(), leido }
  }, [columnMap.cost, origen, matriz, fileData.rows])

  /**
   * A qué línea del texto pegado corresponde un error del servidor.
   *
   * El servidor informa `fila: i + 2`, contando desde el archivo que recibió: la
   * 1 es el encabezado. Sin esta traducción, «error en la línea 14» apunta a
   * otra línea en cuanto el usuario pegó una línea en blanco en el medio, y
   * termina corrigiendo una fila que estaba bien.
   */
  const lineaDelError = (filaDelServidor) => {
    if (origen !== 'pegado') return filaDelServidor

    return lineasOriginales[filaDelServidor - 2] ?? filaDelServidor
  }

  /** Si la importación cambió algo que la pantalla tenga que volver a leer. */
  const huboCambios = (r) => !!r && ((r.created || 0) > 0 || (r.updated || 0) > 0)

  const handleClose = () => {
    onOpenChange(false)
    // Se avisa también cuando solo hubo ACTUALIZACIONES: una lista de precios no
    // crea ningún producto y cambia doscientos costos, y sin esto la tabla
    // seguiría mostrando los costos viejos.
    if (huboCambios(result)) onSuccess?.(result)
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
        Subí un archivo, o pegá directamente la lista que te llegó por mail o por
        WhatsApp. Los dos caminos siguen igual desde el paso 2.
      </DialogDescription>

      {/* Dos orígenes, un solo asistente. Pegar texto NO es otro flujo: produce
          la misma matriz que leer un archivo y sale por el mismo endpoint. */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted w-fit">
        <button
          type="button"
          onClick={() => setOrigen('archivo')}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors ${
            origen === 'archivo' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Upload className="size-3.5" /> Subir archivo
        </button>
        <button
          type="button"
          onClick={() => setOrigen('pegado')}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors ${
            origen === 'pegado' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ClipboardPaste className="size-3.5" /> Pegar texto
        </button>
      </div>

      {origen === 'pegado' ? (
        <div className="space-y-3">
          <textarea
            value={textoPegado}
            onChange={(e) => { setTextoPegado(e.target.value); setAvisoDelPegado(null) }}
            rows={10}
            placeholder={PEGADO_DE_EJEMPLO}
            className="w-full rounded-xl border bg-background p-3 font-mono text-xs outline-none
                       transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          />

          <p className="text-xs text-muted-foreground">
            Las columnas se separan por tabulación, punto y coma, o dos o más
            espacios seguidos. Si la primera línea es un encabezado, se detecta
            sola. Máximo 2.000 filas por pegada.
          </p>

          {avisoDelPegado && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>{avisoDelPegado}</span>
            </div>
          )}
        </div>
      ) : (

      // ⚠ Es un `<div>` apretable, asi que declara teclado. Sin esto, subir un
      // archivo era exclusivamente con mouse: arrastrar no se puede con teclado,
      // y el clic era la unica alternativa.
      <div
        ref={dropRef}
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(evento) => {
          if (evento.key !== 'Enter' && evento.key !== ' ') return
          if (evento.target !== evento.currentTarget) return

          evento.preventDefault()
          fileInputRef.current?.click()
        }}
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
      )}

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
              <th className="px-2 py-1.5 text-left text-muted-foreground font-medium w-8">Línea</th>
              <th className="px-2 py-1.5 text-left text-muted-foreground font-medium">Qué hace</th>
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
                {/* El número de línea es el que ve el usuario: la del texto que
                    pegó, o la del archivo. */}
                <td className="px-2 py-1.5 text-muted-foreground font-mono">
                  {origen === 'pegado' ? (lineasOriginales[ri] ?? ri + 1) : ri + 2}
                </td>
                <td className="px-2 py-1.5">
                  {previsualizacion.porFila[ri] === 'actualiza' ? (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      actualiza
                    </span>
                  ) : (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-500/10 text-green-600 dark:text-green-400">
                      crea
                    </span>
                  )}
                </td>
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
    const locations = empresaActiva?.puntosDeVenta || []
    return (
      <div className="space-y-5">
        <DialogDescription>
          {fileData.totalRows} filas {origen === 'pegado' ? 'pegadas' : 'en el archivo'}.
          Revisá la correspondencia entre las columnas y los campos del sistema.
          Los campos obligatorios están marcados con <span className="text-destructive font-medium">*</span>.
          {origen === 'pegado' && !headers.some(h => !/^Columna \d+$/.test(h)) && (
            <> No se detectó encabezado, así que las columnas se llaman «Columna 1»,
            «Columna 2»… Mirá las filas de ejemplo de abajo para saber cuál es cuál.</>
          )}
        </DialogDescription>

        {/* Cuántas se crean y cuántas se actualizan, ANTES de confirmar. Sin
            esto, una lista de precios que iba a actualizar doscientos productos
            puede terminar creando doscientos duplicados por un SKU mal mapeado, y
            recién se ve en el paso 3. */}
        {columnMap.name >= 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-xs">
            <span className="font-semibold">Si confirmás:</span>
            <span className="text-green-600 dark:text-green-400 font-mono font-semibold">
              {previsualizacion.crear} se crean
            </span>
            <span className="text-blue-600 dark:text-blue-400 font-mono font-semibold">
              {previsualizacion.actualizar} se actualizan
            </span>
            {origen === 'archivo' && fileData.totalRows > fileData.rows.length && (
              <span className="text-muted-foreground">
                (sobre las {fileData.rows.length} filas de la vista previa)
              </span>
            )}

            {/* Cómo se va a leer el primer costo, ANTES de confirmar.
                «1.234,50» leído al revés son mil doscientos treinta y cuatro con
                cincuenta convertidos en uno con veintitrés, y **no falla nada**:
                el producto queda cargado y el margen que muestra el POS pasa a
                ser mentira. Verlo escrito es la única forma de detectarlo a
                tiempo. */}
            {costoDeMuestra && (
              <span className="basis-full text-muted-foreground">
                El primer costo, «{costoDeMuestra.crudo}», se va a guardar como{' '}
                <span className="font-mono font-semibold text-foreground">
                  ${costoDeMuestra.leido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>.
              </span>
            )}
          </div>
        )}

        {/* Default location selector */}
        <div className="rounded-lg border p-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
            Sucursal destino para el stock
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            El stock se asignará a esta sucursal a menos que el archivo tenga una columna "Sucursal" mapeada.
          </p>
          <select
            value={defaultLocation}
            onChange={(e) => setDefaultLocation(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors w-full sm:w-64"
          >
            {/* El vacío es una opción de verdad y es la que viene puesta: el
                servidor resuelve el punto de venta por defecto de la empresa. El
                `'principal'` que había acá no coincide con ningún código de una
                empresa sembrada, y desde que el servidor valida el parámetro la
                importación entera fallaba con 400. */}
            <option value="">Sucursal por defecto de la empresa</option>
            {locations.map(pv => (
              <option key={pv.id ?? pv.code} value={pv.code || ''}>{pv.name}</option>
            ))}
          </select>
        </div>

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
    const algoEntro = huboCambios(result)

    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center justify-center py-4 gap-3">
          {algoEntro ? (
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
              {algoEntro
                ? 'Importación completada'
                : 'Importación finalizada con advertencias'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Se procesaron {result.total} filas.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border bg-green-50/50 dark:bg-green-950/10 p-3 text-center">
            <p className="text-2xl font-black text-green-600 dark:text-green-400 font-mono">{result.created}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Creados</p>
          </div>
          <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/10 p-3 text-center">
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400 font-mono">{result.updated}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Actualizados</p>
          </div>
          {/* Los pisados: el mismo producto vino más de una vez en el archivo y
              quedó **el último**. Sin decirlo, el stock que queda no es la suma ni
              el máximo y nadie sabe por qué. */}
          <div className="rounded-lg border bg-amber-50/50 dark:bg-amber-950/10 p-3 text-center">
            <p className={`text-2xl font-black font-mono ${result.pisados ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/40'}`}>
              {result.pisados || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Pisados</p>
          </div>
          <div className="rounded-lg border bg-red-50/50 dark:bg-red-950/10 p-3 text-center">
            <p className={`text-2xl font-black font-mono ${hasErrors ? 'text-destructive' : 'text-muted-foreground/40'}`}>
              {result.errors?.length || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Errores</p>
          </div>
        </div>

        {result.pisados > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              {result.pisados} {result.pisados === 1 ? 'fila venía' : 'filas venían'} repetida
              {result.pisados === 1 ? '' : 's'} (mismo SKU, o mismo nombre si no hay SKU).
              Quedó la última de cada una.
            </span>
          </div>
        )}

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
                    {/* La línea que ve el usuario, no la fila de la matriz. */}
                    <span className="shrink-0 font-mono text-muted-foreground w-16">
                      {origen === 'pegado' ? 'línea ' : 'fila '}{lineaDelError(err.fila)}
                    </span>
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
            {algoEntro
              ? 'Listo. Al cerrar, el listado se actualiza solo.'
              : 'No entró ningún producto. Revisá los errores y corregí la lista.'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden" showCloseButton={!importing}>
        <div className="px-6 pt-5 pb-0 shrink-0">
          <DialogHeader className="mb-3">
            <DialogTitle>Importar Productos</DialogTitle>
          </DialogHeader>
          {renderStepIndicator()}
        </div>

        <div className="px-6 pb-6 overflow-y-auto min-h-0 flex-1">
          {step === 1 && renderUploadStep()}
          {step === 2 && renderMappingStep()}
          {step === 3 && renderResultStep()}
        </div>

        <DialogFooter className="mx-0 mb-0 px-6 py-5 border-t shrink-0">
          {step === 1 && (
            <div className="flex justify-between w-full">
              <DialogClose asChild>
                <Button variant="ghost">Cancelar</Button>
              </DialogClose>
              {origen === 'pegado' ? (
                <Button
                  disabled={!textoPegado.trim()}
                  onClick={handlePegado}
                  className="bg-brand hover:bg-brand-dark text-white"
                >
                  {textoPegado.trim() ? 'Continuar' : 'Pegá tu lista'}
                  <ArrowRight className="size-4 ml-1.5" />
                </Button>
              ) : (
                <Button disabled={!file || parsing} onClick={() => file && handleFile(file)} className="bg-brand hover:bg-brand-dark text-white">
                  {parsing ? 'Leyendo...' : file ? 'Continuar' : 'Seleccioná un archivo'}
                  <ArrowRight className="size-4 ml-1.5" />
                </Button>
              )}
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
                {/* Deshabilitado mientras la importación está en vuelo: un
                    segundo clic serían los mismos productos entrando dos veces y
                    dos filas idénticas en el historial de costos. */}
                <Button onClick={handleImport} disabled={!requiredMapped || importing || !hayDatos} className="bg-brand hover:bg-brand-dark text-white">
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
              <Button onClick={handleClose} className="bg-brand hover:bg-brand-dark text-white">
                Finalizar
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
