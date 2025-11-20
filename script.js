/*
 * Kassenbon‑Splitter Version 3
 *
 * Verbesserungen:
 *  - Mehrere unabhängige Benutzerkonten mit sicherer Passwort‑Hashing.
 *  - Ordner (z.B. Reisen, WG, Projekte), die jeweils ihre eigenen Personen und Kassenbons enthalten.
 *  - Gleichzeitiges Hochladen mehrerer Bons. Bilder werden vor der OCR verkleinert, um die Geschwindigkeit zu erhöhen.
 *  - Jede Rechnung erscheint als eigene Tabelle; zusätzlich gibt es eine Übersichtstabelle, die zeigt, wie viel jede Person jeder anderen schuldet.
 *  - Möglichkeit, Benutzer abzumelden.
 *  - Alle Daten bleiben im Browser (LocalStorage). Kein Server, keine Kosten.
 */

// ======== Datenhaltung ========
const STORAGE_KEY = 'receiptSplitterV3Data';
let data = {
  currentUser: null,
  users: {}
};

// Index of the receipt currently being edited. This is updated whenever
// the user interacts with a receipt and is used when inserting new
// receipts via the floating button. A value of -1 indicates no
// specific receipt is selected and new receipts will be appended at
// the end of the list.
let currentEditedReceiptIndex = -1;

// Flag indicating whether the app is currently in share-view mode. When true,
// the normal user interface (login/auth and application sections) is hidden
// and a dedicated share view is displayed. Share view allows friends to
// assign themselves to items on a receipt via a shared link.
let isShareView = false;

// ======== Internationalisation ========
// Simple translation dictionary. Only a subset of labels are translated.
const TRANSLATIONS = {
  de: {
    login: 'Einloggen',
    signup: 'Registrieren',
    logout: 'Abmelden',
    folders: 'Ordner',
    newFolder: 'Neuer Ordner',
    addFolder: 'Ordner hinzufügen',
    shareFolder: 'Teilen',
    people: 'Personen im Ordner',
    addPerson: 'Person hinzufügen',
    preferences: 'Präferenzen',
    upload: 'Kassenbons hochladen',
    computeAll: 'Abrechnung berechnen',
    exportAll: 'PDF Export (alle Details)',
    exportSummary: 'PDF Export (Zusammenfassung)',
    receipts: 'Kassenbons im Ordner',
    receiptTitle: 'Kassenbon',
    payerLabel: ' Bezahlt von: ',
    article: 'Artikel',
    quantity: 'Menge',
    total: 'Gesamtpreis',
    actions: 'Aktionen'
  },
  en: {
    login: 'Login',
    signup: 'Sign up',
    logout: 'Logout',
    folders: 'Folders',
    newFolder: 'New Folder',
    addFolder: 'Add folder',
    shareFolder: 'Share',
    people: 'People in folder',
    addPerson: 'Add person',
    preferences: 'Preferences',
    upload: 'Upload receipts',
    computeAll: 'Compute settlement',
    exportAll: 'PDF export (all details)',
    exportSummary: 'PDF export (summary)',
    receipts: 'Receipts in folder',
    receiptTitle: 'Receipt',
    payerLabel: ' Paid by: ',
    article: 'Item',
    quantity: 'Qty',
    total: 'Total price',
    actions: 'Actions'
  }
};

/**
 * Returns the translation for the given key according to the current user's language.
 * If no translation exists, returns the key itself.
 */
function t(key) {
  const user = getCurrentUser();
  const lang = (user && user.settings && user.settings.language) || 'de';
  return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.de[key] || key;
}

// Apply translations to static UI elements based on current user's language
function applyTranslations() {
  // Only proceed if the app section is present
  // Auth section translations
  const loginBtn = document.getElementById('login-button');
  const signupBtn = document.getElementById('signup-button');
  if (loginBtn) loginBtn.textContent = t('login');
  if (signupBtn) signupBtn.textContent = t('signup');
  const addFolderBtn = document.getElementById('add-folder');
  if (addFolderBtn) addFolderBtn.textContent = t('addFolder');
  const addPersonBtn = document.getElementById('add-person');
  if (addPersonBtn) addPersonBtn.textContent = t('addPerson');
  const computeAllBtn = document.getElementById('compute-all');
  if (computeAllBtn) computeAllBtn.textContent = t('computeAll');
  const exportAllBtn = document.getElementById('export-all');
  if (exportAllBtn) exportAllBtn.textContent = t('exportAll');
  const exportSummaryBtn = document.getElementById('export-summary');
  if (exportSummaryBtn) exportSummaryBtn.textContent = t('exportSummary');
  const logoutBtn = document.getElementById('logout-button');
  if (logoutBtn) logoutBtn.textContent = t('logout');
  // Headings
  const folderSection = document.querySelector('#folder-section h3');
  if (folderSection) folderSection.textContent = t('folders');
  const peopleSection = document.querySelector('#people-section h3');
  if (peopleSection) peopleSection.textContent = t('people');
  const uploadSection = document.querySelector('#upload-section h3');
  if (uploadSection) uploadSection.textContent = t('upload');
  const receiptsSection = document.querySelector('#receipts-section h3');
  if (receiptsSection) receiptsSection.textContent = t('receipts');
  const settleSection = document.querySelector('#settle-section h3');
  if (settleSection) settleSection.textContent = t('computeAll');
}

/**
 * Displays a modal containing the provided share URL. The modal allows the user
 * to copy the link to the clipboard and to open it directly in a new tab.
 *
 * @param {string} url The share link to display and copy.
 */

function loadData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      data = JSON.parse(stored);
    }
  } catch (e) {
    console.error('Konnte gespeicherte Daten nicht laden:', e);
  }
}

// ======== Datenmigration für ältere Versionen ========
function migrateData() {
  // Ensure every user has settings
  for (const username in data.users) {
    const user = data.users[username];
    if (!user.settings) {
      user.settings = {
        language: 'de',
        showWizard: true,
        baseCurrency: 'EUR'
      };
    } else {
      // fill missing defaults
      if (!user.settings.language) user.settings.language = 'de';
      if (typeof user.settings.showWizard === 'undefined') user.settings.showWizard = true;
      if (!user.settings.baseCurrency) user.settings.baseCurrency = 'EUR';
    }
    // Migrate folder people from strings to objects
    if (user.folders) {
      Object.values(user.folders).forEach(folder => {
        if (Array.isArray(folder.people)) {
          for (let i = 0; i < folder.people.length; i++) {
            const p = folder.people[i];
            if (typeof p === 'string') {
              folder.people[i] = { name: p, prefs: { vegan: false, noAlcohol: false, noOlives: false, noNuts: false } };
            } else {
              // ensure prefs exist
              if (!p.prefs) {
                p.prefs = { vegan: false, noAlcohol: false, noOlives: false, noNuts: false };
              }
            }
          }
        }
        // ensure receipts have currency information
        if (folder.receipts) {
          folder.receipts.forEach(r => {
            if (!r.currency) r.currency = user.settings.baseCurrency || 'EUR';
            if (!r.rate) r.rate = 1.0;
            if (!r.rateDate) r.rateDate = Date.now();
            if (!r.extraColumns) r.extraColumns = [];
            if (!r.history) r.history = [];
            // ensure items have extras object
            if (Array.isArray(r.items)) {
              r.items.forEach(item => {
                if (!item.extras) item.extras = {};
                // compute unitPrice from total and qty if missing (legacy data)
                if (typeof item.unitPrice !== 'number') {
                  if (typeof item.total === 'number' && typeof item.qty === 'number' && item.qty !== 0) {
                    item.unitPrice = item.total / item.qty;
                  }
                }
              });
            }
            // Ensure the receipt has a unique ID for share links
            if (!r.id) {
              r.id = Date.now().toString() + Math.random().toString(36).substring(2, 8);
            }
            // Provide a hidden flag defaulting to false so receipts can be
            // individually shown or hidden without affecting the settlement.
            if (typeof r.hidden !== 'boolean') {
              r.hidden = false;
            }
          });
        }
        if (!folder.sharedWith) folder.sharedWith = [];
      });
    }
    // Migrate currentFolder to new ref format (self:id)
    if (user.currentFolder && typeof user.currentFolder === 'string' && !user.currentFolder.includes(':')) {
      user.currentFolder = 'self:' + user.currentFolder;
    }
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Konnte Daten nicht speichern:', e);
  }

  // Wenn eine Abrechnung angezeigt wird, automatisch aktualisieren
  try {
    if (resultsDiv && resultsDiv.innerHTML && resultsDiv.innerHTML.trim() !== '') {
      // call computeAll without prompting if possible
      // Avoid recursion if computeAll triggers saveData again
      computeAllButton.click();
    }
  } catch (err) {
    // ignore update errors
  }
}

function getCurrentUser() {
  if (!data.currentUser) return null;
  return data.users[data.currentUser] || null;
}

function getCurrentFolder() {
  const user = getCurrentUser();
  if (!user) return null;
  const fRef = user.currentFolder;
  if (!fRef) return null;
  // support shared folders with pattern owner:id
  if (typeof fRef === 'string' && fRef.includes(':')) {
    const [owner, id] = fRef.split(':');
    if (owner === 'self') {
      return user.folders[id] || null;
    }
    if (data.users[owner] && data.users[owner].folders && data.users[owner].folders[id]) {
      return data.users[owner].folders[id];
    }
    return null;
  }
  return user.folders[fRef] || null;
}

// ======== Passwort‑Hashing ========
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ======== DOM‑Referenzen ========
const authSection = document.getElementById('auth-section');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const loginButton = document.getElementById('login-button');
const signupButton = document.getElementById('signup-button');
const authMessage = document.getElementById('auth-message');

const appSection = document.getElementById('app-section');
const userDisplay = document.getElementById('user-display');
const logoutButton = document.getElementById('logout-button');

const foldersList = document.getElementById('folders-list');
const folderNameInput = document.getElementById('folder-name');
const addFolderButton = document.getElementById('add-folder');

const peopleListElem = document.getElementById('people-list');
const personNameInput = document.getElementById('person-name');
const addPersonButton = document.getElementById('add-person');

// New DOM references
const editPrefsButton = document.getElementById('edit-prefs');
const settingsButton = document.getElementById('settings-button');
const shareFolderButton = document.getElementById('share-folder');

// Modal elements
const prefsModal = document.getElementById('prefs-modal');
const prefsListDiv = document.getElementById('prefs-list');
const prefsSaveButton = document.getElementById('prefs-save');
const prefsCloseButton = document.getElementById('prefs-close');

const shareModal = document.getElementById('share-modal');
const shareUsersList = document.getElementById('share-users-list');
const shareSaveButton = document.getElementById('share-save');
const shareCloseButton = document.getElementById('share-close');

const settingsModal = document.getElementById('settings-modal');
const settingsSaveButton = document.getElementById('settings-save');
const settingsCloseButton = document.getElementById('settings-close');
const settingsLanguageSelect = document.getElementById('settings-language');

const wizardModal = document.getElementById('wizard-modal');
const wizardContent = document.getElementById('wizard-content');
const wizardNextButton = document.getElementById('wizard-next');
const wizardSkipButton = document.getElementById('wizard-skip');

// Export buttons
const exportAllButton = document.getElementById('export-all');
const exportSummaryButton = document.getElementById('export-summary');

// New references
const createReceiptButton = document.getElementById('create-receipt');
const floatingAddReceiptButton = document.getElementById('floating-add-receipt');
const linkFolderShareButton = document.getElementById('link-folder-share');
const settingsNewUsername = document.getElementById('settings-new-username');
const settingsNewPassword = document.getElementById('settings-new-password');
const showInstructionsButton = document.getElementById('show-instructions');
const instructionsModal = document.getElementById('instructions-modal');
const instructionsContent = document.getElementById('instructions-content');
const instructionsCloseButton = document.getElementById('instructions-close');

// Folder link and copy link modals
// These modals support the improved folder sharing flow. The folderLinkModal
// lists buttons for each folder, and copyLinkModal displays the generated
// share URL with options to copy or cancel.
const folderLinkModal = document.getElementById('folder-link-modal');
const folderLinkList = document.getElementById('folder-link-list');
const folderLinkCancel = document.getElementById('folder-link-cancel');
const copyLinkModal = document.getElementById('copy-link-modal');
const copyLinkText = document.getElementById('copy-link-text');
const copyLinkConfirm = document.getElementById('copy-link-confirm');
const copyLinkCancel = document.getElementById('copy-link-cancel');
// Track the currently generated share URL for copy confirmation
let pendingShareUrl = null;


const receiptInput = document.getElementById('receipt-input');
const uploadInfo = document.getElementById('upload-info');
const receiptsList = document.getElementById('receipts-list');

const computeAllButton = document.getElementById('compute-all');
const summaryTableDiv = document.getElementById('summary-table');
const resultsDiv = document.getElementById('results');

// ======== Initialisierung ========
loadData();
// Apply data migrations to ensure newer structures exist
migrateData();

// After migrating data, determine whether we should display the normal
// application interface or enter share-view mode. If a "share" token is
// present in the query string, the app will bypass authentication and
// show a dedicated page allowing a friend to assign themselves to items.
try {
  const params = new URLSearchParams(window.location.search);
  const shareToken = params.get('share');
  if (shareToken) {
    // Enter share view
    loadShareView(shareToken);
  } else {
    if (data.currentUser) {
      showApp();
    } else {
      showAuth();
    }
  }
} catch (e) {
  // On any error fallback to normal auth/app flow
  if (data.currentUser) {
    showApp();
  } else {
    showAuth();
  }
}

// ======== Anzeige‑Logik ========
function showAuth(message = '') {
  authSection.classList.remove('hidden');
  appSection.classList.add('hidden');
  authMessage.textContent = message;
}

function showApp() {
  authSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  const user = getCurrentUser();
  if (!user) {
    showAuth('Session abgelaufen, bitte erneut einloggen.');
    return;
  }
  // Set user display and apply translations
  // Show user with language aware label
  if (user) {
    userDisplay.textContent = (user.settings.language === 'en' ? 'Logged in as ' : 'Eingeloggt als ') + data.currentUser;
  } else {
    userDisplay.textContent = '';
  }
  // Update language selectors to current language
  const settingsLangSel = document.getElementById('settings-language');
  if (settingsLangSel) settingsLangSel.value = user.settings.language || 'de';
  const langSelAuth = document.getElementById('language-select');
  if (langSelAuth) langSelAuth.value = user.settings.language || 'de';
  applyTranslations();
  renderFolders();
  renderPeople();
  renderReceipts();
  // Show onboarding wizard if enabled (temporarily disabled in this build)
  if (false && user.settings && user.settings.showWizard) {
    startWizard();
  }
}

