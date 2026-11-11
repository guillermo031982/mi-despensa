#!/bin/sh
# Uso: ./release.sh 1.0.1  -> sube la versión en app.js, sw.js y version.json (necesario para que los móviles se actualicen solos)
set -e; V="$1"; [ -n "$V" ] || { echo "uso: $0 X.Y.Z"; exit 1; }
sed -i "s/^const APP_VERSION='[^']*'/const APP_VERSION='$V'/" app.js
sed -i "s/^const VERSION='[^']*'/const VERSION='$V'/" sw.js
printf '{"v":"%s"}\n' "$V" > version.json
grep -H "$V" app.js sw.js version.json
