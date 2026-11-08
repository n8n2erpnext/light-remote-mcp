import PDFDocument from 'pdfkit';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {brandFor,redactTicketText,ticketStatus,ticketWhen,outputTimestamp,MAX_EXPORT_MESSAGES} from './public-ticket.mjs';

const fontCandidates=['/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
const logoRoot=new URL('../public/branding/',import.meta.url);
export function pdfFontPath(){return fontCandidates.find(existsSync)||null;}
// The PDF contains conversation text, never the bearer URL, access code or authorization cookie.
export function createTicketPDF(ticket,messages,{exportedAt=new Date()}={}){
 if(!Array.isArray(messages)||messages.length>MAX_EXPORT_MESSAGES)throw Error('ticket_export_too_large');
 const brand=brandFor(ticket);
 const doc=new PDFDocument({size:'A4',margins:{top:46,bottom:70,left:48,right:48},bufferPages:true,
  info:{Title:brand.name+' Support - Ticket #'+String(ticket.reference_number),Author:brand.name+' Support Center',Subject:'Customer support transcript'}});
 const font=pdfFontPath();
 if(font)doc.registerFont('body',font);
 const fontName=font?'body':'Helvetica';
 const boldName=font?'body':'Helvetica-Bold';
 const pageWidth=doc.page.width,margin=48,contentWidth=pageWidth-margin*2;
 const ink='#1b2e43',secondary='#60748a';
 const logo=fileURLToPath(new URL(brand.logo,logoRoot));
 doc.save().rect(0,0,pageWidth,96).fill('#15263a').restore();
 doc.image(logo,margin,19,{fit:[52,52]});
 doc.font(fontName).fontSize(18).fillColor('#ffffff').text(brand.name+' Support',112,35,{width:380});
 doc.font(fontName).fontSize(9).fillColor('#c3d1e3').text('CUSTOMER SUPPORT TRANSCRIPT',margin,111);
 doc.font(fontName).fontSize(17).fillColor(ink).text(String(ticket.subject||'Support request').slice(0,320),margin,134,{width:contentWidth});
 doc.moveDown(.65);
 doc.font(fontName).fontSize(9).fillColor(secondary).text('Ticket #'+String(ticket.reference_number)+'    Status: '+ticketStatus(ticket)+'    Created: '+ticketWhen(ticket.created_at),{width:contentWidth});
 doc.moveDown(.4);
 doc.font(fontName).fontSize(9).fillColor(secondary).text('Confirmation sent · Conversation history · '+messages.length+' message(s)',{width:contentWidth});
 doc.moveDown(1.2);
 doc.moveTo(margin,doc.y).lineTo(pageWidth-margin,doc.y).strokeColor('#d9e2ec').stroke();
 doc.moveDown(.75);
 for(const m of messages){
  if(doc.y>doc.page.height-125)doc.addPage();
  const staff=m.type==='outgoing';
  doc.font(boldName).fontSize(10).fillColor(staff?'#24588c':ink).text((staff?'Support team':'Customer')+'  ·  '+ticketWhen(m.created_at),{width:contentWidth});
  doc.moveDown(.2);
  doc.font(fontName).fontSize(9.5).fillColor(ink).text(redactTicketText(String(m.text_content||'').slice(0,4000)),{width:contentWidth,lineGap:3,align:'left'});
  doc.moveDown(.8);
  if(doc.y<doc.page.height-94){
   doc.moveTo(margin,doc.y).lineTo(pageWidth-margin,doc.y).strokeColor('#e2e8ef').stroke();
   doc.moveDown(.8);
  }
 }
 const range=doc.bufferedPageRange();
 for(let i=range.start;i<range.start+range.count;i++){
  doc.switchToPage(i);
  const originalBottom=doc.page.margins.bottom,footerY=doc.page.height-62;
  doc.page.margins.bottom=5;
  doc.moveTo(margin,footerY-5).lineTo(pageWidth-margin,footerY-5).strokeColor('#d9e2ec').stroke();
  doc.font(fontName).fontSize(7.5).fillColor(secondary)
   .text('https://support.thaiduy.digital/',margin,footerY,{width:205,height:12,lineBreak:false,link:'https://support.thaiduy.digital/'});
  doc.text(brand.email,margin,footerY+12,{width:270,height:12,lineBreak:false,link:'mailto:'+brand.email});
  doc.text('Exported: '+outputTimestamp(exportedAt),margin,footerY+25,{width:340,height:12,lineBreak:false});
  doc.font(fontName).fontSize(8).fillColor(secondary).text('Page '+(i+1)+' / '+range.count,pageWidth-140,footerY+25,{width:92,height:12,align:'right',lineBreak:false});
  doc.page.margins.bottom=originalBottom;
 }
 doc.end();
 return doc;
}
