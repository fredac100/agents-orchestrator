import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import httpProxy from 'http-proxy';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import authRouter from './src/routes/auth.js';
import { authMiddleware, verifyWsToken } from './src/auth/middleware.js';
import { ContainerManager } from './src/gateway/container-manager.js';
import { initOracleUsers } from './src/store/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const containerManager = new ContainerManager({
  image: process.env.CONTAINER_IMAGE || 'vps-agents-orchestrator',
  network: process.env.DOCKER_NETWORK || 'vps_vps-net',
  idleTimeoutMin: parseInt(process.env.IDLE_TIMEOUT_MIN || '60', 10),
  sharedBinds: (process.env.CONTAINER_BINDS || '').split(',').filter(Boolean),
  workerEnv: (process.env.WORKER_ENV || '').split(',').filter(Boolean),
  projectsDir: process.env.PROJECTS_DIR || '',
});

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);

const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true });

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

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'gateway',
    containers: containerManager.activeCount(),
    uptime: Math.floor(process.uptime()),
  });
});

app.get('/api/gateway/workers', async (req, res) => {
  try {
    const workers = await containerManager.listWorkers();
    res.json(workers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.set('getUsageCounts', async (userId) => {
  try {
    const host = await containerManager.ensure(userId);
    const res = await fetch(`http://${host}:3000/api/internal/stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return res.json();
  } catch {}
  return { agents: 0, pipelines: 0, webhooks: 0, executionsPerMonth: 0 };
});

app.use('/api/auth', express.json({
  verify: (req, res, buf) => { req.rawBody = buf || Buffer.alloc(0); },
}), authRouter);

app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'app.html')));

app.use(express.static(join(__dirname, 'public'), {
  etag: true,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

async function proxyToUser(userId, user, req, res) {
  const host = await containerManager.ensure(userId);
  req.url = '/api' + req.url;
  proxy.web(req, res, {
    target: `http://${host}:3000`,
    headers: {
      'X-User-Id': user.id,
      'X-User-Email': user.email || '',
      'X-User-Name': user.name || '',
      'X-User-Role': user.role || 'member',
      'X-User-Plan': user.plan || 'free',
    },
  });
}

app.use('/api', authMiddleware, async (req, res) => {
  if (!req.user || !req.user.id || req.user.id === 'system') {
    return res.status(401).json({ error: 'Autenticação necessária. Faça login.' });
  }
  try {
    await proxyToUser(req.user.id, req.user, req, res);
  } catch (err) {
    console.error(`[gateway] Proxy error:`, err.message);
    if (!res.headersSent) {
      res.status(503).json({ error: 'Container do usuário indisponível. Tente novamente.' });
    }
  }
});

app.use('/hook', express.json({
  verify: (req, res, buf) => { req.rawBody = buf || Buffer.alloc(0); },
}), async (req, res) => {
  const webhookPath = req.path;
  const match = webhookPath.match(/^\/([^/]+)/);
  if (!match) return res.status(404).json({ error: 'Webhook não encontrado' });

  const webhookId = match[1];
  try {
    const workers = await containerManager.listWorkers();
    for (const w of workers) {
      if (w.state !== 'running') continue;
      try {
        const check = await fetch(`http://${w.name}:3000/api/webhooks/${webhookId}`, {
          signal: AbortSignal.timeout(2000),
        });
        if (check.ok) {
          req.url = '/hook' + req.url;
          proxy.web(req, res, { target: `http://${w.name}:3000` });
          return;
        }
      } catch {}
    }
    res.status(404).json({ error: 'Webhook não encontrado' });
  } catch (err) {
    res.status(503).json({ error: 'Serviço indisponível' });
  }
});

httpServer.on('upgrade', async (req, socket, head) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const token = params.get('token');
  const user = verifyWsToken(token);

  if (!user || !user.id || user.id === 'system') {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const host = await containerManager.ensure(user.id);
    proxy.ws(req, socket, head, {
      target: `http://${host}:3000`,
      headers: {
        'X-User-Id': user.id,
        'X-User-Email': user.email || '',
      },
    });
  } catch (err) {
    console.error(`[gateway] WS proxy error:`, err.message);
    socket.destroy();
  }
});

proxy.on('error', (err, req, res) => {
  console.error('[gateway] Proxy error:', err.message);
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Serviço temporariamente indisponível' }));
  }
});

async function gracefulShutdown(signal) {
  console.log(`\n[gateway] Sinal ${signal} recebido. Encerrando...`);
  containerManager.stopAll().catch(() => {});
  httpServer.close(() => {
    console.log('[gateway] Servidor encerrado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[gateway] Exceção não capturada:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[gateway] Promise rejeitada:', reason);
});

containerManager.startIdleCleanup();

const ORACLE_CONNECT = process.env.ORACLE_CONNECT_STRING || '';

async function start() {
  if (ORACLE_CONNECT) {
    try {
      await initOracleUsers({
        user: process.env.ORACLE_USER || 'local123',
        password: process.env.ORACLE_PASSWORD || 'local123',
        connectString: ORACLE_CONNECT,
      });
      console.log('[gateway] Autenticação persistida no Oracle');
    } catch (err) {
      console.error('[gateway] Falha ao conectar Oracle, usando JSON fallback:', err.message);
    }
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`[gateway] Gateway rodando em http://${HOST}:${PORT}`);
    console.log(`[gateway] Imagem: ${containerManager.image} | Rede: ${containerManager.network}`);
    console.log(`[gateway] Idle timeout: ${containerManager.idleTimeoutMin} min`);
  });
}

start();
