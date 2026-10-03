// Transport only: preserve the complete original WAV and verify it before playback.
// Two workers overlap CDN latency without downloading every chunk simultaneously.
async function loadPart(part,signal) {
 for(let attempt=0;attempt<3;attempt++){
  signal.throwIfAborted();
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(()=>controller.abort(),60000);
  try{
   const loaded=await fetch(part.url,{signal:controller.signal});
   if(!loaded.ok)throw Error('An audio asset could not be loaded.');
   const bytes=new Uint8Array(await loaded.arrayBuffer());
   signal.throwIfAborted();
   if(bytes.length!==part.bytes)throw Error('Truncated audio delivery.');
   return bytes;
  }catch(error){
   signal.throwIfAborted();
   if(attempt===2)throw Error('The required study audio could not be fully downloaded. Ask the researcher to check the connection.');
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);}
  await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
 }
}
export async function audioBytes(response,{signal=new AbortController().signal,onProgress=()=>{}}={}) {
 signal.throwIfAborted();
 if (!response.ok) throw Error('The required study audio could not be loaded.');
 if (!(response.headers.get('content-type')||'').includes('application/json')) {
  const bytes=await response.arrayBuffer();signal.throwIfAborted();return bytes;
 }
 const manifest=await response.json();
 if(manifest.kind!=='wav-chunks-v1'||!Array.isArray(manifest.parts)||!manifest.parts.length||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<=0)throw Error('Invalid audio delivery manifest.');
 let total=0;
 const parts=manifest.parts.map(part=>{
  if(!/^\/media\/[a-f0-9]{64}\.bin$/.test(part.url)||!Number.isSafeInteger(part.bytes)||part.bytes<=0)throw Error('Invalid audio asset path or length.');
  const offset=total;total+=part.bytes;return{...part,offset};
 });
 if(total!==manifest.bytes)throw Error('Incomplete audio delivery.');
 const output=new Uint8Array(total),group=new AbortController(),abort=()=>group.abort(signal.reason);
 signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)abort();
 let next=0,completed=0;
 try{
  onProgress(0,total);
  const worker=async()=>{
   while(next<parts.length){
    group.signal.throwIfAborted();
    const part=parts[next++],bytes=await loadPart(part,group.signal);
    output.set(bytes,part.offset);completed+=bytes.length;onProgress(completed,total);
   }
  };
  const workers=Array.from({length:Math.min(2,parts.length)},()=>worker().catch(error=>{group.abort(error);throw error;}));
  await Promise.all(workers);
  signal.throwIfAborted();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',output)),x=>x.toString(16).padStart(2,'0')).join('');
  signal.throwIfAborted();
  if(digest!==manifest.sha256)throw Error('Audio integrity verification failed.');
  return output.buffer;
 }finally{signal.removeEventListener('abort',abort);}
}
