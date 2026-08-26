#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /data
  chown node:node /data
  exec gosu node "$@"
fi

exec "$@"
