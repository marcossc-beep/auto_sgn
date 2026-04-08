#!/usr/bin/env bash
set -o errexit

npm install
# Usa o puppeteer do próprio projeto para instalar o chrome correto
./node_modules/.bin/puppeteer browsers install chrome