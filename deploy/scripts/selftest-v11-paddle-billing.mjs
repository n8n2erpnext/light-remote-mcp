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
  customData: {
    light_remote_account_id: 'acct_test',
    light_remote_plan: 'pro',
  },
  payments: [{
    status: 'captured',
    capturedAt: new Date(1_800_000_000_000 - 60 * 60 * 1000).toISOString(),
  }],
  createdAt: new Date(1_800_000_000_000 - 2 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(1_800_000_000_000 - 60 * 60 * 1000).toISOString(),
  billedAt: new Date(1_800_000_000_000 - 60 * 60 * 1000).toISOString(),
};
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
  },
});
assert.equal(refundApproved.action, 'refund_approved');
assert.equal(canceledSubscriptions.includes(refundSub), true);
assert.equal(account.plan, 'free');

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

fs.rmSync(tmp, { recursive: true, force: true });
console.log('paddle-sandbox-config=PASS');
console.log('paddle-server-checkout-metadata=PASS');
console.log('paddle-webhook-grant=PASS');
console.log('paddle-webhook-idempotency=PASS');
console.log('paddle-vip-no-downgrade=PASS');
console.log('paddle-cancel-revoke=PASS');
console.log('paddle-refund-24h-window=PASS');
console.log('paddle-refund-approval-gate=PASS');
