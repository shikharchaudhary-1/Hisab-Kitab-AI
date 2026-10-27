/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Mic,
  MicOff,
  Settings,
  RotateCcw
} from 'lucide-react';
import { MODEL_CHAIN } from './geminiService';

interface LedgerItemDetail {
  name: string;
  qty?: number | null;
  unit?: string | null;
}

interface RawLedgerEntry {
  customer: string;
  items: LedgerItemDetail[];
  amount: number | null;
  on_credit: boolean;
  note?: string;
}

interface LedgerRow {
  id: string;
  customer: string;
  items: string;
  amount: number | null;
  on_credit: boolean;
  needs_review: boolean;
  note?: string;
  timestamp?: string;
  date?: string;
  type?: 'sale' | 'payment' | 'settle_all';
}

interface PaymentRecord {
  id: string;
  customer: string;
  amount: number;
  timestamp: string;
  date: string;
}

interface CustomerDue {
  customer: string;
  totalCreditDue: number;
  entryCount: number;
}

interface LastRequestData {
  audioBase64?: string;
  mimeType?: string;
  textPrompt?: string;
  transcriptText?: string;
  requestId?: string;
}

const STORAGE_KEY = 'hisab_kitab_saved_entries_v1';
const LEGACY_STORAGE_KEY = 'kirana_voice_ledger_saved_entries_v1';
const PAYMENTS_STORAGE_KEY = 'hisab_kitab_payments_v1';
const PAID_STAMPS_STORAGE_KEY = 'hisab_kitab_paid_stamps_v1';
const MODEL_STORAGE_KEY = 'hisab_kitab_model_choice';
const LANG_STORAGE_KEY = 'lang';

export type Language = 'hi' | 'en';

export const translations = {
  hi: {
    title: 'हिसाब किताब',
    tabBolo: 'बोलिए',
    tabAaj: 'आज का हिसाब',
    tabKhata: 'खाता',

    micSubtext: 'बोलिए, फिर नीचे जाँच लें।',
    trySample: 'नमूना आज़माएँ',

    listening: 'सुन रहा हूँ…',
    processing: 'समझ रहा हूँ…',
    successEntryAdded: (count: number) => `${count} एंट्री जोड़ी गई ✓`,
    noSalesUnderstood: 'कोई बिक्री समझ नहीं आई। कृपया दोबारा बोलें।',
    noUdhaarPending: (name: string) => `${name} का कोई उधार बाक़ी नहीं`,
    errorGoogleAiBusy: 'Google का AI अभी व्यस्त है। कृपया थोड़ी देर बाद फिर कोशिश करें।',
    errorDailyLimit: 'सभी मॉडल पर दैनिक सीमा समाप्त हो गई है। कृपया बाद में प्रयास करें।',
    errorNetworkOrAiSlow: 'नेटवर्क या AI धीमा है। कृपया फिर कोशिश करें।',
    micPermissionError: 'माइक की अनुमति नहीं मिली।',
    audioReadError: 'ऑडियो पढ़ा नहीं जा सका। दोबारा प्रयास करें।',
    retryBtn: 'फिर कोशिश करें',

    noEntriesYet: 'अभी तक कोई हिसाब नहीं है। बोलिए टैब पर जाकर माइक दबा कर बोलें!',
    customerPlaceholder: 'ग्राहक का नाम',
    itemsPlaceholder: 'सामान (जैसे: 2kg चीनी, 1 तेल)',
    addRow: '+ नई पंक्ति',
    saveEntries: 'एंट्री सहेजें',
    clearTable: 'तालिका साफ़ करें',
    clearModalTitle: 'क्या बिना सहेजी एंट्रियाँ साफ़ करें?',
    clearModalDesc: 'क्या आप नई बिना सहेजी एंट्रियाँ हटाना चाहते हैं?',
    clearModalNo: 'नहीं',
    clearModalYes: 'हाँ, साफ़ करें',

    deleteModalTitle: 'क्या यह एंट्री हटाएं?',
    deleteModalDesc: 'क्या आप यह एंट्री हटाना चाहते हैं? यह वापस नहीं आएगी।',
    deleteModalNo: 'नहीं',
    deleteModalYes: 'हाँ, हटाएं',
    entryDeletedSuccess: 'एंट्री हटा दी गई ✓',
    storageWarning: 'लोकल स्टोरेज में सहेज नहीं पाए।',

    udhaarKhataTitle: 'उधार खाता',
    noDuesYet: 'कोई उधार बाकी नहीं है।',
    reminderBtn: 'रिमाइंडर',
    advanceLabel: 'एडवांस',

    tabCustomers: 'ग्राहक',
    tabDays: 'दिन',
    noCustomerHistoryYet: 'कोई ग्राहक इतिहास नहीं है।',
    backKhata: '← खाता',
    unpaidDuesLabel: 'बकाया उधार:',
    writePayment: 'भुगतान लिखें',
    sendReminder: 'रिमाइंडर भेजें',
    customerHistoryTitle: 'हिसाब और भुगतान का इतिहास',
    noCustomerHistoryFound: 'इस ग्राहक की कोई हिस्ट्री नहीं मिली।',
    paymentReceived: 'भुगतान मिला',
    noDayHistoryYet: 'कोई दिन का हिसाब नहीं है।',
    cash: 'नकद',
    udhaar: 'उधार',
    received: 'प्राप्त',
    dayEntriesTitle: 'दिन की सारी एंट्री',
    noDateEntriesFound: 'इस तारीख़ को कोई एंट्री नहीं मिली।',
    receivedPaymentsTitle: 'प्राप्त भुगतान:',

    gearLanguage: 'भाषा',
    gearModel: 'मॉडल',
    autoModelOption: 'ऑटो (अनुशंसित)',
    lastModelUsedLabel: (modelName: string) => `अंतिम इस्तेमाल किया गया मॉडल: ${modelName}`,
    lastModelUsedNone: 'अंतिम इस्तेमाल किया गया मॉडल: कोई नहीं',

    paymentModalTitle: (name: string) => `भुगतान लिखें - ${name}`,
    paymentModalDesc: 'जमा की गई राशि (₹) दर्ज करें:',
    paymentModalCancel: 'रद्द करें',
    paymentModalSave: 'भुगतान सहेजें',
    paymentSavedSuccess: (amt: number) => `₹${amt} का भुगतान जमा हो गया ✓`,

    whatsappReminder: (name: string, amt: number) =>
      `नमस्ते ${name} जी, आपका ₹${amt} उधार बाकी है। कृपया जल्द भुगतान करें। धन्यवाद।`,
  },
  en: {
    title: 'Hisab Kitab',
    tabBolo: 'Bolo',
    tabAaj: 'Aaj ka Hisab',
    tabKhata: 'Khata',

    micSubtext: 'Boliye, phir niche check karein.',
    trySample: 'Try a sample',

    listening: 'Listening...',
    processing: 'Processing...',
    successEntryAdded: (count: number) => `${count} ${count === 1 ? 'entry' : 'entries'} added ✓`,
    noSalesUnderstood: 'No sales understood. Please speak again.',
    noUdhaarPending: (name: string) => `${name} ka koi udhaar baaki nahi`,
    errorGoogleAiBusy: "Google's AI is busy. Please try again in a moment.",
    errorDailyLimit: 'Daily Gemini limit reached on all models. Try again later.',
    errorNetworkOrAiSlow: 'Network or AI is slow. Please try again.',
    micPermissionError: 'Microphone permission denied.',
    audioReadError: 'Could not read audio. Please try again.',
    retryBtn: 'Retry',

    noEntriesYet: 'No entries yet. Go to Bolo tab and tap the mic to speak!',
    customerPlaceholder: 'Customer name',
    itemsPlaceholder: 'Items (e.g. 2kg sugar, 1 oil)',
    addRow: '+ Add row',
    saveEntries: 'Save entries',
    clearTable: 'Clear table',
    clearModalTitle: 'Clear unsaved rows?',
    clearModalDesc: 'Are you sure you want to clear unsaved rows?',
    clearModalNo: 'No',
    clearModalYes: 'Yes, clear',

    deleteModalTitle: 'Delete this entry?',
    deleteModalDesc: 'Are you sure you want to delete this entry? This cannot be undone.',
    deleteModalNo: 'No',
    deleteModalYes: 'Yes, delete',
    entryDeletedSuccess: 'Entry deleted ✓',
    storageWarning: 'Could not save to local storage.',

    udhaarKhataTitle: 'Udhaar Khata',
    noDuesYet: 'No pending dues.',
    reminderBtn: 'Reminder',
    advanceLabel: 'Advance',

    tabCustomers: 'Customers',
    tabDays: 'Days',
    noCustomerHistoryYet: 'No customer history.',
    backKhata: '← Khata',
    unpaidDuesLabel: 'Pending Credit:',
    writePayment: 'Write Payment',
    sendReminder: 'Send Reminder',
    customerHistoryTitle: 'Ledger & Payment History',
    noCustomerHistoryFound: 'No history found for this customer.',
    paymentReceived: 'Payment received',
    noDayHistoryYet: 'No daily entries found.',
    cash: 'Cash',
    udhaar: 'Udhaar',
    received: 'Received',
    dayEntriesTitle: 'All Day Entries',
    noDateEntriesFound: 'No entries found for this date.',
    receivedPaymentsTitle: 'Received Payments:',

    gearLanguage: 'Language',
    gearModel: 'Model',
    autoModelOption: 'Auto (recommended)',
    lastModelUsedLabel: (modelName: string) => `Last model used: ${modelName}`,
    lastModelUsedNone: 'Last model used: None',

    paymentModalTitle: (name: string) => `Write Payment - ${name}`,
    paymentModalDesc: 'Enter received amount (₹):',
    paymentModalCancel: 'Cancel',
    paymentModalSave: 'Save Payment',
    paymentSavedSuccess: (amt: number) => `₹${amt} payment recorded ✓`,

    whatsappReminder: (name: string, amt: number) =>
      `Namaste ${name} ji, aapka Hisab Kitab par kul Rs. ${amt} ka baki (udhaar) hisab hai. Kripya clear kar dein. Dhanyawad!`,
  },
};

