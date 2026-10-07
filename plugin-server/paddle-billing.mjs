import fs from 'node:fs';
import path from 'node:path';
import { Environment, EventName, Paddle } from '@paddle/paddle-node-sdk';

import { callOperatorJson } from './operator-client.mjs';
import { recordPaddlePurchase, recordPaddleRefund } from './commerce-backoffice.mjs';

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

function accountEmailFrom(data) {
  const custom = safeCustomData(data);
  return text(custom.light_remote_account_email || custom.lightRemoteAccountEmail).toLowerCase();
}

function minorUnitDivisor(currency) {
  return new Set(['JPY','KRW']).has(text(currency).toUpperCase()) ? 1 : 100;
}

function majorAmount(value, currency) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return number / minorUnitDivisor(currency);
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return 0;
}

function paddleAccounting(transaction) {
  const details = transaction?.details || {};
  const totals = details?.totals || {};
  const payout = details?.payoutTotals || details?.payout_totals || {};
  const adjustedPayout = details?.adjustedPayoutTotals || details?.adjusted_payout_totals || {};
  const currency = text(
    transaction?.currencyCode ||
    transaction?.currency_code ||
    totals?.currencyCode ||
    totals?.currency_code ||
    payout?.currencyCode ||
    payout?.currency_code ||
    'USD'
  ).toUpperCase();
  return {
    currency,
    subtotal: majorAmount(firstValue(totals?.subtotal), currency),
    gross: majorAmount(firstValue(totals?.grandTotal, totals?.grand_total, totals?.total), currency),
    tax: majorAmount(firstValue(totals?.tax), currency),
    fee: majorAmount(firstValue(payout?.fee, totals?.fee), currency),
    earnings: majorAmount(firstValue(payout?.earnings, totals?.earnings), currency),
    retainedFee: majorAmount(
      firstValue(
        adjustedPayout?.retainedFee,
        adjustedPayout?.retained_fee,
        payout?.retainedFee,
        payout?.retained_fee,
        totals?.retainedFee,
        totals?.retained_fee,
      ),
      currency,
    ),
  };
}

