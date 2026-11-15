const host=document.querySelector('#shop-catalog-grid');
const select=document.querySelector('#shop-product-select');
const form=document.querySelector('#shop-request-form');
const result=document.querySelector('#shop-request-result');
const search=document.querySelector('#shop-search');
const sort=document.querySelector('#shop-sort');
const safe=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const euro=cents=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format((Number(cents)||0)/100);
let products=[];
let activeFilter='all';

function categoryFor(product){
  const text=`${product.name} ${product.description}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/fusee|rocket|decoll|lancement|impression 3d|decoration|deco/.test(text))return 'rocket';
  if(/cadeau|souvenir|anniversaire|badge|porte.?cle|carte/.test(text))return 'gift';
  return 'other';
}

function render(){
  const query=(search?.value||'').trim().toLocaleLowerCase('fr');
  const filtered=products.filter(product=>{
    const matchesText=`${product.name} ${product.description}`.toLocaleLowerCase('fr').includes(query);
    const category=categoryFor(product);
    return matchesText&&(activeFilter==='all'||category===activeFilter);
  });
  const mode=sort?.value||'newest';
  filtered.sort((a,b)=>mode==='price-asc'?(a.price_cents-b.price_cents):mode==='price-desc'?(b.price_cents-a.price_cents):mode==='name'?a.name.localeCompare(b.name,'fr'):(b.id-a.id));
  const count=document.querySelector('#catalogue-count');
  if(count)count.textContent=`SÉLECTION · ${String(filtered.length).padStart(2,'0')} ARTICLE${filtered.length===1?'':'S'}`;
  if(!filtered.length){host.innerHTML=`<div class="catalogue-empty">${products.length?'Aucune création ne correspond à cette sélection.':'Le hangar prépare ses premières créations. Revenez bientôt.'}</div>`;return;}
  host.innerHTML=filtered.map((product,index)=>`<article class="shop-product">
    <div class="product-art">${product.image_url?`<img src="${safe(product.image_url)}" alt="Création ${safe(product.name)}" loading="lazy">`:`<span class="product-art-placeholder" aria-hidden="true">${categoryFor(product)==='rocket'?'✦':categoryFor(product)==='gift'?'◇':'✧'}</span><span class="product-orbit-ring" aria-hidden="true"></span>`}<span class="product-code">AS—${String(product.id).padStart(2,'0')}</span><span class="product-stock">DEMANDES OUVERTES</span></div>
    <div class="product-info"><span class="product-category">${categoryFor(product)==='rocket'?'Fusées & décors':categoryFor(product)==='gift'?'Idée cadeau':'Création Air Space'}</span><h3>${safe(product.name)}</h3><p>${safe(product.description||'Une création imaginée par l’équipe Air Space.')}</p><div class="product-card-bottom"><span class="product-price">${euro(product.price_cents)} <small>/ unité</small></span><button class="product-choose" type="button" data-select-product="${Number(product.id)}">Choisir <b>↗</b></button></div></div>
  </article>`).join('');
  host.querySelectorAll('[data-select-product]').forEach(button=>button.addEventListener('click',()=>{
    select.value=button.dataset.selectProduct;
    document.querySelector('#demande').scrollIntoView({behavior:'smooth'});
    select.focus({preventScroll:true});
  }));
}

async function load(){
  try{
    const response=await fetch('/api/public/shop');
    const data=await response.json();
    if(!response.ok)throw new Error(data.error);
    products=Array.isArray(data.products)?data.products:[];
    const allCount=document.querySelector('#all-count');
    if(allCount)allCount.textContent=String(products.length).padStart(2,'0');
    products.forEach(product=>select.add(new Option(`${product.name} — ${euro(product.price_cents)}`,product.id)));
    render();
  }catch{
    host.innerHTML='<div class="catalogue-empty">Le hangar est momentanément inaccessible. Réessayez dans un instant.</div>';
  }
}

document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  activeFilter=button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item=>item.classList.toggle('active',item===button));
  render();
}));
search?.addEventListener('input',render);
sort?.addEventListener('change',render);
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();search?.focus();}});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(form));
  data.product_id=Number(data.product_id);
  data.quantity=Number(data.quantity);
  data.consent=data.consent==='true';
  result.textContent='Transmission de la demande…';
  try{
    const response=await fetch('/api/public/shop/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error);
    result.textContent='Demande transmise ! L’équipe vous recontactera pour confirmer la disponibilité et les modalités.';
    form.reset();
  }catch(error){result.textContent=error.message||'La demande n’a pas pu être transmise.';}
});
load();