// ======== Authentifizierung ========
loginButton.addEventListener('click', async () => {
  const username = authUsername.value.trim();
  const password = authPassword.value;
  if (!username || !password) {
    authMessage.textContent = 'Bitte Benutzername und Passwort eingeben.';
    return;
  }
  const user = data.users[username];
  if (!user) {
    authMessage.textContent = 'Benutzer nicht gefunden. Bitte registrieren.';
    return;
  }
  const hash = await hashPassword(password);
  if (user.passwordHash !== hash) {
    authMessage.textContent = 'Falsches Passwort.';
    return;
  }
  // Apply selected language on login (optional override)
  const langSel = document.getElementById('language-select');
  if (langSel) {
    const chosen = langSel.value;
    if (user.settings) {
      user.settings.language = chosen;
    }
  }
  data.currentUser = username;
  saveData();
  authUsername.value = '';
  authPassword.value = '';
  showApp();
});

signupButton.addEventListener('click', async () => {
  const username = authUsername.value.trim();
  const password = authPassword.value;
  if (!username || !password) {
    authMessage.textContent = 'Bitte Benutzername und Passwort eingeben.';
    return;
  }
  if (data.users[username]) {
    authMessage.textContent = 'Benutzername existiert bereits.';
    return;
  }
  const hash = await hashPassword(password);
  // Determine language from selector during signup
  const langSel = document.getElementById('language-select');
  const selectedLang = langSel ? langSel.value : 'de';
  data.users[username] = {
    passwordHash: hash,
    folders: {},
    currentFolder: null,
    settings: {
      language: selectedLang,
      showWizard: true,
      baseCurrency: 'EUR'
    }
  };
  data.currentUser = username;
  saveData();
  authUsername.value = '';
  authPassword.value = '';
  showApp();
});

logoutButton.addEventListener('click', () => {
  data.currentUser = null;
  saveData();
  showAuth();
});

// ======== Ordnerverwaltung ========
addFolderButton.addEventListener('click', () => {
  const user = getCurrentUser();
  if (!user) return;
  const name = folderNameInput.value.trim();
  if (!name) return;
  const id = Date.now().toString();
  user.folders[id] = {
    name: name,
    people: [],
    receipts: [],
    sharedWith: [],
    order: Object.keys(user.folders).length
  };
  user.currentFolder = 'self:' + id;
  folderNameInput.value = '';
  saveData();
  renderFolders();
  renderPeople();
  renderReceipts();
});

function renderFolders() {
  const user = getCurrentUser();
  if (!user) return;
  foldersList.innerHTML = '';
  const folderIds = Object.keys(user.folders);
  if (folderIds.length === 0) {
    const no = document.createElement('p');
    no.textContent = 'Keine Ordner. Bitte anlegen.';
    foldersList.appendChild(no);
    return;
  }
  // sort folders by order property if exists
  folderIds.sort((a, b) => {
    const fa = user.folders[a];
    const fb = user.folders[b];
    const oa = fa.order || 0;
    const ob = fb.order || 0;
    return oa - ob;
  });
  // Build list of own and shared folders
  const items = [];
  // Own folders
  folderIds.forEach(id => {
    items.push({ owner: data.currentUser, id, folder: user.folders[id], own: true });
  });
  // Shared folders from other users
  Object.keys(data.users).forEach(username => {
    if (username === data.currentUser) return;
    const otherUser = data.users[username];
    if (otherUser && otherUser.folders) {
      Object.keys(otherUser.folders).forEach(fid => {
        const f = otherUser.folders[fid];
        if (f.sharedWith && f.sharedWith.includes(data.currentUser)) {
          items.push({ owner: username, id: fid, folder: f, own: false });
        }
      });
    }
  });
  // Sort items: own ones by order, then shared (no sorting)
  items.sort((a, b) => {
    if (a.own && b.own) {
      const oa = a.folder.order || 0;
      const ob = b.folder.order || 0;
      return oa - ob;
    }
    if (a.own) return -1;
    if (b.own) return 1;
    return 0;
  });
  items.forEach((item, index) => {
    const { owner, id, folder, own } = item;
    const span = document.createElement('span');
    let ref = own ? `self:${id}` : `${owner}:${id}`;
    // determine active state
    const isActive = user.currentFolder === ref;
    span.className = 'folder-item' + (isActive ? ' active' : '');
    span.textContent = own ? folder.name : `${folder.name} (${owner})`;
    span.addEventListener('click', () => {
      user.currentFolder = ref;
      saveData();
      renderFolders();
      renderPeople();
      renderReceipts();
    });
    // sort icons only for own folders
    if (own) {
      // container for action icons: rename and sort
      const icons = document.createElement('div');
      icons.className = 'sort-icons';
      // Rename icon
      const renameBtn = document.createElement('span');
      renameBtn.textContent = '✎';
      renameBtn.title = 'Ordner umbenennen';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt('Neuer Name für den Ordner:', folder.name);
        if (!newName || !newName.trim()) return;
        folder.name = newName.trim();
        saveData();
        renderFolders();
      });
      icons.appendChild(renameBtn);
      // Up icon
      const up = document.createElement('span');
      up.textContent = '▲';
      up.title = 'Nach oben';
      up.addEventListener('click', (e) => {
        e.stopPropagation();
        const ownItems = items.filter(i => i.own);
        const idxOwn = ownItems.findIndex(i => i.id === id);
        if (idxOwn > 0) {
          const prevId = ownItems[idxOwn - 1].id;
          const prevFolder = user.folders[prevId];
          const tmp = prevFolder.order || 0;
          prevFolder.order = folder.order || 0;
          folder.order = tmp;
          saveData();
          renderFolders();
        }
      });
      icons.appendChild(up);
      // Down icon
      const down = document.createElement('span');
      down.textContent = '▼';
      down.title = 'Nach unten';
      down.addEventListener('click', (e) => {
        e.stopPropagation();
        const ownItems = items.filter(i => i.own);
        const idxOwn = ownItems.findIndex(i => i.id === id);
        if (idxOwn < ownItems.length - 1) {
          const nextId = ownItems[idxOwn + 1].id;
          const nextFolder = user.folders[nextId];
          const tmp = nextFolder.order || 0;
          nextFolder.order = folder.order || 0;
          folder.order = tmp;
          saveData();
          renderFolders();
        }
      });
      icons.appendChild(down);
      span.appendChild(icons);
    }
    foldersList.appendChild(span);
  });
}

// ======== Personenverwaltung ========
addPersonButton.addEventListener('click', () => {
  const folder = getCurrentFolder();
  if (!folder) return;
  const name = personNameInput.value.trim();
  if (!name) return;
  // Add person as an object with default preferences
  folder.people.push({ name: name, prefs: { vegan: false, noAlcohol: false, noOlives: false, noNuts: false } });
  personNameInput.value = '';
  saveData();
  renderPeople();
  renderReceipts();
});

function renderPeople() {
  const folder = getCurrentFolder();
  peopleListElem.innerHTML = '';
  if (!folder) return;
  folder.people.forEach(person => {
    const wrapper = document.createElement('span');
    wrapper.className = 'person-badge';
    // Apply styling for excluded persons
    if (person.excluded) {
      wrapper.style.opacity = '0.5';
      wrapper.style.textDecoration = 'line-through';
    }
    const nameSpan = document.createElement('span');
    nameSpan.textContent = person.name;
    wrapper.appendChild(nameSpan);
    // Toggle button to exclude/include
    const toggle = document.createElement('span');
    toggle.textContent = person.excluded ? '➕' : '✖';
    toggle.style.marginLeft = '4px';
    toggle.style.cursor = 'pointer';
    toggle.title = person.excluded ? 'Person wieder aufnehmen' : 'Person ausschließen';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      person.excluded = !person.excluded;
      saveData();
      renderPeople();
      renderReceipts();
    });
    wrapper.appendChild(toggle);
    peopleListElem.appendChild(wrapper);
  });
}

// ======== Kassenbon‑Upload ========
receiptInput.addEventListener('change', async (event) => {
  const folder = getCurrentFolder();
  if (!folder) {
    uploadInfo.textContent = 'Bitte zuerst einen Ordner auswählen oder erstellen.';
    return;
  }
  const files = Array.from(event.target.files);
  if (files.length === 0) return;
  uploadInfo.textContent = 'Erkennung läuft …';
  // Parallelisiere OCR für alle Dateien
  const promises = files.map(file => processReceiptFile(file));
  const results = await Promise.all(promises);
    results.forEach((items, idx) => {
    const file = files[idx];
    // Determine currency and rate from current user settings
    const user = getCurrentUser();
    const currency = (user && user.settings && user.settings.baseCurrency) || 'EUR';
    let rateVal = 1.0;
    if (currency !== 'EUR') {
      rateVal = DEFAULT_RATES[currency] || 1.0;
    }
    const receipt = {
      id: Date.now().toString() + '-' + file.name,
      name: file.name,
      payer: folder.people.length > 0 ? 0 : -1,
      items: items,
      extraColumns: [],
      currency: currency,
      rate: rateVal,
      rateDate: Date.now(),
      hidden: false
    };
    // For each parsed item compute base and unit price if possible
    receipt.items.forEach(it => {
      // Compute unit price if not already present but total and qty exist
      if (typeof it.unitPrice !== 'number') {
        if (typeof it.total === 'number' && typeof it.qty === 'number' && it.qty !== 0) {
          it.unitPrice = it.total / it.qty;
        }
      }
      if (typeof it.unitPrice === 'number' && typeof it.qty === 'number') {
        const totalCur = it.unitPrice * it.qty;
        it.totalBase = totalCur / rateVal;
        it.total = totalCur;
      } else if (typeof it.total === 'number') {
        it.totalBase = it.total / rateVal;
      }
    });
    folder.receipts.push(receipt);
  });
  saveData();
  uploadInfo.textContent = '';
  receiptInput.value = '';
  renderReceipts();
});

async function processReceiptFile(file) {
  // verkleinere Bild zum schnelleren OCR (max Breite 800px)
  const dataURL = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const resizedDataURL = await resizeImage(dataURL, 800);
  const { data: { text } } = await Tesseract.recognize(resizedDataURL, 'deu', { logger: () => {} });
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  const items = [];
  lines.forEach(line => {
    const item = parseLine(line);
    if (item) {
      item.assigned = {};
      items.push(item);
    }
  });
  if (items.length === 0) {
    lines.forEach(l => items.push({ name: l, qty: 1, total: undefined, assigned: {} }));
  }
  return items;
}

function resizeImage(dataURL, maxWidth) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = dataURL;
  });
}

