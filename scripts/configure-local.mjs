// Temporary loopback-only setup form. No API key is logged or returned.
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
const path='/'+randomBytes(24).toString('hex');
const server=http.createServer((req,res)=>{
 if(req.url!==path){res.writeHead(404);res.end();return;}
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
 if(req.method==='GET'){
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<title>CiteBase 本地模型配置</title><style>body{font:18px system-ui;max-width:700px;margin:60px auto;color:#123}input,button{display:block;width:100%;padding:12px;margin:10px 0 24px;box-sizing:border-box}small{color:#567}</style><h1>CiteBase · 硅基流动配置</h1><p>密钥只写入本项目已被 Git 忽略的 .env，不显示、不回传。</p><form method="POST"><label>硅基流动 API Key<input type="password" name="key" required autocomplete="off"></label><label>聊天模型<input name="chat" value="deepseek-ai/DeepSeek-V3.2" required></label><label>Embedding 模型<input name="embedding" placeholder="需用户确认 embedding 模型" required></label><button>保存本机配置</button></form>`);return;
 }
 if(req.method!=='POST'){res.writeHead(405);res.end();return;}
 if(existsSync('.env')){res.writeHead(409);res.end('Existing .env preserved; edit it locally.');return;}
 let body='';req.on('data',b=>{body+=b;if(body.length>8192)req.destroy();});req.on('end',()=>{
  const values=new URLSearchParams(body);const key=values.get('key')||'',chat=values.get('chat')||'',embedding=values.get('embedding')||'';
  if(!/^sk-[A-Za-z0-9_-]{16,200}$/.test(key)||![chat,embedding].every(v=>/^[A-Za-z0-9_.\/-]{1,150}$/.test(v))){res.writeHead(400);res.end('Invalid configuration');return;}
  writeFileSync('.env',`MODEL_MODE=real\nDB_PASSWORD=citebase-local\nCHAT_BASE_URL=https://api.siliconflow.cn\nCHAT_API_KEY=${key}\nCHAT_MODEL=${chat}\nEMBEDDING_BASE_URL=https://api.siliconflow.cn\nEMBEDDING_API_KEY=${key}\nEMBEDDING_MODEL=${embedding}\nMODEL_TIMEOUT_SECONDS=60\n`,{mode:0o600,flag:'wx'});
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<h1>配置已保存</h1><p>密钥未显示。现在可启动真实模型验证。</p>');server.close();
 });
});
server.listen(5188,'127.0.0.1',()=>console.log('Open local setup form: http://127.0.0.1:5188'+path));
