# Agents Orchestrator

Painel administrativo web para orquestração de agentes [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Crie, configure e execute múltiplos agentes com diferentes personalidades, modelos e diretórios de trabalho — tudo a partir de uma interface visual.

## Funcionalidades

- **Gerenciamento de agentes** — Crie agentes com nome, system prompt, modelo (Sonnet/Opus/Haiku), diretório de trabalho e tags. Ative, desative, edite ou exclua a qualquer momento.
- **Execução de tarefas** — Execute tarefas sob demanda em qualquer agente ativo. Templates rápidos incluídos (detecção de bugs, revisão OWASP, refatoração, testes, documentação, performance).
- **Terminal em tempo real** — Acompanhe a saída dos agentes via WebSocket com streaming chunk-a-chunk. Indicador de status de conexão e filtro por execução.
- **Agendamento cron** — Agende tarefas recorrentes com expressões cron. Presets incluídos (horário, diário, semanal, mensal).
- **Pipelines** — Encadeie múltiplos agentes em fluxos sequenciais. A saída de cada passo alimenta o próximo via template `{{input}}`. Ideal para fluxos como "analisar → corrigir → testar".
- **Dashboard** — Visão geral com métricas (agentes, execuções ativas, agendamentos), atividade recente e status do sistema.
- **Exportação** — Exporte a configuração completa de qualquer agente em JSON.

## Pré-requisitos

- **Node.js** 18+
- **Claude Code CLI** instalado e autenticado (`claude` disponível no PATH)

## Instalação

```bash
git clone <repo-url>
cd agents-orchestrator
npm install
```

## Uso

```bash
# Produção
npm start

# Desenvolvimento (hot reload)
npm run dev
```

Acesse **http://localhost:3000** no navegador. A porta pode ser alterada via variável de ambiente `PORT`.

## Como funciona

### Criando um agente

1. Clique em **Novo Agente** no header ou na seção Agentes
2. Configure nome, system prompt, modelo e diretório de trabalho
3. Salve — o agente aparecerá como card na listagem

### Executando uma tarefa

1. No card do agente, clique em **Executar**
2. Descreva a tarefa ou use um template rápido
3. Opcionalmente adicione instruções extras
4. A execução inicia e o terminal abre automaticamente com streaming da saída

### Criando um pipeline

1. Vá em **Pipelines** → **Novo Pipeline**
2. Adicione pelo menos 2 passos, selecionando um agente para cada
3. Opcionalmente defina um template de input usando `{{input}}` para referenciar a saída do passo anterior
4. Execute o pipeline fornecendo o input inicial

### Agendando uma tarefa

1. Vá em **Agendamentos** → **Novo Agendamento**
2. Selecione o agente, descreva a tarefa e defina a expressão cron
3. A tarefa será executada automaticamente nos horários configurados

## Arquitetura

```
server.js                     Express + WebSocket na mesma porta
src/
  routes/api.js               API REST (/api/*)
  agents/
    manager.js                CRUD + orquestração de agentes
    executor.js               Spawna o CLI claude como child_process
    scheduler.js              Agendamento cron (in-memory)
    pipeline.js               Execução sequencial de steps
  store/db.js                 Persistência em JSON (data/*.json)
public/
  index.html                  SPA single-page
  css/styles.css              Estilos (Inter, JetBrains Mono, Lucide)
  js/
    app.js                    Controlador principal + WebSocket client
    api.js                    Client HTTP para a API
    components/               UI por seção (dashboard, agents, tasks, etc.)
data/
  agents.json                 Agentes cadastrados
  tasks.json                  Templates de tarefas
  pipelines.json              Pipelines configurados
```

O executor invoca o binário `claude` com `--output-format stream-json`, parseia o stdout linha a linha e transmite os chunks via WebSocket para o frontend em tempo real.

## API REST

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/agents` | Listar agentes |
| `POST` | `/api/agents` | Criar agente |
| `GET` | `/api/agents/:id` | Obter agente |
| `PUT` | `/api/agents/:id` | Atualizar agente |
| `DELETE` | `/api/agents/:id` | Excluir agente |
| `POST` | `/api/agents/:id/execute` | Executar tarefa no agente |
| `POST` | `/api/agents/:id/cancel/:executionId` | Cancelar execução |
| `GET` | `/api/agents/:id/export` | Exportar agente (JSON) |
| `GET` | `/api/tasks` | Listar tarefas |
| `POST` | `/api/tasks` | Criar tarefa |
| `PUT` | `/api/tasks/:id` | Atualizar tarefa |
| `DELETE` | `/api/tasks/:id` | Excluir tarefa |
| `GET` | `/api/schedules` | Listar agendamentos |
| `POST` | `/api/schedules` | Criar agendamento |
| `DELETE` | `/api/schedules/:taskId` | Remover agendamento |
| `GET` | `/api/pipelines` | Listar pipelines |
| `POST` | `/api/pipelines` | Criar pipeline |
| `GET` | `/api/pipelines/:id` | Obter pipeline |
| `PUT` | `/api/pipelines/:id` | Atualizar pipeline |
| `DELETE` | `/api/pipelines/:id` | Excluir pipeline |
| `POST` | `/api/pipelines/:id/execute` | Executar pipeline |
| `POST` | `/api/pipelines/:id/cancel` | Cancelar pipeline |
| `GET` | `/api/system/status` | Status geral do sistema |
| `GET` | `/api/executions/active` | Execuções em andamento |

## Eventos WebSocket

O servidor envia eventos tipados via WebSocket que o frontend renderiza no terminal:

| Evento | Descrição |
|--------|-----------|
| `execution_output` | Chunk de texto da saída do agente |
| `execution_complete` | Execução finalizada com resultado |
| `execution_error` | Erro durante execução |
| `pipeline_step_start` | Início de um passo do pipeline |
| `pipeline_step_complete` | Passo do pipeline concluído |
| `pipeline_complete` | Pipeline finalizado |
| `pipeline_error` | Erro em um passo do pipeline |

## Stack

- **Backend**: Node.js, Express, WebSocket (ws), node-cron, uuid
- **Frontend**: HTML, CSS, JavaScript vanilla (sem framework, sem bundler)
- **Ícones**: Lucide
- **Fontes**: Inter (UI), JetBrains Mono (código/terminal)
- **Persistência**: Arquivos JSON em disco

## Licença

MIT
