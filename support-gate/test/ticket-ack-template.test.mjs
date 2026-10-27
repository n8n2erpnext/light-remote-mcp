import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../mail-templates/ticket-acknowledgment.html',import.meta.url),'utf8');
const url='https://support.thaiduy.digital/ai-support/t/{{ .Conversation.UUID }}';
test('customer confirmation explicitly links to unauthenticated read-only ticket endpoint',()=>{
 assert.equal(html.split(url).length-1,3);
 assert.match(html,/href="https:\/\/support\.thaiduy\.digital\/ai-support\/t\/\{\{ \.Conversation\.UUID \}\}"/);
 assert.match(html,/View ticket #\{\{ \.Conversation\.ReferenceNumber \}\}/);
 assert.match(html,/without signing in/);
 assert.doesNotMatch(html,/inboxes\/all\/conversation|\?next=|\/admin\/|login/);
});
test('HTML block elements separate the URL from following words',()=>{
 assert.equal((html.match(/<a href=/g)||[]).length,2);
 assert.equal((html.match(/<p>/g)||[]).length,8);
 assert.match(html,/<\/a><\/p>\s*<p>You can reply/);
 assert.match(html,/<\/a><\/p>\s*<p>You can reply/);
 assert.match(html,/copy this complete link into your browser/);
});
