import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EventName, PaddleBilling } from '../../plugin-server/paddle-billing.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'light-remote-paddle-'));
const stateFile = path.join(tmp, 'state.json');
const priceId = 'pri_' + 'a'.repeat(26);
const calls = [];
let createdBody = null;
let refundTransaction = null;
let refundAdjustmentStatus = 'pending_approval';
const refundRequests = [];
const canceledSubscriptions = [];
const purchaseRecords = [];
const refundRecords = [];
const purchaseMails = [];
const portalSessions = [];
const purchaseRecorder = async payload => { purchaseRecords.push(structuredClone(payload)); return { accepted: true, event_id: payload.event_id, status: 'Received' }; };
const purchaseMailer = async payload => { purchaseMails.push(structuredClone(payload)); return { sent: true, messageId: 'msg_test' }; };
const refundRecorder = async payload => { refundRecords.push(structuredClone(payload)); return { accepted: true, event_id: payload.event_id, status: 'Received' }; };
let account = {
  accountId: 'acct_test',
  email: 'owner@example.test',
  plan: 'free',
  entitlement: { plan: 'free', source: 'default', sourceRef: null },
};

const fakePaddle = {
  transactions: {
    async create(body) {
      createdBody = body;
      return { id: 'txn_' + 'b'.repeat(26), checkout: { url: 'https://sandbox.example/checkout' } };
    },
    async get() {
      if (!refundTransaction) throw new Error('refund_transaction_not_configured');
      return structuredClone(refundTransaction);
    },
    list() {
      return {
        async next() {
          return refundTransaction ? [structuredClone(refundTransaction)] : [];
        },
      };
    },
  },
  customers: {
    list({ email = [] } = {}) {
      return {
        async next() {
          return [{ id: 'ctm_test', email: email[0] || 'owner@example.test', status: 'active' }];
        },
      };
    },
  },
  customerPortalSessions: {
    async create(customerId, subscriptionIds) {
      portalSessions.push({ customerId, subscriptionIds: structuredClone(subscriptionIds || []) });
      return {
        id: 'cpl_test',
        customerId,
        urls: { general: { overview: 'https://sandbox-customer-portal.example/overview?token=test' }, subscriptions: [] },
      };
    },
  },
  adjustments: {
    async create(body) {
      refundRequests.push(structuredClone(body));
      return {
        id: 'adj_' + 'r'.repeat(26),
        action: 'refund',
        type: 'full',
        transactionId: body.transactionId,
        subscriptionId: refundTransaction?.subscriptionId || null,
        status: refundAdjustmentStatus,
      };
    },
  },
  subscriptions: {
    async get(subscriptionId) {
      return {
        id: subscriptionId,
        status: canceledSubscriptions.includes(subscriptionId) ? 'canceled' : 'active',
        customerId: 'ctm_test',
        billingCycle: { interval: 'month', frequency: 1 },
        nextBilledAt: canceledSubscriptions.includes(subscriptionId) ? null : new Date(1_800_000_000_000 + 30 * 24 * 60 * 60 * 1000).toISOString(),
        items: [{ nextBilledAt: new Date(1_800_000_000_000 + 30 * 24 * 60 * 60 * 1000).toISOString() }],
      };
    },
    async cancel(subscriptionId, body) {
      canceledSubscriptions.push(subscriptionId);
      return { id: subscriptionId, status: 'canceled', effectiveFrom: body?.effectiveFrom || null };
    },
  },
  webhooks: {
    async unmarshal() {
      return {
        eventId: 'evt_' + 'c'.repeat(26),
        eventType: EventName.SubscriptionCreated,
        data: {
          id: 'sub_' + 'd'.repeat(26),
          status: 'active',
          customData: {
            light_remote_account_id: 'acct_test',
            light_remote_plan: 'pro',
          },
        },
      };
    },
  },
};

async function operatorCall(method, target, body = null) {
  calls.push({ method, target, body });
  if (method === 'GET' && target === '/v1/admin/accounts/acct_test') return { ok: true, account: structuredClone(account) };
  if (method === 'POST' && target === '/v1/admin/accounts/acct_test/entitlement') {
    account = {
      ...account,
      plan: body.plan,
      entitlement: {
        plan: body.plan,
        source: body.source,
        sourceRef: body.sourceRef,
        validUntil: null,
      },
    };
    return { ok: true, account: structuredClone(account), entitlements: { plan: account.plan } };
  }
  if (method === 'POST' && target === '/v1/admin/accounts/acct_test/entitlement/revoke') {
    account = {
      ...account,
      plan: 'free',
      entitlement: {
        plan: 'free',
        source: body.source === 'paddle' ? 'paddle_revoke' : 'admin_revoke',
        sourceRef: body.reason,
        validUntil: null,
      },
    };
    return { ok: true, account: structuredClone(account), entitlements: { plan: 'free' } };
  }
  throw new Error('unexpected_operator_call:' + method + ':' + target);
}

