import fs from 'node:fs';

const linuxWorkflow=fs.readFileSync(new URL('../../.github/workflows/linux-client-build.yml',import.meta.url),'utf8');
const install=fs.readFileSync(new URL('../../client/linux/install.sh',import.meta.url),'utf8');
const updater=fs.readFileSync(new URL('../../client/linux/updater.mjs',import.meta.url),'utf8');
const signer=fs.readFileSync(new URL('../../client/sign-update-manifest.mjs',import.meta.url),'utf8');
const verifier=fs.readFileSync(new URL('../../client/verify-update-manifest.mjs',import.meta.url),'utf8');
function expect(value,message){if(!value)throw new Error(message);}

expect(linuxWorkflow.includes('arch: [x64, arm64]'),'linux_arch_matrix_missing');
expect(linuxWorkflow.includes('node-v${NODE_VERSION}-linux-${TARGET_ARCH}.tar.xz'),'linux_node_runtime_not_bundled');
expect(linuxWorkflow.includes('actions/upload-artifact@v4'),'linux_artifact_upload_missing');
expect(linuxWorkflow.includes('(cd "$OUT" && sha256sum "GPT-Operator-Agent-Linux-${TARGET_ARCH}-dev.tar.gz")'),'linux_checksum_not_portable');
expect(linuxWorkflow.includes('(cd "$OUT" && sha256sum -c SHA256SUMS.txt)'),'linux_checksum_ci_verify_missing');
expect(install.includes('gpt-operator-device-agent.service'),'linux_agent_service_missing');
expect(install.includes('gpt-operator-agent-update.timer'),'linux_update_timer_missing');
expect(install.includes('OnUnitActiveSec=6h'),'linux_update_cadence_missing');
expect(install.includes('The terminal can now be closed'),'foreground_dependency_warning_missing');
expect(install.includes('openssl dgst -sha256 -verify'),'linux_manifest_signature_verify_missing');
expect(updater.includes("crypto.verify('sha256'"),'linux_update_signature_verify_missing');
expect(updater.includes('timingSafeEqual'),'linux_artifact_hash_verify_missing');
expect(updater.includes('atomicCurrent(previous)'),'linux_update_rollback_missing');
expect(updater.includes('fs.renameSync(next,CURRENT)'),'linux_atomic_switch_missing');
expect(updater.includes("systemctl',['restart',SERVICE]"),'linux_update_restart_missing');
expect(signer.includes('CLIENT_UPDATE_SIGNING_KEY_FILE_required'),'release_private_key_must_be_external');
expect(verifier.includes('invalid_update_manifest_signature'),'manifest_verify_guard_missing');
expect(!fs.existsSync(new URL('../../.github/workflows/windows-agent-dev-build.yml',import.meta.url)),'legacy_windows_zip_workflow_still_present');
expect(fs.existsSync(new URL('../../.github/workflows/windows-native-client.yml',import.meta.url)),'native_windows_workflow_missing');
console.log('client-packaging-linux-persistence=PASS');
console.log('client-packaging-signed-updates=PASS');
console.log('client-packaging-no-powershell-user-flow=PASS');
