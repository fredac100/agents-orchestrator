#!/bin/bash
set -e

VPS_HOST="fred@192.168.1.151"
VPS_PORT=2222
VPS_APP_DIR="/home/fred/vps/apps/agents-orchestrator"
VPS_COMPOSE_DIR="/home/fred/vps"
SSH="ssh -p $VPS_PORT $VPS_HOST"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $1"; }
error() { echo -e "${RED}[deploy]${NC} $1"; }

SKIP_PUSH=false
for arg in "$@"; do
  case "$arg" in
    --skip-push) SKIP_PUSH=true ;;
  esac
done

if [ "$SKIP_PUSH" = false ]; then
  info "Fazendo push para origin..."
  git push origin main
  info "Fazendo push para nitro..."
  git push nitro main 2>/dev/null || warn "Push para nitro falhou (não crítico)"
fi

info "Verificando dados no VPS antes do deploy..."
DATA_FILES=$($SSH "ls -1 $VPS_APP_DIR/data/*.json 2>/dev/null | wc -l")
info "Arquivos de dados encontrados: $DATA_FILES"

if [ "$DATA_FILES" -gt 0 ]; then
  info "Criando backup dos dados..."
  $SSH "cp -r $VPS_APP_DIR/data $VPS_APP_DIR/data-backup-\$(date +%Y%m%d-%H%M%S)"
fi

info "Sincronizando código com o VPS..."
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='data-backup-*' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='*.log' \
  -e "ssh -p $VPS_PORT" \
  ./ "$VPS_HOST:$VPS_APP_DIR/"

info "Corrigindo permissões do diretório data..."
$SSH "sudo chown -R 1000:1000 $VPS_APP_DIR/data"

info "Rebuilding container..."
$SSH "cd $VPS_COMPOSE_DIR && docker compose up -d --build agents-orchestrator 2>&1 | tail -5"

info "Verificando container..."
sleep 2
STATUS=$($SSH "docker ps --filter name=agents-orchestrator --format '{{.Status}}'")
if echo "$STATUS" | grep -q "Up"; then
  info "Container rodando: $STATUS"
else
  error "Container não está rodando! Status: $STATUS"
  exit 1
fi

DATA_AFTER=$($SSH "ls -1 $VPS_APP_DIR/data/*.json 2>/dev/null | wc -l")
info "Arquivos de dados após deploy: $DATA_AFTER"

if [ "$DATA_AFTER" -lt "$DATA_FILES" ]; then
  error "ALERTA: Menos arquivos de dados após deploy! ($DATA_FILES -> $DATA_AFTER)"
  error "Backup disponível em data-backup-*"
  exit 1
fi

$SSH "ls -dt $VPS_APP_DIR/data-backup-* 2>/dev/null | tail -n +4 | xargs rm -rf 2>/dev/null" || true
info "Deploy concluído com sucesso!"
