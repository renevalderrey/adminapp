# Reglas de Diseño — Admin App

## Paleta de Colores

Paleta fría y profesional, ideal para una aplicación SaaS de gestión y ERP. Transmite confianza, seguridad y crecimiento tecnológico.

| Color | Hex | Propósito |
|-------|-----|-----------|
| Azul Oscuro | `#0B3055` | Pilares, estructura, seriedad corporativa |
| Turquesa / Cian Brillante | `#00B4B6` | Acciones principales, botones, tecnología, dinamismo |
| Turquesa Oscuro | `#008B8E` | Hover de botones, sombras, contraste 3D |
| Fondo claro | `#F8F9FA` | Fondos de cards / secciones (light mode) |

### Uso en CSS

```css
--color-brand: #00B4B6;
--color-brand-dark: #008B8E;
--color-brand-deep: #0B3055;
```

## Logotipo

- `logo.png` — Solo el ícono (favicon, login, navegador)
- `Logo_nombre_frase.png` — Logotipo completo con nombre y tagline

## Tipografía

- **Fuente principal:** Inter (sans-serif)
- **Fuente código:** JetBrains Mono (monospace)

## Componentes

- Los botones de acción principal usan `--color-brand` (`#00B4B6`)
- Estados hover usan `--color-brand-dark` (`#008B8E`)
- Encabezados y barras laterales usan `--color-brand-deep` (`#0B3055`) cuando corresponde
