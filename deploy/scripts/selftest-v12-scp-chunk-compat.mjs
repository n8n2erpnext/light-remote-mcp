import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { scpChunkCompatibilitySha256 } from '../../plugin-server/tools.mjs';

// Match an upload produced by an older official MCP tool whose schema
// contained only transferId/index/data. No device or network needed.
const bytes=Buffer.from('LR-SCP-SMOKE-OK\n','utf8');
const encoded=bytes.toString('base64url');
const expected=crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(scpChunkCompatibilitySha256(encoded),expected);
assert.equal(scpChunkCompatibilitySha256(''),null);
assert.equal(scpChunkCompatibilitySha256(encoded+'=='),null,'noncanonical_padding_must_not_be_sent');
assert.equal(scpChunkCompatibilitySha256('$not-base64url'),null);
assert.equal(scpChunkCompatibilitySha256('a'),null);
console.log('V12_SCP_OLD_CLIENT_CHUNK_SHA_COMPAT=PASS');
