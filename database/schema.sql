-- Run in the Supabase SQL Editor. Safe to apply to the previous login-based schema.
-- Private names, schedules and sharing tokens are not included in this file.
begin;
create schema if not exists toki_private;
revoke all on schema toki_private from public, anon, authenticated;
create table if not exists public.toki_boards (
  id text primary key check (id = 'october-2026'),
  payload jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.toki_boards enable row level security;
revoke all on public.toki_boards from public, anon, authenticated;
revoke update(payload) on public.toki_boards from public, anon, authenticated;
-- Retain legacy membership records but disable the old API path.
do $$ begin
  if to_regclass('public.toki_members') is not null then
    revoke all on public.toki_members from public, anon, authenticated;
  end if;
end $$;
create table if not exists toki_private.share_links (
  board_id text primary key references public.toki_boards(id),
  token_hash bytea not null unique
);
create table if not exists toki_private.registrations (
  board_id text not null references public.toki_boards(id),
  registration uuid not null,
  person integer not null,
  primary key(board_id, registration)
);
revoke all on toki_private.share_links, toki_private.registrations from public, anon, authenticated;
alter table toki_private.share_links enable row level security;
alter table toki_private.registrations enable row level security;
-- Match JavaScript string.length so accepted data cannot make every client reject a board.
create or replace function toki_private.js_length(value text)
returns integer language sql immutable strict set search_path='' as $$
  select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::integer
  from regexp_split_to_table(value,'') c;
$$;
revoke all on function toki_private.js_length(text) from public,anon,authenticated;
-- ECMAScript whitespace, including BOM, independent of the database locale.
create or replace function toki_private.normalize_name(value text)
returns text language sql immutable strict set search_path='' as $$
  select btrim(regexp_replace(normalize(translate(value,'𜳖𜳗𜳘𜳙𜳚𜳛𜳜𜳝𜳞𜳟𜳠𜳡𜳢𜳣𜳤𜳥𜳦𜳧𜳨𜳩𜳪𜳫𜳬𜳭𜳮𜳯𜳰𜳱𜳲𜳳𜳴𜳵𜳶𜳷𜳸𜳹','ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),NFKC),U&'[\0009\000a\000b\000c\000d\0020\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]+',' ','g'));
$$;
revoke all on function toki_private.normalize_name(text) from public,anon,authenticated;
-- BEGIN GENERATED NAME CASE MAP (Unicode 16.0)
create or replace function toki_private.supported_name(value text)
returns boolean language sql immutable strict set search_path='' as $$
  select value !~ U&'[^\0001-\0377\037a-\037f\0384-\038a\038c\038e-\03a1\03a3-\052f\0531-\0556\0559-\058a\058d-\058f\0591-\05c7\05d0-\05ea\05ef-\05f4\0600-\070d\070f-\074a\074d-\07b1\07c0-\07fa\07fd-\082d\0830-\083e\0840-\085b\085e\0860-\086a\0870-\088e\0890-\0891\0897-\0983\0985-\098c\098f-\0990\0993-\09a8\09aa-\09b0\09b2\09b6-\09b9\09bc-\09c4\09c7-\09c8\09cb-\09ce\09d7\09dc-\09dd\09df-\09e3\09e6-\09fe\0a01-\0a03\0a05-\0a0a\0a0f-\0a10\0a13-\0a28\0a2a-\0a30\0a32-\0a33\0a35-\0a36\0a38-\0a39\0a3c\0a3e-\0a42\0a47-\0a48\0a4b-\0a4d\0a51\0a59-\0a5c\0a5e\0a66-\0a76\0a81-\0a83\0a85-\0a8d\0a8f-\0a91\0a93-\0aa8\0aaa-\0ab0\0ab2-\0ab3\0ab5-\0ab9\0abc-\0ac5\0ac7-\0ac9\0acb-\0acd\0ad0\0ae0-\0ae3\0ae6-\0af1\0af9-\0aff\0b01-\0b03\0b05-\0b0c\0b0f-\0b10\0b13-\0b28\0b2a-\0b30\0b32-\0b33\0b35-\0b39\0b3c-\0b44\0b47-\0b48\0b4b-\0b4d\0b55-\0b57\0b5c-\0b5d\0b5f-\0b63\0b66-\0b77\0b82-\0b83\0b85-\0b8a\0b8e-\0b90\0b92-\0b95\0b99-\0b9a\0b9c\0b9e-\0b9f\0ba3-\0ba4\0ba8-\0baa\0bae-\0bb9\0bbe-\0bc2\0bc6-\0bc8\0bca-\0bcd\0bd0\0bd7\0be6-\0bfa\0c00-\0c0c\0c0e-\0c10\0c12-\0c28\0c2a-\0c39\0c3c-\0c44\0c46-\0c48\0c4a-\0c4d\0c55-\0c56\0c58-\0c5a\0c5d\0c60-\0c63\0c66-\0c6f\0c77-\0c8c\0c8e-\0c90\0c92-\0ca8\0caa-\0cb3\0cb5-\0cb9\0cbc-\0cc4\0cc6-\0cc8\0cca-\0ccd\0cd5-\0cd6\0cdd-\0cde\0ce0-\0ce3\0ce6-\0cef\0cf1-\0cf3\0d00-\0d0c\0d0e-\0d10\0d12-\0d44\0d46-\0d48\0d4a-\0d4f\0d54-\0d63\0d66-\0d7f\0d81-\0d83\0d85-\0d96\0d9a-\0db1\0db3-\0dbb\0dbd\0dc0-\0dc6\0dca\0dcf-\0dd4\0dd6\0dd8-\0ddf\0de6-\0def\0df2-\0df4\0e01-\0e3a\0e3f-\0e5b\0e81-\0e82\0e84\0e86-\0e8a\0e8c-\0ea3\0ea5\0ea7-\0ebd\0ec0-\0ec4\0ec6\0ec8-\0ece\0ed0-\0ed9\0edc-\0edf\0f00-\0f47\0f49-\0f6c\0f71-\0f97\0f99-\0fbc\0fbe-\0fcc\0fce-\0fda\1000-\10c5\10c7\10cd\10d0-\1248\124a-\124d\1250-\1256\1258\125a-\125d\1260-\1288\128a-\128d\1290-\12b0\12b2-\12b5\12b8-\12be\12c0\12c2-\12c5\12c8-\12d6\12d8-\1310\1312-\1315\1318-\135a\135d-\137c\1380-\1399\13a0-\13f5\13f8-\13fd\1400-\169c\16a0-\16f8\1700-\1715\171f-\1736\1740-\1753\1760-\176c\176e-\1770\1772-\1773\1780-\17dd\17e0-\17e9\17f0-\17f9\1800-\1819\1820-\1878\1880-\18aa\18b0-\18f5\1900-\191e\1920-\192b\1930-\193b\1940\1944-\196d\1970-\1974\1980-\19ab\19b0-\19c9\19d0-\19da\19de-\1a1b\1a1e-\1a5e\1a60-\1a7c\1a7f-\1a89\1a90-\1a99\1aa0-\1aad\1ab0-\1ace\1b00-\1b4c\1b4e-\1bf3\1bfc-\1c37\1c3b-\1c49\1c4d-\1c8a\1c90-\1cba\1cbd-\1cc7\1cd0-\1cfa\1d00-\1f15\1f18-\1f1d\1f20-\1f45\1f48-\1f4d\1f50-\1f57\1f59\1f5b\1f5d\1f5f-\1f7d\1f80-\1fb4\1fb6-\1fc4\1fc6-\1fd3\1fd6-\1fdb\1fdd-\1fef\1ff2-\1ff4\1ff6-\1ffe\2000-\2064\2066-\2071\2074-\208e\2090-\209c\20a0-\20c0\20d0-\20f0\2100-\218b\2190-\2429\2440-\244a\2460-\2b73\2b76-\2b95\2b97-\2cf3\2cf9-\2d25\2d27\2d2d\2d30-\2d67\2d6f-\2d70\2d7f-\2d96\2da0-\2da6\2da8-\2dae\2db0-\2db6\2db8-\2dbe\2dc0-\2dc6\2dc8-\2dce\2dd0-\2dd6\2dd8-\2dde\2de0-\2e5d\2e80-\2e99\2e9b-\2ef3\2f00-\2fd5\2ff0-\303f\3041-\3096\3099-\30ff\3105-\312f\3131-\318e\3190-\31e5\31ef-\321e\3220-\a48c\a490-\a4c6\a4d0-\a62b\a640-\a6f7\a700-\a7cd\a7d0-\a7d1\a7d3\a7d5-\a7dc\a7f2-\a82c\a830-\a839\a840-\a877\a880-\a8c5\a8ce-\a8d9\a8e0-\a953\a95f-\a97c\a980-\a9cd\a9cf-\a9d9\a9de-\a9fe\aa00-\aa36\aa40-\aa4d\aa50-\aa59\aa5c-\aac2\aadb-\aaf6\ab01-\ab06\ab09-\ab0e\ab11-\ab16\ab20-\ab26\ab28-\ab2e\ab30-\ab6b\ab70-\abed\abf0-\abf9\ac00-\d7a3\d7b0-\d7c6\d7cb-\d7fb\e000-\fa6d\fa70-\fad9\fb00-\fb06\fb13-\fb17\fb1d-\fb36\fb38-\fb3c\fb3e\fb40-\fb41\fb43-\fb44\fb46-\fbc2\fbd3-\fd8f\fd92-\fdc7\fdcf\fdf0-\fe19\fe20-\fe52\fe54-\fe66\fe68-\fe6b\fe70-\fe74\fe76-\fefc\feff\ff01-\ffbe\ffc2-\ffc7\ffca-\ffcf\ffd2-\ffd7\ffda-\ffdc\ffe0-\ffe6\ffe8-\ffee\fff9-\fffd\+010000-\+01000b\+01000d-\+010026\+010028-\+01003a\+01003c-\+01003d\+01003f-\+01004d\+010050-\+01005d\+010080-\+0100fa\+010100-\+010102\+010107-\+010133\+010137-\+01018e\+010190-\+01019c\+0101a0\+0101d0-\+0101fd\+010280-\+01029c\+0102a0-\+0102d0\+0102e0-\+0102fb\+010300-\+010323\+01032d-\+01034a\+010350-\+01037a\+010380-\+01039d\+01039f-\+0103c3\+0103c8-\+0103d5\+010400-\+01049d\+0104a0-\+0104a9\+0104b0-\+0104d3\+0104d8-\+0104fb\+010500-\+010527\+010530-\+010563\+01056f-\+01057a\+01057c-\+01058a\+01058c-\+010592\+010594-\+010595\+010597-\+0105a1\+0105a3-\+0105b1\+0105b3-\+0105b9\+0105bb-\+0105bc\+0105c0-\+0105f3\+010600-\+010736\+010740-\+010755\+010760-\+010767\+010780-\+010785\+010787-\+0107b0\+0107b2-\+0107ba\+010800-\+010805\+010808\+01080a-\+010835\+010837-\+010838\+01083c\+01083f-\+010855\+010857-\+01089e\+0108a7-\+0108af\+0108e0-\+0108f2\+0108f4-\+0108f5\+0108fb-\+01091b\+01091f-\+010939\+01093f\+010980-\+0109b7\+0109bc-\+0109cf\+0109d2-\+010a03\+010a05-\+010a06\+010a0c-\+010a13\+010a15-\+010a17\+010a19-\+010a35\+010a38-\+010a3a\+010a3f-\+010a48\+010a50-\+010a58\+010a60-\+010a9f\+010ac0-\+010ae6\+010aeb-\+010af6\+010b00-\+010b35\+010b39-\+010b55\+010b58-\+010b72\+010b78-\+010b91\+010b99-\+010b9c\+010ba9-\+010baf\+010c00-\+010c48\+010c80-\+010cb2\+010cc0-\+010cf2\+010cfa-\+010d27\+010d30-\+010d39\+010d40-\+010d65\+010d69-\+010d85\+010d8e-\+010d8f\+010e60-\+010e7e\+010e80-\+010ea9\+010eab-\+010ead\+010eb0-\+010eb1\+010ec2-\+010ec4\+010efc-\+010f27\+010f30-\+010f59\+010f70-\+010f89\+010fb0-\+010fcb\+010fe0-\+010ff6\+011000-\+01104d\+011052-\+011075\+01107f-\+0110c2\+0110cd\+0110d0-\+0110e8\+0110f0-\+0110f9\+011100-\+011134\+011136-\+011147\+011150-\+011176\+011180-\+0111df\+0111e1-\+0111f4\+011200-\+011211\+011213-\+011241\+011280-\+011286\+011288\+01128a-\+01128d\+01128f-\+01129d\+01129f-\+0112a9\+0112b0-\+0112ea\+0112f0-\+0112f9\+011300-\+011303\+011305-\+01130c\+01130f-\+011310\+011313-\+011328\+01132a-\+011330\+011332-\+011333\+011335-\+011339\+01133b-\+011344\+011347-\+011348\+01134b-\+01134d\+011350\+011357\+01135d-\+011363\+011366-\+01136c\+011370-\+011374\+011380-\+011389\+01138b\+01138e\+011390-\+0113b5\+0113b7-\+0113c0\+0113c2\+0113c5\+0113c7-\+0113ca\+0113cc-\+0113d5\+0113d7-\+0113d8\+0113e1-\+0113e2\+011400-\+01145b\+01145d-\+011461\+011480-\+0114c7\+0114d0-\+0114d9\+011580-\+0115b5\+0115b8-\+0115dd\+011600-\+011644\+011650-\+011659\+011660-\+01166c\+011680-\+0116b9\+0116c0-\+0116c9\+0116d0-\+0116e3\+011700-\+01171a\+01171d-\+01172b\+011730-\+011746\+011800-\+01183b\+0118a0-\+0118f2\+0118ff-\+011906\+011909\+01190c-\+011913\+011915-\+011916\+011918-\+011935\+011937-\+011938\+01193b-\+011946\+011950-\+011959\+0119a0-\+0119a7\+0119aa-\+0119d7\+0119da-\+0119e4\+011a00-\+011a47\+011a50-\+011aa2\+011ab0-\+011af8\+011b00-\+011b09\+011bc0-\+011be1\+011bf0-\+011bf9\+011c00-\+011c08\+011c0a-\+011c36\+011c38-\+011c45\+011c50-\+011c6c\+011c70-\+011c8f\+011c92-\+011ca7\+011ca9-\+011cb6\+011d00-\+011d06\+011d08-\+011d09\+011d0b-\+011d36\+011d3a\+011d3c-\+011d3d\+011d3f-\+011d47\+011d50-\+011d59\+011d60-\+011d65\+011d67-\+011d68\+011d6a-\+011d8e\+011d90-\+011d91\+011d93-\+011d98\+011da0-\+011da9\+011ee0-\+011ef8\+011f00-\+011f10\+011f12-\+011f3a\+011f3e-\+011f5a\+011fb0\+011fc0-\+011ff1\+011fff-\+012399\+012400-\+01246e\+012470-\+012474\+012480-\+012543\+012f90-\+012ff2\+013000-\+013455\+013460-\+0143fa\+014400-\+014646\+016100-\+016139\+016800-\+016a38\+016a40-\+016a5e\+016a60-\+016a69\+016a6e-\+016abe\+016ac0-\+016ac9\+016ad0-\+016aed\+016af0-\+016af5\+016b00-\+016b45\+016b50-\+016b59\+016b5b-\+016b61\+016b63-\+016b77\+016b7d-\+016b8f\+016d40-\+016d79\+016e40-\+016e9a\+016f00-\+016f4a\+016f4f-\+016f87\+016f8f-\+016f9f\+016fe0-\+016fe4\+016ff0-\+016ff1\+017000-\+0187f7\+018800-\+018cd5\+018cff-\+018d08\+01aff0-\+01aff3\+01aff5-\+01affb\+01affd-\+01affe\+01b000-\+01b122\+01b132\+01b150-\+01b152\+01b155\+01b164-\+01b167\+01b170-\+01b2fb\+01bc00-\+01bc6a\+01bc70-\+01bc7c\+01bc80-\+01bc88\+01bc90-\+01bc99\+01bc9c-\+01bca3\+01cc00-\+01ccf9\+01cd00-\+01ceb3\+01cf00-\+01cf2d\+01cf30-\+01cf46\+01cf50-\+01cfc3\+01d000-\+01d0f5\+01d100-\+01d126\+01d129-\+01d1ea\+01d200-\+01d245\+01d2c0-\+01d2d3\+01d2e0-\+01d2f3\+01d300-\+01d356\+01d360-\+01d378\+01d400-\+01d454\+01d456-\+01d49c\+01d49e-\+01d49f\+01d4a2\+01d4a5-\+01d4a6\+01d4a9-\+01d4ac\+01d4ae-\+01d4b9\+01d4bb\+01d4bd-\+01d4c3\+01d4c5-\+01d505\+01d507-\+01d50a\+01d50d-\+01d514\+01d516-\+01d51c\+01d51e-\+01d539\+01d53b-\+01d53e\+01d540-\+01d544\+01d546\+01d54a-\+01d550\+01d552-\+01d6a5\+01d6a8-\+01d7cb\+01d7ce-\+01da8b\+01da9b-\+01da9f\+01daa1-\+01daaf\+01df00-\+01df1e\+01df25-\+01df2a\+01e000-\+01e006\+01e008-\+01e018\+01e01b-\+01e021\+01e023-\+01e024\+01e026-\+01e02a\+01e030-\+01e06d\+01e08f\+01e100-\+01e12c\+01e130-\+01e13d\+01e140-\+01e149\+01e14e-\+01e14f\+01e290-\+01e2ae\+01e2c0-\+01e2f9\+01e2ff\+01e4d0-\+01e4f9\+01e5d0-\+01e5fa\+01e5ff\+01e7e0-\+01e7e6\+01e7e8-\+01e7eb\+01e7ed-\+01e7ee\+01e7f0-\+01e7fe\+01e800-\+01e8c4\+01e8c7-\+01e8d6\+01e900-\+01e94b\+01e950-\+01e959\+01e95e-\+01e95f\+01ec71-\+01ecb4\+01ed01-\+01ed3d\+01ee00-\+01ee03\+01ee05-\+01ee1f\+01ee21-\+01ee22\+01ee24\+01ee27\+01ee29-\+01ee32\+01ee34-\+01ee37\+01ee39\+01ee3b\+01ee42\+01ee47\+01ee49\+01ee4b\+01ee4d-\+01ee4f\+01ee51-\+01ee52\+01ee54\+01ee57\+01ee59\+01ee5b\+01ee5d\+01ee5f\+01ee61-\+01ee62\+01ee64\+01ee67-\+01ee6a\+01ee6c-\+01ee72\+01ee74-\+01ee77\+01ee79-\+01ee7c\+01ee7e\+01ee80-\+01ee89\+01ee8b-\+01ee9b\+01eea1-\+01eea3\+01eea5-\+01eea9\+01eeab-\+01eebb\+01eef0-\+01eef1\+01f000-\+01f02b\+01f030-\+01f093\+01f0a0-\+01f0ae\+01f0b1-\+01f0bf\+01f0c1-\+01f0cf\+01f0d1-\+01f0f5\+01f100-\+01f1ad\+01f1e6-\+01f202\+01f210-\+01f23b\+01f240-\+01f248\+01f250-\+01f251\+01f260-\+01f265\+01f300-\+01f6d7\+01f6dc-\+01f6ec\+01f6f0-\+01f6fc\+01f700-\+01f776\+01f77b-\+01f7d9\+01f7e0-\+01f7eb\+01f7f0\+01f800-\+01f80b\+01f810-\+01f847\+01f850-\+01f859\+01f860-\+01f887\+01f890-\+01f8ad\+01f8b0-\+01f8bb\+01f8c0-\+01f8c1\+01f900-\+01fa53\+01fa60-\+01fa6d\+01fa70-\+01fa7c\+01fa80-\+01fa89\+01fa8f-\+01fac6\+01face-\+01fadc\+01fadf-\+01fae9\+01faf0-\+01faf8\+01fb00-\+01fb92\+01fb94-\+01fbf9\+020000-\+02a6df\+02a700-\+02b739\+02b740-\+02b81d\+02b820-\+02cea1\+02ceb0-\+02ebe0\+02ebf0-\+02ee5d\+02f800-\+02fa1d\+030000-\+03134a\+031350-\+0323af\+0e0001\+0e0020-\+0e007f\+0e0100-\+0e01ef\+0f0000-\+0ffffd\+100000-\+10fffd]';
$$;
revoke all on function toki_private.supported_name(text) from public,anon,authenticated;
create or replace function toki_private.name_key(value text)
returns text language sql immutable strict set search_path='' as $$
  select translate(replace(toki_private.normalize_name(value),chr(304),U&'i\0307'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽƁƂƄƆƇƉƊƋƎƏƐƑƓƔƖƗƘƜƝƟƠƢƤƦƧƩƬƮƯƱƲƳƵƷƸƼǄǅǇǈǊǋǍǏǑǓǕǗǙǛǞǠǢǤǦǨǪǬǮǱǲǴǶǷǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȠȢȤȦȨȪȬȮȰȲȺȻȽȾɁɃɄɅɆɈɊɌɎͰͲͶͿΆΈΉΊΌΎΏΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫςϏϘϚϜϞϠϢϤϦϨϪϬϮϴϷϹϺϽϾϿЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӀӁӃӅӇӉӋӍӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾԀԂԄԆԈԊԌԎԐԒԔԖԘԚԜԞԠԢԤԦԨԪԬԮԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖႠႡႢႣႤႥႦႧႨႩႪႫႬႭႮႯႰႱႲႳႴႵႶႷႸႹႺႻႼႽႾႿჀჁჂჃჄჅჇჍᎠᎡᎢᎣᎤᎥᎦᎧᎨᎩᎪᎫᎬᎭᎮᎯᎰᎱᎲᎳᎴᎵᎶᎷᎸᎹᎺᎻᎼᎽᎾᎿᏀᏁᏂᏃᏄᏅᏆᏇᏈᏉᏊᏋᏌᏍᏎᏏᏐᏑᏒᏓᏔᏕᏖᏗᏘᏙᏚᏛᏜᏝᏞᏟᏠᏡᏢᏣᏤᏥᏦᏧᏨᏩᏪᏫᏬᏭᏮᏯᏰᏱᏲᏳᏴᏵᲉᲐᲑᲒᲓᲔᲕᲖᲗᲘᲙᲚᲛᲜᲝᲞᲟᲠᲡᲢᲣᲤᲥᲦᲧᲨᲩᲪᲫᲬᲭᲮᲯᲰᲱᲲᲳᲴᲵᲶᲷᲸᲹᲺᲽᲾᲿḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔẞẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾἈἉἊἋἌἍἎἏἘἙἚἛἜἝἨἩἪἫἬἭἮἯἸἹἺἻἼἽἾἿὈὉὊὋὌὍὙὛὝὟὨὩὪὫὬὭὮὯᾈᾉᾊᾋᾌᾍᾎᾏᾘᾙᾚᾛᾜᾝᾞᾟᾨᾩᾪᾫᾬᾭᾮᾯᾸᾹᾺΆᾼῈΈῊΉῌῘῙῚΊῨῩῪΎῬῸΌῺΏῼΩKÅℲⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅬⅭⅮⅯↃⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏⰀⰁⰂⰃⰄⰅⰆⰇⰈⰉⰊⰋⰌⰍⰎⰏⰐⰑⰒⰓⰔⰕⰖⰗⰘⰙⰚⰛⰜⰝⰞⰟⰠⰡⰢⰣⰤⰥⰦⰧⰨⰩⰪⰫⰬⰭⰮⰯⱠⱢⱣⱤⱧⱩⱫⱭⱮⱯⱰⱲⱵⱾⱿⲀⲂⲄⲆⲈⲊⲌⲎⲐⲒⲔⲖⲘⲚⲜⲞⲠⲢⲤⲦⲨⲪⲬⲮⲰⲲⲴⲶⲸⲺⲼⲾⳀⳂⳄⳆⳈⳊⳌⳎⳐⳒⳔⳖⳘⳚⳜⳞⳠⳢⳫⳭⳲꙀꙂꙄꙆꙈꙊꙌꙎꙐꙒꙔꙖꙘꙚꙜꙞꙠꙢꙤꙦꙨꙪꙬꚀꚂꚄꚆꚈꚊꚌꚎꚐꚒꚔꚖꚘꚚꜢꜤꜦꜨꜪꜬꜮꜲꜴꜶꜸꜺꜼꜾꝀꝂꝄꝆꝈꝊꝌꝎꝐꝒꝔꝖꝘꝚꝜꝞꝠꝢꝤꝦꝨꝪꝬꝮꝹꝻꝽꝾꞀꞂꞄꞆꞋꞍꞐꞒꞖꞘꞚꞜꞞꞠꞢꞤꞦꞨꞪꞫꞬꞭꞮꞰꞱꞲꞳꞴꞶꞸꞺꞼꞾꟀꟂꟄꟅꟆꟇꟉꟋꟌꟐꟖꟘꟚꟜꟵＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ𐐀𐐁𐐂𐐃𐐄𐐅𐐆𐐇𐐈𐐉𐐊𐐋𐐌𐐍𐐎𐐏𐐐𐐑𐐒𐐓𐐔𐐕𐐖𐐗𐐘𐐙𐐚𐐛𐐜𐐝𐐞𐐟𐐠𐐡𐐢𐐣𐐤𐐥𐐦𐐧𐒰𐒱𐒲𐒳𐒴𐒵𐒶𐒷𐒸𐒹𐒺𐒻𐒼𐒽𐒾𐒿𐓀𐓁𐓂𐓃𐓄𐓅𐓆𐓇𐓈𐓉𐓊𐓋𐓌𐓍𐓎𐓏𐓐𐓑𐓒𐓓𐕰𐕱𐕲𐕳𐕴𐕵𐕶𐕷𐕸𐕹𐕺𐕼𐕽𐕾𐕿𐖀𐖁𐖂𐖃𐖄𐖅𐖆𐖇𐖈𐖉𐖊𐖌𐖍𐖎𐖏𐖐𐖑𐖒𐖔𐖕𐲀𐲁𐲂𐲃𐲄𐲅𐲆𐲇𐲈𐲉𐲊𐲋𐲌𐲍𐲎𐲏𐲐𐲑𐲒𐲓𐲔𐲕𐲖𐲗𐲘𐲙𐲚𐲛𐲜𐲝𐲞𐲟𐲠𐲡𐲢𐲣𐲤𐲥𐲦𐲧𐲨𐲩𐲪𐲫𐲬𐲭𐲮𐲯𐲰𐲱𐲲𐵐𐵑𐵒𐵓𐵔𐵕𐵖𐵗𐵘𐵙𐵚𐵛𐵜𐵝𐵞𐵟𐵠𐵡𐵢𐵣𐵤𐵥𑢠𑢡𑢢𑢣𑢤𑢥𑢦𑢧𑢨𑢩𑢪𑢫𑢬𑢭𑢮𑢯𑢰𑢱𑢲𑢳𑢴𑢵𑢶𑢷𑢸𑢹𑢺𑢻𑢼𑢽𑢾𑢿𖹀𖹁𖹂𖹃𖹄𖹅𖹆𖹇𖹈𖹉𖹊𖹋𖹌𖹍𖹎𖹏𖹐𖹑𖹒𖹓𖹔𖹕𖹖𖹗𖹘𖹙𖹚𖹛𖹜𖹝𖹞𖹟𞤀𞤁𞤂𞤃𞤄𞤅𞤆𞤇𞤈𞤉𞤊𞤋𞤌𞤍𞤎𞤏𞤐𞤑𞤒𞤓𞤔𞤕𞤖𞤗𞤘𞤙𞤚𞤛𞤜𞤝𞤞𞤟𞤠𞤡',
    'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįĳĵķĺļľŀłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷÿźżžɓƃƅɔƈɖɗƌǝəɛƒɠɣɩɨƙɯɲɵơƣƥʀƨʃƭʈưʊʋƴƶʒƹƽǆǆǉǉǌǌǎǐǒǔǖǘǚǜǟǡǣǥǧǩǫǭǯǳǳǵƕƿǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟƞȣȥȧȩȫȭȯȱȳⱥȼƚⱦɂƀʉʌɇɉɋɍɏͱͳͷϳάέήίόύώαβγδεζηθικλμνξοπρστυφχψωϊϋσϗϙϛϝϟϡϣϥϧϩϫϭϯθϸϲϻͻͼͽѐёђѓєѕіїјљњћќѝўџабвгдежзийклмнопрстуфхцчшщъыьэюяѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӏӂӄӆӈӊӌӎӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯաբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆⴀⴁⴂⴃⴄⴅⴆⴇⴈⴉⴊⴋⴌⴍⴎⴏⴐⴑⴒⴓⴔⴕⴖⴗⴘⴙⴚⴛⴜⴝⴞⴟⴠⴡⴢⴣⴤⴥⴧⴭꭰꭱꭲꭳꭴꭵꭶꭷꭸꭹꭺꭻꭼꭽꭾꭿꮀꮁꮂꮃꮄꮅꮆꮇꮈꮉꮊꮋꮌꮍꮎꮏꮐꮑꮒꮓꮔꮕꮖꮗꮘꮙꮚꮛꮜꮝꮞꮟꮠꮡꮢꮣꮤꮥꮦꮧꮨꮩꮪꮫꮬꮭꮮꮯꮰꮱꮲꮳꮴꮵꮶꮷꮸꮹꮺꮻꮼꮽꮾꮿᏸᏹᏺᏻᏼᏽᲊაბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰჱჲჳჴჵჶჷჸჹჺჽჾჿḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕßạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿἀἁἂἃἄἅἆἇἐἑἒἓἔἕἠἡἢἣἤἥἦἧἰἱἲἳἴἵἶἷὀὁὂὃὄὅὑὓὕὗὠὡὢὣὤὥὦὧᾀᾁᾂᾃᾄᾅᾆᾇᾐᾑᾒᾓᾔᾕᾖᾗᾠᾡᾢᾣᾤᾥᾦᾧᾰᾱὰάᾳὲέὴήῃῐῑὶίῠῡὺύῥὸόὼώῳωkåⅎⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻⅼⅽⅾⅿↄⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⰰⰱⰲⰳⰴⰵⰶⰷⰸⰹⰺⰻⰼⰽⰾⰿⱀⱁⱂⱃⱄⱅⱆⱇⱈⱉⱊⱋⱌⱍⱎⱏⱐⱑⱒⱓⱔⱕⱖⱗⱘⱙⱚⱛⱜⱝⱞⱟⱡɫᵽɽⱨⱪⱬɑɱɐɒⱳⱶȿɀⲁⲃⲅⲇⲉⲋⲍⲏⲑⲓⲕⲗⲙⲛⲝⲟⲡⲣⲥⲧⲩⲫⲭⲯⲱⲳⲵⲷⲹⲻⲽⲿⳁⳃⳅⳇⳉⳋⳍⳏⳑⳓⳕⳗⳙⳛⳝⳟⳡⳣⳬⳮⳳꙁꙃꙅꙇꙉꙋꙍꙏꙑꙓꙕꙗꙙꙛꙝꙟꙡꙣꙥꙧꙩꙫꙭꚁꚃꚅꚇꚉꚋꚍꚏꚑꚓꚕꚗꚙꚛꜣꜥꜧꜩꜫꜭꜯꜳꜵꜷꜹꜻꜽꜿꝁꝃꝅꝇꝉꝋꝍꝏꝑꝓꝕꝗꝙꝛꝝꝟꝡꝣꝥꝧꝩꝫꝭꝯꝺꝼᵹꝿꞁꞃꞅꞇꞌɥꞑꞓꞗꞙꞛꞝꞟꞡꞣꞥꞧꞩɦɜɡɬɪʞʇʝꭓꞵꞷꞹꞻꞽꞿꟁꟃꞔʂᶎꟈꟊɤꟍꟑꟗꟙꟛƛꟶａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ𐐨𐐩𐐪𐐫𐐬𐐭𐐮𐐯𐐰𐐱𐐲𐐳𐐴𐐵𐐶𐐷𐐸𐐹𐐺𐐻𐐼𐐽𐐾𐐿𐑀𐑁𐑂𐑃𐑄𐑅𐑆𐑇𐑈𐑉𐑊𐑋𐑌𐑍𐑎𐑏𐓘𐓙𐓚𐓛𐓜𐓝𐓞𐓟𐓠𐓡𐓢𐓣𐓤𐓥𐓦𐓧𐓨𐓩𐓪𐓫𐓬𐓭𐓮𐓯𐓰𐓱𐓲𐓳𐓴𐓵𐓶𐓷𐓸𐓹𐓺𐓻𐖗𐖘𐖙𐖚𐖛𐖜𐖝𐖞𐖟𐖠𐖡𐖣𐖤𐖥𐖦𐖧𐖨𐖩𐖪𐖫𐖬𐖭𐖮𐖯𐖰𐖱𐖳𐖴𐖵𐖶𐖷𐖸𐖹𐖻𐖼𐳀𐳁𐳂𐳃𐳄𐳅𐳆𐳇𐳈𐳉𐳊𐳋𐳌𐳍𐳎𐳏𐳐𐳑𐳒𐳓𐳔𐳕𐳖𐳗𐳘𐳙𐳚𐳛𐳜𐳝𐳞𐳟𐳠𐳡𐳢𐳣𐳤𐳥𐳦𐳧𐳨𐳩𐳪𐳫𐳬𐳭𐳮𐳯𐳰𐳱𐳲𐵰𐵱𐵲𐵳𐵴𐵵𐵶𐵷𐵸𐵹𐵺𐵻𐵼𐵽𐵾𐵿𐶀𐶁𐶂𐶃𐶄𐶅𑣀𑣁𑣂𑣃𑣄𑣅𑣆𑣇𑣈𑣉𑣊𑣋𑣌𑣍𑣎𑣏𑣐𑣑𑣒𑣓𑣔𑣕𑣖𑣗𑣘𑣙𑣚𑣛𑣜𑣝𑣞𑣟𖹠𖹡𖹢𖹣𖹤𖹥𖹦𖹧𖹨𖹩𖹪𖹫𖹬𖹭𖹮𖹯𖹰𖹱𖹲𖹳𖹴𖹵𖹶𖹷𖹸𖹹𖹺𖹻𖹼𖹽𖹾𖹿𞤢𞤣𞤤𞤥𞤦𞤧𞤨𞤩𞤪𞤫𞤬𞤭𞤮𞤯𞤰𞤱𞤲𞤳𞤴𞤵𞤶𞤷𞤸𞤹𞤺𞤻𞤼𞤽𞤾𞤿𞥀𞥁𞥂𞥃');
$$;
revoke all on function toki_private.name_key(text) from public,anon,authenticated;
-- END GENERATED NAME CASE MAP
create or replace function toki_private.validate_board()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare item jsonb; person_name jsonb; grp jsonb; member jsonb;
begin
  if octet_length(new.payload::text)>2097152 then raise exception 'Invalid schedule size'; end if;
  if jsonb_typeof(new.payload) is distinct from 'object'
    or jsonb_typeof(new.payload->'people') is distinct from 'array'
    or new.payload->'schemaVersion' is distinct from '4'::jsonb
    or jsonb_typeof(new.payload->'groups') is distinct from 'array'
    or jsonb_typeof(new.payload->'events') is distinct from 'array'
    or jsonb_typeof(new.payload->'meetings') is distinct from 'array' then
    raise exception 'Invalid schedule structure';
  end if;
  if (new.payload - array['schemaVersion','people','groups','events','meetings']) <> '{}'::jsonb then raise exception 'INVALID'; end if;
  if jsonb_array_length(new.payload->'people') not between 0 and 100 or jsonb_array_length(new.payload->'groups') > 50 or jsonb_array_length(new.payload->'events') > 2000 or jsonb_array_length(new.payload->'meetings') > 2000 then
    raise exception 'Invalid schedule size';
  end if;
  for person_name in select value from jsonb_array_elements(new.payload->'people') loop
    if jsonb_typeof(person_name) <> 'string' or toki_private.js_length(person_name#>>'{}') not between 1 and 40 then
      raise exception 'NAME_INVALID';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(new.payload->'people') n(name) where not toki_private.supported_name(name) or name is distinct from toki_private.normalize_name(name) or name ~ U&'[\0001-\001f\007f-\009f]') then raise exception 'NAME_INVALID'; end if;
  if (select count(*)<>count(distinct toki_private.name_key(value)) from jsonb_array_elements_text(new.payload->'people')) then raise exception 'NAME_TAKEN'; end if;
  for grp in select value from jsonb_array_elements(new.payload->'groups') loop
    if jsonb_typeof(grp) is distinct from 'object'
      or jsonb_typeof(grp->'id') is distinct from 'string' or (grp->>'id') !~ '^[a-zA-Z0-9_-]{1,100}$'
      or jsonb_typeof(grp->'name') is distinct from 'string' or toki_private.js_length(grp->>'name') not between 1 and 40
      or not toki_private.supported_name(grp->>'name') or (grp->>'name') is distinct from toki_private.normalize_name(grp->>'name') or (grp->>'name') ~ U&'[\0001-\001f\007f-\009f]'
      or jsonb_typeof(grp->'members') is distinct from 'array' then raise exception 'INVALID'; end if;
    if (grp - array['id','name','members']) <> '{}'::jsonb or jsonb_array_length(grp->'members')>100 then raise exception 'INVALID'; end if;
    for member in select value from jsonb_array_elements(grp->'members') loop
      if jsonb_typeof(member)<>'number' or (member#>>'{}') !~ '^[0-9]+$' or (member#>>'{}')::integer not between 0 and jsonb_array_length(new.payload->'people')-1 then raise exception 'INVALID'; end if;
    end loop;
    if (select count(*)<>count(distinct value) from jsonb_array_elements(grp->'members')) then raise exception 'INVALID'; end if;
  end loop;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(new.payload->'groups')) then raise exception 'INVALID'; end if;
  if (select count(*)<>count(distinct toki_private.name_key(value->>'name')) from jsonb_array_elements(new.payload->'groups')) then raise exception 'NAME_TAKEN'; end if;
  for item in select value from jsonb_array_elements(new.payload->'events') loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'id') is distinct from 'string'
      or toki_private.js_length(item->>'id') not between 1 and 100
      or not (item ? 'person') or (item ? 'group') or (item ? 'title') or (item ? 'detail')
      or ((item ? 'person') and (jsonb_typeof(item->'person') is distinct from 'number' or (item->>'person') !~ '^[0-9]+$' or (item->>'person')::integer not between 0 and jsonb_array_length(new.payload->'people')-1))
      or ((item ? 'group') and (jsonb_typeof(item->'group') is distinct from 'string' or not exists(select 1 from jsonb_array_elements(new.payload->'groups') g where g->>'id'=item->>'group')))
      or jsonb_typeof(item->'date') is distinct from 'string'
      or (item->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(item->'start') is distinct from 'number'
      or jsonb_typeof(item->'end') is distinct from 'number'
      or (item->>'start') !~ '^[0-9]+$' or (item->>'end') !~ '^[0-9]+$'
      or (item->>'start')::integer < 480 or (item->>'end')::integer > 1440
      or (item->>'end')::integer <= (item->>'start')::integer then
      raise exception 'Invalid event';
    end if;
    if (item - array['id','person','date','start','end']) <> '{}'::jsonb then raise exception 'INVALID'; end if;
    begin
      if (item->>'date')::date not between date '0001-01-07' and date '9999-12-25' then raise exception 'INVALID'; end if;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'INVALID';
    end;
  end loop;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(new.payload->'events')) then
    raise exception 'Duplicate event IDs';
  end if;
  for item in select value from jsonb_array_elements(new.payload->'meetings') loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'string' or toki_private.js_length(item->>'id') not between 1 and 100
      or jsonb_typeof(item->'group') is distinct from 'string' or not exists(select 1 from jsonb_array_elements(new.payload->'groups') g where g->>'id'=item->>'group')
      or jsonb_typeof(item->'date') is distinct from 'string' or (item->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(item->'start') is distinct from 'number' or jsonb_typeof(item->'end') is distinct from 'number'
      or (item->>'start') !~ '^[0-9]+$' or (item->>'end') !~ '^[0-9]+$'
      or (item->>'start')::integer < 480 or (item->>'end')::integer > 1440 or (item->>'end')::integer <= (item->>'start')::integer
      or jsonb_typeof(item->'members') is distinct from 'array' then raise exception 'INVALID'; end if;
    if jsonb_array_length(item->'members') not between 1 and 100 or (item - array['id','group','date','start','end','members']) <> '{}'::jsonb then raise exception 'INVALID'; end if;
    begin
      if (item->>'date')::date not between date '0001-01-07' and date '9999-12-25' then raise exception 'INVALID'; end if;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'INVALID'; end;
    for member in select value from jsonb_array_elements(item->'members') loop
      if jsonb_typeof(member)<>'number' or (member#>>'{}') !~ '^[0-9]+$' or (member#>>'{}')::integer not between 0 and jsonb_array_length(new.payload->'people')-1 then raise exception 'INVALID'; end if;
    end loop;
    if (select count(*)<>count(distinct value) from jsonb_array_elements(item->'members')) then raise exception 'INVALID'; end if;
  end loop;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements((new.payload->'events')||(new.payload->'meetings'))) then raise exception 'INVALID'; end if;
  if TG_OP = 'UPDATE' then
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function toki_private.validate_board() from public, anon, authenticated;

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='validate_toki_board' and tgrelid='public.toki_boards'::regclass) then
    create trigger validate_toki_board before insert or update on public.toki_boards
      for each row execute function toki_private.validate_board();
  end if;
end $$;

-- This privileged function is outside the exposed API schema. Every action checks the link.
create or replace function toki_private.share_action(
  p_token text, p_action text, p_registration uuid,
  p_name text, p_payload jsonb, p_version bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  board_id text;
  board public.toki_boards%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'LINK'; end if;
  select l.board_id into board_id from toki_private.share_links l where l.token_hash=sha256(convert_to(p_token,'UTF8'));
  if board_id is null then raise exception 'LINK'; end if;
  if p_action in ('join','save','save_grouped','save_calendar') then raise exception 'UPDATE_REQUIRED'; end if;
  if p_action='save_availability' then
    select * into board from public.toki_boards b where b.id=board_id for update;
    if p_version is distinct from board.version then raise exception 'CONFLICT'; end if;
    if p_payload->'schemaVersion' is distinct from '4'::jsonb then raise exception 'INVALID'; end if;
    update public.toki_boards set payload=p_payload where id=board.id returning * into board;
  elsif p_action in ('read','read_availability') then
    select * into board from public.toki_boards b where b.id=board_id;
  else raise exception 'INVALID'; end if;
  if board.id is null then raise exception 'LINK'; end if;
  -- Old installed pages can still load far enough to show the PWA update button.
  -- Their save endpoint is rejected above, so they cannot overwrite MTG records.
  if p_action='read' then
    board.payload := (board.payload - 'meetings') || jsonb_build_object('schemaVersion',3,
      'events',coalesce((select jsonb_agg(e || jsonb_build_object('title','可能時間','detail','')) from jsonb_array_elements(board.payload->'events') e),'[]'::jsonb));
  end if;
  return jsonb_build_object('payload',board.payload,'version',board.version);
end;
$$;
revoke all on function toki_private.share_action(text,text,uuid,text,jsonb,bigint) from public, anon, authenticated;
grant usage on schema toki_private to anon, authenticated;
grant execute on function toki_private.share_action(text,text,uuid,text,jsonb,bigint) to anon, authenticated;

create or replace function public.toki_share(
  p_token text, p_action text default 'read', p_registration uuid default null,
  p_name text default null, p_payload jsonb default null, p_version bigint default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select toki_private.share_action(p_token,p_action,p_registration,p_name,p_payload,p_version);
$$;
revoke all on function public.toki_share(text,text,uuid,text,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.toki_share(text,text,uuid,text,jsonb,bigint) to anon, authenticated;
-- One-time conversion: keep all individual intervals; group rows become derived views.
-- Old free-text titles/details and independent group slots are intentionally removed.
update public.toki_boards b set payload=jsonb_build_object(
  'schemaVersion',4,'people',payload->'people','groups',coalesce(payload->'groups','[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e->'id','person',e->'person','date',e->'date','start',e->'start','end',e->'end') order by ordinal)
    from jsonb_array_elements(b.payload->'events') with ordinality as entries(e,ordinal) where e ? 'person'),'[]'::jsonb),
  'meetings','[]'::jsonb)
  where payload->'schemaVersion' is distinct from '4'::jsonb;
notify pgrst, 'reload schema';
-- Reapplying the legacy schema must never reopen link-only access after migration.
do $$ begin
  if to_regclass('toki_private.companies') is not null then
    revoke all on function public.toki_share(text,text,uuid,text,jsonb,bigint) from public,anon,authenticated;
    revoke all on function toki_private.share_action(text,text,uuid,text,jsonb,bigint) from public,anon,authenticated;
    revoke all on schema toki_private from public,anon,authenticated;
  end if;
end $$;
commit;
