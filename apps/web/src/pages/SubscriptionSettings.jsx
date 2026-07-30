import React, { useState, useEffect, useMemo } from 'react'
import useStore from '@/store/useStore'
import api from '@/services/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CalendarDays, CreditCard, Clock, AlertTriangle } from 'lucide-react'

const STATUS_LABELS = {
  trialing: { label: 'Prueba gratuita', color: 'bg-blue-500/10 text-blue-500 border-blue-500/30' },
  active: { label: 'Activo', color: 'bg-green-500/10 text-green-500 border-green-500/30' },
  past_due: { label: 'Vencido', color: 'bg-orange-500/10 text-orange-500 border-orange-500/30' },
  expired: { label: 'Expirado', color: 'bg-destructive/10 text-destructive border-destructive/30' },
  cancelled: { label: 'Cancelado', color: 'bg-muted text-muted-foreground' },
}

const SubscriptionSettings = () => {
  const empresaActiva = useStore(s => s.empresaActiva)
  const [suscripcion, setSuscripcion] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      if (!empresaActiva?.id) return
      setLoading(true)
      try {
        const res = await api.get(`/empresas/${empresaActiva.id}/suscripcion`)
        if (res.data.ok) setSuscripcion(res.data.data)
      } catch { } finally {
        setLoading(false)
      }
    })()
  }, [empresaActiva?.id])

  const trialDaysLeft = useMemo(() => {
    if (!suscripcion?.trial_ends_at) return null
    const end = new Date(suscripcion.trial_ends_at)
    const now = new Date()
    const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24))
    return Math.max(0, diff)
  }, [suscripcion?.trial_ends_at])

  const statusInfo = suscripcion ? STATUS_LABELS[suscripcion.status] || STATUS_LABELS.trialing : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">
          Suscripción <span className="text-primary">y Plan</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Estado de tu plan y período de prueba.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Plan actual
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : !suscripcion ? (
            <p className="text-sm text-muted-foreground">No hay información de suscripción.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold">Plan {suscripcion.plan === 'free' ? 'Gratuito' : suscripcion.plan}</p>
                  <p className="text-sm text-muted-foreground">{empresaActiva?.name}</p>
                </div>
                {statusInfo && (
                  <Badge variant="outline" className={statusInfo.color}>
                    {statusInfo.label}
                  </Badge>
                )}
              </div>

              <Separator />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <CalendarDays className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Inicio del trial</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(suscripcion.trial_starts_at).toLocaleDateString('es-AR', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Clock className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Fin del trial</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(suscripcion.trial_ends_at).toLocaleDateString('es-AR', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
              </div>

              {trialDaysLeft !== null && trialDaysLeft <= 5 && suscripcion.status === 'trialing' && (
                <div className="flex items-start gap-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-orange-500">
                      {trialDaysLeft === 0
                        ? 'Tu período de prueba terminó hoy'
                        : `Te quedan ${trialDaysLeft} días de prueba`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {trialDaysLeft === 0
                        ? 'Contratá un plan para seguir usando el sistema.'
                        : 'Preparate para elegir un plan cuando finalice.'}
                    </p>
                  </div>
                </div>
              )}

              {trialDaysLeft !== null && trialDaysLeft > 5 && suscripcion.status === 'trialing' && (
                <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <CalendarDays className="h-5 w-5 text-blue-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-500">
                      Te quedan {trialDaysLeft} días de prueba gratuita
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Disfrutá de todas las funciones sin limitaciones.
                    </p>
                  </div>
                </div>
              )}

              <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
                <p className="font-medium mb-1">¿Qué incluye el plan gratuito?</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Gestión completa de ventas e inventario</li>
                  <li>Producción y recetas</li>
                  <li>Clientes y cuentas corrientes</li>
                  <li>Reportes y dashboard</li>
                  <li>Hasta 3 usuarios por empresa</li>
                  <li>Soporte por email</li>
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default SubscriptionSettings
