import {audioBytes} from './audio-transport.js';
import {clamp,lerp,smoothstep,segmentInOut,timeline,PhaseClock} from './engine.js';
const app=document.querySelector('#app'),root=document.documentElement,access=document.querySelector('#access'),withdraw=document.querySelector('#withdraw');
const reduce=matchMedia('(prefers-reduced-motion: reduce)'),EASE='cubic-bezier(.22,1,.36,1)';
let scene='landing',booting=true,busy=false,session=null,measuring=false,clock=null,context=null,source=null,buffer=null,audioPreparing=null,audioExpectedStop=false,recallOrder=[],recallIndex=0,itemPresented=null,saveChain=Promise.resolve(),interrupted=false,watchdog=null,lastWatch=null,cinemaRAF=null,mouse={x:0,y:0,tx:0,ty:0},smoothScroll=0;
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=()=>({timestamp:new Date().toISOString(),monotonic_ms:performance.now()});
let audioLoading=null,transitionVersion=0,recordFilter='';
function stopAudio(){
 audioLoading?.abort();audioLoading=null;
 audioExpectedStop=true;
 if(source){source.onended=null;try{source.stop();}catch{}try{source.disconnect();}catch{}source=null;}
 if(context){context.onstatechange=null;if(context.state!=='closed')context.close().catch(()=>{});}
 buffer=null;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let webMCPLifecycle=null;
function registerResearcherTools(){
 const registry=document.modelContext;if(!registry?.registerTool||webMCPLifecycle)return;
 webMCPLifecycle=new AbortController();
 const validate=input=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw Error('This read tool accepts an empty object.');};
 for(const [name,title,path] of [['researcher_read_audio_readiness','Read audio readiness','/api/admin/audio'],['researcher_read_summary','Read researcher summary','/api/admin/records']]){
  const tool={name,title,description:title+' in the authenticated researcher workspace. Does not start or change a session.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:async input=>{validate(input);if(!['setup','results','record'].includes(scene))throw Error('Researcher workspace required.');const data=await api(path);return path.endsWith('records')?{stats:data.stats,record_count:data.records.length}:data;}};
  try{Promise.resolve(registry.registerTool(tool,{signal:webMCPLifecycle.signal})).catch(()=>{});}catch{}
 }
}
async function api(path,body){const res=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});let data;try{data=await res.json();}catch{throw Error('The study server is unavailable. Please contact the researcher.');}if(!res.ok)throw Error(data.error||'The request could not be completed.');return data;}
function toast(text){const n=document.querySelector('#notice');n.textContent=text;n.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.hidden=true,6000);}
function events(items){const pending=saveChain.then(()=>api('/api/events',{events:items}));saveChain=pending.catch(error=>{if(measuring&&!interrupted)halt('A timing record could not be saved: '+error.message);});return pending;}
function event(name,extra={},time=stamp()){return{name,...time,...extra};}
const foot=()=>'<div class="hero-foot"><span>LISTEN. LEARN. RECALL.</span><span>10–15 MINUTES <span class="dot">•</span> HEADPHONES REQUIRED</span></div>';
const pill=(label,id)=>`<button class="pill" id="${id}">${label} <span aria-hidden="true">↗</span></button>`;
function bind(id,fn){const el=document.getElementById(id);if(el)el.onclick=fn;}
function stopCinema(){cancelAnimationFrame(cinemaRAF);cinemaRAF=null;root.style.setProperty('--mx',0);root.style.setProperty('--my',0);}
function cinemaTick(){cinemaRAF=null;if(measuring||scene==='interview')return;
 mouse.x=reduce.matches?0:lerp(mouse.x,mouse.tx,.12);mouse.y=reduce.matches?0:lerp(mouse.y,mouse.ty,.12);
 root.style.setProperty('--mx',mouse.x.toFixed(4));root.style.setProperty('--my',mouse.y.toFixed(4));
 let unsettled=Math.abs(mouse.x-mouse.tx)>.001||Math.abs(mouse.y-mouse.ty)>.001;
 if(scene==='debrief'){
  const target=clamp(-document.querySelector('.debrief-scroll').getBoundingClientRect().top,0,3700);
  smoothScroll=reduce.matches?target:lerp(smoothScroll,target,.14);if(Math.abs(smoothScroll-target)<.08)smoothScroll=target;
  const ranges=[[0,0,480,760],[560,900,1300,1620],[1440,1770,2130,2400],[2230,2550,2920,3210],[3020,3400,3900,4100]];
  document.querySelectorAll('.debrief-panel').forEach((panel,i)=>{
   const [a,b,c,d]=ranges[i],v=i===0?{enter:1,exit:smoothstep(c,d,smoothScroll),active:1-smoothstep(c,d,smoothScroll)}:segmentInOut(smoothScroll,a,b,c,d);
   panel.style.opacity=v.active;panel.style.visibility=v.active>.005?'visible':'hidden';panel.inert=v.active<.5;
   panel.style.pointerEvents=v.active>.5?'auto':'none';
   panel.style.transform=`translate3d(-50%,calc(-50% + ${reduce.matches?0:(1-v.enter)*58-v.exit*86}px),0) scale(${reduce.matches?1:1+v.exit*.05})`;
   panel.style.filter=`blur(${reduce.matches?0:(1-v.active)*5}px)`;
  });
  root.style.setProperty('--depth',1+clamp(smoothScroll/2700)*.2);root.style.setProperty('--blur',`${reduce.matches?0:Math.sin(clamp(smoothScroll/3700)*Math.PI)*7}px`);
  const index=clamp(Math.round(smoothScroll/850),0,4);document.querySelector('#debrief-index').textContent=`0${index+1} / 05`;
  const next=document.querySelector('#debrief-next');next.disabled=target>=3400;next.textContent=target>=3400?'Final chapter':'Continue ↓';
  unsettled=unsettled||Math.abs(smoothScroll-target)>.08;
 }
 if(!reduce.matches&&unsettled)requestCinema();
}
function requestCinema(){if(!measuring&&scene!=='interview'&&cinemaRAF===null)cinemaRAF=requestAnimationFrame(cinemaTick);}
addEventListener('pointermove',e=>{if(measuring||scene==='interview')return;mouse.tx=e.clientX/innerWidth-.5;mouse.ty=e.clientY/innerHeight-.5;requestCinema();},{passive:true});
addEventListener('scroll',requestCinema,{passive:true});addEventListener('resize',()=>{if(measuring)halt('Viewport dimensions changed during measurement.');else requestCinema();},{passive:true});reduce.addEventListener('change',requestCinema);
async function transition(html,next,{measurement=false}={}){
 const version=++transitionVersion;
 document.querySelector('#researcher-entry').disabled=true;
 const previous=app.firstElementChild;window.scrollTo({top:0,behavior:'instant'});
 if(measurement)document.querySelector('#world').style.opacity='0';
 if(previous&&document.body.classList.contains('measurement')&&!measurement){
  const exit=previous.animate([{opacity:1},{opacity:0}],{duration:reduce.matches?0:650,easing:EASE});await exit.finished;exit.cancel();
 }else if(previous){previous.classList.add('scene-out');await sleep(reduce.matches?0:(measurement?850:650));}
 if(version!==transitionVersion)return false;
 scene=next;
 if(!['setup','results','record'].includes(next)){webMCPLifecycle?.abort();webMCPLifecycle=null;}
 if(measurement){stopCinema();document.body.classList.add('measurement');measuring=true;}
 else{measuring=false;document.body.classList.remove('measurement');document.querySelector('#world').style.opacity='1';root.style.setProperty('--depth',1.04);root.style.setProperty('--blur','0px');}
 app.innerHTML=html;const incoming=app.firstElementChild;
 const enteringButtons=incoming&&!measurement?[...incoming.querySelectorAll('button,input,textarea,select')].map(b=>({button:b,disabled:b.disabled})):[];
 if(incoming&&!measurement){incoming.classList.add('scene-in');incoming.inert=true;enteringButtons.forEach(({button})=>button.disabled=true);}
 if(measurement){ // Fade is complete before audio preparation is permitted to start.
  if(incoming&&!reduce.matches){const entry=incoming.animate([{opacity:0},{opacity:1}],{duration:650,easing:EASE});await entry.finished;entry.cancel();}
 }else{requestCinema();await sleep(reduce.matches?0:800);incoming?.classList.remove('scene-in');if(incoming)incoming.inert=false;enteringButtons.forEach(({button,disabled})=>button.disabled=disabled);}
 if(version!==transitionVersion)return false;
 document.querySelector('#researcher-entry').disabled=booting;
 return true;
}
async function action(button,fn,{tactile=true}={}){
 if(busy||button?.disabled)return;busy=true;if(button){button.disabled=true;button.classList.add('confirmed');}
 try{if(tactile&&!measuring)await sleep(reduce.matches?0:180);await fn();}
 catch(e){toast(e.message);}
 finally{busy=false;if(button?.isConnected){button.disabled=false;button.classList.remove('confirmed');}}
}
function openAccess(){if(measuring||booting||busy)return;document.querySelector('#password').value='';document.querySelector('#access-error').textContent='';access.showModal();setTimeout(()=>document.querySelector('#password').focus(),0);}
bind('researcher-entry',openAccess);bind('initial-access',openAccess);document.querySelector('#researcher-entry').disabled=true;document.querySelector('#initial-access').disabled=true;document.querySelector('.dialog-close').onclick=()=>access.close();
document.querySelector('.site-logo').onclick=e=>{e.preventDefault();if(!session&&!busy)openAccess();};
const bootstrap=await api('/api/bootstrap').catch(e=>{toast(e.message);return{};});
if(bootstrap.initialized===false){document.querySelector('#access-title').textContent='Create your workspace.';document.querySelector('#access-description').textContent='Set a researcher password of at least 8 characters. Keep it private; it protects the participant records on this Mac.';document.querySelector('#password').autocomplete='new-password';}
document.querySelector('#access-form').onsubmit=async e=>{
 e.preventDefault();const button=e.submitter;button.disabled=true;app.inert=true;
 const previousControls=[...app.querySelectorAll('input,button,textarea,select')].map(control=>({control,disabled:control.disabled}));previousControls.forEach(({control})=>control.disabled=true);
 try{await api('/api/auth',{password:document.querySelector('#password').value});document.querySelector('#access-title').textContent='Welcome back.';document.querySelector('#access-description').textContent='Enter the researcher password to manage sessions.';document.querySelector('#password').autocomplete='current-password';access.close();session=null;withdraw.hidden=true;document.querySelector('.demo-badge')?.remove();document.querySelector('#header').hidden=false;interrupted=false;await showSetup();}
 catch(err){document.querySelector('#access-error').textContent=err.message;}
 finally{button.disabled=false;app.inert=false;previousControls.forEach(({control,disabled})=>{if(control.isConnected)control.disabled=disabled;});}
};
if(bootstrap.session_status==='interrupted')await showStopped('Session interrupted.','Please speak to the researcher before continuing. Your unfinished session has been flagged for review.');
else if(bootstrap.admin)await showSetup();
booting=false;document.querySelector('#researcher-entry').disabled=false;const initialAccess=document.querySelector('#initial-access');if(initialAccess)initialAccess.disabled=false;
requestCinema();

