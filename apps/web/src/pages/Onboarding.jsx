import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '@/store/useStore'
import api from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@base-ui/react/field'
import { Separator } from '@/components/ui/separator'
import { Building2, MapPin, Phone, FileText, Store, ArrowRight, Loader2, ImageUp } from 'lucide-react'
import { validarOnboarding, errorDelLogo, soloDigitos, ORDEN_DE_CAMPOS } from '@/utils/onboarding'

// ════════════════════════════════════════════
//  La primera pantalla que ve un cliente, y la que le cuadruplicó la empresa
//
//  Lo que pasó en producción, en orden: el POST creó la empresa, `App.jsx`
//  siguió rindiendo esta pantalla —el contexto no se había recargado—, el botón
//  se volvió a habilitar, y cada clic fue una empresa nueva con su punto de
//  venta y su suscripción. Cuatro.
//
//  El arreglo que **de verdad** cierra el agujero está en la API: el onboarding
//  es idempotente y una segunda llamada devuelve la empresa que ya existe. Lo
//  de acá es la otra mitad: que no haya una segunda llamada, y que el que la
//  mira entienda qué pasó.
//
//  ── Las reglas, y por qué cada una ──
//
//  1 · **Una sola vez.** La guardia es una `ref`, no el estado: `setState` es
//      asincrónico, y entre el primer clic y el re-render que apaga el botón
//      entran un segundo clic y un Enter. La `ref` cambia en el mismo tick.
//
//  2 · **El éxito no se deshace.** El `finally { setLoading(false) }` que había
//      volvía a habilitar el botón **también cuando la empresa se había creado
//      bien**. Ahora hay tres estados y de `creada` no se vuelve.
//
//  3 · **El error vive en su campo.** Un único cartel arriba obliga a leerlo y
//      después buscar a qué campo se refiere. Y el foco va al primero que está
//      mal: en un teléfono, el campo con problema puede estar fuera de pantalla.
//
//  4 · **Se valida lo mismo que exige el servidor.** No más: un campo marcado
//      como obligatorio en la pantalla y opcional en la API es una molestia
//      inventada. No menos: si la API lo exige, que el rechazo no cueste una
//      ida y vuelta con la red de un teléfono.
//
//  5 · **Los espacios se recortan antes de comparar y antes de mandar.** Un
//      nombre que es sólo espacios pasaba la validación y llegaba vacío.
//
//  6 · **El corte de red no invita a reintentar a ciegas.** Si la petición se
//      cortó, la empresa **puede haberse creado igual**. El mensaje lo dice y
//      ofrece recargar, que es lo que aclara la duda.
//
//  7 · **Cada etiqueta está atada a su campo.** Los `<label>` no tenían
//      `htmlFor` y los `<input>` no tenían `id`: clickear la etiqueta no
//      enfocaba nada y un lector de pantalla leía campos sin nombre. La primera
//      pantalla del sistema era la menos accesible de todas.
//
//  Las reglas de validación viven en `utils/onboarding.js`, que se prueba sin
//  montar nada. Acá queda el comportamiento, que es lo que necesita montarse.
// ════════════════════════════════════════════

