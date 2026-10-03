# TOKI

16人の参加可能時間を編集するガントチャート。HTML・CSS・JavaScriptを別ファイルに分け、ブラウザーで利用できます。

共有版：https://arcerjp.github.io/TOKI/

## 起動

`index.html`をブラウザーで開きます。Node.jsがある場合は、次のコマンドでも起動できます。

```sh
node serve.cjs
```

表示先： http://127.0.0.1:4173

## 操作

- 日付のプルダウンで2026年10月3日〜8日を切り替え
- 空き枠をドラッグして追加、予定をドラッグして移動、両端をドラッグして時間変更
- 予定をクリックしてタイトル・詳細・名前・日付・時刻を編集
- 元に戻す：Ctrl/Cmd+Z、やり直す：Ctrl/Cmd+Shift+Z
- PDF出力：表示中の1日または全6日を選び、印刷画面で「PDFに保存」

表示範囲は8:00〜24:00、目盛りは30分刻み。編集画面では1分単位で時刻を入力できます。

## 保存と個人データ

GitHub Pages上では**Supabaseへの共有保存**を使用します。登録済みアカウントでログインすると、全員の予定を閲覧・編集できます。変更をリアルタイムで受信し、接続が切れた場合も表示中は15秒ごとに再取得します。同じ版の予定が同時に変更された場合、後から保存する側に再確認を求め、先の変更を上書きしません。ほかの人の更新を受信すると、取り消し履歴をクリアします。

ファイル直接起動・localhostでは従来の端末内保存を維持します。共有版と端末内保存は別のデータです。localhostで共有版を確認するときは`http://127.0.0.1:4173/?mode=shared`を開きます。

公開用の`data.js`は「メンバー1〜16」と空の予定を使用します。実際の名前・予定はGit管理対象外の`data.local.js`に分離し、ファイル直接起動またはlocalhostでのみ読み込みます。新しく取得したリポジトリは、`data.local.js`がなくても空の予定表として動作します。

実際のデータを初期表示したい場合は、端末内に限り`data.local.js`で次の形式の`window.TOKI_DATA`を定義します。

```js
window.TOKI_DATA = {
  dates: Array.from({length: 6}, (_, i) => `2026-10-0${i + 3}`),
  people: Array.from({length: 16}, (_, i) => `メンバー${i + 1}`),
  availability: Array.from({length: 16}, () => Array(6).fill(""))
};
```

`availability`は16人×6日の配列です。各セルは空文字、または`"9:00-12:00,13:00-18:00"`のような文字列です。保存済みの編集内容がある場合は、そちらを優先します。

名前・予定を含むファイル、PDF、画像、ZIP、秘密鍵は公開しないでください。ブラウザーの保存データを削除すると、編集内容も消えます。

## 管理者：ログイン用アカウントの登録

1. SupabaseのAuthentication → Users → Add user → Create new userで、本人のメールアドレスとパスワードを登録します。管理者が本人を確認したアカウントとしてAuto Confirm Userを有効にした状態で作成します。パスワードをGitHubやチャットへ記載しないでください。
2. 作成されたユーザーのUIDを確認し、SQL Editorで以下を実行します。UUIDはそのユーザーのものに置き換えてください。

```sql
insert into public.toki_members(user_id)
values ('REGISTERED-USER-UUID'::uuid)
on conflict(user_id) do nothing;
```

3. 共有版でログインします。メンバー登録した全員が、全員分の予定を編集できます。メール配信の設定は不要です。

Supabaseへの管理者ログインと、予定表へのログインは別アカウントです。Authにアカウントがあっても、`toki_members`に登録されていなければ予定を取得できません。利用者を追加する際、Supabase組織自体の管理者権限は渡さないでください。

## 開発・公開

```sh
npm ci --ignore-scripts
npm run build
npm test
```

`vendor/supabase.js`は固定バージョンの公式Supabaseクライアントを同梱したものです。ビルド時にライセンス文も出力します。通常の起動ではnpmの実行は不要です。

`database/schema.sql`に、テーブル・RLS・入力検証・版番号更新・Realtime設定を保存しています。新しいSupabase環境へ移す場合にSQL Editorで実行してください。初期予定は含みません。ブラウザー用の接続先と公開可能なキーは`config.js`に設定します。Secret keyやservice_roleは使用しません。

GitHub PagesはGitHub Actionsを使用します。`main`へのPushで、公開対象のHTML・CSS・JavaScriptだけを配信します。Supabaseの初期設定値は、東京リージョン・Data API有効・新規テーブルの自動公開無効・自動RLS有効です。DBスキーマの変更は自動適用されず、管理者がSQL Editorで反映します。

確認済み：匿名アクセス拒否、登録メンバーの読み書き、未登録アカウントの拒否、版番号による同時更新の拒否。実際の利用者によるログイン・複数端末の通し確認は、利用者アカウントの作成後に行います。
