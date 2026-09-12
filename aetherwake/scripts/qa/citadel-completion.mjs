/**
 * Verify observed victory and persistence using the caller's normal UI reload.
 * This helper never writes game state or saves: saveCheckpoint only archives
 * the existing browser save, observeReload performs the real reload/continue,
 * and read supplies the actual post-reload snapshot. IO errors propagate to
 * the caller's failure/cleanup path; they cannot produce a successful result.
 * Passing this contract with fixtures is not browser gameplay acceptance.
 */
export async function verifyCitadelCompletion({ finish, saveCheckpoint, observeReload, read }) {
  const result = {
    ok: false,
    failures: [],
    reload: null,
    finish: finish ?? null,
    after: null,
    checkpoint: null,
  };
  const failures = result.failures;
  if (finish?.bossDead !== true) failures.push("finish-boss-not-dead");
  if (finish?.mode !== "ending") failures.push("finish-not-ending");
  if (finish?.boss?.alive !== false) failures.push("finish-boss-alive-unverified");
  if (!Number.isFinite(finish?.hp) || finish.hp <= 0) failures.push("finish-player-not-alive");
  if (!Number.isFinite(finish?.amber)) failures.push("finish-amber-unavailable");
  if (failures.length) return result;

  result.checkpoint = await saveCheckpoint();
  if (!result.checkpoint) {
    failures.push("checkpoint-missing");
    return result;
  }
  result.reload = await observeReload();
  result.after = await read();
  const { reload, after } = result;

  if (reload?.restored !== true) failures.push("reload-not-restored");
  if (reload?.envelope?.bossDead !== true) failures.push("saved-boss-not-dead");
  if (after?.bossDead !== true) failures.push("after-boss-not-dead");
  if (after?.boss?.alive !== false) failures.push("after-boss-alive-unverified");
  if (after?.mode !== "playing" && after?.mode !== "ending") failures.push("after-mode-invalid");
  if (!Number.isFinite(after?.amber)) failures.push("after-amber-unavailable");
  else if (after.amber !== finish.amber) failures.push("amber-changed");

  result.ok = failures.length === 0;
  return result;
}
