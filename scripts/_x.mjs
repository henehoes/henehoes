import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',defaultViewport:{width:+process.argv[3],height:900}});
const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5173/',{waitUntil:'networkidle0'});
const w=ms=>new Promise(r=>setTimeout(r,ms));
for (const t of ['Weapon','Hair','Body','Hat']) {
  await p.evaluate(t=>[...document.querySelectorAll('.tab')].find(x=>x.title===t).click(), t); await w(500);
  await (await p.$('#source')).screenshot({path:`${process.argv[2]}-${t}-${process.argv[3]}.png`});
}
await p.evaluate(()=>[...document.querySelectorAll('.tab')].find(x=>x.title==='Weapon').click()); await w(400);
const n=async()=> (await p.$$('#content .grid .card')).length;
const click=l=>p.evaluate(l=>[...document.querySelectorAll('#source .seg button')].find(b=>b.textContent.startsWith(l)).click(), l);
console.log('default', await n(), await p.$$eval('#source .seg button[aria-pressed=true]', b=>b.map(x=>x.textContent)));
await click('Any'); await w(300); console.log('any', await n());
await click('Any'); await w(300); console.log('deselected', await n());
await click('Wand'); await w(300); console.log('wand', await n());
console.log(errs); await b.close();
