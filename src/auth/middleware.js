import jwt from 'jsonwebtoken';
import { usersStore } from '../store/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'agents-orchestrator-jwt-secret-mude-em-producao';
const JWT_EXPIRES = '7d';

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

export function authMiddleware(req, res, next) {
  if (usersStore.count() === 0) return next();

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação necessário' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = usersStore.getById(decoded.id);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Usuário não encontrado ou inativo' });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado. Faça login novamente.' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
}

export function verifyWsToken(token) {
  if (usersStore.count() === 0) return { id: 'system' };
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = usersStore.getById(decoded.id);
    return user && user.active ? user : null;
  } catch {
    return null;
  }
}

export { JWT_SECRET };
