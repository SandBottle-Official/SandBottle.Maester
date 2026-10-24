const MINIMUM = [22, 18];

/** @param {string} version @returns {{ ok: true } | { ok: false, message: string }} */
export function checkNodeVersion(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  const supported = major > MINIMUM[0] || (major === MINIMUM[0] && minor >= MINIMUM[1]);
  return supported ? { ok: true } : { ok: false, message: `Maester 需要 Node ${MINIMUM.join('.')} 以上（目前 ${version}）` };
}
