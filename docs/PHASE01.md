# LATIAS Phase 0 / Phase 1 実装記録

このフォルダは実運用先とは分離した実装・レビュー用コピーです。配布・実運用への反映は未実施です。

## Phase 0 — 統合元の固定

- ローカル元: `C:\Users\shogo\Documents\lottery-helper`。Gitリポジトリではありませんでした。
- ルート: manifest version `0.9.6`。全ファイルのSHA-256を `local-sources.json` に記録。
- ord: 同フォルダの `lottery-helper_ord`、version `0.9.8`。本体の機能ベースに使用。空白補正の不具合を修正して統合。
- GitHub: `https://github.com/shogonozawa0729-design/lottery-helper`、コミット `ec6502e659e07cfeed8c5d255b903093b63462a2`。ファイル一覧・Git blob SHAを `github-source-tree.json` に固定。現時点のmainを追跡しただけでGit操作による変更は行っていません。
- GitHub版のpopup／mapper／enhancerは参考ソースとして記録し、コピー・有効化していません。リモートrulesの内容・schemaは変更していません。
- このコピー内の `snapshot/local-before-phase01` ブランチに元のルート・ord・backupをコミットし、`phase01/safety-gateway` ブランチで実装。
- このGitリポジトリはローカルスナップショットから新規作成したものです。GitHub履歴のcloneではなく、GitHubへ接続するremoteも設定していません。将来のPR作成時には本体配置を対応付けて変更を移植する必要があります。
- 元フォルダ・このコピーのord／backupは削除・移動・変更していません。

### Chromeが読み込んでいるパスを確認する方法

1. **普段LATIASを使用しているChromeプロファイル**で `chrome://extensions` を開く。
2. デベロッパーモードをONにし、LATIAS／「抽選応募補助」のカードを探す。
3. 「詳細」で拡張ID、バージョン、「読み込み元／Loaded from」のフォルダを確認する。ルートなのか、その下のordなのかを省略せず記録する。
4. カードのservice workerの検証画面で、必要に応じて以下の読み取りだけを実行する。

```js
({
  extensionId: chrome.runtime.id,
  name: chrome.runtime.getManifest().name,
  version: chrome.runtime.getManifest().version,
  manifestVersion: chrome.runtime.getManifest().manifest_version
})
```

`version`（例: 0.9.6、0.9.8）と `manifest_version`（拡張仕様の3）は別物です。`chrome.runtime.getURL('')` は拡張URLであり、ローカル読み込みパスの証明にはなりません。読み込み元が表示されない場合も、コードの版だけからパスを推定しないでください。

**現時点の実運用パスは未確認（UNVERIFIED）です。** 今回は確認方法の提示までで、既存Chromeプロファイルにアクセスしていません。

### 保存データの互換性

- プロフィールは従来どおり `chrome.storage.local` の `profile`。
- フィールド名・マージ保存の `options.js`、設定HTML、追加項目JSはバイト単位で維持。
- `remoteRuleBundleV2` もキーを維持。Phase 1では既存schema v2を候補へ変換。
- 保存済みプロフィールの実データは読み取り・エクスポートしていません。
- 別フォルダを新しい拡張として読み込むと、拡張IDと保存領域が変わる可能性があります。この候補コピーを実運用プロファイルに新規登録しないでください。正式反映は既存の読み込み元・ID確認後に別工程で行います。

## Phase 1 — 実装した安全境界

`popup → content（単一キュー）→ 候補評価 → Safety Gateway → 状態変更`。

