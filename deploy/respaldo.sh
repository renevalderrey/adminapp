#!/bin/sh
# ══════════════════════════════════════════════════════════════
#  Favalio · Respaldo de la base Y de las imágenes, para el cron del VPS
#
#  Vuelca la base entera con pg_dump desde adentro del contenedor, empaqueta el
#  volumen de imágenes, comprime las dos cosas y borra las copias de más de 14
#  días.
#
#  ⚠ **Las imágenes están acá desde el hito 10.** Antes este script sólo hacía
#    `pg_dump`, así que el día que se subiera la primera foto de producto esa
#    foto quedaba fuera de todo respaldo: la base sabría que existe
#    —`products.image_url`— y el archivo no estaría en ninguna copia. Por eso el
#    volumen y su respaldo entraron en el MISMO commit.
#
#  Instalación (una vez, como root en el VPS):
#
#      chmod +x /opt/favalio/deploy/respaldo.sh
#      crontab -e
#      # todos los días a las 03:15
#      15 3 * * * /opt/favalio/deploy/respaldo.sh >> /var/log/favalio-respaldo.log 2>&1
#
#  ⚠ Un respaldo que nadie restauró nunca no es un respaldo. Probar la
#    restauración en una base descartable ANTES de necesitarla:
#
#      gunzip -c favalio-2026-08-09.sql.gz | docker compose -f \
#        /opt/favalio/docker-compose.produccion.yml exec -T postgres \
#        psql -U favalio -d favalio_prueba
#
#  Y sacar las copias del VPS: un respaldo que vive en el mismo disco que la
#  base no cubre el caso en que se pierde el disco.
# ══════════════════════════════════════════════════════════════
set -eu

RAIZ="${RAIZ:-/opt/favalio}"
DESTINO="${DESTINO:-/var/respaldos/favalio}"
DIAS_A_CONSERVAR="${DIAS_A_CONSERVAR:-14}"

COMPOSE="docker compose -f $RAIZ/docker-compose.produccion.yml"

# Usuario y base salen del mismo .env que usa el compose: si allá cambian, acá
# cambian solos.
# shellcheck disable=SC1091
. "$RAIZ/.env"

mkdir -p "$DESTINO"
ARCHIVO="$DESTINO/favalio-$(date +%Y-%m-%d-%H%M).sql.gz"

# -T: sin TTY, que es lo que rompe pg_dump cuando corre desde cron.
$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$ARCHIVO"

# Un pg_dump que falla a mitad deja un .gz corto y con estado de salida 0 si no
# se mira: `set -e` corta antes, pero el tamaño se verifica igual.
if [ ! -s "$ARCHIVO" ]; then
  echo "$(date -Is) RESPALDO VACIO: $ARCHIVO" >&2
  exit 1
fi

find "$DESTINO" -name 'favalio-*.sql.gz' -mtime "+$DIAS_A_CONSERVAR" -delete

# ══════════════════════════════════════════════════════════════
#  Las imágenes
#
#  El volumen se empaqueta con un contenedor descartable que lo monta de sólo
#  lectura. No se usa `docker cp` ni se lee del host: la ruta del volumen en el
#  disco del host es un detalle de Docker que cambia entre versiones, y montarlo
#  es la forma que Docker documenta.
#
#  El nombre del volumen lleva el prefijo del proyecto del compose (`name:
#  favalio` en docker-compose.produccion.yml), de ahí `favalio_imagenes_favalio`.
# ══════════════════════════════════════════════════════════════
VOLUMEN_IMAGENES="${VOLUMEN_IMAGENES:-favalio_imagenes_favalio}"
ARCHIVO_IMG="$DESTINO/favalio-imagenes-$(date +%Y-%m-%d-%H%M).tar.gz"

docker run --rm \
  -v "$VOLUMEN_IMAGENES":/origen:ro \
  -v "$DESTINO":/destino \
  alpine tar -czf "/destino/$(basename "$ARCHIVO_IMG")" -C /origen .

# ⚠ Acá NO se verifica por tamaño, y el motivo importa.
#
# Un tar.gz de un volumen **vacío** pesa unos 45 bytes, así que `[ -s ... ]` da
# verdadero igual y no distingue «vacío» de «cortado». Y un volumen vacío es
# legítimo: el primer día no hay ninguna foto.
#
# Lo que sí los distingue es que el archivo se pueda **leer entero**. `tar -tzf`
# recorre el índice completo y falla si el gzip está truncado, que es
# exactamente el caso que interesa atrapar.
if ! tar -tzf "$ARCHIVO_IMG" > /dev/null 2>&1; then
  echo "$(date -Is) RESPALDO DE IMAGENES ILEGIBLE: $ARCHIVO_IMG" >&2
  exit 1
fi

find "$DESTINO" -name 'favalio-imagenes-*.tar.gz' -mtime "+$DIAS_A_CONSERVAR" -delete

echo "$(date -Is) ok $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
echo "$(date -Is) ok $ARCHIVO_IMG ($(du -h "$ARCHIVO_IMG" | cut -f1))"
