# Phase 1.2 テスト結果

2026-09-08実施。**28件成功、失敗0、スキップ0（既存24件＋回帰4件）**。

- 身分証記載氏名text入力と既存値保持、アップロード・選択・本人確認済み申告の拒否。
- 内側に「はい」しかない入れ子構造からタイトル・必須表示を取得し、注意事項/個人情報の必須肯定checkboxとradioを1回だけON。inspectにもタイトルとrequired=trueを反映。
- 同文言の任意設問、否定、店舗/受取日/本人確認/CAPTCHA/ログイン/アンケート/決済、偽装submitは不変。
- 隣接設問の必須表示の流用、欠落/複数タイトルを拒否。送信buttonのイベント0。

Node.js test runner + Playwright + headless Edge。実サイト通信はフィクスチャに置換。JS構文検査・git diff --checkも成功。修正後の実Chrome・実サイトは未検証です。

以下はPhase 1.1時点の検証記録です。

# Phase 0 / 1 / 1.1 テスト結果

2026-09-07実施。Node.js標準test runner、Playwright 1.62.1、headless Microsoft Edgeを使用。

**24件成功、失敗0、スキップ0。既存17件と追加7件。**

追加検証:

- Google Formsの必須肯定ARIA checkbox/radioを1回だけON。
- メール記録の全文一致・必須条件。任意、付加文言、親テキストだけの一致を拒否。
- 否定・任意・店舗・受取日・本人確認・アンケートは不変。
- 最優先: Google Formsの偽装button/submit/link/子buttonを全capabilityと悪意あるremote selectorから操作してもDOM・イベント変化なし。
- native商品checkboxのみON。商品radio/ARIA、選択数制限、店舗、同意用途との混同を拒否。
- 別ホスト、controller欠落、不一致form action、既存radio選択を拒否。
- ARIAのサイト側更新が未確認なら強制状態変更や再clickなし。value APIへのproduct用途転用を拒否。

既存回帰検証: submit系悪意あるselector、プロフィールと既存値、空白補正の英字s、数量max空欄/既存値/「3個」/disabled option、必須肯定同意、手動対象除外、セッション・URL・sender検証、単一キュー、候補データ専用性、Gateway外の既知DOM操作パターン、現在タブと右側のみの処理を確認しました。

スナップショット検査は今回の整理に合わせ、保存コード4ファイルのSHA-256一致とord/backupが実行ツリーに存在しないこと・由来ハッシュの保持を検査します。元の実運用フォルダ31ファイルは別途固定SHA-256との一致を確認しました。
JavaScript構文検査、git diff --checkも成功。

実行コマンド: node --test tests/*.test.cjs（PlaywrightをNODE_PATH、EdgeをLATIAS_BROWSERで指定）。
通信は架空DOMへ置換し、chrome.runtimeはスタブです。**実Chrome登録・実サイト・既存プロファイルは未検証**。ARIAは対応構造を模したフィクスチャの検証であり、現行実サイトのDOMを取得したものではありません。第三者JavaScriptによる通信・送信の副作用の完全抑止は検証できません。
