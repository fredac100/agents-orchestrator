<p align="center">
  <img src="docs/logo.svg" alt="Agents Orchestrator" width="80" />
</p>

<h1 align="center">Agents Orchestrator</h1>

<p align="center">
  <strong>Plataforma de orquestração de agentes IA com interface visual, pipelines automatizados e integração Git nativa.</strong>
</p>

<p align="center">
  <a href="https://agents.nitro-cloud.duckdns.org"><img src="https://img.shields.io/badge/demo-live-00d4aa?style=flat-square" alt="Live Demo" /></a>
  <a href="https://git.nitro-cloud.duckdns.org/fred/agents-orchestrator"><img src="https://img.shields.io/badge/gitea-repo-6c40cc?style=flat-square" alt="Gitea" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
</p>

<p align="center">
  <a href="#visao-geral">Visao Geral</a> &bull;
  <a href="#funcionalidades">Funcionalidades</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#arquitetura">Arquitetura</a> &bull;
  <a href="#api">API</a> &bull;
  <a href="#deploy">Deploy</a>
</p>

---

## Visao Geral

Agents Orchestrator e uma plataforma web para criar, configurar e executar agentes [Claude Code](https://docs.anthropic.com/en/docs/claude-code) de forma visual. Projetada para equipes de desenvolvimento e profissionais que precisam orquestrar multiplos agentes IA com diferentes especialidades, executar pipelines de trabalho automatizados e integrar com repositorios Git — tudo a partir de um painel administrativo elegante.

### Por que usar?

| Problema | Solucao |
|----------|---------|
| Gerenciar multiplos agentes via CLI e tedioso | Interface visual com cards, filtros e execucao com 1 clique |
| Saida do agente nao e visivel em tempo real | Terminal com streaming WebSocket chunk-a-chunk |
| Automatizar fluxos sequenciais e complexo | Pipelines visuais com aprovacao humana entre passos |
| Agentes nao tem acesso a repositorios remotos | Integracao Git nativa com clone, commit e push automatico |
| Deploy manual e propenso a erros | `git deploy` — um comando faz tudo |

---

## Funcionalidades

### Agentes

- Criacao com system prompt, modelo (Sonnet/Opus/Haiku), diretorio de trabalho, ferramentas permitidas e modo de permissao
- Tags para organizacao e filtragem
- Duplicacao, importacao/exportacao JSON
- Delegacao automatica entre agentes (Tech Lead → PO)
- Agentes coordenadores recebem lista de agentes disponiveis injetada no prompt

### Execucao

- Modal de execucao com seletor de agente, tarefa, instrucoes adicionais e arquivos de contexto
- **Seletor de repositorio Git** — escolha um repo do Gitea e o branch; o sistema clona/atualiza, executa e faz commit/push automatico
- Templates rapidos: deteccao de bugs, revisao OWASP, refatoracao, testes, documentacao, performance
- Retry automatico configuravel por agente
- Continuacao de conversa (resume session)
- Cancelamento individual ou em massa

### Pipelines

- Encadeamento de multiplos agentes em fluxos sequenciais
- Saida de cada passo alimenta o proximo via `{{input}}`
- **Seletor de repositorio** — todos os passos trabalham no mesmo repo com commit automatico ao final
- Portoes de aprovacao humana (human-in-the-loop)
- Retomada de pipelines falhos a partir do passo onde pararam
- Editor de fluxo visual com drag para reordenar passos

### Terminal

- Streaming em tempo real via WebSocket
- Botao Interromper para cancelar execucoes ativas
- Busca no output com navegacao entre ocorrencias
- Download como `.txt` e copia para clipboard
- Auto-scroll toggleavel

### Integração Git

- Listagem automatica de repositorios do Gitea
- Seletor de branch dinamico
- Clone/pull automatico antes da execucao
- **Commit e push automatico** ao final com mensagem descritiva
- Instrucao injetada para agentes nao fazerem operacoes git
- Publicacao de projetos: cria repo, configura subdominio, deploy com 1 clique

### Explorador de Arquivos

- Navegacao em `/home/projetos/` com breadcrumb
- Download de arquivos individuais ou pastas completas (.tar.gz)
- Exclusao com confirmacao
- Botao publicar em projetos — cria repo no Gitea, configura Caddy e faz deploy automatico em `projeto.nitro-cloud.duckdns.org`

### Dashboard

- Metricas em tempo real: agentes, execucoes, agendamentos, custo, webhooks
- Graficos: execucoes por dia, custo diario, distribuicao de status, top 5 agentes, taxa de sucesso
- Seletor de periodo: 7, 14 ou 30 dias

### Catalogo de Tarefas

- Tarefas reutilizaveis com nome, categoria e descricao
- Categorias: Code Review, Seguranca, Refatoracao, Testes, Documentacao, Performance
- Filtro por texto e categoria
- Execucao direta a partir do catalogo

### Agendamento Cron

- Expressoes cron com presets (horario, diario, semanal, mensal)
- Historico de execucoes por agendamento
- Retry automatico em caso de limite de slots

### Webhooks

- Disparo de execucoes via HTTP externo
- Edicao, teste com 1 clique e snippet cURL
- Assinatura HMAC-SHA256

### Notificacoes

- Centro de notificacoes com badge de contagem
- Notificacoes nativas do navegador
- Polling automatico a cada 15 segundos

### Tema e UX

- Tema claro/escuro com transicao suave
- Atalhos de teclado (`1`-`9` navegacao, `N` novo agente, `Esc` fechar modal)
- Exportacao de historico como CSV

---

## Quick Start

### Requisitos

- Node.js >= 22
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) instalado e autenticado