// ======== Rezepte anzeigen und bearbeiten ========
function renderReceipts() {
  // Preserve current scroll position so that re-rendering a receipt does
  // not jump back to the top of the page when editing inputs. This is
  // particularly important when editing unit prices or quantities.
  const scrollYBefore = window.scrollY;
  const folder = getCurrentFolder();
  receiptsList.innerHTML = '';
  if (!folder) return;
  if (!Array.isArray(folder.receipts) || folder.receipts.length === 0) {
    const no = document.createElement('p');
    no.textContent = 'Keine Kassenbons in diesem Ordner.';
    receiptsList.appendChild(no);
    // Restore scroll even if nothing is shown
    setTimeout(() => {
      if (!isShareView) window.scrollTo(0, scrollYBefore);
    }, 0);
    return;
  }
  folder.receipts.forEach((receipt, rIndex) => {
    // ensure arrays
    receipt.extraColumns = receipt.extraColumns || [];
    receipt.items = receipt.items || [];
    const container = document.createElement('div');
    container.className = 'receipt';
    // Header row with title, payer select, currency select
    const header = document.createElement('div');
    header.className = 'receipt-header';
    const title = document.createElement('span');
    title.className = 'receipt-title';
    title.textContent = receipt.name;
    header.appendChild(title);
    // Payer select
    const payerLabel = document.createElement('label');
    payerLabel.textContent = t('payerLabel');
    const payerSelect = document.createElement('select');
    if (folder.people.length === 0) {
      const opt = document.createElement('option');
      opt.value = -1;
      opt.textContent = '—';
      payerSelect.appendChild(opt);
      payerSelect.value = -1;
    } else {
      folder.people.forEach((person, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = person.name;
        payerSelect.appendChild(opt);
      });
      if (typeof receipt.payer === 'number' && receipt.payer >= 0 && receipt.payer < folder.people.length) {
        payerSelect.value = receipt.payer;
      } else {
        payerSelect.value = 0;
        receipt.payer = 0;
      }
    }
    payerSelect.addEventListener('change', (e) => {
      receipt.payer = parseInt(e.target.value);
      saveData();
    });
    payerLabel.appendChild(payerSelect);
    header.appendChild(payerLabel);
    // Currency select
    const currencySelect = document.createElement('select');
    const currencies = [
      { code: 'EUR', symbol: '€' },
      { code: 'USD', symbol: '$' },
      { code: 'GBP', symbol: '£' },
      { code: 'CHF', symbol: 'CHF' },
      { code: 'SEK', symbol: 'SEK' },
      { code: 'JPY', symbol: '¥' },
      { code: 'ALL', symbol: 'Lek' }
    ];
    currencies.forEach(cur => {
      const opt = document.createElement('option');
      opt.value = cur.code;
      opt.textContent = cur.code;
      currencySelect.appendChild(opt);
    });
    currencySelect.value = receipt.currency || 'EUR';
    currencySelect.addEventListener('change', async (e) => {
      const newCur = e.target.value;
      await changeReceiptCurrency(receipt, newCur);
      renderReceipts();
      renderPeople();
      saveData();
    });
    header.appendChild(currencySelect);
    // Display exchange rate info
    const rateInfo = document.createElement('small');
    if (receipt.rate && receipt.currency) {
      const date = new Date(receipt.rateDate || Date.now());
      const localeDate = date.toLocaleString();
      rateInfo.textContent = ` Rate 1€=${receipt.rate.toFixed(4)} ${receipt.currency} (${localeDate})`;
    }
    header.appendChild(rateInfo);
    // Manual override button
    const overrideBtn = document.createElement('button');
    overrideBtn.textContent = '✎';
    overrideBtn.title = 'Wechselkurs manuell überschreiben';
    overrideBtn.className = 'secondary-button';
    overrideBtn.addEventListener('click', () => {
      const newRateStr = prompt('Neuer Wechselkurs für 1 EUR in ' + receipt.currency + ':', receipt.rate ? receipt.rate.toString() : '');
      if (!newRateStr) return;
      const newRate = parseFloat(newRateStr);
      if (isNaN(newRate) || newRate <= 0) {
        alert('Ungültiger Kurs.');
        return;
      }
      const reason = prompt('Begründung für den manuellen Kurs (optional):', receipt.manualReason || '');
      receipt.rate = newRate;
      receipt.rateDate = Date.now();
      receipt.manualReason = reason || '';
      // Update unit prices and totals based on existing base values
      receipt.items.forEach(item => {
        if (typeof item.totalBase === 'number' && typeof item.qty === 'number' && item.qty !== 0) {
          // derive new unit price from base and new rate
          const newUnit = (item.totalBase * newRate) / item.qty;
          item.unitPrice = newUnit;
          item.total = newUnit * item.qty;
        }
      });
      saveData();
      renderReceipts();
    });
    // Action buttons container for receipt-level actions
    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '0.25rem';
    actionsDiv.appendChild(overrideBtn);
    // Rename receipt
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✎';
    renameBtn.title = 'Bon umbenennen';
    renameBtn.className = 'secondary-button';
    renameBtn.addEventListener('click', () => {
      const newName = prompt('Neuer Name für den Bon:', receipt.name);
      if (!newName || !newName.trim()) return;
      receipt.name = newName.trim();
      saveData();
      renderReceipts();
    });
    actionsDiv.appendChild(renameBtn);
    // Delete receipt
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Bon löschen';
    deleteBtn.className = 'secondary-button';
    deleteBtn.addEventListener('click', () => {
      // Ask for confirmation twice before deleting a receipt to avoid
      // accidental deletion. Only proceed if the user confirms both times.
      if (!confirm('Diesen Bon wirklich löschen?')) return;
      if (!confirm('Bist du dir sicher? Dieser Bon wird dauerhaft gelöscht.')) return;
      folder.receipts.splice(rIndex, 1);
      saveData();
      renderReceipts();
      renderPeople();
    });
    actionsDiv.appendChild(deleteBtn);
    // Move receipt
    const moveBtn = document.createElement('button');
    moveBtn.textContent = '⇆';
    moveBtn.title = 'Bon in anderen Ordner verschieben';
    moveBtn.className = 'secondary-button';
    moveBtn.addEventListener('click', () => {
      const user = getCurrentUser();
      if (!user) return;
      // Determine current folder id
      let currentRef = user.currentFolder;
      let currentId = null;
      if (typeof currentRef === 'string' && currentRef.includes(':')) {
        const parts = currentRef.split(':');
        if (parts[0] === 'self') currentId = parts[1];
      }
      const folderIds = Object.keys(user.folders).filter(fid => fid !== currentId);
      if (folderIds.length === 0) {
        alert('Es gibt keinen anderen eigenen Ordner.');
        return;
      }
      let msg = 'Wähle Zielordner:\n';
      folderIds.forEach((fid, idx) => {
        const f = user.folders[fid];
        msg += `${idx+1}: ${f.name}\n`;
      });
      const sel = prompt(msg);
      if (!sel) return;
      const idxSel = parseInt(sel) - 1;
      if (isNaN(idxSel) || idxSel < 0 || idxSel >= folderIds.length) return;
      const destId = folderIds[idxSel];
      const destFolder = user.folders[destId];
      if (!destFolder) return;
      // Move receipt
      destFolder.receipts.push(receipt);
      folder.receipts.splice(rIndex, 1);
      // adjust user.currentFolder? keep same
      saveData();
      renderFolders();
      renderPeople();
      renderReceipts();
    });
    actionsDiv.appendChild(moveBtn);
    // Reorder up
    const upBtn = document.createElement('button');
    upBtn.textContent = '▲';
    upBtn.title = 'Bon nach oben verschieben';
    upBtn.className = 'secondary-button';
    upBtn.addEventListener('click', (e) => {
      if (rIndex > 0) {
        const tmp = folder.receipts[rIndex - 1];
        folder.receipts[rIndex - 1] = receipt;
        folder.receipts[rIndex] = tmp;
        saveData();
        renderReceipts();
      }
    });
    actionsDiv.appendChild(upBtn);
    // Reorder down
    const downBtn = document.createElement('button');
    downBtn.textContent = '▼';
    downBtn.title = 'Bon nach unten verschieben';
    downBtn.className = 'secondary-button';
    downBtn.addEventListener('click', (e) => {
      if (rIndex < folder.receipts.length - 1) {
        const tmp = folder.receipts[rIndex + 1];
        folder.receipts[rIndex + 1] = receipt;
        folder.receipts[rIndex] = tmp;
        saveData();
        renderReceipts();
      }
    });
    actionsDiv.appendChild(downBtn);

    // Share button: generate a link for friends to assign themselves
    const shareBtn = document.createElement('button');
    shareBtn.textContent = '🔗';
    shareBtn.title = 'Bon teilen';
    shareBtn.className = 'secondary-button';
    shareBtn.addEventListener('click', () => {
      const user = getCurrentUser();
      if (!user) return;
      // Determine current folder id (owner perspective)
      let fId = null;
      const ref = user.currentFolder;
      if (typeof ref === 'string' && ref.includes(':')) {
        const parts = ref.split(':');
        if (parts[0] === 'self') fId = parts[1];
      } else {
        fId = ref;
      }
      // Generate a token that encodes owner, folder and receipt id
      const token = encodeShareData(data.currentUser, fId, receipt.id);
      // Build a generic URL using only the file name. When the site is opened locally
      // by another user (for example via double‑clicking index.html), this relative link
      // can be appended to the address bar to load the shared view. Including the full
      // file path causes the link to point to a specific machine path which will not
      // exist on other systems. Therefore we always use only the file name here.
      // Build a share URL based on the current page without any query parameters.
      // This ensures that the link points back to the same location (e.g. the
      // /kassenbonsplitter/ path when hosted on GitHub Pages) instead of the
      // root of the domain. We strip any existing query string before appending
      // our share token.
      const baseUrl = window.location.href.split('?')[0];
      const url = baseUrl + '?share=' + encodeURIComponent(token);
      // Attempt to copy the link to the clipboard for convenience. Errors are ignored.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
      // Show the link in a prompt so the user can copy it easily. The link is
      // fully qualified (it includes the current page path), so it can be
      // pasted directly into any browser address bar and will load the shared view.
      prompt('Link zum Teilen (bitte kopieren und direkt im Browser öffnen):', url);
    });
    actionsDiv.appendChild(shareBtn);

    // Hide/unhide button
    const hideBtn = document.createElement('button');
    hideBtn.textContent = receipt.hidden ? '👁️' : '🙈';
    hideBtn.title = receipt.hidden ? 'Bon einblenden' : 'Bon ausblenden';
    hideBtn.className = 'secondary-button';
    hideBtn.addEventListener('click', () => {
      receipt.hidden = !receipt.hidden;
      saveData();
      renderReceipts();
    });
    actionsDiv.appendChild(hideBtn);

    // Refresh button
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '↻';
    refreshBtn.title = 'Bon aktualisieren';
    refreshBtn.className = 'secondary-button';
    refreshBtn.addEventListener('click', () => {
      // Save and re-render receipts
      saveData();
      renderReceipts();
    });
    actionsDiv.appendChild(refreshBtn);

    // Pending modifications: if there are pending changes for this receipt, show confirm/discard buttons
    const ownerName = data.currentUser;
    const pendingChanges = getPendingChangesForReceipt(ownerName, receipt.id);
    if (pendingChanges) {
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = '✔';
      confirmBtn.title = 'Geteilte Änderungen übernehmen';
      confirmBtn.className = 'secondary-button';
      confirmBtn.addEventListener('click', () => {
        const user = getCurrentUser();
        if (!user) return;
        let fId2 = null;
        const ref2 = user.currentFolder;
        if (typeof ref2 === 'string' && ref2.includes(':')) {
          const parts2 = ref2.split(':');
          if (parts2[0] === 'self') fId2 = parts2[1];
        } else {
          fId2 = ref2;
        }
        applyPendingChanges(ownerName, fId2, receipt.id);
        renderReceipts();
        renderPeople();
      });
      actionsDiv.appendChild(confirmBtn);
      const discardBtn = document.createElement('button');
      discardBtn.textContent = '✖';
      discardBtn.title = 'Geteilte Änderungen verwerfen';
      discardBtn.className = 'secondary-button';
      discardBtn.addEventListener('click', () => {
        discardPendingChanges(ownerName, receipt.id);
        renderReceipts();
      });
      actionsDiv.appendChild(discardBtn);
    }
    header.appendChild(actionsDiv);
    container.appendChild(header);

    // If the receipt is hidden, show a placeholder message instead of the details
    if (receipt.hidden) {
      const hiddenMsg = document.createElement('div');
      hiddenMsg.textContent = 'Dieser Bon ist ausgeblendet.';
      hiddenMsg.style.fontStyle = 'italic';
      hiddenMsg.style.margin = '0.5rem';
      container.appendChild(hiddenMsg);
      receiptsList.appendChild(container);
      return;
    }
    // Table
    const table = document.createElement('table');
    const headRow = document.createElement('tr');
    /*
     * Build the table header. The default columns now include four entries:
     *  1. Article (item name)
     *  2. Quantity (Menge)
     *  3. Unit price (Einzelpreis)
     *  4. Total amount for the line item (Gesamtbetrag)
     *
     * The user requested that the names of people appear directly above
     * their corresponding checkbox columns. To ensure alignment, we insert
     * a placeholder header cell between the extra columns and the person
     * columns. The extra column header for the "+" button will align with
     * this placeholder across all rows.
     */
    const cols = [t('article'), t('quantity'), 'Einzelpreis', 'Gesamt'];
    cols.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headRow.appendChild(th);
    });
    // Extra columns headers
    receipt.extraColumns.forEach(col => {
      const th = document.createElement('th');
      const wrapper = document.createElement('div');
      wrapper.className = 'extra-col-header';
      const span = document.createElement('span');
      span.textContent = col.name;
      wrapper.appendChild(span);
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✖';
      removeBtn.title = 'Spalte entfernen';
      removeBtn.addEventListener('click', () => {
        // remove column
        const idx = receipt.extraColumns.findIndex(c => c.id === col.id);
        if (idx >= 0) {
          receipt.extraColumns.splice(idx, 1);
          // remove values from items
          receipt.items.forEach(it => {
            if (it.extras) delete it.extras[col.id];
          });
          saveData();
          renderReceipts();
        }
      });
      wrapper.appendChild(removeBtn);
      th.appendChild(wrapper);
      headRow.appendChild(th);
    });
    // Add column button
    const addColTh = document.createElement('th');
    const addColBtn = document.createElement('button');
    addColBtn.textContent = '+';
    addColBtn.title = 'Spalte hinzufügen';
    addColBtn.addEventListener('click', () => {
      const name = prompt('Name der neuen Spalte:');
      if (!name) return;
      const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
      receipt.extraColumns.push({ id, name });
      // initialise extras for items
      receipt.items.forEach(it => {
        if (!it.extras) it.extras = {};
        it.extras[id] = '';
      });
      saveData();
      renderReceipts();
    });
    addColTh.appendChild(addColBtn);
    headRow.appendChild(addColTh);
    // Person name headers (only for active persons)
    const activePeople = folder.people.filter(p => !p.excluded);
    activePeople.forEach(person => {
      const th = document.createElement('th');
      th.textContent = person.name;
      headRow.appendChild(th);
    });
    // Delete column header
    const delHead = document.createElement('th');
    delHead.textContent = '';
    headRow.appendChild(delHead);
    table.appendChild(headRow);
    // Rows for each item
    receipt.items.forEach((item) => {
      const row = document.createElement('tr');
      // We'll keep a reference to the total span for this row so that
      // quantity and unit price edits can update the displayed value
      // without triggering a full re-render. It will be assigned after
      // the total cell is created.
      let totalSpanRef;
      // Name cell
      const nameTd = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = item.name;
      nameInput.addEventListener('input', (e) => {
        item.name = e.target.value;
        saveData();
      });
      nameTd.appendChild(nameInput);
      row.appendChild(nameTd);
      // Quantity cell - integer only
      const qtyTd = document.createElement('td');
      const qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.min = '0';
      qtyInput.step = '1';
      qtyInput.value = item.qty;
      // Update quantity without heavy re-rendering on each keystroke. The
      // displayed total for this row and the receipt sum are updated
      // immediately. Persist and fully re-render when editing ends.
      qtyInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        item.qty = isNaN(val) ? 0 : val;
        if (typeof item.unitPrice === 'number' && typeof item.qty === 'number') {
          const totalCur = item.unitPrice * item.qty;
          item.total = totalCur;
          item.totalBase = totalCur / receipt.rate;
          if (totalSpanRef) {
            totalSpanRef.textContent = !isNaN(totalCur) ? totalCur.toFixed(2) : '';
          }
        } else {
          item.total = undefined;
          item.totalBase = undefined;
          if (totalSpanRef) totalSpanRef.textContent = '';
        }
        updateReceiptTotal();
      });
      qtyInput.addEventListener('blur', () => {
        saveData();
        renderReceipts();
      });
      qtyTd.appendChild(qtyInput);
      row.appendChild(qtyTd);
      // Unit price cell
      const unitTd = document.createElement('td');
      const unitInput = document.createElement('input');
      unitInput.type = 'number';
      unitInput.min = '0';
      unitInput.step = '0.01';
      unitInput.value = typeof item.unitPrice === 'number' ? item.unitPrice.toFixed(2) : '';
      // Update unit price without heavy re-rendering. Update totals and
      // overall receipt sum immediately; persist and re-render on blur.
      unitInput.addEventListener('input', (e) => {
        const valStr = e.target.value;
        if (valStr === '') {
          item.unitPrice = undefined;
          item.total = undefined;
          item.totalBase = undefined;
          if (totalSpanRef) totalSpanRef.textContent = '';
        } else {
          const valNum = parseFloat(valStr);
          item.unitPrice = isNaN(valNum) ? undefined : valNum;
          if (typeof item.unitPrice === 'number' && typeof item.qty === 'number') {
            const totalCur = item.unitPrice * item.qty;
            item.total = totalCur;
            item.totalBase = totalCur / receipt.rate;
            if (totalSpanRef) {
              totalSpanRef.textContent = !isNaN(totalCur) ? totalCur.toFixed(2) : '';
            }
          } else {
            item.total = undefined;
            item.totalBase = undefined;
            if (totalSpanRef) totalSpanRef.textContent = '';
          }
        }
        updateReceiptTotal();
      });
      unitInput.addEventListener('blur', () => {
        saveData();
        renderReceipts();
      });
      unitTd.appendChild(unitInput);
      row.appendChild(unitTd);
      // Total amount per item cell (read-only)
      const totalTd = document.createElement('td');
      const totalSpan = document.createElement('span');
      let totalValue;
      if (typeof item.unitPrice === 'number' && typeof item.qty === 'number') {
        totalValue = item.unitPrice * item.qty;
      } else if (typeof item.total === 'number') {
        totalValue = item.total;
      } else {
        totalValue = undefined;
      }
      totalSpan.textContent = totalValue !== undefined ? totalValue.toFixed(2) : '';
      totalTd.appendChild(totalSpan);
      row.appendChild(totalTd);
      // Now that the total span exists, assign it to the captured reference
      // so that the qty/unit handlers can update it without needing a full
      // re-render. This assignment happens on each row creation.
      totalSpanRef = totalSpan;
      // Extra columns values
      receipt.extraColumns.forEach(col => {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = (item.extras && item.extras[col.id]) || '';
        input.addEventListener('input', (e) => {
          if (!item.extras) item.extras = {};
          item.extras[col.id] = e.target.value;
          saveData();
        });
        td.appendChild(input);
        row.appendChild(td);
      });
      // Placeholder cell to align with Add Column button
      const blankTd = document.createElement('td');
      row.appendChild(blankTd);
      // Person assignment checkboxes (only for active persons)
      activePeople.forEach((person) => {
        // We need original index; find in folder.people
        const origIndex = folder.people.findIndex(p => p === person);
        const td = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !!(item.assigned && item.assigned[origIndex]);
        // check preferences and mark warnings
        if (person.prefs) {
          const nameLower = (item.name || '').toLowerCase();
          let warn = false;
          if (person.prefs.vegan && /käse|cheese|milch|fleisch|wurst|meat|egg/.test(nameLower)) warn = true;
          if (person.prefs.noAlcohol && /bier|wine|wein|vodka|whisky|gin/.test(nameLower)) warn = true;
          if (person.prefs.noOlives && /olive|oliven/.test(nameLower)) warn = true;
          if (person.prefs.noNuts && /nuss|nuts|almond|mandel/.test(nameLower)) warn = true;
          if (warn) {
            td.style.backgroundColor = '#fff7e6';
            td.title = 'Passt nicht zu Präferenzen';
          }
        }
        checkbox.addEventListener('change', (e) => {
          if (!item.assigned) item.assigned = {};
          item.assigned[origIndex] = e.target.checked;
          saveData();
        });
        td.appendChild(checkbox);

       // Highlight pending changes for this cell if applicable
       const pendingList = getPendingChangesForReceipt(data.currentUser, receipt.id);
       if (pendingList) {
         for (const ch of pendingList) {
           if (ch.itemIndex === receipt.items.indexOf(item) && ch.personIndex === origIndex) {
             const currentAssigned = !!(item.assigned && item.assigned[origIndex]);
             if (ch.assigned !== currentAssigned) {
               td.style.backgroundColor = '#ffe6e6';
               td.title = 'Änderung wartet auf Bestätigung';
             }
             break;
           }
         }
       }
        row.appendChild(td);
      });
      // Delete item cell
      const delTd = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.textContent = '✖';
      delBtn.title = 'Posten löschen';
      delBtn.className = 'secondary-button';
      delBtn.addEventListener('click', () => {
        const index = receipt.items.indexOf(item);
        if (index >= 0) {
          receipt.items.splice(index, 1);
          saveData();
          renderReceipts();
        }
      });
      delTd.appendChild(delBtn);
      row.appendChild(delTd);
      table.appendChild(row);
    });
    container.appendChild(table);
    // Calculate receipt total in current currency
    let receiptTotal = 0;
    receipt.items.forEach(item => {
      if (typeof item.totalBase === 'number') {
        receiptTotal += item.totalBase * receipt.rate;
      } else if (typeof item.unitPrice === 'number' && typeof item.qty === 'number') {
        receiptTotal += item.unitPrice * item.qty;
      }
    });
    // Display receipt total below the table
    const totalDiv = document.createElement('div');
    totalDiv.style.marginTop = '4px';
    totalDiv.style.fontWeight = 'bold';
    // Helper to recalculate and update the total display. It sums up
    // unitPrice*qty for each item, falling back to totalBase when
    // necessary, then formats and assigns the text. This helper is
    // captured by the item-level event handlers above.
    const updateReceiptTotal = () => {
      let runningTotal = 0;
      receipt.items.forEach(it => {
        if (typeof it.unitPrice === 'number' && typeof it.qty === 'number') {
          runningTotal += it.unitPrice * it.qty;
        } else if (typeof it.totalBase === 'number') {
          runningTotal += it.totalBase * receipt.rate;
        }
      });
      if (!isNaN(runningTotal)) {
        totalDiv.textContent = `Gesamtsumme: ${runningTotal.toFixed(2)} ${receipt.currency}`;
      } else {
        totalDiv.textContent = '';
      }
    };
    // Initialise the total display using the current values.
    updateReceiptTotal();
    container.appendChild(totalDiv);
    // Add row with button to add new item
    const addRow = document.createElement('tr');
    const addTd = document.createElement('td');
    // Calculate column span: default columns (4) + extraColumns + 1 (placeholder) + activePeople + delete column
    const activeCount = folder.people.filter(p => !p.excluded).length;
    const colSpan = 4 + receipt.extraColumns.length + 1 + activeCount + 1;
    addTd.colSpan = colSpan;
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Posten hinzufügen';
    addBtn.className = 'secondary-button';
    addBtn.addEventListener('click', () => {
      const newItem = { name: '', qty: 1, unitPrice: undefined, total: undefined, totalBase: undefined, extras: {}, assigned: {} };
      // initialize extras for existing extra columns
      receipt.extraColumns.forEach(col => {
        newItem.extras[col.id] = '';
      });
      receipt.items.push(newItem);
      saveData();
      renderReceipts();
    });
    addTd.appendChild(addBtn);
    addRow.appendChild(addTd);
    table.appendChild(addRow);
    container.appendChild(table);
    receiptsList.appendChild(container);
  });

  // After all receipts are rendered, restore the scroll position so that the
  // page does not jump to the top after editing an input. Skip this when
  // in share view, since share view is separate and does not use this
  // function.
  setTimeout(() => {
    if (!isShareView) {
      window.scrollTo(0, scrollYBefore);
    }
  }, 0);
}

