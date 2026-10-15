(function () {
'use strict';
const view=document.getElementById('view'),overlay=document.getElementById('overlay-root'),nav=document.getElementById('bottom-nav');
let toastTimer;
const state={tab:'home',previousTab:'home',previousCategoryProfile:'',products:[],categories:[],search:'',categoryFilter:'',categoryProfile:'',detail:false,selectedProduct:null,selectionDraft:{},selectionAction:'cart',selectionQty:1,checkout:false,pendingCheckout:false,busy:false,authMode:'login',customerToken:read('ser-mart-customer-token',''),cart:read('ser-mart-cart',[]).map(x=>Object.assign({selectedForOrder:false},x)),refs:readSession('ser-mart-order-refs',[]),orders:[],profile:read('ser-mart-profile',{}),account:read('ser-mart-account',null),recentlyViewed:read('ser-mart-recently-viewed',[]),searchFrequency:read('ser-mart-search-frequency',{}),searchTrends:[],primaryPayment:read('ser-mart-primary-payment','COD'),paymentMethod:read('ser-mart-primary-payment','COD')};
function read(k,d){try{const v=JSON.parse(localStorage.getItem(k));return v==null?d:v;}catch(_){return d;}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(_){}}
function readSession(k,d){try{const v=JSON.parse(sessionStorage.getItem(k));return v==null?d:v;}catch(_){return d;}}
function saveSession(k,v){try{sessionStorage.setItem(k,JSON.stringify(v));}catch(_){}}
function $(s){return document.querySelector(s);}
function syncKeyboardViewport(){
  const vv=window.visualViewport;
  const height=vv?Math.max(0,window.innerHeight-vv.height-vv.offsetTop):0;
  document.documentElement.style.setProperty('--keyboard-height',Math.round(height)+'px');
  document.body.classList.toggle('keyboard-open',height>120&&!!document.activeElement&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
}
function keepFocusedFieldVisible(){
  /* Let native iOS Safari manage keyboard scrolling; don't force scroll on focus. */
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',syncKeyboardViewport,{passive:true});
  window.visualViewport.addEventListener('scroll',syncKeyboardViewport,{passive:true});
}
window.addEventListener('resize',syncKeyboardViewport,{passive:true});
const checkoutTextFieldSelector='#checkout-form input:not([type="radio"]):not([type="checkbox"]), #checkout-form textarea';
function isCheckoutTextField(el){return !!el&&typeof el.matches==='function'&&el.matches(checkoutTextFieldSelector);}
document.addEventListener('focusin',e=>{
  if(isCheckoutTextField(e.target))document.body.classList.add('checkout-field-focused');
  else document.body.classList.remove('checkout-field-focused');
  syncKeyboardViewport();
});
document.addEventListener('focusout',()=>window.setTimeout(()=>{
  if(!isCheckoutTextField(document.activeElement))document.body.classList.remove('checkout-field-focused');
  syncKeyboardViewport();
},150));

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function imageSource(value){
  const raw=String(value==null?'':value).trim();
  if(!raw)return '';
  if(/^(?:https?:|data:image\/|blob:|\/\/)/i.test(raw))return raw;
  return '/'+raw.replace(/^(?:\.\/)+/,'').replace(/^\/+/, '');
}

function money(v){return '₱'+Number(v||0).toLocaleString('en-PH',{maximumFractionDigits:2});}
function svg(n){const p={
arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
back:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
close:'<path d="m6 6 12 12M18 6 6 18"/>',
trash:'<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
check:'<path d="m5 12 4 4L19 6"/>',
edit:'<path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5z"/><path d="m13.8 6.7 3.5 3.5"/>',
person:'<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.7-4 3.2-6 7.5-6s6.8 2 7.5 6"/>',
bag:'<path d="M5 8h14l1 12H4L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
package:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
calendar:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
card:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
truck:'<path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/>',
settings:'<circle cx="12" cy="12" r="3"/><path d="M19 13l2-1-2-3-2 1-2-1-1-3h-3L10 9 8 10 6 9l-2 3 2 1v2l-2 1 2 3 2-1 2 1 1 3h3l1-3 2-1 2 1 2-3-2-1Z"/>',
feedback:'<path d="M4 5h16v12H9l-5 4V5Z"/><path d="M8 9h8M8 13h5"/>',
grid:'<rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><rect x="14" y="14" width="6" height="6" rx="1.2"/>'
};return '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true">'+(p[n]||p.arrow)+'</svg>';}
function notice(m){const b=$('#toast');b.textContent=m;b.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>b.classList.remove('visible'),2800);}
async function api(url,opts){const o=opts||{};const base={'Content-Type':'application/json'};if(state.customerToken)base.Authorization='Bearer '+state.customerToken;o.headers=Object.assign(base,o.headers||{});if(!o.method||o.method.toUpperCase()==='GET')o.cache='no-store';const r=await fetch(url,o),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Something went wrong. Please try again.');return d;}
function recordSearchTerm(term){const key=String(term||'').trim().toLowerCase();if(!key)return;state.searchFrequency[key]=Number(state.searchFrequency[key]||0)+1;save('ser-mart-search-frequency',state.searchFrequency);api('/api/search-trends',{method:'POST',body:JSON.stringify({term:key})}).then(()=>loadSearchTrends()).catch(()=>{});}
async function loadSearchTrends(){try{const result=await api('/api/search-trends');state.searchTrends=Array.isArray(result)?result.filter(x=>x&&x.term).map(x=>({term:String(x.term),count:Number(x.count||0)})):[];if(state.tab==='search'){const holder=view.querySelector('.trending-searches');if(holder&&state.searchTrends.length){holder.innerHTML=state.searchTrends.slice(0,8).map(x=>'<button type="button" class="trending-search" data-search-term="'+esc(x.term)+'">'+svg('search')+'<span>'+esc(x.term)+'</span>'+svg('arrow')+'</button>').join('');}}}catch(_){state.searchTrends=[];}}
function cartCount(){return state.cart.reduce((a,x)=>a+Number(x.quantity||0),0);}
function selectedCartLines(){return state.cart.filter(x=>x.selectedForOrder===true);}
function cartTotal(){return state.cart.reduce((a,x)=>a+Number(x.price||0)*Number(x.quantity||0),0);}
function selectedCartTotal(){return selectedCartLines().reduce((a,x)=>a+Number(x.price||0)*Number(x.quantity||0),0);}
function persistCart(){save('ser-mart-cart',state.cart);$('#cart-count').textContent=String(cartCount());}
function photo(p){const src=p&&(p.imageUrl||(p.gallery&&p.gallery[0]));return src?'<img src="'+esc(imageSource(src))+'" alt="'+esc(p.name)+'" loading="lazy">':'<div class="photo-placeholder">'+svg('search')+'<span>Photo coming soon</span></div>';}
function grid(items){if(!items.length)return '<div class="empty-state"><div class="empty-symbol">'+svg('search')+'</div><h2>No items yet</h2><p>New finds will appear here as soon as they are added to the store.</p></div>';return '<div class="product-grid">'+items.map(p=>{const soldOut=Number(p.stock)<=0;return '<button type="button" class="product-card '+(soldOut?'sold-out':'')+'" data-product="'+esc(p.id)+'"><span class="product-photo">'+photo(p)+(soldOut?'<span class="sold-out-label">Sold out</span>':'')+'</span><span class="product-info"><span class="product-title">'+esc(p.name)+'</span><span class="product-price">'+money(p.price)+'</span><span class="product-hint">'+(soldOut?'Currently unavailable':'View item '+svg('arrow'))+'</span></span></button>';}).join('')+'</div>';}
function productCategory(p){if(Object.prototype.hasOwnProperty.call(p,'category')){const value=String(p.category||'').trim();return value?value.split('::')[0].trim():'';}return legacyProductCategory(p);}
function productPodSection(p){const parts=String(p.category||'').split('::');return parts[0].trim().toLowerCase()==='pods'&&['V1','V2'].includes(parts[1])?parts[1]:'';}
function legacyProductCategory(p){const t=((p.name||'')+' '+(p.description||'')).toLowerCase();if(/\b(pod|pods|cartridge)\b/.test(t))return'Pods';if(/\b(dispo|disposable)\b/.test(t))return'Dispo';if(/\b(battery|batteries)\b/.test(t))return'Battery';if(/\b(formula\s*juice|juice|liquid|flavour|flavor)\b/.test(t))return'Formula Juice';return'Other';}
function renderHome(){
 const cats=state.categories;
 const categoryMarkup=cats.length?'<div class="category-grid">'+cats.map(cat=>'<button type="button" class="category-card" data-category="'+esc(cat.name)+'">'+(cat.imageUrl?'<span class="category-image-wrap"><img class="category-tile-image" src="'+esc(imageSource(cat.imageUrl))+'" alt="" loading="lazy"></span>':'<span class="category-mark">'+esc(String(cat.name).trim().charAt(0).toUpperCase())+'</span>')+'<span class="category-name">'+esc(cat.name)+'</span><span class="category-hint">'+Number(cat.productCount||0)+' items</span></button>').join('')+'</div>':'<p class="category-empty-state">The seller has not added any product sections yet.</p>';
 const fresh=state.products.filter(p=>p.isActive).slice().sort((a,b)=>{const ad=Date.parse(a.releaseDate||a.createdAt||'')||0,bd=Date.parse(b.releaseDate||b.createdAt||'')||0;return bd-ad||Number(b.id||0)-Number(a.id||0);}).slice(0,3);
 const arrivals=fresh.length?fresh.map(p=>{const old=Number(p.oldPrice||p.old_price||0),current=Number(p.price||0),sale=old>current;const release=p.releaseDate?p.releaseDate:'New arrival';return '<article class="new-arrival-card magazine-card"><button type="button" class="new-arrival-open" data-product="'+esc(p.id)+'" aria-label="View '+esc(p.name)+'"><div class="new-arrival-copy"><span class="release-date">'+esc(release)+'</span>'+(p.isPreOrder?'<span class="preorder-label">PRE-ORDER</span>':'')+'<h3>'+esc(p.name)+'</h3><p>'+esc(p.description||'')+'</p></div><div class="new-arrival-photo">'+photo(p)+'<span class="media-fade"></span><span class="new-arrival-bottom"><span class="arrival-price">'+(sale?'<del>'+money(old)+'</del>':'')+'<strong>'+money(current)+'</strong></span><span class="new-arrival-link">View pricing '+svg('arrow')+'</span></span></div></button></article>';}).join(''):'<div class="category-empty-state">New releases from the seller will appear here.</div>';
 view.innerHTML='<section class="products-hero"><div><span class="eyebrow">SER MART</span><h1>Products</h1></div><button type="button" class="hero-account-button" data-tab="account" aria-label="Account">'+(state.account&&state.account.name?'<span class="account-avatar-small">'+esc(String(state.account.name).charAt(0).toUpperCase())+'</span>':svg('person'))+'</button></section><section class="home-product-sections"><div class="section-heading compact-heading"><h2>Product sections</h2><button class="text-button" type="button" data-tab="all">All items '+svg('arrow')+'</button></div>'+categoryMarkup+'</section><section class="discover-section"><div class="discover-heading"><span class="eyebrow">JUST ARRIVED</span><h2>Discover what’s new</h2></div><div class="new-arrival-stack">'+arrivals+'</div></section>';
}
function renderCategoryProfile(){
const name=state.categoryProfile||'';
const category=state.categories.find(cat=>cat.name===name);
const items=state.products.filter(p=>p.isActive&&productCategory(p)===name);
const first=items.find(p=>p.imageUrl||(p.gallery&&p.gallery.length));
const heroUrl=category&&category.imageUrl?category.imageUrl:first&&(first.imageUrl||(first.gallery&&first.gallery[0]))||'';
const groups=name.toLowerCase()==='pods'?['V1','V2']:[];
view.innerHTML='<section class="category-profile"><button type="button" class="category-profile-back" data-tab="home">← Products</button><div class="category-profile-hero">'+(heroUrl?'<img src="'+esc(imageSource(heroUrl))+'" alt="'+esc(name)+'" loading="eager">':'<div class="category-profile-placeholder">'+esc(name)+'</div>')+'<div class="category-profile-fade"></div><div class="category-profile-title"><span class="eyebrow">SER MART · COLLECTION</span><h1>'+esc(name)+'</h1><p>'+esc(category&&category.description?category.description:first&&first.description?first.description:'Explore this seller-created section.')+'</p><span class="category-profile-count">'+items.length+' '+(items.length===1?'item':'items')+'</span></div></div><div class="category-profile-content">'+groups.map(v=>{const subset=items.filter(product=>productPodSection(product)===v);return '<section class="category-profile-section"><div class="section-heading"><div><span class="eyebrow">PODS</span><h2>'+(v==='V1'?'Version 1':v==='V2'?'Version 2':v)+'</h2></div><span class="muted small">'+subset.length+' items</span></div>'+(subset.length?grid(subset):'<p class="category-empty">No products assigned to '+v+' yet.</p>')+'</section>';}).join('')+(groups.length&&items.some(product=>!productPodSection(product))?'<section class="category-profile-section"><div class="section-heading"><h2>Other pods</h2></div>'+grid(items.filter(product=>!productPodSection(product)))+'</section>':'')+(groups.length?'':grid(items))+'</div></section>';
}
function renderSearch(){
 const q=state.search.trim().toLowerCase();
 const items=q?state.products.filter(p=>(!state.categoryFilter||productCategory(p)===state.categoryFilter)&&((p.name||'').toLowerCase().includes(q)||(p.description||'').toLowerCase().includes(q)||(productCategory(p)||'').toLowerCase().includes(q))):[];
 const recently=state.recentlyViewed.map(id=>state.products.find(p=>String(p.id)===String(id))).filter(Boolean).slice(0,4);
 const globalSearches=state.searchTrends.map(x=>x.term).filter(Boolean).slice(0,8),topSearches=Object.keys(state.searchFrequency).sort((a,b)=>Number(state.searchFrequency[b])-Number(state.searchFrequency[a])).slice(0,8),trends=globalSearches.length?globalSearches:(topSearches.length?topSearches:['New arrivals','Best sellers','Pods','Accessories']);
 view.innerHTML='<section class="search-page-heading"><span class="eyebrow">FIND YOUR NEXT FAVOURITE</span><h1>Search</h1></section><section class="search-content-section"><div class="section-heading"><h2>Recently Viewed</h2></div>'+(recently.length?'<div class="recently-viewed-row">'+recently.map(p=>'<button type="button" class="recent-view-card" data-product="'+esc(p.id)+'"><span class="recent-view-image">'+photo(p)+'</span><span class="recent-view-title">'+esc(p.name)+'</span><span class="recent-view-price">'+money(p.price)+'</span></button>').join('')+'</div>':'<p class="search-support-copy">Items you view will appear here.</p>')+'</section><section class="search-content-section"><div class="section-heading"><h2>Try Searching</h2></div><div class="trending-searches">'+trends.map(t=>'<button type="button" class="trending-search" data-search-term="'+esc(t)+'">'+svg('search')+'<span>'+esc(t)+'</span>'+svg('arrow')+'</button>').join('')+'</div></section><section class="search-content-section" id="search-results-section" '+(q?'':'hidden')+'><div class="section-heading"><h2>Results</h2><span class="muted small">'+items.length+' items</span></div><div id="product-results">'+(q?grid(items):'')+'</div></section>';
}
async function loadOrders(){if(state.customerToken){try{const list=await api('/api/account/orders');state.orders=Array.isArray(list)?list:[];return;}catch(err){if(err.message==='Please sign in again.'){state.customerToken='';save('ser-mart-customer-token','');state.account=null;save('ser-mart-account',null);}else throw err;}}const refs=state.refs.filter(r=>r&&r.id&&r.token);const loaded=await Promise.all(refs.map(r=>api('/api/orders/mine',{headers:{Authorization:'Bearer '+r.token}}).catch(()=>null)));state.orders=loaded.filter(Boolean);}
function dateLabel(v,timeOnly){if(!v)return'Just now';const d=new Date(v);if(isNaN(d.getTime()))return String(v);return d.toLocaleString('en-PH',timeOnly?{hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});}
function selectionSummary(obj){if(!obj||typeof obj!=='object')return'';const s=Object.keys(obj).map(k=>k+': '+obj[k]);return s.length?'<small class="selection-summary">'+esc(s.join(' · '))+'</small>':'';}
function canCancelOrder(o){const created=Date.parse(o&&o.createdAt||'');return o&&o.status==='Pending'&&Number.isFinite(created)&&Date.now()-created<3600000;}
function renderOrders(){if(!state.orders.length){view.innerHTML='<section class="page-heading"><span class="eyebrow">Updates and delivery</span><h1>Your orders</h1><p>Order updates and messages from the seller will show up here.</p></section><div class="empty-state"><div class="empty-symbol">'+svg('check')+'</div><h2>Nothing on the way</h2><p>Once you place an order, you can track it here and message the seller.</p><button class="primary-button compact" type="button" data-tab="home">Browse items '+svg('arrow')+'</button></div>';return;}
view.innerHTML='<section class="page-heading"><span class="eyebrow">Updates and delivery</span><h1>Your orders</h1><p>Your receipts and seller messages stay on this device.</p><button class="secondary-button compact" type="button" data-tab="home">Continue shopping</button></section><div class="orders-list">'+state.orders.map(o=>{const cls=String(o.status).toLowerCase().replace(/[^a-z]+/g,'-');return '<article class="order-card"><div class="order-top"><div><span class="order-number">Receipt #'+esc(o.id)+'</span><span class="muted small">'+esc(dateLabel(o.createdAt))+'</span></div><span class="status-pill status-'+esc(cls)+'">'+esc(o.status)+'</span></div><div class="order-lines">'+(o.items||[]).map(it=>'<div class="order-line"><span>'+esc(it.quantity)+' × '+esc(it.name)+selectionSummary(it.selections)+'</span><b>'+money(Number(it.unitPrice)*Number(it.quantity))+'</b></div>').join('')+'</div><div class="order-total"><span>Total</span><strong>'+money(o.total)+'</strong></div><div class="delivery-block"><div><span class="muted small">Delivering to</span><p>'+esc(o.exactPlace||o.address)+'</p><span class="muted small">'+esc(o.address)+'</span></div><div><span class="muted small">Estimated delivery</span><p>'+esc(o.deliveryEta||'Seller will confirm')+'</p><span class="muted small">'+esc(o.paymentMethod==='COD'?'Cash on delivery':o.paymentMethod==='COP'?'Cash on pickup':'GCash')+'</span></div></div><div class="chat-heading"><span>Chat with seller</span><span class="muted small">'+(o.messages||[]).length+' messages</span></div><div class="message-thread">'+(o.messages||[]).map(m=>'<div class="message-bubble '+(m.sender==='customer'?'mine':'theirs')+'"><p>'+esc(m.text)+'</p><time>'+esc(dateLabel(m.createdAt,true))+'</time></div>').join('')+((o.messages||[]).length?'':'<p class="muted small message-empty">Use this chat for order questions or confirmation.</p>')+'</div><form class="message-form" data-message-form="'+esc(o.id)+'"><input name="text" aria-label="Message seller" placeholder="Message the seller" maxlength="2000" required><button type="submit" aria-label="Send message">'+svg('arrow')+'</button></form>'+(canCancelOrder(o)?'<button class="subtle-button danger-text" type="button" data-cancel="'+esc(o.id)+'">Cancel order · '+Math.max(1,Math.ceil((3600000-(Date.now()-new Date(o.createdAt).getTime()))/60000))+' min left</button>':'')+'</article>';}).join('')+'</div>';}
function renderCart(){
 if(!state.cart.length){view.innerHTML='<section class="bag-page-heading"><span class="eyebrow">YOUR SAVED PICKS</span><h1>Bag</h1></section><div class="empty-state bag-empty"><div class="empty-symbol">'+svg('bag')+'</div><h2>Your bag is empty.</h2><p>Continue browsing Ser Mart or buy an item you’ve previously saved.</p><button class="primary-button compact" type="button" data-tab="home">Browse Products '+svg('arrow')+'</button></div>';return;}
 const rows=state.cart.map((it,i)=>'<article class="cart-row saved-cart-row '+(it.selectedForOrder?'marked-for-order':'')+'"><div class="cart-thumb">'+photo(it)+'</div><div class="cart-row-info"><h3>'+esc(it.name)+'</h3>'+(it.isPreOrder?'<span class="cart-preorder-tag">PRE-ORDER · ONE UNIT</span>':'')+'<p class="cart-description">'+esc(it.description||'')+'</p>'+selectionSummary(it.selections)+'<div class="quantity-control"><button type="button" data-qty="'+i+'" data-step="-1" aria-label="Decrease quantity">−</button><span>'+esc(it.quantity)+'</span><button type="button" data-qty="'+i+'" data-step="1" aria-label="Increase quantity">+</button></div></div><div class="cart-actions"><strong class="cart-side-price">'+money(it.price)+'</strong><button class="cart-pick '+(it.selectedForOrder?'picked':'')+'" type="button" data-select-cart="'+i+'" aria-label="Toggle purchase selection">'+(it.selectedForOrder?svg('check'):'')+'</button><button class="remove-button" type="button" data-remove="'+i+'" aria-label="Remove saved item">'+svg('trash')+'</button></div></article>').join('');
 view.innerHTML='<section class="bag-page-heading"><span class="eyebrow">YOUR SAVED PICKS</span><h1>Bag</h1><p>'+cartCount()+' saved '+(cartCount()===1?'item':'items')+'. Tap the blue circles for items you want to order.</p></section><div class="cart-layout"><div class="cart-list">'+rows+'</div></div>';
}
function renderCheckout(){
 const lines=selectedCartLines();if(!lines.length){state.checkout=false;renderCart();notice('Choose at least one item to buy.');return;}
 const p=state.profile||{},complete=!!(String(p.name||'').trim()&&String(p.phone||'').trim()&&String(p.address||'').trim()&&String(p.exactPlace||'').trim()),showFields=!complete||state.editProfile;
 const field=(name,label,type,autocomplete,placeholder,value,required=true)=>'<label>'+label+'<input name="'+name+'" '+(type?'type="'+type+'" ':'')+(autocomplete?'autocomplete="'+autocomplete+'" ':'')+(required?'required ':'')+'value="'+esc(value||'')+'" placeholder="'+placeholder+'"></label>';
 const deliveryFields=showFields?field('customerName','Full name','','name','Your full name',p.name)+field('contactNumber','Contact number','tel','tel','09xx xxx xxxx',p.phone)+field('address','Delivery address','','street-address','House no., street, barangay, city, province',p.address)+field('exactPlace','Landmark or exact delivery location','','off','Building, unit, gate, nearby landmark',p.exactPlace)+'<label>Delivery instructions <span class="muted">(optional)</span><textarea name="request" rows="3" placeholder="How the seller or rider can find you">'+esc(p.request||'')+'</textarea></label>'+(complete?'<button class="secondary-button compact" type="button" data-save-profile>Save delivery details</button>':''):'<section class="saved-delivery-details"><div class="section-heading"><div><span class="eyebrow">Saved delivery details</span><h2>'+esc(p.name)+'</h2></div><button type="button" class="secondary-button compact" data-edit-profile>Change</button></div><p>'+esc(p.phone)+'</p><p>'+esc(p.address)+'</p><p>'+esc(p.exactPlace)+'</p>'+(p.request?'<p class="muted small">'+esc(p.request)+'</p>':'')+'</section>';
 view.innerHTML='<section class="page-heading checkout-heading"><button type="button" class="back-button" id="checkout-back">'+svg('back')+' Back to bag</button><span class="eyebrow">REVIEW YOUR SELECTION</span><h1>Checkout</h1><p>Only items you marked in your bag are included in this order.</p></section><div class="checkout-layout"><form id="checkout-form" class="form-panel">'+deliveryFields+'<fieldset class="payment-options"><legend>Payment method</legend><label class="payment-choice"><input type="radio" name="paymentMethod" value="GCash" required '+(state.paymentMethod==='GCash'?'checked':'')+'><span class="payment-icon">G</span><span><b>GCash</b><small>Seller will confirm payment details</small></span></label><label class="payment-choice"><input type="radio" name="paymentMethod" value="COD" required '+(state.paymentMethod==='COD'?'checked':'')+'><span class="payment-icon">₱</span><span><b>Cash on delivery (COD)</b><small>Pay when your order arrives</small></span></label><label class="payment-choice"><input type="radio" name="paymentMethod" value="COP" required '+(state.paymentMethod==='COP'?'checked':'')+'><span class="payment-icon">⌂</span><span><b>Cash on pickup (COP)</b><small>Pay in cash when the seller confirms pickup</small></span></label></fieldset><div id="payment-info" class="payment-info" hidden></div></form><aside class="cart-summary checkout-summary"><span class="eyebrow">Your order</span>'+lines.map(it=>'<div><span>'+esc(it.quantity)+' × '+esc(it.name)+selectionSummary(it.selections)+'</span><strong>'+money(it.price*it.quantity)+'</strong></div>').join('')+'<div class="summary-total"><span>Total</span><strong>'+money(selectedCartTotal())+'</strong></div><p class="muted small">Saved items that are not selected stay in your bag. Stock is checked when the order is submitted, not when you save an item.</p></aside></div>';
}
function removeBars(){document.querySelectorAll('.cart-order-bar,.checkout-order-bar').forEach(n=>n.remove());}
function renderAll(){
const groups=state.categories.map(c=>c.name);
const sections=groups.map(name=>{const items=state.products.filter(product=>productCategory(product)===name);return '<section class="all-items-group"><div class="section-heading"><h2>'+esc(name)+'</h2><span class="muted small">'+items.length+' items</span></div>'+grid(items)+'</section>';}).join('');
const unassigned=state.products.filter(product=>!groups.includes(productCategory(product)));
view.innerHTML='<section class="page-heading"><span class="eyebrow">The full collection</span><h1>All items</h1><p>Browse the sections created by the seller.</p></section>'+sections+(unassigned.length?'<section class="all-items-group unassigned-items"><div class="section-heading"><h2>Needs a section</h2><span class="muted small">'+unassigned.length+' items</span></div>'+grid(unassigned)+'</section>':'')+(!sections&&!unassigned.length?'<div class="category-empty-state">The seller has not added any items yet.</div>':'');
}
function render(){
 removeBars();nav.hidden=state.checkout||state.detail;
 $('#topbar').hidden=state.checkout||state.detail;
 document.body.classList.toggle('checkout-active',state.checkout);
 document.body.classList.toggle('search-active',state.tab==='search'&&!state.checkout&&!state.detail);
 document.body.classList.toggle('has-scrolled',window.scrollY>100);
 if(!state.checkout)document.body.classList.remove('checkout-field-focused');
 syncNavigation();
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));
 $('#cart-count').textContent=String(cartCount());
 if(state.detail)return;
 if(state.checkout){
  renderCheckout();
  const bar=document.createElement('div');bar.className='checkout-order-bar';
  bar.innerHTML='<div><span class="muted small">Order total</span><strong>'+money(selectedCartTotal())+'</strong></div><button class="primary-button" id="checkout-submit" type="submit" form="checkout-form">Place order '+svg('arrow')+'</button>';
  document.body.appendChild(bar);
 }else if(state.tab==='home')renderHome();
 else if(state.tab==='category')renderCategoryProfile();
 else if(state.tab==='all')renderAll();
 else if(state.tab==='search')renderSearch();
 else if(state.tab==='orders')renderOrders();
 else if(state.tab==='cart'){
  renderCart();
  if(selectedCartLines().length){
   const bar=document.createElement('div');bar.className='cart-order-bar';
   bar.innerHTML='<div><span class="muted small">'+selectedCartLines().length+' selected</span><strong>'+money(selectedCartTotal())+'</strong></div><button class="primary-button" type="button" id="order-all">Buy now '+svg('arrow')+'</button>';
   document.body.appendChild(bar);
  }
 }else if(state.tab==='account')renderAccount();
 else if(['reservations','preorders','payment','shipping','feedback','settings'].includes(state.tab))renderAccountSection(state.tab);
 else renderHome();
}
function syncNavigation(){
 if(state.checkout||state.detail){nav.hidden=true;return;}
 nav.hidden=false;
 if(state.tab==='search'){
  const bt=state.previousTab||'home';
  const pageIcons={home:'grid',category:'back',cart:'bag',all:'package',account:'person',orders:'package',reservations:'calendar',preorders:'bag',payment:'card',shipping:'truck',feedback:'feedback',settings:'settings'};const ic=pageIcons[bt]||'grid';
  nav.className='bottom-nav search-mode';
  nav.innerHTML='<button type="button" class="search-back-button" data-search-back aria-label="Back to previous page">'+svg(ic)+'</button><label class="nav-search-field" aria-label="Search products"><span>'+svg('search')+'</span><input id="search-input" type="search" placeholder="Search Ser Mart" value="'+esc(state.search)+'" autocomplete="off" enterkeyhint="search"><button type="button" id="clear-search" aria-label="Clear search">'+svg('close')+'</button></label>';
 }else{
  nav.className='bottom-nav';
  nav.innerHTML='<div class="nav-pill"><button class="nav-item '+(state.tab==='home'||state.tab==='category'?'active':'')+'" type="button" data-tab="home">'+svg('grid')+'<span>Products</span></button><button class="nav-item '+(state.tab==='cart'?'active':'')+'" type="button" data-tab="cart">'+svg('bag')+'<span>Bag</span><span class="nav-count">'+cartCount()+'</span></button><button class="nav-item '+(state.tab==='all'?'active':'')+'" type="button" data-tab="all">'+svg('package')+'<span>All items</span></button></div><button class="nav-search-launch" type="button" data-tab="search" aria-label="Search">'+svg('search')+'<span>Search</span></button>';
 }
}
function renderAccount(){
 const a=state.account||null;
 const accountCard=a
 ?'<section class="account-profile-card"><span class="account-avatar">'+esc(String(a.name||a.email||'S').trim().charAt(0).toUpperCase())+'</span><span class="account-profile-meta"><strong>'+esc(a.name||'Ser Mart customer')+'</strong><small>'+esc(a.email||'')+'</small></span><button type="button" class="icon-button" data-account-action="edit" aria-label="Edit profile">'+svg('edit')+'</button></section><button type="button" class="secondary-button account-signout" data-sign-out>Sign out</button>'
 :'<section class="account-login-card"><div class="account-login-copy"><h2>'+(state.authMode==='register'?'Create your Ser Mart account':'Sign in to Ser Mart')+'</h2><p>'+(state.authMode==='register'?'Create an account to save your orders and delivery details.':'Sign in to keep your orders, pre-orders, and preferences together.')+'</p></div><button type="button" class="social-login-button" data-oauth="google" disabled aria-disabled="true"><span class="google-mark">G</span>Continue with Google</button><button type="button" class="social-login-button apple-login" data-oauth="apple" disabled aria-disabled="true"><span class="apple-mark">●</span>Continue with Apple</button><p class="auth-setup-note">Google and Apple require their provider credentials before they can be connected. Email sign-in and account creation are available now.</p><div class="auth-mode-toggle"><button type="button" class="'+(state.authMode==='login'?'active':'')+'" data-auth-mode="login">Sign in</button><button type="button" class="'+(state.authMode==='register'?'active':'')+'" data-auth-mode="register">Create account</button></div><form class="account-auth-form" id="account-auth-form">'+(state.authMode==='register'?'<label>Full name<input name="name" type="text" autocomplete="name" minlength="2" maxlength="100" placeholder="Your full name" required></label>':'')+'<label>Email address<input name="email" type="email" autocomplete="email" autocapitalize="none" maxlength="254" placeholder="you@example.com" required></label><label>Password<input name="password" type="password" autocomplete="'+(state.authMode==='register'?'new-password':'current-password')+'" minlength="8" maxlength="128" placeholder="'+(state.authMode==='register'?'At least 8 characters':'Your password')+'" required></label><button type="submit" class="primary-button">'+(state.authMode==='register'?'Create account':'Sign in')+' '+svg('arrow')+'</button><p class="muted small account-auth-footnote">Passwords are securely hashed on the server. Never share your password.</p></form></section>';
 const menu=items=>'<div class="account-menu-group">'+items.map(it=>'<button type="button" class="account-menu-row" data-account-page="'+it[0]+'"><span class="account-menu-icon">'+svg(it[2])+'</span><span>'+it[1]+'</span>'+svg('arrow')+'</button>').join('')+'</div>';
 view.innerHTML='<section class="account-page"><div class="account-heading"><span class="eyebrow">SER MART</span><h1>Account</h1></div>'+accountCard+menu([['reservations','Reservations','calendar'],['orders','Orders','package'],['preorders','Pre-Orders','bag']])+menu([['payment','Primary Payment','card'],['shipping','Primary Shipping','truck'],['feedback','Give Feedbacks','feedback'],['settings','Settings','settings']])+'</section>';
}
function renderAccountSection(page){
 const labels={reservations:'Reservations',preorders:'Pre-Orders',payment:'Primary Payment',shipping:'Primary Shipping',feedback:'Give Feedbacks',settings:'Settings'};
 let inner='';
 if(!state.customerToken||!state.account){inner='<div class="account-empty-state">'+svg('person')+'<h2>Sign in to continue.</h2><p>This section is connected to your Ser Mart account.</p><button type="button" class="primary-button compact" data-tab="account">Go to sign in '+svg('arrow')+'</button></div>';}
 else if(page==='reservations')inner='<div class="account-empty-state">'+svg('calendar')+'<h2>No reservations yet.</h2><p>Your reservations will be listed here.</p></div>';
 else if(page==='preorders'){const lines=(state.orders||[]).flatMap(o=>(o.items||[]).filter(it=>it.isPreOrder).map(it=>({item:it,order:o})));inner=lines.length?'<div class="preorder-list">'+lines.map(x=>'<article class="preorder-order-card"><div class="preorder-card-image">'+(x.item.imageUrl?'<img src="'+esc(imageSource(x.item.imageUrl))+'" alt="">':svg('bag'))+'</div><div><strong>'+esc(x.item.name||'Pre-order item')+'</strong><p>Order #'+esc(x.order.id)+' · '+esc(x.order.status||'Placed')+'</p><span>'+money(x.item.subtotal||x.item.unitPrice||x.item.price||0)+'</span></div></article>').join('')+'</div>':'<div class="account-empty-state">'+svg('bag')+'<h2>No pre-orders yet.</h2><p>Items you pre-order will appear here after checkout.</p></div>';}
 else if(page==='payment')inner='<form class="account-preference-card primary-payment-panel" id="primary-payment-form">'+svg('card')+'<div><strong>Primary payment method</strong><p>This method will be preselected at checkout. You can still change it for any order.</p><div class="primary-payment-choices"><label><input type="radio" name="primaryPayment" value="GCash" '+(state.primaryPayment==='GCash'?'checked':'')+'> GCash</label><label><input type="radio" name="primaryPayment" value="COD" '+(state.primaryPayment==='COD'?'checked':'')+'> Cash on delivery (COD)</label><label><input type="radio" name="primaryPayment" value="COP" '+(state.primaryPayment==='COP'?'checked':'')+'> Cash on pickup (COP)</label><button type="submit" class="primary-button compact">Save primary payment</button></div></div></form>';
 else if(page==='shipping')inner='<div class="account-preference-card">'+svg('truck')+'<div><strong>Primary shipping details</strong><p>'+(state.profile&&state.profile.address?esc(state.profile.address):'Add your delivery details in Settings.')+'</p><small>'+(state.profile&&state.profile.exactPlace?esc(state.profile.exactPlace):'')+'</small><button type="button" class="secondary-button compact" data-account-action="edit">Edit shipping details</button></div></div>';
 else if(page==='feedback')inner='<div class="account-preference-card">'+svg('feedback')+'<div><strong>Help improve Ser Mart</strong><p>Your feedback is saved on this device.</p></div></div><form class="feedback-form" id="feedback-form"><label for="feedback-message">Your feedback</label><textarea id="feedback-message" name="message" rows="4" placeholder="Tell us what you think" required></textarea><button type="submit" class="primary-button">Save feedback '+svg('arrow')+'</button></form>';
 else inner='<form class="account-profile-edit form-panel" id="account-profile-form"><label>Full name<input name="name" value="'+esc(state.account.name||'')+'" minlength="2" maxlength="100" autocomplete="name" required></label><label>Contact number<input name="phone" type="tel" value="'+esc(state.account.phone||state.profile.phone||'')+'" maxlength="40" autocomplete="tel" placeholder="09xx xxx xxxx"></label><label>Delivery address<input name="address" value="'+esc(state.account.address||state.profile.address||'')+'" maxlength="500" autocomplete="street-address" placeholder="House no., street, barangay, city, province"></label><label>Landmark or exact delivery location<input name="exactPlace" value="'+esc(state.account.exactPlace||state.profile.exactPlace||'')+'" maxlength="250" placeholder="Building, unit, gate, nearby landmark"></label><label>Delivery instructions <span class="muted">(optional)</span><textarea name="request" rows="3" maxlength="1000" placeholder="How the rider can find you">'+esc(state.account.request||state.profile.request||'')+'</textarea></label><label>Primary payment method<select name="primaryPayment"><option value="COD" '+(state.primaryPayment==='COD'?'selected':'')+'>Cash on delivery (COD)</option><option value="GCash" '+(state.primaryPayment==='GCash'?'selected':'')+'>GCash</option><option value="COP" '+(state.primaryPayment==='COP'?'selected':'')+'>Cash on pickup (COP)</option></select></label><button type="submit" class="primary-button">Save account details '+svg('arrow')+'</button></form><button type="button" class="secondary-button account-signout" data-sign-out>Sign out</button>';
 view.innerHTML='<section class="account-section-page"><button type="button" class="text-button account-back" data-tab="account">'+svg('back')+' Account</button><span class="eyebrow">ACCOUNT</span><h1>'+esc(labels[page]||'Account')+'</h1>'+inner+'</section>';
}
async function loadProducts(){try{state.products=await api('/api/products');}catch(_){state.products=[];notice('The store could not refresh. Open it again in a moment.');}}
async function loadCategories(){try{state.categories=await api('/api/categories');}catch(_){state.categories=[];}}
function renderDetail(p){
 state.detail=true;state.selectedProduct=p;
 state.recentlyViewed=[String(p.id),...state.recentlyViewed.map(String).filter(id=>id!==String(p.id))].slice(0,12);save('ser-mart-recently-viewed',state.recentlyViewed);
 const pics=(p.gallery||[]).slice();if(p.imageUrl&&!pics.includes(p.imageUrl))pics.unshift(p.imageUrl);const hero=pics[0]||'';
 nav.hidden=true;$('#topbar').hidden=true;
 const old=Number(p.oldPrice||p.old_price||0),sale=old>Number(p.price||0);
 view.innerHTML='<section class="detail-screen"><button type="button" class="detail-back" id="detail-back" aria-label="Back">'+svg('back')+'</button><div class="detail-product-title"><span class="eyebrow">'+esc(p.releaseDate||'SER MART · ITEM')+'</span><h1>'+esc(p.name)+'</h1></div><div class="detail-photo">'+(hero?'<img id="detail-hero-img" src="'+esc(imageSource(hero))+'" alt="'+esc(p.name)+'" loading="eager">':'<div class="photo-placeholder large">'+svg('search')+'<span>Photo coming soon</span></div>')+(pics.length>1?'<div class="photo-pips">'+pics.map((_,i)=>'<button type="button" aria-label="Photo '+(i+1)+'" class="'+(i===0?'selected':'')+'" data-gallery="'+i+'"></button>').join('')+'</div>':'')+'</div><div class="detail-lower"><div class="detail-price-line">'+(sale?'<del>'+money(old)+'</del>':'')+'<strong>'+money(p.price)+'</strong></div><p class="detail-description-copy">'+esc(p.description||'No additional description has been provided for this item yet.')+'</p><div class="detail-availability '+(Number(p.stock)>0?'available':'unavailable')+'">'+(Number(p.stock)>0?(p.isPreOrder?'Pre-order · limited to one unit per order':iconStock(Number(p.stock))+' '+esc(p.stock)+' available'):'Currently sold out')+'</div>'+(p.selections&&p.selections.length?'<section class="detail-option-list"><div class="section-heading"><h2>Choose your options</h2></div>'+p.selections.map(g=>'<div class="detail-option-row"><strong>'+esc(g.name)+(g.required===false?' <small>Optional</small>':'')+'</strong><div class="detail-option-tags">'+(g.options||[]).map(o=>'<span class="detail-option-tag">'+esc(o.name)+(Number(o.priceDelta||0)>0?' <small>+'+money(Number(o.priceDelta))+'</small>':'')+'</span>').join('')+'</div></div>').join('')+'</section>':'')+'</div><div class="detail-actions">'+(Number(p.stock)>0?'<button type="button" class="primary-button detail-buy-now" data-order="'+esc(p.id)+'">'+(p.isPreOrder?'Pre-order · ':'View pricing · ')+money(p.price)+'</button>':'<p class="sold-out-message">This item is currently sold out.</p>')+'</div></section>';
}
function iconStock(n){return '<span class="stock-dot" aria-hidden="true"></span>'+(n===1?'Only 1 left':n+' in stock');}
function dynamicPrice(p,selected){let total=Number(p.price||0);(p.selections||[]).forEach(g=>{const op=(g.options||[]).find(o=>o.name===selected[g.name]);if(op)total+=Number(op.priceDelta||op.price_delta||0);});return Math.max(0,total);}
function openSelection(p,action){state.selectedProduct=p;state.selectionAction=action;state.selectionDraft={};state.selectionQty=1;renderSelection();}
function renderSelection(){const p=state.selectedProduct,groups=p.selections||[];let chosenPhoto=p.imageUrl||'';groups.forEach(g=>{const op=(g.options||[]).find(o=>o.name===state.selectionDraft[g.name]);if(op&&op.imageUrl)chosenPhoto=op.imageUrl;});const price=dynamicPrice(p,state.selectionDraft),priceLabel=price!==Number(p.price)?'<span class="selection-price-range">From '+money(Number(p.price))+' to '+money(price)+'</span>':'';let html='<div class="sheet-backdrop" id="selection-backdrop"><section class="selection-sheet" role="dialog" aria-modal="true" aria-labelledby="selection-title"><div class="sheet-grabber"></div><div class="sheet-head"><div><span class="eyebrow">Choose your options</span><h2 id="selection-title">Choose options</h2></div><button class="icon-button" type="button" data-close-selection aria-label="Close">'+svg('close')+'</button></div><div class="selection-product"><div class="selection-photo">'+(chosenPhoto?'<img src="'+esc(imageSource(chosenPhoto))+'" alt="">':svg('search'))+'</div><div><h3>'+esc(p.name)+'</h3><div class="selection-current-price">'+money(price)+priceLabel+'</div></div></div>';
groups.forEach((g,gi)=>{html+='<fieldset class="selection-group"><legend>'+esc(g.name)+(g.required===false?' <small>Optional</small>':'')+'</legend><div class="selection-options">'+(g.options||[]).map((o,oi)=>'<button type="button" class="choice-option '+(state.selectionDraft[g.name]===o.name?'picked':'')+'" data-choice-group="'+gi+'" data-choice-option="'+oi+'">'+(o.imageUrl?'<img src="'+esc(imageSource(o.imageUrl))+'" alt="">':'')+'<span>'+esc(o.name)+'</span>'+(Number(o.priceDelta||0)!==0?'<small>From '+money(Number(p.price))+' to '+money(Math.max(0,Number(p.price)+Number(o.priceDelta)))+'</small>':'')+'</button>').join('')+'</div></fieldset>';});
html+='<div class="selection-quantity"><span>Quantity</span><div class="quantity-control"><button type="button" data-selection-qty="-1" aria-label="Decrease quantity">−</button><span>'+state.selectionQty+'</span><button type="button" data-selection-qty="1" aria-label="Increase quantity">+</button></div></div><div class="selection-bottom"><div><span class="muted small">Item total</span><strong>'+money(price*state.selectionQty)+'</strong></div><button type="button" class="primary-button" id="confirm-selection">'+(state.selectionAction==='order'?'Continue to order':'Add to cart')+' '+svg('arrow')+'</button></div></section></div>';overlay.innerHTML=html;}
function confirmSelection(){
 const p=state.selectedProduct,price=dynamicPrice(p,state.selectionDraft);
 const missing=(p.selections||[]).find(g=>g.required!==false&&(g.options||[]).length&&!state.selectionDraft[g.name]);
 if(missing){notice('Please choose '+missing.name+'.');return;}
 if(p.isPreOrder){
  const existing=state.cart.find(x=>String(x.productId)===String(p.id));
  if(existing){
   if(state.selectionAction==='order'){existing.selectedForOrder=true;overlay.innerHTML='';persistCart();state.detail=false;if(!state.customerToken){state.pendingCheckout=true;state.checkout=false;state.tab='account';render();notice('Sign in or create an account before ordering.');return;}state.checkout=true;state.tab='cart';render();}
   else notice('Only one pre-order unit per item can be saved to your bag.');
   return;
  }
 }
 const line={productId:p.id,name:p.name,description:p.description||'',imageUrl:p.imageUrl||'',price:price,basePrice:p.price,quantity:p.isPreOrder?1:(state.selectionQty||1),selections:Object.assign({},state.selectionDraft),stock:Number(p.stock),gallery:p.gallery||[],isPreOrder:p.isPreOrder===true,selectedForOrder:state.selectionAction==='order'};
 if(line.quantity>Number(p.stock)){notice(p.isPreOrder?'No pre-order reservations are available for this item.':'Only '+p.stock+' of this item are in stock.');return;}
 const same=state.cart.find(x=>String(x.productId)===String(line.productId)&&JSON.stringify(x.selections||{})===JSON.stringify(line.selections||{}));
 if(same){
  if(Number(same.quantity)+line.quantity>Number(p.stock)){notice('Only '+p.stock+' of this item are in stock, including the quantity already in your bag.');return;}
  same.quantity=Number(same.quantity)+line.quantity;same.stock=Number(p.stock);if(line.selectedForOrder)same.selectedForOrder=true;
 }else state.cart.push(line);
 overlay.innerHTML='';persistCart();
 if(state.selectionAction==='order'){state.detail=false;if(!state.customerToken){state.pendingCheckout=true;state.checkout=false;state.tab='account';render();notice('Sign in or create an account to continue to checkout.');return;}state.checkout=true;state.tab='cart';render();}
 else{notice(p.isPreOrder?'Pre-order saved to your bag. One unit maximum; no stock reserved yet.':'Saved to your bag. Stock is not reserved until checkout.');if(state.detail)state.detail=false;render();}
}
async function submitOrder(form){
 if(state.busy)return;
 if(!form.reportValidity())return;
 const orderLines=selectedCartLines();
 if(!orderLines.length){notice('Choose at least one item to buy.');state.checkout=false;render();return;}
 state.busy=true;
 const button=$('#checkout-submit');if(button){button.disabled=true;button.textContent='Sending order…';}
 const f=new FormData(form);
 const payload={customerName:String(f.get('customerName')||'').trim(),contactNumber:String(f.get('contactNumber')||'').trim(),address:String(f.get('address')||'').trim(),exactPlace:String(f.get('exactPlace')||'').trim(),request:String(f.get('request')||'').trim(),paymentMethod:String(f.get('paymentMethod')||state.paymentMethod||'COD'),items:orderLines.map(x=>({productId:x.productId,quantity:x.quantity,selections:x.selections||{}}))};
 try{
  await api('/api/account/profile',{method:'PUT',body:JSON.stringify({name:payload.customerName,phone:payload.contactNumber,address:payload.address,exactPlace:payload.exactPlace,request:payload.request,primaryPayment:state.primaryPayment||payload.paymentMethod})});const result=await api('/api/orders',{method:'POST',body:JSON.stringify(payload)});
  state.profile={name:payload.customerName,phone:payload.contactNumber,address:payload.address,exactPlace:payload.exactPlace,request:payload.request};save('ser-mart-profile',state.profile);state.account=Object.assign({},state.account,state.profile);save('ser-mart-account',state.account);
  state.refs.unshift({id:result.id,token:result.accessToken});saveSession('ser-mart-order-refs',state.refs);
  const ordered=new Set(orderLines);state.cart=state.cart.filter(x=>!ordered.has(x));persistCart();
  state.checkout=false;state.editProfile=false;state.detail=false;state.tab='orders';await loadOrders();await loadProducts();render();notice('Order #'+result.id+' sent to the seller.');
 }catch(err){notice(err.message);if(button){button.disabled=false;button.innerHTML='Place order '+svg('arrow');}}
 finally{state.busy=false;}
}
document.addEventListener('click',async e=>{
if(e.target.closest('input,textarea,select'))return;
const preorderQty=e.target.closest('[data-selection-qty]');if(preorderQty&&state.selectedProduct&&state.selectedProduct.isPreOrder){state.selectionQty=1;renderSelection();notice('Pre-orders are limited to one unit.');return;}
if(e.target.closest('[data-search-back]')){state.search='';state.tab=state.previousTab||'home';state.categoryProfile=state.previousCategoryProfile||'';render();return;}
const searchTerm=e.target.closest('[data-search-term]');if(searchTerm){state.search=searchTerm.dataset.searchTerm||'';recordSearchTerm(state.search);render();const input=$('#search-input');if(input)input.focus({preventScroll:true});return;}
const selectCart=e.target.closest('[data-select-cart]');if(selectCart){const line=state.cart[Number(selectCart.dataset.selectCart)];if(line){line.selectedForOrder=!line.selectedForOrder;persistCart();render();}return;}
const savePayment=e.target.closest('[data-save-primary-payment]');if(savePayment){const choice=document.querySelector('input[name="primaryPayment"]:checked');if(!choice){notice('Choose a primary payment method.');return;}state.primaryPayment=choice.value;state.paymentMethod=choice.value;save('ser-mart-primary-payment',state.primaryPayment);notice('Primary payment saved.');render();return;}
const accountPage=e.target.closest('[data-account-page]');if(accountPage){const page=accountPage.dataset.accountPage;if(!state.customerToken){state.tab='account';state.authMode='login';render();notice('Sign in or create an account to open this section.');return;}if(page==='orders'){state.tab='orders';await loadOrders();}else{if(page==='preorders')await loadOrders();state.tab=page;}render();return;}const authMode=e.target.closest('[data-auth-mode]');if(authMode){state.authMode=authMode.dataset.authMode==='register'?'register':'login';render();return;}const editAccount=e.target.closest('[data-account-action="edit"]');if(editAccount){state.tab='settings';render();return;}const signOut=e.target.closest('[data-sign-out]');if(signOut){try{await api('/api/account/logout',{method:'POST'});}catch(_){}state.customerToken='';state.account=null;state.orders=[];state.profile={};save('ser-mart-customer-token','');save('ser-mart-account',null);save('ser-mart-profile',{});state.pendingCheckout=false;state.checkout=false;state.tab='account';render();notice('You’ve signed out.');return;}
const oauth=e.target.closest('[data-oauth]');if(oauth){notice('This sign-in provider is not configured yet. Use email sign-in or create an account.');return;}
const category=e.target.closest('[data-category]');if(category){state.categoryProfile=category.dataset.category;state.categoryFilter='';state.search='';state.tab='category';state.detail=false;overlay.innerHTML='';render();return;}
const tab=e.target.closest('[data-tab]');if(tab&&!state.checkout){const next=tab.dataset.tab;if(next!=='account')state.pendingCheckout=false;if(next==='search'){state.previousTab=state.tab;state.previousCategoryProfile=state.categoryProfile||'';state.categoryFilter='';state.tab='search';}else{state.categoryFilter='';state.categoryProfile='';state.tab=next;}state.detail=false;overlay.innerHTML='';if(state.tab==='orders')await loadOrders();render();if(state.tab==='search'){loadSearchTrends();const input=$('#search-input');if(input)input.focus({preventScroll:true});}return;}
const prod=e.target.closest('[data-product]');if(prod){const p=state.products.find(x=>String(x.id)===String(prod.dataset.product));if(p)renderDetail(p);return;}
if(e.target.closest('#detail-back')){state.detail=false;state.selectedProduct=null;overlay.innerHTML='';render();return;}
const gallery=e.target.closest('[data-gallery]');if(gallery&&state.selectedProduct){const pics=(state.selectedProduct.gallery||[]).slice();if(state.selectedProduct.imageUrl&&!pics.includes(state.selectedProduct.imageUrl))pics.unshift(state.selectedProduct.imageUrl);const img=$('#detail-hero-img');if(img&&pics[Number(gallery.dataset.gallery)])img.src=pics[Number(gallery.dataset.gallery)];document.querySelectorAll('[data-gallery]').forEach(b=>b.classList.toggle('selected',b===gallery));return;}
const add=e.target.closest('[data-add]'),order=e.target.closest('[data-order]');if(add||order){const id=(add||order).dataset.add||(add||order).dataset.order;const p=state.products.find(x=>String(x.id)===String(id))||state.selectedProduct;if(p)openSelection(p,order?'order':'cart');return;}
if(e.target.id==='selection-backdrop'||e.target.closest('[data-close-selection]')){overlay.innerHTML='';return;}
const choice=e.target.closest('[data-choice-option]');if(choice){const g=state.selectedProduct.selections[Number(choice.dataset.choiceGroup)],o=g.options[Number(choice.dataset.choiceOption)];state.selectionDraft[g.name]=o.name;renderSelection();return;}
const q=e.target.closest('[data-qty]');if(q){const i=Number(q.dataset.qty),line=state.cart[i];if(!line)return;const next=Number(line.quantity)+Number(q.dataset.step);if(next<=0)state.cart.splice(i,1);else if(line.isPreOrder&&next>1)notice('Pre-orders are limited to one unit per item.');else if(next<=Number(line.stock||99))line.quantity=next;else notice('That is all the stock available right now.');persistCart();render();return;}
const remove=e.target.closest('[data-remove]');if(remove){state.cart.splice(Number(remove.dataset.remove),1);persistCart();render();return;}
const sq=e.target.closest('[data-selection-qty]');if(sq){state.selectionQty=Math.max(1,Math.min(Number(state.selectedProduct.stock)||1,Number(state.selectionQty||1)+Number(sq.dataset.selectionQty)));renderSelection();return;}
if(e.target.closest('#confirm-selection')){confirmSelection();return;}
if(e.target.closest('#order-all')){if(selectedCartLines().length){if(!state.customerToken){state.pendingCheckout=true;state.checkout=false;state.tab='account';state.authMode='login';render();notice('Sign in or create an account before ordering.');return;}state.checkout=true;state.paymentMethod=state.primaryPayment||'COD';render();}else notice('Choose the blue circles beside items you want to buy.');return;}
if(e.target.closest('#checkout-back')){state.checkout=false;state.editProfile=false;state.tab='cart';render();return;}if(e.target.closest('[data-edit-profile]')){state.editProfile=true;render();return;}if(e.target.closest('[data-save-profile]')){const form=$('#checkout-form');if(form){state.profile=Object.assign({},state.profile,{name:form.elements.customerName.value.trim(),phone:form.elements.contactNumber.value.trim(),address:form.elements.address.value.trim(),exactPlace:form.elements.exactPlace.value.trim(),request:form.elements.request.value.trim()});save('ser-mart-profile',state.profile);state.editProfile=false;render();notice('Delivery details saved.');}return;}
const cancel=e.target.closest('[data-cancel]');if(cancel){const ref=state.refs.find(r=>String(r.id)===String(cancel.dataset.cancel));if((!ref&&!state.customerToken)||!window.confirm('Cancel this pending order?'))return;try{await api('/api/orders/'+cancel.dataset.cancel+'/cancel',{method:'POST',headers:ref?{Authorization:'Bearer '+ref.token}:{}});await loadOrders();await loadProducts();render();notice('Order cancelled.');}catch(err){notice(err.message);}}
});
document.addEventListener('change',e=>{if(e.target.matches('#checkout-form input[name="paymentMethod"]')){state.paymentMethod=e.target.value;document.querySelectorAll('.payment-choice').forEach(label=>label.classList.toggle('is-selected',label.contains(e.target)));const info=$('#payment-info');if(info){info.hidden=state.paymentMethod==='COD';info.textContent=state.paymentMethod==='GCash'?'GCash selected. The seller will provide payment instructions after reviewing your order.':state.paymentMethod==='COP'?'Cash on pickup selected. Collect and pay in cash when the seller confirms pickup.':'';}}});
document.addEventListener('input',e=>{if(e.target.form&&e.target.form.id==='checkout-form'&&['customerName','contactNumber','address','exactPlace','request'].includes(e.target.name)){const form=$('#checkout-form');state.profile=Object.assign({},state.profile,{name:form.elements.customerName?form.elements.customerName.value:state.profile.name||'',phone:form.elements.contactNumber?form.elements.contactNumber.value:state.profile.phone||'',address:form.elements.address?form.elements.address.value:state.profile.address||'',exactPlace:form.elements.exactPlace?form.elements.exactPlace.value:state.profile.exactPlace||'',request:form.elements.request?form.elements.request.value:state.profile.request||''});save('ser-mart-profile',state.profile);}if(e.target.id==='search-input'){state.search=e.target.value;const q=state.search.trim().toLowerCase();const list=state.products.filter(p=>(!state.categoryFilter||productCategory(p)===state.categoryFilter)&&((p.name||'').toLowerCase().includes(q)||(p.description||'').toLowerCase().includes(q)||(productCategory(p)||'').toLowerCase().includes(q)));const section=$('#search-results-section');if(section){section.hidden=!q;const meta=section.querySelector('.section-heading');if(meta)meta.innerHTML='<h2>Results</h2><span class="muted small">'+list.length+' items</span>';const target=$('#product-results');if(target)target.innerHTML=q?grid(list):'';}}});
document.addEventListener('click',e=>{if(e.target.closest('#clear-search')){state.search='';const input=$('#search-input');if(input){input.value='';input.focus({preventScroll:true});}const section=$('#search-results-section');if(section)section.hidden=true;const target=$('#product-results');if(target)target.innerHTML='';}});
document.addEventListener('submit',async e=>{

if(e.target.id==='account-auth-form'){e.preventDefault();const form=e.target,fd=new FormData(form),registering=state.authMode==='register';const payload={email:String(fd.get('email')||'').trim(),password:String(fd.get('password')||'')};if(registering)payload.name=String(fd.get('name')||'').trim();const submit=form.querySelector('button[type="submit"]');if(submit){submit.disabled=true;submit.textContent=registering?'Creating account…':'Signing in…';}try{const result=await api(registering?'/api/account/register':'/api/account/login',{method:'POST',body:JSON.stringify(payload)});state.customerToken=result.token;state.account=result.account;state.profile={name:result.account.name,phone:result.account.phone||'',address:result.account.address||'',exactPlace:result.account.exactPlace||'',request:result.account.request||''};state.primaryPayment=result.account.primaryPayment||'COD';state.paymentMethod=state.primaryPayment;save('ser-mart-customer-token',state.customerToken);save('ser-mart-account',state.account);save('ser-mart-profile',state.profile);save('ser-mart-primary-payment',state.primaryPayment);state.authMode='login';if(state.pendingCheckout){state.pendingCheckout=false;state.checkout=true;state.tab='cart';}else state.tab='account';await loadOrders();render();notice(registering?'Your Ser Mart account is ready.':'Welcome back.');}catch(err){notice(err.message);if(submit){submit.disabled=false;submit.innerHTML=(registering?'Create account':'Sign in')+' '+svg('arrow');}}return;}
if(e.target.id==='account-profile-form'){e.preventDefault();const fd=new FormData(e.target),payload={name:String(fd.get('name')||'').trim(),phone:String(fd.get('phone')||'').trim(),address:String(fd.get('address')||'').trim(),exactPlace:String(fd.get('exactPlace')||'').trim(),request:String(fd.get('request')||'').trim(),primaryPayment:String(fd.get('primaryPayment')||'COD')};const btn=e.target.querySelector('button[type="submit"]');if(btn){btn.disabled=true;btn.textContent='Saving…';}try{state.account=await api('/api/account/profile',{method:'PUT',body:JSON.stringify(payload)});state.profile={name:state.account.name,phone:state.account.phone,address:state.account.address,exactPlace:state.account.exactPlace,request:state.account.request};state.primaryPayment=state.account.primaryPayment||'COD';state.paymentMethod=state.primaryPayment;save('ser-mart-account',state.account);save('ser-mart-profile',state.profile);save('ser-mart-primary-payment',state.primaryPayment);render();notice('Account details saved.');}catch(err){notice(err.message);if(btn){btn.disabled=false;btn.innerHTML='Save account details '+svg('arrow');}}return;}
if(e.target.id==='primary-payment-form'){e.preventDefault();const fd=new FormData(e.target),method=String(fd.get('primaryPayment')||'COD');try{state.account=await api('/api/account/profile',{method:'PUT',body:JSON.stringify({name:state.account.name,phone:state.account.phone||'',address:state.account.address||'',exactPlace:state.account.exactPlace||'',request:state.account.request||'',primaryPayment:method})});state.primaryPayment=method;state.paymentMethod=method;save('ser-mart-account',state.account);save('ser-mart-primary-payment',method);render();notice('Primary payment saved.');}catch(err){notice(err.message);}return;}
if(e.target.id==='checkout-form'){e.preventDefault();await submitOrder(e.target);return;}
if(e.target.id==='feedback-form'){e.preventDefault();const message=String(new FormData(e.target).get('message')||'').trim();if(!message)return;const savedFeedback=read('ser-mart-feedback',[]);savedFeedback.unshift({message:message,createdAt:new Date().toISOString()});save('ser-mart-feedback',savedFeedback.slice(0,50));e.target.reset();notice('Feedback saved on this device.');return;}
const form=e.target.closest('[data-message-form]');if(form){e.preventDefault();const id=Number(form.dataset.messageForm),ref=state.refs.find(r=>Number(r.id)===id),input=form.querySelector('input[name="text"]');if((!ref&&!state.customerToken)||!input.value.trim())return;try{await api('/api/orders/'+id+'/messages',{method:'POST',headers:ref?{Authorization:'Bearer '+ref.token}:{},body:JSON.stringify({text:input.value.trim()})});await loadOrders();render();notice('Message sent.');}catch(err){notice(err.message);}}
});


/* Update the compact glass header during scroll without rerendering the page. */
let scrollHeaderFrame=0;
window.addEventListener('scroll',()=>{if(scrollHeaderFrame)return;scrollHeaderFrame=requestAnimationFrame(()=>{document.body.classList.toggle('has-scrolled',window.scrollY>100);scrollHeaderFrame=0;});},{passive:true});

/* Keep missing product photos from rendering as broken-image icons. */
document.addEventListener('error',e=>{
  const img=e.target;
  if(!img||img.tagName!=='IMG'||img.dataset.fallbackApplied)return;
  img.dataset.fallbackApplied='1';
  const parent=img.parentElement;
  if(!parent)return;
  const fallback=document.createElement('div');
  fallback.className='ser-image-fallback';
  fallback.setAttribute('role','img');
  fallback.setAttribute('aria-label',img.alt||'Image unavailable');
  fallback.textContent='Image unavailable';
  img.replaceWith(fallback);
},true);

/* Desktop pointer tilt: visual only; never intercept clicks, typing, or touch input. */
const finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
if (finePointer) {
  let tiltFrame = 0;
  let activeTiltCard = null;
  document.addEventListener('pointermove', e => {
    const card = e.target.closest('.product-card, .category-card');
    if (!card) return;
    activeTiltCard = card;
    if (tiltFrame) return;
    tiltFrame = requestAnimationFrame(() => {
      tiltFrame = 0;
      if (!activeTiltCard) return;
      const rect = activeTiltCard.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      activeTiltCard.style.setProperty('--tilt-y', ((x - .5) * 5).toFixed(2) + 'deg');
      activeTiltCard.style.setProperty('--tilt-x', ((.5 - y) * 4).toFixed(2) + 'deg');
      activeTiltCard.style.setProperty('--shine-x', (x * 100).toFixed(1) + '%');
      activeTiltCard.style.setProperty('--shine-y', (y * 100).toFixed(1) + '%');
    });
  }, {passive:true});
  document.addEventListener('pointerout', e => {
    const card = e.target.closest('.product-card, .category-card');
    if (!card || card.contains(e.relatedTarget)) return;
    card.style.setProperty('--tilt-x', '0deg');
    card.style.setProperty('--tilt-y', '0deg');
    card.style.setProperty('--shine-x', '18%');
    card.style.setProperty('--shine-y', '0%');
    if (activeTiltCard === card) activeTiltCard = null;
  }, {passive:true});
}

document.addEventListener('keydown',e=>{if(e.target&&e.target.id==='search-input'&&e.key==='Enter'){e.preventDefault();recordSearchTerm(state.search);e.target.blur();}if(e.key==='Escape')overlay.innerHTML='';});
async function initStore(){try{$('#cart-count').textContent=String(cartCount());await loadProducts();await loadCategories();if(state.customerToken){try{state.account=await api('/api/account/me');state.profile={name:state.account.name,phone:state.account.phone||'',address:state.account.address||'',exactPlace:state.account.exactPlace||'',request:state.account.request||''};state.primaryPayment=state.account.primaryPayment||'COD';state.paymentMethod=state.primaryPayment;save('ser-mart-account',state.account);save('ser-mart-profile',state.profile);save('ser-mart-primary-payment',state.primaryPayment);}catch(_){state.customerToken='';state.account=null;save('ser-mart-customer-token','');save('ser-mart-account',null);}}else{state.account=null;save('ser-mart-account',null);}render();if(state.customerToken||state.refs.length){await loadOrders();if(state.tab==='orders'||state.tab==='preorders')render();}}catch(err){view.innerHTML='<section class="store-error-state"><span class="eyebrow">SER MART</span><h1>We couldn’t open the store.</h1><p>Please check your connection and try again.</p><button class="primary-button compact" type="button" data-retry-store>Try again</button><a href="/seller">Seller sign in</a></section>';}}document.addEventListener('click',e=>{if(!e.target.closest('[data-retry-store]'))return;initStore();});initStore();
})();