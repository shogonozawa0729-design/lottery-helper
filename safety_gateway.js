(() => {
  'use strict';
  if (globalThis.LATIASSafety) return;
  const policy = globalThis.LATIASPolicy;
  if (!policy) throw new Error('LATIAS policy is required');
  let active = null;
  const writes = new WeakMap();
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
  // No click, submit, generic property setter, callback or arbitrary event API exists.
  Object.defineProperty(globalThis, 'LATIASSafety', { value: Object.freeze({ begin, end, setValue, setSelect, ensureConsent, reject: record }), writable: false, configurable: false });
})();
