import fs from 'node:fs';
import path from 'node:path';
import { Environment, EventName, Paddle } from '@paddle/paddle-node-sdk';

import { callOperatorJson } from './operator-client.mjs';
import { PUBLIC_ORIGIN } from './config.mjs';

const DEFAULT_STATE_FILE = '/var/lib/light-remote-direct/plugin-state/paddle-billing.json';
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const PLAN_RANK = Object.freeze({ free: 0, pro: 1, vip: 2 });
const PRO_PLAN = 'pro';

function text(value) {
  return String(value ?? '').trim();
}

function safeEventId(event) {
  return text(event?.eventId || event?.event_id || event?.notificationId || event?.notification_id);
}

function safeEventType(event) {
  return text(event?.eventType || event?.event_type);
}

function safeData(event) {
  return event?.data && typeof event.data === 'object' ? event.data : {};
}

function safeCustomData(data) {
  const value = data?.customData ?? data?.custom_data;
  return value && typeof value === 'object' ? value : {};
}

function accountIdFrom(data) {
  const custom = safeCustomData(data);
  return text(custom.light_remote_account_id || custom.lightRemoteAccountId);
}

function planFrom(data) {
  const custom = safeCustomData(data);
  return text(custom.light_remote_plan || custom.lightRemotePlan || PRO_PLAN).toLowerCase();
}

function sourceRefFrom(data) {
  return text(data?.id || data?.subscriptionId || data?.subscription_id);
}

function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  const events = state.events && typeof state.events === 'object' ? state.events : {};
  const subscriptions = state.subscriptions && typeof state.subscriptions === 'object' ? state.subscriptions : {};
  return { schemaVersion: 1, events, subscriptions };
}

function loadState(file) {
  try {
    if (!file || !fs.existsSync(file)) return normalizeState(null);
    return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return normalizeState(null);
  }
}

