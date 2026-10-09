import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, ScrollView, ActivityIndicator, Linking } from 'react-native';

const BACKEND_URL = 'https://transfer-app-df1j.onrender.com';

const PAYMENT_HANDLES = {
  Zelle: 'zelle@yourdomain.com / +1 (555) 019-2831',
  PayPal_FF: 'paypal.me/yourbusiness',
  BinancePay: 'Binance Pay ID: 849201847',
  BybitPay: 'Bybit UID: 92837410'
};

const translations = {
  en: {
    langToggle: 'العربية',
    navHome: 'Home',
    navSend: 'Send',
    navHistory: 'History',
    welcome: 'Welcome',
    rateTitle: 'Live Exchange Rate (البديل)',
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
    logoutBtn: 'Logout'
  },
  ar: {
    langToggle: 'English',
    navHome: 'الرئيسية',
    navSend: 'تحويل',
    navHistory: 'السجل',
    welcome: 'مرحباً بك',
    rateTitle: 'سعر الصرف المباشر (البديل)',
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
    logoutBtn: 'خروج'
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
      const response = await fetch(`${BACKEND_URL}/api/admin/transactions`);
      const data = await response.json();
      if (data.success) {
        const userOrders = data.transactions.filter(t => t.sender_email === userEmail);
        setTransactions(userOrders);
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
          <Text style={styles.brandTitle}>CashExpress SDG</Text>
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
              {authLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{isSignUp ? t.signupBtn : t.loginBtn}</Text>}
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
          <Text style={styles.brandTitle}>CashExpress SDG</Text>
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
            <Text style={styles.greetingText}>{t.welcome}, @{userDisplayName}!</Text>

            <View style={styles.rateCard}>
              <Text style={styles.rateCardTitle}>{t.rateTitle}</Text>
              <Text style={styles.rateCardValue}>
                {t.rateSub} <Text style={styles.rateHighlight}>{loading ? t.loading : `${rate} SDG`}</Text>
              </Text>
            </View>

            <View style={styles.bannerCard}>
              <Text style={styles.bannerTitle}>{t.quickSend}</Text>
              <Text style={styles.bannerDesc}>{t.quickSendDesc}</Text>
              <TouchableOpacity style={styles.bannerBtn} onPress={() => setActiveTab('send')}>
                <Text style={styles.bannerBtnText}>{t.sendNowBtn} →</Text>
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
                  <Text style={[styles.miniStatus, item.status === 'completed' ? styles.statusSuccess : styles.statusPending]}>
                    {item.status ? item.status.toUpperCase() : 'PENDING'}
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
                  {receiptUrl ? <Text style={styles.uploadedText}>✓ Receipt Attached</Text> : null}
                </View>

                <Text style={styles.sectionHeader}>{t.bankakHeader}</Text>
                <TextInput style={styles.inputMargin} placeholder={t.bankakNumPlaceholder} keyboardType="numeric" value={bankakNumber} onChangeText={setBankakNumber} />
                <TextInput style={styles.inputMargin} placeholder={t.bankakNamePlaceholder} value={bankakName} onChangeText={setBankakName} />

                <TouchableOpacity style={styles.button} onPress={handleSubmitOrder} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t.submitBtn}</Text>}
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
              <ActivityIndicator size="large" color="#2563eb" style={{ marginVertical: 20 }} />
            ) : transactions.length === 0 ? (
              <Text style={styles.emptyText}>{t.noActivity}</Text>
            ) : (
              transactions.map((item) => (
                <View key={item.id} style={styles.historyCard}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyTitle}>Transfer #{item.id}</Text>
                    <Text style={[styles.badge, item.status === 'completed' ? styles.badgeSuccess : item.status === 'rejected' ? styles.badgeDanger : styles.badgePending]}>
                      {item.status ? item.status.toUpperCase() : 'PENDING'}
                    </Text>
                  </View>
                  <Text style={styles.historyDetail}>Paid: ${item.amount_usd} USD via {item.payment_method}</Text>
                  <Text style={styles.historyHighlight}>Payout: {item.amount_sdg ? item.amount_sdg.toLocaleString() : 0} SDG</Text>
                  <Text style={styles.historyDetail}>Bankak Acc: {item.bankak_account_number} ({item.bankak_account_name})</Text>

                  {item.receipt_url ? (
                    <TouchableOpacity onPress={() => Linking.openURL(item.receipt_url)} style={styles.receiptLink}>
                      <Text style={styles.receiptLinkText}>📎 View Attached Receipt</Text>
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
          <Text style={[styles.navIcon, activeTab === 'home' && styles.navTextActive]}>🏠</Text>
          <Text style={[styles.navText, activeTab === 'home' && styles.navTextActive]}>{t.navHome}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('send')}>
          <Text style={[styles.navIcon, activeTab === 'send' && styles.navTextActive]}>💸</Text>
          <Text style={[styles.navText, activeTab === 'send' && styles.navTextActive]}>{t.navSend}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('history')}>
          <Text style={[styles.navIcon, activeTab === 'history' && styles.navTextActive]}>📜</Text>
          <Text style={[styles.navText, activeTab === 'history' && styles.navTextActive]}>{t.navHistory}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#0f172a' },
  brandTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  userSubText: { fontSize: 11, color: '#38bdf8', marginTop: 2, fontWeight: 'bold' },
  langBtn: { paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#334155', borderRadius: 16 },
  langBtnText: { fontSize: 12, fontWeight: 'bold', color: '#fff' },
  logoutBtn: { paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#dc2626', borderRadius: 16 },
  logoutBtnText: { fontSize: 12, fontWeight: 'bold', color: '#fff' },
  scroll: { padding: 16, paddingBottom: 80 },
  scrollCenter: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  authCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, elevation: 4 },
  switchAuthBtn: { marginTop: 14, alignItems: 'center' },
  switchAuthText: { fontSize: 13, color: '#2563eb', fontWeight: 'bold' },
  screenContainer: { flex: 1 },
  greetingText: { fontSize: 20, fontWeight: 'bold', color: '#0f172a', marginBottom: 12 },
  rateCard: { backgroundColor: '#1e293b', borderRadius: 14, padding: 16, marginBottom: 16 },
  rateCardTitle: { fontSize: 13, color: '#94a3b8' },
  rateCardValue: { fontSize: 16, color: '#fff', marginTop: 4 },
  rateHighlight: { fontSize: 22, fontWeight: 'bold', color: '#38bdf8' },
  bannerCard: { backgroundColor: '#2563eb', borderRadius: 14, padding: 18, marginBottom: 20 },
  bannerTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  bannerDesc: { fontSize: 13, color: '#e0e7ff', marginTop: 4, marginBottom: 12 },
  bannerBtn: { backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, alignSelf: 'flex-start' },
  bannerBtnText: { fontSize: 13, fontWeight: 'bold', color: '#2563eb' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#0f172a', marginBottom: 10 },
  emptyText: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic', marginVertical: 10 },
  miniCard: { backgroundColor: '#fff', padding: 12, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  miniCardTitle: { fontSize: 14, fontWeight: 'bold', color: '#1e293b' },
  miniCardSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  miniStatus: { fontSize: 10, fontWeight: 'bold', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4 },
  statusPending: { backgroundColor: '#fef3c7', color: '#d97706' },
  statusSuccess: { backgroundColor: '#dcfce7', color: '#15803d' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#0f172a', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 16 },
  inputContainer: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, fontSize: 18, backgroundColor: '#fff' },
  inputMargin: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 10, backgroundColor: '#fff' },
  infoBox: { backgroundColor: '#eef2ff', padding: 10, borderRadius: 8, marginBottom: 12 },
  infoText: { fontSize: 13, color: '#3730a3', marginVertical: 2 },
  resultContainer: { alignItems: 'center', marginVertical: 12, padding: 12, backgroundColor: '#f0fdf4', borderRadius: 8 },
  resultLabel: { fontSize: 13, color: '#166534', fontWeight: '600' },
  resultValue: { fontSize: 22, fontWeight: 'bold', color: '#15803d', marginTop: 2 },
  sectionHeader: { fontSize: 14, fontWeight: 'bold', color: '#0f172a', marginTop: 10, marginBottom: 8 },
  railRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  railButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  railButtonActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  railText: { fontSize: 12, color: '#334155', fontWeight: '600' },
  railTextActive: { color: '#fff' },
  handleBox: { backgroundColor: '#f1f5f9', padding: 10, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  handleLabel: { fontSize: 11, color: '#64748b' },
  handleText: { fontSize: 14, color: '#0f172a', fontWeight: 'bold', marginTop: 2 },
  uploadContainer: { marginBottom: 12, padding: 10, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' },
  uploadingText: { fontSize: 12, color: '#2563eb' },
  uploadedText: { fontSize: 13, color: '#166534', fontWeight: 'bold' },
  button: { backgroundColor: '#2563eb', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  successContainer: { padding: 16, alignItems: 'center' },
  successTitle: { fontSize: 18, fontWeight: 'bold', color: '#166534', marginBottom: 8 },
  successText: { fontSize: 14, color: '#334155', textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  historyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  historyTitle: { fontSize: 15, fontWeight: 'bold', color: '#0f172a' },
  badge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, fontSize: 10, fontWeight: 'bold' },
  badgePending: { backgroundColor: '#fef3c7', color: '#d97706' },
  badgeSuccess: { backgroundColor: '#dcfce7', color: '#15803d' },
  badgeDanger: { backgroundColor: '#fee2e2', color: '#b91c1c' },
  historyDetail: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  historyHighlight: { fontSize: 14, fontWeight: 'bold', color: '#166534', marginVertical: 2 },
  receiptLink: { marginTop: 6 },
  receiptLinkText: { fontSize: 12, color: '#2563eb', fontWeight: 'bold' },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, backgroundColor: '#fff', flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e2e8f0', justifyContent: 'space-around', alignItems: 'center' }
});
