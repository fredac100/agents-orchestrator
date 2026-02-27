import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import apiRouter, { setWsBroadcast, setWsBroadcastTo, hookRouter } from './src/routes/api.js';
import * as manager from './src/agents/manager.js';
import { setGlobalBroadcast } from './src/agents/manager.js';
import { cancelAllExecutions } from './src/agents/executor.js';
import { flushAllStores } from './src/store/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';


function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de requisições excedido. Tente novamente em breve.' },
});

const hookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de requisições de webhook excedido.' },
});

function verifyWebhookSignature(req, res, next) {
  if (!WEBHOOK_SECRET) return next();
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return res.status(401).json({ error: 'Assinatura ausente' });
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(req.rawBody || '');
  const expected = 'sha256=' + hmac.digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Assinatura inválida' });
    }
  } catch {
    return res.status(401).json({ error: 'Assinatura inválida' });
  }
  next();
}

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Id, X-Correlation-ID');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(compression());

app.use('/api', apiLimiter);

app.use('/api', (req, res, next) => {
  if (!AUTH_TOKEN) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!timingSafeCompare(token, AUTH_TOKEN)) {
    return res.status(401).json({ error: 'Token de autenticação inválido' });
  }
  next();
});

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf || Buffer.alloc(0); },
}));
app.use('/hook', hookLimiter, verifyWebhookSignature, hookRouter);
app.use(express.static(join(__dirname, 'public'), { maxAge: '1h', etag: true }));
app.use('/api', apiRouter);

const connectedClients = new Map();

wss.on('connection', (ws, req) => {
  const clientId = new URL(req.url, 'http://localhost').searchParams.get('clientId') || uuidv4();

  if (AUTH_TOKEN) {
    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    if (!timingSafeCompare(token, AUTH_TOKEN)) {
      ws.close(4001, 'Token inválido');
      return;
    }
  }

  ws.clientId = clientId;
  ws.isAlive = true;
  connectedClients.set(clientId, ws);

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => connectedClients.delete(clientId));
  ws.on('error', () => connectedClients.delete(clientId));
  ws.send(JSON.stringify({ type: 'connected', clientId }));
});

const wsHeartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

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
setGlobalBroadcast(broadcast);

function gracefulShutdown(signal) {
  console.log(`\nSinal ${signal} recebido. Encerrando servidor...`);

  cancelAllExecutions();
  console.log('Execuções ativas canceladas.');

  flushAllStores();
  console.log('Dados persistidos.');

  clearInterval(wsHeartbeat);

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

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Exceção não capturada:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[WARN] Promise rejeitada não tratada:', reason);
});

manager.restoreSchedules();

httpServer.listen(PORT, HOST, () => {
  console.log(`Painel administrativo disponível em http://${HOST}:${PORT}`);
  console.log(`WebSocket server ativo na mesma porta.`);
});
