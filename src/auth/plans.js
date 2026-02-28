export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    limits: {
      agents: 2,
      pipelines: 1,
      executionsPerMonth: 50,
      users: 1,
      webhooks: 1,
    },
    features: [
      '2 agentes configuráveis',
      '1 pipeline',
      '50 execuções/mês',
      '1 usuário',
      '1 webhook',
      'Dashboard básico',
    ],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 19700,
    stripePriceId: process.env.STRIPE_PRICE_STARTER || '',
    limits: {
      agents: 3,
      pipelines: 5,
      executionsPerMonth: 500,
      users: 1,
      webhooks: 5,
    },
    features: [
      '3 agentes configuráveis',
      '5 pipelines',
      '500 execuções/mês',
      '1 usuário',
      '5 webhooks',
      'Suporte por email',
      'Dashboard e métricas',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 49700,
    stripePriceId: process.env.STRIPE_PRICE_PRO || '',
    limits: {
      agents: 15,
      pipelines: -1,
      executionsPerMonth: 5000,
      users: 5,
      webhooks: -1,
    },
    features: [
      '15 agentes configuráveis',
      'Pipelines ilimitados',
      '5.000 execuções/mês',
      '5 usuários',
      'Webhooks ilimitados',
      'Aprovação humana',
      'Relatórios avançados',
      'Suporte prioritário',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 129700,
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE || '',
    limits: {
      agents: -1,
      pipelines: -1,
      executionsPerMonth: -1,
      users: -1,
      webhooks: -1,
    },
    features: [
      'Agentes ilimitados',
      'Pipelines ilimitados',
      'Execuções ilimitadas',
      'Usuários ilimitados',
      'Suporte 24/7 prioritário',
      'SLA 99.9% garantido',
      'Deploy on-premise',
      'SSO / SAML',
    ],
  },
};

export function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

export function checkLimit(plan, resource, currentCount) {
  const limit = plan.limits[resource];
  if (limit === -1) return { allowed: true };
  if (currentCount >= limit) {
    return {
      allowed: false,
      limit,
      current: currentCount,
      message: `Limite do plano ${plan.name}: máximo de ${limit} ${resource}. Faça upgrade para aumentar.`,
    };
  }
  return { allowed: true, limit, current: currentCount };
}
