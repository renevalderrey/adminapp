const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════
//  Guardia estática · el respaldo incluye las imágenes, y se verifica leyéndolo
//
//  ── Qué defecto cierra ──
//
//  `deploy/respaldo.sh` hacía sólo `pg_dump`. El día que se subiera la primera
//  foto de producto, esa foto quedaba **fuera de todo respaldo**: la base sabría
//  que existe —`products.image_url` la nombra— y el archivo viviría únicamente
//  en un volumen de Docker que nadie copiaba. Se descubre el día que se pierde
//  el disco, que es el día en que ya no hay nada que hacer.
//
//  Por eso el volumen y su respaldo entraron en el mismo commit, y por eso esta
//  guardia existe: para que sacarle el volumen al script ponga algo en rojo.
//
//  ── La regla que más importa: cómo se verifica el tar ──
//
//  Un `tar.gz` de un volumen **vacío** pesa unos 45 bytes. O sea que `[ -s … ]`
//  da verdadero igual y **no distingue vacío de cortado** — y un volumen vacío
//  es legítimo: el primer día no hay ninguna foto.
//
//  Lo que sí los distingue es que el archivo se pueda leer entero, que es
//  `tar -tzf`. Esta guardia exige esa forma y no la del tamaño.
//
//  ── Por qué se lee el script y no se ejecuta ──
//
//  Ejecutarlo necesita el stack de producción levantado: un contenedor de
//  Postgres con la base real, el volumen montado y el `.env` del VPS. Nada de
//  eso existe en CI. Lo que sí se puede afirmar sin levantar nada es qué dice el
//  script, y eso es lo que se afirma.
//
//  ── Qué se revierte para verlo en rojo ──
//
//  Cambiar el `tar -tzf` por `[ -s "$ARCHIVO_IMG" ]`. La tercera regla lo nombra.
// ════════════════════════════════════════════

const RAIZ = path.join(__dirname, '..', '..', '..', '..');
const RUTA = path.join(RAIZ, 'deploy', 'respaldo.sh');
const GUION = fs.readFileSync(RUTA, 'utf8');

describe('deploy/respaldo.sh cubre las imágenes', () => {
  it('el ancla: el script existe y tiene contenido', () => {
    // Sin esto, mover o renombrar el script dejaría todas las reglas de abajo
    // corriendo sobre una cadena vacía. Una cadena vacía no contiene nada malo,
    // así que la guardia pasaría en verde para siempre.
    expect(fs.existsSync(RUTA)).toBe(true);
    expect(GUION.split('\n').length).toBeGreaterThan(40);
  });

  it('nombra el volumen de imágenes', () => {
    expect(GUION).toMatch(/favalio_imagenes_favalio/);
  });

  it('lo empaqueta montándolo, y de sólo lectura', () => {
    // `docker cp` o leer la ruta del volumen en el disco del host dependen de
    // detalles internos de Docker que cambian entre versiones. Montarlo es la
    // forma documentada.
    expect(GUION).toMatch(/docker run --rm/);
    expect(GUION).toMatch(/:\/origen:ro/);
    expect(GUION).toMatch(/tar -czf/);
  });

  it('verifica el resultado LEYÉNDOLO, no por tamaño', () => {
    // La regla que importa.
    expect(GUION).toMatch(/tar -tzf/);

    // Y que no se haya colado la verificación por tamaño sobre el tar: sobre el
    // .sql.gz sí es válida —un pg_dump vacío es siempre un error— y por eso la
    // comprobación se hace sobre la variable del tar y no sobre cualquier `-s`.
    expect(GUION).not.toMatch(/\[\s*!?\s*-s\s+"\$ARCHIVO_IMG"/);
  });

  it('rota con el mismo DIAS_A_CONSERVAR que la base', () => {
    // Dos rotaciones con dos números distintos es la forma de terminar con
    // catorce días de base y tres de fotos sin que nadie lo note.
    const rotaciones = GUION.match(/-mtime "\+\$DIAS_A_CONSERVAR" -delete/g) || [];

    expect(rotaciones).toHaveLength(2);
    expect(GUION).toMatch(/favalio-imagenes-\*\.tar\.gz/);
  });

  it('un respaldo ilegible corta con estado distinto de cero', () => {
    // «Falló» tiene que significar «el cron lo reporta». Un script que escribe
    // un mensaje y sigue con exit 0 deja el fallo en un log que nadie mira.
    const bloque = GUION.slice(GUION.indexOf('tar -tzf'));

    expect(bloque).toMatch(/RESPALDO DE IMAGENES ILEGIBLE/);
    expect(bloque).toMatch(/exit 1/);
  });
});

describe('el compose y el Caddyfile sostienen lo mismo', () => {
  const COMPOSE = fs.readFileSync(path.join(RAIZ, 'docker-compose.produccion.yml'), 'utf8');
  const CADDY = fs.readFileSync(path.join(RAIZ, 'deploy', 'Caddyfile'), 'utf8');

  it('el volumen existe y la API lo monta con escritura', () => {
    expect(COMPOSE).toMatch(/imagenes_favalio:/);
    expect(COMPOSE).toMatch(/- imagenes_favalio:\/var\/favalio\/imagenes\n/);
  });

  it('Caddy lo monta de sólo lectura: el que escribe es la API', () => {
    expect(COMPOSE).toMatch(/- imagenes_favalio:\/var\/favalio\/imagenes:ro/);
  });

  it('la ruta sale de una variable y es absoluta', () => {
    // Relativa al WORKDIR sería una bomba de tiempo: con los workspaces el
    // WORKDIR del contenedor pasó de /app a /app/apps/api.
    expect(COMPOSE).toMatch(/RUTA_DE_IMAGENES: \/var\/favalio\/imagenes/);
  });

  it('Caddy sirve /img/ desde el volumen, con el prefijo sacado', () => {
    // Sin el `strip_prefix`, Caddy buscaría /var/favalio/imagenes/img/aa/bb/… y
    // todas las fotos darían 404.
    expect(CADDY).toMatch(/handle \/img\/\*/);
    expect(CADDY).toMatch(/uri strip_prefix \/img/);
    expect(CADDY).toMatch(/root \* \/var\/favalio\/imagenes/);
  });

  it('la tienda no se indexa, y la regla es de sitio', () => {
    const bloque = CADDY.slice(CADDY.indexOf('tienda.{$DOMINIO}'));

    expect(bloque).toMatch(/X-Robots-Tag "noindex, nofollow"/);
    // De sitio y no adentro de un `handle`: la próxima ruta nace protegida.
    expect(bloque.indexOf('X-Robots-Tag')).toBeLessThan(bloque.indexOf('handle /img/*'));
  });
});
