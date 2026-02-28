import Stripe from 'stripe';
import { usersStore } from '../store/db.js';
import { getPlan, PLANS } from './plans.js';

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

let stripe = null;

function getStripe() {
  if (!stripe && STRIPE_SECRET) {
    stripe = new Stripe(STRIPE_SECRET);
  }
  return stripe;
}

export function isStripeConfigured() {
  return !!STRIPE_SECRET;
}

export async function createCheckoutSession(user, planId, successUrl, cancelUrl) {
  const s = getStripe();
  if (!s) throw new Error('Stripe não configurado. Configure STRIPE_SECRET_KEY.');

  const plan = getPlan(planId);
  if (!plan.stripePriceId) throw new Error(`Plano ${planId} não tem Price ID configurado no Stripe.`);

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await s.customers.create({
      email: user.email,
      name: user.name || user.email,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    usersStore.update(user.id, { stripeCustomerId: customerId });
  }

  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId: user.id, planId },
    subscription_data: {
      metadata: { userId: user.id, planId },
    },
  });

  return session;
}

export async function createPortalSession(user, returnUrl) {
  const s = getStripe();
  if (!s) throw new Error('Stripe não configurado');
  if (!user.stripeCustomerId) throw new Error('Usuário não tem conta no Stripe');

  return s.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl,
  });
}

export function constructWebhookEvent(payload, signature) {
  const s = getStripe();
  if (!s) throw new Error('Stripe não configurado');
  if (!STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET não configurado');
  return s.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
}

export async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const planId = session.metadata?.planId;
      if (userId && planId) {
        usersStore.update(userId, {
          plan: planId,
          stripeSubscriptionId: session.subscription,
          stripeSubscriptionStatus: 'active',
          planUpdatedAt: new Date().toISOString(),
        });
        console.log(`[stripe] Plano atualizado: userId=${userId} plan=${planId}`);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (!userId) break;
      const status = sub.status;
      if (status === 'active' || status === 'trialing') {
        const planId = sub.metadata?.planId;
        if (planId) {
          usersStore.update(userId, {
            plan: planId,
            stripeSubscriptionStatus: status,
            planUpdatedAt: new Date().toISOString(),
          });
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (userId) {
        usersStore.update(userId, {
          plan: 'free',
          stripeSubscriptionId: null,
          stripeSubscriptionStatus: 'canceled',
          planUpdatedAt: new Date().toISOString(),
        });
        console.log(`[stripe] Assinatura cancelada: userId=${userId}`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const users = usersStore.filter(u => u.stripeCustomerId === customerId);
      if (users.length > 0) {
        usersStore.update(users[0].id, { stripeSubscriptionStatus: 'past_due' });
        console.log(`[stripe] Pagamento falhou: userId=${users[0].id}`);
      }
      break;
    }
  }
}

export async function cancelSubscription(user) {
  const s = getStripe();
  if (!s) throw new Error('Stripe não configurado');
  if (!user.stripeSubscriptionId) throw new Error('Sem assinatura ativa');

  await s.subscriptions.cancel(user.stripeSubscriptionId);
  usersStore.update(user.id, {
    plan: 'free',
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: 'canceled',
    planUpdatedAt: new Date().toISOString(),
  });
}
