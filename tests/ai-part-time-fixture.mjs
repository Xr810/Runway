// Isolated test network only; no real model, user data, or external requests.
import http from 'node:http';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
http.createServer((req,res) => {
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    try {
      const {messages}=JSON.parse(body);
      const system=messages[0].content;
      if(!system.includes('partTime') || !system.includes('现有兼职与收入：')) throw Error('Missing gig context');
      const items=JSON.parse(/现有兼职与收入：([^\n]+)/.exec(system)[1]);
      const last=messages.at(-1).content;
      const text=typeof last==='string'?last:last.filter(c=>c.type==='text').map(c=>c.text).join('\n');
      const target=items.find(g=>g.title==='测试：Poe bot 收入');
      let partTime=[];
      if(text.includes('fixture-invalid')) partTime=[{operation:'update',targetId:'unknown',fields:{status:'已完成'}}];
      else if(text.includes('fixture-duplicate')) partTime=[{operation:'add',fields:{title:'测试：付费调查',type:'task'}}];
      else if(text.includes('标记到账')) partTime=[{operation:'update',targetId:target.id,payments:[{operation:'update',targetId:target.payments[0].id,fields:{status:'received',date:today()}}]}];
      else if(text.includes('记待到账')) partTime=[{operation:'update',targetId:target.id,payments:[{operation:'add',fields:{amount:'19.99',currency:'USD',status:'pending',date:today(),period:'测试结算'}}]}];
      else if(text.includes('添加Poe')) partTime=[{operation:'add',fields:{title:'测试：Poe bot 收入',type:'income',organization:'Poe',status:'进行中'}}];
      else if(text.includes('添加长期兼职')) partTime=[{operation:'add',fields:{title:'测试：WorldQuant 顾问',type:'ongoing',organization:'WorldQuant'}}];
      else if(text.includes('修改调查')) partTime=[{operation:'update',targetId:items.find(g=>g.title==='测试：付费调查').id,fields:{status:'已完成',nextAction:'等待结算'}}];
      else partTime=[{operation:'add',fields:{title:'测试：付费调查',type:'task',compensation:'300 港币',dueDate:today(),nextAction:'填写调查问卷',notes:'隔离环境演示记录'}}];
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'已整理为草稿，请核对后确认保存。',partTime})}}]}));
    } catch {res.statusCode=500;res.end('{}')}
  });
}).listen(8080,'0.0.0.0');