// ======== Parser ========
function parseLine(line) {
  let normalized = line
    .replace(/€/g, '')
    // remove common thousands separators and unify decimal comma to dot
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  // Pattern: name qty x unitPrice total (e.g. "Milch 2 x 1.50 3.00")
  let m = normalized.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i);
  if (m) {
    const qty = parseFloat(m[2]);
    const unit = parseFloat(m[3]);
    const tot = parseFloat(m[4]);
    return {
      name: m[1],
      qty: qty,
      unitPrice: unit,
      total: tot
    };
  }
  // Pattern: name qty total (e.g. "Milch 2 3.50")
  m = normalized.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
  if (m) {
    const qty = parseFloat(m[2]);
    const price = parseFloat(m[3]);
    return {
      name: m[1],
      qty: qty,
      unitPrice: price / qty,
      total: price
    };
  }
  // Pattern: name x qty total (e.g. "Milch x 2 3.00")
  m = normalized.match(/^(.+?)\s+[x×]\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i);
  if (m) {
    const qty = parseFloat(m[2]);
    const totalVal = parseFloat(m[3]);
    return {
      name: m[1],
      qty: qty,
      unitPrice: totalVal / qty,
      total: totalVal
    };
  }
  // Pattern: name price (implicit qty = 1)
  m = normalized.match(/^(.+?)\s+(\d+(?:\.\d+)?)/);
  if (m) {
    const priceVal = parseFloat(m[2]);
    return {
      name: m[1],
      qty: 1,
      unitPrice: priceVal,
      total: priceVal
    };
  }
  return null;
}

// ======== Währungsumrechnung ========
// Fallback Wechselkurse relative zu EUR. Diese werden verwendet, falls keine externen Kurse verfügbar sind.
const DEFAULT_RATES = {
  EUR: 1.0,
  USD: 1.1,
  GBP: 0.85,
  CHF: 0.95,
  SEK: 11.0,
  JPY: 165.0
  ,
  ALL: 110.0
};

// Symbol-Lookup für Währungen
const CURRENCY_SYMBOLS = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  CHF: 'CHF',
  SEK: 'SEK',
  JPY: '¥'
  ,
  ALL: 'Lek'
};

/**
 * Holt den aktuellen Wechselkurs für die angegebene Währung im Verhältnis zum Euro.
 * Versucht erst einen Live-API-Aufruf; fällt sonst auf die DEFAULT_RATES zurück.
 * @param {string} code
 * @returns {Promise<number>}
 */
async function getRate(code) {
  if (code === 'EUR') return 1.0;
  try {
    const res = await fetch(`https://api.exchangerate.host/latest?base=EUR&symbols=${code}`);
    const json = await res.json();
    const val = json && json.rates && json.rates[code];
    if (val && !isNaN(val)) return val;
  } catch (e) {
    console.warn('Fehler beim Abrufen des Wechselkurses:', e);
  }
  return DEFAULT_RATES[code] || 1.0;
}

/**
 * Ändert die Währung eines Belegs und passt auf Wunsch bestehende Beträge an.
 * Speichert Datum und Kurs im Beleg.
 * @param {Object} receipt
 * @param {string} newCurrency
 */
async function changeReceiptCurrency(receipt, newCurrency) {
  const oldCurrency = receipt.currency || 'EUR';
  const oldRate = receipt.rate || DEFAULT_RATES[oldCurrency] || 1.0;
  const newRate = await getRate(newCurrency);
  // Frage den Benutzer, ob bestehende Werte umgerechnet werden sollen
  if (oldCurrency !== newCurrency) {
    if (receipt.items && receipt.items.length > 0) {
      const apply = confirm('Soll die neue Währung auf bestehende Positionen angewandt werden? OK = umrechnen, Abbrechen = nur künftig anwenden.');
      if (apply) {
        receipt.items.forEach(item => {
          // If we already have base amount, use it to compute new unit price and total
          if (typeof item.totalBase === 'number' && typeof item.qty === 'number' && item.qty !== 0) {
            const newUnit = (item.totalBase * newRate) / item.qty;
            item.unitPrice = newUnit;
            item.total = newUnit * item.qty;
          } else if (typeof item.unitPrice === 'number' && typeof item.qty === 'number') {
            // Compute base value from old rate
            const baseVal = (item.unitPrice * item.qty) / oldRate;
            item.totalBase = baseVal;
            const newUnit = (baseVal * newRate) / item.qty;
            item.unitPrice = newUnit;
            item.total = baseVal * newRate;
          } else if (typeof item.total === 'number' && typeof item.qty === 'number') {
            // If we only have total but not unit price, derive base from total
            const baseVal = item.total / oldRate;
            item.totalBase = baseVal;
            const newUnit = (baseVal * newRate) / item.qty;
            item.unitPrice = newUnit;
            item.total = baseVal * newRate;
          }
        });
      }
    }
  }
  receipt.currency = newCurrency;
  receipt.rate = newRate;
  receipt.rateDate = Date.now();
}