function saveState(file, state) {
  if (!file) return;
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const normalized = normalizeState(state);
  const eventEntries = Object.entries(normalized.events)
    .sort((a, b) => Number(b[1]?.processedAt || 0) - Number(a[1]?.processedAt || 0))
    .slice(0, 1000);
  normalized.events = Object.fromEntries(eventEntries);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

function defaultConfig(env = process.env) {
  const environment = text(env.LIGHT_REMOTE_PADDLE_ENV || 'sandbox').toLowerCase();
  return {
    environment,
    apiKey: text(env.LIGHT_REMOTE_PADDLE_API_KEY),
    clientToken: text(env.LIGHT_REMOTE_PADDLE_CLIENT_TOKEN),
    proPriceId: text(env.LIGHT_REMOTE_PADDLE_PRO_PRICE_ID),
    webhookSecret: text(env.LIGHT_REMOTE_PADDLE_WEBHOOK_SECRET),
    stateFile: text(env.LIGHT_REMOTE_PADDLE_STATE_FILE || DEFAULT_STATE_FILE),
  };
}

function validateSandboxIdentifiers(config) {
  if (config.environment !== 'sandbox') return { ok: false, reason: 'paddle_sandbox_only' };
  if (config.apiKey && !config.apiKey.includes('_sdbx_')) return { ok: false, reason: 'paddle_sandbox_api_key_required' };
  if (config.clientToken && !config.clientToken.startsWith('test_')) return { ok: false, reason: 'paddle_sandbox_client_token_required' };
  if (config.proPriceId && !/^pri_[a-z0-9]{26}$/.test(config.proPriceId)) return { ok: false, reason: 'paddle_price_id_invalid' };
  return { ok: true, reason: null };
}

export class PaddleBilling {
  constructor({
    config = defaultConfig(),
    paddleClient = null,
    operatorCall = callOperatorJson,
    now = () => Date.now(),
  } = {}) {
    this.config = config;
    this.operatorCall = operatorCall;
    this.now = now;
    this.state = loadState(config.stateFile);
    this.validation = validateSandboxIdentifiers(config);
    this.paddle = paddleClient || (
      this.validation.ok && config.apiKey
        ? new Paddle(config.apiKey, { environment: Environment.sandbox })
        : null
    );
  }

  status() {
    const checkoutEnabled = Boolean(
      this.validation.ok &&
      this.paddle &&
      this.config.clientToken &&
      this.config.proPriceId
    );
    const webhookEnabled = Boolean(
      this.validation.ok &&
      this.paddle &&
      this.config.webhookSecret
    );
    return {
      environment: this.config.environment,
      configured: checkoutEnabled && webhookEnabled,
      checkoutEnabled,
      webhookEnabled,
      reason: this.validation.ok ? null : this.validation.reason,
      priceConfigured: Boolean(this.config.proPriceId),
      apiConfigured: Boolean(this.config.apiKey),
      clientConfigured: Boolean(this.config.clientToken),
      webhookConfigured: Boolean(this.config.webhookSecret),
    };
  }

  publicConfig() {
    const status = this.status();
    return {
      enabled: status.checkoutEnabled,
      environment: status.environment,
      clientToken: status.checkoutEnabled ? this.config.clientToken : null,
      proPriceId: status.checkoutEnabled ? this.config.proPriceId : null,
      currency: 'USD',
      proMonthly: 20,
      reason: status.checkoutEnabled ? null : status.reason || 'paddle_sandbox_not_configured',
    };
  }

  async createCheckout(account) {
    const status = this.status();
    if (!status.checkoutEnabled) {
      const error = new Error(status.reason || 'paddle_checkout_not_configured');
      error.status = 503;
      throw error;
    }
    const accountId = text(account?.accountId);
    const email = text(account?.email).toLowerCase();
    if (!accountId || !email) {
      const error = new Error('paddle_account_required');
      error.status = 400;
      throw error;
    }

    const transaction = await this.paddle.transactions.create({
      items: [{ priceId: this.config.proPriceId, quantity: 1 }],
      customData: {
        light_remote_account_id: accountId,
        light_remote_account_email: email,
        light_remote_plan: PRO_PLAN,
        light_remote_environment: 'sandbox',
      },
      checkout: { url: `${PUBLIC_ORIGIN}/account/billing` },
    });

    return {
      transactionId: transaction.id,
      checkoutUrl: transaction?.checkout?.url || null,
      environment: 'sandbox',
      plan: PRO_PLAN,
    };
  }

  async currentAccount(accountId) {
    const row = await this.operatorCall(
      'GET',
      `/v1/admin/accounts/${encodeURIComponent(accountId)}`,
    );
    return row?.account || null;
  }

  async grantSubscription(data, eventType) {
    const accountId = accountIdFrom(data);
    const plan = planFrom(data);
    const subscriptionId = sourceRefFrom(data);
    const status = text(data?.status).toLowerCase();

    if (!accountId || !subscriptionId || plan !== PRO_PLAN) {
      return { action: 'ignored', reason: 'paddle_metadata_missing', accountId, subscriptionId };
    }
    if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status) &&
        ![
          EventName.SubscriptionCreated,
          EventName.SubscriptionActivated,
          EventName.SubscriptionResumed,
          EventName.SubscriptionTrialing,
        ].includes(eventType)) {
      return { action: 'ignored', reason: 'subscription_not_active', accountId, subscriptionId, status };
    }

    const current = await this.currentAccount(accountId);
    if (!current) {
      const error = new Error('paddle_account_not_found');
      error.status = 404;
      throw error;
    }

    const currentPlan = text(current.plan || 'free').toLowerCase();
    if ((PLAN_RANK[currentPlan] || 0) > PLAN_RANK[PRO_PLAN]) {
      return { action: 'kept_higher_plan', accountId, subscriptionId, currentPlan };
    }

    const entitlement = current.entitlement || {};
    if (currentPlan === PRO_PLAN && entitlement.source !== 'paddle') {
      return { action: 'kept_existing_pro', accountId, subscriptionId, currentPlan };
    }
    if (
      currentPlan === PRO_PLAN &&
      entitlement.source === 'paddle' &&
      text(entitlement.sourceRef) === subscriptionId
    ) {
      return { action: 'already_active', accountId, subscriptionId, plan: PRO_PLAN };
    }

    const out = await this.operatorCall(
      'POST',
      `/v1/admin/accounts/${encodeURIComponent(accountId)}/entitlement`,
      {
        plan: PRO_PLAN,
        source: 'paddle',
        sourceRef: subscriptionId,
        allowDowngrade: false,
      },
    );
    return {
      action: 'granted',
      accountId,
      subscriptionId,
      plan: out?.account?.plan || PRO_PLAN,
    };
  }

  async revokeSubscription(data) {
    const accountId = accountIdFrom(data);
    const subscriptionId = sourceRefFrom(data);
    if (!accountId || !subscriptionId) {
      return { action: 'ignored', reason: 'paddle_metadata_missing', accountId, subscriptionId };
    }

    const current = await this.currentAccount(accountId);
    const entitlement = current?.entitlement || {};
    if (
      text(entitlement.source) !== 'paddle' ||
      text(entitlement.sourceRef) !== subscriptionId
    ) {
      return {
        action: 'ignored',
        reason: 'subscription_not_current_entitlement',
        accountId,
        subscriptionId,
        currentPlan: current?.plan || null,
      };
    }

    const out = await this.operatorCall(
      'POST',
      `/v1/admin/accounts/${encodeURIComponent(accountId)}/entitlement/revoke`,
      {
        source: 'paddle',
        reason: `paddle:${subscriptionId}`,
      },
    );
    return {
      action: 'revoked',
      accountId,
      subscriptionId,
      plan: out?.account?.plan || 'free',
    };
  }

  async processEvent(event) {
    const eventType = safeEventType(event);
    const data = safeData(event);
    const eventId = safeEventId(event);

    if (eventId && this.state.events[eventId]) {
      return { duplicate: true, ...this.state.events[eventId].result };
    }

    let result = { action: 'ignored', reason: 'event_not_used', eventType };
    if ([
      EventName.SubscriptionCreated,
      EventName.SubscriptionActivated,
      EventName.SubscriptionResumed,
      EventName.SubscriptionTrialing,
      EventName.SubscriptionUpdated,
    ].includes(eventType)) {
      if (text(data?.status).toLowerCase() === 'canceled') result = await this.revokeSubscription(data);
      else result = await this.grantSubscription(data, eventType);
    } else if (eventType === EventName.SubscriptionCanceled) {
      result = await this.revokeSubscription(data);
    } else if (eventType === EventName.TransactionCompleted) {
      result = {
        action: 'recorded',
        eventType,
        accountId: accountIdFrom(data) || null,
        transactionId: text(data?.id) || null,
      };
    }

    const subscriptionId = sourceRefFrom(data);
    if (subscriptionId && eventType.startsWith('subscription.')) {
      this.state.subscriptions[subscriptionId] = {
        accountId: accountIdFrom(data) || null,
        status: text(data?.status) || null,
        eventType,
        updatedAt: this.now(),
      };
    }

    if (eventId) {
      this.state.events[eventId] = {
        eventType,
        processedAt: this.now(),
        result,
      };
    }
    saveState(this.config.stateFile, this.state);
    return { duplicate: false, ...result };
  }

  async unmarshal(rawBody, signature) {
    const status = this.status();
    if (!status.webhookEnabled) {
      const error = new Error(status.reason || 'paddle_webhook_not_configured');
      error.status = 503;
      throw error;
    }
    if (!rawBody || !signature) {
      const error = new Error('paddle_signature_required');
      error.status = 400;
      throw error;
    }
    return this.paddle.webhooks.unmarshal(
      String(rawBody),
      this.config.webhookSecret,
      String(signature),
    );
  }

  async handleWebhook(rawBody, signature) {
    const event = await this.unmarshal(rawBody, signature);
    return {
      eventId: safeEventId(event) || null,
      eventType: safeEventType(event) || null,
      result: await this.processEvent(event),
    };
  }
}

export { EventName };

export const paddleBilling = new PaddleBilling();

export function paddleBillingStatus() {
  return paddleBilling.status();
}

export function paddlePublicConfig() {
  return paddleBilling.publicConfig();
}

export async function createPaddleCheckout(account) {
  return paddleBilling.createCheckout(account);
}

export function registerPaddleWebhook(app, rawMiddleware) {
  app.post('/billing/paddle/webhook', rawMiddleware, async (req, res) => {
    try {
      const signature = text(req.headers?.['paddle-signature']);
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
      const result = await paddleBilling.handleWebhook(rawBody, signature);
      console.log(JSON.stringify({
        event: 'paddle_webhook',
        status: 'ok',
        eventId: result.eventId,
        eventType: result.eventType,
        action: result.result?.action || null,
        duplicate: Boolean(result.result?.duplicate),
      }));
      return res.status(200).json({ ok: true });
    } catch (error) {
      const status = Number(error?.status) || 400;
      console.error(JSON.stringify({
        event: 'paddle_webhook',
        status: 'error',
        error: String(error?.message || 'paddle_webhook_failed').slice(0, 120),
      }));
      return res.status(status >= 500 ? 500 : 400).json({ ok: false, error: 'paddle_webhook_rejected' });
    }
  });
}
