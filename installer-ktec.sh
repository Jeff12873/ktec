#!/bin/sh
# Installe KTEC sous Linux, ou le met à jour : ouvre la page d'installation dans le navigateur.
# Node vient du kit hors ligne (hors-ligne/node) ; sinon il est téléchargé une fois dans le profil.
cd "$(dirname "$0")" || exit 1

NODE_VERSION=v24.21.0   # version de Node utilisée par KTEC (aussi dans « Installer KTEC.bat » et outils/catalogue.json)
NODE=hors-ligne/node/bin/node
if [ -f "$NODE" ]; then
  # (un kit copié depuis une clé USB a perdu le droit d'exécution)
  chmod +x "$NODE" 2>/dev/null
else
  DOSSIER="${XDG_CACHE_HOME:-$HOME/.cache}/ktec-installation"
  NODE="$DOSSIER/node-$NODE_VERSION-linux-x64/bin/node"
  if [ ! -x "$NODE" ]; then
    echo "Téléchargement de Node $NODE_VERSION…"
    mkdir -p "$DOSSIER"
    if command -v curl >/dev/null; then curl -L --fail -o "$DOSSIER/node.tar.xz" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" || exit 1
    else wget -O "$DOSSIER/node.tar.xz" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" || exit 1; fi
    tar -xJf "$DOSSIER/node.tar.xz" -C "$DOSSIER" && rm "$DOSSIER/node.tar.xz"
  fi
fi

echo "La page d'installation s'ouvre dans votre navigateur. Fermer cette fenêtre l'arrête."
exec "$NODE" serveur/demarrer.js --installation "$@"
