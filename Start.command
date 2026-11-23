#!/bin/bash
set -e
cd "$(dirname "$0")/dist"
echo "Ism PDF Watermark Studio"
echo "Open http://127.0.0.1:4173 in your browser."
echo "Keep this window open while using the app. Press Control-C to stop."
python3 -m http.server 4173 --bind 127.0.0.1