// Capitalize first letter of each word for display
function capitalizeWords(str?: string): string {
  if (!str) return '';
  return str
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ''))
    .join(' ');
}

// Normalize customer key for case-insensitive and NFC Unicode comparison
function normalizeCustomerKey(name?: string): string {
  if (!name) return '';
  return name.trim().normalize('NFC').toLowerCase();
}

// Format customer name for display (Unknown -> अज्ञात in Hindi mode)
function formatCustomerName(name: string | undefined, lang: Language): string {
  if (!name || !name.trim()) return lang === 'hi' ? 'अज्ञात' : 'Unknown';
  if (name.trim().toLowerCase() === 'unknown') return lang === 'hi' ? 'अज्ञात' : 'Unknown';
  return name;
}

// Format items for display in Hindi mode (convert unit terms to Devanagari without modifying stored data)
function formatDisplayItems(itemsStr: string | undefined, lang: Language): string {
  if (!itemsStr) return '';
  if (lang !== 'hi') return itemsStr;

  return itemsStr
    .replace(/\b(kilo|kilos|kg|kgs)\b/gi, 'किलो')
    .replace(/\b(gram|grams|gm|g)\b/gi, 'ग्राम')
    .replace(/\b(litre|litres|liter|l)\b/gi, 'लीटर')
    .replace(/\bml\b/gi, 'मि.ली.')
    .replace(/\b(packet|packets)\b/gi, 'पैकेट')
    .replace(/\b(bottle|bottles)\b/gi, 'बोतल')
    .replace(/\bdozen\b/gi, 'दर्जन')
    .replace(/\b(piece|pieces|pcs)\b/gi, 'नग');
}

// Helper for local date string YYYY-MM-DD
function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Format display date as DD/MM/YYYY with leading zeros
function formatDisplayDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const month = parts[1].padStart(2, '0');
      const day = parts[2].padStart(2, '0');
      return `${day}/${month}/${year}`;
    }
  } catch {
    // fallback
  }
  return dateStr;
}

// Convert structured items into readable string
function formatItems(items: LedgerItemDetail[]): string {
  if (!items || !items.length) return '';
  return items
    .map((item) => {
      const parts: string[] = [];
      if (item.qty !== null && item.qty !== undefined) {
        parts.push(String(item.qty));
      }
      if (item.unit) {
        parts.push(item.unit);
      }
      if (item.name) {
        parts.push(item.name);
      }
      return parts.join(' ').trim();
    })
    .join(', ');
}

