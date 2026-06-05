import useStore from '@/store/useStore';

export function usePermission() {
  const permisos = useStore(s => s.permisos);

  function can(codigo) {
    return permisos.includes(codigo);
  }

  function canAny(codigos) {
    return codigos.some(c => permisos.includes(c));
  }

  function canAll(codigos) {
    return codigos.every(c => permisos.includes(c));
  }

  return { can, canAny, canAll, permisos };
}
