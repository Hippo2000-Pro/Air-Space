const loginScreen = document.querySelector('#login-screen');
const setupScreen = document.querySelector('#setup-screen');
const passwordScreen = document.querySelector('#password-screen');
const appScreen = document.querySelector('#app-screen');
const loginForm = document.querySelector('#login-form');
const setupForm = document.querySelector('#setup-form');
const passwordForm = document.querySelector('#password-form');
const content = document.querySelector('#workspace-content');
const nav = document.querySelector('#admin-nav');
const state = { user: null, permissions: [], labels: {}, view: '', bookingsMonth: '', bookingSelectedDay: '' };

const can = (permission) => state.permissions.includes(permission);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const euro = (cents) => cents == null ? 'Tarif à définir' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const dateFr = (value) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(`${value}T12:00:00`));
const roleNames = { owner: 'Directeur / propriétaire', manager: 'Responsable', bookings: 'Réservations', catalog: 'Tarifs et contenu', viewer: 'Lecture seule' };
const rocketThemeNames = { etoiles: 'Étoiles', planetes: 'Planètes', galaxie: 'Galaxie', exploration: 'Exploration' };

function preparedClientEmail(item) {
  const subject = `Votre demande Air Space — ${dateFr(item.event_date)} à ${item.city}`;
  const paragraphs = [
    `Bonjour ${item.name},`,
    `Merci d’avoir contacté Air Space pour l’anniversaire de votre enfant. Nous avons bien noté votre demande pour le ${dateFr(item.event_date)} à ${item.city}.`,
  ];
  const details = [];
  if (item.offer_name) details.push(`la formule « ${item.offer_name} »`);
  if (item.age) details.push(`${item.age} ans pour votre enfant`);
  if (item.guests) details.push(`environ ${item.guests} invités`);
  if (details.length) paragraphs.push(`Pour préparer ce moment, nous avons noté ${details.join(', ')}.`);
  const rocketDetails = [];
  if (item.rocket_name) rocketDetails.push(`le nom « ${item.rocket_name} »`);
  if (rocketThemeNames[item.rocket_theme]) rocketDetails.push(`le thème ${rocketThemeNames[item.rocket_theme].toLowerCase()}`);
  if (/^#[0-9a-f]{6}$/i.test(item.rocket_color || '')) rocketDetails.push(`la couleur ${item.rocket_color.toUpperCase()}`);
  if (/^#[0-9a-f]{6}$/i.test(item.rocket_body_color || '')) rocketDetails.push(`la couleur du corps central ${item.rocket_body_color.toUpperCase()}`);
  if (item.rocket_message) rocketDetails.push(`le message « ${item.rocket_message} »`);
  if (rocketDetails.length) paragraphs.push(`Pour la décoration de la fusée, vous avez choisi ${rocketDetails.join(', ')}. Cette personnalisation sera vérifiée avec vous avant le spectacle.`);
  const schedule = [];
  if (item.event_time) schedule.push(`notre arrivée pour l’installation est prévue à ${item.event_time}`);
  if (item.requested_setup_finish_time) schedule.push(`vous souhaitez que l’installation soit terminée à ${item.requested_setup_finish_time}`);
  if (item.requested_finish_time) schedule.push(`le spectacle doit se terminer au plus tard à ${item.requested_finish_time}`);
  if (schedule.length) paragraphs.push(`Pour les horaires, ${schedule.join(' ; ')}.`);
  if (item.details) paragraphs.push(`Nous avons également pris note de votre message : « ${item.details} ».`);
  paragraphs.push('Nous vérifions les détails de votre demande et vous confirmerons les modalités du spectacle. Si un horaire ou un choix doit être ajusté, nous en parlerons avec vous.');
  paragraphs.push('À bientôt,\nL’équipe Air Space');
  return { subject, body: paragraphs.join('\n\n') };
}

function preparedRefusalEmail(item) {
  const subject = `Suite à votre demande Air Space — ${dateFr(item.event_date)}`;
  const paragraphs = [
    `Bonjour ${item.name},`,
    `Merci d’avoir pensé à Air Space pour l’anniversaire de votre enfant, prévu le ${dateFr(item.event_date)} à ${item.city}.`,
  ];
  if (item.offer_name) paragraphs.push(`Nous avons bien pris en compte votre demande pour la formule « ${item.offer_name} ».`);
  paragraphs.push('Après étude de votre demande, nous sommes désolés de vous informer que nous ne pourrons pas assurer le spectacle à cette date.');
  paragraphs.push('Nous sommes sincèrement désolés de ne pas pouvoir vous accompagner cette fois-ci. Si vous le souhaitez, vous pouvez nous recontacter avec une autre date et nous regarderons si cela est possible.');
  paragraphs.push('Merci de votre compréhension.\n\nBien cordialement,\nL’équipe Air Space');
  return { subject, body: paragraphs.join('\n\n') };
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
  } catch {
    throw new Error('Le serveur Air Space ne répond pas. Relance « Lancer Air Space.bat », puis actualise cette page.');
  }
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(payload.error || 'Une erreur est survenue.');
  return payload;
}

function showScreen(name) {
  loginScreen.hidden = name !== 'login';
  setupScreen.hidden = name !== 'setup';
  passwordScreen.hidden = name !== 'password';
  appScreen.hidden = name !== 'app';
}

async function initialize() {
  try {
    const result = await api('/api/admin/me');
    state.user = result.user;
    state.permissions = result.permissions;
    state.roleLabel = result.role_label;
    if (state.user.must_change_password) return showScreen('password');
    openApp();
  } catch {
    try {
      const setup = await api('/api/admin/setup-status');
      document.querySelector('#setup-key-label').hidden = !setup.setup_key_required;
      if (setup.setup_required && !setup.setup_allowed) {
        showScreen('login');
        document.querySelector('#login-message').textContent = 'La création du premier compte est désactivée sur ce serveur. Demandez au responsable Air Space de configurer le compte.';
      } else {
        showScreen(setup.setup_required ? 'setup' : 'login');
      }
    } catch {
      showScreen('login');
    }
  }
}

function openApp() {
  showScreen('app');
  document.querySelector('#user-name').textContent = state.user.name;
  document.querySelector('#user-role').textContent = state.roleLabel;
  document.querySelector('#user-avatar').textContent = (state.user.name || 'A').trim().charAt(0).toUpperCase();
  const items = [
    ['overview', 'Vue d’ensemble', '⌂', 'bookings:read'],
    ['budget', 'Budget du projet', '€', 'budget:read'],
    ['bookings', 'Réservations', '▣', 'bookings:read'],
    ['offers', 'Tarifs et formules', '◇', 'offers:read'],
    ['settings', 'Réglages du site', '⚙', 'settings:read'],
    ['team', 'Comptes de l’équipe', '♙', 'team:read'],
    ['content-shop', 'Boutique', '▣', 'shop:read'],
    ['content-events', 'Agenda public', '▦', 'events:read'],
    ['content-videos', 'Vidéos', '▶', 'shop:read'],
    ['content-lab', 'Air Lab et communauté', '✦', 'shop:read'],
    ['content-news', 'Actualités', '◉', 'shop:read'],
    ['content-partners', 'Partenaires', '◇', 'shop:read'],
    ['content-airbot', 'AirBot et FAQ', '☄', 'shop:read'],
    ['content-pages', 'Pages publiques', '▤', 'shop:read'],
  ].filter(([, , , permission]) => can(permission));
  nav.replaceChildren();
  for (const [key, label, icon] of items) {
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = key;
    button.innerHTML = `<span class="nav-icon">${icon}</span><span>${label}</span>`;
    button.addEventListener('click', () => loadView(key));
    nav.append(button);
  }
  const pass = document.createElement('button');
  pass.className = 'nav-item';
  pass.dataset.view = 'password';
  pass.innerHTML = '<span class="nav-icon">⌑</span><span>Mon mot de passe</span>';
  pass.addEventListener('click', () => loadView('password'));
  nav.append(pass);
  loadView(items[0]?.[0] || 'password');
}

async function loadView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.querySelector('#breadcrumb').textContent = ({ overview: 'VUE D’ENSEMBLE', budget: 'BUDGET DU PROJET', bookings: 'RÉSERVATIONS', offers: 'TARIFS ET FORMULES', settings: 'RÉGLAGES DU SITE', team: 'COMPTES DE L’ÉQUIPE', password: 'MON COMPTE', 'content-shop':'BOUTIQUE', 'content-events':'AGENDA PUBLIC', 'content-videos':'VIDÉOS', 'content-lab':'AIR LAB ET COMMUNAUTÉ', 'content-news':'ACTUALITÉS', 'content-partners':'PARTENAIRES', 'content-airbot':'AIRBOT ET FAQ', 'content-pages':'PAGES PUBLIQUES' })[view] || 'AIR SPACE';
  content.innerHTML = '<div class="loading-state">Chargement de votre espace…</div>';
  try {
    if (view === 'overview') return renderOverview(await api('/api/admin/overview'));
    if (view === 'budget') return renderBudget(await api('/api/admin/budget'));
    if (view === 'bookings') return renderBookings(await api('/api/admin/reservations'));
    if (view === 'offers') return renderOffers(await api('/api/admin/offers'));
    if (view === 'settings') return renderSettings(await api('/api/admin/settings'));
    if (view === 'team') return renderTeam(await api('/api/admin/users'));
    if (view === 'content' || view.startsWith('content-')) return renderContentCenter(await api('/api/admin/content'), view === 'content' ? 'content-shop' : view);
    if (view === 'password') return renderPassword();
  } catch (error) {
    content.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`;
  }
}

function renderContentCenter(data, section = 'content-shop') {
  const products=data.products.map(x=>`<article class="content-row"><div><b>${esc(x.name)}</b><span>${esc(euro(x.price_cents))} · ${x.active?'Publié':'Masqué'}</span></div><button class="plain-button" data-edit-content="products" data-id="${x.id}">Modifier</button><button class="plain-button" data-remove-content="products" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucun article publié.</p>';
  const events=data.events.map(x=>`<article class="content-row"><div><b>${esc(x.title)}</b><span>${esc(dateFr(x.event_date))} · ${esc(x.event_time)} · ${esc(x.city)} ${x.public?'· Public':'· Masqué'}</span></div><button class="plain-button" data-edit-content="events" data-id="${x.id}">Modifier</button><button class="plain-button" data-remove-content="events" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucun spectacle dans l’agenda.</p>';
  const videos=data.videos.map(x=>`<article class="content-row"><div><b>${esc(x.title)}</b><span>${esc(x.video_url)}</span></div><button class="plain-button" data-edit-content="videos" data-id="${x.id}">Modifier</button><button class="plain-button" data-remove-content="videos" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucune vidéo exemple.</p>';
  const orders=data.orders.map(x=>`<article class="content-row"><div><b>${esc(x.product_name)} × ${x.quantity}</b><span>${esc(x.customer_name)} · ${esc(x.email)} · ${esc(dateFr(x.created_at.slice(0,10)))} · ${esc(({new:'À traiter',contacted:'Contactée',confirmed:'Confirmée',declined:'Refusée'})[x.status]||x.status)}</span></div><div><a class="plain-button" href="mailto:${encodeURIComponent(x.email)}?subject=${encodeURIComponent('Votre demande Air Space — '+x.product_name)}">Répondre</a><select data-order-status="${x.id}" aria-label="État de la demande"><option value="new" ${x.status==='new'?'selected':''}>À traiter</option><option value="contacted" ${x.status==='contacted'?'selected':''}>Contactée</option><option value="confirmed" ${x.status==='confirmed'?'selected':''}>Confirmée</option><option value="declined" ${x.status==='declined'?'selected':''}>Refusée</option></select></div></article>`).join('')||'<p>Aucune demande de commande.</p>';
  const votes=data.votes.map(x=>`<article class="content-row"><div><b>${esc(x.idea)}</b><span>${x.votes} vote(s)</span></div><button class="plain-button" data-remove-content="votes" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucun vote.</p>';
  const eco=data.eco.map(x=>`<article class="content-row"><div><b>${esc(x.material)} · ${esc(x.quantity)} ${esc(x.unit)}</b><span>${esc(x.note)}</span></div><button class="plain-button" data-remove-content="eco" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucune donnée éco.</p>';
  const ideas=data.ideas.map(x=>`<article class="content-row"><div><b>${esc(x.nickname)}</b><span>${esc(x.idea)} · ${esc(x.status)}</span></div><div><button class="plain-button" data-idea-status="approved" data-id="${x.id}">Publier</button><button class="plain-button" data-idea-status="rejected" data-id="${x.id}">Refuser</button></div></article>`).join('')||'<p>Aucune suggestion.</p>';
  const news=data.news.map(x=>`<article class="content-row"><div><b>${esc(x.title)}</b><span>${esc(dateFr(x.created_at.slice(0,10)))}</span></div><button class="plain-button" data-edit-content="news" data-id="${x.id}">Modifier</button><button class="plain-button" data-remove-content="news" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucune actualité.</p>';
  const partners=data.partners.map(x=>`<article class="content-row"><div><b>${esc(x.name)}</b><span>${esc(x.url)}</span></div><button class="plain-button" data-edit-content="partners" data-id="${x.id}">Modifier</button><button class="plain-button" data-remove-content="partners" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucun partenaire.</p>';
  const challenges=data.challenges.map(x=>`<article class="content-row"><div><b>${esc(x.title)}</b><span>+${x.reward_points} points · solution privée</span></div><button class="plain-button" data-edit-content="challenges" data-id="${x.id}">Modifier</button><button class="plain-button" data-remove-content="challenges" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucune mission Air-Points.</p>';
  const botAnswers=data.bot_answers.map(x=>`<article class="content-row"><div><b>${esc(x.keywords)}</b><span>${esc(x.answer)}</span></div><button class="plain-button" data-edit-content="bot_answers" data-id="${x.id}">Modifier</button><button class="plain-button" data-remove-content="bot_answers" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucune réponse personnalisée.</p>';
  const pages=data.pages.map(x=>`<article class="content-row"><div><b>${esc(x.title)}</b><span>${esc(({about:'À propos',faq:'FAQ',recruitment:'Recrutement',legal:'Mentions légales',privacy:'Confidentialité',other:'Autre'})[x.page_key])}</span></div><button class="plain-button" data-edit-content="pages" data-id="${x.id}">Modifier</button><button class="plain-button" data-remove-content="pages" data-id="${x.id}">Supprimer</button></article>`).join('')||'<p>Aucune page d’information.</p>';
  content.innerHTML=`<div class="page-heading"><div><p class="eyebrow">PUBLICATION · ESPACE ÉQUIPE</p><h1>Contenus publics<span>.</span></h1><p>Chaque rubrique est gérée séparément. Les visiteurs n’ont pas besoin de compte.</p></div></div><div class="content-manager-grid"><section class="panel"><h2>Ajouter un article</h2><form id="product-add" class="manage-form"><input type="hidden" name="id"><label>Nom<input name="name" maxlength="100" required></label><label>Description<textarea name="description" maxlength="1000"></textarea></label><label>Prix (€)<input name="price" type="number" min="0" step="0.01" required></label><label>Image (lien HTTPS facultatif)<input name="image_url" type="url"></label><button class="button button-dark">Publier l’article</button><p id="product-message" role="status"></p></form></section><section class="panel"><h2>Ajouter un spectacle public</h2><form id="event-add" class="manage-form"><input type="hidden" name="id"><label>Titre<input name="title" maxlength="120" required></label><label>Description<textarea name="description" maxlength="1000"></textarea></label><div class="form-pair"><label>Date<input name="event_date" type="date" required></label><label>Heure<input name="event_time" type="time"></label></div><div class="form-pair"><label>Ville<input name="city" maxlength="100"></label><label>Lieu<input name="venue" maxlength="160"></label></div><button class="button button-dark">Ajouter à l’agenda public</button><p id="event-message" role="status"></p></form></section><section class="panel"><h2>Ajouter une vidéo de décollage</h2><form id="video-add" class="manage-form"><input type="hidden" name="id"><label>Titre<input name="title" maxlength="120" required></label><label>Description<textarea name="description" maxlength="1000"></textarea></label><label>Lien YouTube, Vimeo ou vidéo MP4/WebM (HTTPS)<input name="video_url" type="url" required></label><button class="button button-dark">Publier le lien</button><p id="video-message" role="status"></p></form><form id="video-upload" class="manage-form video-upload-form" enctype="multipart/form-data"><h3>Ou importer une vidéo depuis un dossier</h3><label>Titre<input name="title" maxlength="120" required></label><label>Description<textarea name="description" maxlength="1000"></textarea></label><label>Fichier MP4 ou WebM · 50 Mo maximum<input name="file" type="file" accept="video/mp4,video/webm,.mp4,.webm" required></label><button class="button button-dark">Importer la vidéo</button><p role="status" aria-live="polite"></p></form></section><section class="panel"><h2>Articles visibles</h2>${products}</section><section class="panel"><h2>Agenda public</h2>${events}</section><section class="panel"><h2>Vidéos visibles</h2>${videos}</section><section class="panel content-orders"><h2>Demandes de la boutique</h2>${orders}</section></div>`;
  content.insertAdjacentHTML('beforeend',`<section class="panel"><h2>Créer un vote</h2><form id="vote-add" class="manage-form"><label>Idée proposée<input name="idea" maxlength="200" required></label><button class="button button-dark">Ouvrir le vote</button></form>${votes}</section><section class="panel"><h2>EcoTracker</h2><form id="eco-add" class="manage-form"><label>Matériau réutilisé<input name="material" maxlength="80" required></label><div class="form-pair"><label>Quantité<input name="quantity" type="number" min="0.01" step="0.01" required></label><label>Unité<select name="unit"><option>kg</option><option>g</option><option>pièces</option><option>L</option></select></label></div><label>Note<textarea name="note" maxlength="300"></textarea></label><button class="button button-dark">Ajouter au suivi</button></form>${eco}</section><section class="panel content-orders"><h2>Suggestions à modérer</h2>${ideas}</section>`);
  content.insertAdjacentHTML('beforeend',`<section class="panel"><h2>Actualités</h2><form id="news-add" class="manage-form"><input type="hidden" name="id"><label>Titre<input name="title" maxlength="120" required></label><label>Texte<textarea name="body" maxlength="3000" required></textarea></label><button class="button button-dark">Publier l’actualité</button></form>${news}</section><section class="panel"><h2>Partenaires</h2><form id="partner-add" class="manage-form"><input type="hidden" name="id"><label>Nom<input name="name" maxlength="120" required></label><label>Présentation<textarea name="description" maxlength="1000"></textarea></label><label>Site web HTTPS (facultatif)<input name="url" type="url"></label><button class="button button-dark">Ajouter le partenaire</button></form>${partners}</section><section class="panel"><h2>Mission Air-Points</h2><form id="challenge-add" class="manage-form"><input type="hidden" name="id"><label>Titre<input name="title" maxlength="120" required></label><label>Question publique<textarea name="question" maxlength="500" required></textarea></label><label>Réponse attendue<input name="answer" maxlength="120" required></label><label>Points attribués<input name="reward_points" type="number" min="1" max="100" value="5" required></label><button class="button button-dark">Publier la mission</button></form>${challenges}<p>Les scores restent anonymes et propres à chaque appareil ; aucune récompense commerciale n’est associée aux points.</p></section><section class="panel"><h2>Réponses AirBot et FAQ</h2><form id="bot-answer-add" class="manage-form"><input type="hidden" name="id"><label>Mots-clés séparés par des virgules<input name="keywords" maxlength="300" required placeholder="fusée, lancement"></label><label>Réponse<textarea name="answer" maxlength="800" required></textarea></label><button class="button button-dark">Ajouter la réponse</button></form>${botAnswers}</section><section class="panel"><h2>Air-Points · activité</h2><p>${data.points_summary.players} appareil(s) ont un score enregistré · ${data.points_summary.points} points attribués au total.</p></section>`);
  content.insertAdjacentHTML('beforeend',`<section class="panel"><h2>Pages et informations publiques</h2><form id="public-page-add" class="manage-form"><input type="hidden" name="id"><label>Rubrique<select name="page_key"><option value="about">À propos</option><option value="faq">FAQ</option><option value="recruitment">Recrutement</option><option value="legal">Mentions légales</option><option value="privacy">Confidentialité</option><option value="other">Autre information</option></select></label><label>Titre affiché<input name="title" maxlength="120" required></label><label>Texte public<textarea name="body" rows="5" maxlength="5000" required></textarea></label><button class="button button-dark">Publier la page</button><p>Pour les mentions légales et la confidentialité, faites vérifier le texte par un adulte responsable avant publication.</p></form>${pages}</section>`);
  const groupForTitle = (title) => {
    if (/article|boutique|commande/i.test(title)) return 'content-shop';
    if (/spectacle public|agenda public/i.test(title)) return 'content-events';
    if (/vidéo/i.test(title)) return 'content-videos';
    if (/vote|ecotracker|suggestion|air-points/i.test(title)) return 'content-lab';
    if (/actualité/i.test(title)) return 'content-news';
    if (/partenaire/i.test(title)) return 'content-partners';
    if (/airbot|faq/i.test(title)) return 'content-airbot';
    if (/pages et informations/i.test(title)) return 'content-pages';
    return 'content-pages';
  };
  content.querySelectorAll('.panel').forEach((panel) => {
    const title = panel.querySelector('h2')?.textContent || '';
    panel.hidden = groupForTitle(title) !== section;
  });
  const titles = {'content-shop':'Boutique et commandes','content-events':'Agenda des spectacles','content-videos':'Vidéos de décollage','content-lab':'Air Lab et communauté','content-news':'Actualités','content-partners':'Partenaires','content-airbot':'AirBot et réponses FAQ','content-pages':'Pages et informations du site'};
  const heading=content.querySelector('.page-heading');
  if(heading){heading.querySelector('h1').innerHTML=`${titles[section]||'Contenus'}<span>.</span>`;heading.querySelector('p:last-child').textContent='Gérez cette rubrique indépendamment. Les changements publiés apparaissent sur le site visiteurs.';}
  const bind=(id,kind,msg,mapper)=>content.querySelector(id).addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,values=mapper(Object.fromEntries(new FormData(form))),itemId=form.elements.id?.value;try{await api(itemId?`/api/admin/content/${kind}/${itemId}`:'/api/admin/content',{method:itemId?'PATCH':'POST',body:JSON.stringify({kind,...values})});await loadView(state.view);}catch(err){const target=msg&&content.querySelector(msg);if(target)target.textContent=err.message;else alert(err.message);}});
  bind('#product-add','products','#product-message',x=>({name:x.name,description:x.description,price_cents:Math.round(Number(x.price)*100),image_url:x.image_url,active:true}));
  bind('#event-add','events','#event-message',x=>({...x,public:true}));
  bind('#video-add','videos','#video-message',x=>x);
  content.querySelector('#video-upload')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form=event.currentTarget; const status=form.querySelector('[role="status"]'); const button=form.querySelector('button');
    button.disabled=true; status.textContent='Import de la vidéo…';
    try { const response=await fetch('/api/admin/videos/upload',{method:'POST',body:new FormData(form)}); const result=await response.json(); if(!response.ok) throw new Error(result.error||'Import impossible.'); await loadView(state.view); }
    catch(error){status.textContent=error.message;button.disabled=false;}
  });
  bind('#vote-add','votes',null,x=>x);
  bind('#eco-add','eco',null,x=>({...x,quantity:Number(x.quantity)}));
  bind('#news-add','news',null,x=>x);
  bind('#partner-add','partners',null,x=>x);
  bind('#challenge-add','challenges',null,x=>({...x,reward_points:Number(x.reward_points)}));
  bind('#bot-answer-add','bot_answers',null,x=>x);
  bind('#public-page-add','pages',null,x=>x);
  content.querySelectorAll('[data-idea-status]').forEach(b=>b.addEventListener('click',async()=>{try{await api(`/api/admin/community/ideas/${b.dataset.id}`,{method:'PATCH',body:JSON.stringify({status:b.dataset.ideaStatus})});await loadView(state.view);}catch(err){alert(err.message);}}));
  content.querySelectorAll('[data-order-status]').forEach(s=>s.addEventListener('change',async()=>{try{await api(`/api/admin/shop/orders/${s.dataset.orderStatus}`,{method:'PATCH',body:JSON.stringify({status:s.value})});}catch(err){alert(err.message);await loadView(state.view);}}));
  content.querySelectorAll('[data-edit-content]').forEach(b=>b.addEventListener('click',()=>{const kind=b.dataset.editContent,collections={products:data.products,events:data.events,videos:data.videos,news:data.news,partners:data.partners,challenges:data.challenges,bot_answers:data.bot_answers,pages:data.pages},forms={products:'product-add',events:'event-add',videos:'video-add',news:'news-add',partners:'partner-add',challenges:'challenge-add',bot_answers:'bot-answer-add',pages:'public-page-add'},item=collections[kind]?.find(x=>String(x.id)===b.dataset.id),form=content.querySelector(`#${forms[kind]}`);if(!item||!form)return;form.elements.id.value=item.id;for(const [key,value] of Object.entries(item)){if(form.elements[key])form.elements[key].value=value;}if(kind==='products')form.elements.price.value=(item.price_cents/100).toFixed(2);form.querySelector('button').textContent='Enregistrer les modifications';form.scrollIntoView({behavior:'smooth',block:'center'});}));
  content.querySelectorAll('[data-remove-content]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Supprimer ce contenu ?'))return;try{await api(`/api/admin/content/${b.dataset.removeContent}/${b.dataset.id}`,{method:'DELETE',body:'{}'});await loadView(state.view);}catch(err){alert(err.message);}}));
}

