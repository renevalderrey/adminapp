import { usePermission } from '@/hooks/usePermission';

/**
 * Muestra sus hijos solo si el usuario tiene el permiso.
 *
 * ── Por qué falla cerrado ──
 *
 * El prop se llama `codigo`. Seis lugares lo pasaban como `permission`, y como
 * `can(undefined)` devuelve `true` —a propósito, para los ítems de menú que no
 * exigen ninguno— esos seis guardas **no filtraban nada**: el botón se veía
 * igual sin tener el permiso.
 *
 * Un guarda que ante un error de tipeo se abre en vez de cerrarse es peor que
 * no tenerlo, porque parece que está.
 */
export function Can({ codigo, children, fallback = null }) {
  const { can } = usePermission();

  if (!codigo) {
    if (import.meta.env.DEV) {
      console.error('[Can] falta el prop `codigo`. No se llama `permission`.');
    }
    return fallback;
  }

  if (can(codigo)) {
    return typeof children === 'function' ? children() : children;
  }

  return fallback;
}
