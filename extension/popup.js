const statusEl = document.getElementById('status');
const memberEl = document.getElementById('member');
const ruleStatusEl = document.getElementById('ruleStatus');

const RULE_BASE = 'https://raw.githubusercontent.com/shogonozawa0729-design/lottery-helper/main/';
const RULE_CACHE_KEY = 'remoteRuleBundleV2';

function setStatus(text) {
  statusEl.textContent = text;
}

async function getProfile() {
  const { profile } = await chrome.storage.local.get('profile');
  return profile || null;
}

async function renderProfile() {
  const p = await getProfile();
  if (!p) {
    memberEl.textContent = 'メンバー未設定';
    return;
  }
  memberEl.textContent = `${p.lastName || ''} ${p.firstName || ''} / ${p.email || ''}`;
}

function parseUrls(text) {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) || [];
  return [...new Set(matches.map(u => u.replace(/[),.;]+$/g, '')))];
}

async function queryWebTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.filter(t => t.id && /^https?:\/\//.test(t.url || ''));
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) {
      return { ok: false, reason: e2.message || String(e2) };
    }
  }
}

async function fetchJson(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${RULE_BASE}${path}${sep}_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return await res.json();
}

async function syncRemoteRules() {
  try {
    const index = await fetchJson('rules/index.json');
    const rules = [];
    for (const adapter of (index.adapters || [])) {
      if (!adapter.enabled || !adapter.file) continue;
      rules.push(await fetchJson(adapter.file));
    }
    const bundle = {
      fetchedAt: Date.now(),
      rulesVersion: index.rulesVersion || '',
      genericConfig: index.generic || {},
      rules
    };
    await chrome.storage.local.set({ [RULE_CACHE_KEY]: bundle });
    ruleStatusEl.textContent = `共通ルール: GitHub ${bundle.rulesVersion || '最新版'}`;
    return bundle;
  } catch (e) {
    const cached = (await chrome.storage.local.get(RULE_CACHE_KEY))[RULE_CACHE_KEY];
    if (cached?.rules?.length) {
      ruleStatusEl.textContent = `共通ルール: キャッシュ ${cached.rulesVersion || ''}`;
      return cached;
    }
    ruleStatusEl.textContent = '共通ルール: GitHub取得失敗（内蔵ルールで動作）';
    return { fetchedAt: 0, rulesVersion: '', genericConfig: {}, rules: [] };
  }
}

function ruleMatchesUrl(rule, u) {
  const match = rule?.match || {};
  const hosts = Array.isArray(match.hosts) ? match.hosts : [];
  if (hosts.length && !hosts.includes(u.hostname)) return false;

  const prefixes = Array.isArray(match.pathPrefixes) ? match.pathPrefixes : [];
  if (prefixes.length && !prefixes.some(prefix => u.pathname.startsWith(prefix))) return false;

  return true;
}

function rulesForUrl(bundle, urlText) {
  try {
    const u = new URL(urlText);
    return (bundle?.rules || []).filter(rule => ruleMatchesUrl(rule, u));
  } catch {
    return [];
  }
}

async function currentRules() {
  return await syncRemoteRules();
}

async function applyMessageAcrossRules(tabId, type, profile, rules, genericConfig) {
  const ruleList = rules.length ? rules : [null];
  let changed = 0;
  let anyOk = false;
  const details = [];
  let lastReason = '';

  for (const rule of ruleList) {
    const res = await sendToTab(tabId, {
      type,
      profile,
      rule,
      genericConfig: genericConfig || {}
    });

    if (res?.ok) {
      anyOk = true;
      changed += Number(res.changed || 0);
      if (res.detail) details.push(res.detail);
    } else if (res?.reason) {
      lastReason = res.reason;
    }
  }

  return {
    ok: anyOk,
    changed,
    detail: details.filter(Boolean).join(' + '),
    reason: lastReason
  };
}

document.getElementById('openUrls').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const urls = parseUrls(text);
    if (!urls.length) {
      setStatus('クリップボードからURLを検出できませんでした。');
      return;
    }
    for (const url of urls) await chrome.tabs.create({ url, active: false });
    setStatus(`${urls.length}件のURLを開きました。\nログインが必要なサイトは手動でログインしてください。`);
  } catch (e) {
    setStatus(`クリップボード読取に失敗: ${e.message || e}`);
  }
});

