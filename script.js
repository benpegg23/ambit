// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

const CACHE_KEY = 'ambit-cache-v1';

function loadCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveCache(state) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    } catch {}
}

function atEndOfDay(d) {
    const dt = new Date(d.getTime());
    dt.setHours(23, 59, 0, 0);
    return dt;
}

// US holidays (simple list, can be expanded)
function isHoliday(date) {
    const y = date.getFullYear();
    const m = date.getMonth(); // 0-11
    const d = date.getDate();
    // New Year's Day
    if (m === 0 && d === 1) return true;
    // Memorial Day (last Mon in May)
    if (m === 4 && date.getDay() === 1 && d > 24) return true;
    // Independence Day
    if (m === 6 && d === 4) return true;
    // Labor Day (first Mon in Sep)
    if (m === 8 && date.getDay() === 1 && d < 8) return true;
    // Thanksgiving (fourth Thu in Nov)
    if (m === 10 && date.getDay() === 4 && d > 21 && d < 29) return true;
    // Christmas Day
    if (m === 11 && d === 25) return true;
    return false;
}

function addBusinessDays(date, n) {
    const dt = new Date(date.getTime());
    let count = 0;
    while (count < n) {
        dt.setDate(dt.getDate() + 1);
        const day = dt.getDay();
        if (day !== 0 && day !== 6 && !isHoliday(dt)) {
            count++;
        }
    }
    return dt;
}

function parseNumberWord(token) {
    if (!token) return null;
    const t = token.toLowerCase();
    const map = {
        zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
        ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
        seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
        sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, couple: 2, few: 3, a: 1, an: 1
    };
    if (map[t] !== undefined) return map[t];
    // Handle hyphen/space compounds like twenty-one
    const parts = t.split(/[-\s]+/);
    let total = 0;
    let current = 0;
    for (const part of parts) {
        if (map[part] === undefined) return null;
        const val = map[part];
        if (val === 100) {
            current = (current || 1) * 100;
        } else if (val >= 20) {
            current += val;
        } else {
            current += val;
        }
    }
    total += current;
    return total || null;
}

