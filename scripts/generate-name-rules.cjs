// Regenerate the database's locale-independent Unicode case map from Node.
// Final sigma is folded to sigma on both clients and server. U+0130 expands
// to two code points; all other lowercase mappings are single code points.
const fs=require('node:fs');
if(process.versions.unicode!=='16.0')throw Error('Regenerate with Unicode 16.0; review a Unicode upgrade on both database and browsers first.');
const from=[],to=[];
const ranges=[];let rangeStart=null,rangeEnd=null;
for(let code=1;code<=0x10ffff;code++){
  if(code>=0xd800&&code<=0xdfff)continue;
  const c=String.fromCodePoint(code),folded=c.toLowerCase().replace(/\u03c2/gu,'\u03c3');
  if(/\p{Assigned}/u.test(c)){
    if(rangeStart===null){rangeStart=code;rangeEnd=code;}
    else if(code===rangeEnd+1)rangeEnd=code;
    else{ranges.push([rangeStart,rangeEnd]);rangeStart=code;rangeEnd=code;}
  }
  if(c===folded)continue;
  if([...folded].length!==1){if(code!==0x130)throw Error('New expanding case mapping: '+code);continue;}
  from.push(c);to.push(folded);
}
ranges.push([rangeStart,rangeEnd]);
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
const characterClass=escape=>ranges.map(([a,b])=>escape(a)+(a===b?'':'-'+escape(b))).join('');
const sqlRange=characterClass(n=>'\\'+(n>65535?'+':'')+n.toString(16).padStart(n>65535?6:4,'0'));
const sql=`-- BEGIN GENERATED NAME CASE MAP (Unicode ${process.versions.unicode})
create or replace function toki_private.supported_name(value text)
returns boolean language sql immutable strict set search_path='' as $$
  select value !~ U&'[^${sqlRange}]';
$$;
revoke all on function toki_private.supported_name(text) from public,anon,authenticated;
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
const modelFile='model.js',model=fs.readFileSync(modelFile,'utf8');
const jsRange=characterClass(n=>'\\u{'+n.toString(16)+'}');
const js=`// BEGIN GENERATED NAME RULES (Unicode ${process.versions.unicode})
  const caseFrom=[...${JSON.stringify(from.join(''))}],caseTo=[...${JSON.stringify(to.join(''))}];
  const nameCase=new Map(caseFrom.map((c,i)=>[c,caseTo[i]]));nameCase.set('İ','i\\u0307');
  const supportedName=value=>!/[\u005e${jsRange}]/u.test(value);
  const nameKey=value=>[...normalizeName(value)].map(c=>nameCase.get(c)??c).join('');
  // END GENERATED NAME RULES`;
fs.writeFileSync(modelFile,model.replace(/\/\/ BEGIN GENERATED NAME RULES[\s\S]*?\/\/ END GENERATED NAME RULES/,()=>js));
