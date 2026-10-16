import crypto from 'node:crypto';

/**
 * rc.50 SCP public-tool compatibility shim.
 *
 * Upload chunk hashes were REQUIRED by older Agent builds; the new leaf
 * library supports their omission. Derive the exact chunk SHA-256 at the
 * Plugin boundary, so BOTH deployed leaf versions validate the SAME bytes.
 * This is never the full-file SHA, which remains verified at commit.
 */
export function prepareScpUploadChunk(input={}) {
  const data=input?.data;
  if(typeof data!=='string'||!data||data.length>6_000_000||
    !/^[A-Za-z0-9_-]+$/.test(data)||data.length%4===1)
    throw new Error('scp_invalid_chunk_encoding');
  const bytes=Buffer.from(data,'base64url');
  if(bytes.length===0||bytes.toString('base64url')!==data)
    throw new Error('scp_invalid_chunk_encoding');
  const calculated=crypto.createHash('sha256').update(bytes).digest('hex');
  const supplied=input.sha256;
  if(supplied!==undefined) {
    if(typeof supplied!=='string'||!/^[0-9a-fA-F]{64}$/.test(supplied))
      throw new Error('scp_invalid_sha256');
    if(supplied.toLowerCase()!==calculated)
      throw new Error('scp_chunk_hash_mismatch');
  }
  return {op:'upload-chunk',transferId:input.transferId,index:input.index,
    data,sha256:calculated};
}
