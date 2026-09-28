import { restoreActivityRing } from '../../lib/activity-ring.mjs';

function need(value,message){if(!value)throw new Error(message);}
const now=Date.parse('2026-09-25T14:00:00.000Z');
const freshA={id:20,at:'2026-09-25T13:20:00.000Z',type:'job_started',jobId:'a',deviceId:'arm-local',note:'native-search:start'};
const freshB={id:22,at:'2026-09-25T13:50:00.000Z',type:'job_finished',jobId:'b',deviceId:'arm-local'};
const old={id:2,at:'2026-09-25T12:40:00.000Z',type:'job_started',jobId:'old',deviceId:'arm-local'};
const files=['old','new'],data={
 old:[JSON.stringify(old),JSON.stringify(freshB),'bad-json'].join('\n'),
 new:[JSON.stringify(freshA),JSON.stringify(freshB)].join('\n')
};
const restored=restoreActivityRing({files,readText:file=>data[file],now,maxAgeMs:60*60*1000,maxEvents:10,maxBytes:1024*1024});
need(restored.ring.length===2,'activity_ring_recent_filter_or_dedupe_failed');
need(restored.ring[0].event.jobId==='a'&&restored.ring[1].event.jobId==='b','activity_ring_sort_failed');
need(restored.sequence===22,'activity_ring_sequence_restore_failed');
const capped=restoreActivityRing({files:['x'],readText:()=>[
 JSON.stringify({id:1,at:'2026-09-25T13:57:00.000Z',type:'x',detail:'a'.repeat(80)}),
 JSON.stringify({id:2,at:'2026-09-25T13:58:00.000Z',type:'x',detail:'b'.repeat(80)}),
 JSON.stringify({id:3,at:'2026-09-25T13:59:00.000Z',type:'x',detail:'c'.repeat(80)})
].join('\n'),now,maxAgeMs:60*60*1000,maxEvents:2,maxBytes:1024*1024});
need(capped.ring.length===2&&capped.ring[0].event.id===2&&capped.ring[1].event.id===3,'activity_ring_event_cap_failed');
console.log('v11-activity-ring-disk-restore=PASS');
console.log('v11-activity-ring-dedupe-age-cap=PASS');