### Execucao local

```bash
git clone https://github.com/fredac100/agents-orchestrator.git
cd agents-orchestrator
npm install
npm start
```

Acesse `http://localhost:3000`.

### Com Docker

```bash
docker build -t agents-orchestrator .
docker run -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v ~/.claude:/home/node/.claude \
  agents-orchestrator
```

---

## Arquitetura

```
                    HTTPS (443)
                        |
                     [Caddy]  ─── SSL automatico via DuckDNS
                        |
              *.nitro-cloud.duckdns.org
                        |
         ┌──────────────┼──────────────┐
         |              |              |
    [agents.*]    [git.*]    [projeto.*]
         |              |              |
  ┌──────┴──────┐   [Gitea]    [Caddy file_server]
  |             |
[Express]  [WebSocket]
  |             |
  ├── API REST (40+ endpoints)
  ├── Manager (CRUD + orquestracao)
  ├── Executor (spawn claude CLI)
  ├── Pipeline (sequencial + aprovacao)
  ├── Scheduler (cron jobs)
  ├── Git Integration (clone/pull/commit/push)
  └── Store (JSON com escrita atomica)
```

### Estrutura do Projeto

```
server.js                        HTTP + WebSocket + rate limiting + auth
src/
  routes/api.js                  API REST — 40+ endpoints
  agents/
    manager.js                   CRUD + orquestracao + delegacao
    executor.js                  Spawna o CLI claude como child_process
    scheduler.js                 Agendamento cron
    pipeline.js                  Execucao sequencial + aprovacao humana
    git-integration.js           Clone, pull, commit, push automatico
  store/db.js                    Persistencia JSON com escrita atomica
  cache/index.js                 Cache L1 (memoria) + L2 (Redis opcional)
  reports/generator.js           Geracao de relatorios de execucao
public/
  app.html                       SPA com hash routing
  css/styles.css                 Design system (dark/light)
  js/
    app.js                       Controlador principal + WebSocket
    api.js                       Client HTTP para a API
    components/                  16 modulos UI independentes
scripts/
  deploy.sh                      Deploy automatizado via rsync + Docker
data/                            Persistencia em JSON (8 stores)
```

---

## API

### Agentes

| Metodo | Endpoint | Descricao |
|--------|----------|-----------|
| `GET` | `/api/agents` | Listar agentes |
| `POST` | `/api/agents` | Criar agente |
| `GET` | `/api/agents/:id` | Obter agente |
| `PUT` | `/api/agents/:id` | Atualizar agente |
| `DELETE` | `/api/agents/:id` | Excluir agente |
| `POST` | `/api/agents/:id/execute` | Executar tarefa (aceita `repoName` e `repoBranch`) |
| `POST` | `/api/agents/:id/continue` | Continuar conversa |
| `POST` | `/api/agents/:id/cancel/:execId` | Cancelar execucao |
| `GET` | `/api/agents/:id/export` | Exportar agente |
| `POST` | `/api/agents/:id/duplicate` | Duplicar agente |

### Pipelines

| Metodo | Endpoint | Descricao |
|--------|----------|-----------|
| `GET` | `/api/pipelines` | Listar pipelines |
| `POST` | `/api/pipelines` | Criar pipeline |
| `POST` | `/api/pipelines/:id/execute` | Executar (aceita `repoName` e `repoBranch`) |
| `POST` | `/api/pipelines/:id/approve` | Aprovar passo pendente |
| `POST` | `/api/pipelines/:id/reject` | Rejeitar passo |
| `POST` | `/api/pipelines/resume/:execId` | Retomar pipeline falho |

