# Local-only files

このフォルダはREADME以外をGit管理・Web公開・PWAキャッシュから除外します。

- 端末内モードの任意の初期予定は `local/data.local.js`。既存のファイルは内容を変更せずここへ移動しています。
- `node serve.cjs` がlocalhost専用の従来URL `/data.local.js` へ対応付けます。
- 旧配置のルート `data.local.js` も、local側にファイルがない場合だけ読み込みます。既存の利用環境への互換性のための扱いです。
- 実際の予定や秘密値をpublic、src、Gitへ移さないでください。Git除外は端末上でのアクセス制御・暗号化を意味しません。