function renderOverview(data) {
  const recent = data.recent.length ? data.recent.map((item) => `<article class="recent-row"><div><b>${esc(item.name)}</b><span>${esc(dateFr(item.event_date))} · ${esc(item.city)}</span></div><span class="status-pill status-${esc(item.status)}">${esc(({ new: 'À traiter', contacted: 'Contactée', confirmed: 'Confirmée', declined: 'Refusée' })[item.status])}</span></article>`).join('') : '<div class="empty-state">Les nouvelles demandes apparaîtront ici.</div>';
  const budgetShortcut = can('budget:read') ? '<button class="plain-button overview-budget-link" data-go="budget">Suivre le budget ↗</button>' : '';
  content.innerHTML = `<div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> AIR SPACE · RHÔNE</p><h1>Bonjour ${esc(state.user.name.split(' ')[0])}<span>.</span></h1><p>Voici le point sur votre activité.</p></div><div class="overview-actions">${budgetShortcut}<button class="button button-primary" data-go="bookings">Voir les réservations ↗</button></div></div>
    <div class="metric-grid"><article><span>DEMANDES DE SPECTACLE</span><b>${data.total}</b><i>À traiter : ${data.new}</i></article><article><span>COMMANDES À TRAITER</span><b>${data.new_orders}</b><i>Demandes de la boutique</i></article><article><span>SPECTACLES PUBLICS</span><b>${data.upcoming_events}</b><i>À venir dans l’agenda</i></article><article><span>ARTICLES EN BOUTIQUE</span><b>${data.live_products}</b><i>Visibles pour les visiteurs</i></article><article><span>IDÉES À MODÉRER</span><b>${data.pending_ideas}</b><i>En attente de validation</i></article><article><span>CONFIRMÉES</span><b>${data.confirmed}</b><i>Événements réservés</i></article></div>
    <section class="panel"><div class="panel-heading"><div><span class="panel-kicker">ACTIVITÉ RÉCENTE</span><h2>Dernières demandes</h2></div><button class="plain-button" data-go="bookings">Tout voir ↗</button></div><div class="recent-list">${recent}</div></section>`;
}