const Onboarding = () => {
  const navigate = useNavigate()
  const recargarContexto = useStore(s => s.recargarContexto)
  const fileInputRef = useRef(null)

  // Una sola llamada, garantizada en el mismo tick. El estado de abajo dibuja;
  // esta ref decide.
  const enviandoRef = useRef(false)

  // `editando` → `enviando` → `creada`. De `creada` no se vuelve: la empresa
  // existe y el botón no tiene que ofrecer crearla de nuevo.
  const [estado, setEstado] = useState('editando')
  const [errores, setErrores] = useState({})
  const [aviso, setAviso] = useState('')
  const [logoPreview, setLogoPreview] = useState(null)
  const [logoFile, setLogoFile] = useState(null)
  const [form, setForm] = useState({
    name: '',
    cuit: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    pv_name: 'Sucursal Principal',
  })

  const enviando = estado === 'enviando'
  const creada = estado === 'creada'

  const handleChange = (nombre, valor) => {
    setForm(prev => ({ ...prev, [nombre]: valor }))

    // El error del campo se borra al escribirlo, no al reenviar: dejarlo puesto
    // mientras la persona ya lo está corrigiendo es señalar un problema que ya
    // no existe.
    setErrores(prev => (prev[nombre] ? { ...prev, [nombre]: undefined } : prev))
    setAviso('')
  }

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const problema = errorDelLogo(file)
    if (problema) {
      setErrores(prev => ({ ...prev, logo: problema }))
      return
    }

    setErrores(prev => ({ ...prev, logo: undefined }))
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (event) => setLogoPreview(event.target.result)
    reader.readAsDataURL(file)
  }

  /** Trae el contexto y entra. Se puede repetir sin crear nada. */
  const entrar = async () => {
    const hayEmpresa = await recargarContexto()

    if (hayEmpresa) {
      navigate('/pos', { replace: true })
      return true
    }

    // La empresa está creada y el contexto no llegó: es un problema de lectura,
    // no de alta. Por eso el botón que se ofrece recarga el contexto y **no**
    // vuelve a mandar el formulario.
    setAviso('Tu empresa quedó creada, pero no pudimos entrar. Probá de nuevo.')
    return false
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Regla 1. Antes que nada, y contra la ref.
    if (enviandoRef.current) return

    const encontrados = validarOnboarding(form)
    if (Object.keys(encontrados).length > 0) {
      setErrores(encontrados)
      setAviso('')

      // Se enfoca por `id` y no por una ref: cada campo ya tiene uno —lo
      // necesita para su `<label htmlFor>`— y un mapa de refs sería una segunda
      // forma de nombrar lo mismo, que se desincroniza cuando alguien renombra
      // un campo y toca sólo una de las dos.
      const primero = ORDEN_DE_CAMPOS.find(campo => encontrados[campo])
      document.getElementById(primero)?.focus()
      return
    }

    enviandoRef.current = true
    setEstado('enviando')
    setErrores({})
    setAviso('')

    try {
      const fd = new FormData()
      fd.append('name', form.name.trim())
      fd.append('cuit', soloDigitos(form.cuit))
      fd.append('phone', form.phone.trim())
      fd.append('address', form.address.trim())
      fd.append('city', form.city.trim())
      fd.append('state', form.state.trim())
      fd.append('pv_name', form.pv_name.trim() || 'Sucursal Principal')
      if (logoFile) fd.append('logo', logoFile)

      const res = await api.post('/empresas/onboarding', fd)

      // Un 200 con `ok:false` es una respuesta que existe y no se manejaba: se
      // caía en el `if` sin `else`, la pantalla no avanzaba y no aparecía
      // ningún error. Silencio, que es la peor respuesta posible.
      if (!res.data?.ok) {
        setAviso(res.data?.error || 'No pudimos crear la empresa. Intentalo de nuevo.')
        setEstado('editando')
        enviandoRef.current = false
        return
      }

      // Regla 2: creada. `enviandoRef` queda en true a propósito — pase lo que
      // pase de acá en adelante, este formulario no vuelve a mandar nada.
      setEstado('creada')
      await entrar()
    } catch (err) {
      const delServidor = err.response?.data?.error
      const cortada = err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED'

      if (delServidor) {
        setAviso(delServidor)
      } else if (cortada) {
        // Regla 6. El alta es idempotente del lado de la API, así que reintentar
        // no duplicaría; igual se ofrece recargar, que es lo que **aclara** si
        // la empresa quedó creada en vez de volver a jugar.
        setAviso(
          'Se cortó la conexión antes de saber el resultado. Puede que tu empresa '
          + 'haya quedado creada igual: recargá la página antes de volver a intentar.'
        )
      } else {
        setAviso('Ocurrió un error inesperado. Intentalo de nuevo.')
      }

      setEstado('editando')
      enviandoRef.current = false
    }
  }

  /** El `<p>` de error de un campo, o nada. */
  const errorDe = (campo) => (
    errores[campo]
      ? <p id={`error-${campo}`} className="text-xs text-destructive">{errores[campo]}</p>
      : null
  )

  /**
   * Lo que hace que un campo sea un campo y no una caja al lado de un texto.
   *
   * El `id` es lo que lo ata a su `<label htmlFor>`. Sin eso —que es como
   * estaba— clickear la etiqueta no enfoca nada y un lector de pantalla lee un
   * campo sin nombre: la primera pantalla del sistema era la menos accesible.
   *
   * `aria-invalid` y `aria-describedby` son la otra mitad: sin ellos el error
   * está en la pantalla y no en lo que se escucha.
   *
   * Y el mismo `id` es por donde se enfoca el primer campo mal, así que no hay
   * un mapa de refs paralelo que mantener.
   */
  const campo = (nombre) => ({
    id: nombre,
    'aria-invalid': errores[nombre] ? true : undefined,
    'aria-describedby': errores[nombre] ? `error-${nombre}` : undefined,
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto h-14 w-14 rounded-xl overflow-hidden flex items-center justify-center mb-3">
            <img src="/logo_sin_fondo.png" alt="Favalio" className="h-full w-full object-contain" />
          </div>
          <CardTitle className="text-2xl">Configurá tu empresa</CardTitle>
          <CardDescription>
            Completá los datos para empezar a usar Favalio. Tenés 15 días de prueba gratuita.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* `noValidate`: la validación es la de arriba y no la del navegador.
              Las dos a la vez son dos mensajes distintos para el mismo campo, en
              dos idiomas y con dos estilos, y la del navegador corta antes de que
              la nuestra pueda mandar el foco. */}
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* `fieldset` y no `disabled` campo por campo: mientras se envía no
                se toca nada, incluido el selector de logo, que no es un input
                común y se habría quedado vivo. */}
            <fieldset disabled={enviando || creada} className="space-y-5 border-0 p-0 m-0">
              {aviso && (
                <div role="alert" className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm space-y-2">
                  <p>{aviso}</p>
                  {creada && (
                    <button
                      type="button"
                      onClick={entrar}
                      className="underline font-medium cursor-pointer"
                    >
                      Reintentar
                    </button>
                  )}
                </div>
              )}

              {/* Logo */}
              <div className="flex flex-col items-center gap-3">
                {/* Apretable, asi que con teclado: cargar el logo era solo con
                    mouse, y esta pantalla es la primera que ve un cliente nuevo. */}
                <div
                  role="button"
                  tabIndex={enviando || creada ? -1 : 0}
                  aria-label="Elegir el logo de la empresa"
                  className="h-24 w-24 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden cursor-pointer hover:border-brand/50 transition-colors bg-muted/30 focus-visible:border-brand focus-visible:outline-none"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(evento) => {
                    if (evento.key !== 'Enter' && evento.key !== ' ') return
                    if (evento.target !== evento.currentTarget) return

                    evento.preventDefault()
                    fileInputRef.current?.click()
                  }}
                >
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" className="h-full w-full object-contain" />
                  ) : (
                    <ImageUp className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleLogoChange}
                />
                <span className="text-xs text-muted-foreground">
                  {logoFile ? logoFile.name : 'Hacé clic para subir un logo'}
                </span>
                {errorDe('logo')}
              </div>

              <Field.Root className="space-y-2">
                <Label htmlFor="name" className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Nombre de la empresa <span className="text-destructive">*</span>
                </Label>
                <Input
                  autoFocus
                  autoComplete="organization"
                  placeholder="Ej: Mi Empresa SRL"
                  value={form.name}
                  onChange={e => handleChange('name', e.target.value)}
                  {...campo('name')}
                />
                {errorDe('name')}
              </Field.Root>

              <div className="grid grid-cols-2 gap-4">
                <Field.Root className="space-y-2">
                  <Label htmlFor="cuit" className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    CUIT
                  </Label>
                  <Input
                    inputMode="numeric"
                    placeholder="30-12345678-9"
                    value={form.cuit}
                    onChange={e => handleChange('cuit', e.target.value)}
                    {...campo('cuit')}
                  />
                  {errorDe('cuit')}
                </Field.Root>
                <Field.Root className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    Teléfono <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+54 11 1234-5678"
                    value={form.phone}
                    onChange={e => handleChange('phone', e.target.value)}
                    {...campo('phone')}
                  />
                  {errorDe('phone')}
                </Field.Root>
              </div>

              <Field.Root className="space-y-2">
                <Label htmlFor="address" className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  Dirección <span className="text-destructive">*</span>
                </Label>
                <Input
                  autoComplete="street-address"
                  placeholder="Av. Corrientes 1234"
                  value={form.address}
                  onChange={e => handleChange('address', e.target.value)}
                  {...campo('address')}
                />
                {errorDe('address')}
              </Field.Root>

              <div className="grid grid-cols-2 gap-4">
                <Field.Root className="space-y-2">
                  <Label htmlFor="city">Ciudad <span className="text-destructive">*</span></Label>
                  <Input
                    autoComplete="address-level2"
                    placeholder="Buenos Aires"
                    value={form.city}
                    onChange={e => handleChange('city', e.target.value)}
                    {...campo('city')}
                  />
                  {errorDe('city')}
                </Field.Root>
                <Field.Root className="space-y-2">
                  <Label htmlFor="state">Provincia <span className="text-destructive">*</span></Label>
                  <Input
                    autoComplete="address-level1"
                    placeholder="CABA"
                    value={form.state}
                    onChange={e => handleChange('state', e.target.value)}
                    {...campo('state')}
                  />
                  {errorDe('state')}
                </Field.Root>
              </div>

              <Separator />

              <Field.Root className="space-y-2">
                <Label htmlFor="pv_name" className="flex items-center gap-1.5">
                  <Store className="h-3.5 w-3.5 text-muted-foreground" />
                  Nombre del punto de venta / sucursal
                </Label>
                <Input
                  id="pv_name"
                  placeholder="Sucursal Principal"
                  value={form.pv_name}
                  onChange={e => handleChange('pv_name', e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Después podrás agregar más sucursales desde Configuración.
                </p>
              </Field.Root>

              <Button
                type="submit"
                className="w-full h-11 font-semibold cursor-pointer hover:shadow-lg hover:shadow-cyan-500/30 hover:brightness-110"
                size="lg"
                disabled={enviando || creada}
                style={{ backgroundColor: 'var(--color-brand)' }}
              >
                {enviando && (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creando empresa...</>
                )}
                {creada && (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Entrando...</>
                )}
                {!enviando && !creada && (
                  <><ArrowRight className="h-4 w-4 mr-2" /> Comenzar a usar Favalio</>
                )}
              </Button>

              {enviando && (
                <p className="text-xs text-muted-foreground text-center">
                  Puede tardar hasta un minuto la primera vez. No cierres esta pantalla.
                </p>
              )}
            </fieldset>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default Onboarding