const config = {
  environment: 'sandbox',
  apiKey: 'pdl_sdbx_apikey_test',
  clientToken: 'test_client_token',
  proPriceId: priceId,
  webhookSecret: 'pdl_ntfset_test_secret',
  stateFile,
};

const billing = new PaddleBilling({
  config,
  paddleClient: fakePaddle,
  operatorCall,
  purchaseRecorder,
  refundRecorder,
  purchaseMailer,
  now: () => 1_800_000_000_000,
});

assert.equal(billing.status().checkoutEnabled, true);
assert.equal(billing.status().webhookEnabled, true);
assert.equal(billing.publicConfig().clientToken, 'test_client_token');

const checkout = await billing.createCheckout(account);
assert.match(checkout.transactionId, /^txn_/);
assert.equal(createdBody.items[0].priceId, priceId);
assert.equal(createdBody.customData.light_remote_account_id, 'acct_test');
assert.equal(createdBody.customData.light_remote_plan, 'pro');
assert.equal(createdBody.customData.light_remote_account_email, 'owner@example.test');

await assert.rejects(
  () => billing.createCheckout({ ...account, plan: 'pro' }),
  error => error?.message === 'paddle_account_already_paid' && error?.status === 409,
);

const webhook = await billing.handleWebhook('raw-body', 'ts=1;h1=test');
assert.equal(webhook.result.action, 'granted');
assert.equal(account.plan, 'pro');
assert.equal(account.entitlement.source, 'paddle');
assert.match(account.entitlement.sourceRef, /^sub_/);
const entitlementPostsAfterGrant = calls.filter(x => x.target.endsWith('/entitlement')).length;
assert.equal(entitlementPostsAfterGrant, 1);

const duplicate = await billing.processEvent({
  eventId: 'evt_' + 'c'.repeat(26),
  eventType: EventName.SubscriptionCreated,
  data: {
    id: 'sub_' + 'd'.repeat(26),
    status: 'active',
    customData: { light_remote_account_id: 'acct_test', light_remote_plan: 'pro' },
  },
});
assert.equal(duplicate.duplicate, true);
assert.equal(calls.filter(x => x.target.endsWith('/entitlement')).length, 1);

const duplicateSubscription = await billing.processEvent({
  eventId: 'evt_' + 'z'.repeat(26),
  eventType: EventName.SubscriptionCreated,
  data: {
    id: 'sub_' + 'y'.repeat(26),
    status: 'active',
    customData: { light_remote_account_id: 'acct_test', light_remote_plan: 'pro' },
  },
});
assert.equal(duplicateSubscription.action, 'kept_existing_paddle');
assert.equal(account.plan, 'pro');
assert.match(account.entitlement.sourceRef, /^sub_/);
assert.equal(calls.filter(x => x.target.endsWith('/entitlement')).length, 1);

account = {
  ...account,
  plan: 'vip',
  entitlement: { plan: 'vip', source: 'admin', sourceRef: 'owner-vip', validUntil: null },
};
const vipResult = await billing.processEvent({
  eventId: 'evt_' + 'e'.repeat(26),
  eventType: EventName.SubscriptionActivated,
  data: {
    id: 'sub_' + 'f'.repeat(26),
    status: 'active',
    customData: { light_remote_account_id: 'acct_test', light_remote_plan: 'pro' },
  },
});
assert.equal(vipResult.action, 'kept_higher_plan');
assert.equal(account.plan, 'vip');

const paddleSub = 'sub_' + 'g'.repeat(26);
account = {
  ...account,
  plan: 'pro',
  entitlement: { plan: 'pro', source: 'paddle', sourceRef: paddleSub, validUntil: null },
};
const canceled = await billing.processEvent({
  eventId: 'evt_' + 'h'.repeat(26),
  eventType: EventName.SubscriptionCanceled,
  data: {
    id: paddleSub,
    status: 'canceled',
    customData: { light_remote_account_id: 'acct_test', light_remote_plan: 'pro' },
  },
});
assert.equal(canceled.action, 'revoked');
assert.equal(account.plan, 'free');
const revoke = calls.find(x => x.target.endsWith('/entitlement/revoke'));
assert.equal(revoke.body.source, 'paddle');
assert.equal(revoke.body.reason, 'paddle:' + paddleSub);