function renderBudget(data) {
  const paidRatio = data.budget_limit_cents > 0 ? Math.min(100, Math.round(data.spent_cents / data.budget_limit_cents * 100)) : 100;
  const committedRatio = data.budget_limit_cents > 0 ? Math.min(100, Math.round((data.spent_cents + data.planned_cents) / data.budget_limit_cents * 100)) : 100;
  const categories = Object.entries(data.categories || {});
  const maxCategory = Math.max(1, ...data.by_category.map((item) => item.amount_cents));
  const categoryRows = data.by_category.length
    ? data.by_category.map((item) => `<div class="budget-category-row"><span>${esc(data.categories[item.category] || item.category)}</span><div class="budget-category-track"><i style="width:${Math.round(item.amount_cents / maxCategory * 100)}%"></i></div><b>${esc(euro(item.amount_cents))}</b></div>`).join('')
    : '<p class="budget-muted">Les dépenses ajoutées apparaîtront ici.</p>';
  const today = isoDay(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
  content.innerHTML = `<div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> SUIVI FINANCIER · DIRECTEUR</p><h1>Budget du projet<span>.</span></h1><p>Suivez ce qui est payé, ce qui est prévu et ce qu’il reste sur le budget Air Space.</p></div><button type="button" class="plain-button" id="budget-export">Exporter en CSV ↓</button></div>
    <section class="budget-overview"><article class="budget-total"><span>BUDGET TOTAL</span><b>${esc(euro(data.budget_limit_cents))}</b><form id="budget-limit-form"><label for="budget-limit-input">Modifier le plafond</label><div><input id="budget-limit-input" type="number" min="1" max="1000000" step="0.01" value="${(data.budget_limit_cents / 100).toFixed(2)}" required/><button type="submit" aria-label="Enregistrer le plafond">Enregistrer</button></div></form></article><article class="budget-metric"><span>DÉPENSÉ</span><b>${esc(euro(data.spent_cents))}</b><small>Achats déjà payés</small></article><article class="budget-metric"><span>PRÉVU</span><b>${esc(euro(data.planned_cents))}</b><small>Dépenses à venir</small></article><article class="budget-metric ${data.remaining_cents < 0 ? 'is-over-budget' : ''}"><span>RESTE APRÈS PRÉVISIONS</span><b>${esc(euro(data.remaining_cents))}</b><small>${data.remaining_cents < 0 ? 'Le plafond est dépassé' : 'Disponible dans l’enveloppe'}</small></article></section>
    <section class="panel budget-progress-panel"><div class="budget-progress-heading"><div><span class="panel-kicker">UTILISATION DU BUDGET</span><h2>${committedRatio}% engagé</h2></div><span>${esc(euro(data.spent_cents + data.planned_cents))} sur ${esc(euro(data.budget_limit_cents))}</span></div><div class="budget-progress-track" role="progressbar" aria-label="Part du budget dépensée ou prévue" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${committedRatio}"><i style="width:${committedRatio}%"></i><b style="width:${paidRatio}%"></b></div><p><i></i> Payé <i></i> Prévu</p></section>
    <div class="budget-workspace"><section class="panel"><div class="panel-heading"><div><span class="panel-kicker" id="expense-form-kicker">NOUVELLE LIGNE</span><h2 id="expense-form-title">Ajouter une dépense</h2></div></div><form id="expense-form" class="manage-form"><input type="hidden" name="id"/><label>Description<input name="description" maxlength="180" placeholder="Ex. Bouteilles et raccords" required/></label><div class="form-pair"><label>Montant (€)<input name="amount_euros" type="number" min="0.01" max="1000000" step="0.01" placeholder="0,00" required/></label><label>Date<input name="spent_on" type="date" value="${today}" required/></label></div><div class="form-pair"><label>Catégorie<select name="category" required>${categories.map(([key,label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('')}</select></label><label>État<select name="status"><option value="paid">Déjà payée</option><option value="planned">Dépense prévue</option></select></label></div><label>Détail facultatif<textarea name="details" rows="2" maxlength="500" placeholder="Ex. reçu conservé dans le dossier Air Space"></textarea></label><div class="budget-form-actions"><button class="button button-dark" type="submit" id="expense-save">Ajouter au budget</button><button class="plain-button" type="button" id="expense-cancel" hidden>Annuler la modification</button></div><p class="inline-message" id="expense-message" aria-live="polite"></p></form></section><section class="panel"><div class="panel-heading"><div><span class="panel-kicker">RÉPARTITION</span><h2>Par catégorie</h2></div></div><div class="budget-category-list">${categoryRows}</div></section></div>
    <section class="panel budget-history"><div class="panel-heading"><div><span class="panel-kicker">JOURNAL DES MOUVEMENTS</span><h2>Dépenses et prévisions</h2></div><span class="count-badge">${data.expenses.length} ligne${data.expenses.length === 1 ? '' : 's'}</span></div><div class="budget-filters"><label>Catégorie<select id="expense-filter-category"><option value="">Toutes les catégories</option>${categories.map(([key,label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('')}</select></label><label>État<select id="expense-filter-status"><option value="">Tout</option><option value="paid">Payées</option><option value="planned">Prévues</option></select></label></div><div class="expense-list" id="expense-list"></div><p class="budget-muted">Le fichier CSV contient toutes les lignes pour les ouvrir dans un tableur.</p></section>`;

  const list = content.querySelector('#expense-list');
  const categoryFilter = content.querySelector('#expense-filter-category');
  const statusFilter = content.querySelector('#expense-filter-status');
  const expenseForm = content.querySelector('#expense-form');
  const message = content.querySelector('#expense-message');
  const saveButton = content.querySelector('#expense-save');
  const cancelButton = content.querySelector('#expense-cancel');
  function drawExpenses() {
    const filtered = data.expenses.filter((item) => (!categoryFilter.value || item.category === categoryFilter.value) && (!statusFilter.value || item.status === statusFilter.value));
    list.innerHTML = filtered.length ? `<div class="expense-table-wrap"><table class="expense-table"><thead><tr><th>Date</th><th>Dépense</th><th>Catégorie</th><th>État</th><th>Montant</th><th>Actions</th></tr></thead><tbody>${filtered.map((item) => `<tr><td>${esc(dateFr(item.spent_on))}</td><td><b>${esc(item.description)}</b>${item.details ? `<small>${esc(item.details)}</small>` : ''}</td><td>${esc(data.categories[item.category] || item.category)}</td><td><span class="expense-status ${item.status === 'paid' ? 'is-paid' : 'is-planned'}">${item.status === 'paid' ? 'Payée' : 'Prévue'}</span></td><td class="expense-amount">${esc(euro(item.amount_cents))}</td><td><div class="expense-row-actions"><button type="button" data-edit-expense="${item.id}">Modifier</button><button type="button" data-remove-expense="${item.id}">Supprimer</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Aucune ligne ne correspond à ce filtre.</div>';
    list.querySelectorAll('[data-edit-expense]').forEach((button) => button.addEventListener('click', () => {
      const item = data.expenses.find((expense) => String(expense.id) === button.dataset.editExpense);
      if (!item) return;
      expenseForm.elements.id.value = item.id;
      expenseForm.elements.description.value = item.description;
      expenseForm.elements.amount_euros.value = (item.amount_cents / 100).toFixed(2);
      expenseForm.elements.spent_on.value = item.spent_on;
      expenseForm.elements.category.value = item.category;
      expenseForm.elements.status.value = item.status;
      expenseForm.elements.details.value = item.details || '';
      content.querySelector('#expense-form-kicker').textContent = 'MODIFICATION';
      content.querySelector('#expense-form-title').textContent = 'Modifier cette ligne';
      saveButton.textContent = 'Enregistrer la modification';
      cancelButton.hidden = false;
      expenseForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    list.querySelectorAll('[data-remove-expense]').forEach((button) => button.addEventListener('click', async () => {
      const item = data.expenses.find((expense) => String(expense.id) === button.dataset.removeExpense);
      if (!item || !window.confirm(`Supprimer la ligne « ${item.description} » de ${euro(item.amount_cents)} ?`)) return;
      button.disabled = true;
      try {
        await api(`/api/admin/expenses/${item.id}`, { method: 'DELETE', body: '{}' });
        renderBudget(await api('/api/admin/budget'));
        content.querySelector('#expense-message').textContent = 'La ligne a été supprimée.';
      } catch (error) { button.disabled = false; message.textContent = error.message; }
    }));
  }
  drawExpenses();
  categoryFilter.addEventListener('change', drawExpenses);
  statusFilter.addEventListener('change', drawExpenses);
  content.querySelector('#budget-limit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(content.querySelector('#budget-limit-input').value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return;
    try {
      await api('/api/admin/budget', { method: 'PATCH', body: JSON.stringify({ budget_limit_cents: Math.round(amount * 100) }) });
      renderBudget(await api('/api/admin/budget'));
      content.querySelector('#expense-message').textContent = 'Le plafond du budget a été enregistré.';
    } catch (error) { content.querySelector('#expense-message').textContent = error.message; }
  });
  expenseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!expenseForm.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(expenseForm).entries());
    const amount = Number(fields.amount_euros);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) { message.textContent = 'Vérifiez le montant saisi.'; return; }
    const id = fields.id;
    const payload = { description: fields.description, amount_cents: Math.round(amount * 100), spent_on: fields.spent_on, category: fields.category, status: fields.status, details: fields.details };
    saveButton.disabled = true;
    try {
      await api(id ? `/api/admin/expenses/${id}` : '/api/admin/expenses', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      renderBudget(await api('/api/admin/budget'));
      content.querySelector('#expense-message').textContent = id ? 'La dépense a été modifiée.' : 'La dépense a été ajoutée.';
    } catch (error) { saveButton.disabled = false; message.textContent = error.message; }
  });
  cancelButton.addEventListener('click', () => renderBudget(data));
  content.querySelector('#budget-export').addEventListener('click', () => {
    const csvCell = (value) => {
      let text = String(value ?? '');
      if (/^[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [['Date','Description','Catégorie','État','Montant EUR','Détails'], ...data.expenses.map((item) => [item.spent_on,item.description,data.categories[item.category] || item.category,item.status === 'paid' ? 'Payée' : 'Prévue',(item.amount_cents / 100).toFixed(2),item.details || ''])];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `air-space-budget-${today}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function isoDay(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function renderBookings({ reservations }) {
  const today = new Date();
  const currentMonth = isoDay(today.getFullYear(), today.getMonth() + 1, 1).slice(0, 7);
  if (!state.bookingsMonth) state.bookingsMonth = currentMonth;
  if (!state.bookingSelectedDay) state.bookingSelectedDay = isoDay(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const [year, month] = state.bookingsMonth.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = (monthStart.getDay() + 6) % 7;
  const reservationsByDay = new Map();
  reservations.forEach((reservation) => {
    if (!reservationsByDay.has(reservation.event_date)) reservationsByDay.set(reservation.event_date, []);
    reservationsByDay.get(reservation.event_date).push(reservation);
  });
  const calendarCells = [
    ...Array.from({ length: leadingBlanks }, () => '<span class="calendar-empty" aria-hidden="true"></span>'),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const value = isoDay(year, month, day);
      const count = reservationsByDay.get(value)?.length || 0;
      const selected = value === state.bookingSelectedDay;
      const isToday = value === isoDay(today.getFullYear(), today.getMonth() + 1, today.getDate());
      return `<button type="button" class="calendar-day ${count ? 'has-bookings' : ''} ${selected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}" data-calendar-day="${value}" aria-pressed="${selected}" aria-label="${esc(dateFr(value))}${count ? `, ${count} réservation${count > 1 ? 's' : ''}` : ', aucune réservation'}"><span>${day}</span>${count ? `<i>${count} résa.</i>` : '<i aria-hidden="true">&nbsp;</i>'}</button>`;
    }),
  ].join('');
  const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(monthStart);
  const selectedReservations = reservationsByDay.get(state.bookingSelectedDay) || [];
  const details = selectedReservations.length
    ? selectedReservations.map((item) => {
      const rocketColor = /^#[0-9a-f]{6}$/i.test(item.rocket_color || '') ? item.rocket_color : '#3978b8';
      const rocketBodyColor = /^#[0-9a-f]{6}$/i.test(item.rocket_body_color || '') ? item.rocket_body_color : '#b86b2c';
      const guestLabel = item.guests ? `${item.guests} invité${item.guests === 1 ? '' : 's'}` : 'Nombre d’invités à préciser';
      const statusLabel = ({ new: 'À traiter', contacted: 'Contactée', confirmed: 'Confirmée', declined: 'Refusée' })[item.status] || 'À traiter';
      const canManage = can('bookings:write');
      const clientEmail = item.status === 'declined' ? preparedRefusalEmail(item) : preparedClientEmail(item);
      const statusControl = canManage
        ? `<select class="status-select status-${esc(item.status)}" data-reservation-status="${item.id}" aria-label="Statut de ${esc(item.name)}">${Object.entries({ new: 'À traiter', contacted: 'Contactée', confirmed: 'Confirmée', declined: 'Refusée' }).map(([value,label]) => `<option value="${value}" ${value === item.status ? 'selected' : ''}>${label}</option>`).join('')}</select>`
        : `<span class="status-pill status-${esc(item.status)}">${statusLabel}</span>`;
      const timeControl = canManage
        ? `<div class="event-arrival"><label for="event-time-${item.id}">Heure d’arrivée de l’équipe pour l’installation</label><p class="event-arrival-request">Installation terminée à : <b>${esc(item.requested_setup_finish_time || 'horaire non précisé')}</b><br/>Spectacle terminé au plus tard à : <b>${esc(item.requested_finish_time || 'horaire non précisé')}</b></p><div><input id="event-time-${item.id}" type="time" value="${esc(item.event_time || '')}" data-reservation-time="${item.id}"/><button type="button" class="save-time-button" data-save-time="${item.id}">Enregistrer et préparer l’e-mail</button></div></div>`
        : `<p class="event-arrival-readonly">Arrivée de l’équipe : <b>${esc(item.event_time || 'à préciser')}</b> · Installation terminée à : <b>${esc(item.requested_setup_finish_time || 'non précisé')}</b> · Spectacle terminé au plus tard à : <b>${esc(item.requested_finish_time || 'non précisé')}</b></p>`;
      const replyPanel = canManage && ['new', 'contacted', 'declined'].includes(item.status)
        ? `<details class="reply-details" ${item.status === 'declined' ? `data-refusal-email="${item.id}"` : ''}><summary>${item.status === 'declined' ? `Vérifier le courriel de refus pour ${esc(item.name)}` : `Vérifier le message préparé pour ${esc(item.name)}`}</summary><form class="reply-form" data-reply-form data-recipient="${esc(item.email)}"><label>Destinataire<input type="email" value="${esc(item.email)}" readonly/></label><label>Objet<input name="subject" maxlength="160" required value="${esc(clientEmail.subject)}"/></label><label>Message personnalisé<textarea name="body" rows="10" maxlength="4000" required>${esc(clientEmail.body)}</textarea></label><button class="button button-dark" type="submit">Vérifier et ouvrir le brouillon</button><p>Le destinataire, l’objet et le message sont préremplis. Relisez ou modifiez le texte, puis envoyez-le depuis votre application e-mail.</p></form></details>`
        : '';
      const deleteButton = canManage && item.status === 'declined'
        ? `<button type="button" class="delete-reservation-button" data-delete-reservation="${item.id}">Supprimer la demande refusée</button>`
        : '';
      return `<article class="booking-card"><div class="booking-card-top"><div><h3>${esc(item.name)}</h3><p>${esc(dateFr(item.event_date))} · ${esc(item.city)}${item.event_time ? ` · Arrivée confirmée à ${esc(item.event_time)}` : ''}</p></div><div class="booking-actions">${statusControl}</div></div>${timeControl}<div class="booking-data"><div><span>CONTACT</span><b>${esc(item.email)}</b>${item.phone ? `<b>${esc(item.phone)}</b>` : ''}</div><div><span>FORMULE</span><b>${esc(item.offer_name || 'À définir')}</b>${item.offer_name ? `<b>${esc(euro(item.offer_price_cents))}</b>` : ''}</div><div><span>INVITÉS ET ÂGE</span><b>${esc(guestLabel)}${item.age ? ` · ${item.age} ans` : ''}</b></div></div><div class="rocket-request"><span>PERSONNALISATION DE LA FUSÉE</span><b><i style="background-color:${rocketColor}" aria-hidden="true"></i>${esc(item.rocket_name || 'Sans nom')} · ${esc(rocketThemeNames[item.rocket_theme] || 'Étoiles')} · ${esc(rocketColor.toUpperCase())}</b>${item.rocket_message ? `<p>${esc(item.rocket_message)}</p>` : ''}</div>${item.details ? `<p class="booking-note">${esc(item.details)}</p>` : '<p class="booking-note">Aucun détail complémentaire.</p>'}${replyPanel}${deleteButton ? `<div class="reservation-delete-row">${deleteButton}</div>` : ''}<div class="booking-created">Demande reçue le ${esc(new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.created_at)))}</div></article>`;
        return `<article class="booking-card"><div class="booking-card-top"><div><h3>${esc(item.name)}</h3><p>${esc(dateFr(item.event_date))} · ${esc(item.city)}${item.event_time ? ` · Arrivée confirmée à ${esc(item.event_time)}` : ''}</p></div><div class="booking-actions">${statusControl}</div></div>${timeControl}<div class="booking-data"><div><span>CONTACT</span><b>${esc(item.email)}</b>${item.phone ? `<b>${esc(item.phone)}</b>` : ''}</div><div><span>FORMULE</span><b>${esc(item.offer_name || 'À définir')}</b>${item.offer_name ? `<b>${esc(euro(item.offer_price_cents))}</b>` : ''}</div><div><span>INVITÉS ET ÂGE</span><b>${esc(guestLabel)}${item.age ? ` · ${item.age} ans` : ''}</b></div></div><div class="rocket-request"><span>PERSONNALISATION DE LA FUSÉE</span><b><i title="Bandes" style="background-color:${rocketColor}" aria-hidden="true"></i><i class="rocket-body-swatch" title="Corps central" style="background-color:${rocketBodyColor}" aria-hidden="true"></i>${esc(item.rocket_name || 'Sans nom')} · ${esc(rocketThemeNames[item.rocket_theme] || 'Étoiles')}</b><small>Bandes ${esc(rocketColor.toUpperCase())} · Corps ${esc(rocketBodyColor.toUpperCase())}</small>${item.rocket_message ? `<p>${esc(item.rocket_message)}</p>` : ''}</div>${item.details ? `<p class="booking-note">${esc(item.details)}</p>` : '<p class="booking-note">Aucun détail complémentaire.</p>'}${replyPanel}${deleteButton ? `<div class="reservation-delete-row">${deleteButton}</div>` : ''}<div class="booking-created">Demande reçue le ${esc(new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.created_at)))}</div></article>`;
    }).join('')
    : '<div class="empty-state">Aucune réservation à cette date. Choisis un jour marqué dans le calendrier pour consulter les demandes.</div>';
  content.innerHTML = `<div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> SUIVI CLIENT</p><h1>Réservations<span>.</span></h1><p>Choisis un mois, puis une date marquée pour voir toutes les informations.</p></div><span class="count-badge">${reservations.length} demande${reservations.length === 1 ? '' : 's'}</span></div><section class="booking-calendar panel" aria-label="Calendrier des réservations"><div class="calendar-heading"><button type="button" class="calendar-nav" data-calendar-step="-1" aria-label="Mois précédent">←</button><h2>${esc(monthLabel)}</h2><button type="button" class="calendar-nav" data-calendar-step="1" aria-label="Mois suivant">→</button></div><div class="calendar-grid calendar-weekdays" aria-hidden="true"><span>Lun.</span><span>Mar.</span><span>Mer.</span><span>Jeu.</span><span>Ven.</span><span>Sam.</span><span>Dim.</span></div><div class="calendar-grid">${calendarCells}</div><p class="calendar-legend"><i></i> Jour avec réservation · sélectionne une date pour afficher les détails</p></section><section class="booking-day-details"><div class="panel-heading"><div><span class="panel-kicker">DÉTAILS DU JOUR</span><h2>${esc(dateFr(state.bookingSelectedDay))}</h2></div><span class="count-badge">${selectedReservations.length} réservation${selectedReservations.length === 1 ? '' : 's'}</span></div><div class="booking-list">${details}</div><p class="inline-message" id="view-message" aria-live="polite"></p></section>`;
  content.querySelectorAll('.rocket-request').forEach((request, index) => {
    const reservation = selectedReservations[index];
    if (!reservation) return;
    const bodyColor = /^#[0-9a-f]{6}$/i.test(reservation.rocket_body_color || '') ? reservation.rocket_body_color : '#b86b2c';
    const title = request.querySelector('b');
    const swatch = document.createElement('i');
    swatch.className = 'rocket-body-swatch';
    swatch.title = 'Couleur du corps central';
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.backgroundColor = bodyColor;
    title?.insertBefore(swatch, title.childNodes[1] || null);
    const colorLabel = document.createElement('small');
    colorLabel.textContent = `Corps central ${bodyColor.toUpperCase()}`;
    const message = request.querySelector('p');
    request.insertBefore(colorLabel, message || null);
  });
  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.className = 'plain-button refresh-bookings-button';
  refreshButton.textContent = 'Actualiser';
  content.querySelector('.page-heading .count-badge').before(refreshButton);
  refreshButton.addEventListener('click', async () => {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Actualisation…';
    try {
      const fresh = await api('/api/admin/reservations');
      renderBookings(fresh);
      content.querySelector('#view-message').textContent = 'Demandes actualisées.';
    } catch (error) {
      refreshButton.disabled = false;
      refreshButton.textContent = 'Actualiser';
      content.querySelector('#view-message').textContent = error.message;
    }
  });
  content.querySelectorAll('[data-calendar-day]').forEach((button) => button.addEventListener('click', () => {
    state.bookingSelectedDay = button.dataset.calendarDay;
    renderBookings({ reservations });
  }));
  content.querySelectorAll('[data-calendar-step]').forEach((button) => button.addEventListener('click', () => {
    const next = new Date(year, month - 1 + Number(button.dataset.calendarStep), 1);
    state.bookingsMonth = isoDay(next.getFullYear(), next.getMonth() + 1, 1).slice(0, 7);
    state.bookingSelectedDay = isoDay(next.getFullYear(), next.getMonth() + 1, 1);
    renderBookings({ reservations });
  }));
  content.querySelectorAll('[data-reservation-status]').forEach((select) => select.addEventListener('change', async () => {
    const reservationId = select.dataset.reservationStatus;
    const previousStatus = reservations.find((item) => String(item.id) === select.dataset.reservationStatus)?.status;
    select.disabled = true;
    try {
      await api(`/api/admin/reservations/${reservationId}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) });
      const reservation = reservations.find((item) => String(item.id) === reservationId);
      if (reservation) reservation.status = select.value;
      renderBookings({ reservations });
      if (select.value === 'declined') {
        const refusal = content.querySelector(`[data-refusal-email="${reservationId}"]`);
        if (refusal) refusal.open = true;
        content.querySelector('#view-message').textContent = 'La demande est refusée. Le courriel personnalisé est prêt à vérifier et à envoyer.';
      } else {
        content.querySelector('#view-message').textContent = 'Statut mis à jour.';
      }
    } catch (error) {
      select.disabled = false;
      if (previousStatus) select.value = previousStatus;
      content.querySelector('#view-message').textContent = error.message;
    }
  }));
  content.querySelectorAll('[data-delete-reservation]').forEach((button) => button.addEventListener('click', async () => {
    const reservation = reservations.find((item) => String(item.id) === button.dataset.deleteReservation);
    if (!reservation || reservation.status !== 'declined') return;
    if (!window.confirm(`Supprimer définitivement la demande refusée de ${reservation.name} pour le ${dateFr(reservation.event_date)} ?`)) return;
    button.disabled = true;
    try {
      await api(`/api/admin/reservations/${reservation.id}`, { method: 'DELETE', body: '{}' });
      const index = reservations.findIndex((item) => item.id === reservation.id);
      if (index !== -1) reservations.splice(index, 1);
      renderBookings({ reservations });
      content.querySelector('#view-message').textContent = `La demande refusée de ${reservation.name} a été supprimée.`;
    } catch (error) {
      button.disabled = false;
      content.querySelector('#view-message').textContent = error.message;
    }
  }));
  content.querySelectorAll('[data-save-time]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.saveTime;
    const input = content.querySelector(`[data-reservation-time="${id}"]`);
    const reservation = reservations.find((item) => String(item.id) === id);
    const message = content.querySelector('#view-message');
    button.disabled = true;
    try {
      const updated = await api(`/api/admin/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ event_time: input.value }) });
      if (reservation) reservation.event_time = updated.reservation.event_time;
      renderBookings({ reservations });
      const messageText = input.value
        ? `Heure d’arrivée enregistrée. Préparez le message à ${reservation.email} pour confirmer l’installation à ${input.value}.`
        : 'Heure d’arrivée effacée. Aucune heure ne sera annoncée au client.';
      const message = content.querySelector('#view-message');
      message.textContent = messageText;
      if (input.value) {
        const { subject, body } = preparedClientEmail(reservation);
        const link = document.createElement('a');
        link.className = 'event-time-contact-link';
        link.href = `mailto:${reservation.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        link.textContent = 'Ouvrir le brouillon d’e-mail au client ↗';
        message.append(document.createElement('br'), link);
      }
    } catch (error) {
      button.disabled = false;
      message.textContent = error.message;
    }
  }));
  content.querySelectorAll('[data-reply-form]').forEach((replyForm) => replyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!replyForm.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(replyForm).entries());
    const mailto = `mailto:${replyForm.dataset.recipient}?subject=${encodeURIComponent(fields.subject)}&body=${encodeURIComponent(fields.body)}`;
    window.location.href = mailto;
  }));
}