// ======== Gesamtabrechnung & Übersichtstabelle ========
computeAllButton.addEventListener('click', () => {
  const folder = getCurrentFolder();
  if (!folder) return;
  if (folder.people.length === 0) {
    resultsDiv.innerHTML = 'Bitte zuerst Personen hinzufügen.';
    summaryTableDiv.innerHTML = '';
    return;
  }
  // Determine active (non-excluded) persons and mapping to original indices
  const activeIndices = [];
  const activePeople = [];
  folder.people.forEach((p, idx) => {
    if (!p.excluded) {
      activeIndices.push(idx);
      activePeople.push(p);
    }
  });
  if (activeIndices.length === 0) {
    resultsDiv.innerHTML = 'Keine aktiven Personen vorhanden.';
    summaryTableDiv.innerHTML = '';
    return;
  }
  const n = activeIndices.length;
  const activeMap = {};
  activeIndices.forEach((origIdx, ai) => { activeMap[origIdx] = ai; });
  const totalOwe = new Array(n).fill(0);
  const debts = new Array(n).fill(0);
  const oweMatrix = Array.from({ length: n }, () => new Array(n).fill(0));
  // For each receipt compute share among active persons
  folder.receipts.forEach(receipt => {
    const sums = new Array(n).fill(0);
    receipt.items.forEach(item => {
      // Determine base value for item
      let baseVal;
      if (typeof item.totalBase === 'number') {
        baseVal = item.totalBase;
      } else if (typeof item.total === 'number' && receipt.rate) {
        baseVal = item.total / receipt.rate;
      } else if (typeof item.total === 'number') {
        baseVal = item.total;
      } else {
        baseVal = undefined;
      }
      if (!baseVal || isNaN(baseVal)) return;
      const selectedActive = [];
      for (const [pIndexStr, checked] of Object.entries(item.assigned || {})) {
        const origIdx = parseInt(pIndexStr);
        if (!checked) continue;
        // skip if excluded
        const person = folder.people[origIdx];
        if (person && person.excluded) continue;
        const ai = activeMap[origIdx];
        if (typeof ai === 'number') selectedActive.push(ai);
      }
      if (selectedActive.length > 0) {
        const shareBase = baseVal / selectedActive.length;
        selectedActive.forEach(ai => {
          sums[ai] += shareBase;
        });
      }
    });
    const totalSpentBase = sums.reduce((a,b) => a + b, 0);
    sums.forEach((val, ai) => {
      totalOwe[ai] += val;
      debts[ai] -= val;
    });
    const payerOrig = receipt.payer;
    if (typeof payerOrig === 'number' && !folder.people[payerOrig].excluded) {
      const payerAi = activeMap[payerOrig];
      if (typeof payerAi === 'number') {
        debts[payerAi] += totalSpentBase - sums[payerAi];
        // Build owe matrix: each active person owes payer
        sums.forEach((val, ai) => {
          if (ai !== payerAi) {
            oweMatrix[ai][payerAi] += val;
          }
        });
      }
    }
  });
  // Round totals
  const roundedOwe = totalOwe.map(v => Math.round(v * 100) / 100);
  // Display results
  resultsDiv.innerHTML = '';
  const h1 = document.createElement('h4');
  h1.textContent = 'Gesamtbeträge pro Person:';
  resultsDiv.appendChild(h1);
  // Determine base currency and symbol
  const currentUser = getCurrentUser();
  const baseCur = (currentUser && currentUser.settings && currentUser.settings.baseCurrency) || 'EUR';
  const sym = CURRENCY_SYMBOLS[baseCur] || baseCur;
  roundedOwe.forEach((val, ai) => {
    const div = document.createElement('div');
    const person = activePeople[ai];
    const personName = person && person.name ? person.name : person;
    div.textContent = `${personName}: ${val.toFixed(2)} ${sym}`;
    resultsDiv.appendChild(div);
  });
  const transfers = settleDebts(debts);
  if (transfers.length > 0) {
    const h2 = document.createElement('h4');
    h2.textContent = 'Ausgleichszahlungen:';
    resultsDiv.appendChild(h2);
    transfers.forEach(tr => {
      const div = document.createElement('div');
      const fromName = activePeople[tr.from] && activePeople[tr.from].name ? activePeople[tr.from].name : activePeople[tr.from];
      const toName = activePeople[tr.to] && activePeople[tr.to].name ? activePeople[tr.to].name : activePeople[tr.to];
      div.textContent = `${fromName} → ${toName}: ${tr.amount.toFixed(2)} ${sym}`;
      resultsDiv.appendChild(div);
    });
  }
  // Build summary table (who owes whom)
  summaryTableDiv.innerHTML = '';
  const table = document.createElement('table');
  const head = document.createElement('tr');
  head.appendChild(document.createElement('th'));
  activePeople.forEach(person => {
    const th = document.createElement('th');
    th.textContent = person && person.name ? person.name : person;
    head.appendChild(th);
  });
  table.appendChild(head);
  for (let i = 0; i < n; i++) {
    const row = document.createElement('tr');
    const rowHeader = document.createElement('th');
    const person = activePeople[i];
    rowHeader.textContent = person && person.name ? person.name : person;
    row.appendChild(rowHeader);
    for (let j = 0; j < n; j++) {
      const td = document.createElement('td');
      if (i === j) {
        td.textContent = '—';
      } else {
        const val = oweMatrix[i][j] || 0;
        td.textContent = val === 0 ? '' : `${val.toFixed(2)} ${sym}`;
      }
      row.appendChild(td);
    }
    table.appendChild(row);
  }
  summaryTableDiv.appendChild(table);
});

// ======== Schulden minimieren ========
function settleDebts(debts) {
  const transfers = [];
  const creditors = [];
  const debtors = [];
  debts.forEach((val, idx) => {
    if (val > 0.005) creditors.push({ idx, val });
    else if (val < -0.005) debtors.push({ idx, val: -val });
  });
  creditors.sort((a,b) => b.val - a.val);
  debtors.sort((a,b) => b.val - a.val);
  let ci=0, di=0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const pay = Math.min(c.val, d.val);
    transfers.push({ from: d.idx, to: c.idx, amount: Math.round(pay*100)/100 });
    c.val -= pay;
    d.val -= pay;
    if (c.val < 0.005) ci++;
    if (d.val < 0.005) di++;
  }
  return transfers;
}

// ======== Präferenzen Modal ========
function openPrefsModal() {
  const folder = getCurrentFolder();
  if (!folder) return;
  // Render preferences list
  prefsListDiv.innerHTML = '';
  folder.people.forEach((person, idx) => {
    const wrapper = document.createElement('div');
    const nameLabel = document.createElement('strong');
    nameLabel.textContent = person.name;
    wrapper.appendChild(nameLabel);
    const prefs = [
      { key: 'vegan', label: 'Vegan' },
      { key: 'noAlcohol', label: 'Kein Alkohol' },
      { key: 'noOlives', label: 'Keine Oliven' },
      { key: 'noNuts', label: 'Keine Nüsse' }
    ];
    prefs.forEach(p => {
      const lbl = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = person.prefs && person.prefs[p.key];
      cb.addEventListener('change', (e) => {
        if (!person.prefs) person.prefs = {};
        person.prefs[p.key] = e.target.checked;
      });
      const span = document.createElement('span');
      span.textContent = ' ' + p.label;
      lbl.appendChild(cb);
      lbl.appendChild(span);
      wrapper.appendChild(lbl);
    });
    prefsListDiv.appendChild(wrapper);
  });
  prefsModal.classList.remove('hidden');
}

function closePrefsModal() {
  prefsModal.classList.add('hidden');
  // Re-render receipts to reflect preference highlighting
  renderReceipts();
}

function savePrefsModal() {
  // Save is implicit because we bind changes directly
  saveData();
  prefsModal.classList.add('hidden');
  renderReceipts();
}

if (editPrefsButton) {
  editPrefsButton.addEventListener('click', openPrefsModal);
}
if (prefsCloseButton) {
  prefsCloseButton.addEventListener('click', closePrefsModal);
}
if (prefsSaveButton) {
  prefsSaveButton.addEventListener('click', savePrefsModal);
}

// ======== Einstellungen Modal ========
function openSettingsModal() {
  const user = getCurrentUser();
  if (!user) return;
  if (settingsLanguageSelect) settingsLanguageSelect.value = user.settings.language || 'de';
  settingsModal.classList.remove('hidden');
}
function closeSettingsModal() {
  settingsModal.classList.add('hidden');
}
async function saveSettingsModal() {
  const user = getCurrentUser();
  if (!user) return;
  // Language
  if (settingsLanguageSelect) {
    user.settings.language = settingsLanguageSelect.value;
  }
  // Change username if provided
  const newUserName = settingsNewUsername && settingsNewUsername.value.trim();
  if (newUserName && newUserName !== data.currentUser) {
    if (data.users[newUserName]) {
      alert('Benutzername existiert bereits.');
      return;
    }
    // Move user data
    data.users[newUserName] = data.users[data.currentUser];
    delete data.users[data.currentUser];
    // Update shared references in all folders
    Object.keys(data.users).forEach(uName => {
      const u = data.users[uName];
      if (u && u.folders) {
        Object.values(u.folders).forEach(f => {
          if (Array.isArray(f.sharedWith)) {
            f.sharedWith = f.sharedWith.map(sw => sw === data.currentUser ? newUserName : sw);
          }
        });
      }
    });
    data.currentUser = newUserName;
  }
  // Change password if provided
  const newPw = settingsNewPassword && settingsNewPassword.value;
  if (newPw) {
    const hash = await hashPassword(newPw);
    const curUser = getCurrentUser();
    if (curUser) {
      curUser.passwordHash = hash;
    }
  }
  // Clear input fields
  if (settingsNewUsername) settingsNewUsername.value = '';
  if (settingsNewPassword) settingsNewPassword.value = '';
  user.settings.showWizard = false; // disable wizard after settings save
  saveData();
  applyTranslations();
  settingsModal.classList.add('hidden');
  renderFolders();
  renderPeople();
  renderReceipts();
}
if (settingsButton) settingsButton.addEventListener('click', openSettingsModal);
if (settingsCloseButton) settingsCloseButton.addEventListener('click', closeSettingsModal);
if (settingsSaveButton) settingsSaveButton.addEventListener('click', saveSettingsModal);

// ======== Teilen Modal ========
function openShareModal() {
  const folder = getCurrentFolder();
  const user = getCurrentUser();
  if (!folder || !user) return;
  // Build list of users to share with
  shareUsersList.innerHTML = '';
  Object.keys(data.users).forEach(username => {
    if (username === data.currentUser) return;
    const row = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = username;
    cb.checked = folder.sharedWith && folder.sharedWith.includes(username);
    const span = document.createElement('span');
    span.textContent = ' ' + username;
    row.appendChild(cb);
    row.appendChild(span);
    shareUsersList.appendChild(row);
  });
  shareModal.classList.remove('hidden');
}
function saveShareModal() {
  const folder = getCurrentFolder();
  if (!folder) return;
  const checkedUsers = [];
  shareUsersList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (cb.checked) checkedUsers.push(cb.value);
  });
  folder.sharedWith = checkedUsers;
  saveData();
  shareModal.classList.add('hidden');
}
function closeShareModal() {
  shareModal.classList.add('hidden');
}
if (shareFolderButton) shareFolderButton.addEventListener('click', openShareModal);
if (shareSaveButton) shareSaveButton.addEventListener('click', saveShareModal);
if (shareCloseButton) shareCloseButton.addEventListener('click', closeShareModal);

// ======== PDF Export ========
async function exportAllPdf() {
  const folder = getCurrentFolder();
  if (!folder) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 10;
  doc.setFontSize(14);
  doc.text('Kassenbon‑Splitter – Alle Details', 10, y);
  y += 10;
  // For each receipt, list items
  folder.receipts.forEach((receipt, ridx) => {
    doc.setFontSize(12);
    doc.text(`${receipt.name} (${receipt.currency})`, 10, y);
    y += 6;
    // header row: Artikel, Menge, Einzelpreis, Gesamt, ...extra columns..., Zugewiesen an
    const headerRow = ['Artikel', 'Menge', `Einzelpreis (${receipt.currency})`, `Gesamt (${receipt.currency})`];
    receipt.extraColumns.forEach(col => headerRow.push(col.name));
    headerRow.push('Zugewiesen an');
    doc.setFontSize(10);
    doc.text(headerRow.join(' | '), 10, y);
    y += 5;
    // each item
    receipt.items.forEach(item => {
      const assigned = [];
      Object.entries(item.assigned || {}).forEach(([idx, checked]) => {
        if (checked) {
          const p = folder.people[idx];
          assigned.push(p.name || p);
        }
      });
      // Determine unit price and total per item
      let unitCur;
      let totalCur;
      if (typeof item.unitPrice === 'number') {
        unitCur = item.unitPrice;
        totalCur = item.unitPrice * (item.qty || 0);
      } else if (typeof item.totalBase === 'number') {
        totalCur = item.totalBase * receipt.rate;
        unitCur = (totalCur / (item.qty || 1));
      } else if (typeof item.total === 'number') {
        totalCur = item.total;
        unitCur = totalCur / (item.qty || 1);
      }
      const rowArr = [
        item.name,
        String(item.qty),
        unitCur !== undefined ? unitCur.toFixed(2) : '',
        totalCur !== undefined ? totalCur.toFixed(2) : ''
      ];
      receipt.extraColumns.forEach(col => {
        rowArr.push(item.extras && item.extras[col.id] ? String(item.extras[col.id]) : '');
      });
      rowArr.push(assigned.join(', '));
      doc.text(rowArr.join(' | '), 10, y);
      y += 5;
      // check for page overflow
      if (y > 280) {
        doc.addPage();
        y = 10;
      }
    });
    y += 5;
    if (y > 280) {
      doc.addPage();
      y = 10;
    }
  });
  doc.save('kassenbons_details.pdf');
}

async function exportSummaryPdf() {
  // Compute settlement to ensure oweMatrix, totals, etc.
  computeAllButton.click();
  const folder = getCurrentFolder();
  if (!folder) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 10;
  doc.setFontSize(14);
  doc.text('Kassenbon‑Splitter – Zusammenfassung', 10, y);
  y += 10;
  // Bestimme aktive Personen
  const activeIndices = [];
  const activePeople = [];
  folder.people.forEach((p, idx) => {
    if (!p.excluded) {
      activeIndices.push(idx);
      activePeople.push(p);
    }
  });
  if (activeIndices.length === 0) {
    doc.setFontSize(12);
    doc.text('Keine aktiven Personen vorhanden.', 10, y);
    doc.save('abrechnung_zusammenfassung.pdf');
    return;
  }
  const n = activeIndices.length;
  const activeMap = {};
  activeIndices.forEach((origIdx, ai) => { activeMap[origIdx] = ai; });
  // Gesamtbeträge pro Person
  doc.setFontSize(12);
  doc.text('Gesamtbeträge pro Person:', 10, y);
  y += 6;
  const currentUser = getCurrentUser();
  const baseCur = (currentUser && currentUser.settings && currentUser.settings.baseCurrency) || 'EUR';
  const sym = CURRENCY_SYMBOLS[baseCur] || baseCur;
  const totalOwe = new Array(n).fill(0);
  folder.receipts.forEach(receipt => {
    receipt.items.forEach(item => {
      let baseVal;
      if (typeof item.totalBase === 'number') baseVal = item.totalBase;
      else if (typeof item.total === 'number' && receipt.rate) baseVal = item.total / receipt.rate;
      else if (typeof item.total === 'number') baseVal = item.total;
      else baseVal = undefined;
      if (!baseVal || isNaN(baseVal)) return;
      const selectedActive = [];
      for (const [pIndex, checked] of Object.entries(item.assigned || {})) {
        if (!checked) continue;
        const origIdx = parseInt(pIndex);
        if (folder.people[origIdx] && folder.people[origIdx].excluded) continue;
        const ai = activeMap[origIdx];
        if (typeof ai === 'number') selectedActive.push(ai);
      }
      if (selectedActive.length > 0) {
        const shareBase = baseVal / selectedActive.length;
        selectedActive.forEach(ai => {
          totalOwe[ai] += shareBase;
        });
      }
    });
  });
  totalOwe.forEach((val, ai) => {
    const personName = activePeople[ai] && activePeople[ai].name ? activePeople[ai].name : activePeople[ai];
    doc.text(`${personName}: ${val.toFixed(2)} ${sym}`, 10, y);
    y += 5;
    if (y > 280) {
      doc.addPage();
      y = 10;
    }
  });
  y += 6;
  // Ausgleichszahlungen
  const debts = new Array(n).fill(0);
  folder.receipts.forEach(receipt => {
    const sums = new Array(n).fill(0);
    receipt.items.forEach(item => {
      let baseVal;
      if (typeof item.totalBase === 'number') baseVal = item.totalBase;
      else if (typeof item.total === 'number' && receipt.rate) baseVal = item.total / receipt.rate;
      else if (typeof item.total === 'number') baseVal = item.total;
      else baseVal = undefined;
      if (!baseVal || isNaN(baseVal)) return;
      const selectedActive = [];
      for (const [pIndex, checked] of Object.entries(item.assigned || {})) {
        if (!checked) continue;
        const origIdx = parseInt(pIndex);
        if (folder.people[origIdx] && folder.people[origIdx].excluded) continue;
        const ai = activeMap[origIdx];
        if (typeof ai === 'number') selectedActive.push(ai);
      }
      if (selectedActive.length > 0) {
        const shareBase = baseVal / selectedActive.length;
        selectedActive.forEach(ai => {
          sums[ai] += shareBase;
        });
      }
    });
    const totalSpentBase = sums.reduce((a,b) => a + b, 0);
    sums.forEach((val, ai) => {
      debts[ai] -= val;
    });
    const payerOrig = receipt.payer;
    if (typeof payerOrig === 'number' && !folder.people[payerOrig].excluded) {
      const payerAi = activeMap[payerOrig];
      if (typeof payerAi === 'number') {
        debts[payerAi] += totalSpentBase - sums[payerAi];
      }
    }
  });
  const transfers = settleDebts(debts);
  if (transfers.length > 0) {
    doc.setFontSize(12);
    doc.text('Ausgleichszahlungen:', 10, y);
    y += 6;
    transfers.forEach(tr => {
      const fromName = activePeople[tr.from] && activePeople[tr.from].name ? activePeople[tr.from].name : activePeople[tr.from];
      const toName = activePeople[tr.to] && activePeople[tr.to].name ? activePeople[tr.to].name : activePeople[tr.to];
      doc.text(`${fromName} → ${toName}: ${tr.amount.toFixed(2)} ${sym}`, 10, y);
      y += 5;
      if (y > 280) {
        doc.addPage();
        y = 10;
      }
    });
  }
  doc.save('abrechnung_zusammenfassung.pdf');
}