function parseDatePhrase(phrase, baseDate = new Date()) {
    if (!phrase) return null;
    let p = phrase.trim().toLowerCase();

    const now = new Date(baseDate.getTime());
    const weekdaysShort = ['sun','mon','tue','wed','thu','fri','sat'];
    const weekdaysFull  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const getWeekIndex = (token) => {
        const s = token.toLowerCase();
        let i = weekdaysShort.indexOf(s);
        if (i !== -1) return i;
        i = weekdaysFull.indexOf(s);
        return i; // -1 if not found
    };

    // Extract optional time: 'at 5pm', '5pm', 'at 17:30', '17:00'
    let timeMatch = p.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    let time24Match = !timeMatch && p.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/);
    let timeInfo = null;
    if (timeMatch) {
        const hh = parseInt(timeMatch[1], 10);
        const mm = parseInt(timeMatch[2] || '0', 10);
        const ap = timeMatch[3];
        let H = hh % 12;
        if (ap === 'pm') H += 12;
        timeInfo = { H, M: mm };
        p = p.replace(timeMatch[0], '').trim();
    } else if (time24Match) {
        const H = parseInt(time24Match[1], 10);
        const M = parseInt(time24Match[2], 10);
        timeInfo = { H, M };
        p = p.replace(time24Match[0], '').trim();
    }

    const setTime = (dt) => {
        if (!timeInfo) return atEndOfDay(dt);
        const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), timeInfo.H, timeInfo.M, 0, 0);
        return d;
    };

    // Quick forms: +3d, +2w, +1m
    let m = p.match(/^\+(\d+)\s*([dwm])$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2];
        const dt = new Date(now.getTime());
        if (unit === 'd') dt.setDate(dt.getDate() + n);
        else if (unit === 'w') dt.setDate(dt.getDate() + n * 7);
        else if (unit === 'm') dt.setMonth(dt.getMonth() + n);
        return setTime(dt);
    }

    // in N business days
    m = p.match(/^in\s+(\d+|[a-z-]+)\s*(business\s+day|business\s+days|biz\s+day|biz\s+days|bday|bdays)$/);
    if (m) {
        let n = parseInt(m[1], 10);
        if (isNaN(n)) n = parseNumberWord(m[1]);
        if (n != null) {
            const dt = addBusinessDays(now, n);
            return setTime(dt);
        }
    }
    
    // in N days/weeks/months/years (numeric)
    m = p.match(/^in\s+(\d+)\s*(day|days|week|weeks|wk|wks|month|months|mo|mos|year|years|yr|yrs)$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2];
        const dt = new Date(now.getTime());
        if (unit.startsWith('day')) dt.setDate(dt.getDate() + n);
        else if (unit.startsWith('wk') || unit.startsWith('week')) dt.setDate(dt.getDate() + n * 7);
        else if (unit.startsWith('mo') || unit.startsWith('month')) dt.setMonth(dt.getMonth() + n);
        else if (unit.startsWith('yr') || unit.startsWith('year')) dt.setFullYear(dt.getFullYear() + n);
        return setTime(dt);
    }

    // in <word> days/weeks/... (word numbers)
    m = p.match(/^in\s+([a-z-]+)\s*(day|days|week|weeks|wk|wks|month|months|mo|mos|year|years|yr|yrs)$/);
    if (m) {
        const n = parseNumberWord(m[1]);
        if (n != null) {
            const unit = m[2];
            const dt = new Date(now.getTime());
            if (unit.startsWith('day')) dt.setDate(dt.getDate() + n);
            else if (unit.startsWith('wk') || unit.startsWith('week')) dt.setDate(dt.getDate() + n * 7);
            else if (unit.startsWith('mo') || unit.startsWith('month')) dt.setMonth(dt.getMonth() + n);
            else if (unit.startsWith('yr') || unit.startsWith('year')) dt.setFullYear(dt.getFullYear() + n);
            return setTime(dt);
        }
    }

    // standalone number with unit: '2 wks', '2 mo', etc.
    m = p.match(/^(\d+)\s*(wk|wks|week|weeks|mo|mos|month|months|yr|yrs|year|years)$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2];
        const dt = new Date(now.getTime());
        if (unit.startsWith('wk') || unit.startsWith('week')) dt.setDate(dt.getDate() + n * 7);
        else if (unit.startsWith('mo') || unit.startsWith('month')) dt.setMonth(dt.getMonth() + n);
        else if (unit.startsWith('yr') || unit.startsWith('year')) dt.setFullYear(dt.getFullYear() + n);
        return setTime(dt);
    }

    // today/tomorrow
    if (p === 'today') return setTime(now);
    if (p === 'tomorrow' || p === 'tmr' || p === 'tmrw') {
        const dt = new Date(now.getTime());
        dt.setDate(dt.getDate() + 1);
        return setTime(dt);
    }

    // next <period>
    if (p === 'next week') {
        const dt = new Date(now.getTime());
        dt.setDate(dt.getDate() + 7);
        return setTime(dt);
    }
    if (p === 'next month') {
        const dt = new Date(now.getTime());
        dt.setMonth(dt.getMonth() + 1);
        return setTime(dt);
    }
    if (p === 'next year') {
        const dt = new Date(now.getTime());
        dt.setFullYear(dt.getFullYear() + 1);
        return setTime(dt);
    }

    // eom / eow
    if (p === 'eom' || p === 'end of month') {
        const dt = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return setTime(dt);
    }
    if (p === 'eow' || p === 'end of week') {
        const dt = new Date(now.getTime());
        const delta = (7 - dt.getDay()) % 7;
        dt.setDate(dt.getDate() + delta);
        return setTime(dt);
    }

    // next business day, next biz day
    if (p.includes('business day') || p.includes('biz day') || p.includes('bday')) {
        const dt = addBusinessDays(now, 1);
        return setTime(dt);
    }

    // this <weekday> vs next <weekday> (short or full)
    m = p.match(/^(this|next)\s+([a-z]+)$/);
    if (m) {
        const mod = m[1];
        const idx = getWeekIndex(m[2]);
        if (idx !== -1) {
            const dt = new Date(now.getTime());
            let delta = (7 - dt.getDay() + idx) % 7;
            if (mod === 'next' && delta < 7) delta += 7;
            else if (mod === 'this' && delta === 0) delta = 0; // if it's today
            else if (delta === 0) delta = 7;
            dt.setDate(dt.getDate() + delta);
            return setTime(dt);
        }
    }
    m = p.match(/^next\s+([a-z]+)$/);
    if (m) {
        const idx = getWeekIndex(m[1]);
        if (idx !== -1) {
            const dt = new Date(now.getTime());
            const delta = (7 - dt.getDay() + idx) % 7 || 7;
            dt.setDate(dt.getDate() + delta);
            return setTime(dt);
        }
    }

    // <weekday> alone (short or full) - implies next occurrence
    {
        const idx = getWeekIndex(p);
        if (idx !== -1) {
            const dt = new Date(now.getTime());
            let delta = (7 - dt.getDay() + idx) % 7;
            if (delta === 0) delta = 7;
            dt.setDate(dt.getDate() + delta);
            return setTime(dt);
        }
    }

    // 2w / 3d compact
    m = p.match(/^(\d+)\s*([dw])$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2];
        const dt = new Date(now.getTime());
        if (unit === 'd') dt.setDate(dt.getDate() + n);
        if (unit === 'w') dt.setDate(dt.getDate() + n * 7);
        return setTime(dt);
    }

    // mm/dd or m/d/yyyy
    m = p.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (m) {
        let mm = parseInt(m[1], 10) - 1;
        let dd = parseInt(m[2], 10);
        let yyyy = m[3] ? parseInt(m[3], 10) : now.getFullYear();
        if (yyyy < 100) yyyy += 2000;
        const dt = new Date(yyyy, mm, dd);
        return setTime(dt);
    }

    // If only a time was provided
    if (timeInfo) {
        const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), timeInfo.H, timeInfo.M, 0, 0);
        if (dt <= now) dt.setDate(dt.getDate() + 1);
        return dt;
    }

    return null;
}

