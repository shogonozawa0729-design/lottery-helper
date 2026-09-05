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

  // Google Formsなどで選択肢自体が「はい」だけの場合、
  // その選択肢が属する最小の質問カードまで遡って設問本文を取得する。
  // フォーム全体まで広げないことで、別設問の「はい」を誤って押すのを防ぐ。
  function nearestQuestionText(el) {
    if (!el) return '';

    const own = norm(el.getAttribute?.('aria-label') || el.innerText || '');
    let node = el.parentElement;

    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const text = norm(node.innerText || '');
      if (!text) continue;

      const choiceCount = node.querySelectorAll?.(
        'div[role="checkbox"],div[role="radio"],input[type="checkbox"],input[type="radio"]'
      )?.length || 0;

      // 自分の「はい」だけしか含まないラッパーは飛ばす。
      const hasExtraContext = compact(text) !== compact(own) && text.length > own.length + 2;
      if (!hasExtraContext) continue;

      // 質問カードとして現実的な大きさに限定する。
      // choiceを含み、巨大なフォーム全体ではない最初の祖先を採用する。
      if (choiceCount >= 1 && text.length <= 2200) {
        return text;
      }
    }

    return '';
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
      nearestQuestionText(el),
      el?.closest?.('fieldset, li, tr, [role="listitem"], [class*=field], [class*=form], form')?.innerText
    );
    return norm(labels.filter(Boolean).join(' ')).slice(0, 2200);
  }

  function choiceKind(el) {
    if (!el) return '';
    const type = String(el.getAttribute?.('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return `native-${type}`;

    const role = String(el.getAttribute?.('role') || '').toLowerCase();
    if (role === 'checkbox' || role === 'radio') return `aria-${role}`;
    return '';
  }

  function isDisabledChoice(el) {
    if (!el) return true;
    if (el.disabled) return true;
    return String(el.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true';
  }

  function isHiddenNativeChoice(el) {
    const kind = choiceKind(el);
    if (!kind.startsWith('native-')) return false;
    const st = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return st.display === 'none' || st.visibility === 'hidden' ||
      st.opacity === '0' || rect.width === 0 || rect.height === 0;
  }

  function isChecked(el) {
    const kind = choiceKind(el);
    if (kind.startsWith('native-')) return !!el.checked;
    if (kind.startsWith('aria-')) {
      return String(el.getAttribute?.('aria-checked') || '').toLowerCase() === 'true';
    }
    return false;
  }

  function linkedChoiceIsOn(el) {
    if (!el) return false;
    if (isChecked(el)) return true;

    const containers = [];
    const ownLabel = el.closest?.('label');
    if (ownLabel) containers.push(ownLabel);

    if (el.id) {
      try {
        const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (explicit) containers.push(explicit);
      } catch {}
    }

    const tightContainer = el.closest?.(
      'fieldset, li, tr, [role="listitem"], [class*=field], [class*=item]'
    );
    if (tightContainer) containers.push(tightContainer);

    for (const container of containers) {
      if (container.querySelector?.(
        'input[type="checkbox"]:checked, input[type="radio"]:checked,' +
        ' [role="checkbox"][aria-checked="true"], [role="radio"][aria-checked="true"]'
      )) {
        return true;
      }
    }
    return false;
  }

  function setNativeCheckedTrue(el) {
    if (!el || isDisabledChoice(el) || linkedChoiceIsOn(el)) return false;

    try {
      const proto = Object.getPrototypeOf(el);
      const desc = proto && Object.getOwnPropertyDescriptor(proto, 'checked');
      if (desc?.set) desc.set.call(el, true);
      else el.checked = true;

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return linkedChoiceIsOn(el);
    } catch {
      return false;
    }
  }

  async function turnOnNativeChoice(el) {
    if (!el || isDisabledChoice(el) || linkedChoiceIsOn(el)) return false;

    const changed = setNativeCheckedTrue(el);
    if (!changed) return false;

    await wait(80);
    return linkedChoiceIsOn(el);
  }

  async function turnOnAriaChoice(el) {
    if (!el || isDisabledChoice(el) || linkedChoiceIsOn(el)) return false;
    if (!choiceKind(el).startsWith('aria-')) return false;

    try {
      el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      el.click();
      await wait(120);
      if (linkedChoiceIsOn(el)) return true;

      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await wait(120);
      return linkedChoiceIsOn(el);
    } catch {
      return false;
    }
  }

  async function turnOnChoice(el) {
    const kind = choiceKind(el);
    if (!kind || isDisabledChoice(el) || linkedChoiceIsOn(el)) return false;

    if (kind.startsWith('aria-')) return await turnOnAriaChoice(el);
    if (kind.startsWith('native-')) return await turnOnNativeChoice(el);
    return false;
  }

  async function applyCheckAction(action) {
    const rx = actionRegex(action);
    if (!rx) return 0;

    const selector = action?.selector ||
      'div[role="checkbox"],div[role="radio"],input[type="checkbox"],input[type="radio"]';

    let changed = 0;
    await wait(Number(action?.enhancerDelayMs) || 700);

    for (const el of document.querySelectorAll(selector)) {
      const kind = choiceKind(el);
      if (!kind || isDisabledChoice(el) || linkedChoiceIsOn(el)) continue;

      const label = labelText(el);
      rx.lastIndex = 0;
      if (!rx.test(label)) continue;

      if (kind.startsWith('native-') || kind.startsWith('aria-')) {
        if (await turnOnChoice(el)) changed++;
      }
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
        await applyCheckAction(action);
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

    const actions = msg.type === 'FILL_FORM'
      ? stage.fillActions
      : stage.agreeActions;

    applyEnhancements(actions).catch(error => {
      console.warn('[LotteryHelper rule enhancer]', error);
    });
  });
})();
