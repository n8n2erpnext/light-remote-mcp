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
