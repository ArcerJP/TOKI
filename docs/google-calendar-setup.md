# Googleカレンダー取り込みの設定

Googleログインは取り込み機能だけで使用します。共有予定表は従来どおり共有URLから開けます。メール・パスワード等の別のログイン方法は追加していません。

## Google Cloud

1. [Google Cloud Console](https://console.cloud.google.com/)でTOKI用プロジェクトを作成または選択します。
2. 「APIとサービス」→「ライブラリ」で **Google Calendar API** を有効化します。
3. 「Google Auth Platform」→「ブランディング」で初期設定します。アプリ名は **TOKI**、サポート・連絡先メールは管理者のものを指定します。個人のGoogleアカウントも利用する場合、対象ユーザーは **外部**です。表示される利用条件を確認して、ご自身で同意してください。
4. 「対象」→「テストユーザー」で管理者と利用者のGoogleアカウントを追加します。テスト公開状態では登録したユーザーで動作確認します。一般公開への切り替えや必要な審査は、Googleのコンソールの案内に従ってください。
5. 「データアクセス」に次の2つのスコープだけを追加します。以前の `calendar.freebusy` から、共有カレンダーにも対応する空き時間権限へ切り替えます。

   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`（カレンダー一覧の読み取り）
   - `https://www.googleapis.com/auth/calendar.events.freebusy`（アクセスできるカレンダーの予定あり／なし）

   予定の内容を読む `calendar.events.readonly` や、編集権限は要求しません。利用者は更新後にGoogleでログインし直し、上記2つの権限を許可してください。

6. 「クライアント」→「クライアントを作成」で **ウェブアプリケーション**を選択します。
7. 「承認済みのJavaScript生成元」に `https://arcerjp.github.io` を追加します。`/TOKI/`や`#share=…`は付けません。この実装はGISのポップアップ型トークンモデルなのでリダイレクトURIを使いません。
8. 作成された `…apps.googleusercontent.com` のクライアントIDを `config.js` の `googleClientId` に設定し、Pushします。クライアントシークレットは使用しません。シークレット、アクセストークン、Googleからの応答をリポジトリに入れないでください。

ローカルで実際の認証を検証する場合は、使う生成元も個別に追加します。例：`http://localhost` と `http://localhost:4173`。ブラウザー側も登録したホスト名・ポートで開いてください。`file://`からは利用できません。

## 使い方

1. 「Googleカレンダーから取り込む」を押します。
2. 取り込み先の人と取得開始・終了を入力します。時刻は日本時間で、終了時刻は期間に含みません。最大366日です。
3. 「Googleでログイン」でアカウントを選び、カレンダー一覧と予定あり／なしの閲覧を許可します。
4. 取得したカレンダーは初期状態で全選択です。「日本の祝日」などGoogleの祝日カレンダーは一覧・取り込み対象から自動で除外します。不要なカレンダーのチェックを外します。「全選択」で一括切り替えできます。「一覧を再取得」や画面の開き直しでは最新の一覧を全選択に戻します。
5. 「空き時間を確認」でプレビューを表示します。
6. 内容を確認し「この内容で置き換える」で保存します。直後は「元に戻す」で取り消せます。

## 判定と保存

- CalendarList APIでカレンダーのID・表示名・メインの区別・閲覧権限を取得します。非表示の登録カレンダーも対象にし、削除済みのものは含めません。一覧は最後のページまで取得します。Google Tasks APIは使用せず、ToDoリスト専用の取り込みは行いません。
- Googleの祝日カレンダーはID末尾の `#holiday@group.v.calendar.google.com` または `@holiday.calendar.google.com` で判別し、一覧への表示とFreeBusyへの送信を除外します。言語や表示名の変更に左右されません。通常の個人・共有カレンダーは名前に「祝日」が含まれていても残します。
- Google FreeBusy APIを使い、指定した`timeMin`・`timeMax`でチェックしたカレンダーだけを取得します。50件を超える場合は50件ずつ分割します。予定の一覧・タイトル・説明・場所・プロフィールは取得しません。
- 選択した全カレンダーのBusy区間をまとめ、そのいずれとも重ならない時間を可能時間にします。共有カレンダーの他人の予定も判定に含まれるため、不要なものは選択を解除してください。
- 一覧の取得失敗、選択ゼロ、一部カレンダーの読み取りエラーや応答欠落がある場合は取り込みを止めます。未取得のカレンダーを「予定なし」と扱いません。カレンダーの選択を変更すると古いプレビューを無効にします。
- Googleで「予定あり」と判定された時間帯を除外します。「空き時間」に設定された予定はブロックしません。終日予定・繰り返し予定のBusy判定もGoogleの応答に従います。
- 毎日8:00〜24:00の30分枠について、全体が取得期間内に含まれ、Busy区間と一切重ならない枠だけを可能時間にします。11:10〜11:50のBusy区間があれば11:00〜12:00を除外します。連続する枠は1つの「可能時間」にまとめます。
- 選んだ人の指定期間内を置き換えます。期間をまたぐ既存予定は分割して期間外を保持します。他の人・グループ・他の期間は変更しません。
- Googleの取得エラーを「空いている」とは扱いません。予定表の更新がプレビュー中に検知された場合は取り込みを止め、最新の内容で再取得する必要があります。共有保存には従来の版番号チェックも適用します。
- Googleのアクセストークンは画面を開いている間のメモリーだけで保持し、ブラウザーの永続保存・Supabase・Service Workerキャッシュには入れません。「ログアウト」はTOKI内の認証情報を破棄します。Googleアカウント全体のログアウトや、Google側の許可の取り消しは行いません。
- カレンダー一覧・選択内容・Busy応答は画面内でだけ使い、永続保存や共有はしません。予定表に保存するのはプレビューで確認した「可能時間」の枠です。共有版では従来どおり参加者全員が閲覧・編集でき、PWAのオフライン用の予定にも含まれます。
- ページ再読み込みや認証期限切れでは再ログインが必要です。自動定期取り込みやGoogleカレンダーへの書き込みは行いません。

## 一次資料

- [Google FreeBusy API](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Google CalendarList API](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [Googleの祝日カレンダー](https://support.google.com/calendar/answer/13748345?hl=ja)
- [Googleが公開する日本の祝日カレンダー（ID確認用）](https://calendar.google.com/calendar/embed?src=ja.japanese%23holiday%40group.v.calendar.google.com)
- [Google Calendar権限一覧](https://developers.google.com/workspace/calendar/api/auth)
- [Google Identity Servicesトークンモデル](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [同意画面の設定](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [OAuthクライアントの作成](https://developers.google.com/workspace/guides/create-credentials)

## テスト中の403 access_denied

「テスト中で承認されたテスターのみ」と表示された場合は、Google Auth Platformの「対象 / Audience」→「テストユーザー」→「ユーザーを追加」で、ログインに使用するアカウントを登録して保存します。待つだけではこの制限は解除されません。

[Google公式の対象ユーザー設定](https://support.google.com/cloud/answer/15549945)

TOKI内に登録済みのMTGはGoogle取込で保持します。プレビューからもMTGの時間を除外し、タイトル・詳細のない可能時間のみを保存します。
