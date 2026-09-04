(() => {
  if (globalThis.__lotteryHelperQuestionMapperLoaded) return;
  globalThis.__lotteryHelperQuestionMapperLoaded = true;

  function cleanText(value, max = 1800) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function getLabelText(el) {
    if (!el) return '';
    const parts = [];
    if (el.labels) {
      for (const label of el.labels) parts.push(label.innerText || label.textContent || '');
    }
    const closest = el.closest?.('label');
    if (closest) parts.push(closest.innerText || closest.textContent || '');
    const aria = el.getAttribute?.('aria-label');
    if (aria) parts.push(aria);
    return cleanText(parts.join(' '), 600);
  }

  function setNativeValue(el, value) {
    if (!el || value == null || value === '' || el.disabled || el.readOnly) return false;
    const target = String(value);
    const old = String(el.value ?? '');
    if (old === target) return false;

    const proto = Object.getPrototypeOf(el);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, target);
    else el.value = target;

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function transformValue(value, transform) {
    let result = String(value ?? '');
    if (transform === 'digits') result = result.replace(/[^0-9]/g, '');
    if (transform === 'trim' || transform === 'digits') result = result.trim();
    return result;
  }

  function compileMappings(rule) {
    const raw = Array.isArray(rule?.questionMappings) ? rule.questionMappings : [];
    return raw.map((item, index) => {
      try {
        return {
          ...item,
          index,
          regex: new RegExp(item.questionRegex || '', 'iu')
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  function isTextLikeControl(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'SELECT') return true;
    if (el.tagName !== 'INPUT') return false;
    const type = String(el.type || 'text').toLowerCase();
    return ['text', 'number', 'tel', 'email', 'search', 'url'].includes(type);
  }

  function siblingTextBefore(node, limit = 900) {
    if (!node) return '';
    const parts = [];
    let current = node.previousElementSibling;
    let count = 0;
    while (current && count < 4) {
      const text = cleanText(current.innerText || current.textContent || '', 500);
      if (text) parts.unshift(text);
      if (parts.join(' ').length >= limit) break;
      current = current.previousElementSibling;
      count++;
    }
    return cleanText(parts.join(' '), limit);
  }

  function questionContexts(el) {
    const contexts = [];
    const push = value => {
      const text = cleanText(value, 1600);
      if (!text) return;
      if (!contexts.includes(text)) contexts.push(text);
    };

    push([
      getLabelText(el),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('name'),
      el.id
    ].filter(Boolean).join(' '));

    push(siblingTextBefore(el));
    push(siblingTextBefore(el.parentElement));

    let node = el.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      const text = cleanText(node.innerText || node.textContent || '', 1600);
      if (text && text.length <= 1600) push(text);
      push(siblingTextBefore(node));
      node = node.parentElement;
      depth++;
    }

    return contexts;
  }

  function mappingForControl(el, mappings) {
    for (const context of questionContexts(el)) {
      const matches = mappings.filter(mapping => {
        mapping.regex.lastIndex = 0;
        return mapping.regex.test(context);
      });
      if (matches.length === 1) return { mapping: matches[0], context };
    }
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
      const found = mappingForControl(el, mappings);
      if (!found) continue;

      const key = found.mapping.profileKey || '';
      if (!key) continue;
      const value = transformValue(profile[key], found.mapping.transform);
      if (!value) continue;

      const didChange = el.tagName === 'SELECT'
        ? selectByText(el, value)
        : setNativeValue(el, value);

      if (didChange) {
        changed++;
        el.dataset.lotteryHelperQuestionMapped = key;
      }
    }

    return changed;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'FILL_FORM') return;
    if (!msg?.rule || !msg?.profile) return;
    try {
      fillByQuestionMappings(msg.rule, msg.profile);
    } catch (error) {
      console.warn('[LotteryHelper question mapper]', error);
    }
  });
})();
