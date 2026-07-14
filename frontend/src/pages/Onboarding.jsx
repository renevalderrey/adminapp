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

const Onboarding = () => {
  const navigate = useNavigate()
  const usuario = useStore(s => s.usuario)
  const loadEmpresaContext = useStore(s => s.loadEmpresaContext)
  const fileInputRef = useRef(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError('')
  }

  const handleLogoChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (event) => setLogoPreview(event.target.result)
    reader.readAsDataURL(file)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('El nombre de la empresa es obligatorio')
      return
    }
    if (!form.phone.trim()) {
      setError('El teléfono es obligatorio')
      return
    }
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('name', form.name)
      fd.append('cuit', form.cuit)
      fd.append('phone', form.phone)
      fd.append('address', form.address)
      fd.append('city', form.city)
      fd.append('state', form.state)
      fd.append('pv_name', form.pv_name)
      if (logoFile) fd.append('logo', logoFile)

      const res = await api.post('/empresas/onboarding', fd)
      if (res.data.ok) {
        await loadEmpresaContext()
        navigate('/pos', { replace: true })
      }
    } catch (err) {
      const msg = err.response?.data?.error;
      if (msg) {
        setError(msg);
      } else if (err.code === 'ERR_NETWORK') {
        setError('No se pudo conectar con el servidor. Verificá que el backend esté corriendo.');
      } else {
        setError('Ocurrió un error inesperado. Intentalo de nuevo.');
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto h-14 w-14 rounded-xl overflow-hidden flex items-center justify-center mb-3">
            <img src="/logo_sin_fondo.png" alt="Admin App" className="h-full w-full object-contain" />
          </div>
          <CardTitle className="text-2xl">Configurá tu empresa</CardTitle>
          <CardDescription>
            Completá los datos para empezar a usar Admin App. Tenés 15 días de prueba gratuita.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
                {error}
              </div>
            )}

            {/* Logo */}
            <div className="flex flex-col items-center gap-3">
              <div
                className="h-24 w-24 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden cursor-pointer hover:border-brand/50 transition-colors bg-muted/30"
                onClick={() => fileInputRef.current?.click()}
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
            </div>

            <Field.Root className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                Nombre de la empresa <span className="text-destructive">*</span>
              </Label>
              <Input
                required
                placeholder="Ej: Mi Empresa SRL"
                value={form.name}
                onChange={e => handleChange('name', e.target.value)}
              />
            </Field.Root>

            <div className="grid grid-cols-2 gap-4">
              <Field.Root className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  CUIT
                </Label>
                <Input
                  placeholder="30-12345678-9"
                  value={form.cuit}
                  onChange={e => handleChange('cuit', e.target.value)}
                />
              </Field.Root>
              <Field.Root className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  Teléfono <span className="text-destructive">*</span>
                </Label>
                <Input
                  required
                  placeholder="+54 11 1234-5678"
                  value={form.phone}
                  onChange={e => handleChange('phone', e.target.value)}
                />
              </Field.Root>
            </div>

            <Field.Root className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                Dirección <span className="text-destructive">*</span>
              </Label>
              <Input
                required
                placeholder="Av. Corrientes 1234"
                value={form.address}
                onChange={e => handleChange('address', e.target.value)}
              />
            </Field.Root>

            <div className="grid grid-cols-2 gap-4">
              <Field.Root className="space-y-2">
                <Label>Ciudad <span className="text-destructive">*</span></Label>
                <Input
                  required
                  placeholder="Buenos Aires"
                  value={form.city}
                  onChange={e => handleChange('city', e.target.value)}
                />
              </Field.Root>
              <Field.Root className="space-y-2">
                <Label>Provincia <span className="text-destructive">*</span></Label>
                <Input
                  required
                  placeholder="CABA"
                  value={form.state}
                  onChange={e => handleChange('state', e.target.value)}
                />
              </Field.Root>
            </div>

            <Separator />

            <Field.Root className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5 text-muted-foreground" />
                Nombre del punto de venta / sucursal
              </Label>
              <Input
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
              disabled={loading}
              style={{ backgroundColor: 'var(--color-brand)' }}
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creando empresa...</>
              ) : (
                <><ArrowRight className="h-4 w-4 mr-2" /> Comenzar a usar Admin App</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default Onboarding
