const statusEl = document.getElementById('status');
const memberEl = document.getElementById('member');
const ruleStatusEl = document.getElementById('ruleStatus');

const CORE_VERSION = '0.9.8.3';
const CORE_BUILD = 'phase12-safety-1';
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
  return tabs
    .filter(t => t.id && /^https?:\/\//.test(t.url || ''))
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
}


async function queryWebTabsFromActive() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id || !Number.isFinite(Number(activeTab.index))) return [];

  const startIndex = Number(activeTab.index);
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .filter(t =>
      t.id &&
      /^https?:\/\//.test(t.url || '') &&
      Number(t.index ?? -1) >= startIndex
    )
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
}

async function pingTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    return null;
  }
}

async function ensureCurrentContent(tabId) {
  const before = await pingTab(tabId);
  if (before?.ok && before?.helperVersion === CORE_VERSION) return true;
  if (before?.helperVersion && before.helperVersion !== CORE_VERSION) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['field_policy.js', 'safety_gateway.js', 'rule_candidates.js', 'content.js'] });
    const after = await pingTab(tabId);
    return !!(after?.ok && after?.helperVersion === CORE_VERSION);
  } catch {
    return false;
  }
}

async function sendToTab(tabId, message) {
  const ready = await ensureCurrentContent(tabId);
  if (!ready) return { ok: false, reason: '安全基盤を読み込めませんでした。ページを再読み込みしてください。' };
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
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
    ruleStatusEl.textContent = `本体 ${CORE_VERSION} (${CORE_BUILD}) / 共通ルール GitHub ${bundle.rulesVersion || '最新版'}`;
    return bundle;
  } catch (e) {
    const cached = (await chrome.storage.local.get(RULE_CACHE_KEY))[RULE_CACHE_KEY];
    if (cached?.rules?.length) {
      ruleStatusEl.textContent = `本体 ${CORE_VERSION} (${CORE_BUILD}) / 共通ルール キャッシュ ${cached.rulesVersion || ''}`;
      return cached;
    }
    ruleStatusEl.textContent = `本体 ${CORE_VERSION} (${CORE_BUILD}) / 共通ルール取得失敗`;
    return { fetchedAt: 0, rulesVersion: '', genericConfig: {}, rules: [] };
  }
}

function ruleForUrl(bundle, urlText) {
  try {
    const u = new URL(urlText);
    return (bundle?.rules || []).find(rule => {
      const match = rule?.match || {};
      const hosts = Array.isArray(match.hosts) ? match.hosts : [];
      if (hosts.length && !hosts.includes(u.hostname)) return false;
      const prefixes = Array.isArray(match.pathPrefixes) ? match.pathPrefixes : [];
      if (prefixes.length && !prefixes.some(prefix => u.pathname.startsWith(prefix))) return false;
      return true;
    }) || null;
  } catch {
    return null;
  }
}

async function currentRules() {
  return await syncRemoteRules();
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
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    setStatus(`${i + 1}/${tabs.length} 左から順にリロード中…\n${tab.title || tab.url}`);
    try {
      await chrome.tabs.reload(tab.id);
      reloaded++;
    } catch {
      skipped++;
    }
  }
  setStatus(`${reloaded}タブを左から順にリロードしました。${skipped ? `（${skipped}タブはスキップ）` : ''}`);
});

const fillAllButton = document.getElementById('fillForms');
const legacyAgreeButton = document.getElementById('agreeTerms');
if (fillAllButton) fillAllButton.textContent = '③ 現在のタブから右を入力＋同意';
if (legacyAgreeButton) {
  legacyAgreeButton.style.display = 'none';
  legacyAgreeButton.setAttribute('aria-hidden', 'true');
}

let fillRunning = false;
fillAllButton?.addEventListener('click', async () => {
  if (fillRunning) return;
  fillRunning = true;
  fillAllButton.disabled = true;
  try {
  const profile = await getProfile();
  if (!profile) {
    setStatus('先に「メンバー設定」をしてください。');
    return;
  }

  setStatus('GitHubから最新ルールを確認しています…');
  const bundle = await currentRules();
  const tabs = await queryWebTabsFromActive();
  if (!tabs.length) {
    setStatus('現在のタブから右側に処理できるWebタブがありません。');
    return;
  }

  let filled = 0;
  let agreed = 0;
  let completedTabs = 0;
  let failedTabs = 0;
  const details = [];

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const label = tab.title || tab.url || `tab:${tab.id}`;
    const rule = ruleForUrl(bundle, tab.url);
    setStatus(`${i + 1}/${tabs.length} 現在のタブから右へ処理中…\n${label}`);

    const fillRes = await sendToTab(tab.id, {
      type: 'FILL_FORM',
      profile,
      rule,
      genericConfig: bundle.genericConfig || {}
    });
    if (fillRes?.ok) filled += Number(fillRes.changed || 0);

    const agreeRes = fillRes?.ok ? await sendToTab(tab.id, {
      type: 'AGREE_TERMS',
      profile,
      rule,
      genericConfig: bundle.genericConfig || {}
    }) : { ok: false, reason: '入力失敗のため同意を中止' };
    if (agreeRes?.ok) agreed += Number(agreeRes.changed || 0);

    if (fillRes?.ok && agreeRes?.ok) {
      completedTabs++;
      details.push(`${label}: 入力 ${fillRes?.detail || `${fillRes?.changed || 0}項目`} / 同意 ${agreeRes?.detail || `${agreeRes?.changed || 0}件`}`);
    } else {
      failedTabs++;
      details.push(`${label}: 失敗 ${fillRes?.reason || agreeRes?.reason || '処理不可'}`);
    }
  }

  setStatus(
    `現在のタブから右を一括処理完了: ${completedTabs}/${tabs.length}タブ\n` +
    `入力 ${filled}項目 / 同意 ${agreed}件` +
    `${failedTabs ? ` / 処理不可 ${failedTabs}タブ` : ''}\n` +
    `${details.slice(0, 8).join('\n')}${details.length > 8 ? '\n…' : ''}\n` +
    `※現在のタブを起点に右方向だけ処理。左側のタブは触りません。店舗選択・受取日・最終送信は自動実行しません。`
  );
  } finally { fillRunning = false; fillAllButton.disabled = false; }
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
    setStatus(`フォーム構造を取得しました（${res.data?.controls?.length || 0}要素）。\nクリップボードへコピー済みです。\n※入力値・パスワードは取得していません。`);
  } catch (e) {
    setStatus(`構造は取得できましたがコピーに失敗しました: ${e.message || e}`);
  }
});

renderProfile();
syncRemoteRules();
setInterval(() => syncRemoteRules().catch(() => {}), 15000);
