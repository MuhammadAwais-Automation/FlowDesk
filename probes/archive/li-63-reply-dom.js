// @target linkedin.com/feed/update
window.scrollTo(0, document.body.scrollHeight*0.8)
await new Promise(function(r){setTimeout(r,2500)})
function describe(el){return{text:(el.innerText||'').replace(/\s+/g,' ').trim().slice(0,20),label:(el.getAttribute('aria-label')||'').slice(0,55)}}
var replyButtons=[]
var bs=document.querySelectorAll('button')
for(var i=0;i<bs.length;i++){ if(/^Reply to /i.test(bs[i].getAttribute('aria-label')||''))replyButtons.push(describe(bs[i])) }
// click first reply, see editor
var first=null
for(var i=0;i<bs.length;i++){ if(/^Reply to /i.test(bs[i].getAttribute('aria-label')||'')){first=bs[i];break} }
var editorsAfter=[]
if(first){first.click();await new Promise(function(r){setTimeout(r,1500)})
  var eds=document.querySelectorAll('[contenteditable="true"][role="textbox"]')
  for(var i=0;i<eds.length;i++)editorsAfter.push({label:eds[i].getAttribute('aria-label'),placeholder:eds[i].getAttribute('data-placeholder')})
}
return {href:location.href, replyButtonCount:replyButtons.length, replyButtons:replyButtons.slice(0,4), editorsAfterReplyClick:editorsAfter}
