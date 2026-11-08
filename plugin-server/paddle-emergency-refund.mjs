#!/usr/bin/env node
import { paddleBilling } from './paddle-billing.mjs';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

const transactionId = arg('--transaction');
const reason = arg('--reason');
const maxAgeHours = Number(arg('--window-hours') || 24);

if (!transactionId || !reason) {
  console.error('usage: paddle-emergency-refund.mjs --transaction txn_... --reason "..." [--window-hours 24]');
  process.exit(2);
}

try {
  const result = await paddleBilling.requestEmergencyRefund({
    transactionId,
    reason,
    maxAgeHours,
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: String(error?.message || 'paddle_refund_failed'),
    status: Number(error?.status) || null,
  }));
  process.exit(1);
}
