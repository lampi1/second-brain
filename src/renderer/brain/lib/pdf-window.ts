// Which pages of an open PDF keep a drawn canvas (SPEC 22 V2): the pages near the viewport plus a few on each side,
// never more than PDF_DRAWN, so however far a long PDF is scrolled only a bounded number of page bitmaps stay alive (a
// US-letter page at 200 % is about 25 MB). Every other page is released (canvas emptied, pdf.js page resources freed)
// and redrawn when it comes back. Pure, so it is tested without a DOM: used by pages/FileViewer.tsx, pinned by
// test/unit/pdf-window.test.ts.
export const PDF_AROUND=2;
export const PDF_DRAWN=8;
/** `near` = the 1-based pages within the observer's margin of the viewport; `total` = the document's page count. */
export function pdfPagesToDraw(near:Iterable<number>,total:number,around=PDF_AROUND,max=PDF_DRAWN):Set<number>{
  const pages=[...near].filter(n=>Number.isSafeInteger(n)&&n>=1&&n<=total).sort((a,b)=>a-b);
  const drawn=new Set<number>();
  if(!pages.length||max<1)return drawn;
  let lo=pages[0]!,hi=pages[pages.length-1]!;
  // more pages near than may be drawn (small pages, a tall window): the ones in the middle, around the viewport
  if(hi-lo+1>max){lo=Math.floor((lo+hi-max+1)/2);hi=lo+max-1;}
  const room=max-(hi-lo+1),before=Math.min(around,lo-1,Math.ceil(room/2)),after=Math.min(around,total-hi,room-before);
  // a side cut short by the document's start or end leaves its room to the other side
  lo-=Math.min(around,lo-1,room-after);hi+=after;
  for(let n=lo;n<=hi;n++)drawn.add(n);
  return drawn;
}
/** Same pages (to keep the previous set and spare a re-render). */
export const samePages=(a:ReadonlySet<number>,b:ReadonlySet<number>)=>a.size===b.size&&[...a].every(n=>b.has(n));
