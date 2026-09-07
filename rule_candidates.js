(() => {
  'use strict';
  if (globalThis.LATIASRuleCandidates) return;
  // Legacy schema v2 adapter: data in, candidate data out. No DOM or execution access.
  function compile(actions) {
    if (!Array.isArray(actions) || actions.length > 200) return [];
    return actions.map(a => {
      if (!a || typeof a !== 'object') return { kind: 'blocked' };
      const selector = typeof a.selector === 'string' ? a.selector : 'input,textarea,select';
      const labelRegex = typeof a.labelRegex === 'string' ? a.labelRegex : '';
      if (selector.length > 1000 || labelRegex.length > 1000 || !labelRegex) return { kind: 'blocked' };
      const base = { selector, labelRegex };
      if (a.type === 'fillProfileByLabel' || a.type === 'selectProfileByLabel') {
        if (typeof a.profileKey !== 'string') return { kind: 'blocked' };
        return { ...base, kind: 'profile', profileKey: a.profileKey, select: a.type === 'selectProfileByLabel',
          transform: ['digits','trim','hiragana'].includes(a.transform) ? a.transform : '' };
      }
      if (a.type === 'selectMaxByLabel') return { ...base, kind: 'quantity' };
      if (a.type === 'checkByLabel' || a.type === 'ensureCheckedByLabel') return { ...base, kind: 'consent' };
      if (a.type === 'selectPositivePairs') return { ...base, kind: 'consent-select', pairs: (Array.isArray(a.pairs) ? a.pairs : []).slice(0,20).filter(p => Array.isArray(p) && p.length === 2 && p.every(x => typeof x === 'string' && x.length < 200)) };
      // Fixed answers / clicks / callbacks / arbitrary setters are not capabilities.
      return { kind: 'blocked' };
    });
  }
  Object.defineProperty(globalThis, 'LATIASRuleCandidates', { value: Object.freeze({ compile }), writable: false, configurable: false });
})();