if (exportAllButton) exportAllButton.addEventListener('click', exportAllPdf);
if (exportSummaryButton) exportSummaryButton.addEventListener('click', exportSummaryPdf);

// ======== Neuer Kassenbon ohne Upload ========
if (createReceiptButton) {
  createReceiptButton.addEventListener('click', async () => {
    const folder = getCurrentFolder();
    if (!folder) {
      uploadInfo.textContent = 'Bitte zuerst einen Ordner auswählen oder erstellen.';
      return;
    }
    let name = prompt('Name des neuen Bons:');
    if (name === null) return; // cancelled
    name = name && name.trim() ? name.trim() : 'Neuer Bon';
    // Determine currency from user settings or default
    const user = getCurrentUser();
    const currency = (user && user.settings && user.settings.baseCurrency) || 'EUR';
    const rate = await getRate(currency);
    const receipt = {
      id: Date.now().toString(),
      name: name,
      payer: folder.people.length > 0 ? 0 : -1,
      items: [],
      extraColumns: [],
      currency: currency,
      rate: rate,
      rateDate: Date.now(),
      hidden: false
    };
    folder.receipts.push(receipt);
    saveData();
    renderReceipts();
  });
}

// ======== Floating button: insert a new receipt below the currently selected one ========
if (floatingAddReceiptButton) {
  floatingAddReceiptButton.addEventListener('click', async () => {
    const folder = getCurrentFolder();
    if (!folder) {
      alert('Bitte zuerst einen Ordner auswählen oder erstellen.');
      return;
    }
    let name = prompt('Name des neuen Bons:');
    if (name === null) return;
    name = name && name.trim() ? name.trim() : 'Neuer Bon';
    // Determine currency from user settings or default
    const user = getCurrentUser();
    const currency = (user && user.settings && user.settings.baseCurrency) || 'EUR';
    const rate = await getRate(currency);
    const receipt = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      name: name,
      payer: folder.people.length > 0 ? 0 : -1,
      items: [],
      extraColumns: [],
      currency: currency,
      rate: rate,
      rateDate: Date.now(),
      hidden: false
    };
    // Determine insertion index: insert after the currently edited receipt if valid
    let idx = currentEditedReceiptIndex;
    if (idx === -1 || idx >= folder.receipts.length) {
      // Append at end if no valid index
      folder.receipts.push(receipt);
    } else {
      folder.receipts.splice(idx + 1, 0, receipt);
    }
    saveData();
    renderReceipts();
  });
}

// ======== Folder level share: generate link for entire folder ========
/*
 * The original folder sharing implementation used prompts for selecting
 * a folder and copying a link. This logic has been replaced by a
 * more intuitive two‑step flow using modals. The old event handler is
 * disabled here to prevent duplicate prompt dialogs and conflicting
 * behaviour. See the new logic further below (folderLinkModal and
 * copyLinkModal) for the replacement implementation.
 */
if (false && linkFolderShareButton) {
  linkFolderShareButton.addEventListener('click', () => {
    // original prompt‑based sharing logic has been disabled
  });
}

// ======== Onboarding Wizard ========
let wizardStep = 0;
const wizardSteps = [
  {
    title: 'Willkommen!',
    content: 'Dies ist der Kassenbon‑Splitter. Erstelle zunächst einen Ordner (z. B. für deine WG oder Reise).',
    action: () => {}
  },
  {
    title: 'Personen hinzufügen',
    content: 'Füge die Personen hinzu, die an der Abrechnung beteiligt sein sollen.',
    action: () => {}
  },
  {
    title: 'Bon hochladen',
    content: 'Lade nun einen Kassenbon hoch. Die Posten werden automatisch erkannt.',
    action: () => {}
  },
  {
    title: 'Zuordnen',
    content: 'Weise jedem Posten die Personen zu, die ihn bezahlt haben oder davon profitiert haben.',
    action: () => {}
  },
  {
    title: 'Abrechnung',
    content: 'Berechne nun die Abrechnung und exportiere sie als PDF.',
    action: () => {}
  }
];

function startWizard() {
  wizardStep = 0;
  showWizardStep();
}
function showWizardStep() {
  const user = getCurrentUser();
  if (!user) return;
  if (!user.settings.showWizard) return;
  const step = wizardSteps[wizardStep];
  if (!step) {
    // finish wizard
    user.settings.showWizard = false;
    saveData();
    wizardModal.classList.add('hidden');
    return;
  }
  wizardContent.innerHTML = '';
  const titleEl = document.createElement('h4');
  titleEl.textContent = step.title;
  wizardContent.appendChild(titleEl);
  const p = document.createElement('p');
  p.textContent = step.content;
  wizardContent.appendChild(p);
  wizardModal.classList.remove('hidden');
}
if (wizardNextButton) {
  wizardNextButton.addEventListener('click', () => {
    wizardStep++;
    showWizardStep();
  });
}
if (wizardSkipButton) {
  wizardSkipButton.addEventListener('click', () => {
    const user = getCurrentUser();
    if (user) {
      user.settings.showWizard = false;
      saveData();
    }
    wizardModal.classList.add('hidden');
  });
}

// ======== Anleitung Modal ========
function openInstructionsModal() {
  const user = getCurrentUser();
  const lang = (user && user.settings && user.settings.language) || 'de';
  instructionsContent.innerHTML = '';
  const ul = document.createElement('ul');
  if (lang === 'en') {
    const steps = [
      'Create a folder for your group or trip.',
      'Add people who will participate in the receipts.',
      'Upload a receipt image or manually create a blank receipt.',
      'Edit each item: name, quantity (integer only) and amount. Assign people to items.',
      'Add or remove custom columns to store extra information (e.g. category).',
      'Choose the currency per receipt; exchange rates are fetched automatically.',
      'Use the preferences to mark people as vegan, no alcohol, no olives or no nuts; warnings appear on mismatches.',
      'Exclude or include people via the badge toggle if they no longer participate.',
      'Reorder receipts using the arrows, rename or delete them via the action buttons.',
      'Compute the settlement to see how much each person owes and the suggested transfers.',
      'Export the full details or summary as a PDF.',
      'Share folders with other accounts or move receipts to another folder.',
      'Change your username, password and language in the settings.'
    ];
    steps.forEach(s => {
      const li = document.createElement('li');
      li.textContent = s;
      ul.appendChild(li);
    });
  } else {
    const steps = [
      'Lege einen Ordner für deine Gruppe oder Reise an.',
      'Füge die Personen hinzu, die an den Bons beteiligt sind.',
      'Lade einen Kassenbon hoch oder erstelle einen leeren Bon manuell.',
      'Bearbeite jeden Posten: Name, Menge (nur ganze Zahlen) und Betrag. Ordne die Personen zu.',
      'Füge nach Bedarf eigene Spalten hinzu oder entferne sie (z.B. Kategorie).',
      'Wähle pro Bon die Währung; der Wechselkurs wird automatisch geholt.',
      'Nutze die Präferenzen, um Personen als vegan, ohne Alkohol, ohne Oliven oder ohne Nüsse zu markieren; Warnungen erscheinen bei Unstimmigkeiten.',
      'Schließe Personen über den Badge‑Schalter aus oder füge sie wieder hinzu, wenn sie nicht mehr beteiligt sind.',
      'Ordne Bons über die Pfeile neu an, benenne sie um oder lösche sie über die Aktionsknöpfe.',
      'Berechne die Abrechnung, um zu sehen, wie viel jeder schuldet und welche Ausgleichszahlungen vorgeschlagen werden.',
      'Exportiere alle Details oder nur die Zusammenfassung als PDF.',
      'Teile Ordner mit anderen Konten oder verschiebe Bons in einen anderen Ordner.',
      'Ändere deinen Benutzernamen, dein Passwort und die Sprache in den Einstellungen.'
    ];
    steps.forEach(s => {
      const li = document.createElement('li');
      li.textContent = s;
      ul.appendChild(li);
    });
  }
  instructionsContent.appendChild(ul);
  instructionsModal.classList.remove('hidden');
}

if (showInstructionsButton) {
  showInstructionsButton.addEventListener('click', () => {
    openInstructionsModal();
  });
}
if (instructionsCloseButton) {
  instructionsCloseButton.addEventListener('click', () => {
    instructionsModal.classList.add('hidden');
  });
}

// ======== Pending changes storage and helper functions ========
// These functions provide a lightweight way to store and retrieve
// assignments made by friends in share view. Pending changes are kept
// separate from the main data until the owner chooses to apply them.

/**
 * Retrieves the map of pending modifications from localStorage. This map
 * has the structure { ownerUsername: { receiptId: [ { itemIndex,
 * personIndex, assigned } ] } }.
 * @returns {Object}
 */
