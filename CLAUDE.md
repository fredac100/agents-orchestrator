# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sobre o Projeto

Painel administrativo web para orquestração de agentes Claude Code. Permite criar, configurar e executar agentes que invocam o CLI `claude` como subprocesso, com suporte a agendamento via cron e pipelines sequenciais (saída de um agente alimenta o próximo).

## Comandos

```bash
npm start          # Inicia o servidor (porta 3000)
npm run dev        # Inicia com --watch (hot reload automático)
```

Não há testes, linting ou build configurados.

## Arquitetura

### Backend (Node.js + Express, ESM)

```
server.js                    → HTTP + WebSocket (ws) na mesma porta
src/routes/api.js            → Todas as rotas REST sob /api
src/agents/manager.js        → CRUD de agentes + orquestra execuções e agendamentos
src/agents/executor.js       → Spawna o CLI claude como child_process com stream-json
src/agents/scheduler.js      → Agendamento cron via node-cron (in-memory)
src/agents/pipeline.js       → Execução sequencial de steps, cada um delegando ao executor
src/store/db.js              → Persistência em arquivos JSON (data/*.json)
```

**Fluxo de execução:** API recebe POST → `manager.executeTask()` → `executor.execute()` spawna `/home/fred/.local/bin/claude` com `--output-format stream-json` → stdout é parseado linha a linha → chunks são enviados via WebSocket broadcast para o frontend.

**Pipelines:** Executam steps em sequência. Cada step usa um agente diferente. A saída de um step é passada como input do próximo via template `{{input}}`.

**Persistência:** `db.js` expõe stores (agents, tasks, pipelines) que leem/escrevem JSON em `data/`. Cada operação recarrega o arquivo inteiro. Agendamentos cron são apenas in-memory.

### Frontend (Vanilla JS, SPA)

```
public/index.html                → SPA single-page com todas as seções
public/css/styles.css            → Estilos (Inter + JetBrains Mono, Lucide icons)
public/js/app.js                 → Controlador principal, navegação, WebSocket client
public/js/api.js                 → Client HTTP para /api/*
public/js/components/*.js        → UI por seção (dashboard, agents, tasks, schedules, pipelines, terminal, modal, toast)
```

O frontend usa objetos globais no `window` (App, API, DashboardUI, AgentsUI, etc.) sem bundler ou framework. WebSocket reconecta automaticamente com backoff exponencial.

### Endpoints REST

| Recurso | Rotas |
|---------|-------|
| Agentes | GET/POST `/api/agents`, GET/PUT/DELETE `/api/agents/:id`, POST `.../execute`, POST `.../cancel/:executionId`, GET `.../export` |
| Tarefas | GET/POST `/api/tasks`, PUT/DELETE `/api/tasks/:id` |
| Agendamentos | GET/POST `/api/schedules`, DELETE `/api/schedules/:taskId` |
| Pipelines | GET/POST `/api/pipelines`, GET/PUT/DELETE `/api/pipelines/:id`, POST `.../execute`, POST `.../cancel` |
| Sistema | GET `/api/system/status`, GET `/api/executions/active` |

### WebSocket Events

O servidor envia eventos tipados (`execution_output`, `execution_complete`, `execution_error`, `pipeline_step_start`, `pipeline_step_complete`, `pipeline_complete`, `pipeline_error`) que o frontend renderiza no terminal.

## Convenções

- Todo o código e mensagens em português brasileiro
- ESM (`"type": "module"` no package.json) — usar `import`/`export`, não `require`
- Sem TypeScript, sem bundler, sem framework frontend
- IDs gerados com `uuid` v4
- Modelo padrão dos agentes: `claude-sonnet-4-6`
