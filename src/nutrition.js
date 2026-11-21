// Pools use µg substrate-equivalent C/P, NOT elemental carbon or literal energy.
export const pool=(c=0,p=0)=>({c,p});
export function transfer(from,to,key,requested,capacity=Infinity) {
  if(!Number.isFinite(requested)||requested<0)throw new RangeError('Invalid transfer');
  const amount=Math.max(0,Math.min(requested,from[key],capacity-to[key]));
  from[key]-=amount;to[key]+=amount;return amount;
}
export const total=items=>items.reduce((r,x)=>({c:r.c+x.c,p:r.p+x.p}),pool());
