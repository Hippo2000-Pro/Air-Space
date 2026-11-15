const form = document.querySelector('#booking-form');
const result = document.querySelector('#form-result');
const dateField = form?.elements.date;
const offerSelect = document.querySelector('#offer-select');
const offerGrid = document.querySelector('#offer-grid');
const rocketForm = document.querySelector('#rocket-customizer');
const rocketPreview = document.querySelector('#rocket-preview');
const rocketStage = document.querySelector('#rocket-stage');
const rocketRotateToggle = document.querySelector('#rocket-rotate-toggle');
const teamReturnLink = document.querySelector('#team-return-link');
const copyDonationIban = document.querySelector('#copy-donation-iban');
const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
const mainNavigation = document.querySelector('#main-navigation');
const backToTop = document.querySelector('#back-to-top');
const rocketThemes = { etoiles: 'Un ciel étoilé', planetes: 'Un voyage entre les planètes', galaxie: 'Une aventure dans la galaxie', exploration: 'Une mission d’exploration' };

if (teamReturnLink && new URLSearchParams(window.location.search).get('from') === 'team') teamReturnLink.hidden = false;
backToTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
mobileMenuToggle?.addEventListener('click', () => {
  if (!mainNavigation) return;
  const isExpanded = mobileMenuToggle.getAttribute('aria-expanded') === 'true';
  mobileMenuToggle.setAttribute('aria-expanded', String(!isExpanded));
  mobileMenuToggle.setAttribute('aria-label', isExpanded ? 'Ouvrir le menu' : 'Fermer le menu');
  mainNavigation.classList.toggle('is-open', !isExpanded);
});
mainNavigation?.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    mobileMenuToggle?.setAttribute('aria-expanded', 'false');
    mobileMenuToggle?.setAttribute('aria-label', 'Ouvrir le menu');
    mainNavigation?.classList.remove('is-open');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    mobileMenuToggle?.setAttribute('aria-expanded', 'false');
    mobileMenuToggle?.setAttribute('aria-label', 'Ouvrir le menu');
    mainNavigation?.classList.remove('is-open');
  }
});
copyDonationIban?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(copyDonationIban.dataset.iban || '');
    copyDonationIban.textContent = 'IBAN copié';
  } catch {
    const status = document.querySelector('#donation-status');
    if (status) status.textContent = 'La copie automatique n’est pas disponible. Sélectionnez l’IBAN et copiez-le.';
  }
});

const today = new Date();
if (dateField) dateField.min = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function addOfferCard(offer, index) {
  const card = document.createElement('article');
  card.className = 'offer-card';
  const indexLabel = document.createElement('span');
  indexLabel.className = 'offer-index';
  indexLabel.textContent = `FORMULE 0${index + 1}`;
  const title = document.createElement('h3');
  title.textContent = offer.name;
  const description = document.createElement('p');
  description.textContent = offer.description || 'Une formule de spectacle Air Space.';
  const price = document.createElement('div');
  price.className = 'offer-price';
  price.textContent = offer.price_cents == null ? 'Sur demande' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(offer.price_cents / 100);
  card.append(indexLabel, title, description, price);
  if (offer.duration_minutes) {
    const duration = document.createElement('span');
    duration.className = 'offer-duration';
    duration.textContent = `${offer.duration_minutes} MINUTES`;
    card.append(duration);
  }
  if (offer.customization_allowed) { const badge=document.createElement('small'); badge.className='offer-customization-badge'; badge.textContent='Personnalisation incluse'; card.append(badge); }
  const link = document.createElement('a');
  link.className = 'offer-cta';
  link.href = document.body.classList.contains('home-page') ? '#demande-reservation' : `/reservation?offer_id=${encodeURIComponent(offer.id)}`;
  link.textContent = 'Choisir cette formule ↗';
  link.addEventListener('click', () => { if (offerSelect) { offerSelect.value = String(offer.id); offerSelect.dispatchEvent(new Event('change')); } });
  card.append(link);
  offerGrid.append(card);
  const option = document.createElement('option');
  option.value = String(offer.id);
  option.textContent = `${offer.name}${offer.price_cents == null ? '' : ` — ${price.textContent}`}`;
  offerSelect?.append(option);
}

function setPageText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value ?? '';
  return element;
}

