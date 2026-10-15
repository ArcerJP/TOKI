# Knowledge schema

## Raw evidence

`raw/YYYY-MM-DD-short-source.ext`。原本はそのまま保存し、必要なら隣に `*.source.md` を置く。

source記録の項目：source_id、title、取得日、版・更新日、出典URLまたは提供方法、取込許可、公開区分、sha256（ファイルの場合）、関連task ID。不明な値は不明と書く。秘密を含むURLや個人端末のパスは公開文書に出さない。

原本の内容変更・上書きをしない。別版を取得したら新しいIDで保存し、どの版を参照するか明示する。原本の権限・利用条件を確認する。

## Wiki page

`wiki/short-topic.md`。公開可能なページだけGit管理する。

```yaml
---
title: Topic
status: draft
updated: YYYY-MM-DD
sources:
  - source_id_or_public_url
confidence: unverified
---
```

- status：draft / verified / stale / superseded。
- confidence：unverified / supported / conflicting。verifiedには出典との照合が必要。
- 本文：要点、根拠と適用範囲、不確実性・矛盾、確認日、関連ページ。
- 出典ごとにどの主張を支えるか分かるようにする。私的原本はIDだけを公開し、アクセスできない読者が検証できない限界を明記する。
- 公開してよい要約にできない資料はwikiへ昇格しない。原本をwikiへコピーしてignoreを回避しない。
- 正式仕様や設計判断になった内容はdocs/ADRへ移し、wikiは必要な要約とリンクへ整理する。

## Index and log

- [index.md](wiki/index.md)：テーマ、status、出典、関連仕様への索引。本文は複製しない。
- [log.md](wiki/log.md)：日付、対象、変更理由、出典の追加・更新・失効。
- 出典がなくなったり更新された場合はstale/conflictingとして記録し、重要な判断の前に再確認する。
