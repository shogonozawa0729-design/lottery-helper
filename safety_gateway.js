(() => {
  'use strict';
  if (globalThis.LATIASSafety) return;
  const policy = globalThis.LATIASPolicy;
  if (!policy) throw new Error('LATIAS policy is required');
  let active = null;
  const writes = new WeakMap();
  const ariaInFlight = new WeakSet();
  const uncertainAria = new WeakSet();
  function record(reason) { if (active) active.rejected[reason] = (active.rejected[reason] || 0) + 1; return false; }
  function permitted(el, purpose, option, key) {
    if (!active || active.url !== location.href) return record('no-current-run');
    const reason = policy.authorize(el, purpose, option, key);
    return reason ? record(reason) : true;
  }
  function begin() {
    if (active) throw new Error('LATIAS run already active');
    active = { url: location.href, rejected: {}, token: {} };
  }
  function end() { const result = active?.rejected || {}; active = null; return result; }
  function emit(el, purpose, option, key) {
    for (const name of ['input','change','blur']) {
      if (!permitted(el, purpose, option, key)) return false;
      el.dispatchEvent(new Event(name, { bubbles: true }));
    }
    return true;
  }
  function setValue(el, value, options = {}) {
    const purpose = options.purpose || 'profile';
    if (!['profile','quantity'].includes(purpose)) return record('invalid-value-purpose');
    if (!permitted(el, purpose, null, options.profileKey)) return false;
    if (el.tagName === 'SELECT' || !['INPUT','TEXTAREA'].includes(el.tagName)) return record('invalid-value-target');
    if (value == null || String(value) === '') return false;
    const target = String(value), old = String(el.value || '');
    const own = writes.get(el);
    const adaptive = options.identityCorrection === true && own?.token === active.token && old === own.value && target === old.replace(/[\s　]+/g, '') && /[\s　]/.test(old) && ['name','kana'].includes(policy.kind(el));
    if (old.trim() && purpose !== 'quantity' && !adaptive) return false;
    if (old === target) return false;
    if (purpose === 'quantity') {
      const rawMax = el.getAttribute('max');
      const max = rawMax?.trim() ? Number(rawMax) : NaN;
      if (!Number.isFinite(max) || max < 0 || Number(target) !== max || !Number.isInteger(max)) return record('unknown-quantity-limit');
      const probe = el.cloneNode(false);
      probe.value = target;
      if (!probe.validity.valid) return record('invalid-quantity');
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, target);
    writes.set(el, { value: target, token: active.token });
    return emit(el, purpose, null, options.profileKey) && String(el.value) === target;
  }
  function setSelect(el, option, options = {}) {
    const purpose = options.purpose || 'profile';
    if (!['profile','quantity','consent'].includes(purpose)) return record('invalid-select-purpose');
    if (!permitted(el, purpose, option, options.profileKey)) return false;
    if (el.tagName !== 'SELECT' || !option || option.closest('select') !== el || option.disabled || option.parentElement?.disabled || option.hidden) return record('invalid-option');
    if (el.value === option.value) return false;
    const current = el.selectedOptions[0];
    if (purpose === 'profile' && el.value && !/選択|未選択|^--/.test(current?.textContent || '')) return false;
    if (purpose === 'consent' && policy.negative.test(current?.textContent || '')) return record('existing-refusal');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, option.value);
    return emit(el, purpose, option, options.profileKey) && el.value === option.value;
  }
  function ensureConsent(el) {
    if (!permitted(el, 'consent')) return false;
    if (el.tagName !== 'INPUT' || !['checkbox','radio'].includes(el.type)) return record('unverified-choice');
    if (el.checked) return false;
    if (el.type === 'radio' && el.name) {
      const selected = [...document.querySelectorAll('input[type="radio"]')].find(x => x.form === el.form && x.name === el.name && x.checked);
      if (selected) return record('existing-radio-selection');
    }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(el, true);
    return emit(el, 'consent') && el.checked;
  }
  function ensureProduct(el) {
    if (!permitted(el, 'product')) return false;
    // Purpose cannot turn a radio, a custom role or a submit control into a product.
    if (el.tagName !== 'INPUT' || el.type !== 'checkbox') return record('invalid-product-target');
    if (el.checked) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(el, true);
    return emit(el, 'product') && el.checked;
  }
  function ariaRadioSelected(el) {
    if (el.getAttribute('role') !== 'radio') return false;
    const group = el.closest('[role="radiogroup"]');
    if (!group) return true; // No group identity means no safe radio operation.
    return [...group.querySelectorAll('[role="radio"][aria-checked="true"]')].some(other => other !== el && other.closest('[role="radiogroup"]') === group);
  }
  async function ensureGoogleChoice(el, purpose) {
    if (!permitted(el, purpose) || !policy.googleAria(el)) return false;
    if (el.getAttribute('aria-checked') === 'true') return false;
    if (ariaInFlight.has(el) || uncertainAria.has(el)) return record('aria-pending-or-unconfirmed');
    if (ariaRadioSelected(el)) return record('existing-or-unknown-radio-group');
    const token = active.token;
    ariaInFlight.add(el);
    let clicked = false;
    try {
      // Revalidate immediately before the only permitted ARIA click, without awaiting.
      if (!permitted(el, purpose) || !policy.googleAria(el) || el.getAttribute('aria-checked') !== 'false' || ariaRadioSelected(el)) return false;
      clicked = true;
      HTMLElement.prototype.click.call(el);
      // Observe the site's own state update. Never set aria-checked or synthesize fallbacks.
      for (let pass = 0; pass < 20; pass++) {
        if (active?.token !== token || !permitted(el, purpose)) break;
        if (el.getAttribute('aria-checked') === 'true') return true;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      uncertainAria.add(el);
      return record('aria-state-not-confirmed');
    } catch {
      if (clicked) uncertainAria.add(el);
      return record('aria-operation-failed');
    } finally { ariaInFlight.delete(el); }
  }
  // Narrow capabilities only: callers cannot choose an event, click handler or purpose.
  const ensureGoogleConsent = el => ensureGoogleChoice(el, 'consent');
  const ensureGoogleEmailRecording = el => ensureGoogleChoice(el, 'google-email');
  Object.defineProperty(globalThis, 'LATIASSafety', { value: Object.freeze({ begin, end, setValue, setSelect, ensureConsent, ensureProduct, ensureGoogleConsent, ensureGoogleEmailRecording, reject: record }), writable: false, configurable: false });
})();