- `field_policy.js`: 許可ページ、部品型、手動対象、プロフィール用途、必須肯定同意を検証する最小policy。
- `safety_gateway.js`: 応募先DOMのvalue／checked／select変更とinput/change/blur送出の唯一の箇所。汎用click APIは存在しません。
- `rule_candidates.js`: 既存v2 actionsをDOMを参照せず候補データへ変換。`overwrite`、`allowReadOnly`、独自safeフラグ等を引き継ぎません。
- `content.js`: ordを基礎に、全操作をGateway呼び出しへ変更。候補コンパイルと実行を分離。ページロード時の自動操作を停止。
- `popup.js`: 現在タブから右側だけという範囲を維持。旧本体への重ね注入を拒否し再読み込みを案内。二重実行を抑止。入力失敗時は同意へ進まない。
- manifest/popupの候補版番号は `0.9.8.1`。正式版公開を意味しません。
- mapper／enhancerはmanifest・追加注入から除外したまま。万一の再注入に備え先頭に無条件returnだけを追加。旧実装を保存し、大規模再設計はしていません。

### Phase 1で意図的に止める操作

- 全button・link・submit/image/reset入力、button/linkを祖先に持つ部品。
- `clickText`、固定回答の `selectTextByLabel`、任意の操作型。
- 未検証のARIAカスタム部品（Google Formsのdiv checkbox/radioを含む）、非表示・readonly部品、inlineイベントハンドラーのある対象。
- ログイン、CAPTCHA、認証、本人確認書類選択・認証済み申告、受取日、店舗、アンケート、決済。
- 必須の肯定同意と確認できないcheckbox等。既存の拒否選択も上書きしない。
- 未対応ホスト／画面。対象候補はCLOUD PASSの入力画面、CustomForm入力画面、Google Forms、LivePocket確認フォーム、ふるいちの対象パスに限定。
- 「申込画面に進む」「住所検索」、商品種類の一括チェック、メール記録の自動チェックは手動。
- 本人確認の語を含む氏名欄も安全優先で手動になる場合があります。

数量はGateway移管に伴い、空のmaxを0にしない、数量の既存値を最大化可能とする、disabled option/optgroupを除外、限定的な「3個」等の解析を追加。合計上限の最適配分や未知のカスタム数量UIは未実装です。

### 限界と次Phaseへの引き継ぎ

GatewayはLATIAS自身の最終操作・リモートselectorによる迂回を拒否します。しかし第三者ページの任意のJavaScriptが通常のinput/changeを受けて独自通信する挙動まで、DOM操作だけで抑止する仕組みではありません。既知のinlineハンドラーは拒否しますが、addEventListenerで登録されたサイト処理の完全な検出はしていません。実ページの副作用まで保証した正式版として配布する前に、サイト別の確認が必要です。

現段階は安全基盤のレビュー候補です。Google Formsなどで操作できる項目が減ることを既知の制限としています。対応拡大のためにGatewayの禁止を緩める処理は入れていません。rules schema全面移行、questionMappings統合、mapper/enhancer再設計、GitHubへの反映、正式配布は未実施です。

## 検証

`tests/safety.test.cjs`: Playwright + headless Edge上のローカルHTMLフィクスチャ。通信はrouteで遮断し、実応募先には接続しません。chrome.runtimeはテスト用スタブです。実際にChromeへ拡張を登録するテストではありません。

`tests/integration.test.cjs`: manifestの実行対象、Gateway外の禁止操作パターン、保存コード/ord/backupのSHA-256、popupのタブ範囲・旧版拒否。静的チェックは既知パターンの検査で、任意の将来コードを形式的に証明するものではありません。

通常のテスト実行は `npm install` 後、PlaywrightのChromiumを準備して `npm test`。既存のブラウザ実行ファイルを使う場合は環境変数 `LATIAS_BROWSER` に指定します。

今回の環境ではbundled Playwright 1.62.1とheadless Edgeを使用し、追加インストールは行っていません。

## レビュー後の手動確認（今回未実施）

1. Chromeの実読み込みパス・拡張ID・versionを確認する。
2. テスト用Chromeプロファイルで候補を読み込み、架空プロフィールを登録する。
3. サイドパネル、右側タブだけの処理、保存・再表示を確認する。
4. 対応ページで手動対象が維持されることを確認する。最終ボタンは押さない。
5. 不明なサイト挙動は対象を増やす前にフィクスチャ化する。
