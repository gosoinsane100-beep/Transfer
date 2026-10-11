import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, ScrollView, ActivityIndicator, Linking, Platform } from 'react-native';

const BACKEND_URL = 'https://transfer-app-df1j.onrender.com';

const PAYMENT_HANDLES = {
  Zelle: 'zelle@yourdomain.com / +1 (555) 019-2831',
  PayPal_FF: 'paypal.me/yourbusiness',
  BinancePay: 'Binance Pay ID: 849201847',
  BybitPay: 'Bybit UID: 92837410'
};

const translations = {
  en: {
    brandTitle: 'Sudan Remit',
    langToggle: 'العربية',
    navHome: 'Home',
    navSend: 'Send',
    navHistory: 'History',
    welcome: 'Welcome',
    rateTitle: 'Live Exchange Rate',
    rateSub: '1 USD =',
    quickSend: 'Send Money to Bankak',
    quickSendDesc: 'Transfer USD instantly at market rates with $0 hidden fees.',
    sendNowBtn: 'Send Now',
    recentActivity: 'Your Recent Activity',
    noActivity: 'No recent transactions found.',
    sendTitle: 'New Transfer',
    sendSubtitle: 'Send USD and receive Sudanese Pounds in Bankak',
    sendLabel: 'You Send (USD):',
    feeLabel: 'Platform Fee (5%):',
    rateLabel: 'Exchange Rate:',
    loading: 'Loading rate...',
    receiveLabel: 'Recipient Receives (Bankak):',
    senderHeader: 'Sender Details',
    namePlaceholder: 'Full Name',
    paymentHeader: 'Select Payment Method',
    sendToNotice: 'Send exact USD amount to this handle:',
    receiptHeader: 'Attach Payment Proof',
    bankakHeader: 'Bankak Recipient Details',
    bankakNumPlaceholder: 'Bankak Account Number',
    bankakNamePlaceholder: 'Bankak Account Name',
    submitBtn: 'Submit Transfer',
    submitting: 'Submitting...',
    successTitle: 'Order Submitted!',
    successText: (usd, method, sdg, num) => `Send $${usd} via ${method}. Once verified, ${sdg.toLocaleString()} SDG will be transferred to Bankak account #${num}.`,
    historyTitle: 'Your Transfer History',
    historySub: 'Track the real-time status of your payouts',
    fillAlert: 'Please fill out all required fields and attach a receipt image.',
    errorConn: 'Error connecting to backend server.',
    loginTitle: 'Sign In to Your Account',
    signupTitle: 'Create New Account',
    authUsername: 'Username',
    authPassword: 'Password',
    loginBtn: 'Sign In',
    signupBtn: 'Create Account',
    switchSignup: "Don't have an account? Sign Up",
    switchLogin: 'Already have an account? Sign In',
    logoutBtn: 'Logout',
    statusLabels: {
      pending: 'Pending',
      payment_received: 'Payment received',
      sent: 'Sent to Bankak',
      completed: 'Completed',
      rejected: 'Rejected'
    }
  },
  ar: {
    brandTitle: 'تحويل السودان',
    langToggle: 'English',
    navHome: 'الرئيسية',
    navSend: 'تحويل',
    navHistory: 'السجل',
    welcome: 'مرحباً بك',
    rateTitle: 'سعر الصرف المباشر',
    rateSub: '1 دولار =',
    quickSend: 'إرسال أموال إلى بنكك',
    quickSendDesc: 'حوّل الدولار فوراً بأسعار السوق وبدون رسوم خفية.',
    sendNowBtn: 'أرسل الآن',
    recentActivity: 'نشاطك الأخير',
    noActivity: 'لا توجد معاملات سابقة لهذا الحساب.',
    sendTitle: 'تحويل جديد',
    sendSubtitle: 'أرسل بالدولار واستلم الجنيه السوداني في حساب بنكك',
    sendLabel: 'المبلغ المرسل (بالدولار):',
    feeLabel: 'رسوم المنصة (5%):',
    rateLabel: 'سعر الصرف:',
    loading: 'جاري تحميل السعر...',
    receiveLabel: 'المبلغ المستلم (بنكك):',
    senderHeader: 'بيانات المرسل',
    namePlaceholder: 'الاسم الكامل',
    paymentHeader: 'اختر وسيلة الدفع',
    sendToNotice: 'قم بتحويل المبلغ إلى الحساب التالي:',
    receiptHeader: 'إرفاق إيصال التحويل',
    bankakHeader: 'تفاصيل حساب بنكك للمستلم',
    bankakNumPlaceholder: 'رقم حساب بنكك',
    bankakNamePlaceholder: 'اسم صاحب الحساب في بنكك',
    submitBtn: 'إرسال الطلب',
    submitting: 'جاري الإرسال...',
    successTitle: 'تم تقديم الطلب بنجاح!',
    successText: (usd, method, sdg, num) => `قم بإرسال $${usd} عبر ${method}. بعد التحقق، سيتم تحويل ${sdg.toLocaleString()} جنيه سوداني إلى حساب بنكك رقم #${num}.`,
    historyTitle: 'سجل تحويلاتك',
    historySub: 'متابعة حالة الطلبات والدفعات في الوقت الفعلي',
    fillAlert: 'يرجى ملء جميع الحقول وإرفاق صورة الإيصال.',
    errorConn: 'خطأ في الاتصال بالسيرفر.',
    loginTitle: 'تسجيل الدخول إلى حسابك',
    signupTitle: 'إنشاء حساب جديد',
    authUsername: 'اسم المستخدم',
    authPassword: 'كلمة المرور',
    loginBtn: 'تسجيل الدخول',
    signupBtn: 'إنشاء حساب',
    switchSignup: 'ليس لديك حساب؟ سجل الآن',
    switchLogin: 'لديك حساب بالفعل؟ سجل الدخول',
    logoutBtn: 'خروج',
    statusLabels: {
      pending: 'قيد الانتظار',
      payment_received: 'تم استلام الدفعة',
      sent: 'تم الإرسال إلى بنكك',
      completed: 'مكتمل',
      rejected: 'مرفوض'
    }
  }
};

