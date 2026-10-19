type ParsedVersion={major:number;minor:number;patch:number;prerelease:string[]};

function parseVersion(value:string):ParsedVersion|null{
  const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value.trim());
  if(!match)return null;
  const numbers=match.slice(1,4).map(Number);
  if(numbers.some(number=>!Number.isSafeInteger(number)))return null;
  const prerelease=match[4]?.split('.')??[];
  if(prerelease.some(identifier=>/^\d+$/.test(identifier)&&identifier.length>1&&identifier.startsWith('0')))return null;
  return{major:numbers[0]!,minor:numbers[1]!,patch:numbers[2]!,prerelease};
}

/** Returns -1, 0, or 1 according to SemVer precedence; null means invalid input. */
export function compareSemVer(left:string,right:string):number|null{
  const a=parseVersion(left),b=parseVersion(right);
  if(!a||!b)return null;
  for(const key of ['major','minor','patch'] as const){if(a[key]!==b[key])return a[key]!<b[key]!?-1:1;}
  if(a.prerelease.length===0&&b.prerelease.length===0)return 0;
  if(a.prerelease.length===0)return 1;
  if(b.prerelease.length===0)return -1;
  const length=Math.max(a.prerelease.length,b.prerelease.length);
  for(let i=0;i<length;i++){
    const x=a.prerelease[i],y=b.prerelease[i];
    if(x===undefined)return -1;if(y===undefined)return 1;if(x===y)continue;
    const xNumeric=/^\d+$/.test(x),yNumeric=/^\d+$/.test(y);
    if(xNumeric&&yNumeric)return x.length!==y.length?x.length<y.length?-1:1:x<y?-1:1;
    if(xNumeric!==yNumeric)return xNumeric?-1:1;
    return x<y?-1:1;
  }
  return 0;
}
