import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter, { setWsBroadcast } from './src/routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));
app.use('/api', apiRouter);

const connectedClients = new Set();

wss.on('connection', (ws) => {
  connectedClients.add(ws);

  ws.on('close', () => {
    connectedClients.delete(ws);
  });

  ws.on('error', () => {
    connectedClients.delete(ws);
  });
});

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of connectedClients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

setWsBroadcast(broadcast);

function gracefulShutdown(signal) {
  console.log(`\nSinal ${signal} recebido. Encerrando servidor...`);

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

httpServer.listen(PORT, () => {
  console.log(`Painel administrativo disponível em http://localhost:${PORT}`);
  console.log(`WebSocket server ativo na mesma porta.`);
});