function getPendingMap() {
  try {
    const stored = localStorage.getItem('receiptSplitterPending');
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Persists the pending modifications map to localStorage.
 * @param {Object} map
 */
function savePendingMap(map) {
  try {
    localStorage.setItem('receiptSplitterPending', JSON.stringify(map));
  } catch (e) {
    console.error('Konnte Pending-Map nicht speichern:', e);
  }
}

/**
 * Stores pending changes for a given owner and receipt. Existing changes
 * for that receipt will be overwritten.
 * @param {string} owner
 * @param {string} receiptId
 * @param {Array} changes
 */
function addPendingChange(owner, receiptId, changes) {
  const map = getPendingMap();
  if (!map[owner]) map[owner] = {};
  map[owner][receiptId] = changes;
  savePendingMap(map);
}

/**
 * Returns the pending change list for a receipt, or null if none exist.
 * @param {string} owner
 * @param {string} receiptId
 * @returns {Array|null}
 */
function getPendingChangesForReceipt(owner, receiptId) {
  const map = getPendingMap();
  return map[owner] && map[owner][receiptId] ? map[owner][receiptId] : null;
}

/**
 * Removes pending changes for a given owner and receipt.
 * @param {string} owner
 * @param {string} receiptId
 */
function discardPendingChanges(owner, receiptId) {
  const map = getPendingMap();
  if (map[owner] && map[owner][receiptId]) {
    delete map[owner][receiptId];
    if (Object.keys(map[owner]).length === 0) {
      delete map[owner];
    }
    savePendingMap(map);
  }
}

/**
 * Applies pending changes to the owner’s receipt data. Each change entry
 * specifies a line item and the person whose assignment should be toggled.
 * After application, the pending entry is removed.
 * @param {string} owner
 * @param {string} folderId
 * @param {string} receiptId
 */
function applyPendingChanges(owner, folderId, receiptId) {
  const changes = getPendingChangesForReceipt(owner, receiptId);
  if (!changes) return;
  const ownerData = data.users[owner];
  if (!ownerData) return;
  const folder = ownerData.folders[folderId];
  if (!folder) return;
  const rec = folder.receipts.find(r => r.id === receiptId);
  if (!rec) return;
  changes.forEach(change => {
    const { itemIndex, personIndex, assigned } = change;
    if (!rec.items[itemIndex]) return;
    if (!rec.items[itemIndex].assigned) rec.items[itemIndex].assigned = {};
    rec.items[itemIndex].assigned[personIndex] = assigned;
  });
  discardPendingChanges(owner, receiptId);
  saveData();
}

/**
 * Encodes share data into a base64 string. This helper is used to
 * generate share links containing the information needed to reconstruct
 * a receipt in share view.
 * @param {string} owner
 * @param {string} folderId
 * @param {string} receiptId
 * @returns {string}
 */
/**
 * Encodes data needed to share a receipt or an entire folder into a base64 token.
 * The format depends on whether a specific receipt is shared or the whole
 * folder. For backward compatibility, if receiptId is not provided or
 * older logic is desired, the function can still return a simple
 * pipe‑separated string. In the new snapshot format, the token is a
 * base64‑encoded JSON object containing all necessary data so that
 * the share link can be opened without the owner’s account existing on
 * the recipient’s machine. The snapshot includes the owner name to
 * allow pending modifications to be keyed properly, but no other user
 * data is required to view the receipt or folder.
 *
 * @param {string} owner        The username of the owner creating the link.
 * @param {string} folderId     The ID of the folder being shared.
 * @param {string} receiptId    The ID of the receipt to share, or 'folder'
 *                              to share the whole folder. If undefined,
 *                              defaults to sharing the folder.
 * @returns {string}            A base64 encoded token representing the share.
 */
function encodeShareData(owner, folderId, receiptId) {
  // Load latest data to ensure snapshots reflect current state
  loadData();
  migrateData();
  const ownerData = data.users[owner];
  if (!ownerData) {
    // Fallback to old behaviour if owner data is missing
    return btoa(`${owner}|${folderId}|${receiptId}`);
  }
  const folder = ownerData.folders[folderId];
  if (!folder) {
    return btoa(`${owner}|${folderId}|${receiptId}`);
  }
  // When sharing an entire folder, include all receipts and people in the snapshot
  if (receiptId === 'folder' || typeof receiptId === 'undefined') {
    const snapshot = {
      type: 'folder',
      owner: owner,
      folderId: folderId,
      folderName: folder.name,
      people: folder.people.map(p => ({ name: p.name, prefs: p.prefs || {} })),
      receipts: folder.receipts.map(r => {
        return {
          id: r.id,
          name: r.name,
          payer: r.payer,
          currency: r.currency,
          rate: r.rate,
          rateDate: r.rateDate,
          extraColumns: r.extraColumns ? JSON.parse(JSON.stringify(r.extraColumns)) : [],
          items: r.items.map(it => {
            return {
              name: it.name,
              qty: it.qty,
              unitPrice: it.unitPrice,
              total: it.total,
              extras: it.extras ? JSON.parse(JSON.stringify(it.extras)) : {},
              assigned: it.assigned ? it.assigned.slice() : undefined
            };
          })
        };
      })
    };
    return btoa(JSON.stringify(snapshot));
  }
  // Sharing a single receipt: include the specific receipt and people
  const receipt = folder.receipts.find(r => r.id === receiptId);
  if (!receipt) {
    return btoa(`${owner}|${folderId}|${receiptId}`);
  }
  const snapshot = {
    type: 'receipt',
    owner: owner,
    folderId: folderId,
    receiptId: receiptId,
    receipt: {
      id: receipt.id,
      name: receipt.name,
      payer: receipt.payer,
      currency: receipt.currency,
      rate: receipt.rate,
      rateDate: receipt.rateDate,
      extraColumns: receipt.extraColumns ? JSON.parse(JSON.stringify(receipt.extraColumns)) : [],
      items: receipt.items.map(it => {
        return {
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice,
          total: it.total,
          extras: it.extras ? JSON.parse(JSON.stringify(it.extras)) : {},
          assigned: it.assigned ? it.assigned.slice() : undefined
        };
      })
    },
    people: folder.people.map(p => ({ name: p.name, prefs: p.prefs || {} }))
  };
  return btoa(JSON.stringify(snapshot));
}

/**
 * Decodes a base64 share token back into its component parts. Returns
 * null if decoding fails or the expected structure is not present.
 * @param {string} token
 * @returns {Object|null}
 */
function decodeShareData(token) {
  try {
    const decoded = atob(token);
    // New format: JSON snapshot begins with '{'.
    if (decoded && decoded.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(decoded);
        return obj;
      } catch (e) {
        // fall through to old format
      }
    }
    // Old format: pipe‑separated owner|folderId|receiptId
    const parts = decoded.split('|');
    if (parts.length === 3) {
      return { owner: parts[0], folderId: parts[1], receiptId: parts[2] };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Loads a receipt in share view based on the provided token. In share
 * view, the normal application UI is hidden and instead a simplified
 * interface appears allowing a friend to select their name and assign
 * themselves to items. Changes are saved as pending modifications
 * awaiting confirmation by the owner.
 * @param {string} token
 */
function loadShareView(token) {
  isShareView = true;
  const info = decodeShareData(token);
  if (!info) {
    alert('Ungültiger oder beschädigter Link.');
    return;
  }
  // If the info object contains a "type" property, this is a JSON snapshot
  // created by the new share mechanism. Delegate handling to snapshot
  // specific functions. If no type is present, fall back to the old logic
  // using owner/folderId/receiptId references.
  if (info && typeof info === 'object' && info.type) {
    if (info.type === 'folder') {
      loadFolderSnapshotView(info);
      return;
    }
    if (info.type === 'receipt') {
      loadReceiptSnapshotView(info);
      return;
    }
    // Unknown type
    alert('Unbekannter Freigabetyp.');
    return;
  }
  const { owner, folderId, receiptId } = info;
  // If the token encodes a folder rather than a specific receipt, load
  // the folder share interface. In this mode, friends can assign
  // themselves to items across all receipts in the folder.
  if (receiptId === 'folder') {
    loadFolderShareView(owner, folderId);
    return;
  }
  // Hide existing UI sections if present
  if (authSection) authSection.classList.add('hidden');
  if (appSection) appSection.classList.add('hidden');
  // Remove any existing share container
  const prev = document.getElementById('share-view');
  if (prev) prev.remove();
  // Load latest data
  loadData();
  migrateData();
  const ownerData = data.users[owner];
  if (!ownerData) {
    alert('Der Eigentümer des Bons wurde nicht gefunden.');
    return;
  }
  const folder = ownerData.folders[folderId];
  if (!folder) {
    alert('Der Ordner wurde nicht gefunden.');
    return;
  }
  const receipt = folder.receipts.find(r => r.id === receiptId);
  if (!receipt) {
    alert('Der Kassenbon wurde nicht gefunden.');
    return;
  }
  // Build share interface
  const container = document.createElement('div');
  container.id = 'share-view';
  container.style.padding = '1rem';
  container.style.maxWidth = '900px';
  container.style.margin = '0 auto';
  // Heading
  const heading = document.createElement('h3');
  heading.textContent = 'Kassenbon teilen: ' + receipt.name;
  container.appendChild(heading);
  // Person selection
  const lbl = document.createElement('label');
  lbl.textContent = 'Ich bin: ';
  const sel = document.createElement('select');
  folder.people.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  lbl.appendChild(sel);
  container.appendChild(lbl);
  // Table
  const table = document.createElement('table');
  // Helper to build table rows based on selected person
  let currentAssignments = [];
  function rebuildTable(selectedIdx) {
    table.innerHTML = '';
    const headerRow = document.createElement('tr');
    ['Artikel','Menge','Einzelpreis','Gesamt','Ich'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    table.appendChild(headerRow);
    receipt.items.forEach((it, i) => {
      const row = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = it.name;
      row.appendChild(tdName);
      const tdQty = document.createElement('td');
      tdQty.textContent = typeof it.qty === 'number' ? it.qty.toString() : '';
      row.appendChild(tdQty);
      const tdUnit = document.createElement('td');
      tdUnit.textContent = typeof it.unitPrice === 'number' ? it.unitPrice.toFixed(2) : '';
      row.appendChild(tdUnit);
      const tdTotal = document.createElement('td');
      let totalVal;
      if (typeof it.unitPrice === 'number' && typeof it.qty === 'number') {
        totalVal = it.unitPrice * it.qty;
      } else if (typeof it.total === 'number') {
        totalVal = it.total;
      }
      tdTotal.textContent = totalVal !== undefined ? totalVal.toFixed(2) : '';
      row.appendChild(tdTotal);
      const tdCheck = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      const original = it.assigned && typeof it.assigned[selectedIdx] !== 'undefined' ? !!it.assigned[selectedIdx] : false;
      cb.checked = currentAssignments[i] !== undefined ? currentAssignments[i] : original;
      cb.addEventListener('change', (ev) => {
        currentAssignments[i] = ev.target.checked;
      });
      tdCheck.appendChild(cb);
      row.appendChild(tdCheck);
      table.appendChild(row);
    });
  }
  // Initial build
  rebuildTable(parseInt(sel.value));
  sel.addEventListener('change', () => {
    currentAssignments = [];
    rebuildTable(parseInt(sel.value));
  });
  container.appendChild(table);
  // Submit button
  const submit = document.createElement('button');
  submit.textContent = 'Änderungen speichern';
  submit.className = 'secondary-button';
  submit.style.marginTop = '1rem';
  submit.addEventListener('click', () => {
    const selIdx = parseInt(sel.value);
    const pending = [];
    receipt.items.forEach((it, idx) => {
      const orig = it.assigned && typeof it.assigned[selIdx] !== 'undefined' ? !!it.assigned[selIdx] : false;
      const newVal = currentAssignments[idx] !== undefined ? !!currentAssignments[idx] : orig;
      if (newVal !== orig) {
        pending.push({ itemIndex: idx, personIndex: selIdx, assigned: newVal });
      }
    });
    if (pending.length === 0) {
      alert('Keine Änderungen vorgenommen.');
      return;
    }
    addPendingChange(owner, receiptId, pending);
    alert('Danke! Deine Änderungen wurden gespeichert. Sie müssen noch bestätigt werden.');
    submit.disabled = true;
  });
  container.appendChild(submit);
  document.body.appendChild(container);
}

// ======== Improved folder sharing flow ========
// This block overrides the default folder-link behaviour to provide a
// simple two-step share process: first select a folder via buttons,
// then confirm copying the generated link. The handler is attached in
// capture phase to prevent the previous click listener from firing.
/*
 * Disable the capturing‑phase click handler for linkFolderShareButton.
 * This handler was part of an earlier implementation and is now
 * superseded by the cloned button handler below. Keeping both
 * handlers leads to duplicate or inconsistent behaviour, so we
 * explicitly disable the old handler by wrapping it in an always‑false
 * condition.
 */
if (false && typeof linkFolderShareButton !== 'undefined' && linkFolderShareButton) {
  linkFolderShareButton.addEventListener('click', function(event) {
    // disabled
  }, true);
}

// Delegated click handler for folder selection and link generation
if (typeof folderLinkList !== 'undefined' && folderLinkList) {
  folderLinkList.addEventListener('click', function(event) {
    const target = event.target;
    if (target && target.tagName === 'BUTTON' && target.dataset.folderId) {
      const folderId = target.dataset.folderId;
      const token = encodeShareData(data.currentUser, folderId, 'folder');
      const baseHref = window.location.href.split('?')[0];
      let indexUrl;
      const lower = baseHref.toLowerCase();
      if (lower.endsWith('index.html')) {
        indexUrl = baseHref;
      } else if (baseHref.endsWith('/')) {
        indexUrl = baseHref + 'index.html';
      } else {
        indexUrl = baseHref + '/index.html';
      }
      const url = indexUrl + '?share=' + encodeURIComponent(token);
      pendingShareUrl = url;
      if (typeof copyLinkText !== 'undefined' && copyLinkText) {
        copyLinkText.textContent = url;
      }
      if (typeof folderLinkModal !== 'undefined' && folderLinkModal) {
        folderLinkModal.classList.add('hidden');
      }
      if (typeof copyLinkModal !== 'undefined' && copyLinkModal) {
        copyLinkModal.classList.remove('hidden');
      }
    }
  });
}

// Replace the existing folder share button with a cloned version that has
// only our custom click handler. This removes any previously attached
// event listeners from earlier code. Clicking the new button brings up
// the folder selection modal and initiates the improved share flow.
if (typeof linkFolderShareButton !== 'undefined' && linkFolderShareButton) {
  const origBtn = linkFolderShareButton;
  const clonedBtn = origBtn.cloneNode(true);
  origBtn.parentNode.replaceChild(clonedBtn, origBtn);
  clonedBtn.addEventListener('click', function(event) {
    event.preventDefault();
    const user = getCurrentUser();
    if (!user) return;
    const folders = [];
    for (const id in user.folders) {
      if (Object.prototype.hasOwnProperty.call(user.folders, id)) {
        const f = user.folders[id];
        folders.push({ id: id, name: f.name });
      }
    }
    if (folders.length === 0) {
      alert('Es gibt keine eigenen Ordner.');
      return;
    }
    if (typeof folderLinkList !== 'undefined' && folderLinkList) {
      folderLinkList.innerHTML = '';
      folders.forEach(({ id, name }) => {
        const btn = document.createElement('button');
        btn.textContent = name;
        btn.className = 'secondary-button';
        btn.dataset.folderId = id;
        folderLinkList.appendChild(btn);
      });
    }
    if (typeof folderLinkModal !== 'undefined' && folderLinkModal) {
      folderLinkModal.classList.remove('hidden');
    }
  });
}

// Cancel button for folder selection: simply hide the modal
if (typeof folderLinkCancel !== 'undefined' && folderLinkCancel) {
  folderLinkCancel.addEventListener('click', () => {
    if (typeof folderLinkModal !== 'undefined' && folderLinkModal) {
      folderLinkModal.classList.add('hidden');
    }
  });
}

// Cancel button in copy link modal: hide without copying
if (typeof copyLinkCancel !== 'undefined' && copyLinkCancel) {
  copyLinkCancel.addEventListener('click', () => {
    if (typeof copyLinkModal !== 'undefined' && copyLinkModal) {
      copyLinkModal.classList.add('hidden');
    }
    pendingShareUrl = null;
  });
}

// Confirm button in copy link modal: copy the link and hide
if (typeof copyLinkConfirm !== 'undefined' && copyLinkConfirm) {
  copyLinkConfirm.addEventListener('click', () => {
    if (pendingShareUrl) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pendingShareUrl).catch(() => {});
      }
    }
    if (typeof copyLinkModal !== 'undefined' && copyLinkModal) {
      copyLinkModal.classList.add('hidden');
    }
    pendingShareUrl = null;
    alert('Link kopiert!');
  });
}

/**
 * Loads a folder in share view. This mode allows a friend to select their
 * name and assign themselves to items across all receipts within the
 * specified folder. Pending modifications are stored per receipt and
 * highlighted for the owner until they are confirmed.
 * @param {string} owner
 * @param {string} folderId
 */
function loadFolderShareView(owner, folderId) {
  isShareView = true;
  // Hide normal UI sections
  if (authSection) authSection.classList.add('hidden');
  if (appSection) appSection.classList.add('hidden');
  // Remove any existing share view
  const prev = document.getElementById('share-view');
  if (prev) prev.remove();
  // Ensure latest data is loaded
  loadData();
  migrateData();
  const ownerData = data.users[owner];
  if (!ownerData) {
    alert('Der Eigentümer des Ordners wurde nicht gefunden.');
    return;
  }
  const folder = ownerData.folders[folderId];
  if (!folder) {
    alert('Der Ordner wurde nicht gefunden.');
    return;
  }
  // Build the share interface
  const container = document.createElement('div');
  container.id = 'share-view';
  container.style.padding = '1rem';
  container.style.maxWidth = '900px';
  container.style.margin = '0 auto';
  // Heading
  const heading = document.createElement('h3');
  heading.textContent = 'Ordner teilen: ' + folder.name;
  container.appendChild(heading);
  // Person selection
  const lbl = document.createElement('label');
  lbl.textContent = 'Ich bin: ';
  const sel = document.createElement('select');
  folder.people.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  lbl.appendChild(sel);
  container.appendChild(lbl);
  // Maintain assignment state for each receipt separately
  const assignments = {};
  let selectedPersonIndex = parseInt(sel.value) || 0;
  // Function to rebuild the tables for each receipt
  function rebuildAllTables() {
    // Remove any previous tables
    const prevTables = container.querySelectorAll('.receipt-share');
    prevTables.forEach(el => el.remove());
    folder.receipts.forEach((rec) => {
      // Section container for this receipt
      const sec = document.createElement('div');
      sec.className = 'receipt-share';
      sec.style.marginTop = '1rem';
      // Receipt heading
      const h4 = document.createElement('h4');
      h4.textContent = rec.name;
      sec.appendChild(h4);
      // Table
      const tbl = document.createElement('table');
      const headerRow = document.createElement('tr');
      ['Artikel','Menge','Einzelpreis','Gesamt','Ich'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        headerRow.appendChild(th);
      });
      tbl.appendChild(headerRow);
      // Ensure assignments array exists for this receipt
      if (!assignments[rec.id]) assignments[rec.id] = [];
      rec.items.forEach((it, idx) => {
        const row = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = it.name;
        row.appendChild(tdName);
        const tdQty = document.createElement('td');
        tdQty.textContent = typeof it.qty === 'number' ? it.qty.toString() : '';
        row.appendChild(tdQty);
        const tdUnit = document.createElement('td');
        tdUnit.textContent = typeof it.unitPrice === 'number' ? it.unitPrice.toFixed(2) : '';
        row.appendChild(tdUnit);
        const tdTotal = document.createElement('td');
        let totalVal;
        if (typeof it.unitPrice === 'number' && typeof it.qty === 'number') {
          totalVal = it.unitPrice * it.qty;
        } else if (typeof it.total === 'number') {
          totalVal = it.total;
        }
        tdTotal.textContent = totalVal !== undefined ? totalVal.toFixed(2) : '';
        row.appendChild(tdTotal);
        const tdCheck = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        const original = it.assigned && typeof it.assigned[selectedPersonIndex] !== 'undefined' ? !!it.assigned[selectedPersonIndex] : false;
        cb.checked = assignments[rec.id][idx] !== undefined ? assignments[rec.id][idx] : original;
        cb.addEventListener('change', (ev) => {
          assignments[rec.id][idx] = ev.target.checked;
        });
        tdCheck.appendChild(cb);
        row.appendChild(tdCheck);
        tbl.appendChild(row);
      });
      sec.appendChild(tbl);
      container.appendChild(sec);
    });
  }
  // Build tables initially
  rebuildAllTables();
  // Update tables when person selection changes
  sel.addEventListener('change', () => {
    selectedPersonIndex = parseInt(sel.value) || 0;
    // Reset assignments for all receipts
    Object.keys(assignments).forEach(key => {
      assignments[key] = [];
    });
    rebuildAllTables();
  });
  // Submit button
  const submit = document.createElement('button');
  submit.textContent = 'Änderungen speichern';
  submit.className = 'secondary-button';
  submit.style.marginTop = '1rem';
  submit.addEventListener('click', () => {
    const selIdx = selectedPersonIndex;
    let anyChange = false;
    // For each receipt, compute pending changes and store them
    folder.receipts.forEach(rec => {
      const list = assignments[rec.id] || [];
      const pending = [];
      rec.items.forEach((it, idx) => {
        const orig = it.assigned && typeof it.assigned[selIdx] !== 'undefined' ? !!it.assigned[selIdx] : false;
        const newVal = list[idx] !== undefined ? !!list[idx] : orig;
        if (newVal !== orig) {
          pending.push({ itemIndex: idx, personIndex: selIdx, assigned: newVal });
        }
      });
      if (pending.length > 0) {
        anyChange = true;
        addPendingChange(owner, rec.id, pending);
      }
    });
    if (!anyChange) {
      alert('Keine Änderungen vorgenommen.');
      return;
    }
    alert('Danke! Deine Änderungen wurden gespeichert. Sie müssen noch bestätigt werden.');
    submit.disabled = true;
  });
  container.appendChild(submit);
  document.body.appendChild(container);
}

/**
 * Loads a receipt share view based on a snapshot object. This mode is
 * triggered when a share link contains a JSON snapshot of a single
 * receipt rather than just a reference. The view allows a friend to
 * select their name and assign themselves to items without relying
 * on the owner's account existing in local storage.
 * @param {Object} info A snapshot object with type 'receipt'.
 */
function loadReceiptSnapshotView(info) {
  isShareView = true;
  // Hide normal UI sections
  if (authSection) authSection.classList.add('hidden');
  if (appSection) appSection.classList.add('hidden');
  // Remove any existing share view
  const prev = document.getElementById('share-view');
  if (prev) prev.remove();
  // Extract data from snapshot
  const people = Array.isArray(info.people) ? info.people : [];
  const receipt = info.receipt;
  if (!receipt) {
    alert('Ungültiger Freigabelink (kein Kassenbon).');
    return;
  }
  // Build share interface
  const container = document.createElement('div');
  container.id = 'share-view';
  container.style.padding = '1rem';
  container.style.maxWidth = '900px';
  container.style.margin = '0 auto';
  // Heading
  const heading = document.createElement('h3');
  heading.textContent = 'Kassenbon teilen: ' + receipt.name;
  container.appendChild(heading);
  // Person selection
  const lbl = document.createElement('label');
  lbl.textContent = 'Ich bin: ';
  const sel = document.createElement('select');
  people.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (people.length === 0) {
    const opt = document.createElement('option');
    opt.value = 0;
    opt.textContent = 'Gast';
    sel.appendChild(opt);
  }
  lbl.appendChild(sel);
  container.appendChild(lbl);
  // Table
  const table = document.createElement('table');
  let currentAssignments = [];
  function rebuildTable(selectedIdx) {
    table.innerHTML = '';
    const headerRow = document.createElement('tr');
    ['Artikel','Menge','Einzelpreis','Gesamt','Ich'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    table.appendChild(headerRow);
    receipt.items.forEach((it, i) => {
      const row = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = it.name;
      row.appendChild(tdName);
      const tdQty = document.createElement('td');
      tdQty.textContent = typeof it.qty === 'number' ? it.qty.toString() : '';
      row.appendChild(tdQty);
      const tdUnit = document.createElement('td');
      tdUnit.textContent = typeof it.unitPrice === 'number' ? it.unitPrice.toFixed(2) : '';
      row.appendChild(tdUnit);
      const tdTotal = document.createElement('td');
      let totalVal;
      if (typeof it.unitPrice === 'number' && typeof it.qty === 'number') {
        totalVal = it.unitPrice * it.qty;
      } else if (typeof it.total === 'number') {
        totalVal = it.total;
      }
      tdTotal.textContent = totalVal !== undefined ? totalVal.toFixed(2) : '';
      row.appendChild(tdTotal);
      const tdCheck = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      // Determine original assignment if present
      let orig = false;
      if (Array.isArray(it.assigned) && selectedIdx < it.assigned.length) {
        orig = !!it.assigned[selectedIdx];
      }
      cb.checked = currentAssignments[i] !== undefined ? currentAssignments[i] : orig;
      cb.addEventListener('change', (ev) => {
        currentAssignments[i] = ev.target.checked;
      });
      tdCheck.appendChild(cb);
      row.appendChild(tdCheck);
      table.appendChild(row);
    });
  }
  // Initial build
  rebuildTable(parseInt(sel.value) || 0);
  sel.addEventListener('change', () => {
    currentAssignments = [];
    rebuildTable(parseInt(sel.value) || 0);
  });
  container.appendChild(table);
  // Submit button
  const submit = document.createElement('button');
  submit.textContent = 'Änderungen speichern';
  submit.className = 'secondary-button';
  submit.style.marginTop = '1rem';
  submit.addEventListener('click', () => {
    // Compute pending assignments relative to original snapshot
    const selIdx = parseInt(sel.value) || 0;
    const pending = [];
    receipt.items.forEach((it, idx) => {
      let orig = false;
      if (Array.isArray(it.assigned) && selIdx < it.assigned.length) {
        orig = !!it.assigned[selIdx];
      }
      const newVal = currentAssignments[idx] !== undefined ? !!currentAssignments[idx] : orig;
      if (newVal !== orig) {
        pending.push({ itemIndex: idx, personIndex: selIdx, assigned: newVal });
      }
    });
    if (pending.length === 0) {
      alert('Keine Änderungen vorgenommen.');
      return;
    }
    // Store pending changes locally keyed by owner and receipt id if possible
    if (info.owner && receipt.id) {
      addPendingChange(info.owner, receipt.id, pending);
    }
    alert('Danke! Deine Änderungen wurden gespeichert. Sie müssen noch bestätigt werden.');
    submit.disabled = true;
  });
  container.appendChild(submit);
  document.body.appendChild(container);
}

/**
 * Loads a folder share view based on a snapshot object. This mode is
 * triggered when a share link contains a JSON snapshot of an entire
 * folder. The view allows a friend to select their name and assign
 * themselves to items across all receipts without relying on the
 * owner’s account existing locally.
 * @param {Object} info A snapshot object with type 'folder'.
 */
function loadFolderSnapshotView(info) {
  isShareView = true;
  // Hide normal UI sections
  if (authSection) authSection.classList.add('hidden');
  if (appSection) appSection.classList.add('hidden');
  // Remove any existing share view
  const prev = document.getElementById('share-view');
  if (prev) prev.remove();
  const people = Array.isArray(info.people) ? info.people : [];
  const receipts = Array.isArray(info.receipts) ? info.receipts : [];
  const folderName = info.folderName || 'Ordner';
  // Build share interface
  const container = document.createElement('div');
  container.id = 'share-view';
  container.style.padding = '1rem';
  container.style.maxWidth = '900px';
  container.style.margin = '0 auto';
  // Heading
  const heading = document.createElement('h3');
  heading.textContent = 'Ordner teilen: ' + folderName;
  container.appendChild(heading);
  // Person selection
  const lbl = document.createElement('label');
  lbl.textContent = 'Ich bin: ';
  const sel = document.createElement('select');
  people.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (people.length === 0) {
    const opt = document.createElement('option');
    opt.value = 0;
    opt.textContent = 'Gast';
    sel.appendChild(opt);
  }
  lbl.appendChild(sel);
  container.appendChild(lbl);
  // Maintain assignment state for each receipt separately
  const assignments = {};
  // Function to rebuild tables for each receipt based on selected person
  function rebuildAllTables() {
    // Remove previous receipt sections
    const prevSecs = container.querySelectorAll('.receipt-share');
    prevSecs.forEach(el => el.remove());
    const selectedIdx = parseInt(sel.value) || 0;
    receipts.forEach(rec => {
      // Section container
      const sec = document.createElement('div');
      sec.className = 'receipt-share';
      sec.style.marginTop = '1rem';
      // Heading for this receipt
      const h4 = document.createElement('h4');
      h4.textContent = rec.name;
      sec.appendChild(h4);
      // Table
      const tbl = document.createElement('table');
      const headerRow = document.createElement('tr');
      ['Artikel','Menge','Einzelpreis','Gesamt','Ich'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        headerRow.appendChild(th);
      });
      tbl.appendChild(headerRow);
      if (!assignments[rec.id]) assignments[rec.id] = [];
      rec.items.forEach((it, idx) => {
        const row = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = it.name;
        row.appendChild(tdName);
        const tdQty = document.createElement('td');
        tdQty.textContent = typeof it.qty === 'number' ? it.qty.toString() : '';
        row.appendChild(tdQty);
        const tdUnit = document.createElement('td');
        tdUnit.textContent = typeof it.unitPrice === 'number' ? it.unitPrice.toFixed(2) : '';
        row.appendChild(tdUnit);
        const tdTotal = document.createElement('td');
        let totalVal;
        if (typeof it.unitPrice === 'number' && typeof it.qty === 'number') {
          totalVal = it.unitPrice * it.qty;
        } else if (typeof it.total === 'number') {
          totalVal = it.total;
        }
        tdTotal.textContent = totalVal !== undefined ? totalVal.toFixed(2) : '';
        row.appendChild(tdTotal);
        const tdCheck = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        // Determine original assignment
        let orig = false;
        if (Array.isArray(it.assigned) && selectedIdx < it.assigned.length) {
          orig = !!it.assigned[selectedIdx];
        }
        cb.checked = assignments[rec.id][idx] !== undefined ? assignments[rec.id][idx] : orig;
        cb.addEventListener('change', (ev) => {
          assignments[rec.id][idx] = ev.target.checked;
        });
        tdCheck.appendChild(cb);
        row.appendChild(tdCheck);
        tbl.appendChild(row);
      });
      sec.appendChild(tbl);
      container.appendChild(sec);
    });
  }
  // Initial tables
  rebuildAllTables();
  sel.addEventListener('change', () => {
    rebuildAllTables();
  });
  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Änderungen speichern';
  saveBtn.className = 'secondary-button';
  saveBtn.style.marginTop = '1rem';
  saveBtn.addEventListener('click', () => {
    const selectedIdx = parseInt(sel.value) || 0;
    let anyChanges = false;
    receipts.forEach(rec => {
      const recAssignments = assignments[rec.id] || [];
      const pending = [];
      rec.items.forEach((it, idx) => {
        let orig = false;
        if (Array.isArray(it.assigned) && selectedIdx < it.assigned.length) {
          orig = !!it.assigned[selectedIdx];
        }
        const newVal = recAssignments[idx] !== undefined ? !!recAssignments[idx] : orig;
        if (newVal !== orig) {
          pending.push({ itemIndex: idx, personIndex: selectedIdx, assigned: newVal });
        }
      });
      if (pending.length > 0) {
        anyChanges = true;
        if (info.owner && rec.id) {
          addPendingChange(info.owner, rec.id, pending);
        }
      }
    });
    if (!anyChanges) {
      alert('Keine Änderungen vorgenommen.');
      return;
    }
    alert('Danke! Deine Änderungen wurden gespeichert. Sie müssen noch bestätigt werden.');
    saveBtn.disabled = true;
  });
  container.appendChild(saveBtn);
  document.body.appendChild(container);
}