#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  node setup.mjs
fi
node server.mjs
