// UTF-16 offsets match Java String coordinates. No semantic correctness inference.
export function retrievalMetrics(labels, found, versions) {
  const hashes=new Map(versions.map(v=>[v.version_id??v.versionId,v.content_hash??v.contentHash]));
  const matches=(l,e)=>l.documentName===e.documentName && (!l.sourceHash||l.sourceHash===hashes.get(e.versionId))
    && (l.page==null||l.page===e.page) && (l.startOffset!=null||l.paragraph==null||l.paragraph===e.paragraph)
    && typeof l.quote==='string'&&l.quote.trim().length>0
    && (l.startOffset==null?e.text.includes(l.quote):l.endOffset!=null&&l.startOffset>=e.startOffset&&l.endOffset<=e.endOffset
      &&l.endOffset>l.startOffset&&l.endOffset-e.startOffset<=e.text.length
      &&e.text.slice(l.startOffset-e.startOffset,l.endOffset-e.startOffset)===l.quote);
  if(!labels.length)return {recallAtK:null,mrr:null,evidenceHit:false,allEvidenceHit:false,evidenceGroupCount:0,hitEvidenceGroupCount:0};
  const groups=new Map();labels.forEach((l,i)=>{const key=l.groupId==null?`item:${i}`:`group:${l.groupId}`;groups.set(key,[...(groups.get(key)||[]),l]);});
  const hits=[...groups.values()].filter(group=>group.some(l=>found.some(e=>matches(l,e)))).length;
  const first=found.findIndex(e=>labels.some(l=>matches(l,e)));
  return {recallAtK:hits/groups.size,mrr:first<0?0:1/(first+1),evidenceHit:hits>0,allEvidenceHit:hits===groups.size,evidenceGroupCount:groups.size,hitEvidenceGroupCount:hits};
}
