import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function useConfirmDialog() {
  const [state, setState] = useState({ open: false, message: '', resolve: null })

  const confirm = useCallback((message) => {
    return new Promise((resolve) => {
      setState({ open: true, message, resolve })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    state.resolve(true)
    setState({ open: false, message: '', resolve: null })
  }, [state])

  const handleCancel = useCallback(() => {
    state.resolve(false)
    setState({ open: false, message: '', resolve: null })
  }, [state])

  const ConfirmDialogComponent = (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) handleCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar</DialogTitle>
          <DialogDescription>{state.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>Cancelar</Button>
          <Button variant="destructive" onClick={handleConfirm}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirm, ConfirmDialog: () => ConfirmDialogComponent }
}
