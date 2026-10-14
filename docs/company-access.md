# 会社・団体ごとのアクセス管理

## 利用者の流れ

1. 会社URL、または会社コードからGoogleでログイン。
2. 管理者にメールアドレスを招待登録されていれば参加可能。未招待なら会社コードで参加申請し、管理者の承認を待つ。
3. 参加済みの会社を選んで開く。
4. 初回は全グループ・未所属が非表示。「表示グループ」で必要な行を選択する。

会社URL・会社コードは参加先を指定するための情報であり、予定の閲覧権限そのものではない。社内の承認済みメンバーは全グループの閲覧・編集が可能。表示選択はアクセス制御ではなく、PC・スマートフォン共通の個人設定。

管理者は「会社・アカウント」で申請承認、招待登録、招待取消、アクセス停止、管理者変更を行う。招待登録はメールを送信しない。会社URLを本人へ別途伝える。招待は7日間、期限切れは再登録。停止した人は、コードの再入力や招待登録だけでは再参加できず、管理者の「参加を再許可」が必要。最後の管理者は停止・一般メンバーへの変更ができない。

会社への参加アカウントと、予定表上の「人」の行は別。承認時に行を勝手に追加せず、既存の人・予定は維持する。

## 初期設定・移行の順序

認証設定が完了する前に本番へ新しい画面を公開しない。

1. Google Cloudの既存Web OAuthクライアントに、SupabaseのGoogle設定画面に表示されるCallback URLを「承認済みのリダイレクトURI」として追加。既存のJavaScript生成元は残す。
2. Supabase → Authentication → Sign In / Providers → Googleを有効化。WebクライアントIDと対応するクライアントシークレットを登録。「Skip nonce checks」「Allow users without an email」は無効のままにする。シークレットはSupabaseの設定画面だけに入力し、Gitやチャットへ貼らない。
3. Supabase → Authentication → URL ConfigurationでSite URLとRedirect URLsを実際のTOKI公開URLに設定。不要なワイルドカードは使わない。Email、匿名ログイン、その他のプロバイダーは無効にし、Googleのみを許可する。
4. `database/schema.sql`、続いて`database/companies.sql`をSQL Editorで適用。後者は旧共有URLのAPI権限を取り消す。この時点から旧画面は共有予定へ接続できないため、公開更新と続けて行う。
5. 同じSQL Editorで、移行対象と確認済みの初期管理者を指定する。

   ```sql
   select toki_private.bootstrap_company(
     '既存の予定表ID', '会社・団体名', '初期管理者のGoogleメールアドレス'
   );
   ```

   既存の予定表に会社を関連付け、既存データをコピー・変更しない。会社コードはサーバーで自動生成。初期管理者の招待は30日間。管理者の個人情報を埋め込んだSQLはリポジトリへ保存しない。
6. 新しい静的ファイルを公開。初期管理者が指定したGoogleアカウントでログインし、管理者表示と既存予定を確認する。
7. 管理者が必要な人を招待、または参加申請を承認する。Googleのアプリがテスト中なら、対象者をGoogle Cloudのテストユーザーにも追加する。

認証用のGoogleスコープは本人確認のみ。任意のカレンダー取り込みは従来のGoogle Identity Servicesで別途許可を取得する。会社にログインしただけではGoogleカレンダーを取得しない。

## データと権限

- `toki_private.companies`：会社名・会社コード・予定表ID。
- `toki_private.company_members`：GoogleアカウントのユーザーID、会社、権限、参加状態。
- `toki_private.company_invites`：会社、招待先メール、有効期限。
- 公開RPC `toki_company`：Google認証履歴、現在有効なSupabaseセッション、確認済みメール、現在の会社所属を毎回検証。会社IDを直接指定しても、未所属・承認待ち・停止中の読み書きは拒否する。
- 管理操作はその会社の管理者だけ。管理者権限を招待パラメーターで取得できない。会社コードで自分を承認することもできない。
- テーブルへのAPI直接アクセス、旧 `toki_share` とその内部関数は無効。旧スキーマを再実行しても会社移行後は旧APIを再開しない。
- 保存は版番号を照合し、同時編集時の上書きを防止。

## オフライン・端末保存

会社データのスナップショットと表示設定はユーザーID・会社IDで分離。オンラインで権限を確認できた予定だけを保存し、オフラインは閲覧・コピー・PDF出力に限定。再接続時は権限を再確認する。認証切れや権限拒否時にオフライン表示へ自動退避して制限を回避しない。

ログアウト時は、そのユーザーの会社スナップショットと表示設定をこのブラウザーから消去し、画面・開いていた編集画面・コピー欄も消す。別アカウント、別会社の遅れて届いた通信結果は適用しない。

端末内データは暗号化ストレージではない。端末・ブラウザーを使える人は保存済みデータを閲覧できる。権限停止や退会後も、切断中の端末・以前のバージョンが保存したデータ・コピー済みPDF等をサーバーから即時削除することはできない。この制約を受け入れてオフライン閲覧を維持する。

Service Workerは公開静的ファイルだけを保存する。Supabase認証セッションはSDKがブラウザーに保存し、カレンダー取り込み用トークンは従来どおりメモリーのみ。

## 検証

`npm test`にPostgreSQL互換のPGliteを使った実DBテストを含む。匿名・別会社・承認待ち・停止・セッション無効化・旧API・権限昇格・最後の管理者・同時編集を検証。PGliteは開発用で、公開ファイルには含めない。実際のGoogle OAuth同意と本番Supabaseの設定は、公開切り替え時に別途検証が必要。

## 一次資料

- [Supabase Google認証](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase JWTフィールド](https://supabase.com/docs/guides/auth/jwt-fields)
- [Supabaseログアウト](https://supabase.com/docs/guides/auth/signout)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PGlite](https://pglite.dev/docs/)
