# ADR-0002: Organize sources while retaining public URLs

- Status: Accepted
- Date: 2026-10-15
- Decision authority: ユーザーの「開発用の配置を整理し、公開URLと動作は維持する」方針への明示承認
- Supersedes: [ADR-0001](ADR-0001-workspace-adoption.md) のルート直下ソース配置を維持する判断のみ

## Context

認証・共有・Google取込・MTG・PC/スマホの実装がルートに並び、設定・資料・確認画像との区別が難しくなった。既存公開URLとPWA、読み込み順、相対参照、Node向けテストの互換性を維持する必要がある。

## Decision

- 機能別のsrcと公開素材のpublicを導入する。5パターンのワークスペース構造は継続する。
- 物理ソースと公開パスをscripts/pwa-assets.cjsの明示的な対応表で分離。公開パッケージとローカルサーバーが同じ表を使用する。
- ブラウザー向けのHTML/JS/CSSや設定の内容を変えず移動する。coreの相互requireを持つモデル群は同じフォルダにまとめる。
- 任意のローカル初期予定はlocalへ移動し、旧配置のfallbackと配信URLを維持。確認用の非公開ファイルはtmpへ移す。
- 新規フレームワーク、依存、CI、DB・認証設定の変更は導入しない。

## Alternatives

- ルート配置を維持：公開互換性は単純だが、機能の増加に伴う見通しの悪さを改善しない。
- ブラウザーの公開URLも階層化：HTML・PWA・キャッシュ更新への影響が増えるため、今回の目的には不要。
- ソースをバンドラーへ全面移行：起動方式やデバッグを変えるため不採用。

## Consequences

機能ごとの編集場所が明確になり、公開契約を独立して維持できる。新しい公開資産は対応表への登録が必要。publicは完成したサイトではなく、直接開くHTMLは生成済みsite/index.htmlとなる。ローカルサーバーの起動方法は変わらない。

検証は公開資産・Service Workerの前後ハッシュ、既存テスト、全資産のHTTP配信、許可リスト外の非公開、生成物の一致、vendor再生成を対象とする。撤回時は今回の移動・対応表・参照更新だけを逆適用し、私的な予定を削除しない。

## References

- [Source layout](../architecture/source-layout.md)
- [Directory map](../architecture/directory-map.md)
