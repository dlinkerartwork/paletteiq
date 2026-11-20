// OpenAI Batch /v1/responses payload helpers. Each paid Batch is submitted
// exactly once; the remote receipt is saved in the owning collection.
export type BatchReceipt = {
  id:string; status:string; output_file_id?:string|null;
  error_file_id?:string|null; errors?:{data?:Array<{message?:string}>};
};
export type BatchLine = {
  custom_id?:string;
  response?:{status_code?:number;body?:{output?:Array<{content?:Array<{text?:string}>}>;status?:string;error?:{message?:string}}};
  error?:{message?:string}|null;
};
export function researchBatchJsonl(key:string,model:string,input:unknown,maxOutputTokens:number):string {
  return JSON.stringify({custom_id:key,method:'POST',url:'/v1/responses',
    body:{model,input,text:{format:{type:'json_object'}},
      max_output_tokens:maxOutputTokens}})+'\n';
}
export function batchResearchResult(raw:string,key:string):
  {text?:string;error?:string}|null {
  for(const line of raw.split('\n')){
    if(!line.trim())continue;
    let item:BatchLine;
    try{item=JSON.parse(line) as BatchLine;}catch{continue;}
    if(item.custom_id!==key)continue;
    if(item.error?.message)return {error:item.error.message.slice(0,260)};
    if(!item.response || (item.response.status_code||0)>=400)
      return {error:'OpenAI Batch returned HTTP '+String(item.response?.status_code||'unknown')};
    const body=item.response.body;
    if(body?.error?.message)return {error:body.error.message.slice(0,260)};
    const text=body?.output?.flatMap(o=>o.content||[]).map(c=>c.text||'').join('')||'';
    if(!text.trim())return {error:'Empty research output from Batch'};
    try{JSON.parse(text);}catch{return {error:'Invalid JSON in Batch research output'};}
    return {text};
  }
  return null;
}
