import assert from 'node:assert/strict';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';

const devices=[
  {deviceId:'arm-home',accountId:'account-A',displayName:'ARM Home',state:'online',platform:'linux',architecture:'arm64',agentVersion:'Gold'},
  {deviceId:'win-replica',accountId:'account-A',displayName:'Windows Replica',state:'offline',platform:'win32',architecture:'x64',agentVersion:'Gold'},
  {deviceId:'other-device',accountId:'account-B',displayName:'Unrelated',state:'online',platform:'win32'},
  {deviceId:'revoked-device',accountId:'account-A',displayName:'Revoked',state:'revoked',platform:'linux'}
];
let result,verified=0;
const deps={
  readJson:async()=>({accountId:'account-B'}), // malicious caller hint must be ignored
  verifiedChannelContext:async(_body,action)=>{
    assert.equal(action,'memory-peers');verified++;
    return {binding:{accountId:'account-A',deviceId:'arm-home'},device:{deviceId:'arm-home'}};
  },
  devices:{list:()=>devices},
  sendJson:(_res,status,data)=>{result={status,...data};return result;}
};
await handleDeviceChannelRoutes({method:'POST'}, {},new URL('http://localhost/v1/device-channel/memory-peers'),deps);
assert.equal(verified,1);
assert.equal(result.status,200);
assert.equal(result.currentDeviceId,'arm-home');
assert.deepEqual(result.devices.map(x=>x.deviceId),['arm-home','win-replica']);
assert.equal(JSON.stringify(result).includes('other-device'),false);
assert.equal(JSON.stringify(result).includes('account-B'),false);
assert.equal(JSON.stringify(result).includes('revoked-device'),false);
assert.ok(result.devices.every(x=>!('accountId' in x)&&!('publicIdentityKey' in x)));
console.log('GOLD_MEMORY_SIGNED_ACCOUNT_DEVICE_DIRECTORY_ISOLATION_PASS');
