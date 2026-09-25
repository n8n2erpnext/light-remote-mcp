import fs from 'node:fs';

const root=new URL('../../',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,root),'utf8');
const exists=file=>fs.existsSync(new URL(file,root));
const lane=JSON.parse(read('.light-remote-lane.json'));

function expect(value,message){if(!value)throw new Error(message);}
expect(lane.schema===1,'repo_lane_schema_invalid');
expect(typeof lane.id==='string'&&lane.id,'repo_lane_id_missing');
expect(Array.isArray(lane.requiredPaths),'repo_lane_required_paths_missing');
expect(Array.isArray(lane.forbiddenPaths),'repo_lane_forbidden_paths_missing');
for(const file of lane.requiredPaths)expect(exists(file),`repo_lane_required_path_missing:${file}`);
for(const file of lane.forbiddenPaths)expect(!exists(file),`repo_lane_forbidden_path_present:${file}`);

if(lane.id==='primary-vercel'){
  expect(lane.role==='primary'&&lane.transport==='vercel'&&lane.canonicalBranch==='main','primary_lane_identity_invalid');
  expect(lane.developmentAuthority===true&&lane.inheritsFrom===null,'primary_lane_authority_invalid');
}
if(lane.id==='reviewer-direct'){
  expect(lane.role==='reviewer'&&lane.transport==='direct-mcp'&&lane.canonicalBranch==='reviewer/openai','reviewer_lane_identity_invalid');
  expect(lane.inheritsFrom==='main','reviewer_lane_parent_invalid');
}
if(lane.id==='backup-netlify'){
  expect(lane.role==='backup'&&lane.transport==='netlify'&&lane.canonicalBranch==='backup/netlify','netlify_lane_identity_invalid');
  expect(lane.inheritsFrom==='main','netlify_lane_parent_invalid');
}
console.log(`v11-repo-lane=${lane.id}=PASS`);