function renderOffers({ offers }) {
  const rows = offers.length ? offers.map((offer) => `<article class="offer-admin-card"><div><span class="offer-state ${offer.active ? 'is-active' : ''}">${offer.active ? 'PUBLIÉE' : 'BROUILLON'}</span><h3>${esc(offer.name)}</h3><p>${esc(offer.description || 'Aucune description')}</p><div class="offer-meta">${esc(euro(offer.price_cents))}${offer.duration_minutes ? ` · ${offer.duration_minutes} min` : ''}</div><p>${offer.customization_allowed ? '✦ Personnalisation possible' : 'Personnalisation non incluse'}</p></div><button class="plain-button" data-edit-offer="${offer.id}">Modifier ↗</button></article>`).join('') : '<div class="empty-state">Aucune formule pour le moment. Créez votre premier tarif avec le formulaire.</div>';
  content.innerHTML = `<div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> OFFRE PUBLIQUE</p><h1>Tarifs et formules<span>.</span></h1><p>Les formules publiées s’affichent sur le site client.</p></div></div>
    <div class="management-grid"><section class="panel"><div class="panel-heading"><div><span class="panel-kicker" id="offer-form-kicker">NOUVELLE FORMULE</span><h2 id="offer-form-title">Ajouter une formule</h2></div></div><form class="manage-form" id="offer-form"><input type="hidden" name="id"/><label>Nom de la formule<input name="name" maxlength="100" required placeholder="Ex. Mission anniversaire"/></label><label>Description<textarea name="description" rows="3" maxlength="700" placeholder="Ce qui est inclus dans la formule…"></textarea></label><div class="form-pair"><label>Tarif en euros<input name="price_euros" type="number" min="0" max="100000" step="0.01" placeholder="À définir"/></label><label>Durée en minutes<input name="duration_minutes" type="number" min="1" max="1440" placeholder="Facultatif"/></label></div><label>Ordre d’affichage<input name="sort_order" type="number" min="0" value="0"/></label><label class="check-row"><input name="active" type="checkbox"/><span>Publier sur le site</span></label><label class="check-row"><input name="customization_allowed" type="checkbox"/><span>Cette formule autorise la personnalisation de la fusée</span></label><div class="form-actions"><button class="button button-dark" type="submit">Enregistrer la formule</button><button class="plain-button" type="reset" id="offer-reset">Effacer</button></div><p class="inline-message" id="offer-message"></p></form></section><div class="offer-admin-list">${rows}</div></div>`;
  content.querySelector('#offer-form').addEventListener('submit', saveOffer);
  content.querySelector('#offer-reset').addEventListener('click', () => setTimeout(() => resetOfferForm(), 0));
  content.querySelectorAll('[data-edit-offer]').forEach((button) => button.addEventListener('click', () => {
    const offer = offers.find((item) => item.id === Number(button.dataset.editOffer));
    if (!offer) return;
    const form = content.querySelector('#offer-form');
    form.elements.id.value = offer.id;
    form.elements.name.value = offer.name;
    form.elements.description.value = offer.description || '';
    form.elements.price_euros.value = offer.price_euros ?? '';
    form.elements.duration_minutes.value = offer.duration_minutes ?? '';
    form.elements.sort_order.value = offer.sort_order;
    form.elements.active.checked = offer.active;
    form.elements.customization_allowed.checked = offer.customization_allowed === true;
    content.querySelector('#offer-form-kicker').textContent = 'MODIFIER UNE FORMULE';
    content.querySelector('#offer-form-title').textContent = offer.name;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function resetOfferForm() {
  const form = content.querySelector('#offer-form');
  if (!form) return;
  form.elements.id.value = '';
  form.elements.sort_order.value = '0';
  content.querySelector('#offer-form-kicker').textContent = 'NOUVELLE FORMULE';
  content.querySelector('#offer-form-title').textContent = 'Ajouter une formule';
}

async function saveOffer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  data.active = form.elements.active.checked;
  data.customization_allowed = form.elements.customization_allowed.checked;
  try {
    const id = data.id;
    delete data.id;
    await api(id ? `/api/admin/offers/${id}` : '/api/admin/offers', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
    await loadView('offers');
  } catch (error) { content.querySelector('#offer-message').textContent = error.message; }
}

function renderSettings({ settings }) {
  content.innerHTML = `<div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> IDENTITÉ ET CONTENU</p><h1>Réglages du site<span>.</span></h1><p>Modifiez les coordonnées, le compte de don et les textes visibles. Les sections du site restent en place.</p></div></div><div class="settings-layout"><section class="panel"><form class="manage-form settings-form" id="settings-form">
    <details class="settings-group" open><summary>Coordonnées publiques</summary><label>Nom de l’entreprise<input name="company_name" maxlength="80" required value="${esc(settings.company_name)}"/></label><label>Phrase d’accroche<input name="tagline" maxlength="140" value="${esc(settings.tagline)}"/></label><label>Zone desservie<input name="service_area" maxlength="120" required value="${esc(settings.service_area)}"/></label><div class="form-pair"><label>E-mail public<input name="public_email" type="email" maxlength="254" value="${esc(settings.public_email)}" placeholder="Adresse de contact"/></label><label>Téléphone public<input name="public_phone" maxlength="30" value="${esc(settings.public_phone)}" placeholder="À ajouter plus tard"/></label></div></details>
    <details class="settings-group" open><summary>Coordonnées bancaires pour les dons</summary><label>Nom du titulaire du compte<input name="donation_account_name" maxlength="120" value="${esc(settings.donation_account_name || '')}" placeholder="Facultatif"/></label><label>IBAN du compte bancaire<input name="donation_iban" maxlength="42" value="${esc(settings.donation_iban || '')}" placeholder="À renseigner lorsque le compte sera prêt"/><small>L’IBAN sera affiché sur le site avec un bouton de copie dès qu’il est enregistré. Laissez-le vide tant que le compte n’est pas créé.</small></label></details>
    <details class="settings-group"><summary>Modifier les textes d’information du site</summary><p class="settings-help">Vous pouvez modifier ces textes, mais ils ne peuvent pas être laissés vides. Les rubriques restent affichées sur le site.</p><label>Texte d’accueil<textarea name="hero_description" rows="3" maxlength="300" required>${esc(settings.hero_description)}</textarea></label><label>Présentation du concept<textarea name="concept_description" rows="3" maxlength="500" required>${esc(settings.concept_description)}</textarea></label><label>Suite de la présentation<textarea name="concept_followup" rows="2" maxlength="300" required>${esc(settings.concept_followup)}</textarea></label><label>Note affichée avec les tarifs<textarea name="price_note" rows="2" maxlength="240" required>${esc(settings.price_note)}</textarea></label><label>Texte de personnalisation de la fusée<textarea name="customizer_description" rows="3" maxlength="400" required>${esc(settings.customizer_description)}</textarea></label><label>Texte au-dessus de la demande de réservation<textarea name="booking_description" rows="3" maxlength="400" required>${esc(settings.booking_description)}</textarea></label><label>Note sous le formulaire<textarea name="booking_disclaimer" rows="2" maxlength="240" required>${esc(settings.booking_disclaimer)}</textarea></label><label>Note de l’étape 1<textarea name="step_one_note" rows="2" maxlength="240" required>${esc(settings.step_one_note)}</textarea></label><label>Note de l’étape 2<textarea name="step_two_note" rows="2" maxlength="240" required>${esc(settings.step_two_note)}</textarea></label><label>Note de l’étape 3<textarea name="step_three_note" rows="2" maxlength="240" required>${esc(settings.step_three_note)}</textarea></label><label>Titre du message de sécurité<input name="safety_title" maxlength="180" required value="${esc(settings.safety_title)}"/></label><label>Message de sécurité<textarea name="safety_description" rows="3" maxlength="500" required>${esc(settings.safety_description)}</textarea></label><label>Texte de contact<textarea name="contact_description" rows="2" maxlength="300" required>${esc(settings.contact_description)}</textarea></label><label>Texte pour les dons<textarea name="donation_description" rows="2" maxlength="300" required>${esc(settings.donation_description)}</textarea></label><label>Réponse AirBot par défaut<textarea name="airbot_fallback" rows="3" maxlength="400" required>${esc(settings.airbot_fallback)}</textarea></label></details>
    <label class="check-row"><input name="booking_enabled" type="checkbox" ${settings.booking_enabled === '1' ? 'checked' : ''}/><span>Accepter les demandes de réservation en ligne</span></label><button class="button button-dark" type="submit">Enregistrer les réglages</button><p class="inline-message" id="settings-message"></p></form></section><aside class="settings-tip"><span>GESTION DU SITE</span><h3>Modifiez les textes sans retirer les rubriques.</h3><p>Les notes sont enregistrées et peuvent être réécrites depuis cette page. Les coordonnées du compte de don n’apparaîtront sur le site qu’après saisie d’un IBAN valide.</p><p>Dans <strong>Équipe et accès</strong>, repérez un membre dans la liste puis utilisez le bouton rouge <strong>Supprimer le compte</strong>. Cette action est réservée au directeur et ne s’affiche pas pour votre propre compte.</p></aside></div>`;
  content.querySelector('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    data.booking_enabled = form.elements.booking_enabled.checked;
    try { await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }); content.querySelector('#settings-message').textContent = 'Réglages enregistrés.'; }
    catch (error) { content.querySelector('#settings-message').textContent = error.message; }
  });
}

function renderTeam({ users }) {
  const roleOptions = Object.entries(roleNames).filter(([role]) => role !== 'owner' || state.user.role === 'owner');
  const members = users.map((member) => {
    const self = member.id === state.user.id;
    const canDelete = state.user.role === 'owner' && !self;
    const deleteControl = canDelete
      ? `<button class="delete-user-button" type="button" data-delete-user="${member.id}" aria-label="Supprimer le compte de ${esc(member.name)}">Supprimer le compte</button>`
      : `<button class="delete-user-button" type="button" disabled title="Vous ne pouvez pas supprimer votre propre compte">${self ? 'Votre compte' : 'Suppression réservée au directeur'}</button>`;
    return `<article class="team-row"><div class="team-person"><span class="team-avatar">${esc(member.name.trim().charAt(0).toUpperCase())}</span><div><b>${esc(member.name)}</b><span>${esc(member.email)}</span></div></div><select data-user-role="${member.id}" ${self ? 'disabled' : ''}>${roleOptions.map(([key,label]) => `<option value="${key}" ${key === member.role ? 'selected' : ''}>${label}</option>`).join('')}</select><label class="member-active"><input type="checkbox" data-user-active="${member.id}" ${member.active ? 'checked' : ''} ${self ? 'disabled' : ''}/><span>${member.active ? 'Actif' : 'Désactivé'}</span></label>${deleteControl}</article>`;
  }).join('');
  content.innerHTML = `<div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> COMPTES PERSONNELS</p><h1>Équipe et accès<span>.</span></h1><p>Chaque membre a son compte et voit les pages autorisées par sa fonction.</p></div></div><div class="team-layout"><section class="panel"><div class="panel-heading"><div><span class="panel-kicker">MEMBRES</span><h2>Comptes de l’équipe</h2></div><span class="count-badge">${users.length} comptes</span></div><p class="team-delete-hint">Pour supprimer un membre, repérez sa ligne puis cliquez sur le bouton rouge <b>Supprimer le compte</b>. Cette action est réservée au directeur et ne peut pas supprimer votre propre accès.</p><div class="team-list">${members}</div><p class="inline-message" id="team-message"></p></section><section class="panel"><div class="panel-heading"><div><span class="panel-kicker">NOUVEL ACCÈS</span><h2>Ajouter un membre</h2></div></div><form class="manage-form" id="user-form"><label>Nom du membre<input name="name" maxlength="100" required/></label><label>Adresse e-mail de connexion<input name="email" type="email" maxlength="254" required/></label><label>Fonction / droits<select name="role" required>${roleOptions.map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label><button class="button button-dark" type="submit">Créer le compte</button><p class="inline-message" id="user-message"></p></form><div class="role-guide"><b>Rôles disponibles</b><p><strong>Responsable</strong> : réservations, tarifs et réglages.</p><p><strong>Réservations</strong> : demandes clients uniquement.</p><p><strong>Tarifs et contenu</strong> : formules et informations publiques.</p><p><strong>Lecture seule</strong> : consulte les demandes et les tarifs.</p></div></section></div>`;
  content.querySelector('#user-form').addEventListener('submit', createUser);
  content.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', async () => {
    const member = users.find((item) => String(item.id) === button.dataset.deleteUser);
    if (!member || !window.confirm(`Supprimer définitivement le compte de ${member.name} ? Cette personne sera immédiatement déconnectée.`)) return;
    const message = content.querySelector('#team-message');
    button.disabled = true;
    try {
      await api(`/api/admin/users/${member.id}`, { method: 'DELETE', body: '{}' });
      renderTeam(await api('/api/admin/users'));
      content.querySelector('#team-message').textContent = `Le compte de ${member.name} a été supprimé.`;
    } catch (error) {
      button.disabled = false;
      message.textContent = error.message;
    }
  }));
  content.querySelectorAll('[data-user-role], [data-user-active]').forEach((control) => control.addEventListener('change', async () => {
    const id = control.dataset.userRole || control.dataset.userActive;
    const roleInput = content.querySelector(`[data-user-role="${id}"]`);
    const activeInput = content.querySelector(`[data-user-active="${id}"]`);
    try { await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: roleInput.value, active: activeInput.checked }) }); content.querySelector('#team-message').textContent = 'Accès mis à jour.'; }
    catch (error) { content.querySelector('#team-message').textContent = error.message; }
  }));
}

