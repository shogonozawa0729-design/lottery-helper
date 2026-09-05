(() => {
  if (globalThis.__lotteryHelperQuestionMapperLoaded) return;
  globalThis.__lotteryHelperQuestionMapperLoaded = true;

  function cleanText(value, max = 2400) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(-max);
  }

  function kanaToHiragana(value) {
    return String(value || '').replace(/[ァ-ヶ]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }

  function profileValue(profile, key) {
    if (!profile || !key) return '';
    if (profile[key] != null && String(profile[key]).trim() !== '') return profile[key];

    const fullName = profile.fullName || [profile.lastName, profile.firstName].filter(Boolean).join(' ');
    const fullKana = profile.fullKana || [profile.lastNameKana, profile.firstNameKana].filter(Boolean).join(' ');
    const fullAddress = profile.fullAddress || profile.address || [
      profile.prefecture,
      profile.city,
      profile.address1,
      profile.address2,
      profile.building
    ].filter(Boolean).join('');
    const birthDate = profile.birthDate || profile.birthday || '';

    switch (key) {
      case '__fullNameExact': return fullName;
      case '__fullKana': return fullKana;
      case '__fullKanaHiragana': return kanaToHiragana(fullKana);
      case '__fullAddress': return fullAddress;
      case '__birthDate': return birthDate;
      case '__birthDateCompact': return String(birthDate).replace(/[^0-9]/g, '');
      default: return '';
    }
  }

  function setNativeValue(el, value, allowReadOnly = false) {
    if (!el || value == null || value === '' || el.disabled || (el.readOnly && !allowReadOnly)) return false;
    const target = String(value);
    if (String(el.value ?? '') === target) return false;
    const proto = Object.getPrototypeOf(el);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, target);
    else el.value = target;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return String(el.value ?? '') === target;
  }

  function transformValue(value, transform) {
    let result = String(value ?? '');
    if (transform === 'digits') result = result.replace(/[^0-9]/g, '');
    if (transform === 'dateSlash') {
      const digits = result.replace(/[^0-9]/g, '');
      if (digits.length === 8) result = `${digits.slice(0,4)}/${digits.slice(4,6)}/${digits.slice(6,8)}`;
    }
    if (transform === 'hiragana') result = kanaToHiragana(result);
    if (['trim', 'digits', 'dateSlash', 'hiragana'].includes(transform)) result = result.trim();
    return result;
  }

  function compileMappings(rule) {
    return (Array.isArray(rule?.questionMappings) ? rule.questionMappings : [])
      .map((item, index) => {
        try {
          return { ...item, index, regex: new RegExp(item.questionRegex || '', 'iu') };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function isTextLikeControl(el) {
    if (!el || el.disabled) return false;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    if (el.tagName !== 'INPUT') return false;
    return ['text', 'number', 'tel', 'email', 'search', 'url', 'date'].includes(String(el.type || 'text').toLowerCase());
  }

  function directContext(el) {
    const labels = el.labels ? [...el.labels].map(label => label.innerText || label.textContent || '') : [];
    return cleanText([
      ...labels,
      el.closest?.('label')?.innerText,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('name'),
      el.id
    ].filter(Boolean).join(' '), 1000);
  }

  function renderedTextBefore(el, limit = 2600) {
    try {
      const range = document.createRange();
      range.setStart(document.body, 0);
      range.setEndBefore(el);
      return cleanText(range.toString(), limit);
    } catch {
      return '';
    }
  }

  function lastMatchIndex(text, regex) {
    if (!text) return -1;
    try {
      const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
      const scan = new RegExp(regex.source, flags);
      let last = -1;
      let match;
      while ((match = scan.exec(text)) !== null) {
        last = match.index;
        if (match[0] === '') scan.lastIndex++;
      }
      return last;
    } catch {
      return -1;
    }
  }

  function mappingForControl(el, mappings) {
    const direct = directContext(el);
    if (direct) {
      const directHits = mappings.filter(mapping => {
        mapping.regex.lastIndex = 0;
        return mapping.regex.test(direct);
      });
      if (directHits.length === 1) return directHits[0];
    }

    // CustomForm / LivePocket 等は設問文と入力欄にHTML labelが結び付いていないことがある。
    // 入力欄より前に描画された本文のうち、最も直近の設問辞書を採用する。
    const before = renderedTextBefore(el);
    let best = null;
    let bestIndex = -1;
    for (const mapping of mappings) {
      const index = lastMatchIndex(before, mapping.regex);
      if (index > bestIndex) {
        best = mapping;
        bestIndex = index;
      }
    }

    if (best && bestIndex >= Math.max(0, before.length - Number(best.maxDistance || 1200))) return best;
    return null;
  }

  function selectByText(select, value) {
    const target = cleanText(value, 300).toLowerCase();
    if (!target) return false;
    const option = [...select.options].find(opt => {
      const text = cleanText(opt.textContent || '', 300).toLowerCase();
      const val = cleanText(opt.value || '', 300).toLowerCase();
      return text === target || val === target || text.includes(target);
    });
    if (!option || select.value === option.value) return false;
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function fillByQuestionMappings(rule, profile) {
    const mappings = compileMappings(rule);
    if (!mappings.length || !profile) return 0;

    let changed = 0;
    const controls = [...document.querySelectorAll(
      'textarea, select, input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="password"])'
    )].filter(isTextLikeControl);

    for (const el of controls) {
      const mapping = mappingForControl(el, mappings);
      if (!mapping?.profileKey) continue;
      if (el.readOnly && !mapping.allowReadOnly) continue;

      const rawValue = profileValue(profile, mapping.profileKey);
      const value = transformValue(rawValue, mapping.transform);
      if (!value) continue;

      const didChange = el.tagName === 'SELECT'
        ? selectByText(el, value)
        : setNativeValue(el, value, !!mapping.allowReadOnly);

      if (didChange) {
        changed++;
        el.dataset.lotteryHelperQuestionMapped = mapping.profileKey;
      }
    }
    return changed;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'FILL_FORM' || !msg?.rule || !msg?.profile) return;
    try {
      fillByQuestionMappings(msg.rule, msg.profile);
    } catch (error) {
      console.warn('[LotteryHelper question mapper]', error);
    }
  });
})();