function workspaceHeader(selected){return`<div class="workspace-title"><div><div class="eyebrow">RESEARCHER WORKSPACE</div><h2>${selected==='setup'?'Prepare a session.':'The collected evidence.'}</h2></div><nav class="workspace-nav" aria-label="Researcher workspace"><button id="setup-tab" class="${selected==='setup'?'selected':''}" ${selected==='setup'?'disabled aria-current="page"':''}>Session setup</button><button id="results-tab" class="${selected==='results'?'selected':''}" ${selected==='results'?'disabled aria-current="page"':''}>Records & results</button></nav></div>`;}
function bindWorkspace(){registerResearcherTools();bind('setup-tab',e=>action(e.currentTarget,showSetup));bind('results-tab',e=>action(e.currentTarget,showResults));}
async function showSetup(){
 const info=await api('/api/admin/audio');
 await transition(`<section class="scene workspace">${workspaceHeader('setup')}<div class="setup-layout"><form id="setup-form" class="setup-card"><div class="eyebrow">01 / ASSIGNMENT</div><h3>A new participant.</h3><label>Participant ID<input name="participant_id" id="participant-id" placeholder="P01" required maxlength="20" pattern="(?:[A-Za-z0-9_]|-)+" autocomplete="off"></label><label>Auditory condition — researcher only</label><div class="condition-choice"><label><input type="radio" name="condition" value="Experimental" required>Experimental</label><label><input type="radio" name="condition" value="Control" required>Control</label></div><label class="toggle"><input type="checkbox" id="demo-mode"><span>Accelerated Demo Mode<small>Test data only · excluded from real statistics</small></span></label><div id="demo-confirm-wrap" hidden><div class="demo-alert">DEMO ONLY. 2-second adaptation and 0.4 seconds per item. Uses a test tone, regardless of assignment. A visible DEMO banner stays on screen. Do not use for real participants.</div><label>Type DEMO to confirm<input id="demo-confirm" autocomplete="off" placeholder="DEMO"></label></div><p class="micro">Before a real session: verify headphones, comfortable system volume, left/right routing, a quiet room, browser zoom at 100%, and a stable window size. Prevent the Mac from sleeping. Follow your class allocation plan.</p><p class="form-error" id="setup-error" role="alert"></p>${pill('Begin Participant Session','begin-session')}</form><aside class="setup-card"><div class="eyebrow">02 / READINESS</div><h3>Check the listening setup.</h3><p>Real sessions require both verified study WAV files. The participant will see no condition information.</p>${['Experimental','Control','Demo'].map(c=>`<div class="audio-check"><div class="audio-line"><span>${c==='Demo'?'Demo test fixture':c+' audio'}</span><span class="status-tag ${info[c]?.ready?'':'bad'}">${info[c]?.ready?'Ready':'Not ready'}</span></div><small>${escapeHTML(info[c]?.file)}<br>${info[c]?.ready?`Stereo · ${info[c].duration_seconds.toFixed(1)} s · ${info[c].sample_rate.toLocaleString()} Hz`:escapeHTML(info[c]?.error)}</small></div>`).join('')}<p class="micro">Tone, duration and stereo checks are automated. Hardware volume and channel routing require an external listening check. Test tones must never substitute for real experimental material.</p><button type="button" class="text-button" id="recheck-audio">Recheck audio files ↻</button></aside></div></section>`,'setup');
 bindWorkspace();bind('recheck-audio',e=>action(e.currentTarget,async()=>{
  const info=await api('/api/admin/audio');
  document.querySelectorAll('.audio-check').forEach((row,index)=>{
   const item=info[['Experimental','Control','Demo'][index]],tag=row.querySelector('.status-tag');
   tag.textContent=item?.ready?'Ready':'Not ready';tag.classList.toggle('bad',!item?.ready);
   row.querySelector('small').innerHTML=escapeHTML(item?.file)+'<br>'+(item?.ready?`Stereo · ${item.duration_seconds.toFixed(1)} s · ${item.sample_rate.toLocaleString()} Hz`:escapeHTML(item?.error));
  });
 },{tactile:false}));
 document.querySelector('#demo-mode').onchange=e=>{document.querySelector('#demo-confirm-wrap').hidden=!e.target.checked;document.querySelector('#demo-confirm').required=e.target.checked;};
 document.querySelector('#setup-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{
  const form=new FormData(e.target),demo=document.querySelector('#demo-mode').checked;
  try{session=await api('/api/admin/create',{participant_id:form.get('participant_id'),condition:form.get('condition'),demo,demo_confirmation:document.querySelector('#demo-confirm').value});}
  catch(err){document.querySelector('#setup-error').textContent=err.message;throw err;}
  currentRecords=[];recordFilter='';document.querySelector('#header').hidden=true;document.querySelector('#notice').hidden=true;withdraw.hidden=false;interrupted=false;
  if(session.demo){const badge=document.createElement('div');badge.className='demo-badge';badge.textContent='DEMO ONLY · ACCELERATED · TEST DATA';document.body.append(badge);}
  await showPreface();
 });};
}
async function showPreface(){
 await transition(`<section class="scene hero"><div class="eyebrow">AUDITORY STIMULATION STUDY</div><h1>MEMORY</h1><div class="hero-bottom"><p>An experimental study of auditory stimulation<br>and immediate associative recall.</p>${pill('Explore the study','preface-next')}</div>${foot()}</section>`,'preface');
 bind('preface-next',e=>action(e.currentTarget,async()=>{await api('/api/scene',{scene:'information'});await showInformation();}));
}
async function showInformation(){
 await transition(`<section class="scene editorial"><div class="title-side"><div class="eyebrow">BEFORE WE BEGIN / 01</div><h1>Study<br>information.</h1><p class="small-note">A few moments to understand the experience ahead.</p></div><div class="content-side"><div class="chapter-number">Listen. Learn. Recall.</div><p>This study investigates the relationship between auditory stimulation and learning performance.</p><p>You will listen to an auditory stimulus through headphones while completing a short learning task, followed by a recall task and a brief interview.</p><p>Learn the association between each uppercase item and the word beneath it. You will see the same sequence twice. During recall, type the associated word for each uppercase item. You may submit a blank answer if you do not remember.</p><div class="meta-pills"><span>Approximately 10–15 minutes</span><span>Headphones throughout learning</span></div>${pill('Continue','information-next')}</div></section>`,'information');
 bind('information-next',e=>action(e.currentTarget,async()=>{await api('/api/scene',{scene:'consent'});await showConsent();}));
}
async function showConsent(){
 const rights=[['Voluntary participation','Your participation is voluntary.'],['Right to withdraw','You may stop participating at any time without giving a reason or facing any penalty. If you withdraw, you may ask the researchers not to use the data collected from your session.'],['Protection from harm','The audio will be played at a comfortable volume. If you experience discomfort or wish to stop for any reason, you may end your participation immediately.'],['Confidentiality','Your data will be stored using a participant ID rather than your name and will only be used for this class research project.']];
 await transition(`<section class="scene consent-scene"><div class="editorial"><div class="title-side"><div class="eyebrow">BEFORE WE BEGIN / 02</div><h1>Your choice.<br>Your participation.</h1><p class="small-note">You will listen to an auditory stimulus, learn paired items, complete an immediate recall task, and answer several short questions afterward.</p></div><div class="content-side"><div class="ethics-grid">${rights.map(([title,text],i)=>`<article class="cream-card"><span class="eyebrow">0${i+1} / YOUR RIGHTS</span><h3>${title}</h3><p>${text}</p></article>`).join('')}</div><div class="eyebrow">CONSENT TO PARTICIPATE</div><p class="micro">By continuing, I confirm that:</p><ul class="consent-list"><li>I have read and understood the information above.</li><li>I understand what I will be asked to do.</li><li>I understand that participation is voluntary.</li><li>I understand that I may withdraw at any time.</li><li>I consent to my anonymized responses being used for this class research project.</li></ul>${pill('I consent and wish to participate','consent-next')}</div></div></section>`,'consent');
 bind('consent-next',e=>action(e.currentTarget,async()=>{await api('/api/scene',{scene:'headphones',consent:true});await showHeadphones();}));
}
async function showHeadphones(){
 await transition(`<section class="scene hero headphones"><div class="eyebrow">BEFORE WE BEGIN / 03</div><h1>HEADPHONES</h1><div class="hero-bottom"><p>Please put on your headphones.</p><p>Make sure both the left and right sides are positioned correctly and the volume is comfortable.</p><p>Once the experiment begins, please do not remove or adjust your headphones unless you feel uncomfortable or wish to withdraw.</p><p class="micro" id="audio-progress" role="status" aria-live="polite">Preparing study audio…</p>${pill('I’m ready','headphones-next')}</div>${foot()}</section>`,'headphones');
 // Decode the assigned, immutable WAV before the readiness click. No source starts here.
 if(interrupted||scene!=='headphones')return;
 const loading=new AbortController();audioLoading=loading;
 const progress=document.querySelector('#audio-progress');
 const button=document.querySelector('#headphones-next');button.disabled=true;
 audioPreparing=(async()=>{
  const AudioContext=window.AudioContext||window.webkitAudioContext;
  if(!AudioContext)throw Error('This browser cannot play the study audio. Ask the researcher.');
  const preparedContext=new AudioContext({latencyHint:'playback'});context=preparedContext;
  const [procedure,response]=await Promise.all([api('/api/procedure',{}),fetch('/api/audio',{signal:loading.signal})]);
  if(!response.ok)throw Error('The required study audio could not be loaded.');
  const bytes=await audioBytes(response,{signal:loading.signal,onProgress:(done,total)=>{progress.textContent=done===total?'Verifying and preparing audio…':`Preparing study audio… ${Math.floor(done/total*100)}%`;}});
  loading.signal.throwIfAborted();
  const decoded=await preparedContext.decodeAudioData(bytes);
  loading.signal.throwIfAborted();
  buffer=decoded;
  if(buffer.numberOfChannels!==2)throw Error('Stereo audio decoding failed.');
  return procedure;
 })();
 try{await audioPreparing;if(scene==='headphones'&&!interrupted){button.disabled=false;progress.textContent='Audio ready. Begin when you are comfortable.';}}
 catch(err){if(loading.signal.aborted||interrupted)return;await halt('Audio preflight failed: '+err.message);return;}
 button.onclick=e=>{
  if(busy||button.disabled||interrupted||scene!=='headphones')return;
  // Resume is invoked directly in this trusted click for Safari/Chromium autoplay rules.
  const unlocked=context.resume();
  action(e.currentTarget,()=>startProcedure(unlocked));
 };
}
async function startProcedure(unlocked){
 try{
  const procedure=await audioPreparing;await unlocked;await document.fonts.load('500 56px "Ogg Medium"');await document.fonts.ready;
  if(interrupted)return;
  if(!document.fonts.check('500 56px "Ogg Medium"'))throw Error('The study font could not be loaded.');
  await transition('<section class="measure-screen"><p class="adaptation-copy">Please listen quietly.<br>The learning task will begin automatically.</p></section>','adaptation',{measurement:true});
  if(interrupted||scene!=='adaptation')return;
  const complete=event('transition_complete');
  if(context.state!=='running')throw Error('The audio device is not running.');
  source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.loop=false;audioExpectedStop=false;
  source.onended=()=>{if(!audioExpectedStop&&measuring)halt('The study audio ended unexpectedly.');};
  context.onstatechange=()=>{if(measuring&&!audioExpectedStop&&context.state!=='running')halt('The audio device was suspended or interrupted.');};
  const audioStart=event('audio_start'),sourceAudioTime=context.currentTime;source.start();
  const timeBefore=context.currentTime;await sleep(45);
  if(interrupted)return;
  if(context.state!=='running'||context.currentTime<=timeBefore)throw Error('Audio playback could not be confirmed.');
  await events([complete,audioStart]);
  if(interrupted)return;
  const requiredSeconds=(procedure.protocol.adaptation_ms+procedure.pairs.length*2*procedure.protocol.stimulus_ms)/1000;
  if(buffer.duration-(context.currentTime-sourceAudioTime)<requiredSeconds)throw Error('The audio has insufficient remaining duration after playback confirmation.');
  recallOrder=[];recallIndex=0;
  clock=new PhaseClock(timeline(procedure.protocol,procedure.pairs.length),(entry,t)=>boundary(entry,t,procedure.pairs),(deviation)=>{
   halt(`A procedure deadline was missed by ${Math.round(deviation)} ms.`,deviation);
  },procedure.deviation_threshold_ms);
  clock.start();startWatchdog();
 }catch(err){await halt('Audio/procedure could not start: '+err.message);}
}
function startWatchdog(){
 lastWatch={mono:performance.now(),wall:Date.now()};clearInterval(watchdog);
 watchdog=setInterval(()=>{
  if(!measuring)return;const mono=performance.now(),wall=Date.now();
  if(mono-lastWatch.mono>1500||Math.abs((wall-lastWatch.wall)-(mono-lastWatch.mono))>1000)halt('Sleep/wake, clock change, or a blocked browser interrupted measurement.');
  lastWatch={mono,wall};
 },250);
}
function boundary(entry,t,pairs){
 if(interrupted)return;const ts={timestamp:new Date().toISOString(),monotonic_ms:t.actual};
 if(entry.phase==='learning'){
  scene='learning';
  if(!document.querySelector('.stimulus'))app.innerHTML='<section class="measure-screen"><div class="stimulus"><h1 class="cue"></h1><p class="target"></p></div></section>';
  document.querySelector('.cue').textContent=pairs[entry.index][0];document.querySelector('.target').textContent=pairs[entry.index][1];
  const batch=entry.events.map(name=>event(name,{},ts));batch.push(event('stimulus',{round:entry.round,index:entry.index,scheduled_monotonic_ms:t.scheduled,deviation_ms:t.deviation},ts));events(batch).catch(()=>{});
 }else if(entry.phase==='recall'){
  app.replaceChildren();stopAudio();
  clearInterval(watchdog);scene='recall';
  // All encoding events are persisted in order before the first response can be made.
  const stopStamp=stamp();const recallStamp=stamp();
  events([event('round_2_end',{},ts),event('audio_stop',{},stopStamp),event('recall_start',{},recallStamp)]).then(result=>{
   if(interrupted)return;recallOrder=result.recall_order;showRecall();startWatchdog();
  }).catch(()=>{});
 }else{events(entry.events.map(name=>event(name,{},ts))).catch(()=>{});}
}
function showRecall(){
 app.innerHTML=`<section class="measure-screen"><form class="recall-form" id="recall-form" autocomplete="off"><h1 class="cue">${escapeHTML(recallOrder[recallIndex])}</h1><label class="sr-only" for="answer">Associated word</label><input id="answer" name="answer-${recallIndex}" type="text" aria-label="Associated word" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="500">${pill('Submit / Next','recall-next')}<p class="recall-hint">Type the associated word.<br>You may leave this blank if you do not remember.</p><p id="recall-error" class="form-error" role="alert"></p></form></section>`;
 itemPresented=stamp();document.querySelector('#answer').focus({preventScroll:true});
 document.querySelector('#recall-form').onsubmit=async e=>{
  e.preventDefault();const button=e.submitter;if(button.disabled||busy||interrupted)return;
  button.disabled=true;document.querySelector('#answer').readOnly=true;const submitted=stamp(),raw=document.querySelector('#answer').value;busy=true;
  try{
   const result=await api('/api/recall',{index:recallIndex,raw,presentation_timestamp:itemPresented.timestamp,presentation_monotonic_ms:itemPresented.monotonic_ms,submission_timestamp:submitted.timestamp,submission_monotonic_ms:submitted.monotonic_ms});
   if(interrupted)return;recallIndex++;
   if(result.measurement_complete){measuring=false;clearInterval(watchdog);clock?.stop();await showInterview();}
   else showRecall();
  }catch(err){await halt('A recall response could not be saved: '+err.message);}
  finally{busy=false;}
 };
}
const questions=['How would you describe your experience during the learning task?','Did you notice anything about the audio? If so, what?','Did you feel the audio affected the way you learned the word pairs? Please explain.','How difficult did you find the memory task?','Did you use any particular strategy to remember the word pairs?','What do you think the purpose of this experiment was?'];
async function showInterview(){
 stopCinema();
 await transition(`<section class="scene interview"><div class="eyebrow">AFTER THE TASK / A SHORT INTERVIEW</div><h2>Your experience.</h2><p>The learning and recall tasks are complete. Please share your experience in your own words.</p><form id="interview-form"><div class="interview-grid">${questions.map((q,i)=>`<label><span class="question-no">0${i+1}</span>${q}<textarea name="q${i}" maxlength="5000" spellcheck="false" autocomplete="off"></textarea></label>`).join('')}</div><div class="rating-grid">${[['focus','Perceived focus'],['distraction','Perceived distraction'],['difficulty','Perceived task difficulty']].map(([name,label])=>`<label>${label} (optional)<select name="${name}"><option value="">Choose a rating</option>${Array.from({length:7},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select><small>1 = very low · 7 = very high</small></label>`).join('')}</div>${pill('Submit interview','interview-next')}</form></section>`,'interview');
 document.querySelector('#interview-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{
  const form=new FormData(e.target),ratings={};for(const k of ['focus','distraction','difficulty'])ratings[k]=form.get(k)?Number(form.get(k)):null;
  await api('/api/interview',{answers:questions.map((_,i)=>form.get('q'+i)),ratings});await api('/api/scene',{scene:'debrief'});await showDebrief();
 });};
}
async function showDebrief(){
 const panels=[
  `<div class="debrief-title">DEBRIEF</div><h2>What was this study actually investigating?</h2><p>This experiment investigated whether exposure to a 10 Hz binaural beat during learning was associated with differences in immediate associative memory performance.</p>`,
  `<h2>Two auditory<br>conditions were used.</h2><p>In the experimental condition, different tones were presented to the left and right ears, producing a 10 Hz frequency difference.</p><p>In the control condition, the same frequency was presented to both ears.</p><div class="debrief-cards"><article class="cream-card"><span class="eyebrow">EXPERIMENTAL</span><h3>335 / 345 Hz</h3><p>Different tones in each ear.</p></article><article class="cream-card"><span class="eyebrow">CONTROL</span><h3>340 / 340 Hz</h3><p>The same tone in both ears.</p></article></div>`,
  `<h2>Why weren’t you told<br>this beforehand?</h2><p>The full hypothesis was withheld before the experiment because knowing it could influence expectations or behaviour, creating demand characteristics and reducing the validity of the results.</p>`,
  `<h2>What can this<br>experiment tell us?</h2><p>The study measures memory performance, not brain activity.</p><p>Because no EEG recording was used, the experiment cannot determine whether participants’ alpha brain activity actually changed.</p>`,
  `<h2>Thank you<br>for participating.</h2><p>If you have any questions about the study or would like your data withdrawn, please speak to the researchers.</p>${pill('Finish','finish')}`
 ];
 await transition(`<section class="debrief-scroll"><div class="debrief-stage">${panels.map((p,i)=>`<article class="debrief-panel" aria-label="Debrief part ${i+1}"><div class="eyebrow">THE STUDY / 0${i+1}</div>${p}</article>`).join('')}<div class="debrief-nav"><span id="debrief-index">01 / 05</span><span>SCROLL TO EXPLORE</span><button id="debrief-next">Continue ↓</button></div></div></section>`,'debrief');
 smoothScroll=0;requestCinema();
 bind('debrief-next',()=>{const anchors=[1050,1900,2700,3550];const target=anchors.find(a=>a>scrollY+100);if(target!==undefined)window.scrollTo({top:target,behavior:reduce.matches?'instant':'smooth'});});
 bind('finish',e=>action(e.currentTarget,async()=>{await api('/api/scene',{scene:'complete'});withdraw.hidden=true;await transition(`<section class="scene hero completion"><div class="eyebrow">THANK YOU</div><h1>Session complete.</h1><div class="hero-bottom"><p>You may now remove your headphones.</p><button class="text-button" id="return-researcher">Researcher access ↗</button></div></section>`,'complete');bind('return-researcher',openAccess);}));
}
async function showStopped(title,text){
 stopCinema();measuring=false;withdraw.hidden=true;document.body.classList.remove('measurement');clearInterval(watchdog);
 await transition(`<section class="scene error-scene"><div class="eyebrow">MEMORY STUDY</div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(text)}</p><button class="pill secondary" id="stopped-access">Researcher access <span>↗</span></button></section>`,'stopped');bind('stopped-access',openAccess);
}
async function halt(reason,deviation=null){
 if(interrupted)return;const stoppedAt=source&&!audioExpectedStop?stamp():null;interrupted=true;transitionVersion++;clock?.stop();clearInterval(watchdog);audioExpectedStop=true;
 stopAudio();measuring=false;stopCinema();
 const interruption={reason,audio_stop:stoppedAt,timing_deviation:deviation===null?null:{...stamp(),deviation_ms:deviation}};
 await api('/api/interrupt',interruption).catch(()=>{navigator.sendBeacon('/api/interrupt',JSON.stringify(interruption));});
 await showStopped('Session paused for review.','Please speak to the researcher. The procedure cannot continue because its standardization may have been interrupted.');
 // Details appear only after researcher authentication, in the saved record.
}
withdraw.onclick=()=>{
 if(interrupted)return;const stoppedAt=source&&!audioExpectedStop?stamp():null;
 // Immediate stop takes priority over any animation or confirmation dialog.
 interrupted=true;transitionVersion++;clock?.stop();clearInterval(watchdog);stopAudio();measuring=false;stopCinema();
 api('/api/withdraw',{audio_stop:stoppedAt}).then(()=>showStopped('Participation ended.','Your session has been marked withdrawn and excluded from analysis. Please speak to the researchers if you would like your data permanently deleted.')).catch(()=>showStopped('Participation ended.','Please speak to the researcher to confirm that your data are withdrawn. The study server could not confirm the save.'));
};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&measuring)halt('The experiment tab became hidden during measurement.');});
addEventListener('pagehide',()=>{if(session&&!['complete','stopped','landing','setup','results'].includes(scene)){
 clock?.stop();audioExpectedStop=true;try{source?.stop();}catch{}navigator.sendBeacon('/api/interrupt',JSON.stringify({reason:'Page closed, refreshed, or browser navigation interrupted the session.'}));
}});
addEventListener('popstate',()=>{if(session&&!['complete','stopped'].includes(scene))halt('Browser navigation interrupted the session.');});
addEventListener('offline',()=>{if(measuring)halt('Network/server connectivity was lost during measurement.');});