const refundSub = 'sub_' + 'q'.repeat(26);
const refundTxn = 'txn_' + 'p'.repeat(26);
account = {
  ...account,
  plan: 'pro',
  entitlement: { plan: 'pro', source: 'paddle', sourceRef: refundSub, validUntil: null },
};
refundTransaction = {
  id: refundTxn,
  status: 'completed',
  subscriptionId: refundSub,
  customerId: 'ctm_test',
  invoiceNumber: 'INV-TEST-0001',
  currencyCode: 'USD',
  items: [{ price: { taxMode: 'location', billingCycle: { interval: 'month', frequency: 1 } } }],
  customData: {
    light_remote_account_id: 'acct_test',
    light_remote_account_email: 'owner@example.test',
    light_remote_plan: 'pro',
  },
  details: {
    totals: {
      subtotal: '2000',
      tax: '500',
      total: '2500',
      grandTotal: '2500',
      currencyCode: 'USD',
    },
    payoutTotals: {
      subtotal: '2000',
      tax: '500',
      total: '2500',
      fee: '175',
      earnings: '1825',
      currencyCode: 'USD',
    },
    adjustedPayoutTotals: {
      retainedFee: '-175',
      currencyCode: 'USD',
    },
  },
  adjustments: [],
  payments: [{
    status: 'captured',
    amount: '2500',
    capturedAt: new Date(1_800_000_000_000 - 60 * 60 * 1000).toISOString(),
  }],
  createdAt: new Date(1_800_000_000_000 - 2 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(1_800_000_000_000 - 60 * 60 * 1000).toISOString(),
  billedAt: new Date(1_800_000_000_000 - 60 * 60 * 1000).toISOString(),
};
const purchaseSync = await billing.processEvent({
  eventId: 'evt_' + 'k'.repeat(26),
  eventType: EventName.TransactionCompleted,
  data: {
    id: refundTxn,
    status: 'completed',
    customData: {
      light_remote_account_id: 'acct_test',
      light_remote_account_email: 'owner@example.test',
      light_remote_plan: 'pro',
    },
  },
});
assert.equal(purchaseSync.action, 'recorded');
assert.equal(purchaseRecords.length, 1);
assert.equal(purchaseRecords[0].event_id, 'paddle.purchase.' + refundTxn);
assert.equal(purchaseRecords[0].amount, 20);
assert.equal(purchaseRecords[0].gross_amount, 25);
assert.equal(purchaseRecords[0].tax_amount, 5);
assert.equal(purchaseRecords[0].fee_amount, 1.75);
assert.equal(purchaseRecords[0].earnings_amount, 18.25);
assert.equal(purchaseRecords[0].source_reference, refundTxn);
assert.equal(purchaseMails.length, 1);
assert.equal(purchaseMails[0].to, 'owner@example.test');
assert.equal(purchaseMails[0].total, 25);
assert.equal(purchaseMails[0].tax, 5);
assert.equal(purchaseMails[0].invoiceNumber, 'INV-TEST-0001');
assert.equal(purchaseMails[0].taxInclusive, false);
assert.equal(purchaseMails[0].billingCycle.interval, 'month');

const billingSummary = await billing.accountBillingSummary(account);
assert.equal(billingSummary.available, true);
assert.equal(billingSummary.portalAvailable, true);
assert.equal(billingSummary.transaction.transactionId, refundTxn);
assert.equal(billingSummary.transaction.invoiceNumber, 'INV-TEST-0001');
assert.equal(billingSummary.transaction.total, 25);
assert.equal(billingSummary.subscription.subscriptionId, refundSub);
assert.equal(billingSummary.subscription.status, 'active');
assert.equal(billingSummary.subscription.billingCycle.interval, 'month');
const portal = await billing.createCustomerPortal(account);
assert.match(portal.url, /^https:\/\/sandbox-customer-portal\.example\//);
assert.equal(portalSessions.length, 1);
assert.equal(portalSessions[0].customerId, 'ctm_test');
assert.deepEqual(portalSessions[0].subscriptionIds, [refundSub]);

const adminBeforeRefund = await billing.adminBillingTransactions({
  query: 'owner@example.test',
  limit: 20,
});
assert.equal(adminBeforeRefund.transactions.length, 1);
assert.equal(adminBeforeRefund.transactions[0].refundEligible, true);
assert.equal(adminBeforeRefund.transactions[0].amountMinor, '2500');
assert.equal(adminBeforeRefund.transactions[0].taxMinor, '500');
assert.equal(adminBeforeRefund.transactions[0].currentPlan, 'pro');
assert.equal(adminBeforeRefund.transactions[0].currentEntitlementSource, 'paddle');
refundAdjustmentStatus = 'pending_approval';
const refundPending = await billing.requestEmergencyRefund({
  transactionId: refundTxn,
  reason: 'exceptional customer recovery',
});
assert.equal(refundPending.status, 'pending_approval');
assert.equal(refundPending.action, 'refund_pending');
assert.equal(account.plan, 'pro');
assert.equal(canceledSubscriptions.includes(refundSub), false);
assert.equal(refundRequests.at(-1).action, 'refund');
assert.equal(refundRequests.at(-1).type, 'full');

const adminAfterRefund = await billing.adminBillingTransactions({
  query: refundTxn,
  limit: 20,
});
assert.equal(adminAfterRefund.transactions.length, 1);
assert.equal(adminAfterRefund.transactions[0].refundEligible, false);
assert.equal(adminAfterRefund.transactions[0].refund.status, 'pending_approval');

const refundApproved = await billing.processEvent({
  eventId: 'evt_' + 'j'.repeat(26),
  eventType: EventName.AdjustmentUpdated,
  data: {
    id: 'adj_' + 'r'.repeat(26),
    action: 'refund',
    type: 'full',
    transactionId: refundTxn,
    subscriptionId: refundSub,
    status: 'approved',
    currencyCode: 'USD',
    totals: { subtotal: '2000', tax: '500', total: '2500', grandTotal: '2500' },
    updatedAt: new Date(1_800_000_000_000).toISOString(),
  },
});
assert.equal(refundApproved.action, 'refund_approved');
assert.equal(canceledSubscriptions.includes(refundSub), true);
assert.equal(account.plan, 'free');
assert.equal(refundRecords.length, 1);
assert.equal(refundRecords[0].event_id, 'paddle.refund.' + 'adj_' + 'r'.repeat(26));
assert.equal(refundRecords[0].amount, 20);
assert.equal(refundRecords[0].gross_amount, 25);
assert.equal(refundRecords[0].retained_fee, 1.75);
assert.equal(refundRecords[0].source_reference, refundTxn);

account = {
  ...account,
  plan: 'pro',
  entitlement: { plan: 'pro', source: 'paddle', sourceRef: refundSub, validUntil: null },
};
refundTransaction = {
  ...refundTransaction,
  payments: [{
    status: 'captured',
    capturedAt: new Date(1_800_000_000_000 - 25 * 60 * 60 * 1000).toISOString(),
  }],
};
await assert.rejects(
  () => billing.requestEmergencyRefund({
    transactionId: refundTxn,
    reason: 'too late',
  }),
  error => error?.message === 'paddle_refund_window_expired' && error?.status === 409,
);

const disabled = new PaddleBilling({
  config: { environment: 'sandbox', apiKey: '', clientToken: '', proPriceId: '', webhookSecret: '', stateFile: '' },
  paddleClient: null,
  operatorCall,
});
assert.equal(disabled.status().checkoutEnabled, false);
assert.equal(disabled.status().webhookEnabled, false);

const paused = new PaddleBilling({
  config: {
    environment: 'sandbox',
    checkoutAllowed: false,
    apiKey: 'pdl_sdbx_apikey_test',
    clientToken: 'test_client_token',
    proPriceId: priceId,
    webhookSecret: 'pdl_ntfset_test_secret',
    stateFile: '',
  },
  paddleClient: fakePaddle,
  operatorCall,
});
assert.equal(paused.status().configured, true);
assert.equal(paused.status().checkoutAllowed, false);
assert.equal(paused.status().checkoutEnabled, false);
assert.equal(paused.status().webhookEnabled, true);
assert.equal(paused.publicConfig().paused, true);
assert.equal(paused.publicConfig().clientToken, null);
await assert.rejects(
  () => paused.createCheckout({ accountId: 'acct_test', email: 'owner@example.test', plan: 'free' }),
  error => error?.message === 'paddle_checkout_not_configured' && error?.status === 503,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('paddle-sandbox-config=PASS');
console.log('paddle-server-checkout-metadata=PASS');
console.log('paddle-webhook-grant=PASS');
console.log('paddle-webhook-idempotency=PASS');
console.log('paddle-vip-no-downgrade=PASS');
console.log('paddle-cancel-revoke=PASS');
console.log('paddle-refund-24h-window=PASS');
console.log('paddle-refund-approval-gate=PASS');
console.log('paddle-admin-refund-eligibility=PASS');
console.log('paddle-purchase-confirmation-mail=PASS');
console.log('paddle-account-billing-summary=PASS');
console.log('paddle-customer-portal=PASS');
console.log('paddle-checkout-pause-flag=PASS');
