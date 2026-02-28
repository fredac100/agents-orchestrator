import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { usersStore, agentsStore, pipelinesStore, webhooksStore } from '../store/db.js';
import { generateToken, authMiddleware } from '../auth/middleware.js';
import { getPlan, PLANS } from '../auth/plans.js';
import {
  createCheckoutSession,
  createPortalSession,
  isStripeConfigured,
  constructWebhookEvent,
  handleWebhookEvent,
  cancelSubscription,
} from '../auth/stripe.js';

const router = Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    const existing = usersStore.filter(u => u.email === email.toLowerCase());
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    const allUsers = usersStore.getAll();
    const owner = allUsers.find(u => u.role === 'owner');
    if (owner) {
      const ownerPlan = getPlan(owner.plan);
      const maxUsers = ownerPlan.limits.users;
      if (maxUsers !== -1 && allUsers.length >= maxUsers) {
        return res.status(403).json({
          error: `Limite de ${maxUsers} usuário(s) no plano ${ownerPlan.name}. O administrador precisa fazer upgrade.`,
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const isFirstUser = allUsers.length === 0;

    const user = usersStore.create({
      name: name || email.split('@')[0],
      email: email.toLowerCase(),
      passwordHash,
      role: isFirstUser ? 'owner' : 'member',
      plan: 'free',
      active: true,
      monthlyExecutions: 0,
      monthlyExecReset: new Date().toISOString(),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
    });

    const token = generateToken(user);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const users = usersStore.filter(u => u.email === email.toLowerCase());
    if (users.length === 0) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const user = users[0];
    if (!user.active) {
      return res.status(403).json({ error: 'Conta desativada' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    usersStore.update(user.id, { lastLoginAt: new Date().toISOString() });
    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = req.user;
  const owner = usersStore.filter(u => u.role === 'owner')[0];
  const activePlan = getPlan((owner || user).plan);

  const now = new Date();
  const resetDate = new Date(user.monthlyExecReset || now);
  let monthlyExecutions = user.monthlyExecutions || 0;
  if (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
    monthlyExecutions = 0;
    usersStore.update(user.id, { monthlyExecutions: 0, monthlyExecReset: now.toISOString() });
  }

  const usage = {
    agents: { current: agentsStore.count(), limit: activePlan.limits.agents },
    pipelines: { current: pipelinesStore.count(), limit: activePlan.limits.pipelines },
    webhooks: { current: webhooksStore.count(), limit: activePlan.limits.webhooks },
    executionsPerMonth: { current: monthlyExecutions, limit: activePlan.limits.executionsPerMonth },
    users: { current: usersStore.count(), limit: activePlan.limits.users },
  };

  const getUsageCounts = req.app.get('getUsageCounts');
  if (getUsageCounts) {
    try {
      const counts = await getUsageCounts(user.id);
      usage.agents.current = counts.agents || 0;
      usage.pipelines.current = counts.pipelines || 0;
      usage.webhooks.current = counts.webhooks || 0;
      usage.executionsPerMonth.current = counts.executionsPerMonth || 0;
    } catch {}
  }

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: (owner || user).plan,
    },
    plan: {
      id: activePlan.id,
      name: activePlan.name,
      price: activePlan.price,
      features: activePlan.features,
      limits: activePlan.limits,
    },
    usage,
    stripeConfigured: isStripeConfigured(),
  });
});

router.get('/plans', (req, res) => {
  const plans = Object.values(PLANS).map(p => ({
    id: p.id,
    name: p.name,
    price: p.price,
    limits: p.limits,
    features: p.features,
  }));
  res.json(plans);
});

router.post('/upgrade', authMiddleware, async (req, res) => {
  try {
    const { planId } = req.body;
    const user = req.user;

    if (user.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas o administrador pode alterar o plano' });
    }

    if (!PLANS[planId]) {
      return res.status(400).json({ error: 'Plano inválido' });
    }

    if (planId === 'free') {
      if (user.stripeSubscriptionId) {
        await cancelSubscription(user);
      } else {
        usersStore.update(user.id, { plan: 'free', planUpdatedAt: new Date().toISOString() });
      }
      return res.json({ message: 'Plano alterado para Free' });
    }

    if (!isStripeConfigured()) {
      return res.status(500).json({
        error: 'Stripe não configurado. Configure as variáveis STRIPE_SECRET_KEY e STRIPE_PRICE_* no servidor.',
      });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const session = await createCheckoutSession(
      user,
      planId,
      `${baseUrl}/app.html#billing-success`,
      `${baseUrl}/app.html#billing-cancel`
    );

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/billing-portal', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'owner') {
      return res.status(403).json({ error: 'Apenas o administrador pode gerenciar a assinatura' });
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const session = await createPortalSession(user, `${baseUrl}/app.html#settings`);
    res.json({ portalUrl: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, currentPassword, newPassword } = req.body;
    const user = req.user;
    const updateData = {};

    if (name !== undefined) updateData.name = name;

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Senha atual é obrigatória para alterar a senha' });
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Senha atual incorreta' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Nova senha deve ter no mínimo 6 caracteres' });
      }
      updateData.passwordHash = await bcrypt.hash(newPassword, 12);
    }

    if (Object.keys(updateData).length > 0) {
      usersStore.update(user.id, updateData);
    }

    res.json({ message: 'Perfil atualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stripe-webhook', async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).json({ error: 'Stripe signature ausente' });

    const event = constructWebhookEvent(req.rawBody, sig);
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe-webhook] Erro:', err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
