import {readFileSync} from 'node:fs';
export function renderAnnouncements(data,{limit=10}={}){
  const items=Array.isArray(data?.items)?data.items.slice(0,Math.max(1,Math.min(25,limit))):[];
  const lines=['','Light Remote · Announcements','---------------------------------------'];
  if(!items.length)lines.push('No announcements currently cached.');
  for(const row of items){
    const category=String(row.kind||'notice').toUpperCase();
    const title=String(row.title||'Light Remote').replace(/[\x00-\x1f\x7f\x1b]/g,' ').slice(0,110);
    const body=String(row.message||'').replace(/[\x00-\x1f\x7f\x1b]/g,' ').slice(0,400);
    lines.push('['+category+'] '+title,'  '+body);
    if(/^https:\/\//.test(String(row.linkUrl||'')))lines.push('  '+String(row.linkUrl));
    lines.push('');
  }
  if(data?.checkedAt)lines.push('Last checked: '+new Date(data.checkedAt).toISOString());
  lines.push('Source: local Agent inbox · Read-only; does not require server availability.','');
  return lines.join('\n');
}
if(process.argv[1]&&process.argv[1].endsWith('cli-announcements.mjs')){
 try{const input=JSON.parse(readFileSync(0,'utf8'));process.stdout.write(renderAnnouncements(input));}
 catch{console.error('Light Remote: announcement inbox unavailable');process.exitCode=1;}
}
