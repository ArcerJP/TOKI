# Source layout and stable publication

2026-10-15更新。[ADR-0002](../decisions/ADR-0002-source-layout.md) に基づき、開発時のファイル配置とブラウザーが読む公開URLを分ける。

## Source responsibilities

| 場所 | 責務・主なファイル |
| --- | --- |
| src/core/ | model、availability、schedule、mobile-model。共通計算・検証・編集内容の変換 |
| src/app/ | app、data、security、pwa。起動・状態連携・公開初期データ・PWA操作 |
| src/auth/ | auth-storage、shared、company-ui、company.css。会社・認証・共有データ通信 |
| src/calendar/ | calendar-import、google-calendar、google-import-ui。Google取込 |
| src/meetings/ | meeting-menu、meeting-export-ui。MTGメニューと書き出し |
| src/ui/ | availability-ui、group-view、row-drag、mobile-ui、styles.css、mobile.css。PC/スマホの表示・操作 |
| public/ | index.html、config.js、manifest.webmanifest、sw.js、icons、vendor。公開する素材・設定・固定依存 |
| local/ | 任意の非公開初期予定。README以外はGit除外 |
| scripts/ | 公開対応表、パッケージ生成、vendor生成とentry、名前規則生成 |
| tests/ | 実装の回帰テスト、配信・PWA・認可の検証 |

ルートには共通設定・入口文書・package定義と、既存起動コマンドを保つserve.cjsを置く。確認画像・古いZIP・補助検証ファイルはGit除外のtmpへ分類し、アプリの正本と区別する。

## One public mapping

公開パスと物理ソースの正本は [scripts/pwa-assets.cjs](../../scripts/pwa-assets.cjs) の `sources`。`assets` はその公開パス一覧、`sourcePath()` は許可された公開パスから物理ソースを解決する。

例：`src/app/app.js` → 公開 `app.js`、`src/ui/styles.css` → 公開 `styles.css`、`public/index.html` → 公開 `index.html`。

- HTML内のscript順、相対URL、OAuthの公開origin、manifestのid/start_url/scopeを維持する。
- `serve.cjs` はこの表でソースを直接配信する。`/src/...` や `/public/...` を公開しない。
- `prepare-site.cjs` はこの表のファイルだけをsiteへコピーする。publicを丸ごと公開する方式ではない。
- `worker()` はpublic/sw.jsと、公開パス・資産内容から生成する。物理ソースパスをキャッシュキーへ混ぜない。
- siteは生成物。直接編集せず、元のsrc/publicを編集して再生成する。
- public/config.jsには公開可能な設定だけを置く。秘密値・本番予定・会社の非公開情報を置かない。

Service Workerは公開位置により既定のscopeが変わるため、公開時の `/TOKI/sw.js` を維持する。[MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register#scope)（2026-10-15確認）。GitHub Pagesは従来どおりsite成果物を配信する。[GitHub公式](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## Develop and verify

```sh
npm start
npm test
npm run build
node scripts/prepare-site.cjs
```

`npm start` は従来の `node serve.cjs` と同じ。`npm run build` はSupabaseの固定vendor生成。通常のソース編集にvendor再生成は不要。

HTMLを直接開く場合は生成したsite/index.htmlを使う。PWAや認証の確認・任意のローカル初期予定を使う場合はローカルサーバーを使用する。public/index.html単独にはJavaScript/CSSが揃っていない。

`local/data.local.js` は従来のlocalhost URL `/data.local.js` でだけ配信する。local側にない場合に限って旧ルートのdata.local.jsを使い、既存環境との互換性を維持する。どちらも公開パッケージとPWAキャッシュには含めない。

配置変更時は、公開パスとファイル内容、生成Service Worker、テストの参照先、生成スクリプト、ドキュメントのリンクを確認する。今回の移行では公開32資産と生成Service Workerの前後ハッシュ一致を確認する。
