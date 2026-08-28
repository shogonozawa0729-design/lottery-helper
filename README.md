# lottery-helper

抽選応募補助Chrome拡張の共通ルール置き場です。

- GitHub側にはサイトごとの操作ルールだけを保存します。
- 氏名・住所・電話番号・メールアドレス等の個人情報は保存しません。
- 個人情報は各Chromeプロファイルの `chrome.storage.local` に保存します。
- 最終の申込・送信・購入・確定操作は自動実行しません。

## Rules

- `rules/index.json` : ルール一覧とバージョン
- `rules/cloud-pass.json` : CLOUD PASS用ルール
