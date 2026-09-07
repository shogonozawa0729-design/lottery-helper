(() => {
  const HELPER_VERSION = '0.9.8.2';
  const gateway = globalThis.LATIASSafety;
  if (!gateway) throw new Error('LATIAS Safety Gateway missing');
  if (globalThis.__lotteryHelperCoreVersion && globalThis.__lotteryHelperCoreVersion !== HELPER_VERSION) throw new Error('Reload page to retire previous LATIAS');
  let messageQueue = Promise.resolve();
  if (globalThis.__lotteryHelperCoreVersion === HELPER_VERSION) return;
  globalThis.__lotteryHelperCoreVersion = HELPER_VERSION;
  globalThis.__lotteryHelperLoaded = true;

  function visible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && !el.disabled;
  }

  function exactClickable(text) {
    const target = String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll('a, button, input[type=button], input[type=submit], [role=button]')];
    return nodes.find(el => {
      if (!visible(el)) return false;
      const label = String(el.innerText || el.value || el.getAttribute('aria-label') || '')
        .normalize('NFKC').replace(/\s+/g, ' ').trim();
      return label === target;
    }) || null;
  }

  const adapters = [
    {
      id: 'cloud-pass',
      matches: () => location.hostname === 'cloud-pass.jp',
      fill(profile) {
        if (location.pathname.startsWith('/pr/')) {
          const start = exactClickable('申込画面に進む');
          if (start) return { changed: 0, detail: 'CLOUD PASS: 申込画面への移動は手動です。' };
          return { changed: 0, detail: 'CLOUD PASS: 「申込画面に進む」が見つかりませんでした。' };
        }

        if (location.pathname.startsWith('/tp/ticket/provision/')) {
          return cloudPassFill(profile);
        }

        return { changed: 0, detail: 'CLOUD PASS: この画面には専用処理がありません。' };
      },
      agree() {
        if (location.pathname.startsWith('/tp/ticket/provision/')) {
          return cloudPassAgree();
        }
        const changed = genericAgree();
        return { changed, detail: changed ? `CLOUD PASS: 規約系チェックを${changed}件ONにしました。` : 'CLOUD PASS: 同意対象は見つかりませんでした。' };
      }
    }
  ];

  function setNativeValue(el, value, options = {}) {
    return gateway.setValue(el, value, options);
  }

  function identitySpaceRejected(el) {
    if (!el) return false;
    const current = String(el.value ?? '');
    const compact = current.replace(/[\s　]+/g, '');
    try {
      const pattern = el.getAttribute('pattern');
      if (pattern && current !== compact) {
        const rx = new RegExp('^(?:' + pattern + ')$', 'u');
        if (!rx.test(current) && rx.test(compact)) return true;
      }
    } catch {}
    const error = (el.getAttribute('aria-describedby') || '').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    return /(スペース|空白)/.test(error) && /(入力できません|入力不可|使用できません|使用不可|禁止|入れないで|含めない)/.test(error);
  }

  async function setIdentityValueAdaptive(el, value, options = {}) {
    const target = String(value ?? '').trim();
    if (!target) return false;

    const changed = setNativeValue(el, target, options);
    if (!changed) return false;

    // blur 後にサイト独自のエラー表示が反映されるまで少し待つ。
    await wait(90);

    if (!/[\s　]/.test(target)) return true;
    if (!identitySpaceRejected(el)) return true;

    const compact = target.replace(/[\s　]+/g, '');
    if (!compact || compact === target) return true;

    // 空白が原因で拒否された時だけ、同じ氏名/フリガナを空白なしで再入力する。
    setNativeValue(el, compact, { ...options, identityCorrection: true });
    await wait(40);
    return String(el.value ?? '') === compact;
  }

  function norm(s) {
    return String(s || '')
      .normalize('NFKC')
      .replace(/[\s　:_\-\[\]()（）]/g, '')
      .toLowerCase();
  }

  function kanaToHiragana(value) {
    return String(value || '').replace(/[ァ-ヶ]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }


  function compactIdentityText(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\s　]+/g, '')
      .toLowerCase();
  }

  // 姓・名が両方登録されている場合は、その2項目を正としてフルネームを作る。
  // fullNameExact が古い/片側だけの値でも、フォームへ片側氏名を入れない。
  // ただし fullNameExact 内に姓・名の両方が含まれていれば、本人確認書類どおりの表記を尊重する。
  function canonicalFullName(profile) {
    const last = String(profile?.lastName || '').trim();
    const first = String(profile?.firstName || '').trim();
    const exact = String(profile?.fullNameExact || '').trim();
    const composed = [last, first].filter(Boolean).join(' ').trim();

    if (last && first) {
      if (exact) {
        const exactCompact = compactIdentityText(exact);
        const lastCompact = compactIdentityText(last);
        const firstCompact = compactIdentityText(first);
        const lastFirst = exactCompact.startsWith(lastCompact) && exactCompact.endsWith(firstCompact);
        const firstLast = exactCompact.startsWith(firstCompact) && exactCompact.endsWith(lastCompact);
        if (lastFirst || firstLast) {
          return exact;
        }
      }
      return composed;
    }

    return exact || composed;
  }

  function canonicalFullKana(profile) {
    return [profile?.lastNameKana, profile?.firstNameKana]
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function textAround(el) {
    const parts = [
      el.name,
      el.id,
      el.placeholder,
      el.autocomplete,
      el.getAttribute('aria-label'),
      getLabelText(el),
      el.labels ? [...el.labels].map(l => l.innerText).join(' ') : '',
      el.closest('label')?.innerText,
      el.parentElement?.innerText?.slice(0, 150)
    ];
    return norm(parts.filter(Boolean).join(' '));
  }

  function firstNonEmpty(...vals) {
    return vals.find(v => String(v || '').trim()) || '';
  }

  function birthParts(p) {
    const raw = String(p?.birthDate || '').trim();
    let m = raw.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (!m) m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
    if (!m) m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return { full: raw, slash: raw, compact: raw, japanese: raw, dotted: raw, year: '', month: '', day: '', month2: '', day2: '' };

    const year = m[1];
    const month = String(Number(m[2]));
    const day = String(Number(m[3]));
    const month2 = month.padStart(2, '0');
    const day2 = day.padStart(2, '0');
    return {
      full: `${year}-${month2}-${day2}`,
      slash: `${year}/${month2}/${day2}`,
      dotted: `${year}.${month2}.${day2}`,
      compact: `${year}${month2}${day2}`,
      japanese: `${year}年${month2}月${day2}日`,
      year, month, day, month2, day2
    };
  }

  function birthValueForElement(el, birth) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'date') return birth.full;

    const hint = String([
      el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
      el.getAttribute('pattern'), el.getAttribute('title')
    ].filter(Boolean).join(' '));

    if (/yyyymmdd|\d{8}|8桁/i.test(hint)) return birth.compact || birth.slash;
    if (/yyyy年|年.*月.*日/.test(hint)) return birth.japanese || birth.slash;
    if (/yyyy\.mm\.dd/i.test(hint)) return birth.dotted || birth.slash;
    if (/yyyy-mm-dd/i.test(hint)) return birth.full;
    return birth.slash || birth.full;
  }

  function inferValue(el, p) {
    const t = textAround(el);
    const fullName = canonicalFullName(p);
    const fullKana = canonicalFullKana(p);
    const fullAddress = `${p.prefecture || ''}${p.address1 || ''}${p.address2 || ''}`;
    const birth = birthParts(p);

    if (/(生年月日|誕生日|birthdate|birthday|dateofbirth|dob)/.test(t)) {
      const raw = norm([el.name, el.id, el.placeholder, el.getAttribute('aria-label')].filter(Boolean).join(' '));
      if (/(生年|誕生年|birthyear|yearofbirth|yyyy|year)/.test(raw)) return birth.year;
      if (/(生月|誕生月|birthmonth|monthofbirth|mm|month)/.test(raw)) return birth.month;
      if (/(生日|誕生日の日|birthdayday|dayofbirth|dd|day)/.test(raw)) return birth.day;
      return birthValueForElement(el, birth);
    }
    if (/(生年|誕生年|birthyear|yearofbirth)/.test(t)) return birth.year;
    if (/(生月|誕生月|birthmonth|monthofbirth)/.test(t)) return birth.month;
    if (/(生日|誕生日の日|birthdayday|dayofbirth)/.test(t)) return birth.day;

    if (/(プレイヤーズ|players?).*(名前|なまえ|ネーム|名義|name)/.test(t)) return p.playersName;
    if (/(プレイヤーズid|players?id|playerid)/.test(t)) return p.playersId;
    if (/(twitter|ツイッター|xアカウント|xid|xユーザー|xユーザー名)/.test(t)) return p.twitter;
    if (/(tポイント|tpoint|vポイント|vpoint).*(番号|会員|id)?/.test(t)) return p.tPointNumber;
    if (/(カードラボ|cardlabo).*(番号|会員|id)/.test(t)) return p.cardLaboNumber;
    if (/(トイザらス|といざらす|toysrus).*(番号|会員|id)/.test(t)) return p.toysrusNumber;
    if (/(ノジマ|nojima).*(番号|会員|id)/.test(t)) return p.nojimaNumber;
    if (/(バトロコ|batoloco|batoroco).*(番号|会員|id)/.test(t)) return p.batorocoNumber;
    if (/(晴れる屋|hareruya).*(番号|会員|id)/.test(t)) return p.hareruyaNumber;
    if (/(ふるいち|古本市場|furuichi).*(番号|会員|id)/.test(t)) return p.furuichiNumber;
    if (/(mint).*(番号|会員|id)/.test(t)) return p.mintNumber;
    if (/(^|[^0-9])193([^0-9]|$)/.test(t) && /(番号|会員|id)/.test(t)) return p.shop193Number;
    if (/(ヤマシロヤ|yamashiroya).*(番号|会員|id)/.test(t)) return p.yamashiroyaId;
    if (/(yamashiroya)/.test(location.hostname) && /(会員番号|会員id|memberid|customerid)/.test(t)) return p.yamashiroyaId;
    if (/(トレカプラザ55|torecaplaza55).*(顧客id|顧客番号|会員id|会員番号|番号|id)/.test(t)) return p.trecaPlaza55Id;
    if (/(福福トレカ|ふくふくトレカ).*(ポイントカード|会員).*(10桁|番号|id)/.test(t)) return p.fukufukuNumber;
    if (/(cardbox|card box|カードボックス).*(会員|番号|id)/.test(t)) return p.cardboxNumber;

    if (/(メール|mail|email)/.test(t)) return p.email;
    if (/(電話|tel|phone|携帯)/.test(t)) return p.phone;
    if (/(郵便|postcode|postal|zip)/.test(t)) return p.postalCode;
    if (/(都道府県|prefecture)/.test(t)) return p.prefecture;

    // 分割カナ欄はフルカナ判定より必ず先に処理する。
    // 「姓のフリガナ」「名のフリガナ」「姓（カナ）」「名（カナ）」を明示的に区別する。
    if (/(姓の?(?:フリガナ|ふりがな|カナ)|苗字の?(?:フリガナ|ふりがな|カナ)|名字の?(?:フリガナ|ふりがな|カナ)|(?:フリガナ|ふりがな|カナ).*(?:姓|苗字|名字)|セイ|姓カナ|せい|lastkana|familykana)/.test(t)) return p.lastNameKana;
    if (/(名の?(?:フリガナ|ふりがな|カナ)|メイ|名カナ|めい|firstkana|givenkana)/.test(t) && !/(お名前|氏名|フルネーム)/.test(t)) return p.firstNameKana;
    if (/(フリガナ|ふりがな|カナ|kana)/.test(t)) return fullKana;

    // 姓・名が分かれているフォームでは、英字氏名でも各欄へ片側だけを入れる。
    if (/(姓|苗字|名字|lastname|familyname)/.test(t)) return p.lastName;
    if (/(名|firstname|givenname)/.test(t) && !/(名前|氏名)/.test(t)) return p.firstName;
    if (/(氏名|お名前|名前|fullname)/.test(t)) return fullName;

    if (/(建物|マンション|部屋|address2|streetaddress2)/.test(t)) return p.address2;
    if (/(市区町村|町名|丁目|address1|addresslevel2)/.test(t)) return p.address1;
    if (/(住所|address|street)/.test(t)) return fullAddress;

    const ac = (el.autocomplete || '').toLowerCase();
    if (ac === 'email') return p.email;
    if (ac === 'tel') return p.phone;
    if (ac === 'postal-code') return p.postalCode;
    if (ac === 'family-name') return p.lastName;
    if (ac === 'given-name') return p.firstName;
    if (ac === 'street-address') return firstNonEmpty(fullAddress, p.address1);
    return '';
  }

  function selectByText(select, value, options = {}) {
    if (!select || !value) return false;
    const target = norm(value);
    const matches = [...select.options].filter(o => norm(o.textContent) === target || norm(o.value) === target);
    if (matches.length !== 1) return false;
    const purpose = options.purpose || (/^(はい|同意する|同意します|agree|yes)$/i.test(String(value)) ? 'consent' : 'profile');
    return gateway.setSelect(select, matches[0], { ...options, purpose });
  }

  function selectOption(select, option) {
    const purpose = globalThis.LATIASPolicy.kind(select) === 'quantity' ? 'quantity' : 'profile';
    return gateway.setSelect(select, option, { purpose });
  }

  function selectMaxNumeric(select) {
    if (!select) return false;
    const numeric = [...select.options].filter(o => !o.disabled && !o.parentElement?.disabled && !o.hidden)
      .map(option => ({ option, match: String(option.textContent || '').normalize('NFKC').trim().match(/^(\d+)\s*(?:個|枚|箱|本|口|セット|パック|BOX)?$/i) }))
      .filter(x => x.match).map(x => ({ option: x.option, n: Number(x.match[1]) }));
    numeric.sort((a,b) => b.n - a.n);
    return numeric.length ? gateway.setSelect(select, numeric[0].option, { purpose: 'quantity' }) : false;
  }

  function fieldLabel(el) {
    return cleanText(getLabelText(el) || el.getAttribute('aria-label') || '', 220);
  }

  function cloudPassFill(profile) {
    let changed = 0;
    const notes = [];
    const fullName = canonicalFullName(profile);
    const phone = String(profile.phone || '').replace(/[^0-9]/g, '');

    const additionalSelects = [...document.querySelectorAll('select[id^="additional_field_"]')];
    let quantityCount = 0;
    for (const sel of additionalSelects) {
      const label = fieldLabel(sel);
      const numericOptions = [...sel.options].filter(o => /^\d+$/.test(String(o.textContent || '').trim()));
      const looksQuantity = /(?:数量|BOX選択|個選択|0[～〜-]\d+)/.test(label) && numericOptions.length >= 1;
      if (!looksQuantity) continue;
      if (selectMaxNumeric(sel)) {
        changed++;
        quantityCount++;
      }
    }
    if (quantityCount) notes.push(`商品数量${quantityCount}件を最大に設定`);

    const idSelect = additionalSelects.find(sel => /本人確認書類をご登録|本人確認書類.*持参/.test(fieldLabel(sel)));
    if (idSelect) {
      if (profile.identityDocument) {
        if (selectByText(idSelect, profile.identityDocument)) changed++;
        notes.push(`本人確認書類: ${profile.identityDocument}`);
      } else {
        notes.push('本人確認書類が未設定');
      }
    }

    const controls = [...document.querySelectorAll('input[id^="additional_field_"], select[id^="additional_field_"]')];
    for (const el of controls) {
      const label = fieldLabel(el);
      if (!label) continue;

      if (el.tagName === 'INPUT') {
        if (/^氏名$/.test(label) || /氏名/.test(label)) {
          if (fullName && setNativeValue(el, fullName)) changed++;
          continue;
        }
        if (/住所（市区町村）/.test(label)) {
          if (profile.address1 && setNativeValue(el, profile.address1)) changed++;
          continue;
        }
        if (/住所（番地/.test(label)) {
          if (profile.address2 && setNativeValue(el, profile.address2)) changed++;
          continue;
        }
        if (/電話番号/.test(label)) {
          if (phone && setNativeValue(el, phone)) changed++;
          continue;
        }
      }

      if (el.tagName === 'SELECT' && /住所（都道府県）/.test(label)) {
        if (profile.prefecture && selectByText(el, profile.prefecture)) changed++;
      }
    }

    const dateChosen = !!document.querySelector('input[name="calneder_d"]:checked') || !!document.querySelector('#tag-selector-')?.value;
    notes.push(dateChosen ? '受取日: 手動選択済み' : '受取日: 未選択（手動で選択してください）');
    notes.push('最終「申し込む」は押していません');

    return { changed, detail: `CLOUD PASS: ${notes.join(' / ')}` };
  }

  function cloudPassAgree() {
    let changed = 0;
    const targets = [...document.querySelectorAll('select[id^="additional_field_"]')];
    for (const sel of targets) {
      const texts = [...sel.options].map(o => String(o.textContent || '').trim());
      let positive = null;
      if (texts.includes('はい') && texts.includes('いいえ')) positive = 'はい';
      if (texts.includes('同意する') && texts.includes('同意しない')) positive = '同意する';
      if (!positive) continue;
      changed += selectByText(sel, positive) ? 1 : 0;
    }



    return {
      changed,
      detail: `CLOUD PASS: 「はい／同意する」を${changed}件選択しました。最終申込ボタンは押していません。`
    };
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function actionRegex(action) {
    try { return new RegExp(action?.labelRegex || '', 'iu'); } catch { return null; }
  }

  function relevantControlsInside(node) {
    if (!node?.querySelectorAll) return [];
    return [...node.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="password"]), textarea, select, [role="checkbox"], [role="radio"]'
    )].filter(el => !el.disabled);
  }

  function previousBoundedText(el) {
    try {
      const controls = [...document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="password"]), textarea, select, [role="checkbox"], [role="radio"]'
      )].filter(node => !node.disabled);
      const index = controls.indexOf(el);
      if (index < 0) return '';
      const previous = index > 0 ? controls[index - 1] : null;
      const range = document.createRange();
      if (previous) range.setStartAfter(previous);
      else range.setStart(document.body, 0);
      range.setEndBefore(el);
      return cleanText(range.toString(), 1500);
    } catch {
      return '';
    }
  }

  function questionContext(el) {
    if (!el) return '';
    const direct = cleanText([
      getLabelText(el),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('title')
    ].filter(Boolean).join(' '), 600);

    const preferred = el.closest?.(
      '[role="listitem"], .Qr7Oae, .geS5n, .freebirdFormviewerViewItemsItemItem, fieldset, li, tr, dl, [class*="question"], [class*="form-group"], [class*="form_item"], [class*="field"]'
    );
    if (preferred) {
      const text = cleanText(preferred.innerText || preferred.textContent || '', 1800);
      const controls = relevantControlsInside(preferred);
      if (text && controls.includes(el) && controls.length <= 5) return text;
    }

    let node = el.parentElement;
    for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) {
      const text = cleanText(node.innerText || node.textContent || '', 1800);
      if (!text || text.length > 1800) continue;
      const controls = relevantControlsInside(node);
      if (controls.includes(el) && controls.length >= 1 && controls.length <= 4) {
        if (text.length > direct.length + 2) return text;
      }
    }

    const bounded = previousBoundedText(el);
    if (bounded) return bounded;
    return direct;
  }

  function controlLabelForRule(el) {
    const direct = fieldLabel(el);
    const context = questionContext(el);
    return cleanText([direct, context].filter(Boolean).join(' '), 1800);
  }

  function findRuleControls(action, tagName) {
    const rx = actionRegex(action);
    if (!rx) return [];
    const selector = action?.selector || (tagName === 'select'
      ? 'select[id^="additional_field_"], select'
      : 'input[id^="additional_field_"], textarea[id^="additional_field_"], input, textarea');
    return [...document.querySelectorAll(selector)].filter(el => {
      if (tagName && el.tagName.toLowerCase() !== tagName) return false;
      return rx.test(controlLabelForRule(el));
    });
  }

  function profileValue(profile, action) {
    const key = action?.profileKey || '';
    let value = '';
    if (key === '__fullNameExact') {
      value = canonicalFullName(profile);
    } else if (key === '__fullKana' || key === '__fullKanaHiragana') {
      value = canonicalFullKana(profile);
      if (key === '__fullKanaHiragana') value = kanaToHiragana(value);
    } else if (key === '__fullAddress') {
      value = `${profile.prefecture || ''}${profile.address1 || ''}${profile.address2 || ''}`;
    } else if (key === '__birthDateCompact') {
      value = birthParts(profile || {}).compact;
    } else if (key === '__birthDate' || key === '__birthDateSlash' || key === '__birthYear' || key === '__birthMonth' || key === '__birthDay') {
      const b = birthParts(profile || {});
      if (key === '__birthDate') value = b.full;
      if (key === '__birthDateSlash') value = b.slash || b.full;
      if (key === '__birthYear') value = b.year;
      if (key === '__birthMonth') value = b.month;
      if (key === '__birthDay') value = b.day;
    } else {
      value = profile?.[key] ?? '';
    }
    if (action?.transform === 'digits') value = String(value || '').replace(/[^0-9]/g, '');
    if (action?.transform === 'hiragana') value = kanaToHiragana(String(value || ''));
    if (action?.transform === 'trim' || action?.transform === 'hiragana') value = String(value || '').trim();
    return value;
  }

  function selectedText(select) {
    return String(select?.selectedOptions?.[0]?.textContent || '').trim();
  }

  function stageForRule(rule) {
    if (!rule || !Array.isArray(rule.stages)) return null;
    return rule.stages.find(stage => {
      const paths = stage?.paths || [];
      const pathMatched = paths.some(p => {
        if (p.prefix && location.pathname.startsWith(p.prefix)) return true;
        if (p.exact && location.pathname === p.exact) return true;
        if (p.regex) {
          try { return new RegExp(p.regex).test(location.pathname); } catch { return false; }
        }
        return false;
      });

      if (!pathMatched) return false;

      const required = Array.isArray(stage?.requiredText)
        ? stage.requiredText
        : (stage?.requiredText ? [stage.requiredText] : []);

      if (required.length) {
        const pageText = norm(document.body?.innerText || '');
        if (!required.every(text => pageText.includes(norm(text)))) return false;
      }

      return true;
    }) || null;
  }

  function markFinalButtons() { /* No DOM marking: the Gateway rejects operations structurally. */ }

  function remotePlan(rule, phase) {
    if (!rule || rule.schemaVersion !== 2 || !Array.isArray(rule.match?.hosts) || !rule.match.hosts.includes(location.hostname)) return [];
    if (rule.match.pathPrefixes?.length && !rule.match.pathPrefixes.some(p => location.pathname.startsWith(p))) return [];
    const stage = stageForRule(rule);
    if (!stage) return [];
    // Remote actions become data only. No selector is resolved and no DOM is changed here.
    return globalThis.LATIASRuleCandidates.compile(stage[phase] || []);
  }

  function remoteRuleFill(rule) { return remotePlan(rule, 'fillActions'); }
  function remoteRuleAgree(rule) { return remotePlan(rule, 'agreeActions'); }

  async function executeCandidates(candidates, profile) {
    let changed = 0;
    for (const candidate of candidates) {
      if (candidate.kind === 'blocked') { gateway.reject('remote-operation-forbidden'); continue; }
      let nodes, rx;
      try {
        nodes = [...document.querySelectorAll(candidate.selector)].slice(0, 250);
        rx = new RegExp(candidate.labelRegex, 'iu');
      } catch { gateway.reject('invalid-remote-selector-or-regex'); continue; }
      for (const el of nodes) {
        if (!rx.test(controlLabelForRule(el))) continue;
        if (candidate.kind === 'profile') {
          const value = profileValue(profile, candidate);
          if (candidate.select) {
            if (el.tagName === 'SELECT' && selectByText(el, value, { purpose: 'profile', profileKey: candidate.profileKey })) changed++;
          } else {
            const options = { profileKey: candidate.profileKey };
            const adaptive = ['__fullNameExact','__fullKana','__fullKanaHiragana'].includes(candidate.profileKey);
            if (adaptive ? await setIdentityValueAdaptive(el, value, options) : setNativeValue(el, value, options)) changed++;
          }
        } else if (candidate.kind === 'quantity') {
          if (el.tagName === 'SELECT' && selectMaxNumeric(el)) changed++;
        } else if (candidate.kind === 'consent') {
          if (await clickRuleChoice(el)) changed++;
        } else if (candidate.kind === 'product') {
          if (gateway.ensureProduct(el)) changed++;
        } else if (candidate.kind === 'consent-select') {
          if (el.tagName !== 'SELECT') { gateway.reject('invalid-consent-select'); continue; }
          const texts = [...el.options].map(o => o.textContent.trim());
          for (const pair of candidate.pairs) {
            if (texts.includes(pair[0]) && texts.includes(pair[1])) {
              if (selectByText(el, pair[0], { purpose: 'consent' })) changed++;
              break;
            }
          }
        }
      }
    }
    return { changed, detail: 'Safety Gateway: ' + changed + '件反映' };
  }

  function isLotteryLikePage() {
    const text = norm([
      document.title,
      location.pathname,
      location.search,
      document.body?.innerText?.slice(0, 1500)
    ].filter(Boolean).join(' '));
    return /(抽選|応募|予約販売|lottery|raffle|entry|application)/.test(text);
  }

  function isRuleChoiceChecked(el) {
    return el?.tagName === 'INPUT' ? !!el.checked : el?.getAttribute('aria-checked') === 'true';
  }
  async function clickRuleChoice(el) { return el?.tagName === 'INPUT' ? gateway.ensureConsent(el) : gateway.ensureGoogleConsent(el); }

  function checkboxLikeElements(root = document) {
    return [...root.querySelectorAll('input[type=checkbox], [role=checkbox]')];
  }

  function isCheckedLike(el) {
    if (!el) return false;
    if (el.matches('input[type=checkbox]')) return !!el.checked;
    return String(el.getAttribute('aria-checked') || '').toLowerCase() === 'true';
  }

  function clickCheckboxLike(el) { return gateway.ensureConsent(el); }

  function choiceContext(el) {
    const group = el.closest('[role=listitem], .Qr7Oae, .geS5n, .freebirdFormviewerViewItemsItemItem, fieldset, li, tr, form');
    return cleanText([
      getLabelText(el),
      el.getAttribute('aria-label'),
      el.closest('label')?.innerText,
      group?.innerText
    ].filter(Boolean).join(' '), 700);
  }

  function extraKeywordMatch(text, keywords) {
    const t = norm(text);
    return (Array.isArray(keywords) ? keywords : []).some(k => {
      const nk = norm(k);
      return nk && t.includes(nk);
    });
  }

  function looksLikeProductChoice(el, genericConfig = {}) {
    const context = choiceContext(el);
    const t = norm(context);
    if (!t) return false;
    if (looksLikeAgreement(el, genericConfig)) return false;
    if (/(商品|希望商品|応募商品|購入希望|希望する商品|商品選択|box|ボックス|デッキセット|パック|セット|￥|¥|\d[\d,]*円)/.test(t)) return true;
    return extraKeywordMatch(context, genericConfig.productKeywords);
  }

  function genericSelectProducts(genericConfig = {}) {
    if (!isLotteryLikePage()) return 0;
    let changed = 0;
    for (const el of checkboxLikeElements()) {
      if (!looksLikeProductChoice(el, genericConfig)) continue;
      if (isCheckedLike(el)) continue;
      if (gateway.ensureProduct(el)) changed++;
    }
    return changed;
  }

  function looksLikeQuantityControl(el) {
    const t = norm([textAround(el), fieldLabel(el), el.closest('[role=listitem], fieldset, li, tr, div')?.innerText?.slice(0, 260)].filter(Boolean).join(' '));
    return /(数量|個数|購入数|希望数|box数|ボックス数|セット数|パック数)/.test(t);
  }

  function genericMaxQuantities() {
    if (!isLotteryLikePage()) return 0;
    let changed = 0;

    for (const sel of document.querySelectorAll('select')) {
      if (!looksLikeQuantityControl(sel)) continue;
      if (selectMaxNumeric(sel)) changed++;
    }

    for (const input of document.querySelectorAll('input[type=number]')) {
      if (input.disabled || input.readOnly || !looksLikeQuantityControl(input)) continue;
      const max = input.getAttribute('max')?.trim() ? Number(input.max) : NaN;
      if (!Number.isFinite(max)) continue;
      if (setNativeValue(input, String(max), { purpose: 'quantity' })) changed++;
    }
    return changed;
  }

  function genericFill(profile, genericConfig = {}) {
    let changed = 0;
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select')];
    for (const el of fields) {
      if (el.disabled || el.readOnly) continue;
      const value = inferValue(el, profile);
      if (!value) continue;
      if (el.tagName === 'SELECT') changed += selectByText(el, value) ? 1 : 0;
      else changed += setNativeValue(el, value) ? 1 : 0;
    }

    changed += genericSelectProducts(genericConfig);
    changed += genericMaxQuantities();
    return changed;
  }

  function looksLikeFinalSubmit(el) {
    const text = norm([el.innerText, el.value, el.name, el.id, el.getAttribute('aria-label')].filter(Boolean).join(' '));
    return /(応募する|申込む|申し込む|送信|確定|購入|注文|submit|entry|apply)/.test(text);
  }

  function looksLikeAgreement(el, genericConfig = {}) {
    const context = [
      el.name,
      el.id,
      el.value,
      el.getAttribute('aria-label'),
      getLabelText(el),
      el.labels ? [...el.labels].map(l => l.innerText).join(' ') : '',
      el.closest('label')?.innerText,
      choiceContext(el),
      el.parentElement?.innerText?.slice(0, 240)
    ].filter(Boolean).join(' ');
    const t = norm(context);
    if (/(規約|利用規約|注意事項|個人情報|プライバシー|同意|了承|承諾|確認しました|agree|terms|privacy)/.test(t)) return true;
    return extraKeywordMatch(context, genericConfig.agreementKeywords);
  }

  function genericAgree(genericConfig = {}) {
    let changed = 0;
    for (const el of checkboxLikeElements()) {
      if (isCheckedLike(el) || !looksLikeAgreement(el, genericConfig)) continue;
      if (clickCheckboxLike(el)) changed++;
    }

    return changed;
  }

  function isCustomFormPage() {
    return location.hostname === 'customform.jp' && location.pathname.startsWith('/form/input/');
  }

  function fullProfileName(profile) {
    return canonicalFullName(profile);
  }

  function fullProfileKana(profile) {
    return canonicalFullKana(profile);
  }

  function fullProfileAddress(profile) {
    return `${profile?.prefecture || ''}${profile?.address1 || ''}${profile?.address2 || ''}`.trim();
  }

  function classifyCustomFieldText(text) {
    text = cleanText(text, 1800);
    if (!text) return '';
    if (/(ふりがな|フリガナ|ひらがな)/.test(text) && /(お名前|氏名|本名)/.test(text)) return 'kana';
    if (/(メールアドレス|e-?mail|email)/i.test(text)) return 'email';
    if (/(生年月日|誕生日|生まれた日)/.test(text)) return 'birthDate';
    if (/(ご住所|住所|現住所)/.test(text)) return 'address';
    if (/(電話番号|携帯番号|携帯電話|TEL)/i.test(text)) return 'phone';
    if (/(プレイヤーズクラブ|トレーナーズウェブサイト).*ID|プレイヤー.?ID/.test(text)) return 'playersId';
    if (/プレイヤー.?ネーム|プレイヤーズネーム/.test(text)) return 'playersName';
    if (/X\(旧Twitter\).*アカウント|X\(旧Twitter\).*ID|Twitter.*アカウント|Twitter.*ID/i.test(text)) return 'twitter';
    if (/(お名前|氏名|本名)/.test(text) && !/(ふりがな|フリガナ|ひらがな)/.test(text)) return 'name';
    return '';
  }

  function customFieldKind(el) {
    const direct = cleanText([
      getLabelText(el),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('title')
    ].filter(Boolean).join(' '), 600);
    // CustomFormは「直前のフォーム部品→この入力欄」の区間を最優先する。
    // これで隣の設問の電話番号などを誤って氏名欄へ入れない。
    for (const text of [direct, previousBoundedText(el), questionContext(el)]) {
      const kind = classifyCustomFieldText(text);
      if (kind) return kind;
    }
    return '';
  }

  function profileValueForCustom(kind, profile, el) {
    const birth = birthParts(profile || {});
    if (kind === 'name') return fullProfileName(profile);
    if (kind === 'kana') return kanaToHiragana(fullProfileKana(profile));
    if (kind === 'address') return fullProfileAddress(profile);
    if (kind === 'email') return String(profile?.email || '').trim();
    if (kind === 'phone') return String(profile?.phone || '').replace(/[^0-9]/g, '');
    if (kind === 'playersId') return String(profile?.playersId || '').replace(/[^0-9]/g, '');
    if (kind === 'playersName') return String(profile?.playersName || '').trim();
    if (kind === 'twitter') return String(profile?.twitter || '').trim();
    if (kind === 'birthDate') return birthValueForElement(el, birth);
    return '';
  }

  function selectBirthPart(select, birth) {
    if (!select || select.disabled) return false;
    const selectedLabel = cleanText(select.selectedOptions?.[0]?.textContent || '', 80);
    if (String(select.value || '').trim() && !/(選択|未選択|--|年|月|日)/.test(selectedLabel)) return false;
    const text = cleanText(questionContext(select), 1200);
    const own = norm([select.name, select.id, select.getAttribute('aria-label'), select.getAttribute('title')].filter(Boolean).join(' '));
    const options = [...select.options].map(o => ({ o, raw: cleanText(o.textContent || o.value || '', 50), n: Number(String(o.value || o.textContent || '').replace(/[^0-9]/g, '')) })).filter(x => Number.isFinite(x.n));
    if (!options.length) return false;
    let target = '';
    if (/(年|year|yyyy)/i.test(own) || options.some(x => x.n >= 1900)) target = birth.year;
    else if (/(月|month|mm)/i.test(own) || (Math.max(...options.map(x => x.n)) <= 12 && /生年月日/.test(text))) target = birth.month;
    else if (/(日|day|dd)/i.test(own) || /生年月日/.test(text)) target = birth.day;
    if (!target) return false;
    const n = Number(target);
    const option = options.find(x => x.n === n);
    return option ? selectOption(select, option.o) : false;
  }

  async function customFormFill(profile) {
    if (!isCustomFormPage()) return { changed: 0, details: [] };
    let changed = 0;
    const details = [];
    const birth = birthParts(profile || {});
    const fields = [...document.querySelectorAll(
      'textarea, select, input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="password"])'
    )].filter(el => !el.disabled);

    for (const el of fields) {
      const kind = customFieldKind(el);
      if (!kind) continue;

      // 店舗選択は常に手動。質問文に店舗が含まれるselectには触れない。
      if (el.tagName === 'SELECT' && /(店舗|応募店|購入店)/.test(questionContext(el))) continue;

      if (kind === 'birthDate' && el.tagName === 'SELECT') {
        if (selectBirthPart(el, birth)) {
          changed++;
          details.push('birthDate');
        }
        continue;
      }

      if (el.tagName === 'SELECT') continue;
      const value = profileValueForCustom(kind, profile, el);
      if (!value) continue;
      const didChange = (kind === 'name' || kind === 'kana')
        ? await setIdentityValueAdaptive(el, value, { allowReadOnly: kind === 'birthDate' })
        : setNativeValue(el, value, { allowReadOnly: kind === 'birthDate' });
      if (didChange) {
        changed++;
        details.push(kind);
      }
    }

    markFinalButtons({ safety: { neverClickTexts: ['確認', '送信', '申し込む', '応募する', '確定', '購入する'] } });
    return { changed, details };
  }

  function ownChoiceText(el) {
    return cleanText([
      el?.getAttribute?.('aria-label'),
      el?.value,
      getLabelText(el),
      el?.closest?.('label')?.innerText
    ].filter(Boolean).join(' '), 500);
  }

  function nativeChoiceOn(el) {
    return !!el?.checked;
  }

  function setNativeChoiceTrue(el) { return gateway.ensureConsent(el); }

  function customFormAgree() {
    if (!isCustomFormPage()) return { changed: 0, on: 0, total: 0 };
    const negative = /(同意しない|承諾しない|了承しない|希望しない|応募しない|購入しない|不要|キャンセル|受け取らない|受取らない)/i;
    let changed = 0;
    let total = 0;

    for (const el of document.querySelectorAll('input[type="checkbox"]')) {
      if (el.disabled) continue;
      const own = ownChoiceText(el);
      if (negative.test(own)) continue;
      total++;
      if (!el.checked && setNativeChoiceTrue(el)) changed++;
    }

    const radios = [...document.querySelectorAll('input[type="radio"]')].filter(el => !el.disabled);
    for (const el of radios) {
      if (el.checked) continue;
      const own = ownChoiceText(el);
      if (negative.test(own)) continue;
      const context = cleanText(questionContext(el), 1600);
      const positiveOwn = /(同意しました|同意します|了承しました|了承します|承諾しました|承諾します|確認しました|間違いありません|保存しました|はい)/i.test(own);
      const consentQuestion = /(同意|了承|承諾|確認|注意事項|個人情報|本人確認|応募店舗を保存|間違いはありません)/i.test(context);
      if (!positiveOwn || !consentQuestion) continue;
      total++;
      if (setNativeChoiceTrue(el)) changed++;
    }

    const on = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')]
      .filter(el => !el.disabled && el.checked).length;
    markFinalButtons({ safety: { neverClickTexts: ['確認', '送信', '申し込む', '応募する', '確定', '購入する'] } });
    return { changed, on, total };
  }

  function isGoogleFormsPage() {
    return location.hostname === 'docs.google.com' && location.pathname.startsWith('/forms/');
  }

  function isTorecaPlaza55OrLotteryGoogleForm() {
    if (!isGoogleFormsPage()) return false;
    const pageText = cleanText(document.body?.innerText || '', 5000);
    return /トレカプラザ55|抽選|応募|予約販売/.test(pageText) ||
      /抽選|応募|予約販売/.test(document.title || '');
  }

  async function ensureGoogleFormsEmailRecording() {
    if (!isGoogleFormsPage()) return 0;
    let changed = 0;
    for (const el of document.querySelectorAll('[role="checkbox"]')) {
      if (await gateway.ensureGoogleEmailRecording(el)) changed++;
    }
    return changed;
  }

  async function forceGoogleFormsRequiredChecks() {
    if (!isGoogleFormsPage()) return 0;
    const negative = /(同意しない|承諾しない|了承しない|希望しない|応募しない|購入しない|不要|キャンセル|受け取らない|受取らない)/i;
    let changed = 0;

    for (const el of document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')) {
      if (el.disabled || String(el.getAttribute('aria-disabled') || '').toLowerCase() === 'true') continue;
      if (isCheckedLike(el)) continue;
      // 否定判定は「選択肢自身」の文言だけを見る。設問説明内の否定文で誤除外しない。
      const own = ownChoiceText(el);
      if (negative.test(own)) continue;
      if (await clickRuleChoice(el)) changed++;
    }

    return changed;
  }

  async function forceGoogleFormsPositiveRadios() {
    if (!isGoogleFormsPage()) return 0;
    const negative = /(同意しない|承諾しない|了承しない|希望しない|応募しない|購入しない|不要|キャンセル|受け取らない|受取らない|いいえ)/i;
    let changed = 0;
    for (const el of document.querySelectorAll('input[type="radio"], [role="radio"]')) {
      if (el.disabled || String(el.getAttribute('aria-disabled') || '').toLowerCase() === 'true' || isRuleChoiceChecked(el)) continue;
      const own = ownChoiceText(el);
      if (!own || negative.test(own)) continue;
      const context = cleanText(questionContext(el), 1800);
      const positiveOwn = /(同意します|同意しました|了承します|了承しました|承諾します|承諾しました|確認しました|はい(?:\s|$|\(|（))/i.test(own);
      const safeQuestion = /(規約|同意|了承|承諾|確認|注意事項|個人情報|登録していますか|本人確認)/i.test(context);
      if (!positiveOwn || !safeQuestion) continue;
      if (await clickRuleChoice(el)) changed++;
    }
    return changed;
  }

  async function googleFormsPreFill(genericConfig = {}) {
    if (!isGoogleFormsPage()) return 0;

    let changed = 0;
    for (let pass = 0; pass < 2; pass++) {
      changed += await forceGoogleFormsRequiredChecks();
      changed += await ensureGoogleFormsEmailRecording();
      changed += await forceGoogleFormsPositiveRadios();
      if (pass < 1) await wait(120);
    }
    return changed;
  }

  function getAdapter() {
    return adapters.find(a => {
      try { return a.matches(); } catch { return false; }
    }) || null;
  }

  function cleanText(s, max = 220) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function getLabelText(el) {
    const byLabels = el.labels ? [...el.labels].map(l => cleanText(l.innerText, 140)).filter(Boolean) : [];
    if (byLabels.length) return byLabels.join(' / ');
    const wrapped = el.closest('label');
    if (wrapped) return cleanText(wrapped.innerText, 140);
    const aria = el.getAttribute('aria-labelledby');
    if (aria) {
      const txt = aria.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').filter(Boolean).join(' ');
      if (txt) return cleanText(txt, 140);
    }
    return '';
  }

  function safeSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const tag = el.tagName.toLowerCase();
    if (el.name) return `${tag}[name="${CSS.escape(el.name)}"]`;
    const aria = el.getAttribute('aria-label');
    if (aria) return `${tag}[aria-label="${CSS.escape(aria)}"]`;
    const type = el.getAttribute('type');
    if (type) {
      const siblings = [...document.querySelectorAll(`${tag}[type="${CSS.escape(type)}"]`)];
      const idx = siblings.indexOf(el);
      if (idx >= 0) return `${tag}[type="${CSS.escape(type)}"]:nth-of-type(${idx + 1})`;
    }
    return tag;
  }

  function inspectForm() {
    const controlNodes = [...document.querySelectorAll('input, textarea, select, button, a, [role=button], [role=checkbox], [role=radio]')]
      .filter(el => {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'password') return false;
        if (type === 'hidden') return false;
        return true;
      });

    const controls = controlNodes.slice(0, 250).map((el, index) => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      const item = {
        index,
        tag: el.tagName.toLowerCase(),
        type: type || null,
        role: el.getAttribute('role') || null,
        selector: safeSelector(el),
        name: el.getAttribute('name') || null,
        id: el.id || null,
        autocomplete: el.getAttribute('autocomplete') || null,
        placeholder: cleanText(el.getAttribute('placeholder'), 120) || null,
        ariaLabel: cleanText(el.getAttribute('aria-label'), 120) || null,
        label: getLabelText(el) || null,
        questionContext: cleanText(questionContext(el), 320) || null,
        required: !!el.required,
        disabled: !!el.disabled,
        readOnly: !!el.readOnly,
      };
      if (el.tagName === 'SELECT') {
        item.options = [...el.options].slice(0, 80).map(o => ({
          text: cleanText(o.textContent, 100),
          value: cleanText(o.value, 100)
        }));
      }
      if (type === 'radio' || type === 'checkbox' || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox') {
        item.checked = type === 'checkbox' || type === 'radio'
          ? !!el.checked
          : (el.getAttribute('aria-checked') === 'true');
        item.valueToken = cleanText(el.getAttribute('value'), 100) || null;
      }
      if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button' || type === 'submit' || type === 'button') {
        item.buttonText = cleanText(el.innerText || el.value || el.getAttribute('aria-label'), 140) || null;
        if (el.tagName === 'A') item.hrefPath = (() => {
          try {
            const u = new URL(el.href, location.href);
            return `${u.origin}${u.pathname}${u.search}`;
          } catch {
            return null;
          }
        })();
      }
      return item;
    });

    const forms = [...document.forms].slice(0, 30).map((form, index) => ({
      index,
      id: form.id || null,
      name: form.getAttribute('name') || null,
      method: (form.getAttribute('method') || 'get').toLowerCase(),
      actionPath: (() => {
        try {
          const u = new URL(form.action || location.href, location.href);
          return `${u.origin}${u.pathname}`;
        } catch {
          return null;
        }
      })()
    }));

    return {
      helperVersion: HELPER_VERSION,
      page: {
        origin: location.origin,
        pathname: location.pathname,
        title: document.title
      },
      forms,
      controls,
      note: '入力値・パスワード・Cookie・localStorage・sessionStorageは収集していません。'
    };
  }

  // Page-load auto operations are disabled: every mutation requires a queued user run.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id || sender?.tab) return false;
    const run = async () => {
      const mutating = msg?.type === 'FILL_FORM' || msg?.type === 'AGREE_TERMS';
      if (mutating) gateway.begin();
      let response;
      try { response = await (async () => {
      try {
        if (msg?.type === 'PING') {
          return { ok: true, helperVersion: HELPER_VERSION };
        }

        if (msg?.type === 'FILL_FORM') {
          const productChanged = genericSelectProducts(msg.genericConfig || {});
          // CustomFormのプロフィールは専用経路。商品は上の共通product policyで判定済み。
          if (isCustomFormPage()) {
            const result = await customFormFill(msg.profile || {});
            return {
              ok: true,
              changed: productChanged + (result.changed || 0),
              detail: `CustomForm本体: ${result.details?.length ? result.details.join(', ') : '変更なし'} / 店舗選択・最終送信は手動`,
              adapter: 'customform-core'
            };
          }

          let preChanged = productChanged;

          if (isGoogleFormsPage()) {
            preChanged += await googleFormsPreFill(msg.genericConfig || {});
          }

          if (msg.rule) {
            const result = await executeCandidates(remoteRuleFill(msg.rule), msg.profile || {});
            const totalChanged = preChanged + (result.changed || 0);
            const prefix = preChanged ? `共通の安全操作 ${preChanged}件 / ` : '';
            return {
              ok: true,
              changed: totalChanged,
              detail: prefix + (result.detail || ''),
              adapter: `remote:${msg.rule.id || 'rule'}`
            };
          }

          const adapter = getAdapter();
          const result = adapter?.fill
            ? adapter.fill(msg.profile)
            : genericFill(msg.profile, msg.genericConfig || {});

          const changed = preChanged + (
            typeof result === 'number'
              ? result
              : (result?.changed || 0)
          );

          const detail = typeof result === 'object' ? (result?.detail || '') : '';
          return {
            ok: true,
            changed,
            detail,
            adapter: adapter?.id || 'generic'
          };
        }

        if (msg?.type === 'AGREE_TERMS') {
          if (isCustomFormPage()) {
            const result = customFormAgree();
            return {
              ok: true,
              changed: result.changed || 0,
              detail: `CustomForm本体: 同意 ${result.changed || 0}件ON / 店舗選択・最終送信は手動`,
              adapter: 'customform-core'
            };
          }

          if (isGoogleFormsPage()) {
            const changed = await forceGoogleFormsRequiredChecks() + await forceGoogleFormsPositiveRadios() + await ensureGoogleFormsEmailRecording();
            markFinalButtons(msg.rule || {});
            return {
              ok: true,
              changed,
              detail: `Google Forms本体: checkbox/肯定同意 ${changed}件ON / ON済みは触らない`,
              adapter: 'google-forms-core'
            };
          }

          if (msg.rule) {
            const result = await executeCandidates(remoteRuleAgree(msg.rule), {});
            return {
              ok: true,
              changed: result.changed || 0,
              detail: result.detail || '',
              adapter: `remote:${msg.rule.id || 'rule'}`
            };
          }

          const adapter = getAdapter();
          const result = adapter?.agree
            ? adapter.agree()
            : genericAgree(msg.genericConfig || {});

          const changed = typeof result === 'number'
            ? result
            : (result?.changed || 0);

          const detail = typeof result === 'object'
            ? (result?.detail || '')
            : '';

          return {
            ok: true,
            changed,
            detail,
            adapter: adapter?.id || 'generic'
          };
        }

        if (msg?.type === 'INSPECT_FORM') {
          return { ok: true, data: inspectForm() };
        }

        return { ok: false, reason: 'unknown message' };
      } catch (e) {
        return { ok: false, reason: e.message || String(e) };
      }
      })(); }
      finally {
        if (mutating) {
          const rejected = gateway.end();
          if (response) {
            response.rejected = rejected;
            const count = Object.values(rejected).reduce((a,b) => a+b,0);
            if (count) response.detail = (response.detail || '') + ' / 手動・安全除外 ' + count + '件';
          }
        }
      }
      return response;
    };
    messageQueue = messageQueue.then(run, run);
    messageQueue.then(sendResponse, () => sendResponse({ ok: false, reason: 'LATIAS run failed' }));

    return true;
  });
})();