### Repositorios

| Metodo | Endpoint | Descricao |
|--------|----------|-----------|
| `GET` | `/api/repos` | Listar repositorios do Gitea |
| `GET` | `/api/repos/:name/branches` | Listar branches de um repo |

### Arquivos e Publicacao

| Metodo | Endpoint | Descricao |
|--------|----------|-----------|
| `GET` | `/api/files` | Listar diretorio |
| `GET` | `/api/files/download` | Download de arquivo |
| `GET` | `/api/files/download-folder` | Download de pasta (.tar.gz) |
| `DELETE` | `/api/files` | Excluir arquivo ou pasta |
| `POST` | `/api/files/publish` | Publicar projeto (repo + deploy + subdominio) |

### Sistema

| Metodo | Endpoint | Descricao |
|--------|----------|-----------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/system/status` | Status geral |
| `GET` | `/api/stats/costs` | Estatisticas de custo |
| `GET` | `/api/stats/charts` | Dados para graficos |

---

## Deploy

### Deploy automatico

```bash
git deploy
```

O alias executa `scripts/deploy.sh` que automaticamente:

1. Push para GitHub e Gitea
2. Backup dos dados no VPS
3. Sincronizacao via rsync
4. Correcao de permissoes
5. Rebuild do container Docker
6. Verificacao de integridade
7. Limpeza de backups antigos (mantem 3)

```bash
# Apenas deploy sem push
bash scripts/deploy.sh --skip-push
```

### Variaveis de Ambiente

| Variavel | Descricao | Padrao |
|----------|-----------|--------|
| `PORT` | Porta do servidor | `3000` |
| `HOST` | Endereco de bind | `0.0.0.0` |
| `AUTH_TOKEN` | Bearer token para auth da API | _(desabilitado)_ |
| `ALLOWED_ORIGIN` | Origin para CORS | `http://localhost:3000` |
| `WEBHOOK_SECRET` | Segredo HMAC para webhooks | _(desabilitado)_ |
| `GITEA_URL` | URL interna do Gitea | `http://gitea:3000` |
| `GITEA_USER` | Usuario do Gitea | `fred` |
| `GITEA_PASS` | Senha do Gitea | _(obrigatorio para Git)_ |
| `DOMAIN` | Dominio base para subdominios | `nitro-cloud.duckdns.org` |
| `CLAUDE_BIN` | Caminho do CLI Claude | _(auto-detectado)_ |
| `REDIS_URL` | Redis para cache L2 | _(somente memoria)_ |

---

## Seguranca

- HTTPS via Caddy com certificado wildcard Let's Encrypt
- Autenticacao Bearer token com timing-safe comparison
- Rate limiting: 100 req/min (API), 30 req/min (webhooks)
- CORS restrito a origin configurada
- Correlation IDs em todas as requisicoes
- Escrita atomica em disco (temp + rename)
- Sanitizacao de prompts (NUL, controle, limite 50K chars)
- HMAC-SHA256 para webhooks recebidos
- Protecao contra path traversal no file explorer

---

## Eventos WebSocket

| Evento | Descricao |
|--------|-----------|
| `execution_output` | Chunk de saida do agente |
| `execution_complete` | Execucao finalizada |
| `execution_error` | Erro durante execucao |
| `execution_retry` | Tentativa de retry |
| `pipeline_step_start` | Inicio de passo |
| `pipeline_step_complete` | Passo concluido |
| `pipeline_complete` | Pipeline finalizado |
| `pipeline_error` | Erro no pipeline |
| `pipeline_approval_required` | Aguardando aprovacao humana |
| `report_generated` | Relatorio gerado |

---

## Stack

| Camada | Tecnologias |
|--------|-------------|
| **Backend** | Node.js 22, Express, WebSocket (ws), node-cron, uuid |
| **Frontend** | HTML, CSS, JavaScript vanilla — sem framework, sem bundler |
| **Graficos** | Chart.js 4.x |
| **Icones** | Lucide |
| **Fontes** | Inter (UI), JetBrains Mono (terminal) |
| **Persistencia** | JSON em disco com escrita atomica |
| **Cache** | In-memory + Redis opcional (ioredis) |
| **Infra** | Docker, Caddy, DuckDNS, Let's Encrypt |
| **Git** | Gitea (self-hosted) |

---

## Licenca

MIT

---

<p align="center">
  <sub>Desenvolvido por <a href="https://nitro-cloud.duckdns.org">Nitro Cloud</a></sub>
</p>
