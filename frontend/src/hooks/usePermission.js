import useStore from '@/store/useStore';

export function usePermission() {
  const permisos = useStore(s => s.permisos);

  function can(codigo) {
    if (!codigo) return true;
    if (!permisos || !Array.isArray(permisos)) return false;
    if (permisos.includes(codigo)) return true;
    const wildcard = codigo.split('.').slice(0, -1).join('.') + '.*';
    return permisos.includes(wildcard);
  }

  function canAny(codigos) {
    return codigos.some(c => can(c));
  }

  function canAll(codigos) {
    return codigos.every(c => can(c));
  }

  return { can, canAny, canAll, permisos };
}
