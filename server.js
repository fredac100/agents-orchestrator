import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import apiRouter, { setWsBroadcast, setWsBroadcastTo } from './src/routes/api.js';
import * as manager from './src/agents/manager.js';
import { cancelAllExecutions } from './src/agents/executor.js';
import { flushAllStores } from './src/store/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use((req, res, next) => {
  const origin = ALLOWED_ORIGIN || req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

if (AUTH_TOKEN) {
  app.use('/api', (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    if (token !== AUTH_TOKEN) {
      return res.status(401).json({ error: 'Token de autenticação inválido' });
    }
    next();
  });
}

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));
app.use('/api', apiRouter);

const connectedClients = new Map();

wss.on('connection', (ws, req) => {
  const clientId = new URL(req.url, 'http://localhost').searchParams.get('clientId') || uuidv4();

  if (AUTH_TOKEN) {
    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    if (token !== AUTH_TOKEN) {
      ws.close(4001, 'Token inválido');
      return;
    }
  }

  ws.clientId = clientId;
  connectedClients.set(clientId, ws);

  ws.on('close', () => connectedClients.delete(clientId));
  ws.on('error', () => connectedClients.delete(clientId));
  ws.send(JSON.stringify({ type: 'connected', clientId }));
});

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const [, client] of connectedClients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function broadcastTo(clientId, message) {
  const payload = JSON.stringify(message);
  const client = connectedClients.get(clientId);
  if (client && client.readyState === 1) client.send(payload);
  else broadcast(message);
}

setWsBroadcast(broadcast);
setWsBroadcastTo(broadcastTo);

function gracefulShutdown(signal) {
  console.log(`\nSinal ${signal} recebido. Encerrando servidor...`);

  cancelAllExecutions();
  console.log('Execuções ativas canceladas.');

  flushAllStores();
  console.log('Dados persistidos.');

  httpServer.close(() => {
    console.log('Servidor HTTP encerrado.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forçando encerramento após timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

manager.restoreSchedules(broadcast);

httpServer.listen(PORT, () => {
  console.log(`Painel administrativo disponível em http://localhost:${PORT}`);
  console.log(`WebSocket server ativo na mesma porta.`);
  if (AUTH_TOKEN) console.log('Autenticação por token ativada.');
});