async function loadPublicSettings() {
  try {
    const response = await fetch('/api/public');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Impossible de charger le site.');
    const settings = data.settings;
    window.airSpaceOffers = data.offers || [];
    const selectedOfferId = offerSelect?.value || new URLSearchParams(location.search).get('offer_id') || localStorage.getItem('airspace_offer_id') || '';
    document.title = document.title.replace('Air Space', settings.company_name);
    setPageText('#company-brand', settings.company_name.toUpperCase());
    setPageText('#footer-brand-name', settings.company_name.toUpperCase());
    for (const [selector, key] of Object.entries({
      '#hero-description':'hero_description','#concept-description':'concept_description','#concept-followup':'concept_followup',
      '#customizer-description':'customizer_description','#booking-description':'booking_description','#booking-disclaimer':'booking_disclaimer',
      '#step-one-note':'step_one_note','#step-two-note':'step_two_note','#step-three-note':'step_three_note',
      '#safety-title':'safety_title','#safety-description':'safety_description','#contact-description':'contact_description',
      '#donation-description':'donation_description','#price-note':'price_note',
    })) setPageText(selector, settings[key]);
    const contactEmail = document.querySelector('#contact-email');
    if (contactEmail) {
      contactEmail.hidden = !settings.public_email;
      if (settings.public_email) { contactEmail.href = `mailto:${settings.public_email}`; contactEmail.textContent = settings.public_email; }
    }
    const contactPhone = document.querySelector('#contact-phone');
    if (contactPhone) {
      contactPhone.hidden = !settings.public_phone;
      if (settings.public_phone) { contactPhone.href = `tel:${settings.public_phone.replace(/[^+\d]/g, '')}`; contactPhone.textContent = settings.public_phone; }
    }
    const donationAccount = document.querySelector('#donation-account');
    const donationAccountName = document.querySelector('#donation-account-name');
    const donationIban = document.querySelector('#donation-iban');
    const donationStatus = document.querySelector('#donation-status');
    const iban = (settings.donation_iban || '').replace(/\s/g, '').toUpperCase();
    if (donationAccount) donationAccount.hidden = !iban;
    if (donationAccountName) { donationAccountName.hidden = !settings.donation_account_name; donationAccountName.textContent = settings.donation_account_name ? `Titulaire : ${settings.donation_account_name}` : ''; }
    if (donationIban) donationIban.textContent = iban.match(/.{1,4}/g)?.join(' ') || '';
    if (copyDonationIban && iban) { copyDonationIban.dataset.iban = iban; copyDonationIban.textContent = 'Copier l’IBAN'; }
    if (donationStatus) donationStatus.textContent = iban ? 'Vous pouvez effectuer un virement bancaire sur ce compte.' : 'Les coordonnées bancaires ne sont pas encore configurées. Revenez bientôt pour soutenir le projet.';
    if (offerGrid && offerSelect) {
      offerGrid.replaceChildren();
      offerSelect.replaceChildren(new Option('Je ne sais pas encore', ''));
      if (data.offers.length) data.offers.forEach(addOfferCard);
      else {
        const card = document.createElement('article'); card.className = 'offer-loading';
        const label = document.createElement('span'); label.className = 'offer-index'; label.textContent = 'AIR SPACE';
        const title = document.createElement('h3'); title.textContent = 'Formules en préparation';
        const desc = document.createElement('p'); desc.textContent = 'Contactez-nous pour préparer votre spectacle.';
        card.append(label, title, desc); offerGrid.append(card);
      }
      if (data.offers.some((offer) => String(offer.id) === selectedOfferId)) offerSelect.value = selectedOfferId;
      if (offerSelect?.value) offerSelect.dispatchEvent(new Event('change'));
    }
    const studioOffer = rocketForm?.elements.offer_id;
    if (studioOffer) {
      const eligible = window.airSpaceOffers.filter((offer) => offer.customization_allowed);
      studioOffer.replaceChildren(new Option('Choisir une formule avec personnalisation', ''));
      eligible.forEach((offer) => studioOffer.add(new Option(offer.name, String(offer.id))));
      const requested = new URLSearchParams(location.search).get('offer_id') || localStorage.getItem('airspace_offer_id') || '';
      if (eligible.some((offer) => String(offer.id) === requested)) studioOffer.value = requested;
      const toggle = () => { const allowed=eligible.some((offer)=>String(offer.id)===studioOffer.value); rocketForm.querySelectorAll('input:not([type=hidden]),select:not([name="offer_id"])').forEach((input)=>input.disabled=!allowed); rocketForm.querySelector('[data-customization-message]')?.toggleAttribute('hidden',allowed); if(allowed)localStorage.setItem('airspace_offer_id',studioOffer.value); };
      studioOffer.addEventListener('change',toggle); toggle();
    }
    offerSelect?.addEventListener('change', () => {
      const picked=window.airSpaceOffers.find((offer)=>String(offer.id)===offerSelect.value);
      const area=document.querySelector('#home-customization-choice');
      if(area){area.hidden=!picked?.customization_allowed;if(picked?.customization_allowed){localStorage.setItem('airspace_offer_id',String(picked.id));document.querySelector('#home-customization-link').href=`/air-ar?offer_id=${picked.id}`;}}
      if(!picked?.customization_allowed)localStorage.removeItem('airspace_rocket_custom');
    });
    if (form && result && settings.booking_enabled !== '1') {
      const button = form.querySelector('button[type="submit"]');
      if (button) { button.disabled = true; button.textContent = 'Réservations momentanément fermées'; }
      result.textContent = 'Les demandes en ligne sont momentanément suspendues. Vous pouvez bientôt nous retrouver.';
    }
  } catch {
    if (result) result.textContent = 'Pour utiliser le site et les réservations, ouvrez-le depuis le lanceur Air Space et l’adresse locale.';
  }
}