let currentRecords=[];
const number=(v,d=2)=>v===null||v===undefined?'—':Number(v).toFixed(d);
async function showResults(){
 const data=await api('/api/admin/records');currentRecords=data.records;
 await transition(`<section class="scene workspace">${workspaceHeader('results')}<p class="micro">Primary measure: correctly recalled associations / 15. Descriptive statistics include measurement-complete, valid, non-withdrawn real sessions only. Demo sessions are excluded. SD is the sample standard deviation. These summaries do not establish a significant effect or a causal conclusion.</p><div class="stats-grid">${['Experimental','Control'].map(c=>{const s=data.stats[c];return`<article class="stats-card"><span class="eyebrow" style="color:#596051">REAL SESSIONS ONLY</span><h3>${c}</h3><div class="stat-row">${[['N',s.n],['Mean',number(s.mean)],['Median',number(s.median)],['SD',number(s.sd)],['Range',s.range?s.range.join('–'):'—']].map(([label,v])=>`<div><span class="stat-value">${v}</span><span class="stat-label">${label}</span></div>`).join('')}</div><p class="individual-scores">Individual scores: ${s.scores.length?s.scores.map(x=>x+'/15').join(' · '):'No eligible scores yet.'}</p></article>`;}).join('')}</div><div class="results-tools"><input id="record-filter" aria-label="Find participant or session" placeholder="Find participant or session…" autocomplete="off"><div style="display:flex;gap:10px"><button class="pill secondary" id="export-csv">Export CSV ↗</button><button class="pill secondary" id="export-json">Export JSON ↗</button></div></div><div class="table-wrap"><table><thead><tr><th>Participant</th><th>Condition</th><th>Memory /15</th><th>Recall duration</th><th>Validity</th><th>Withdrawal</th><th>Record</th></tr></thead><tbody id="record-rows"></tbody></table><div id="records-empty" class="empty" hidden>No matching sessions.</div></div><div style="margin-top:24px"><button class="text-button" id="reset-demo">Reset all demo data</button></div></section>`,'results');
 bindWorkspace();document.querySelector('#record-filter').value=recordFilter;renderRows(recordFilter);document.querySelector('#record-filter').oninput=e=>{recordFilter=e.target.value;renderRows(recordFilter);};
 bind('export-csv',e=>action(e.currentTarget,()=>download('csv'),{tactile:false}));bind('export-json',e=>action(e.currentTarget,()=>download('json'),{tactile:false}));
 bind('reset-demo',e=>action(e.currentTarget,async()=>{if(confirm('Permanently delete all DEMO records? Real participant sessions are preserved.')){await api('/api/admin/reset-demo',{});await showResults();}}));
}
function renderRows(query){
 const records=currentRecords.filter(r=>(r.participant_id+' '+r.session_id).toLowerCase().includes(query.toLowerCase()));
 document.querySelector('#record-rows').innerHTML=records.map(r=>`<tr><td>${escapeHTML(r.participant_id)} ${r.demo?'<span class="status-tag demo">DEMO</span>':''}</td><td>${r.condition}</td><td>${r.memory_score??'—'}</td><td>${r.recall_duration_ms===null?'—':number(r.recall_duration_ms/1000,1)+' s'}</td><td><span class="status-tag ${r.potentially_invalid?'bad':''}">${r.potentially_invalid?'Review required':r.measurement_complete?'Valid':'Incomplete'}</span></td><td>${r.withdrawn?'Withdrawn':'Active'}</td><td><button data-record="${r.session_id}">Open ↗</button></td></tr>`).join('');
 document.querySelector('#records-empty').hidden=records.length>0;
 document.querySelectorAll('[data-record]').forEach(b=>b.onclick=e=>action(e.currentTarget,()=>showRecord(b.dataset.record)));
}
async function download(type){try{const res=await fetch('/api/admin/export.'+type);if(!res.ok)throw Error('Researcher access expired. Unlock the workspace again.');const url=URL.createObjectURL(await res.blob()),a=document.createElement('a');a.href=url;a.download='memory-sessions.'+type;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message);}}
async function showRecord(id){
 const r=currentRecords.find(r=>r.session_id===id);
 await transition(`<section class="scene record-details"><div class="eyebrow">RESEARCHER ONLY / INDIVIDUAL RECORD</div><h2>${escapeHTML(r.participant_id)}</h2><p class="micro">Session ${r.session_id}</p><p>${r.demo?'DEMO · ':''}${r.condition} · Score ${r.memory_score??'—'}/15 · ${r.potentially_invalid?'Potentially invalid':'No recorded interruption'} · ${r.withdrawn?'Withdrawn':'Not withdrawn'}</p><div class="record-actions"><button class="pill secondary" id="back-results">Return to records</button><button class="pill secondary" id="mark-withdrawn" ${r.withdrawn?'disabled':''}>Mark withdrawn</button><button class="pill secondary" id="delete-session" ${r.withdrawn?'':'disabled'}>Permanently delete</button></div><p class="micro">Withdrawal excludes the session from all real descriptive statistics. Delete is available after withdrawal and permanently removes its saved record. Previously exported copies must be managed separately.</p><pre>${escapeHTML(JSON.stringify(r,null,2))}</pre></section>`,'record');
 bind('back-results',e=>action(e.currentTarget,showResults));
 bind('mark-withdrawn',e=>action(e.currentTarget,async()=>{await api('/api/admin/withdraw',{session_id:id});await showResults();}));
 bind('delete-session',e=>action(e.currentTarget,async()=>{if(confirm(`Permanently delete the record for ${r.participant_id}? This cannot be undone.`)){await api('/api/admin/delete',{session_id:id});await showResults();}}));
}
