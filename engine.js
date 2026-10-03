export const clamp = (v,min=0,max=1)=>Math.min(max,Math.max(min,v));
export const lerp = (a,b,t)=>a+(b-a)*t;
export function smoothstep(a,b,v){const x=clamp((v-a)/(b-a));return x*x*(3-2*x);}
export function segmentInOut(s,a,b,c,d){const enter=smoothstep(a,b,s),exit=smoothstep(c,d,s);return{enter,exit,active:enter*(1-exit)};}
export function timeline(protocol,count){
 const a=protocol.adaptation_ms,d=protocol.stimulus_ms;
 const schedule=[{at:0,phase:'adaptation',events:['adaptation_start']}];
 for(let round=1;round<=2;round++)for(let index=0;index<count;index++){
  const events=index===0?(round===1?['adaptation_end','round_1_start']:['round_1_end','round_2_start']):[];
  schedule.push({at:a+((round-1)*count+index)*d,phase:'learning',round,index,events});
 }
 schedule.push({at:a+2*count*d,phase:'recall',events:['round_2_end','audio_stop','recall_start']});
 return schedule;
}
// Each timeout refers to the original monotonic epoch. Rendering delays never compound.
export class PhaseClock{
 constructor(schedule,onBoundary,onDeviation,threshold=250){this.schedule=schedule;this.onBoundary=onBoundary;this.onDeviation=onDeviation;this.threshold=threshold;this.index=0;this.running=false;}
 start(epoch=performance.now()){this.epoch=epoch;this.running=true;this.advance();}
 advance(){if(!this.running)return;const entry=this.schedule[this.index];if(!entry){this.stop();return;}
  const remaining=this.epoch+entry.at-performance.now();
  if(remaining>0){this.timer=setTimeout(()=>this.advance(),remaining);return;}
  const actual=performance.now(),deviation=actual-this.epoch-entry.at;
  if(deviation>this.threshold){this.stop();this.onDeviation(deviation,entry);return;}
  this.onBoundary(entry,{actual,scheduled:this.epoch+entry.at,deviation});this.index++;
  if(this.index>=this.schedule.length){this.stop();return;}this.advance();
 }
 stop(){this.running=false;clearTimeout(this.timer);}
}
