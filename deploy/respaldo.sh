#!/bin/sh
# ══════════════════════════════════════════════════════════════
#  Favalio · Respaldo de la base, para el cron del VPS
#
#  Vuelca la base entera con pg_dump desde adentro del contenedor, la comprime
#  y borra las copias de más de 14 días.
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

echo "$(date -Is) ok $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
