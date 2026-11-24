/** Short vibration for confirmations (Android; iOS browsers ignore it). */
export function haptic(ms = 10) {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}