let THREE = null;
let rocketScene = null;
let rocketModel = null;
let rocketDecal = null;

function updateRocketPreview() {
  if (!rocketForm || !rocketPreview || !rocketStage) return;
  const values = Object.fromEntries(new FormData(rocketForm).entries());
  rocketPreview.style.setProperty('--rocket-personal-color', values.rocket_color);
  rocketPreview.style.setProperty('--rocket-body-color', values.rocket_body_color);
  rocketPreview.dataset.theme = values.rocket_theme;
  document.querySelector('#rocket-preview-name').textContent = values.rocket_name.trim() || 'Fusée de l’anniversaire';
  document.querySelector('#rocket-preview-theme').textContent = rocketThemes[values.rocket_theme] || rocketThemes.etoiles;
  document.querySelector('#rocket-preview-message').textContent = values.rocket_message.trim();
  rocketStage.setAttribute('aria-label', `Aperçu 3D de ${values.rocket_name.trim() || 'la fusée de l’anniversaire'}, thème ${rocketThemes[values.rocket_theme] || rocketThemes.etoiles}. Faites glisser pour la tourner.`);
  if (!rocketScene || !rocketModel) return;

  rocketModel.traverse((part) => {
    if (part.material?.userData?.personalized) part.material.color.set(values.rocket_color);
    if (part.material?.userData?.bodyColor) {
      part.material.color.set(values.rocket_body_color);
      part.material.emissive.set(values.rocket_body_color);
      part.material.emissiveIntensity = 0.24;
    }
  });
  rocketDecal.material.map?.dispose();
  rocketDecal.material.map = makeBodyTexture(values.rocket_name.trim(), values.rocket_color, values.rocket_theme);
  rocketDecal.material.needsUpdate = true;
}