function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  const events = state.events && typeof state.events === 'object' ? state.events : {};
  const subscriptions = state.subscriptions && typeof state.subscriptions === 'object' ? state.subscriptions : {};
  const refunds = state.refunds && typeof state.refunds === 'object' ? state.refunds : {};
  return { schemaVersion: 2, events, subscriptions, refunds };
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
  const rawCheckoutEnabled = text(env.LIGHT_REMOTE_PADDLE_CHECKOUT_ENABLED || 'true').toLowerCase();
  const checkoutAllowed = !['0', 'false', 'off', 'no'].includes(rawCheckoutEnabled);
  return {
    environment,
    checkoutAllowed,
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
    purchaseRecorder = recordPaddlePurchase,
    refundRecorder = recordPaddleRefund,
    now = () => Date.now(),
  } = {}) {
    this.config = config;
    this.operatorCall = operatorCall;
    this.purchaseRecorder = purchaseRecorder;
    this.refundRecorder = refundRecorder;
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
    const credentialsConfigured = Boolean(
      this.validation.ok &&
      this.paddle &&
      this.config.clientToken &&
      this.config.proPriceId &&
      this.config.webhookSecret
    );
    const checkoutAllowed = this.config.checkoutAllowed !== false;
    const checkoutEnabled = Boolean(
      checkoutAllowed &&
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
      configured: credentialsConfigured,
      checkoutAllowed,
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
    const paused = Boolean(status.configured && !status.checkoutAllowed);
    return {
      enabled: status.checkoutEnabled,
      configured: status.configured,
      paused,
      environment: status.environment,
      clientToken: status.checkoutEnabled ? this.config.clientToken : null,
      proPriceId: status.checkoutEnabled ? this.config.proPriceId : null,
      currency: 'USD',
      proMonthly: 20,
      reason: status.checkoutEnabled
        ? null
        : paused
          ? 'paddle_checkout_paused'
          : status.reason || 'paddle_sandbox_not_configured',
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
    const accountPlan = text(account?.plan || 'free').toLowerCase();
    if (!accountId || !email) {
      const error = new Error('paddle_account_required');
      error.status = 400;
      throw error;
    }
    if (accountPlan !== 'free') {
      const error = new Error('paddle_account_already_paid');
      error.status = 409;
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
    if (currentPlan === PRO_PLAN && entitlement.source === 'paddle') {
      return {
        action: 'kept_existing_paddle',
        reason: 'different_subscription_already_owns_entitlement',
        accountId,
        subscriptionId,
        currentSubscriptionId: text(entitlement.sourceRef) || null,
        plan: PRO_PLAN,
      };
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

  refundCaptureTime(transaction) {
    const captured = (transaction?.payments || [])
      .filter(payment => text(payment?.status).toLowerCase() === 'captured')
      .map(payment => text(payment?.capturedAt || payment?.captured_at || payment?.createdAt || payment?.created_at))
      .filter(Boolean)
      .map(value => Date.parse(value))
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
    if (captured.length) return captured[0];

    const fallback = text(
      transaction?.billedAt ||
      transaction?.billed_at ||
      transaction?.updatedAt ||
      transaction?.updated_at ||
      transaction?.createdAt ||
      transaction?.created_at
    );
    const parsed = Date.parse(fallback);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async adminBillingTransactions({
    query = '',
    limit = 50,
    refundWindowHours = 24,
  } = {}) {
    if (!this.paddle) {
      return {
        environment: this.config.environment,
        refundWindowHours: 24,
        transactions: [],
      };
    }

    const pageLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const windowHours = Math.min(24, Math.max(1, Number(refundWindowHours) || 24));
    const windowMs = windowHours * 60 * 60 * 1000;
    const q = text(query).toLowerCase();

    const collection = this.paddle.transactions.list({
      status: ['completed'],
      perPage: 100,
      include: ['adjustment'],
    });
    const page = await collection.next();
    const rows = [];

    for (const transaction of page) {
      const custom = safeCustomData(transaction);
      const accountId = text(custom.light_remote_account_id || custom.lightRemoteAccountId);
      const email = text(custom.light_remote_account_email || custom.lightRemoteAccountEmail).toLowerCase();
      const plan = text(custom.light_remote_plan || custom.lightRemotePlan || '').toLowerCase();
      const subscriptionId = text(transaction?.subscriptionId || transaction?.subscription_id);

      if (!accountId || !email || plan !== PRO_PLAN) continue;

      const searchable = [
        transaction.id,
        subscriptionId,
        accountId,
        email,
      ].join(' ').toLowerCase();
      if (q && !searchable.includes(q)) continue;

      const capturedMs = this.refundCaptureTime(transaction);
      const ageMs = capturedMs == null ? null : this.now() - capturedMs;
      const paddleAdjustments = (transaction?.adjustments || [])
        .filter(row => text(row?.action).toLowerCase() === 'refund')
        .map(row => ({
          adjustmentId: text(row?.id) || null,
          status: text(row?.status) || null,
          type: text(row?.type) || null,
        }));

      const stateRefundEntry = Object.entries(this.state.refunds || {})
        .filter(([, row]) => text(row?.transactionId) === text(transaction.id))
        .sort((a, b) => Number(b[1]?.updatedAt || b[1]?.requestedAt || 0) - Number(a[1]?.updatedAt || a[1]?.requestedAt || 0))[0] || null;
      const stateRefund = stateRefundEntry ? {
        adjustmentId: stateRefundEntry[0],
        status: text(stateRefundEntry[1]?.status) || null,
        type: 'full',
      } : null;

      const refund = paddleAdjustments[0] || stateRefund || null;
      const refundStatus = text(refund?.status).toLowerCase();
      const hasOpenRefund = Boolean(refund && refundStatus !== 'rejected');
      const withinWindow = ageMs != null && ageMs >= -5 * 60 * 1000 && ageMs <= windowMs;
      const eligible = withinWindow && !hasOpenRefund;

      const capturedPayment = (transaction?.payments || [])
        .find(payment => text(payment?.status).toLowerCase() === 'captured');
      const totals = transaction?.details?.totals || {};

      rows.push({
        transactionId: text(transaction.id),
        subscriptionId: subscriptionId || null,
        accountId,
        email,
        plan,
        transactionStatus: text(transaction?.status) || null,
        currency: text(transaction?.currencyCode || totals?.currencyCode || 'USD') || 'USD',
        amountMinor: text(totals?.grandTotal || totals?.total || capturedPayment?.amount || '0'),
        subtotalMinor: text(totals?.subtotal || '0'),
        taxMinor: text(totals?.tax || '0'),
        capturedAt: capturedMs == null ? null : new Date(capturedMs).toISOString(),
        ageMs,
        refundWindowHours: windowHours,
        refundRemainingMs: eligible ? Math.max(0, windowMs - Math.max(0, ageMs)) : 0,
        refundEligible: eligible,
        refund: refund ? {
          adjustmentId: refund.adjustmentId || null,
          status: refund.status || null,
          type: refund.type || null,
        } : null,
      });
    }

    rows.sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0));
    const limited = rows.slice(0, pageLimit);

    const uniqueAccounts = [...new Set(limited.map(row => row.accountId))];
    const accountPairs = await Promise.all(uniqueAccounts.map(async accountId => {
      try {
        return [accountId, await this.currentAccount(accountId)];
      } catch {
        return [accountId, null];
      }
    }));
    const accounts = new Map(accountPairs);

    return {
      environment: this.config.environment,
      refundWindowHours: windowHours,
      transactions: limited.map(row => {
        const current = accounts.get(row.accountId);
        return {
          ...row,
          currentPlan: text(current?.plan || '') || null,
          currentEntitlementSource: text(current?.entitlement?.source || '') || null,
          currentEntitlementRef: text(current?.entitlement?.sourceRef || '') || null,
        };
      }),
    };
  }

  async recordCompletedTransaction(data) {
    const transactionId = text(data?.id);
    if (!transactionId || !this.paddle) {
      return { action: 'ignored', reason: 'paddle_transaction_missing' };
    }
    const transaction = await this.paddle.transactions.get(transactionId);
    const accountId = accountIdFrom(transaction) || accountIdFrom(data);
    const email = accountEmailFrom(transaction) || accountEmailFrom(data);
    const plan = planFrom(transaction) || planFrom(data);
    if (!accountId || !email || plan !== PRO_PLAN) {
      return {
        action: 'ignored',
        reason: 'paddle_metadata_missing',
        accountId: accountId || null,
        transactionId,
      };
    }

    const accounting = paddleAccounting(transaction);
    const fee = accounting.fee;
    const earnings = accounting.earnings || Math.max(0, accounting.subtotal - fee);
    const capturedAt = this.refundCaptureTime(transaction);
    const subscriptionId = text(transaction?.subscriptionId || transaction?.subscription_id);
    const payload = {
      event_id: 'paddle.purchase.' + transactionId,
      source_product: 'Light Remote',
      plan_code: 'PRO',
      customer_email: email,
      account_id: accountId,
      source_reference: transactionId,
      external_order_id: subscriptionId,
      payment_provider: 'Paddle',
      payment_reference: transactionId,
      amount: accounting.subtotal,
      gross_amount: accounting.gross || accounting.subtotal,
      tax_amount: accounting.tax,
      fee_amount: fee,
      earnings_amount: earnings,
      currency: accounting.currency,
      purchased_at: new Date(capturedAt || this.now()).toISOString(),
      metadata: {
        paddle_environment: this.config.environment,
        subscription_id: subscriptionId || null,
        transaction_status: text(transaction?.status) || null,
      },
    };
    const backoffice = await this.purchaseRecorder(payload);
    return {
      action: 'recorded',
      accountId,
      transactionId,
      subscriptionId: subscriptionId || null,
      backofficeStatus: text(backoffice?.status) || 'accepted',
      backofficeEventId: text(backoffice?.event_id) || payload.event_id,
      accounting,
    };
  }

  async recordApprovedRefund(adjustment, transaction) {
    const adjustmentId = text(adjustment?.id);
    const transactionId = text(
      adjustment?.transactionId ||
      adjustment?.transaction_id ||
      transaction?.id
    );
    const accountId = accountIdFrom(transaction);
    const email = accountEmailFrom(transaction);
    if (!adjustmentId || !transactionId || !accountId || !email) {
      return { action: 'backoffice_refund_unmapped' };
    }
    const accounting = paddleAccounting(transaction);
    const adjustmentTotals = adjustment?.totals || {};
    const adjustmentPayout = adjustment?.payoutTotals || adjustment?.payout_totals || {};
    const currency = text(
      adjustment?.currencyCode ||
      adjustment?.currency_code ||
      accounting.currency ||
      'USD'
    ).toUpperCase();
    const grossRefund = majorAmount(
      firstValue(
        adjustmentTotals?.grandTotal,
        adjustmentTotals?.grand_total,
        adjustmentTotals?.total,
      ),
      currency,
    ) || accounting.gross || accounting.subtotal;
    const retainedFee = Math.abs(majorAmount(
      firstValue(
        adjustmentPayout?.retainedFee,
        adjustmentPayout?.retained_fee,
        adjustmentTotals?.retainedFee,
        adjustmentTotals?.retained_fee,
        transaction?.details?.adjustedPayoutTotals?.retainedFee,
        transaction?.details?.adjustedPayoutTotals?.retained_fee,
        transaction?.details?.adjusted_payout_totals?.retained_fee,
      ),
      currency,
    ));
    const payload = {
      event_id: 'paddle.refund.' + adjustmentId,
      source_product: 'Light Remote',
      plan_code: 'PRO',
      customer_email: email,
      account_id: accountId,
      source_reference: transactionId,
      external_order_id: text(transaction?.subscriptionId || transaction?.subscription_id),
      payment_provider: 'Paddle',
      payment_reference: adjustmentId,
      amount: accounting.subtotal,
      gross_amount: grossRefund,
      retained_fee: retainedFee,
      currency,
      refunded_at: text(adjustment?.updatedAt || adjustment?.updated_at || adjustment?.createdAt || adjustment?.created_at) || new Date(this.now()).toISOString(),
      metadata: {
        paddle_environment: this.config.environment,
        adjustment_status: text(adjustment?.status) || null,
        adjustment_type: text(adjustment?.type) || null,
      },
    };
    const backoffice = await this.refundRecorder(payload);
    return {
      eventId: text(backoffice?.event_id) || payload.event_id,
      status: text(backoffice?.status) || 'accepted',
      retainedFee,
    };
  }

  async requestEmergencyRefund({
    transactionId,
    reason,
    maxAgeHours = 24,
    requestedBy = 'private_admin',
  } = {}) {
    const id = text(transactionId);
    const why = text(reason);
    const hours = Number(maxAgeHours);
    if (!this.paddle || !id || !why || why.length < 8) {
      const error = new Error('paddle_refund_request_invalid');
      error.status = 400;
      throw error;
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      const error = new Error('paddle_refund_window_invalid');
      error.status = 400;
      throw error;
    }

    const transaction = await this.paddle.transactions.get(id);
    if (text(transaction?.status).toLowerCase() !== 'completed') {
      const error = new Error('paddle_refund_transaction_not_completed');
      error.status = 409;
      throw error;
    }

    const accountId = accountIdFrom(transaction);
    const plan = planFrom(transaction);
    if (!accountId || plan !== PRO_PLAN) {
      const error = new Error('paddle_refund_transaction_not_light_remote');
      error.status = 403;
      throw error;
    }

    const capturedAt = this.refundCaptureTime(transaction);
    if (!capturedAt) {
      const error = new Error('paddle_refund_capture_time_missing');
      error.status = 409;
      throw error;
    }
    const ageMs = this.now() - capturedAt;
    const maxAgeMs = hours * 60 * 60 * 1000;
    if (ageMs < -5 * 60 * 1000 || ageMs > maxAgeMs) {
      const error = new Error('paddle_refund_window_expired');
      error.status = 409;
      throw error;
    }

    const adjustment = await this.paddle.adjustments.create({
      action: 'refund',
      type: 'full',
      transactionId: id,
      reason: why,
    });

    const result = await this.processRefundAdjustment(adjustment);
    this.state.refunds[adjustment.id] = {
      transactionId: id,
      accountId,
      subscriptionId: text(adjustment?.subscriptionId || transaction?.subscriptionId) || null,
      status: text(adjustment?.status) || null,
      requestedBy: text(requestedBy) || 'private_admin',
      reason: why,
      requestedAt: this.now(),
      updatedAt: this.now(),
      result,
    };
    saveState(this.config.stateFile, this.state);

    return {
      adjustmentId: adjustment.id,
      transactionId: id,
      accountId,
      subscriptionId: text(adjustment?.subscriptionId || transaction?.subscriptionId) || null,
      status: text(adjustment?.status) || null,
      capturedAt: new Date(capturedAt).toISOString(),
      ageHours: Math.max(0, ageMs) / 3600000,
      action: result.action,
    };
  }

  async processRefundAdjustment(data) {
    if (text(data?.action).toLowerCase() !== 'refund') {
      return { action: 'ignored', reason: 'adjustment_not_refund' };
    }

    const adjustmentId = text(data?.id);
    const transactionId = text(data?.transactionId || data?.transaction_id);
    const status = text(data?.status).toLowerCase();
    const subscriptionId = text(data?.subscriptionId || data?.subscription_id);

    if (!adjustmentId || !transactionId) {
      return { action: 'ignored', reason: 'refund_metadata_missing' };
    }

    if (status !== 'approved') {
      const result = {
        action: status === 'rejected' ? 'refund_rejected' : 'refund_pending',
        adjustmentId,
        transactionId,
        subscriptionId: subscriptionId || null,
        status,
      };
      this.state.refunds[adjustmentId] = {
        ...(this.state.refunds[adjustmentId] || {}),
        transactionId,
        subscriptionId: subscriptionId || null,
        status,
        updatedAt: this.now(),
        result,
      };
      return result;
    }

    const transaction = await this.paddle.transactions.get(transactionId);
    const accountId = accountIdFrom(transaction);
    const effectiveSubscriptionId = subscriptionId || text(transaction?.subscriptionId);
    if (!accountId || !effectiveSubscriptionId) {
      return {
        action: 'refund_approved_unmapped',
        adjustmentId,
        transactionId,
        subscriptionId: effectiveSubscriptionId || null,
      };
    }

    let cancellation = 'not_needed';
    try {
      const subscription = await this.paddle.subscriptions.get(effectiveSubscriptionId);
      const subscriptionStatus = text(subscription?.status).toLowerCase();
      if (subscriptionStatus !== 'canceled') {
        await this.paddle.subscriptions.cancel(
          effectiveSubscriptionId,
          { effectiveFrom: 'immediately' },
        );
        cancellation = 'canceled';
      } else {
        cancellation = 'already_canceled';
      }
    } catch (error) {
      const message = text(error?.message).toLowerCase();
      if (message.includes('canceled') || message.includes('not found')) cancellation = 'already_unavailable';
      else throw error;
    }

    const current = await this.currentAccount(accountId);
    const entitlement = current?.entitlement || {};
    let entitlementAction = 'unchanged';
    if (
      text(entitlement.source) === 'paddle' &&
      text(entitlement.sourceRef) === effectiveSubscriptionId
    ) {
      const revoked = await this.operatorCall(
        'POST',
        `/v1/admin/accounts/${encodeURIComponent(accountId)}/entitlement/revoke`,
        {
          source: 'paddle',
          reason: `paddle_refund:${adjustmentId}`,
        },
      );
      entitlementAction = revoked?.account?.plan || 'free';
    }

    const backoffice = await this.recordApprovedRefund(data, transaction);
    const result = {
      action: 'refund_approved',
      adjustmentId,
      transactionId,
      accountId,
      subscriptionId: effectiveSubscriptionId,
      cancellation,
      entitlementAction,
      status,
      backoffice,
    };
    this.state.refunds[adjustmentId] = {
      ...(this.state.refunds[adjustmentId] || {}),
      transactionId,
      accountId,
      subscriptionId: effectiveSubscriptionId,
      status,
      updatedAt: this.now(),
      result,
    };
    return result;
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
      result = await this.recordCompletedTransaction(data);
    } else if (
      eventType === EventName.AdjustmentCreated ||
      eventType === EventName.AdjustmentUpdated
    ) {
      result = await this.processRefundAdjustment(data);
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
