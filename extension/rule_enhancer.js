(() => {
  if (globalThis.__lotteryRuleEnhancerLoaded) return;
  globalThis.__lotteryRuleEnhancerLoaded = true;

  const wait = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

  function norm(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compact(value) {
    return norm(value).replace(/[\s　:_\-\[\]()（）]/g, '').toLowerCase();
  }

  function stageForRule(rule) {
    if (!rule || !Array.isArray(rule.stages)) return null;
    return rule.stages.find(stage => {
      const paths = Array.isArray(stage?.paths) ? stage.paths : [];
      const pathMatched = paths.some(p => {
        if (p?.prefix && location.pathname.startsWith(p.prefix)) return true;
        if (p?.exact && location.pathname === p.exact) return true;
        if (p?.regex) {
          try { return new RegExp(p.regex).test(location.pathname); } catch { return false; }
        }
        return false;
      });
      if (!pathMatched) return false;

      const required = Array.isArray(stage?.requiredText)
        ? stage.requiredText
        : (stage?.requiredText ? [stage.requiredText] : []);
      if (!required.length) return true;

      const pageText = compact(document.body?.innerText || '');
      return required.every(text => pageText.includes(compact(text)));
    }) || null;
  }

  function actionRegex(action) {
    try { return new RegExp(action?.labelRegex || '.*', 'iu'); } catch { return null; }
  }

  function labelText(el) {
    const labels = [];
    if (el?.labels) labels.push(...[...el.labels].map(l => l.innerText));
    const id = el?.id;
    if (id) {
      try {
        const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (explicit) labels.push(explicit.innerText);
      } catch {}
    }
    labels.push(
      el?.getAttribute?.('aria-label'),
      el?.closest?.('label')?.innerText,
      el?.closest?.('fieldset, li, tr, [class*=field], [class*=form], form')?.innerText
    );
    return norm(labels.filter(Boolean).join(' ')).slice(0, 1200);
  }

  function isHiddenChoice(el) {
    if (!el) return false;
    const type = String(el.getAttribute('type') || '').toLowerCase();
    if (type !== 'checkbox' && type !== 'radio') return false;
    const st = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0' || rect.width === 0 || rect.height === 0;
  }

  function isChecked(el) {
    const type = String(el?.getAttribute?.('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return !!el.checked;
    return String(el?.getAttribute?.('aria-checked') || '').toLowerCase() === 'true';
  }

  async function turnOnHiddenChoice(el) {
    if (!el || el.disabled || isChecked(el)) return false;

    try {
      el.click();
      await wait(40);
      if (isChecked(el)) return true;
    } catch {}

    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) {
          label.click();
          await wait(40);
          if (isChecked(el)) return true;
        }
      } catch {}
    }

    try {
      el.checked = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return isChecked(el);
    } catch {
      return false;
    }
  }

  async function applyHiddenCheckAction(action) {
    const rx = actionRegex(action);
    if (!rx) return 0;
    const selector = action?.selector || 'input[type="checkbox"],input[type="radio"]';
    let changed = 0;

    for (const el of document.querySelectorAll(selector)) {
      if (!isHiddenChoice(el) || el.disabled || isChecked(el)) continue;
      const label = labelText(el);
      rx.lastIndex = 0;
      if (!rx.test(label)) continue;
      if (await turnOnHiddenChoice(el)) changed++;
    }
    return changed;
  }

  function selectByText(select, value) {
    const target = compact(value);
    if (!target || !select) return false;
    const option = [...select.options].find(o => {
      const text = compact(o.textContent);
      const val = compact(o.value);
      return text === target || val === target || text.includes(target);
    });
    if (!option) return false;
    const before = select.value;
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return before !== select.value;
  }

  async function applyFixedSelectAction(action) {
    const value = action?.text ?? action?.valueText ?? action?.optionText ?? '';
    if (!value) return 0;
    const rx = actionRegex(action);
    if (!rx) return 0;
    const selector = action?.selector || 'select';
    let changed = 0;

    for (const sel of document.querySelectorAll(selector)) {
      if (sel.tagName !== 'SELECT' || sel.disabled) continue;
      const label = labelText(sel);
      rx.lastIndex = 0;
      if (!rx.test(label)) continue;
      if (selectByText(sel, value)) {
        changed++;
        await wait(Number(action?.delayMs) || 60);
      }
    }
    return changed;
  }

  async function applyEnhancements(actions) {
    for (const action of (actions || [])) {
      if (!action?.type) continue;
      if (action.type === 'checkByLabel') {
        await applyHiddenCheckAction(action);
      } else if (action.type === 'selectTextByLabel') {
        await applyFixedSelectAction(action);
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.rule) return;
    if (msg.type !== 'FILL_FORM' && msg.type !== 'AGREE_TERMS') return;
    const stage = stageForRule(msg.rule);
    if (!stage) return;
    const actions = msg.type === 'FILL_FORM' ? stage.fillActions : stage.agreeActions;
    applyEnhancements(actions).catch(error => {
      console.warn('[LotteryHelper rule enhancer]', error);
    });
  });
})();