function makeBodyTexture(name, color, theme) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const stripeY = 10;
  context.fillStyle = '#10243b';
  context.beginPath();
  context.roundRect(8, stripeY, 496, 108, 12);
  context.fill();
  context.fillStyle = color;
  context.fillRect(12, stripeY + 5, 488, 5);
  context.fillRect(12, stripeY + 98, 488, 5);
  context.fillStyle = '#fffefa';
  context.font = 'bold 34px sans-serif';
  while (name && context.measureText(name).width > 460) context.font = `bold ${parseInt(context.font, 10) - 2}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (name) context.fillText(name, canvas.width / 2, stripeY + 67, 460);

  context.fillStyle = color;
  context.font = 'bold 12px sans-serif';
  context.textAlign = 'center';
  const insignia = theme === 'planetes' ? 'ORBITAL' : theme === 'galaxie' ? 'COSMOS' : theme === 'exploration' ? 'EXPLORER' : 'STELLAR';
  context.fillText(insignia, canvas.width / 2, stripeY + 27, 180);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildRocketModel() {
  const group = new THREE.Group();
  const personalizedMaterial = new THREE.MeshStandardMaterial({ color: '#3978b8', metalness: 0.32, roughness: 0.3 });
  personalizedMaterial.userData.personalized = true;
  const tankMaterial = new THREE.MeshStandardMaterial({ color: '#b86b2c', metalness: 0.28, roughness: 0.42 });
  tankMaterial.userData.bodyColor = true;
  const whiteMaterial = new THREE.MeshStandardMaterial({ color: '#e8e9e4', metalness: 0.18, roughness: 0.36 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#293642', metalness: 0.62, roughness: 0.32 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: '#72c7d4', metalness: 0.2, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
  const flameMaterial = new THREE.MeshBasicMaterial({ color: '#ff9a55' });

  const addBand = (radius, y, material, x = 0) => {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.055, 40), material);
    band.position.set(x, y, 0);
    group.add(band);
  };
  const addNozzle = (x, y, scale = 1) => {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.115 * scale, 0.17 * scale, 0.24 * scale, 32), darkMaterial);
    nozzle.position.set(x, y, 0);
    group.add(nozzle);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.105 * scale, 32), darkMaterial);
    inner.position.set(x, y - 0.122 * scale, 0);
    inner.rotation.x = Math.PI / 2;
    group.add(inner);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.105 * scale, 0.32 * scale, 24), flameMaterial);
    flame.position.set(x, y - 0.34 * scale, 0);
    group.add(flame);
  };
  const addFinSet = (x, y, radius, material) => {
    const finShape = new THREE.Shape();
    finShape.moveTo(radius * 0.72, 0.22);
    finShape.lineTo(radius * 1.08, 0.12);
    finShape.lineTo(radius * 1.7, -0.42);
    finShape.lineTo(radius * 1.68, -0.52);
    finShape.lineTo(radius * 0.76, -0.43);
    finShape.closePath();
    const finGeometry = new THREE.ExtrudeGeometry(finShape, { depth: 0.045, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.012, bevelThickness: 0.012 });
    finGeometry.translate(0, 0, -0.0225);
    for (let index = 0; index < 3; index += 1) {
      const fin = new THREE.Mesh(finGeometry, material);
      fin.position.set(x, y, radius * 0.8);
      fin.rotation.y = index * (Math.PI * 2 / 3);
      group.add(fin);
    }
  };

  const coreX = 0;
  const coreRadius = 0.29;
  const coreBody = new THREE.Mesh(new THREE.CylinderGeometry(coreRadius * 0.96, coreRadius, 2.45, 56, 1), tankMaterial);
  coreBody.position.y = -0.03;
  group.add(coreBody);
  addBand(coreRadius * 1.02, -0.94, darkMaterial, coreX);
  addBand(coreRadius * 1.03, -0.72, whiteMaterial, coreX);
  addBand(coreRadius * 1.03, 0.64, whiteMaterial, coreX);
  addBand(coreRadius * 1.03, 1.03, personalizedMaterial, coreX);
  const coreSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.34, 0.29, 48), whiteMaterial);
  coreSkirt.position.y = -1.34;
  group.add(coreSkirt);
  addNozzle(coreX, -1.54, 1.15);
  addFinSet(coreX, -0.9, coreRadius, darkMaterial);

  const boosterPositions = [-0.68, 0.68];
  for (const x of boosterPositions) {
    const boosterRadius = 0.13;
    const booster = new THREE.Mesh(new THREE.CylinderGeometry(boosterRadius * 0.94, boosterRadius, 2.1, 40, 1), whiteMaterial);
    booster.position.set(x, -0.19, 0);
    group.add(booster);
    const noseProfile = [
      new THREE.Vector2(0, 0.86),
      new THREE.Vector2(boosterRadius * 0.82, 0.89),
      new THREE.Vector2(boosterRadius, 0.96),
      new THREE.Vector2(boosterRadius * 0.92, 1.12),
      new THREE.Vector2(boosterRadius * 0.68, 1.32),
      new THREE.Vector2(boosterRadius * 0.35, 1.47),
      new THREE.Vector2(0, 1.54),
    ];
    const boosterNose = new THREE.Mesh(new THREE.LatheGeometry(noseProfile, 40), whiteMaterial);
    boosterNose.position.x = x;
    group.add(boosterNose);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.16, 0.22, 36), darkMaterial);
    skirt.position.set(x, -1.33, 0);
    group.add(skirt);
    addNozzle(x, -1.48, 0.72);
    addBand(boosterRadius * 1.08, 0.61, personalizedMaterial, x);
    addBand(boosterRadius * 1.08, -0.9, darkMaterial, x);
    addFinSet(x, -0.88, boosterRadius, darkMaterial);
  }

  const interstage = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.25, 48), whiteMaterial);
  interstage.position.y = 1.31;
  group.add(interstage);
  const upperStage = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.22, 0.62, 48), whiteMaterial);
  upperStage.position.y = 1.72;
  group.add(upperStage);
  addBand(0.215, 1.47, darkMaterial);
  addBand(0.207, 1.95, personalizedMaterial);
  const fairingProfile = [];
  for (let index = 0; index <= 32; index += 1) {
    const progress = index / 32;
    fairingProfile.push(new THREE.Vector2(0.205 * Math.sqrt(1 - progress * progress), 2.0 + progress * 0.82));
  }
  const fairing = new THREE.Mesh(new THREE.LatheGeometry(fairingProfile, 56), whiteMaterial);
  group.add(fairing);
  const tipCap = new THREE.Mesh(new THREE.SphereGeometry(0.032, 18, 12), personalizedMaterial);
  tipCap.position.y = 2.79;
  group.add(tipCap);

  const windowFrame = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 10, 40), darkMaterial);
  windowFrame.rotation.x = Math.PI / 2;
  windowFrame.position.set(0, 2.27, 0.19);
  group.add(windowFrame);
  const windowGlass = new THREE.Mesh(new THREE.SphereGeometry(0.06, 28, 18), glassMaterial);
  windowGlass.scale.z = 0.4;
  windowGlass.position.set(0, 2.27, 0.205);
  group.add(windowGlass);

  const decalMaterial = new THREE.MeshBasicMaterial({ map: makeBodyTexture('', '#3978b8', 'etoiles'), transparent: true, depthWrite: false, side: THREE.DoubleSide });
  rocketDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.145), decalMaterial);
  rocketDecal.position.set(0, 0.13, coreRadius + 0.006);
  group.add(rocketDecal);

  const rivetGeometry = new THREE.SphereGeometry(0.012, 8, 6);
  for (const x of boosterPositions) {
    for (const y of [-0.55, 0.38]) {
      const rivet = new THREE.Mesh(rivetGeometry, darkMaterial);
      rivet.position.set(x, y, 0.127);
      group.add(rivet);
    }
  }
  return group;
}

function buildRocketScene(THREE) {
  const width = Math.max(rocketStage.clientWidth, 240);
  const height = Math.max(rocketStage.clientHeight, 230);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 40);
  camera.position.set(0, 0.32, 7.3);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'rocket-3d-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  rocketStage.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight('#e7f6ff', '#40536a', 2.1));
  const keyLight = new THREE.DirectionalLight('#ffffff', 3.2);
  keyLight.position.set(-3, 5, 6);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight('#c8ef65', 13, 9);
  rimLight.position.set(3, 1, -2);
  scene.add(rimLight);
  const stars = new THREE.Group();
  const starMaterial = new THREE.MeshBasicMaterial({ color: '#c8ef65' });
  for (let index = 0; index < 18; index += 1) {
    const point = new THREE.Mesh(new THREE.SphereGeometry(index % 5 === 0 ? 0.023 : 0.012, 8, 6), starMaterial);
    point.position.set(((index * 37) % 100) / 42 - 1.2, ((index * 53) % 100) / 47 - 1.05, -0.8 - (index % 3));
    stars.add(point);
  }
  scene.add(stars);
  const rocket = buildRocketModel();
  rocket.rotation.set(-0.04, -0.12, -0.02);
  scene.add(rocket);
  rocketScene = { THREE, scene, camera, renderer, rocket, stars, dragging: false, pointerX: 0, pointerY: 0, autoRotate: true, frame: 0 };
  rocketModel = rocket;
  const resizeObserver = new ResizeObserver(() => {
    const nextWidth = Math.max(rocketStage.clientWidth, 240);
    const nextHeight = Math.max(rocketStage.clientHeight, 230);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
  });
  resizeObserver.observe(rocketStage);
  renderer.domElement.addEventListener('pointerdown', (event) => {
    rocketScene.dragging = true;
    rocketScene.pointerX = event.clientX;
    rocketScene.pointerY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!rocketScene.dragging) return;
    rocket.rotation.y += (event.clientX - rocketScene.pointerX) * 0.012;
    rocket.rotation.x = Math.max(-0.75, Math.min(0.75, rocket.rotation.x + (event.clientY - rocketScene.pointerY) * 0.008));
    rocketScene.pointerX = event.clientX;
    rocketScene.pointerY = event.clientY;
  });
  const stopDragging = () => { rocketScene.dragging = false; };
  renderer.domElement.addEventListener('pointerup', stopDragging);
  renderer.domElement.addEventListener('pointercancel', stopDragging);
  rocketStage.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    rocket.rotation.y += event.key === 'ArrowLeft' ? -0.16 : event.key === 'ArrowRight' ? 0.16 : 0;
    rocket.rotation.x = Math.max(-0.75, Math.min(0.75, rocket.rotation.x + (event.key === 'ArrowUp' ? -0.12 : event.key === 'ArrowDown' ? 0.12 : 0)));
  });
  function render() {
    rocketScene.frame = requestAnimationFrame(render);
    if (rocketScene.autoRotate && !rocketScene.dragging) rocket.rotation.y += 0.004;
    stars.rotation.z += 0.00025;
    renderer.render(scene, camera);
  }
  render();
  updateRocketPreview();
}

async function loadRocketScene() {
  if (!rocketStage || !rocketPreview) return;
  try {
    THREE = await import('/vendor/three.module.js');
    buildRocketScene(THREE);
    rocketStage.closest('.rocket-custom-preview').classList.add('is-3d-ready');
  } catch (error) {
    console.error('L’aperçu 3D n’a pas pu être démarré.', error);
    rocketPreview.dataset.viewer = 'fallback';
    rocketStage.setAttribute('aria-label', 'Aperçu illustré de la fusée. La 3D n’est pas disponible sur cet appareil.');
  }
}

rocketForm?.addEventListener('input', updateRocketPreview);
rocketForm?.addEventListener('change', updateRocketPreview);
rocketForm?.addEventListener('input',()=>{const offerId=rocketForm.elements.offer_id?.value;if(offerId)localStorage.setItem('airspace_rocket_custom',JSON.stringify({...Object.fromEntries(new FormData(rocketForm).entries()),offer_id:offerId}));});
rocketForm?.addEventListener('change',()=>{const offerId=rocketForm.elements.offer_id?.value;if(offerId)localStorage.setItem('airspace_rocket_custom',JSON.stringify({...Object.fromEntries(new FormData(rocketForm).entries()),offer_id:offerId}));});
rocketRotateToggle?.addEventListener('click', () => {
  if (!rocketScene) return;
  rocketScene.autoRotate = !rocketScene.autoRotate;
  rocketRotateToggle.setAttribute('aria-pressed', String(rocketScene.autoRotate));
  rocketRotateToggle.setAttribute('aria-label', rocketScene.autoRotate ? 'Mettre en pause la rotation' : 'Reprendre la rotation');
  rocketRotateToggle.title = rocketScene.autoRotate ? 'Mettre en pause la rotation' : 'Reprendre la rotation';
  rocketRotateToggle.textContent = rocketScene.autoRotate ? '⏸' : '▶';
});
updateRocketPreview();
loadRocketScene();

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.textContent = '';
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const selectedOffer=window.airSpaceOffers?.find((offer)=>String(offer.id)===String(data.offer_id));
  if (selectedOffer?.customization_allowed) {
    if (rocketForm) Object.assign(data, Object.fromEntries(new FormData(rocketForm).entries()));
    else { try { const custom=JSON.parse(localStorage.getItem('airspace_rocket_custom')||'{}'); if(String(custom.offer_id)===String(data.offer_id))Object.assign(data,custom); } catch {} }
  }
  data.consent = form.elements.consent.checked;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.firstChild.textContent = 'Envoi en cours… ';
  try {
    const response = await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'La demande n’a pas pu être enregistrée.');
    form.reset();
    rocketForm?.reset();
    if (rocketForm) updateRocketPreview();
    const setupTime = data.requested_setup_finish_time ? ` L’installation doit être terminée à ${data.requested_setup_finish_time}.` : '';
    const finishTime = data.requested_finish_time ? ` Le spectacle doit être terminé au plus tard à ${data.requested_finish_time}.` : '';
    result.textContent = `Merci ${payload.name} ! Votre demande est enregistrée.${setupTime}${finishTime} L’équipe vous confirmera l’heure d’arrivée et la faisabilité des horaires. Air Space la suivra dans son espace équipe.`;
    result.classList.add('success');
  } catch (error) {
    result.textContent = error instanceof TypeError ? 'Impossible de joindre le serveur Air Space. Vérifiez que le serveur est lancé.' : error.message;
    result.classList.remove('success');
  } finally {
    if (button.textContent !== 'Réservations momentanément fermées') {
      button.disabled = false;
      button.firstChild.textContent = 'Préparer ma demande ';
    }
  }
});

loadPublicSettings();
async function loadPublicExtras() {
  try {
    const [eventResponse, productResponse, videoResponse] = await Promise.all([fetch('/api/public/events'), fetch('/api/public/shop'), fetch('/api/public/videos')]);
    const [eventData, productData, videoData] = await Promise.all([eventResponse.json(), productResponse.json(), videoResponse.json()]);
    const eventHost = document.querySelector('#public-events');
    let eventMonth = new Date(); let selectedEventDay = '';
    const drawEvents = (day='') => { if(!eventHost)return; const visible=eventData.events.filter(e=>!day||e.event_date===day); eventHost.innerHTML=visible.length?visible.map((e) => `<article class="public-event-card" data-event-day="${escapeFeature(e.event_date)}"><span class="event-date-chip">${new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short'}).format(new Date(`${e.event_date}T12:00:00`))}</span><div><h3>${escapeFeature(e.title)}</h3><p>${escapeFeature(e.description||'Démonstration Air Space ouverte au public.')}</p><small>${escapeFeature(e.event_time)} · ${escapeFeature([e.venue,e.city].filter(Boolean).join(', '))}</small></div></article>`).join(''): `<p class="feature-empty">${day?'Aucun spectacle ce jour-là.':'Aucun spectacle public annoncé pour le moment.'}</p>`; };
    drawEvents();
    const drawCalendar=()=>{const host=document.querySelector('#public-calendar');if(!host)return;const y=eventMonth.getFullYear(),m=eventMonth.getMonth();const first=(new Date(y,m,1).getDay()+6)%7;const count=new Date(y,m+1,0).getDate();const eventDays=new Set(eventData.events.map(e=>e.event_date));const days=Array(first).fill('<span></span>');for(let d=1;d<=count;d++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;days.push(`<button type="button" class="calendar-day ${eventDays.has(key)?'has-event':''} ${selectedEventDay===key?'selected':''}" data-day="${key}" aria-label="${d} ${new Intl.DateTimeFormat('fr-FR',{month:'long'}).format(new Date(y,m,1))}${eventDays.has(key)?', spectacle':''}">${d}${eventDays.has(key)?'<i></i>':''}</button>`);}host.innerHTML=`<div class="calendar-toolbar"><button type="button" data-month="-1" aria-label="Mois précédent">←</button><b>${new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(eventMonth)}</b><button type="button" data-month="1" aria-label="Mois suivant">→</button></div><div class="calendar-grid">${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(x=>`<span class="calendar-weekday">${x}</span>`).join('')}${days.join('')}</div><p class="calendar-hint">Les points verts signalent un spectacle public. Sélectionnez une date pour afficher ses détails.</p>`;host.querySelectorAll('[data-month]').forEach(b=>b.addEventListener('click',()=>{eventMonth.setMonth(eventMonth.getMonth()+Number(b.dataset.month));drawCalendar();}));host.querySelectorAll('[data-day]').forEach(b=>b.addEventListener('click',()=>{selectedEventDay=b.dataset.day;drawCalendar();drawEvents(selectedEventDay);}));};drawCalendar();
    const productHost = document.querySelector('#public-products'); const select = document.querySelector('#shop-product-select');
    if (productHost && productData.products.length) { productHost.innerHTML = productData.products.map((p) => `<article class="public-product-card">${p.image_url ? `<img src="${escapeFeature(p.image_url)}" alt="" loading="lazy">` : '<div class="product-orbit" aria-hidden="true">✦</div>'}<h3>${escapeFeature(p.name)}</h3><p>${escapeFeature(p.description)}</p><b>${new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(p.price_cents/100)}</b><p><a class="button button-dark" href="/boutique#demande">Demander cet article</a></p></article>`).join(''); if(select)for(const p of productData.products) select.add(new Option(`${p.name} — ${(p.price_cents/100).toFixed(2).replace('.',',')} €`,p.id)); }
    const videoHost = document.querySelector('#public-videos');
    if (videoHost && videoData.videos.length) videoHost.innerHTML = videoData.videos.map((v) => { const player = videoPlayer(v.video_url,v.title); return `<article class="public-video-card">${player}<h3>${escapeFeature(v.title)}</h3><p>${escapeFeature(v.description)}</p></article>`; }).join('');
  } catch { /* Le site reste consultable si le serveur public est momentanément indisponible. */ }
}
function escapeFeature(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function videoPlayer(value,title){if(value.startsWith('/media/videos/'))return `<video controls playsinline preload="metadata" src="${escapeFeature(value)}"></video>`;const u=new URL(value,location.href);if(u.protocol==='https:'&&/\.(mp4|webm)$/i.test(u.pathname))return `<video controls playsinline preload="metadata" src="${escapeFeature(u.href)}"></video>`;let embed='';if(u.hostname==='youtu.be')embed=`https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;else if(u.hostname.endsWith('youtube.com')){const id=u.searchParams.get('v')||u.pathname.split('/').filter(Boolean).pop();embed=`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;}else if(u.hostname.endsWith('vimeo.com'))embed=`https://player.vimeo.com/video/${encodeURIComponent(u.pathname.split('/').filter(Boolean).pop())}`;return embed?`<iframe src="${embed}" title="${escapeFeature(title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`:'<p>Format vidéo indisponible.</p>';}
loadPublicExtras();
async function loadAirLab(){try{const response=await fetch('/api/public/air-lab');const data=await response.json();if(!response.ok)return;const votes=document.querySelector('#public-votes');let voted=[];try{voted=JSON.parse(localStorage.getItem('airspace_voted_ids')||'[]');}catch{}votes.innerHTML=data.votes.length?data.votes.map(v=>`<article class="vote-row"><span>${escapeFeature(v.idea)} <b>${v.votes} vote${v.votes===1?'':'s'}</b></span><button type="button" data-vote="${v.id}" ${voted.includes(v.id)?'disabled':''}>${voted.includes(v.id)?'Vote enregistré':'Voter'}</button></article>`).join(''):'Aucun vote ouvert.';votes.querySelectorAll('[data-vote]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{const r=await fetch('/api/public/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vote_id:Number(b.dataset.vote),client_id:getAirSpaceClientId()})});const result=await r.json();if(!r.ok)throw new Error(result.error);voted.push(Number(b.dataset.vote));localStorage.setItem('airspace_voted_ids',JSON.stringify(voted));await loadAirLab();}catch(e){b.disabled=false;alert(e.message);}}));if(document.querySelector('#eco-totals'))document.querySelector('#eco-totals').innerHTML=data.eco.length?data.eco.map(x=>`<div class="eco-row"><b>${escapeFeature(x.material)}</b><span>${escapeFeature(x.quantity)} ${escapeFeature(x.unit)}</span></div>`).join(''):'Les données seront publiées par l’équipe.';if(document.querySelector('#approved-ideas'))document.querySelector('#approved-ideas').innerHTML=data.ideas.map(x=>`<p class="approved-idea">“${escapeFeature(x.idea)}” <small>— ${escapeFeature(x.nickname)}</small></p>`).join('');}catch{}}
loadAirLab();
async function loadPublicCommunityFeatures(){
  try{
    const [labResponse,newsResponse,partnerResponse,pagesResponse]=await Promise.all([fetch('/api/public/air-lab'),fetch('/api/public/updates'),fetch('/api/public/partners'),fetch('/api/public/pages')]);
    const [lab,newsData,partnerData,pagesData]=await Promise.all([labResponse.json(),newsResponse.json(),partnerResponse.json(),pagesResponse.json()]);
    const newsHost=document.querySelector('#public-news');if(newsHost)newsHost.innerHTML=newsData.news.length?newsData.news.map(n=>`<article class="public-event-card"><div><h3>${escapeFeature(n.title)}</h3><p class="news-body">${escapeFeature(n.body)}</p><small>${escapeFeature(dateFr(n.created_at.slice(0,10)))}</small></div></article>`).join(''):'<p>Aucune actualité pour le moment.</p>';
    const partnerHost=document.querySelector('#public-partners');if(partnerHost)partnerHost.innerHTML=partnerData.partners.length?partnerData.partners.map(p=>`<article class="partner-card"><b>${escapeFeature(p.name)}</b><p>${escapeFeature(p.description)}</p>${p.url?`<a href="${escapeFeature(p.url)}" target="_blank" rel="noopener noreferrer">Découvrir ↗</a>`:''}</article>`).join(''):'<p>Les partenaires seront présentés ici.</p>';
    const pagesHost=document.querySelector('#public-pages');if(pagesHost)pagesHost.innerHTML=pagesData.pages.length?pagesData.pages.map(p=>`<details class="faq-item"><summary>${escapeFeature(p.title)}</summary><p class="page-body">${escapeFeature(p.body)}</p></details>`).join(''):'<p>Les contenus À propos, FAQ et informations publiques seront ajoutés par l’équipe.</p>';
    const faq=document.querySelector('#public-faq');if(faq)faq.innerHTML=lab.faqs.length?lab.faqs.map(x=>`<details class="faq-item"><summary>${escapeFeature(x.keywords.split(',')[0])}</summary><p>${escapeFeature(x.answer)}</p></details>`).join(''):'<p>AirBot peut répondre à vos questions depuis la section Air Lab.</p>';
    const challenges=document.querySelector('#public-challenges');if(!challenges)return;
    const clientId=getAirSpaceClientId();
    const pointsUrl=`/api/public/air-points/${encodeURIComponent(clientId)}`;let wallet={points:0,completed:[]};try{const r=await fetch(pointsUrl);wallet=await r.json();}catch{}
    const score=document.querySelector('#air-points-total');if(score)score.textContent=`${wallet.points||0} point${wallet.points===1?'':'s'}`;
    challenges.innerHTML=lab.challenges.length?lab.challenges.map(c=>`<form class="challenge-card" data-challenge="${c.id}"><h3>${escapeFeature(c.title)}</h3><p>${escapeFeature(c.question)}</p><span>+${c.reward_points} points</span>${wallet.completed.includes(c.id)?'<p class="challenge-done">Mission déjà validée sur cet appareil.</p>':`<label>Votre réponse<input name="answer" maxlength="300" required></label><button type="submit">Valider la mission</button><p role="status"></p>`}</form>`).join(''):'<p>L’équipe prépare les prochaines missions.</p>';
    challenges.querySelectorAll('[data-challenge]').forEach(f=>f.addEventListener('submit',async e=>{e.preventDefault();const button=f.querySelector('button');button.disabled=true;const message=f.querySelector('[role="status"]');try{const r=await fetch('/api/public/air-points',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:clientId,challenge_id:Number(f.dataset.challenge),answer:new FormData(f).get('answer')})});const data=await r.json();if(!r.ok)throw new Error(data.error);if(score)score.textContent=`${data.points} points`;message.textContent=`Bonne réponse ! +${data.reward} points`;setTimeout(loadPublicCommunityFeatures,700);}catch(err){message.textContent=err.message;button.disabled=false;}}));
  }catch{}
}
function getAirSpaceClientId(){try{let id=localStorage.getItem('airspace_points_id');if(!id){id=crypto.randomUUID();localStorage.setItem('airspace_points_id',id);}return id;}catch{return crypto.randomUUID();}}
function dateFr(value){return new Intl.DateTimeFormat('fr-FR',{dateStyle:'long'}).format(new Date(`${value}T12:00:00`));}
loadPublicCommunityFeatures();
document.querySelector('#airbot-form')?.addEventListener('submit',async(e)=>{e.preventDefault();const answer=document.querySelector('#airbot-answer');answer.textContent='AirBot cherche…';try{const r=await fetch('/api/public/airbot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:new FormData(e.currentTarget).get('question')})});const d=await r.json();answer.textContent=d.answer||d.error;}catch{answer.textContent='AirBot ne répond pas actuellement.';}});
document.querySelector('#community-idea-form')?.addEventListener('submit',async(e)=>{e.preventDefault();const result=document.querySelector('#community-idea-result');try{const r=await fetch('/api/public/community/ideas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});const d=await r.json();if(!r.ok)throw new Error(d.error);result.textContent='Merci ! Votre idée sera publiée après vérification par l’équipe.';e.currentTarget.reset();}catch(err){result.textContent=err.message;}});
document.querySelector('#shop-request-form')?.addEventListener('submit',async(e)=>{e.preventDefault();const form=e.currentTarget;const out=document.querySelector('#shop-request-result');const data=Object.fromEntries(new FormData(form));data.product_id=Number(data.product_id);data.quantity=Number(data.quantity);data.consent=data.consent==='true';out.textContent='Envoi de la demande…';try{const r=await fetch('/api/public/shop/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw new Error(result.error||'Erreur');out.textContent='Demande envoyée. L’équipe vous recontactera pour confirmer disponibilité et modalités.';form.reset();}catch(err){out.textContent=err.message;}});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
window.setInterval(() => {
  if (!document.hidden) loadPublicSettings();
}, 30000);