// Sample prompts
const SAMPLE_PROMPTS = [
  'Ravi: 2kg chini, 1 tel udhaar',
  'Suresh: 3 doodh, 100 rs cash',
  'Ravi ne 40 rupaye diye',
  'Ravi ka udhaar pura hua',
  'Shikhar ne 1 kilo tel ke 40 rupaye diye',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'bolo' | 'aaj' | 'khata'>('bolo');
  const [khataSubTab, setKhataSubTab] = useState<'customers' | 'days'>('customers');
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [unsavedRows, setUnsavedRows] = useState<LedgerRow[]>([]);
  const [editedSavedRows, setEditedSavedRows] = useState<Record<string, Partial<LedgerRow>>>({});
  const [deleteConfirmRowId, setDeleteConfirmRowId] = useState<string | null>(null);
  const [savedEntries, setSavedEntries] = useState<LedgerRow[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [transcript, setTranscript] = useState<string>('');
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    type: 'processing' | 'error' | 'success';
    message: string;
  } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [showModelPopover, setShowModelPopover] = useState<boolean>(false);
  const [showSamples, setShowSamples] = useState<boolean>(false);
  const [tappedRowId, setTappedRowId] = useState<string | null>(null);

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>('');

  // Language setting state
  const [lang, setLang] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY);
      if (stored === 'en' || stored === 'hi') {
        return stored;
      }
    } catch (e) {
      console.warn('LocalStorage not accessible for language setting:', e);
    }
    return 'hi';
  });

  const handleLangChange = (newLang: Language) => {
    setLang(newLang);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, newLang);
    } catch (e) {
      console.warn('Could not save language choice:', e);
    }
  };

  const t = translations[lang];

  // Model choice dropdown state ("auto" or one of MODEL_CHAIN)
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(MODEL_STORAGE_KEY);
      if (stored === 'auto' || (stored && (MODEL_CHAIN as readonly string[]).includes(stored))) {
        return stored;
      }
    } catch (e) {
      console.warn('LocalStorage not accessible for model setting:', e);
    }
    return 'auto';
  });

  const handleModelChange = (model: string) => {
    if (model === 'auto' || (MODEL_CHAIN as readonly string[]).includes(model)) {
      setSelectedModel(model);
      try {
        localStorage.setItem(MODEL_STORAGE_KEY, model);
      } catch (e) {
        console.warn('Could not save model choice:', e);
      }
    }
  };

  // Track last working model and timestamp
  const [lastWorkingModel, setLastWorkingModel] = useState<string | null>(null);
  const [lastWorkingModelTime, setLastWorkingModelTime] = useState<number | null>(null);

  // Track focused row id for editable items input
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  const getPreferredModelToSend = (): string => {
    if (selectedModel && selectedModel !== 'auto' && (MODEL_CHAIN as readonly string[]).includes(selectedModel)) {
      return selectedModel;
    }
    if (lastWorkingModel && lastWorkingModelTime) {
      if (Date.now() - lastWorkingModelTime <= 5 * 60 * 1000) {
        return lastWorkingModel;
      }
    }
    return 'auto';
  };

  // Paid stamp customers set
  const [paidCustomers, setPaidCustomers] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(PAID_STAMPS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return new Set(parsed.map((s: string) => normalizeCustomerKey(s)));
        }
      }
    } catch (e) {
      console.warn('LocalStorage not accessible for paid stamps:', e);
    }
    return new Set();
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const lastRequestRef = useRef<LastRequestData | null>(null);

  // Idempotency Tracking Refs
  const appliedRequestIdsRef = useRef<Set<string>>(new Set());
  const savedRowIdsRef = useRef<Set<string>>(new Set());

  const todayFormatted = useMemo(() => {
    return formatDisplayDate(getLocalDateString());
  }, []);

  // Load saved entries and payments on mount with try/catch
  useEffect(() => {
    let initialSales: LedgerRow[] = [];
    let initialPayments: PaymentRecord[] = [];

    try {
      const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const todayDate = getLocalDateString();
          const nowIso = new Date().toISOString();
          initialSales = parsed.map((item: any) => ({
            ...item,
            timestamp: item.timestamp || nowIso,
            date: item.date || todayDate,
          }));
          setSavedEntries(initialSales);
          initialSales.forEach((r: LedgerRow) => savedRowIdsRef.current.add(r.id));
        }
      }
    } catch (err) {
      console.warn('LocalStorage is not accessible for saved entries:', err);
    }

    try {
      const storedPayments = localStorage.getItem(PAYMENTS_STORAGE_KEY);
      if (storedPayments) {
        const parsedPay = JSON.parse(storedPayments);
        if (Array.isArray(parsedPay)) {
          initialPayments = parsedPay;
          setPayments(initialPayments);
          initialPayments.forEach((p: PaymentRecord) => savedRowIdsRef.current.add(p.id));
        }
      }
    } catch (err) {
      console.warn('LocalStorage is not accessible for payments:', err);
    }

    const todayDate = getLocalDateString();
    const todaySalesCount = initialSales.filter((e) => !e.date || e.date === todayDate).length;
    const todayPayCount = initialPayments.filter((p) => !p.date || p.date === todayDate).length;

    console.log(`[Hisab Kitab] Load | Saved rows for today: ${todaySalesCount + todayPayCount} | Unsaved rows: 0`);
  }, []);

  // Derived today's saved list (sales + payments)
  const todaySavedSales = useMemo(() => {
    const today = getLocalDateString();
    return savedEntries
      .filter((e) => !e.date || e.date === today)
      .map((e) => ({ ...e, isSaved: true }));
  }, [savedEntries]);

  const todaySavedPayments = useMemo(() => {
    const today = getLocalDateString();
    return payments
      .filter((p) => !p.date || p.date === today)
      .map((p) => ({
        id: p.id,
        customer: p.customer,
        items: t.paymentReceived,
        amount: p.amount,
        on_credit: false,
        needs_review: false,
        type: 'payment' as const,
        timestamp: p.timestamp,
        date: p.date || today,
        isSaved: true,
      }));
  }, [payments, t.paymentReceived]);

  const todaySavedList = useMemo(() => {
    const combined = [...todaySavedSales, ...todaySavedPayments];
    return combined.sort((a, b) => {
      const timeA = a.timestamp || '';
      const timeB = b.timestamp || '';
      return timeA.localeCompare(timeB);
    });
  }, [todaySavedSales, todaySavedPayments]);

  const displayRows = useMemo(() => {
    const savedWithEdits = todaySavedList.map((row) => {
      if (editedSavedRows[row.id]) {
        return { ...row, ...editedSavedRows[row.id] };
      }
      return row;
    });
    return [...savedWithEdits, ...unsavedRows];
  }, [todaySavedList, editedSavedRows, unsavedRows]);

  const hasUnsavedChanges = useMemo(() => {
    return unsavedRows.length > 0 || Object.keys(editedSavedRows).length > 0;
  }, [unsavedRows, editedSavedRows]);

  const hasUnsavedRows = useMemo(() => {
    return unsavedRows.length > 0;
  }, [unsavedRows]);

  // Existing deduplicated customer names for Gemini context (max 50)
  const existingCustomers = useMemo(() => {
    const set = new Set<string>();
    for (const e of savedEntries) {
      if (e.customer && e.customer.trim() && normalizeCustomerKey(e.customer) !== 'unknown') {
        set.add(e.customer.trim());
      }
    }
    for (const p of payments) {
      if (p.customer && p.customer.trim() && normalizeCustomerKey(p.customer) !== 'unknown') {
        set.add(p.customer.trim());
      }
    }
    return Array.from(set).slice(0, 50);
  }, [savedEntries, payments]);

  // Customer summaries for Khata Customers tab and Dues summary
  const customerSummaries = useMemo(() => {
    const map = new Map<string, { displayName: string; totalUdhaar: number; totalPaid: number }>();

    for (const entry of savedEntries) {
      const rawName = entry.customer?.trim() || 'Unknown';
      const key = normalizeCustomerKey(rawName);

      if (!map.has(key)) {
        map.set(key, { displayName: rawName, totalUdhaar: 0, totalPaid: 0 });
      }
      const current = map.get(key)!;
      if (entry.on_credit && typeof entry.amount === 'number' && !isNaN(entry.amount)) {
        current.totalUdhaar += entry.amount;
      }
    }

    for (const pay of payments) {
      const rawName = pay.customer?.trim() || 'Unknown';
      const key = normalizeCustomerKey(rawName);

      if (!map.has(key)) {
        map.set(key, { displayName: rawName, totalUdhaar: 0, totalPaid: 0 });
      }
      const current = map.get(key)!;
      current.totalPaid += pay.amount;
    }

    return Array.from(map.values())
      .map((item) => {
        const net = item.totalUdhaar - item.totalPaid;
        return {
          displayName: item.displayName,
          netBalance: net,
          unpaidCredit: Math.max(0, net),
          isAdvance: net < 0,
          advanceAmount: Math.abs(Math.min(0, net)),
          totalUdhaar: item.totalUdhaar,
          totalPaid: item.totalPaid,
        };
      })
      .sort((a, b) => b.unpaidCredit - a.unpaidCredit || a.displayName.localeCompare(b.displayName));
  }, [savedEntries, payments]);

  // Overall shop total credit due (counts ONLY positive balances!)
  const totalShopDue = customerSummaries.reduce((sum, c) => sum + (c.netBalance > 0 ? c.netBalance : 0), 0);

  // Customer dues list for Aaj ka Hisab page summary
  const customerDues: CustomerDue[] = useMemo(() => {
    return customerSummaries
      .filter((c) => c.netBalance > 0)
      .map((c) => ({
        customer: c.displayName,
        totalCreditDue: c.netBalance,
        entryCount: 0,
      }));
  }, [customerSummaries]);

  // Day summaries for Khata Days tab
  const daySummaries = useMemo(() => {
    const map = new Map<string, { cashTotal: number; udhaarTotal: number; receivedTotal: number; count: number }>();

    for (const entry of savedEntries) {
      const dateStr = entry.date || getLocalDateString();
      if (!map.has(dateStr)) {
        map.set(dateStr, { cashTotal: 0, udhaarTotal: 0, receivedTotal: 0, count: 0 });
      }
      const current = map.get(dateStr)!;
      current.count += 1;
      if (typeof entry.amount === 'number' && !isNaN(entry.amount)) {
        if (entry.on_credit) {
          current.udhaarTotal += entry.amount;
        } else {
          current.cashTotal += entry.amount;
        }
      }
    }

    for (const pay of payments) {
      const dateStr = pay.date || getLocalDateString();
      if (!map.has(dateStr)) {
        map.set(dateStr, { cashTotal: 0, udhaarTotal: 0, receivedTotal: 0, count: 0 });
      }
      const current = map.get(dateStr)!;
      current.receivedTotal += pay.amount;
    }

    return Array.from(map.entries())
      .map(([date, data]) => ({
        date,
        displayDate: formatDisplayDate(date),
        cashTotal: data.cashTotal,
        udhaarTotal: data.udhaarTotal,
        receivedTotal: data.receivedTotal,
        count: data.count,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [savedEntries, payments]);

  // Customer timeline entries & payments for selected customer
  const customerTimeline = useMemo(() => {
    if (!selectedCustomer) return [];

    const key = normalizeCustomerKey(selectedCustomer);

    const customerEntries = savedEntries
      .filter((r) => normalizeCustomerKey(r.customer) === key)
      .map((r) => ({
        kind: 'entry' as const,
        id: r.id,
        date: r.date || getLocalDateString(),
        timestamp: r.timestamp || new Date().toISOString(),
        items: r.items,
        amount: r.amount,
        on_credit: r.on_credit,
      }));

    const customerPayments = payments
      .filter((p) => normalizeCustomerKey(p.customer) === key)
      .map((p) => ({
        kind: 'payment' as const,
        id: p.id,
        date: p.date,
        timestamp: p.timestamp,
        items: 'Payment received',
        amount: p.amount,
        on_credit: false,
      }));

    return [...customerEntries, ...customerPayments].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
  }, [selectedCustomer, savedEntries, payments]);

  // Unpaid credit / summary for selected customer
  const selectedCustomerSummary = useMemo(() => {
    if (!selectedCustomer) return null;
    const targetKey = normalizeCustomerKey(selectedCustomer);
    return customerSummaries.find(
      (c) => normalizeCustomerKey(c.displayName) === targetKey
    ) || null;
  }, [selectedCustomer, customerSummaries]);

  const selectedCustomerUnpaid = selectedCustomerSummary ? selectedCustomerSummary.unpaidCredit : 0;

  // Date detail entries
  const dateEntries = useMemo(() => {
    if (!selectedDate) return [];
    return savedEntries.filter((r) => (r.date || getLocalDateString()) === selectedDate);
  }, [selectedDate, savedEntries]);

  // Date detail payments
  const datePayments = useMemo(() => {
    if (!selectedDate) return [];
    return payments.filter((p) => (p.date || getLocalDateString()) === selectedDate);
  }, [selectedDate, payments]);

  const dateTotals = useMemo(() => {
    let cash = 0;
    let udhaar = 0;
    for (const r of dateEntries) {
      if (typeof r.amount === 'number' && !isNaN(r.amount)) {
        if (r.on_credit) {
          udhaar += r.amount;
        } else {
          cash += r.amount;
        }
      }
    }
    const received = datePayments.reduce((sum, p) => sum + p.amount, 0);
    return { cash, udhaar, received };
  }, [dateEntries, datePayments]);

  const stopStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Process ledger input via Gemini backend - single entry point for voice & samples
  const processLedgerInput = async (params: LastRequestData) => {
    const requestId = params.requestId || `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    params.requestId = requestId;

    if (appliedRequestIdsRef.current.has(requestId)) {
      console.log(`[Hisab Kitab] Request ${requestId} already applied. Ignoring duplicate invocation.`);
      return;
    }

    if (
      params.transcriptText &&
      params.transcriptText !== 'Spoken voice input' &&
      params.transcriptText !== 'Recorded speech audio...'
    ) {
      setTranscript(params.transcriptText);
    } else if (params.textPrompt) {
      setTranscript(params.textPrompt);
    }

    lastRequestRef.current = params;
    setFallbackNote(null);
    setStatus({ type: 'processing', message: t.processing });

    const preferredModelToSend = getPreferredModelToSend();

    const payload = params.audioBase64
      ? {
          audioBase64: params.audioBase64,
          mimeType: params.mimeType,
          preferredModel: preferredModelToSend,
          existingCustomers,
          lang,
        }
      : {
          textPrompt: params.textPrompt,
          preferredModel: preferredModelToSend,
          existingCustomers,
          lang,
        };

    console.log(`[Hisab Kitab] Sending request ${requestId} | Language: ${lang} | PreferredModel: ${preferredModelToSend}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 32000);

      const response = await fetch('/api/transcribe-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const rawText = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(rawText);
      } catch {
        json = { error: rawText || 'Failed to parse JSON response' };
      }

      if (json?.success) {
        if (json.modelUsed && json.modelUsed !== 'rule-fallback') {
          setLastWorkingModel(json.modelUsed);
          setLastWorkingModelTime(Date.now());
        }
        if (
          json.transcript &&
          json.transcript !== 'Spoken voice input' &&
          json.transcript !== 'Recorded speech audio...'
        ) {
          setTranscript(json.transcript);
        }
        if (json.fallbackUsed) {
          setFallbackNote(json.fallbackNote || 'Parsed using fallback rules.');
        }
        handleGeminiEntries(json.data, requestId);
      } else {
        if (json?.all429) {
          setStatus({
            type: 'error',
            message: t.errorDailyLimit,
          });
        } else if (json?.error && (response.status === 400 || response.status === 401 || response.status === 403)) {
          setStatus({
            type: 'error',
            message: json.error,
          });
        } else {
          setStatus({
            type: 'error',
            message: t.errorGoogleAiBusy,
          });
        }
      }
    } catch (err: any) {
      console.error(`[Hisab Kitab] Request exception:`, err);
      setStatus({
        type: 'error',
        message: t.errorGoogleAiBusy,
      });
    }
  };

  const handleGeminiEntries = (parsedData: any, requestId: string) => {
    console.log('[Hisab Kitab] Gemini Raw JSON:', JSON.stringify(parsedData));

    if (appliedRequestIdsRef.current.has(requestId)) {
      console.warn(`[Hisab Kitab] Request ID ${requestId} already applied. Skipping.`);
      return;
    }
    appliedRequestIdsRef.current.add(requestId);

    try {
      if (!parsedData || !Array.isArray(parsedData.entries)) {
        setStatus({
          type: 'error',
          message: t.errorGoogleAiBusy,
        });
        return;
      }

      const globalNeedsReview = Boolean(parsedData.needs_review);
      const now = new Date();
      const localDate = getLocalDateString(now);
      const nowIso = now.toISOString();

      const newRows: LedgerRow[] = [];
      let noUdhaarPendingCustomer: string | null = null;

      for (let index = 0; index < parsedData.entries.length; index++) {
        const entry = parsedData.entries[index];
        const customerName = entry.customer?.trim() || 'Unknown';
        const entryType: 'sale' | 'payment' | 'settle_all' =
          entry.type === 'payment'
            ? 'payment'
            : entry.type === 'settle_all'
            ? 'settle_all'
            : 'sale';

        const isUnknown = customerName.toLowerCase() === 'unknown';

        if (entryType === 'settle_all') {
          const key = normalizeCustomerKey(customerName);
          const summary = customerSummaries.find((c) => normalizeCustomerKey(c.displayName) === key);
          const currentBalance = summary ? summary.netBalance : 0;

          if (currentBalance <= 0) {
            noUdhaarPendingCustomer = customerName;
            continue;
          }

          newRows.push({
            id: `row-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 6)}`,
            customer: customerName,
            items: '',
            amount: currentBalance,
            on_credit: false,
            needs_review: false,
            type: 'settle_all',
            note: entry.note || '',
            timestamp: nowIso,
            date: localDate,
          });
        } else if (entryType === 'payment') {
          const isAmountMissing = entry.amount === null || entry.amount === undefined || isNaN(entry.amount);
          newRows.push({
            id: `row-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 6)}`,
            customer: customerName,
            items: '',
            amount: isAmountMissing ? null : Number(entry.amount),
            on_credit: false,
            needs_review: globalNeedsReview || isAmountMissing || isUnknown,
            type: 'payment',
            note: entry.note || '',
            timestamp: nowIso,
            date: localDate,
          });
        } else {
          const itemsString = formatItems(entry.items || []);
          const isAmountMissing = entry.amount === null || entry.amount === undefined || isNaN(entry.amount);
          newRows.push({
            id: `row-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 6)}`,
            customer: customerName,
            items: itemsString,
            amount: isAmountMissing ? null : Number(entry.amount),
            on_credit: Boolean(entry.on_credit),
            needs_review: globalNeedsReview || isAmountMissing || isUnknown,
            type: 'sale',
            note: entry.note || '',
            timestamp: nowIso,
            date: localDate,
          });
        }
      }

      console.log(`[Hisab Kitab] Rows added for request ${requestId}:`, newRows.length);

      if (newRows.length > 0) {
        setUnsavedRows((prev) => {
          const next = [...prev, ...newRows];
          console.log(`[Hisab Kitab] Gemini entries added | Saved rows for today: ${todaySavedList.length} | Unsaved rows: ${next.length}`);
          return next;
        });
        setActiveTab('aaj');
        const entryCount = newRows.length;
        setStatus({
          type: 'success',
          message: t.successEntryAdded(entryCount),
        });
      } else if (noUdhaarPendingCustomer) {
        setStatus({
          type: 'success',
          message: t.noUdhaarPending(capitalizeWords(noUdhaarPendingCustomer)),
        });
      } else {
        setStatus({
          type: 'error',
          message: t.noSalesUnderstood,
        });
      }
    } catch (parseError: any) {
      console.error('Error processing Gemini response:', parseError);
      setStatus({
        type: 'error',
        message: t.errorGoogleAiBusy,
      });
    }
  };

  const handleRetry = () => {
    if (lastRequestRef.current) {
      processLedgerInput(lastRequestRef.current);
    }
  };

  const handleSampleChipClick = (sampleText: string) => {
    if (isRecording) {
      stopRecording();
    }
    processLedgerInput({
      textPrompt: sampleText,
      transcriptText: sampleText,
    });
  };

  const startRecording = async () => {
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        });
        stopStream();
        await sendAudioToGemini(audioBlob, mediaRecorder.mimeType || 'audio/webm');
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      setStatus(null);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Microphone access error:', err);
      setStatus({
        type: 'error',
        message: t.micPermissionError,
      });
      stopStream();
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      stopStream();
    }
    setIsRecording(false);
  };

  const handleMicToggle = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const sendAudioToGemini = async (audioBlob: Blob, mimeType: string) => {
    return new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          await processLedgerInput({
            audioBase64: base64Data,
            mimeType: mimeType || 'audio/webm',
          });
        } catch (readErr: any) {
          console.error('File reader error:', readErr);
          setStatus({
            type: 'error',
            message: t.audioReadError,
          });
        }
        resolve();
      };
      reader.readAsDataURL(audioBlob);
    });
  };

  // Editable Table Handlers
  const updateRow = (id: string, field: keyof LedgerRow, value: any) => {
    const isUnsaved = unsavedRows.some((r) => r.id === id);
    if (isUnsaved) {
      setUnsavedRows((prev) =>
        prev.map((row) => {
          if (row.id !== id) return row;
          const updated = { ...row, [field]: value };
          if (field === 'amount') {
            if (value !== null && !isNaN(value) && value > 0 && row.customer && row.customer !== 'Unknown') {
              updated.needs_review = false;
            }
          }
          return updated;
        })
      );
    } else {
      setEditedSavedRows((prev) => {
        const current = prev[id] || {};
        return {
          ...prev,
          [id]: { ...current, [field]: value },
        };
      });
    }
  };

  const addNewEmptyRow = () => {
    const now = new Date();
    const newRow: LedgerRow = {
      id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      customer: '',
      items: '',
      amount: null,
      on_credit: false,
      needs_review: true,
      type: 'sale',
      timestamp: now.toISOString(),
      date: getLocalDateString(now),
    };

    setUnsavedRows((prev) => {
      const next = [...prev, newRow];
      console.log(`[Hisab Kitab] Manual row added | Saved rows for today: ${todaySavedList.length} | Unsaved rows: ${next.length}`);
      return next;
    });
  };

  const handleRowClick = (id: string) => {
    setTappedRowId((prev) => (prev === id ? null : id));
  };

  const handleDeleteRow = (id: string) => {
    const isUnsaved = unsavedRows.some((r) => r.id === id);
    if (isUnsaved) {
      setUnsavedRows((prev) => prev.filter((r) => r.id !== id));
      setTappedRowId(null);
      setStatus({
        type: 'success',
        message: t.entryDeletedSuccess,
      });
    } else {
      setDeleteConfirmRowId(id);
    }
  };

  const handleConfirmDeleteSavedRow = () => {
    if (!deleteConfirmRowId) return;

    const id = deleteConfirmRowId;
    const isSavedSale = savedEntries.some((r) => r.id === id);
    const isSavedPayment = payments.some((p) => p.id === id);

    if (isSavedSale) {
      const updatedSales = savedEntries.filter((r) => r.id !== id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSales));
        setSavedEntries(updatedSales);
      } catch (e) {
        console.warn('Could not save to localStorage:', e);
      }
    }

    if (isSavedPayment) {
      const updatedPayments = payments.filter((p) => p.id !== id);
      try {
        localStorage.setItem(PAYMENTS_STORAGE_KEY, JSON.stringify(updatedPayments));
        setPayments(updatedPayments);
      } catch (e) {
        console.warn('Could not save to localStorage:', e);
      }
    }

    setEditedSavedRows((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });

    setDeleteConfirmRowId(null);
    setTappedRowId(null);

    setStatus({
      type: 'success',
      message: t.entryDeletedSuccess,
    });
  };

  // Save Entries Handler - Commits unsaved rows and edits to saved rows
  const handleSaveAll = () => {
    if (!hasUnsavedChanges) return;

    const now = new Date();
    const todayDate = getLocalDateString(now);
    const nowIso = now.toISOString();

    const updatedSavedEntries = [...savedEntries];
    const updatedPayments = [...payments];
    const updatedPaidCustomers = new Set(paidCustomers);

    try {
      // 1. Commit edits to existing saved rows
      for (const [rowId, changes] of Object.entries(editedSavedRows)) {
        const saleIndex = updatedSavedEntries.findIndex((e) => e.id === rowId);
        if (saleIndex !== -1) {
          updatedSavedEntries[saleIndex] = {
            ...updatedSavedEntries[saleIndex],
            ...changes,
          };
          continue;
        }

        const payIndex = updatedPayments.findIndex((p) => p.id === rowId);
        if (payIndex !== -1) {
          if (changes.customer !== undefined) {
            updatedPayments[payIndex].customer = changes.customer;
          }
          if (changes.amount !== undefined && typeof changes.amount === 'number') {
            updatedPayments[payIndex].amount = changes.amount;
          }
        }
      }

      // 2. Commit new unsaved rows
      for (const row of unsavedRows) {
        if (savedRowIdsRef.current.has(row.id)) continue;
        savedRowIdsRef.current.add(row.id);

        if (row.type === 'payment') {
          const amt = typeof row.amount === 'number' && !isNaN(row.amount) ? row.amount : 0;
          if (amt > 0 && row.customer && row.customer !== 'Unknown') {
            updatedPayments.unshift({
              id: row.id,
              customer: row.customer,
              amount: amt,
              timestamp: row.timestamp || nowIso,
              date: row.date || todayDate,
            });
          }
        } else if (row.type === 'settle_all') {
          const key = normalizeCustomerKey(row.customer);
          let currentUdhaar = 0;
          let currentPaid = 0;

          for (const e of updatedSavedEntries) {
            if (normalizeCustomerKey(e.customer) === key && e.on_credit && typeof e.amount === 'number') {
              currentUdhaar += e.amount;
            }
          }
          for (const p of updatedPayments) {
            if (normalizeCustomerKey(p.customer) === key && typeof p.amount === 'number') {
              currentPaid += p.amount;
            }
          }
          const netBal = currentUdhaar - currentPaid;
          if (netBal > 0) {
            updatedPayments.unshift({
              id: row.id,
              customer: row.customer,
              amount: netBal,
              timestamp: row.timestamp || nowIso,
              date: row.date || todayDate,
            });
            updatedPaidCustomers.add(key);
          }
        } else {
          const stampedRow: LedgerRow = {
            ...row,
            timestamp: row.timestamp || nowIso,
            date: row.date || todayDate,
          };
          updatedSavedEntries.unshift(stampedRow);

          if (row.customer && normalizeCustomerKey(row.customer) !== 'unknown') {
            updatedPaidCustomers.delete(normalizeCustomerKey(row.customer));
          }
        }
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSavedEntries));
      localStorage.setItem(PAYMENTS_STORAGE_KEY, JSON.stringify(updatedPayments));
      localStorage.setItem(PAID_STAMPS_STORAGE_KEY, JSON.stringify(Array.from(updatedPaidCustomers)));

      setSavedEntries(updatedSavedEntries);
      setPayments(updatedPayments);
      setPaidCustomers(updatedPaidCustomers);
      setUnsavedRows([]);
      setEditedSavedRows({});

      const newSavedToday = updatedSavedEntries.filter((e) => !e.date || e.date === todayDate).length +
        updatedPayments.filter((p) => !p.date || p.date === todayDate).length;

      console.log(`[Hisab Kitab] Save | Saved rows for today: ${newSavedToday} | Unsaved rows: 0`);

      setStatus({
        type: 'success',
        message: lang === 'hi' ? 'हिसाब बही में दर्ज हो गया ✓' : 'Entries saved to ledger ✓',
      });
    } catch (err: any) {
      console.warn('Storage error on save:', err);
      setStatus({
        type: 'error',
        message: t.storageWarning,
      });
    }
  };

  const handleClearTableConfirmed = () => {
    if (unsavedRows.length === 0) {
      setShowClearConfirm(false);
      return;
    }
    setUnsavedRows([]);
    setShowClearConfirm(false);
    console.log(`[Hisab Kitab] Clear unsaved | Saved rows for today: ${todaySavedList.length} | Unsaved rows: 0`);
    setStatus({
      type: 'success',
      message: lang === 'hi' ? 'बिना सहेजी एंट्रियाँ साफ़ कर दी गईं।' : 'Unsaved entries cleared.',
    });
  };

  const handleAddPayment = (customerName: string, amountNum: number) => {
    if (isNaN(amountNum) || amountNum <= 0) return;

    const now = new Date();
    const newPayment: PaymentRecord = {
      id: `pay-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      customer: customerName,
      amount: amountNum,
      timestamp: now.toISOString(),
      date: getLocalDateString(now),
    };

    const updatedPayments = [newPayment, ...payments];
    try {
      localStorage.setItem(PAYMENTS_STORAGE_KEY, JSON.stringify(updatedPayments));
      setPayments(updatedPayments);
      setShowPaymentModal(false);
      setPaymentAmountInput('');
      setStatus({
        type: 'success',
        message: t.paymentSavedSuccess(amountNum),
      });
    } catch (err) {
      console.warn('Could not save payment to localStorage:', err);
      setStatus({
        type: 'error',
        message: lang === 'hi' ? 'लोकल स्टोरेज में भुगतान सहेज नहीं पाए।' : 'Could not save payment to local storage.',
      });
    }
  };

  const handleSendReminder = (customer: string, dueAmount: number) => {
    if (dueAmount <= 0) return;
    const message = encodeURIComponent(t.whatsappReminder(capitalizeWords(customer), dueAmount));
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="desk-viewport">
      <div className="diary-container">
        {/* ================= HEADER ================= */}
        <header className="bahi-header">
          <div className="bahi-stitch-top" aria-hidden="true" />
          <div className="bahi-header-row">
            <h1 className="bahi-app-title">{t.title}</h1>

            <div className="bahi-header-right">
              <button
                type="button"
                className="bahi-gear-btn"
                onClick={() => setShowModelPopover(!showModelPopover)}
                title="Settings"
                aria-label="Open settings"
              >
                <Settings size={20} />
              </button>

              {showModelPopover && (
                <div className="bahi-settings-popover">
                  <div className="bahi-popover-section">
                    <label>{t.gearLanguage}</label>
                    <div className="bahi-lang-toggle-group">
                      <button
                        type="button"
                        className={`bahi-lang-btn ${lang === 'hi' ? 'active' : ''}`}
                        onClick={() => handleLangChange('hi')}
                      >
                        हिंदी
                      </button>
                      <button
                        type="button"
                        className={`bahi-lang-btn ${lang === 'en' ? 'active' : ''}`}
                        onClick={() => handleLangChange('en')}
                      >
                        English
                      </button>
                    </div>
                  </div>

                  <div className="bahi-popover-section">
                    <label htmlFor="bahi-model-select">{t.gearModel}</label>
                    <select
                      id="bahi-model-select"
                      className="bahi-model-select"
                      value={selectedModel}
                      onChange={(e) => handleModelChange(e.target.value)}
                    >
                      <option value="auto">{t.autoModelOption}</option>
                      {MODEL_CHAIN.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <div className="bahi-last-model-used" style={{ fontSize: '12px', color: '#6B7280', marginTop: '6px' }}>
                      {lastWorkingModel ? t.lastModelUsedLabel(lastWorkingModel) : t.lastModelUsedNone}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="bahi-stitch-bottom" aria-hidden="true" />
        </header>

        {/* ================= ACTIVE TAB CONTENT ================= */}
        <main className="diary-page">
          {activeTab === 'bolo' && (
            <div className="page-content-wrapper bolo-page-wrapper">
              {/* Mic Area */}
              <div className="speak-mic-area">
                <div className="bahi-mic-wrap">
                  <button
                    type="button"
                    className={`bahi-mic-btn ${isRecording ? 'listening' : ''}`}
                    onClick={handleMicToggle}
                    aria-label={isRecording ? 'Stop recording' : 'Start voice recording'}
                  >
                    {isRecording ? (
                      <>
                        <MicOff size={38} color="#FFFFFF" />
                        <span style={{ fontSize: '12px', color: '#FDE68A', marginTop: '2px' }}>
                          {formatTimer(recordingSeconds)}
                        </span>
                      </>
                    ) : (
                      <Mic size={42} color="#FFFFFF" />
                    )}
                  </button>
                </div>

                <div className="bahi-mic-subtext">
                  {t.micSubtext}
                </div>
              </div>

              {/* Bottom Area: Status -> Samples -> Arrow toggle */}
              <div className="bolo-bottom-area">
                {/* Single Status Line */}
                <div className="bahi-status-container" aria-live="polite">
                  {isRecording && (
                    <div className="bahi-single-status">
                      {t.listening}
                    </div>
                  )}

                  {!isRecording && status?.type === 'processing' && (
                    <div className="bahi-single-status">
                      ✍️ {transcript ? `"${transcript}"` : t.processing}
                    </div>
                  )}

                  {!isRecording && status?.type === 'success' && (
                    <div className="bahi-single-status">
                      {status.message}
                    </div>
                  )}

                  {!isRecording && status?.type === 'error' && (
                    <div className="bahi-single-status error">
                      <span>{status.message}</span>
                      {lastRequestRef.current && (
                        <button
                          type="button"
                          className="bahi-retry-link"
                          onClick={handleRetry}
                        >
                          <RotateCcw size={14} />
                          <span>{t.retryBtn}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Collapsible Sample Phrases Stack */}
                {showSamples && (
                  <div className="bahi-sample-box">
                    {SAMPLE_PROMPTS.map((promptText, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="bahi-sample-line"
                        onClick={() => handleSampleChipClick(promptText)}
                      >
                        "{promptText}"
                      </button>
                    ))}
                  </div>
                )}

                {/* Try a sample toggle button */}
                <button
                  type="button"
                  className="bahi-sample-bottom-toggle"
                  onClick={() => setShowSamples(!showSamples)}
                  aria-expanded={showSamples}
                >
                  <span>{showSamples ? '▼' : '▲'}</span>
                  <span>{t.trySample}</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'aaj' && (
            <div className="page-content-wrapper">
              <div className="bahi-ledger-heading-row">
                <span className="bahi-ledger-date">{todayFormatted}</span>
              </div>

              {/* Entries list */}
              <div className="bahi-ledger-table-wrap">
                {displayRows.length === 0 ? (
                  <div className="bahi-empty-state">
                    <p>{t.noEntriesYet}</p>
                  </div>
                ) : (
                  <div className="bahi-ledger-table">
                    {displayRows.map((row) => {
                      const isSelected = tappedRowId === row.id;
                      const isUnsaved = unsavedRows.some((r) => r.id === row.id);
                      const isPaymentRow = row.type === 'payment';
                      const isSettleRow = row.type === 'settle_all';

                      return (
                        <div
                          key={row.id}
                          className={`bahi-ledger-row-card ${row.needs_review ? 'needs-review' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleRowClick(row.id)}
                        >
                          <div className="bahi-ledger-card-main">
                            <div className="bahi-ledger-card-top">
                              {/* Left margin marker for cash vs credit */}
                              <div className="bahi-margin-marker-wrap" onClick={(e) => e.stopPropagation()}>
                                {isPaymentRow || isSettleRow ? (
                                  <button
                                    type="button"
                                    className="bahi-marker-btn marker-received"
                                    title={isSettleRow ? 'Hisab Barabar' : t.paymentReceived}
                                    disabled
                                  >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2F6B4F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="9" />
                                      <polyline points="8 12 11 15 16 9" />
                                    </svg>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className={`bahi-marker-btn ${row.on_credit ? 'marker-udhaar' : 'marker-cash'}`}
                                    onClick={() => updateRow(row.id, 'on_credit', !row.on_credit)}
                                    title={row.on_credit ? t.udhaar : t.cash}
                                  >
                                    {row.on_credit ? (
                                      <span className="marker-dot udhaar-dot" />
                                    ) : (
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2F6B4F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="9" />
                                        <polyline points="8 12 11 15 16 9" />
                                      </svg>
                                    )}
                                  </button>
                                )}
                              </div>

                              <input
                                type="text"
                                className="bahi-card-customer-input"
                                placeholder={t.customerPlaceholder}
value={row.customer && row.customer.trim().toLowerCase() === 'unknown' ? formatCustomerName(row.customer, lang) : (row.customer || '')}
onFocus={(e) => { if (row.customer && row.customer.trim().toLowerCase() === 'unknown') e.target.select(); }}                                onChange={(e) => updateRow(row.id, 'customer', e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />

                              <div className="bahi-card-amount-wrap" onClick={(e) => e.stopPropagation()}>
                                <span className="bahi-amount-cell-combined">
                                  <span className="bahi-rupee-symbol">₹</span>
                                  <input
                                    type="number"
                                    step="any"
                                    className="bahi-card-amount-input"
                                    placeholder="0"
                                    value={row.amount !== null && row.amount !== undefined ? row.amount : ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      updateRow(row.id, 'amount', val === '' ? null : Number(val));
                                    }}
                                  />
                                </span>
                              </div>
                            </div>

                            {!isPaymentRow && !isSettleRow && (
                              <div className="bahi-ledger-card-bottom" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="text"
                                  className="bahi-card-items-input"
                                  placeholder={t.itemsPlaceholder}
                                  value={focusedItemId === row.id ? (row.items || '') : formatDisplayItems(row.items, lang)}
                                  onFocus={() => setFocusedItemId(row.id)}
                                  onBlur={() => setFocusedItemId(null)}
                                  onChange={(e) => updateRow(row.id, 'items', e.target.value)}
                                />
                              </div>
                            )}

                            {isPaymentRow && (
                              <div className="bahi-payment-label">
                                {t.paymentReceived}
                              </div>
                            )}

                            {isSettleRow && (
                              <div className="bahi-payment-label">
                                {lang === 'hi' ? 'उधार पूरा हुआ (हिसाब बराबर)' : 'Settled debt'}
                              </div>
                            )}
                          </div>

                          {isSelected && (
                            <button
                              type="button"
                              className="bahi-card-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRow(row.id);
                              }}
                              title="Delete entry"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add Row Button */}
              <div className="bahi-add-row-bar">
                <button
                  type="button"
                  className="bahi-btn-add-row"
                  onClick={addNewEmptyRow}
                >
                  {t.addRow}
                </button>
              </div>

              {/* Action Buttons: Save entries & Clear table */}
              <div className="bahi-action-buttons-wrap">
                <button
                  type="button"
                  className={`bahi-btn-save-full ${!hasUnsavedChanges ? 'disabled' : ''}`}
                  onClick={handleSaveAll}
                  disabled={!hasUnsavedChanges}
                >
                  {t.saveEntries}
                </button>

                <button
                  type="button"
                  className={`bahi-btn-clear-link ${!hasUnsavedRows ? 'disabled' : ''}`}
                  onClick={() => setShowClearConfirm(true)}
                  disabled={!hasUnsavedRows}
                >
                  {t.clearTable}
                </button>
              </div>

              {/* Udhaar Khata Summary Card */}
              <div className="bahi-udhaar-summary-card">
                <div className="bahi-summary-title">{t.udhaarKhataTitle}</div>
                <div className="bahi-summary-total">
                  <span>{t.unpaidDuesLabel}</span>
                  <span className="bahi-amount-cell-combined" style={{ fontSize: '24px', fontWeight: 800 }}>
                    <span className="bahi-rupee-symbol">₹</span>
                    <span>{totalShopDue}</span>
                  </span>
                </div>

                {customerDues.length === 0 ? (
                  <div className="bahi-no-dues">{t.noDuesYet}</div>
                ) : (
                  <div className="bahi-dues-list">
                    {customerDues.map((due) => (
                      <div key={due.customer} className="bahi-due-item">
                        <span className="bahi-due-name">{capitalizeWords(formatCustomerName(due.customer, lang))}</span>
                        <div className="bahi-due-right">
                          <span className="bahi-amount-cell-combined">
                            <span className="bahi-rupee-symbol">₹</span>
                            <span>{due.totalCreditDue}</span>
                          </span>
                          <button
                            type="button"
                            className="bahi-btn-reminder"
                            style={{ textDecoration: 'none' }}
                            onClick={() => handleSendReminder(due.customer, due.totalCreditDue)}
                            aria-label={t.reminderBtn}
                            title={t.reminderBtn}
                          >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="#25D366">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'khata' && (
            <div className="page-content-wrapper">
              {selectedCustomer ? (
                /* ================= CUSTOMER DETAIL VIEW ================= */
                <div className="bahi-customer-detail-view">
                  <button
                    type="button"
                    className="bahi-back-btn"
                    onClick={() => setSelectedCustomer(null)}
                  >
                    {t.backKhata}
                  </button>

                  <div className="bahi-customer-header">
                    <h2 className="bahi-customer-title">{capitalizeWords(formatCustomerName(selectedCustomer, lang))}</h2>
                    {selectedCustomerSummary?.isAdvance ? (
                      <div className="bahi-customer-balance-badge advance">
                        <span>{t.advanceLabel}: </span>
                        <span>₹{selectedCustomerSummary.advanceAmount}</span>
                      </div>
                    ) : (
                      <div className="bahi-customer-balance-badge unpaid">
                        <span>{t.unpaidDuesLabel} </span>
                        <span>₹{selectedCustomerUnpaid}</span>
                      </div>
                    )}
                  </div>

                  <div className="bahi-customer-actions">
                    <button
                      type="button"
                      className="bahi-btn-payment"
                      onClick={() => setShowPaymentModal(true)}
                    >
                      {t.writePayment}
                    </button>
                    {selectedCustomerUnpaid > 0 && (
                      <button
                        type="button"
                        className="bahi-btn-reminder-lg"
                        style={{ textDecoration: 'none' }}
                        onClick={() => handleSendReminder(selectedCustomer, selectedCustomerUnpaid)}
                        aria-label={t.sendReminder}
                        title={t.sendReminder}
                      >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="#25D366">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div className="bahi-timeline-title">{t.customerHistoryTitle}</div>

                  <div className="bahi-customer-timeline">
                    {customerTimeline.length === 0 ? (
                      <div className="bahi-empty-state">{t.noCustomerHistoryFound}</div>
                    ) : (
                      customerTimeline.map((item) => (
                        <div key={item.id} className="bahi-timeline-card">
                          <div className="bahi-timeline-card-top">
                            <span className="bahi-timeline-date">{formatDisplayDate(item.date)}</span>
                            <span className={`bahi-timeline-badge ${item.kind === 'payment' ? 'payment' : item.on_credit ? 'credit' : 'cash'}`}>
                              {item.kind === 'payment' ? t.received : item.on_credit ? t.udhaar : t.cash}
                            </span>
                          </div>
                          <div className="bahi-timeline-card-main">
                            <span className="bahi-timeline-items">{formatDisplayItems(item.items, lang) || '—'}</span>
                            <span className="bahi-timeline-amount">
                              ₹{item.amount !== null && item.amount !== undefined ? item.amount : 0}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : selectedDate ? (
                /* ================= DATE DETAIL VIEW ================= */
                <div className="bahi-date-detail-view">
                  <button
                    type="button"
                    className="bahi-back-btn"
                    onClick={() => setSelectedDate(null)}
                  >
                    {t.backKhata}
                  </button>

                  <div className="bahi-date-header">
                    <h2 className="bahi-date-title">{formatDisplayDate(selectedDate)}</h2>
                    <div className="bahi-date-totals-row">
                      <span className="cash-pill">{t.cash}: ₹{dateTotals.cash}</span>
                      <span className="credit-pill">{t.udhaar}: ₹{dateTotals.udhaar}</span>
                      {dateTotals.received > 0 && (
                        <span className="received-pill">{t.received}: ₹{dateTotals.received}</span>
                      )}
                    </div>
                  </div>

                  <div className="bahi-timeline-title">{t.dayEntriesTitle}</div>

                  <div className="bahi-entry-list">
                    {dateEntries.length === 0 ? (
                      <div className="bahi-empty-state">{t.noDateEntriesFound}</div>
                    ) : (
                      dateEntries.map((row) => (
                        <div key={row.id} className="bahi-entry-item">
                          <div className="bahi-margin-marker-static">
                            {row.on_credit ? (
                              <span className="marker-dot udhaar-dot" />
                            ) : (
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2F6B4F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="9" />
                                <polyline points="8 12 11 15 16 9" />
                              </svg>
                            )}
                          </div>
                          <div className="bahi-entry-line-1">
                            <span className="bahi-customer-name-static">
                              {capitalizeWords(formatCustomerName(row.customer, lang))}
                            </span>
                            <span className="bahi-amount-cell-combined" style={{ fontWeight: 700 }}>
                              <span className="bahi-rupee-symbol">₹</span>
                              <span>{row.amount !== null && row.amount !== undefined ? row.amount : 0}</span>
                            </span>
                          </div>
                          <div className="bahi-entry-line-2">
                            <span className="bahi-input-items-area-static">
                              {formatDisplayItems(row.items, lang) || '—'}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {datePayments.length > 0 && (
                    <>
                      <div className="bahi-timeline-title" style={{ color: '#2F6B4F', marginTop: '14px' }}>
                        {t.receivedPaymentsTitle}
                      </div>
                      <div className="bahi-entry-list">
                        {datePayments.map((p) => (
                          <div key={p.id} className="bahi-entry-item">
                            <div className="bahi-margin-marker-static">
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2F6B4F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="9" />
                                <polyline points="8 12 11 15 16 9" />
                              </svg>
                            </div>
                            <div className="bahi-entry-line-1">
                              <span style={{ fontSize: '20px', fontWeight: 700, color: '#2F6B4F' }}>
                                {t.paymentReceived} - {capitalizeWords(formatCustomerName(p.customer, lang))}
                              </span>
                              <span style={{ fontSize: '20px', fontWeight: 700, color: '#2F6B4F' }}>
                                ₹{p.amount}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                /* ================= MAIN KHATA TABS (CUSTOMERS / DAYS) ================= */
                <div className="bahi-khata-main-view">
                  <div className="bahi-sub-tabs">
                    <button
                      type="button"
                      className={`bahi-sub-tab ${khataSubTab === 'customers' ? 'active' : ''}`}
                      onClick={() => setKhataSubTab('customers')}
                    >
                      {t.tabCustomers}
                    </button>
                    <button
                      type="button"
                      className={`bahi-sub-tab ${khataSubTab === 'days' ? 'active' : ''}`}
                      onClick={() => setKhataSubTab('days')}
                    >
                      {t.tabDays}
                    </button>
                  </div>

                  {khataSubTab === 'customers' && (
                    <div className="bahi-customer-list">
                      {customerSummaries.length === 0 ? (
                        <div className="bahi-empty-state">{t.noCustomerHistoryYet}</div>
                      ) : (
                        customerSummaries.map((summary) => {
                          const key = normalizeCustomerKey(summary.displayName);
                          const isPaidStamped = paidCustomers.has(key);

                          return (
                            <div
                              key={summary.displayName}
                              className="bahi-customer-row-card"
                              onClick={() => setSelectedCustomer(summary.displayName)}
                            >
                              <div className="bahi-customer-row-left">
                                <span className="bahi-customer-row-name">
                                  {capitalizeWords(formatCustomerName(summary.displayName, lang))}
                                </span>
                              </div>

                              <div className="bahi-customer-row-right">
                                {isPaidStamped && summary.netBalance <= 0 ? (
                                  <div className="bahi-paid-stamp">PAID</div>
                                ) : summary.isAdvance ? (
                                  <span className="bahi-advance-amount">
                                    {t.advanceLabel}: ₹{summary.advanceAmount}
                                  </span>
                                ) : (
                                  <span className="bahi-amount-cell-combined" style={{ fontWeight: 700, color: '#9B111E' }}>
                                    <span className="bahi-rupee-symbol">₹</span>
                                    <span>{summary.unpaidCredit}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {khataSubTab === 'days' && (
                    <div className="bahi-days-list">
                      {daySummaries.length === 0 ? (
                        <div className="bahi-empty-state">{t.noDayHistoryYet}</div>
                      ) : (
                        daySummaries.map((day) => (
                          <div
                            key={day.date}
                            className="bahi-day-row-card"
                            onClick={() => setSelectedDate(day.date)}
                          >
                            <div className="bahi-day-row-left">
                              <span className="bahi-day-row-date">{day.displayDate}</span>
                              <span className="bahi-day-row-count">({day.count} {lang === 'hi' ? 'एंट्री' : 'entries'})</span>
                            </div>

                            <div className="bahi-day-row-right">
                              <div className="bahi-day-totals">
                                <span className="cash-total">{t.cash}: ₹{day.cashTotal}</span>
                                <span className="udhaar-total">{t.udhaar}: ₹{day.udhaarTotal}</span>
                                {day.receivedTotal > 0 && (
                                  <span className="received-total">{t.received}: ₹{day.receivedTotal}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>

        {/* ================= BOTTOM BAR ================= */}
        <nav className="bahi-bottom-bar" aria-label="Main Navigation">
          <button
            type="button"
            className={`bahi-bottom-tab ${activeTab === 'bolo' ? 'active' : ''}`}
            onClick={() => setActiveTab('bolo')}
          >
            {t.tabBolo}
          </button>
          <button
            type="button"
            className={`bahi-bottom-tab ${activeTab === 'aaj' ? 'active' : ''}`}
            onClick={() => setActiveTab('aaj')}
          >
            {t.tabAaj}
          </button>
          <button
            type="button"
            className={`bahi-bottom-tab ${activeTab === 'khata' ? 'active' : ''}`}
            onClick={() => setActiveTab('khata')}
          >
            {t.tabKhata}
          </button>
        </nav>
      </div>

      {/* Confirmation Modal for Clear Table */}
      {showClearConfirm && (
        <div className="bahi-modal-overlay">
          <div className="bahi-modal-dialog">
            <h3 className="bahi-modal-title">{t.clearModalTitle}</h3>
            <p className="bahi-modal-desc">
              {t.clearModalDesc}
            </p>
            <div className="bahi-modal-actions">
              <button
                type="button"
                className="bahi-btn-clear-link"
                onClick={() => setShowClearConfirm(false)}
              >
                {t.clearModalNo}
              </button>
              <button
                type="button"
                className="bahi-btn-save-full"
                style={{ width: 'auto', padding: '6px 16px' }}
                onClick={handleClearTableConfirmed}
              >
                {t.clearModalYes}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Entry Modal */}
      {showPaymentModal && selectedCustomer && (
        <div className="bahi-modal-overlay">
          <div className="bahi-modal-dialog">
            <h3 className="bahi-modal-title">{t.paymentModalTitle(capitalizeWords(formatCustomerName(selectedCustomer, lang)))}</h3>
            <p className="bahi-modal-desc">
              {t.paymentModalDesc}
            </p>
            <input
              type="number"
              min="1"
              step="any"
              className="bahi-modal-input"
              placeholder="e.g. 100"
              value={paymentAmountInput}
              onChange={(e) => setPaymentAmountInput(e.target.value)}
              autoFocus
            />
            <div className="bahi-modal-actions">
              <button
                type="button"
                className="bahi-btn-clear-link"
                onClick={() => setShowPaymentModal(false)}
              >
                {t.paymentModalCancel}
              </button>
              <button
                type="button"
                className="bahi-btn-save-full"
                style={{ width: 'auto', padding: '6px 16px' }}
                onClick={() => {
                  const amt = Number(paymentAmountInput.trim());
                  if (amt > 0) {
                    handleAddPayment(selectedCustomer, amt);
                  }
                }}
              >
                {t.paymentModalSave}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Delete Saved Row */}
      {deleteConfirmRowId && (
        <div className="bahi-modal-overlay">
          <div className="bahi-modal-dialog">
            <h3 className="bahi-modal-title">{t.deleteModalTitle}</h3>
            <p className="bahi-modal-desc">{t.deleteModalDesc}</p>
            <div className="bahi-modal-actions">
              <button
                type="button"
                className="bahi-btn-clear-link"
                onClick={() => setDeleteConfirmRowId(null)}
              >
                {t.deleteModalNo}
              </button>
              <button
                type="button"
                className="bahi-btn-save-full"
                style={{ width: 'auto', padding: '6px 16px' }}
                onClick={handleConfirmDeleteSavedRow}
              >
                {t.deleteModalYes}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
