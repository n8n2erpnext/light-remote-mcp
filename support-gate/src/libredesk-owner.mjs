import crypto from 'node:crypto';

export function sessionCookie(requestCookie) {
 if (typeof requestCookie!=='string'||requestCookie.length>8192)return '';
 const item=requestCookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('libredesk_session='));
 if (!item)return '';
 const value=item.slice('libredesk_session='.length);
 return /^[a-zA-Z0-9_-]{32,128}$/.test(value)?value:'';
}

export function approvedAgent(payload,configuredEmail) {
 const agent=payload?.data;
 if (!agent || agent.enabled!==true || agent.type!=='agent')return null;
 const addr=typeof agent.email==='string'?agent.email:
   typeof agent.email?.String==='string'?agent.email.String:'';
 const email=addr.trim().toLowerCase();
 const permitted=email==='system'||email===configuredEmail.trim().toLowerCase();
 if (!permitted || !Array.isArray(agent.roles) || !agent.roles.includes('Admin'))return null;
 if(!Number.isSafeInteger(agent.id)||agent.id<=0)return null;
 return {email:addr,id:agent.id,role:'Admin'};
}

export function ownerCsrf(cookieValue,secret) {
 return crypto.createHmac('sha256',secret).update('gold-gate-v2\0'+cookieValue).digest('hex');
}
