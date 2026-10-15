// Regenerate the database's locale-independent Unicode case map from Node.
// Final sigma is folded to sigma on both clients and server. U+0130 expands
// to two code points; all other lowercase mappings are single code points.
const fs=require('node:fs');
const from=[],to=[];
for(let code=1;code<=0x10ffff;code++){
  if(code>=0xd800&&code<=0xdfff)continue;
  const c=String.fromCodePoint(code),folded=c.toLowerCase().replace(/\u03c2/gu,'\u03c3');
  if(c===folded)continue;
  if([...folded].length!==1){if(code!==0x130)throw Error('New expanding case mapping: '+code);continue;}
  from.push(c);to.push(folded);
}
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
const sql=`-- BEGIN GENERATED NAME CASE MAP (Unicode ${process.versions.unicode})
create or replace function toki_private.name_key(value text)
returns text language sql immutable strict set search_path='' as $$
  select translate(replace(toki_private.normalize_name(value),chr(304),U&'i\\0307'),
    ${quote(from.join(''))},
    ${quote(to.join(''))});
$$;
revoke all on function toki_private.name_key(text) from public,anon,authenticated;
-- END GENERATED NAME CASE MAP`;
const file='database/schema.sql',source=fs.readFileSync(file,'utf8');
fs.writeFileSync(file,source.replace(/-- BEGIN GENERATED NAME CASE MAP[\s\S]*?-- END GENERATED NAME CASE MAP/,()=>sql));
