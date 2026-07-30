import { usePermission } from '@/hooks/usePermission';

export function Can({ codigo, children, fallback = null }) {
  const { can } = usePermission();

  if (can(codigo)) {
    return typeof children === 'function' ? children() : children;
  }

  return fallback;
}