export default function App() {
  const [lang, setLang] = useState('en');
  const [activeTab, setActiveTab] = useState('home');
  const t = translations[lang];

  // Auth State
  const [user, setUser] = useState(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Transfer form state
  const [amountUSD, setAmountUSD] = useState('100');
  const [rate, setRate] = useState(8920);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Zelle');
  const [bankakNumber, setBankakNumber] = useState('');
  const [bankakName, setBankakName] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [orderSubmitted, setOrderSubmitted] = useState(false);

  // History state
  const [transactions, setTransactions] = useState([]);
  const [fetchingHistory, setFetchingHistory] = useState(false);

  useEffect(() => {
    if (user) {
      fetchExchangeRate();
      fetchUserHistory(user.email);
    }
  }, [user]);

  const handleAuth = async () => {
    if (!username || !authPassword) {
      alert('Please enter both username and password.');
      return;
    }

    setAuthLoading(true);
    const endpoint = isSignUp ? '/api/register' : '/api/login';

    try {
      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: authPassword })
      });

      const data = await response.json();
      if (data.success) {
        setUser(data.user);
      } else {
        alert(data.error || 'Authentication failed.');
      }
    } catch (err) {
      alert('Error connecting to authentication service.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setUsername('');
    setAuthPassword('');
  };

  const fetchExchangeRate = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/rate`);
      const data = await response.json();
      if (data.success && data.rate) {
        setRate(data.rate);
      }
    } catch (error) {
      console.log('Using fallback rate:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserHistory = async (userEmail) => {
    try {
      setFetchingHistory(true);
      const response = await fetch(`${BACKEND_URL}/api/transactions/mine?email=${encodeURIComponent(userEmail)}`);
      const data = await response.json();
      if (data.success) {
        setTransactions(data.transactions);
      }
    } catch (error) {
      console.log('Error fetching user history:', error);
    } finally {
      setFetchingHistory(false);
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploadingReceipt(true);
    const formData = new FormData();
    formData.append('receipt', file);

    try {
      const response = await fetch(`${BACKEND_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (data.success) {
        setReceiptUrl(data.url);
      } else {
        alert('Receipt upload failed: ' + data.error);
      }
    } catch (err) {
      alert('Error uploading receipt image.');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const statusStyle = (status) => {
    if (status === 'completed') return styles.badgeSuccess;
    if (status === 'rejected') return styles.badgeDanger;
    if (status === 'payment_received' || status === 'sent') return styles.badgeProgress;
    return styles.badgePending;
  };

  const statusLabel = (status) => {
    return t.statusLabels[status] ? t.statusLabels[status] : t.statusLabels.pending;
  };

  const platformFeePercent = 0.05;
  const numUSD = parseFloat(amountUSD ? amountUSD : '0');
  const feeUSD = numUSD * platformFeePercent;
  const usdAfterFee = numUSD - feeUSD;
  const sdgAmount = usdAfterFee * rate;

  const handleSubmitOrder = async () => {
    if (!senderName || !bankakNumber || !bankakName) {
      alert(t.fillAlert);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName,
          senderEmail: user.email,
          amountUSD: numUSD,
          feeUSD,
          exchangeRate: rate,
          amountSDG: sdgAmount,
          paymentMethod,
          bankakAccountNumber: bankakNumber,
          bankakAccountName: bankakName,
          receiptUrl
        })
      });

      const data = await response.json();
      if (data.success) {
        setOrderSubmitted(true);
        fetchUserHistory(user.email);
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (err) {
      alert(t.errorConn);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.brandTitle}>{t.brandTitle}</Text>
          <TouchableOpacity style={styles.langBtn} onPress={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            <Text style={styles.langBtnText}>{t.langToggle}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollCenter}>
          <View style={styles.authCard}>
            <Text style={styles.title}>{isSignUp ? t.signupTitle : t.loginTitle}</Text>

            <Text style={styles.label}>{t.authUsername}</Text>
            <TextInput style={styles.inputMargin} autoCapitalize="none" value={username} onChangeText={setUsername} placeholder="e.g. ahmed123" />

            <Text style={styles.label}>{t.authPassword}</Text>
            <TextInput style={styles.inputMargin} secureTextEntry value={authPassword} onChangeText={setAuthPassword} placeholder="••••••••" />

            <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={authLoading}>
              {authLoading ? <ActivityIndicator color="#F4F6FA" /> : <Text style={styles.buttonText}>{isSignUp ? t.signupBtn : t.loginBtn}</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.switchAuthBtn} onPress={() => setIsSignUp(!isSignUp)}>
              <Text style={styles.switchAuthText}>{isSignUp ? t.switchLogin : t.switchSignup}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const userDisplayName = user.username ? user.username : 'User';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.brandTitle}>{t.brandTitle}</Text>
          <Text style={styles.userSubText}>@{userDisplayName}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={styles.langBtn} onPress={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            <Text style={styles.langBtnText}>{t.langToggle}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>{t.logoutBtn}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {activeTab === 'home' && (
          <View style={styles.screenContainer}>
            <Text style={styles.greetingText}>{t.welcome}, @{userDisplayName}</Text>

            <View style={styles.rateCard}>
              <Text style={styles.rateCardTitle}>{t.rateTitle}</Text>
              <View style={styles.rateRule} />
              <Text style={styles.rateCardValue}>
                {t.rateSub}{' '}
                <Text style={styles.rateHighlight}>{loading ? t.loading : `${rate.toLocaleString()} SDG`}</Text>
              </Text>
            </View>

            <View style={styles.bannerCard}>
              <Text style={styles.bannerTitle}>{t.quickSend}</Text>
              <Text style={styles.bannerDesc}>{t.quickSendDesc}</Text>
              <TouchableOpacity style={styles.bannerBtn} onPress={() => setActiveTab('send')}>
                <Text style={styles.bannerBtnText}>{t.sendNowBtn}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>{t.recentActivity}</Text>
            {transactions.length === 0 ? (
              <Text style={styles.emptyText}>{t.noActivity}</Text>
            ) : (
              transactions.slice(0, 3).map((item) => (
                <View key={item.id} style={styles.miniCard}>
                  <View>
                    <Text style={styles.miniCardTitle}>Transfer to {item.bankak_account_name}</Text>
                    <Text style={styles.miniCardSub}>${item.amount_usd} USD ({item.payment_method})</Text>
                  </View>
                  <Text style={[styles.miniStatus, statusStyle(item.status)]}>
                    {statusLabel(item.status)}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'send' && (
          <View style={styles.screenContainer}>
            <Text style={styles.title}>{t.sendTitle}</Text>
            <Text style={styles.subtitle}>{t.sendSubtitle}</Text>

            {orderSubmitted ? (
              <View style={styles.successContainer}>
                <Text style={styles.successTitle}>{t.successTitle}</Text>
                <Text style={styles.successText}>
                  {t.successText(numUSD, paymentMethod, sdgAmount, bankakNumber)}
                </Text>
                <TouchableOpacity style={styles.button} onPress={() => { setOrderSubmitted(false); setActiveTab('history'); }}>
                  <Text style={styles.buttonText}>View in History</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.inputContainer}>
                  <Text style={styles.label}>{t.sendLabel}</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={amountUSD} onChangeText={setAmountUSD} />
                </View>

                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>{t.feeLabel} ${feeUSD.toFixed(2)}</Text>
                  <Text style={styles.infoText}>{t.rateLabel} $1 = {loading ? t.loading : `${rate} SDG`}</Text>
                </View>

                <View style={styles.resultContainer}>
                  <Text style={styles.resultLabel}>{t.receiveLabel}</Text>
                  <Text style={styles.resultValue}>{sdgAmount.toLocaleString()} SDG</Text>
                </View>

                <Text style={styles.sectionHeader}>{t.senderHeader}</Text>
                <TextInput style={styles.inputMargin} placeholder={t.namePlaceholder} value={senderName} onChangeText={setSenderName} />

                <Text style={styles.sectionHeader}>{t.paymentHeader}</Text>
                <View style={styles.railRow}>
                  {['Zelle', 'PayPal_FF', 'BinancePay', 'BybitPay'].map((method) => (
                    <TouchableOpacity
                      key={method}
                      style={[styles.railButton, paymentMethod === method && styles.railButtonActive]}
                      onPress={() => setPaymentMethod(method)}
                    >
                      <Text style={[styles.railText, paymentMethod === method && styles.railTextActive]}>{method}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.handleBox}>
                  <Text style={styles.handleLabel}>{t.sendToNotice}</Text>
                  <Text style={styles.handleText}>{PAYMENT_HANDLES[paymentMethod]}</Text>
                </View>

                <Text style={styles.sectionHeader}>{t.receiptHeader}</Text>
                <View style={styles.uploadContainer}>
                  <input type="file" accept="image/*" onChange={handleFileChange} style={{ marginBottom: 8 }} />
                  {uploadingReceipt && <Text style={styles.uploadingText}>Uploading receipt...</Text>}
                  {receiptUrl ? <Text style={styles.uploadedText}>✓ Receipt attached</Text> : null}
                </View>

                <Text style={styles.sectionHeader}>{t.bankakHeader}</Text>
                <TextInput style={styles.inputMargin} placeholder={t.bankakNumPlaceholder} keyboardType="numeric" value={bankakNumber} onChangeText={setBankakNumber} />
                <TextInput style={styles.inputMargin} placeholder={t.bankakNamePlaceholder} value={bankakName} onChangeText={setBankakName} />

                <TouchableOpacity style={styles.button} onPress={handleSubmitOrder} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#F4F6FA" /> : <Text style={styles.buttonText}>{t.submitBtn}</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.screenContainer}>
            <Text style={styles.title}>{t.historyTitle}</Text>
            <Text style={styles.subtitle}>{t.historySub}</Text>

            {fetchingHistory ? (
              <ActivityIndicator size="large" color="#0B3B63" style={{ marginVertical: 20 }} />
            ) : transactions.length === 0 ? (
              <Text style={styles.emptyText}>{t.noActivity}</Text>
            ) : (
              transactions.map((item) => (
                <View key={item.id} style={styles.historyCard}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyTitle}>Transfer #{item.id}</Text>
                    <Text style={[styles.badge, statusStyle(item.status)]}>
                      {statusLabel(item.status)}
                    </Text>
                  </View>
                  <Text style={styles.historyDetail}>Paid: ${item.amount_usd} USD via {item.payment_method}</Text>
                  <Text style={styles.historyHighlight}>Payout: {item.amount_sdg ? item.amount_sdg.toLocaleString() : 0} SDG</Text>
                  <Text style={styles.historyDetail}>Bankak Acc: {item.bankak_account_number} ({item.bankak_account_name})</Text>

                  {item.receipt_url ? (
                    <TouchableOpacity onPress={() => Linking.openURL(item.receipt_url)} style={styles.receiptLink}>
                      <Text style={styles.receiptLinkText}>📎 View attached receipt</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')}>
          <Text style={styles.navIcon}>🏠</Text>
          <Text style={[styles.navText, activeTab === 'home' && styles.navTextActive]}>{t.navHome}</Text>
          {activeTab === 'home' ? <View style={styles.navActiveMark} /> : null}
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('send')}>
          <Text style={styles.navIcon}>💸</Text>
          <Text style={[styles.navText, activeTab === 'send' && styles.navTextActive]}>{t.navSend}</Text>
          {activeTab === 'send' ? <View style={styles.navActiveMark} /> : null}
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('history')}>
          <Text style={styles.navIcon}>📜</Text>
          <Text style={[styles.navText, activeTab === 'history' && styles.navTextActive]}>{t.navHistory}</Text>
          {activeTab === 'history' ? <View style={styles.navActiveMark} /> : null}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ---- Visual tokens -------------------------------------------------
// A deep banking navy + warm brass palette, deliberately echoing the
// Bankak app this audience already uses and trusts daily — the goal is
// for this to read as "another screen from my bank," not a new,
// unfamiliar startup. Flat surfaces and hairline rules instead of
// shadow-heavy cards, a serif reserved for headings and the rate/payout
// numbers (the two things a sender actually came to look at), and a
// single warm accent spent only on the primary action and the amounts.
const colors = {
  ink: '#111C2B',
  paper: '#F4F6FA',
  card: '#FFFFFF',
  border: '#D9E1EC',
  muted: '#5B6B80',
  primary: '#0B3B63',
  primaryPressed: '#082C4A',
  gold: '#B8841F',
  pendingBg: '#F6EAD2',
  pendingText: '#8A6111',
  progressBg: '#E1EAF5',
  progressText: '#0B3B63',
  successBg: '#DCEEE1',
  successText: '#09573F',
  dangerBg: '#F3DEDE',
  dangerText: '#8C1D1D'
};

const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: colors.ink },
  brandTitle: { fontSize: 18, fontFamily: serif, fontWeight: 'bold', color: colors.paper },
  userSubText: { fontSize: 11, color: colors.gold, marginTop: 2 },
  langBtn: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 4, borderWidth: 1, borderColor: colors.gold },
  langBtnText: { fontSize: 12, fontWeight: '600', color: colors.gold },
  logoutBtn: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 4, borderWidth: 1, borderColor: '#3A4D63' },
  logoutBtnText: { fontSize: 12, fontWeight: '600', color: colors.paper },
  scroll: { padding: 16, paddingBottom: 90 },
  scrollCenter: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  authCard: { backgroundColor: colors.card, borderRadius: 6, padding: 20, borderWidth: 1, borderColor: colors.border },
  switchAuthBtn: { marginTop: 14, alignItems: 'center' },
  switchAuthText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  screenContainer: { flex: 1 },
  greetingText: { fontSize: 19, fontFamily: serif, color: colors.ink, marginBottom: 14 },
  rateCard: { backgroundColor: colors.ink, borderRadius: 6, padding: 18, marginBottom: 16 },
  rateCardTitle: { fontSize: 12, color: '#AFC2D6', letterSpacing: 0.3 },
  rateRule: { height: 1, backgroundColor: colors.gold, opacity: 0.5, marginVertical: 10, width: 48 },
  rateCardValue: { fontSize: 15, color: '#E4EAF2' },
  rateHighlight: { fontSize: 26, fontFamily: serif, fontWeight: 'bold', color: colors.gold },
  bannerCard: { backgroundColor: colors.card, borderRadius: 6, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.primary },
  bannerTitle: { fontSize: 17, fontFamily: serif, fontWeight: 'bold', color: colors.ink },
  bannerDesc: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 14, lineHeight: 18 },
  bannerBtn: { backgroundColor: colors.primary, paddingVertical: 9, paddingHorizontal: 18, borderRadius: 4, alignSelf: 'flex-start' },
  bannerBtnText: { fontSize: 13, fontWeight: '600', color: colors.paper },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.ink, marginBottom: 10 },
  emptyText: { fontSize: 13, color: colors.muted, fontStyle: 'italic', marginVertical: 10 },
  miniCard: { backgroundColor: colors.card, padding: 12, borderRadius: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  miniCardTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  miniCardSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  miniStatus: { fontSize: 11, fontWeight: '600', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4, overflow: 'hidden' },
  title: { fontSize: 20, fontFamily: serif, fontWeight: 'bold', color: colors.ink, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, color: colors.muted, textAlign: 'center', marginBottom: 18 },
  inputContainer: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 4, padding: 10, fontSize: 18, backgroundColor: colors.card, color: colors.ink },
  inputMargin: { borderWidth: 1, borderColor: colors.border, borderRadius: 4, padding: 10, fontSize: 14, marginBottom: 10, backgroundColor: colors.card, color: colors.ink },
  infoBox: { backgroundColor: colors.card, padding: 10, borderRadius: 4, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  infoText: { fontSize: 13, color: colors.muted, marginVertical: 2 },
  resultContainer: { alignItems: 'center', marginVertical: 12, padding: 16, backgroundColor: colors.ink, borderRadius: 6 },
  resultLabel: { fontSize: 12, color: '#AFC2D6' },
  resultValue: { fontSize: 24, fontFamily: serif, fontWeight: 'bold', color: colors.gold, marginTop: 4 },
  sectionHeader: { fontSize: 14, fontWeight: '600', color: colors.ink, marginTop: 10, marginBottom: 8 },
  railRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  railButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 4, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  railButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  railText: { fontSize: 12, color: colors.ink, fontWeight: '600' },
  railTextActive: { color: colors.paper },
  handleBox: { backgroundColor: colors.card, padding: 10, borderRadius: 4, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  handleLabel: { fontSize: 11, color: colors.muted },
  handleText: { fontSize: 14, color: colors.ink, fontWeight: '600', marginTop: 2 },
  uploadContainer: { marginBottom: 12, padding: 10, backgroundColor: colors.card, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  uploadingText: { fontSize: 12, color: colors.primary },
  uploadedText: { fontSize: 13, color: colors.successText, fontWeight: '600' },
  button: { backgroundColor: colors.primary, paddingVertical: 13, borderRadius: 4, alignItems: 'center', marginTop: 10 },
  buttonText: { color: colors.paper, fontSize: 15, fontWeight: '600' },
  successContainer: { padding: 16, alignItems: 'center' },
  successTitle: { fontSize: 18, fontFamily: serif, fontWeight: 'bold', color: colors.successText, marginBottom: 8 },
  successText: { fontSize: 14, color: colors.ink, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  historyCard: { backgroundColor: colors.card, borderRadius: 6, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  historyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4, fontSize: 11, fontWeight: '600', overflow: 'hidden' },
  badgePending: { backgroundColor: colors.pendingBg, color: colors.pendingText },
  badgeSuccess: { backgroundColor: colors.successBg, color: colors.successText },
  badgeDanger: { backgroundColor: colors.dangerBg, color: colors.dangerText },
  badgeProgress: { backgroundColor: colors.progressBg, color: colors.progressText },
  historyDetail: { fontSize: 12, color: colors.muted, marginBottom: 2 },
  historyHighlight: { fontSize: 14, fontWeight: '600', color: colors.successText, marginVertical: 2 },
  receiptLink: { marginTop: 6 },
  receiptLinkText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 64, backgroundColor: colors.card, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, justifyContent: 'space-around', alignItems: 'center' },
  navItem: { alignItems: 'center', justifyContent: 'center', paddingTop: 4 },
  navIcon: { fontSize: 18 },
  navText: { fontSize: 11, color: colors.muted, marginTop: 2 },
  navTextActive: { color: colors.primary, fontWeight: '600' },
  navActiveMark: { width: 16, height: 2, backgroundColor: colors.primary, borderRadius: 1, marginTop: 4 }
});
