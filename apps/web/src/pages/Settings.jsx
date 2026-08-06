import React, { useState, useEffect } from 'react'
import api from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ShieldCheck, FileCheck, Key, AlertCircle, CheckCircle2,
  Info, ExternalLink, Upload, RefreshCw, Store, ArrowRight
} from 'lucide-react'
import { Link } from 'react-router-dom'

const Settings = () => {
  const [config, setConfig] = useState({
    cuit: '', pv: '', environment: 'homologation',
    cert: '', key: '', tax_condition: 'Monotributo',
  })

  const [afipStatus, setAfipStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState({ type: '', msg: '' })
  const [generatedFiles, setGeneratedFiles] = useState(null)
  const [certInfo, setCertInfo] = useState(null)

  const fetchCertInfo = async () => {
    try {
      const res = await api.get('/afip/cert-info')
      if (res.data.ok) setCertInfo(res.data.data)
      else setCertInfo(null)
    } catch (err) { console.error('Error fetching cert info:', err) }
  }

  // Carga la configuración ya guardada en el formulario.
  //
  // Sin esto el estado arrancaba en blanco y handleSave posteaba el objeto
  // entero: cambiar solo el desplegable de ambiente mandaba cuit:'' y pv:''
  // junto con el cambio, y esos vacíos pisaban lo que estaba guardado.
  //
  // El certificado y la clave NO se traen: son material sensible y no tiene
  // sentido devolverlos al navegador. Se dejan vacíos a propósito, y el
  // backend ignora los campos vacíos justamente para que eso no borre nada.
  const fetchConfig = async () => {
    try {
      const res = await api.get('/settings')
      const d = res.data?.data || {}

      setConfig((actual) => ({
        ...actual,
        cuit: d.afip_cuit ?? actual.cuit,
        pv: d.afip_pv ?? actual.pv,
        environment: d.afip_environment || actual.environment,
        tax_condition: d.tax_condition || actual.tax_condition,
      }))
    } catch (err) { console.error('Error fetching AFIP config:', err) }
  }

  // ⚠ Acá vivían tres cosas de TiendaNube, y las tres se fueron con la tarjeta
  // (hito 7, US7 escenario 5):
  //
  //  · `checkTiendaNubeStatus`, que leía `res.data.linked` de `GET
  //    /tiendanube/status`. Ese campo **ya no existe**: el endpoint ahora
  //    devuelve `estado` con cuatro valores. Mientras estuvo, la tarjeta decía
  //    «no vinculada» SIEMPRE, incluso con la tienda conectada — y su `catch`
  //    era un `console.error`, así que una caída de red se veía igual.
  //  · `handleConnectTiendaNube`, que mandaba al usuario a una URL de
  //    autorización sin `state`. Ese circuito terminaba siempre en error.
  //  · La lectura de `?tiendanube=success|error`, que quedó muerta cuando el
  //    callback pasó a redirigir a `/tiendanube?estado=…&motivo=…`.
  //
  // Dos lugares que muestran el estado de lo mismo se separan y **nada avisa**;
  // ya pasó con las listas de estados de orden que la funcionalidad 012 encontró
  // duplicadas. Ahora hay uno solo, y desde acá se llega por el enlace de abajo.
  useEffect(() => {
    fetchConfig()
    fetchCertInfo()
  }, [])

  const checkStatus = async () => {
    try {
      const res = await api.get('/afip/status')
      setAfipStatus(res.data)
    } catch (err) {
      setAfipStatus({ error: 'No se pudo conectar con AFIP. Verificá tu configuración.' })
    }
  }

  const handleFileUpload = (e, field) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => setConfig(prev => ({ ...prev, [field]: event.target.result }))
    reader.readAsText(file)
  }

  const handleGenerateCSR = async () => {
    setLoading(true)
    try {
      const res = await api.post('/afip/generate-csr', { alias: 'Admin App' })
      setGeneratedFiles(res.data.data)
      setSaveStatus({ type: 'ok', msg: 'Archivos generados. Descargá ambos a continuación.' })
    } catch (err) {
      setSaveStatus({ type: 'error', msg: 'Error al generar CSR: ' + err.message })
    } finally { setLoading(false) }
  }

  const downloadFile = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setLoading(true)
    setSaveStatus({ type: '', msg: '' })
    try {
      await api.post('/afip/setup', config)
      setSaveStatus({ type: 'ok', msg: 'Configuración guardada. Probando conexión...' })
      await fetchCertInfo()
      await checkStatus()
    } catch (err) {
      setSaveStatus({ type: 'error', msg: 'Error al guardar: ' + err.message })
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1>Facturación AFIP</h1>
        <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-fg-2">
          Vinculá los servicios oficiales de ARCA/AFIP para emitir comprobantes electrónicos.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-6">
        {/* Left: Setup Guide */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Asistente de Configuración AFIP
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Step 1 */}
              <Card className={config.cert && config.key ? 'bg-green-500/5 border-green-500/20' : 'bg-muted/50'}>
                <CardContent className="p-4 flex gap-4">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${config.cert && config.key ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground'}`}>
                    {config.cert && config.key ? '✓' : '1'}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">Generar Llave y Pedido (.csr)</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Creá una identidad digital. Se generan dos archivos:
                      <br />• <code className="text-warn">privada.key</code> — Tu llave secreta
                      <br />• <code className="text-primary">pedido.csr</code> — El pedido para AFIP
                    </p>
                    {!generatedFiles ? (
                      <Button size="sm" className="mt-3" onClick={handleGenerateCSR} disabled={loading}>
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> {loading ? 'Generando...' : 'Generar Archivos'}
                      </Button>
                    ) : (
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="outline" className="text-warn border-orange-500/30"
                          onClick={() => downloadFile(generatedFiles.key, 'admin_app_privada.key')}>
                          <Key className="h-3.5 w-3.5 mr-1" /> Descargar .key
                        </Button>
                        <Button size="sm"
                          onClick={() => downloadFile(generatedFiles.csr, 'admin_app_pedido.csr')}>
                          <FileCheck className="h-3.5 w-3.5 mr-1" /> Descargar .csr
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Step 2 */}
              <Card className="bg-muted/50">
                <CardContent className="p-4 flex gap-4">
                  <div className="h-8 w-8 rounded-full bg-muted border flex items-center justify-center text-sm font-bold text-muted-foreground shrink-0">2</div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">Obtener Certificado (.crt) en ARCA</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Entrá a AFIP con Clave Fiscal. Buscá <strong>"Administración de Certificados Digitales"</strong>.
                      Subí el <code className="text-primary">.csr</code> y descargá el <code className="text-ok">.crt</code>.
                    </p>
                    <a href="https://auth.afip.gob.ar" target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline" className="mt-3">
                        Ir a AFIP <ExternalLink className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>

              {/* Step 3 */}
              <Card className="bg-muted/50">
                <CardContent className="p-4 flex gap-4">
                  <div className="h-8 w-8 rounded-full bg-muted border flex items-center justify-center text-sm font-bold text-muted-foreground shrink-0">3</div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">Delegar Facturación Electrónica</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      En <strong>"Administrador de Relaciones"</strong> de AFIP, vinculá el servicio
                      "Web Services - Facturación Electrónica" con tu certificado.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Step 4 */}
              <Card className="bg-muted/50">
                <CardContent className="p-4 flex gap-4">
                  <div className="h-8 w-8 rounded-full bg-muted border flex items-center justify-center text-sm font-bold text-muted-foreground shrink-0">4</div>
                  <div className="flex-1">
                    <p className="font-bold text-sm">Cargar Credenciales en Admin App</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Cargá los archivos <code className="text-warn">.key</code> y <code className="text-ok">.crt</code> en el formulario.
                      Luego presioná <strong>Guardar y Verificar</strong>.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 flex gap-3">
              <Info className="h-4 w-4 text-warn shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Tus llaves privadas se almacenan de forma segura en tu servidor.
                Nunca compartas el archivo <code className="text-warn">.key</code> con nadie.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right: Form */}
        <div>
          <form onSubmit={handleSave}>
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm">Datos de Facturación</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">CUIT Emisor</label>
                  <Input type="number" placeholder="Ej: 20123456789" value={config.cuit}
                    onChange={e => setConfig({ ...config, cuit: e.target.value })} />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Punto de Venta (PV)</label>
                  <Input type="number" placeholder="Ej: 5" value={config.pv}
                    onChange={e => setConfig({ ...config, pv: e.target.value })} />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ambiente</label>
                  <select value={config.environment} onChange={e => setConfig({ ...config, environment: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="homologation">Homologación (Pruebas)</option>
                    <option value="production">Producción (Real)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Condición de IVA</label>
                  <select value={config.tax_condition} onChange={e => setConfig({ ...config, tax_condition: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="Monotributo">Monotributo (Factura C)</option>
                    <option value="RI">Responsable Inscripto (Factura A/B)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Certificado (.crt)</label>
                    <label className="flex items-center justify-center gap-1.5 h-9 w-full rounded-md border border-input bg-background text-xs font-medium cursor-pointer hover:bg-accent transition-colors">
                      <Upload className="h-3.5 w-3.5" /> {config.cert ? 'Cargado ✓' : 'Subir'}
                      <input type="file" onChange={e => handleFileUpload(e, 'cert')} className="hidden" />
                    </label>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Llave Privada (.key)</label>
                    <label className="flex items-center justify-center gap-1.5 h-9 w-full rounded-md border border-input bg-background text-xs font-medium cursor-pointer hover:bg-accent transition-colors">
                      <Upload className="h-3.5 w-3.5" /> {config.key ? 'Cargada ✓' : 'Subir'}
                      <input type="file" onChange={e => handleFileUpload(e, 'key')} className="hidden" />
                    </label>
                  </div>
                </div>

                {certInfo && (
                  <Card className="bg-muted/50">
                    <CardContent className="p-3 text-[11px] space-y-1">
                      <div className="flex items-center gap-1.5 font-bold">
                        <ShieldCheck className="h-3.5 w-3.5 text-ok" /> Certificado Activo
                      </div>
                      <p><strong>Emisor:</strong> {certInfo.issuer}
                        {certInfo.isProduction
                          ? <Badge variant="destructive" className="ml-2 text-[9px]">PRODUCCIÓN</Badge>
                          : <Badge variant="secondary" className="ml-2 text-[9px]">HOMOLOGACIÓN</Badge>}
                      </p>
                      <p><strong>Sujeto:</strong> {certInfo.subject} ({certInfo.cuit})</p>
                      <p><strong>Vencimiento:</strong> {new Date(certInfo.validTo).toLocaleDateString()}</p>
                    </CardContent>
                  </Card>
                )}

                <Button type="submit" className="w-full h-11" disabled={loading}>
                  {loading ? 'Guardando...' : 'Guardar y Verificar'}
                </Button>

                {saveStatus.msg && (
                  <Card className={saveStatus.type === 'ok' ? 'border-green-500/30 bg-green-500/5' : 'border-destructive/30 bg-destructive/5'}>
                    <CardContent className="p-3 text-xs font-medium">
                      <span className={saveStatus.type === 'ok' ? 'text-ok' : 'text-destructive'}>
                        {saveStatus.msg}
                      </span>
                    </CardContent>
                  </Card>
                )}

                <Separator />

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Estado Conexión</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={checkStatus}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {afipStatus && (
                    <div className="mt-2 flex items-center gap-2">
                      {afipStatus.error ? (
                        <>
                          <AlertCircle className="h-4 w-4 text-destructive" />
                          <span className="text-xs text-destructive font-medium">Sin conexión: {afipStatus.error}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-ok" />
                          <span className="text-xs text-ok font-medium">Conectado: API operativa</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </form>

          {/* ── TiendaNube: acá solo queda el enlace ──

              La tarjeta que estaba en este lugar mostraba el estado de la
              conexión y ofrecía vincular. Se fue entera, y no por prolijidad:
              afirmaba dos cosas falsas —«El stock se sincroniza automáticamente
              mediante webhooks», sobre un webhook que respondía 401 a todo, y
              «sincronización bidireccional», sobre algo que va en un solo
              sentido— y leía un `linked` que el endpoint ya no devuelve, así que
              decía «no vinculada» con la tienda vinculada.

              El estado, el mapeo y la sincronización viven ahora en
              `/tiendanube`, que es UN solo lugar. */}
          <Card className="mt-6">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Store className="h-4 w-4 text-primary" /> Integración TiendaNube
              </CardTitle>
              <CardDescription className="text-xs">
                Tu tienda online tiene su propia pantalla.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">
                  El estado de la conexión, el mapeo de tus productos contra las variantes
                  de la tienda y la sincronización de stock están en TiendaNube.
                </p>

                {/* Un `Link` y no un `Button`: es navegación, no una acción.
                    Con un `onClick` que empuja la ruta a mano se pierden el
                    clic con Ctrl, el «abrir en pestaña nueva» y el `href` que el
                    navegador muestra abajo — y esta pantalla ya tuvo un botón
                    que llevaba a un lugar que no existía. */}
                <Link
                  to="/tiendanube"
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg
                             border border-border bg-background px-2.5 text-sm font-medium
                             transition-colors hover:bg-muted"
                >
                  Ir a TiendaNube <ArrowRight className="h-4 w-4" />
                </Link>

                {/* ⚠ El enlace puede devolverte al punto de venta: `/tiendanube`
                    está detrás del módulo `tiendanube` y todavía no lo tiene
                    ninguna empresa (paso manual P4). Un enlace que te expulsa sin
                    decir por qué se lee como un sistema roto; dicho, se lee como
                    lo que es. */}
                <p className="text-xs text-muted-foreground">
                  Si la integración todavía no está habilitada para tu empresa, ese enlace
                  te devuelve al punto de venta y la sección no aparece en el menú. Pedila y
                  se habilita.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default Settings