document.getElementById('reloadTabs').addEventListener('click', async () => {
  const tabs = await queryWebTabs();
  let reloaded = 0;
  let skipped = 0;
  for (const tab of tabs) {
    if (!tab?.id) {
      skipped++;
      continue;
    }
    try {
      await chrome.tabs.reload(tab.id);
      reloaded++;
    } catch (e) {
      skipped++;
    }
  }
  setStatus(`${reloaded}タブをリロードしました。${skipped ? `（${skipped}タブは既に閉じられたためスキップ）` : ''}`);
});

const fillAllButton = document.getElementById('fillForms');
const legacyAgreeButton = document.getElementById('agreeTerms');

if (fillAllButton) {
  fillAllButton.textContent = '③ 開いている全タブを入力＋同意';
}
if (legacyAgreeButton) {
  legacyAgreeButton.style.display = 'none';
  legacyAgreeButton.setAttribute('aria-hidden', 'true');
}

fillAllButton?.addEventListener('click', async () => {
  const profile = await getProfile();
  if (!profile) {
    setStatus('先に「メンバー設定」をしてください。');
    return;
  }

  setStatus('GitHubから最新ルールを確認して、全タブを入力＋同意しています…');

  const bundle = await currentRules();
  const tabs = await queryWebTabs();

  if (!tabs.length) {
    setStatus('処理できるWebタブがありません。');
    return;
  }

  let filled = 0;
  let agreed = 0;
  let completedTabs = 0;
  let failedTabs = 0;
  const details = [];

  for (const tab of tabs) {
    const label = tab.title || tab.url || `tab:${tab.id}`;
    const rules = rulesForUrl(bundle, tab.url);

    const fillRes = await applyMessageAcrossRules(
      tab.id,
      'FILL_FORM',
      profile,
      rules,
      bundle.genericConfig || {}
    );

    if (fillRes?.ok) {
      filled += fillRes.changed || 0;
    }

    const agreeRes = await applyMessageAcrossRules(
      tab.id,
      'AGREE_TERMS',
      profile,
      rules,
      bundle.genericConfig || {}
    );

    if (agreeRes?.ok) {
      agreed += agreeRes.changed || 0;
    }

    if (fillRes?.ok || agreeRes?.ok) {
      completedTabs++;
      const fillDetail = fillRes?.detail || `${fillRes?.changed || 0}項目`;
      const agreeDetail = agreeRes?.detail || `${agreeRes?.changed || 0}同意`;
      details.push(`${label}: 入力 ${fillDetail} / 同意 ${agreeDetail} / 適用ルール ${Math.max(1, rules.length)}件`);
    } else {
      failedTabs++;
      details.push(`${label}: スキップ/失敗 ${fillRes?.reason || agreeRes?.reason || '処理不可'}`);
    }
  }

  setStatus(
    `全タブ一括処理完了: ${completedTabs}/${tabs.length}タブ\n` +
    `入力 ${filled}項目 / 同意 ${agreed}件` +
    `${failedTabs ? ` / 処理不可 ${failedTabs}タブ` : ''}\n` +
    `${details.slice(0, 8).join('\n')}${details.length > 8 ? '\n…' : ''}\n` +
    `※共通ルール＋店舗別ルールを重ねて適用します。最終応募・購入・送信・確定ボタンは押しません。`
  );
});

document.getElementById('inspectForm').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) {
    setStatus('抽選の応募入力ページを表示したタブで実行してください。');
    return;
  }
  const res = await sendToTab(tab.id, { type: 'INSPECT_FORM' });
  if (!res?.ok) {
    setStatus(`フォーム構造の取得に失敗: ${res?.reason || '不明なエラー'}`);
    return;
  }
  const text = JSON.stringify(res.data, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`フォーム構造を取得しました（${res.data?.controls?.length || 0}要素）。\nクリップボードへコピー済みです。\nこのままChatGPTに貼り付けてください。\n※入力値・パスワードは取得していません。`);
  } catch (e) {
    setStatus(`構造は取得できましたがコピーに失敗しました: ${e.message || e}`);
  }
});

renderProfile();
syncRemoteRules();
