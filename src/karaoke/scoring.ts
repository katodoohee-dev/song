export interface PitchSample { t: number; frequency: number; confidence: number; voiced: boolean }
export interface ScoreResult { score: number | null; comparableRatio: number; medianCentsError: number | null; reliable: boolean; reason?: string }

function centsBetween(a:number,b:number){return 1200*Math.log2(a/b)}
function median(values:number[]){if(!values.length)return 0;const v=values.slice().sort((a,b)=>a-b);const m=v.length>>1;return v.length%2?v[m]:(v[m-1]+v[m])/2}

export function scoreSinging(reference:PitchSample[],user:PitchSample[],opts:{minConfidence?:number;minComparableRatio?:number;maxCents?:number}={}):ScoreResult{
  const minConfidence=opts.minConfidence??0.55,minComparableRatio=opts.minComparableRatio??0.2,maxCents=opts.maxCents??300;
  if(!reference.length||!user.length)return {score:null,comparableRatio:0,medianCentsError:null,reliable:false,reason:'Missing reference or microphone pitch data.'};
  const errors:number[]=[];let comparable=0;
  let j=0;
  for(const r of reference){while(j+1<user.length&&user[j+1].t<=r.t)j++;const u=user[j];if(!u||!u.voiced||u.confidence<minConfidence||!r.voiced||r.confidence<minConfidence||r.frequency<=0||u.frequency<=0)continue;const dt=Math.abs(u.t-r.t);if(dt>0.12)continue;const e=Math.abs(centsBetween(u.frequency,r.frequency));if(!Number.isFinite(e))continue;comparable++;if(e<=maxCents)errors.push(e);}
  const comparableRatio=comparable/reference.filter(x=>x.voiced&&x.confidence>=minConfidence).length||0;
  if(comparableRatio<minComparableRatio||errors.length<5)return {score:null,comparableRatio,medianCentsError:errors.length?median(errors):null,reliable:false,reason:'Not enough reliable voiced reference/user samples.'};
  const err=median(errors);const score=Math.max(0,Math.min(100,100*(1-err/maxCents)));
  return {score,comparableRatio,medianCentsError:err,reliable:true};
}