function formatDue(dateObj) {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    return `${d.getMonth()+1}/${d.getDate()}`;
}

function extractQuickShortcut(text) {
    // returns { cleanText, due }
    const m = text.match(/\!(today|tomorrow|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (!m) return { cleanText: text, due: null };
    const key = m[1].toLowerCase();
    const due = parseDatePhrase(key);
    const cleanText = text.replace(m[0], '').trim();
    return { cleanText, due };
}

function extractByPhrase(text) {
    // looks for 'by <phrase>' at end
    const m = text.match(/^(.*?)(?:\s+by\s+([^,]+))$/i);
    if (!m) return { cleanText: text, due: null };
    const phrase = m[2].trim();
    const due = parseDatePhrase(phrase);
    if (!due) return { cleanText: text, due: null };
    return { cleanText: m[1].trim(), due };
}

function nextFromRecurring(rec, fromDate = new Date()) {
    if (!rec) return null;
    const type = rec.type;
    const now = new Date(fromDate.getTime());
    if (type === 'weekday') {
        const target = rec.weekday; // 0-6
        const dt = new Date(now.getTime());
        let delta = (7 - dt.getDay() + target) % 7;
        if (delta === 0) delta = 7;
        dt.setDate(dt.getDate() + delta);
        return atEndOfDay(dt);
    }
    if (type === 'interval') {
        const days = rec.days || 7;
        const dt = new Date(now.getTime());
        dt.setDate(dt.getDate() + days);
        return atEndOfDay(dt);
    }
    if (type === 'monthday') {
        const day = rec.day || 1;
        const dt = new Date(now.getFullYear(), now.getMonth(), day);
        if (dt <= now) dt.setMonth(dt.getMonth() + 1);
        return atEndOfDay(dt);
    }
    return null;
}

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAaW5KYfyvrfOprElQ7hfeYqWzxYf9SMOk",
    authDomain: "ambit-b2e8c.firebaseapp.com",
    projectId: "ambit-b2e8c",
    storageBucket: "ambit-b2e8c.firebasestorage.app",
    messagingSenderId: "1011182750139",
    appId: "1:1011182750139:web:0f9decb99e905ef3081c9e"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', () => {
    let user = null;
    let dbRef = null;

    const settingsToggle = document.getElementById('settings-toggle');
    const settingsMenu = document.getElementById('settings-menu');
    const themeSelectorContainer = document.getElementById('theme-selector');
    const helpToggle = document.getElementById('help-toggle');
    const hintToggle = document.getElementById('hint-toggle');
    const toggleCompletedBtn = document.getElementById('toggle-completed-tasks');
    const helpSection = document.getElementById('help-section');
    const body = document.body;
    const promptInput = document.getElementById('prompt');
    const promptHint = document.getElementById('prompt-hint');
    const categoriesContainer = document.getElementById('categories-container');

    let data = {}; // { categoryName: Task[] }
    let focusedCategory = null;
    let isHintingEnabled = true;
    let commandHistory = [];
    let historyIndex = 0;
    let pinnedCategories = [];
    let showCompletedTasks = true;
    let categoryOrder = [];

    const themes = ["Light", "Dark", "Solarized Light", "Solarized Dark", "Nord", "Gruvbox", "Monokai", "Dracula", "Material Light", "Material Dark", "GitHub Light", "GitHub Dark"];

    // --- Theme Handling ---
    const selectedThemeDiv = themeSelectorContainer.querySelector('.select-selected');
    const themeOptionsDiv = themeSelectorContainer.querySelector('.select-items');

    function applyTheme(themeName) {
        const themeId = themeName.toLowerCase().replace(/ /g, '-');
        document.body.dataset.theme = themeId;
        selectedThemeDiv.textContent = themeName;
        localStorage.setItem('ambit-theme', themeName);
    }
    
    // Populate dropdown and load saved theme on startup
    themes.forEach(theme => {
        const option = document.createElement('div');
        option.textContent = theme;
        option.addEventListener('click', function() {
            applyTheme(this.textContent);
            themeOptionsDiv.classList.add('select-hide');
            selectedThemeDiv.classList.remove('select-arrow-active');
        });
        themeOptionsDiv.appendChild(option);
    });
    
    selectedThemeDiv.addEventListener('click', function(e) {
        e.stopPropagation();
        themeOptionsDiv.classList.toggle('select-hide');
        this.classList.toggle('select-arrow-active');
    });
    
    document.addEventListener('click', function () {
        themeOptionsDiv.classList.add('select-hide');
        selectedThemeDiv.classList.remove('select-arrow-active');
    });


    const savedTheme = localStorage.getItem('ambit-theme');
    if (savedTheme && themes.includes(savedTheme)) {
        applyTheme(savedTheme);
    } else {
        applyTheme(themes[0]); // Default to Light
    }


    // Persistence and auth init
    let isSnapshotReady = false;
    let hasQueuedSave = false;
    let bufferedState = null; // { categories, pinnedCategories, categoryOrder }

    // Warm-start from local cache (optimistic UI)
    const cached = loadCache();
    if (cached && cached.categories) {
        data = cached.categories || {};
        pinnedCategories = cached.pinnedCategories || [];
        categoryOrder = cached.categoryOrder || Object.keys(data);
        render();
    }
    const initialCache = cached; // Keep for snapshot reconciliation

    function scheduleSave() {
        // always keep local cache current
        saveCache({
            categories: data,
            pinnedCategories,
            categoryOrder
        });
        // If auth/doc not ready yet or first snapshot not loaded, queue save and buffer current state
        if (!dbRef || !isSnapshotReady) {
            bufferedState = {
                categories: JSON.parse(JSON.stringify(data)),
                pinnedCategories: [...pinnedCategories],
                categoryOrder: [...categoryOrder]
            };
            hasQueuedSave = true;
            return;
        }
        const payload = {
            categories: data,
            pinnedCategories: pinnedCategories,
            categoryOrder: categoryOrder
        };
        setDoc(dbRef, payload).catch(e => console.error("Error saving data:", e));
    }

    async function ensureAuth() {
        try {
            await setPersistence(auth, browserLocalPersistence);
        } catch (e) {
            console.warn('Failed to set persistence (fallback to default):', e);
        }
    }

    ensureAuth().finally(() => {
        onAuthStateChanged(auth, (authUser) => {
            if (authUser) {
                user = authUser;
                dbRef = doc(db, 'users', user.uid);
                onSnapshot(dbRef, (docSnap) => {
                    const wasReady = isSnapshotReady;
                    isSnapshotReady = true;

                    // Prefer local cached state on first load if server has nothing yet
                    if (!docSnap.exists()) {
                        if (initialCache && initialCache.categories && Object.keys(initialCache.categories).length > 0) {
                            setDoc(dbRef, initialCache)
                                .then(() => {
                                    data = initialCache.categories || {};
                                    pinnedCategories = initialCache.pinnedCategories || [];
                                    categoryOrder = initialCache.categoryOrder || Object.keys(data);
                                    render();
                                })
                                .catch(e => console.error('Error seeding from cache:', e));
                            return;
                        }
                        // Otherwise create initial empty doc if we queued saves
                        if (hasQueuedSave && bufferedState) {
                            setDoc(dbRef, bufferedState)
                                .then(() => {
                                    hasQueuedSave = false;
                                    data = bufferedState.categories || {};
                                    pinnedCategories = bufferedState.pinnedCategories || [];
                                    categoryOrder = bufferedState.categoryOrder || Object.keys(data);
                                    bufferedState = null;
                                    render();
                                })
                                .catch(e => console.error('Error flushing buffered state:', e));
                            return;
                        }
                        // Ensure at least an empty doc exists
                        scheduleSave();
                        return;
                    }

                    const dbData = docSnap.data() || {};
                    const serverCats = dbData.categories || {};
                    const serverEmpty = Object.keys(serverCats).length === 0;

                    if (!wasReady && serverEmpty && initialCache && initialCache.categories && Object.keys(initialCache.categories).length > 0) {
                        // Seed server with cache once, then render cache
                        setDoc(dbRef, initialCache)
                            .then(() => {
                                data = initialCache.categories || {};
                                pinnedCategories = initialCache.pinnedCategories || [];
                                categoryOrder = initialCache.categoryOrder || Object.keys(data);
                                render();
                            })
                            .catch(e => console.error('Error seeding from cache (existing doc):', e));
                        return;
                    }

                    // Normal apply from server
                    data = serverCats;
                    pinnedCategories = dbData.pinnedCategories || [];
                    categoryOrder = dbData.categoryOrder || Object.keys(data);
                    render();
                });
            } else {
                signInAnonymously(auth).catch((error) => console.error("Anonymous sign-in failed:", error));
            }
        });
    });

    settingsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!settingsMenu.contains(e.target) && !settingsMenu.classList.contains('hidden')) {
            settingsMenu.classList.add('hidden');
        }
    });

    // Theme switcher is now handled by the custom dropdown logic above

    helpToggle.addEventListener('click', () => {
        helpSection.classList.toggle('hidden');
    });

    hintToggle.addEventListener('click', () => {
        isHintingEnabled = !isHintingEnabled;
        hintToggle.textContent = isHintingEnabled ? 'On' : 'Off';
        updateHint();
    });

    toggleCompletedBtn.addEventListener('click', () => {
        showCompletedTasks = !showCompletedTasks;
        toggleCompletedBtn.textContent = showCompletedTasks ? 'Show' : 'Hide';
        render();
    });

    promptInput.addEventListener('input', () => {
        updateHint();
    });

    // Prompt handler
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                promptInput.value = commandHistory[historyIndex];
                promptInput.selectionStart = promptInput.selectionEnd = promptInput.value.length;
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex < commandHistory.length) {
                historyIndex++;
                promptInput.value = commandHistory[historyIndex] || '';
                promptInput.selectionStart = promptInput.selectionEnd = promptInput.value.length;
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const { prefix, match } = getAutocompleteMatch(promptInput.value);
            if (match) {
                promptInput.value = prefix + match;
                updateHint();
            }
        } else if (e.key === 'Enter') {
            const command = promptInput.value;
            handleCommand(command);

            const trimmedCommand = command.trim();
            if (trimmedCommand) {
                if (trimmedCommand !== commandHistory[commandHistory.length - 1]) {
                   commandHistory.push(trimmedCommand);
                }
                historyIndex = commandHistory.length;
            }

            promptInput.value = '';
            promptHint.value = '';
        }
    });

    function getAutocompleteMatch(text) {
        let prefix = '';
        let match = null;
        const parts = text.split(/\s+/);
        const command = parts[0];
        let partial = '';

        if (['@', '-', 'pin'].includes(command)) {
            prefix = command + ' ';
            partial = text.substring(prefix.length);
            if (partial) {
                match = Object.keys(data).find(c => c.startsWith(partial));
            }
        } else if (['done', 'undo', 'del', 'ed', 'mv', 'dup'].includes(command)) {
            prefix = command + ' ';
            partial = text.substring(prefix.length).toLowerCase();
            if (focusedCategory && data[focusedCategory] && partial) {
                let task;
                if (command === 'undo') {
                    task = data[focusedCategory].find(t => t.completed && (t.text || '').toLowerCase().startsWith(partial));
                } else {
                    task = data[focusedCategory].find(t => !t.completed && (t.text || '').toLowerCase().startsWith(partial));
                }
                if (task) match = task.text;
            }
        } else if (command === 'order') {
            prefix = command + ' ';
            partial = text.substring(prefix.length);
            if (partial) {
                // If focused, prefer matching tasks first
                if (focusedCategory && data[focusedCategory]) {
                     const task = data[focusedCategory].find(t => (t.text || '').toLowerCase().startsWith(partial.toLowerCase()));
                     if (task) match = task.text;
                }
                // Fallback to categories if no task matches or not focused
                if (!match) {
                    match = Object.keys(data).find(c => c.startsWith(partial));
                }
            }
        }

        return { prefix, match };
    }

    function updateHint() {
        if (!isHintingEnabled) {
            promptHint.value = '';
            return;
        }

        const text = promptInput.value;
        const { prefix, match } = getAutocompleteMatch(text);
        
        let hintText = '';
        if (match && text !== prefix + match) {
            hintText = prefix + match;
        }
        promptHint.value = hintText;
    }

    function moveInArray(arr, fromIndex, toIndex) {
        if (fromIndex === -1 || toIndex < 0 || toIndex >= arr.length) return;
        const [element] = arr.splice(fromIndex, 1);
        arr.splice(toIndex, 0, element);
    }

    function findTaskIndexByPrefix(categoryName, queryLower) {
        if (!data[categoryName]) return -1;
        return data[categoryName].findIndex(t => (t.text || '').toLowerCase().startsWith(queryLower));
    }

    function renameCategory(oldName, newName) {
        if (!data[oldName] || !newName) return;
        if (!data[newName]) {
            data[newName] = data[oldName];
        } else {
            // merge into existing target
            data[newName] = [...data[newName], ...data[oldName]];
        }
        delete data[oldName];
        // update order
        const oi = categoryOrder.indexOf(oldName);
        if (oi > -1) {
            categoryOrder.splice(oi, 1, newName);
        }
        // update pinned list
        const pi = pinnedCategories.indexOf(oldName);
        if (pi > -1) pinnedCategories.splice(pi, 1, newName);
        // update focus
        if (focusedCategory === oldName) focusedCategory = newName;
    }

    function handleCommand(command) {
        command = command.trim();
        if (!command) return;

        const originalState = JSON.stringify({ data, pinnedCategories, categoryOrder, focusedCategory });

        // Order: order [name] ![direction]
        if (command.startsWith('order ')) {
            const body = command.substring(6).trim();
            const parts = body.split('!');
            if (parts.length === 2) {
                const itemName = parts[0].trim();
                const direction = parts[1].trim();
    
                if (itemName && direction) {
                    // Check if it's a category
                    const catIndex = categoryOrder.indexOf(itemName);
                    if (catIndex > -1) {
                        let newIndex = catIndex;
                        if (direction === 'up') newIndex = Math.max(0, catIndex - 1);
                        else if (direction === 'down') newIndex = Math.min(categoryOrder.length - 1, catIndex + 1);
                        else if (direction === 'top') newIndex = 0;
                        else if (direction === 'bottom') newIndex = categoryOrder.length - 1;
                        moveInArray(categoryOrder, catIndex, newIndex);
                    } 
                    // Check if it's a task in the focused category
                    else if (focusedCategory && data[focusedCategory]) {
                        const taskIndex = findTaskIndexByPrefix(focusedCategory, itemName.toLowerCase());
                        if (taskIndex > -1) {
                            const taskArr = data[focusedCategory];
                            let newIndex = taskIndex;
                            if (direction === 'up') newIndex = Math.max(0, taskIndex - 1);
                            else if (direction === 'down') newIndex = Math.min(taskArr.length - 1, taskIndex + 1);
                            else if (direction === 'top') newIndex = 0;
                            else if (direction === 'bottom') newIndex = taskArr.length - 1;
                            moveInArray(taskArr, taskIndex, newIndex);
                        }
                    }
                }
            }
        }
        // Recurring: every [mon|1st|2w] [task text]
        if (command.startsWith('every ')) {
            if (!focusedCategory) return;
            const body = command.substring(6).trim();
            const parts = body.split(/\s+/);
            if (parts.length >= 2) {
                const token = parts[0].toLowerCase();
                const taskText = parts.slice(1).join(' ').trim();
                let rec = null;
                const weekdays = ['sun','mon','tue','wed','thu','fri','sat'];
                if (weekdays.includes(token)) {
                    rec = { type: 'weekday', weekday: weekdays.indexOf(token) };
                } else if (/^(\d+)[w]$/.test(token)) {
                    const d = parseInt(token, 10) * 7;
                    rec = { type: 'interval', days: d };
                } else if (/^(\d+)[d]$/.test(token)) {
                    const d = parseInt(token, 10);
                    rec = { type: 'interval', days: d };
                } else if (/^(\d+)(st|nd|rd|th)$/.test(token)) {
                    const day = parseInt(token, 10);
                    rec = { type: 'monthday', day };
                }
                if (rec) {
                    const due = nextFromRecurring(rec, new Date());
                    data[focusedCategory].push({ text: taskText, completed: false, due: due ? due.toISOString() : null, recur: rec });
                }
            }
        }
        // Snooze: snooze [task text] -> [phrase]
        else if (command.startsWith('snooze ')) {
            if (!focusedCategory) return;
            const body = command.substring(7).trim();
            const parts = body.split('->');
            if (parts.length === 2) {
                const taskQuery = parts[0].trim().toLowerCase();
                const phrase = parts[1].trim();
                const idx = findTaskIndexByPrefix(focusedCategory, taskQuery);
                if (idx > -1) {
                    const due = parseDatePhrase(phrase);
                    if (due) data[focusedCategory][idx].due = due.toISOString();
                }
            }
        }
        // rn [old] -> [new]
        else if (command.startsWith('rn ')) {
            const body = command.substring(3).trim();
            const parts = body.split('->');
            if (parts.length === 2) {
                const oldName = parts[0].trim();
                const newName = parts[1].trim();
                if (oldName && newName && data[oldName]) {
                    renameCategory(oldName, newName);
                }
            }
        }
        // mv [task text] -> [category] (from focused category)
        else if (command.startsWith('mv ')) {
            const body = command.substring(3).trim();
            const parts = body.split('->');
            if (parts.length === 2 && focusedCategory) {
                const taskQuery = parts[0].trim().toLowerCase();
                const targetCategory = parts[1].trim();
                if (taskQuery && targetCategory && data[focusedCategory]) {
                    const idx = findTaskIndexByPrefix(focusedCategory, taskQuery);
                    if (idx > -1) {
                        const [task] = data[focusedCategory].splice(idx, 1);
                        if (!data[targetCategory]) {
                            data[targetCategory] = [];
                            if (!categoryOrder.includes(targetCategory)) categoryOrder.push(targetCategory);
                        }
                        data[targetCategory].push(task);
                    }
                }
            }
        }
        // ed [task text] -> [new text]
        else if (command.startsWith('ed ')) {
            const body = command.substring(3).trim();
            const parts = body.split('->');
            if (parts.length === 2 && focusedCategory) {
                const taskQuery = parts[0].trim().toLowerCase();
                const newText = parts[1].trim();
                if (taskQuery && newText && data[focusedCategory]) {
                    const idx = findTaskIndexByPrefix(focusedCategory, taskQuery);
                    if (idx > -1) {
                        const prev = data[focusedCategory][idx];
                        data[focusedCategory][idx] = { text: newText, completed: !!prev.completed, due: prev.due || null, recur: prev.recur || null };
                    }
                }
            }
        }
        // dup [task text]
        else if (command.startsWith('dup ')) {
            const body = command.substring(4).trim().toLowerCase();
            if (focusedCategory && body) {
                const idx = findTaskIndexByPrefix(focusedCategory, body);
                if (idx > -1) {
                    const t = data[focusedCategory][idx];
                    data[focusedCategory].push({ text: t.text, completed: t.completed, due: t.due || null, recur: t.recur || null });
                }
            }
        }
        // + new category
        else if (command.startsWith('+ ')) {
            const categoryName = command.substring(2).trim();
            if (categoryName && !data[categoryName]) {
                data[categoryName] = [];
                categoryOrder.push(categoryName);
                focusedCategory = categoryName; // Auto-focus on new category
            }
        } else if (command.startsWith('@ ')) {
            const categoryName = command.substring(2).trim();
            if (data[categoryName]) {
                focusedCategory = categoryName;
            }
        } else if (command.startsWith('- ')) {
            const categoryName = command.substring(2).trim();
            if (data[categoryName]) {
                delete data[categoryName];
                if (focusedCategory === categoryName) {
                    focusedCategory = null;
                }
                const pinIndex = pinnedCategories.indexOf(categoryName);
                if (pinIndex > -1) {
                    pinnedCategories.splice(pinIndex, 1);
                }
                const orderIndex = categoryOrder.indexOf(categoryName);
                if (orderIndex > -1) {
                    categoryOrder.splice(orderIndex, 1);
                }
            }
        } else if (command.startsWith('pin ')) {
            const categoryName = command.substring(4).trim();
            if (data[categoryName]) {
                const pinIndex = pinnedCategories.indexOf(categoryName);
                if (pinIndex > -1) {
                    pinnedCategories.splice(pinIndex, 1);
                } else {
                    pinnedCategories.push(categoryName);
                }
            }
        } else if (command.startsWith('done ')) {
            const taskQuery = command.substring(5).trim().toLowerCase();
            if (focusedCategory && data[focusedCategory] && taskQuery) {
                const task = data[focusedCategory].find(t => !t.completed && (t.text || '').toLowerCase().startsWith(taskQuery));
                if (task) {
                    const categoryIndex = categoryOrder.indexOf(focusedCategory);
                    const taskIndex = data[focusedCategory].indexOf(task);
                    const listItems = document.querySelectorAll(`#categories-container .category ul`)[categoryIndex].children;
                    
                    if(listItems[taskIndex]) {
                        listItems[taskIndex].classList.add('task-completing');
                        setTimeout(() => {
                            task.completed = true;
                            // If recurring, schedule next
                            if (task.recur) {
                                const next = nextFromRecurring(task.recur, new Date());
                                if (next) task.due = next.toISOString();
                            }
                            scheduleSave();
                            render();
                        }, 500); // Wait for half the animation duration
                        return; // Exit early to prevent immediate re-render
                    }
                    // Fallback for safety
                    task.completed = true;
                    if (task.recur) {
                        const next = nextFromRecurring(task.recur, new Date());
                        if (next) task.due = next.toISOString();
                    }
                }
            }
        } else if (command.startsWith('undo ')) {
            const taskQuery = command.substring(5).trim().toLowerCase();
             if (focusedCategory && data[focusedCategory] && taskQuery) {
                const task = data[focusedCategory].find(t => t.completed && (t.text || '').toLowerCase().startsWith(taskQuery));
                if (task) {
                    task.completed = false;
                }
            }
        } else if (command.startsWith('del ')) {
            const taskQuery = command.substring(4).trim().toLowerCase();
            if (focusedCategory && data[focusedCategory] && taskQuery) {
                const taskIndex = data[focusedCategory].findIndex(t => (t.text || '').toLowerCase().startsWith(taskQuery));
                if (taskIndex > -1) {
                    data[focusedCategory].splice(taskIndex, 1);
                }
            }
        } else if (command.includes(':')) {
            const parts = command.split(':');
            const categoryName = parts[0].trim();
            let task = parts.slice(1).join(':').trim();
            if (data[categoryName] && task) {
                // quick shortcuts: !today, !tomorrow, !fri
                const quick = extractQuickShortcut(task);
                task = quick.cleanText;
                // by phrase parsing
                const byp = extractByPhrase(task);
                task = byp.cleanText;
                const due = quick.due || byp.due;
                data[categoryName].push({ text: task, completed: false, due: due ? due.toISOString() : null });
            }
        } else if (focusedCategory && command) {
            // When adding plain task, parse shortcuts/phrases
            let task = command;
            const quick = extractQuickShortcut(task);
            task = quick.cleanText;
            const byp = extractByPhrase(task);
            task = byp.cleanText;
            const due = quick.due || byp.due;
            data[focusedCategory].push({ text: task, completed: false, due: due ? due.toISOString() : null });
        }

        if (JSON.stringify({ data, pinnedCategories, categoryOrder, focusedCategory }) !== originalState) {
            scheduleSave();
        }
        render();
    }
    
    function parseForDate(text) {
        // highlight 'by <phrase>' already handled by extracting; keep simple highlight of 'by' clauses
        const dateRegex = /\b(by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|\d{1,2}\/\d{1,2}(\/\d{2,4})?))\b/gi;
        return text.replace(dateRegex, '<span class="date-highlight">$&</span>');
    }

    function render() {
        if (!categoriesContainer) return; // Guard clause
        categoriesContainer.innerHTML = '';
        
        const pinned = categoryOrder.filter(c => data[c] && pinnedCategories.includes(c));
        const unpinned = categoryOrder.filter(c => data[c] && !pinnedCategories.includes(c));
        const categoryNames = [...pinned, ...unpinned];

        for (const categoryName of categoryNames) {
            if (!data[categoryName]) continue; // Safeguard for rendering before data syncs
            const categoryDiv = document.createElement('div');
            categoryDiv.classList.add('category');

            const title = document.createElement('h2');
            if (categoryName === focusedCategory) {
                title.textContent = `> ${categoryName}`;
            } else {
                title.textContent = categoryName;
            }
            categoryDiv.appendChild(title);

            const taskList = document.createElement('ul');
            
            const sortedTasks = [...data[categoryName]].sort((a, b) => a.completed - b.completed);
            const tasksToDisplay = showCompletedTasks ? sortedTasks : sortedTasks.filter(t => !t.completed);

            tasksToDisplay.forEach((task) => {
                const taskItem = document.createElement('li');
                const prefix = task.completed ? '+' : '-';
                const dueStr = task.due ? ` <span class="date-highlight">[${formatDue(task.due)}]</span>` : '';
                taskItem.innerHTML = `${prefix} ${parseForDate(task.text)}${dueStr}`;
                if (task.completed) {
                    taskItem.classList.add('completed-task');
                }
                taskList.appendChild(taskItem);
            });
            categoryDiv.appendChild(taskList);

            categoriesContainer.appendChild(categoryDiv);
        }
    }

    promptInput.focus();
});