async function createUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(data) });
    content.querySelector('#user-message').innerHTML = `Compte créé pour <b>${esc(result.user.name)}</b>. Mot de passe temporaire à transmettre en privé : <code>${esc(result.temporary_password)}</code>. Il devra en choisir un nouveau à sa première connexion.`;
    form.reset();
    const list = await api('/api/admin/users');
    const message = content.querySelector('#user-message').innerHTML;
    renderTeam(list);
    content.querySelector('#user-message').innerHTML = message;
  } catch (error) { content.querySelector('#user-message').textContent = error.message; }
}

function renderPassword() {
  const ownerNote = state.user.role === 'owner' ? ' Si tu es le dernier propriétaire, la configuration du compte propriétaire réapparaîtra ensuite.' : '';
  content.innerHTML = `<div class="page-heading"><div><p class="eyebrow"><span class="eyebrow-dot"></span> SÉCURITÉ DU COMPTE</p><h1>Mon mot de passe<span>.</span></h1><p>Gardez l’accès à votre compte personnel sous votre contrôle.</p></div></div><section class="panel password-panel"><form class="manage-form" id="account-password-form"><label>Mot de passe actuel<input type="password" name="current_password" autocomplete="current-password" required/></label><label>Nouveau mot de passe (12 caractères minimum)<input type="password" name="new_password" minlength="12" autocomplete="new-password" required/></label><button class="button button-dark" type="submit">Mettre à jour le mot de passe</button><p class="inline-message" id="account-password-message"></p></form></section><section class="panel danger-zone"><span class="panel-kicker">ACTION DÉFINITIVE</span><h2>Supprimer mon compte</h2><p>Ton accès sera supprimé et tu seras déconnecté.${ownerNote}</p><form class="manage-form" id="delete-account-form"><label>Confirme avec ton mot de passe actuel<input type="password" name="current_password" autocomplete="current-password" required/></label><label class="check-row"><input type="checkbox" name="confirmation" required/><span>Je comprends que mon compte sera supprimé définitivement.</span></label><button class="button delete-self-button" type="submit">Supprimer mon compte</button><p class="inline-message" id="delete-account-message" aria-live="polite"></p></form></section>`;
  content.querySelector('#account-password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await api('/api/admin/change-password', { method: 'POST', body: JSON.stringify(data) }); event.currentTarget.reset(); content.querySelector('#account-password-message').textContent = 'Mot de passe mis à jour.'; }
    catch (error) { content.querySelector('#account-password-message').textContent = error.message; }
  });
  content.querySelector('#delete-account-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !window.confirm('Confirmer la suppression définitive de ton compte Air Space ?')) return;
    const message = content.querySelector('#delete-account-message');
    const data = Object.fromEntries(new FormData(form).entries());
    data.confirmation = form.elements.confirmation.checked;
    try {
      await api('/api/admin/me', { method: 'DELETE', body: JSON.stringify(data) });
      state.user = null;
      state.permissions = [];
      await initialize();
    } catch (error) { message.textContent = error.message; }
  });
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.querySelector('#login-message');
  message.textContent = '';
  const data = Object.fromEntries(new FormData(loginForm).entries());
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify(data) });
    loginForm.reset();
    if (result.must_change_password) return showScreen('password');
    await initialize();
  } catch (error) { message.textContent = error.message; }
});

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.querySelector('#setup-message');
  message.textContent = '';
  const data = Object.fromEntries(new FormData(setupForm).entries());
  try {
    await api('/api/admin/setup', { method: 'POST', body: JSON.stringify(data) });
    setupForm.reset();
    await initialize();
  } catch (error) { message.textContent = error.message; }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.querySelector('#password-message');
  message.textContent = '';
  const data = Object.fromEntries(new FormData(passwordForm).entries());
  try { await api('/api/admin/change-password', { method: 'POST', body: JSON.stringify(data) }); passwordForm.reset(); await initialize(); }
  catch (error) { message.textContent = error.message; }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST', body: '{}' }).catch(() => {});
  state.user = null;
  showScreen('login');
});
content.addEventListener('click', (event) => {
  const button = event.target.closest('[data-go]');
  if (button) loadView(button.dataset.go);
});

initialize();


