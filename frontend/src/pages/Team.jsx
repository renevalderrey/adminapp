import React, { useState, useEffect } from 'react'
import { toast } from 'sonner'
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
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Users, UserPlus, XCircle, Mail, Clock, CheckCircle, Shield,
} from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Field } from '@base-ui/react/field'

const ROLE_LABELS = {
  admin: 'Admin',
  vendedor: 'Vendedor',
  produccion: 'Producción',
  compras: 'Compras',
}

const Team = () => {
  const empresaActiva = useStore(s => s.empresaActiva)
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('vendedor')
  const [inviting, setInviting] = useState(false)

  const fetchTeam = async () => {
    if (!empresaActiva?.id) return
    setLoading(true)
    try {
      const [membersRes, invitesRes] = await Promise.all([
        api.get(`/empresas/${empresaActiva.id}/usuarios`),
        api.get(`/empresas/${empresaActiva.id}/invitaciones`),
      ])
      if (membersRes.data.ok) setMembers(membersRes.data.data)
      if (invitesRes.data.ok) setInvitations(invitesRes.data.data)
    } catch (err) {
      console.error('Error loading team:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTeam() }, [empresaActiva?.id])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      await api.post(`/empresas/${empresaActiva.id}/invitar`, {
        email: inviteEmail,
        role: inviteRole,
      })
      setShowInviteDialog(false)
      setInviteEmail('')
      setInviteRole('vendedor')
      fetchTeam()
      toast.success('Invitación enviada')
    } catch (err) {
      toast.error(err.response?.data?.error || err.message)
    } finally {
      setInviting(false)
    }
  }

  const handleRevoke = async (id) => {
    try {
      await api.delete(`/empresas/invitaciones/${id}`)
      fetchTeam()
      toast.success('Invitación revocada')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleRoleChange = async (id, role) => {
    try {
      await api.put(`/empresas/usuarios/${id}`, { role })
      fetchTeam()
      toast.success('Rol actualizado')
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Equipo de <span className="text-primary">Trabajo</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestioná los usuarios que tienen acceso a {empresaActiva?.name}.
          </p>
        </div>
        <Button onClick={() => setShowInviteDialog(true)}>
          <UserPlus className="h-4 w-4 mr-2" /> Invitar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" /> Miembros ({members.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Cargando...</div>
          ) : members.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Sin miembros aún</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>USUARIO</TableHead>
                  <TableHead>EMAIL</TableHead>
                  <TableHead>ROL</TableHead>
                  <TableHead>ESTADO</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.usuario?.nombre || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{m.usuario?.email}</TableCell>
                    <TableCell>
                      <Select
                        value={m.role}
                        onValueChange={(v) => handleRoleChange(m.id, v)}
                      >
                        <SelectTrigger className="h-7 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(ROLE_LABELS).map(([k, l]) => (
                            <SelectItem key={k} value={k}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        <CheckCircle className="h-3 w-3 text-green-500" /> Activo
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {invitations.filter(i => i.status === 'pending').length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Mail className="h-4 w-4" /> Invitaciones Pendientes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>EMAIL</TableHead>
                  <TableHead>ROL</TableHead>
                  <TableHead>ENVIADA</TableHead>
                  <TableHead>VENCE</TableHead>
                  <TableHead className="text-right">ACCIONES</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.filter(i => i.status === 'pending').map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>{ROLE_LABELS[inv.role] || inv.role}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(inv.expires_at).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive text-xs"
                        onClick={() => handleRevoke(inv.id)}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Revocar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invitar empleado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Field.Root className="space-y-2">
              <Label>Email del empleado</Label>
              <Input
                type="email"
                placeholder="empleado@ejemplo.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
              />
            </Field.Root>
            <Field.Root className="space-y-2">
              <Label>Rol</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field.Root>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
              {inviting ? 'Enviando...' : 'Enviar invitación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Team
